#!/opt/curl-cffi-venv/bin/python3
"""7Movies/Vidrift boot helper — Chrome TLS impersonation + shared cache.

Contabo DC curl/node fetch gets CF 403. curl_cffi chrome131 passes.
No FlareSolverr (too heavy for concurrent viewers).
"""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

from curl_cffi import requests as crequests

BIND = "127.0.0.1"
PORT = int(__import__("os").environ.get("SEVENMOVIES_BOOT_PORT", "3887"))
SITE = "https://7movies.ac"
EMBED = "https://embed.vidrift.net"
CACHE_TTL_MS = int(__import__("os").environ.get("SEVENMOVIES_BOOT_CACHE_MS", "600000"))  # 10 min
WARP = (
    __import__("os").environ.get("SEVENMOVIES_SOCKS")
    or __import__("os").environ.get("WARP_SOCKS")
    or ""
).strip()
FETCH_CONCURRENCY = max(
    2, int(__import__("os").environ.get("SEVENMOVIES_FETCH_CONCURRENCY", "12"))
)
# Hard cap how long one /fetch may hold a slot (curl timeout is 45s).
FETCH_SLOT_MAX_SEC = float(
    __import__("os").environ.get("SEVENMOVIES_FETCH_SLOT_MAX_SEC", "25")
)
# Reject/ truncate full-file downloads that would wedge RAM + slots.
FETCH_MAX_BODY = int(
    __import__("os").environ.get("SEVENMOVIES_FETCH_MAX_BODY", str(12 * 1024 * 1024))
)

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
_inflight: dict[str, threading.Event] = {}
_inflight_result: dict[str, dict] = {}

# Explicit slot tracker — Semaphore._value alone lied when threads wedged.
_fetch_slots = FETCH_CONCURRENCY
_fetch_held: dict[int, float] = {}  # thread ident -> acquired_at
_fetch_cv = threading.Condition(_lock)
_fetch_seq = 0


def _warp_proxies():
    if not WARP:
        return None
    u = WARP
    if u.startswith("socks5://"):
        u = "socks5h://" + u[len("socks5://") :]
    elif not u.startswith("socks5h://"):
        u = f"socks5h://{u}" if "://" not in u else u
    return {"https": u, "http": u}


def _prune_cache():
    now = time.time() * 1000
    with _lock:
        dead = [k for k, (exp, _) in _cache.items() if exp <= now]
        for k in dead:
            _cache.pop(k, None)
        if len(_cache) > 2000:
            items = sorted(_cache.items(), key=lambda kv: kv[1][0])
            for k, _ in items[: max(0, len(items) - 1500)]:
                _cache.pop(k, None)


def _reclaim_stale_fetch_slots(now: float | None = None) -> int:
    """Force-free slots held longer than FETCH_SLOT_MAX_SEC (wedged curl)."""
    global _fetch_slots
    now = time.time() if now is None else now
    freed = 0
    with _fetch_cv:
        stale = [tid for tid, ts in _fetch_held.items() if now - ts > FETCH_SLOT_MAX_SEC]
        for tid in stale:
            _fetch_held.pop(tid, None)
            _fetch_slots = min(FETCH_CONCURRENCY, _fetch_slots + 1)
            freed += 1
        if freed:
            _fetch_cv.notify_all()
    return freed


def _acquire_fetch_slot(timeout: float = 4.0) -> bool:
    global _fetch_slots
    _reclaim_stale_fetch_slots()
    deadline = time.time() + timeout
    tid = threading.get_ident()
    with _fetch_cv:
        while True:
            if _fetch_slots > 0:
                _fetch_slots -= 1
                _fetch_held[tid] = time.time()
                return True
            remaining = deadline - time.time()
            if remaining <= 0:
                return False
            _fetch_cv.wait(timeout=min(0.5, remaining))
            # Reclaim while holding the condition lock's underlying lock.
            now = time.time()
            stale = [
                t for t, ts in _fetch_held.items() if now - ts > FETCH_SLOT_MAX_SEC
            ]
            for t in stale:
                _fetch_held.pop(t, None)
                _fetch_slots = min(FETCH_CONCURRENCY, _fetch_slots + 1)


def _release_fetch_slot() -> None:
    global _fetch_slots
    tid = threading.get_ident()
    with _fetch_cv:
        if tid in _fetch_held:
            _fetch_held.pop(tid, None)
            _fetch_slots = min(FETCH_CONCURRENCY, _fetch_slots + 1)
            _fetch_cv.notify()
        # If tid missing (watchdog already reclaimed), do not over-release.


def _fetch_free() -> int:
    with _lock:
        return _fetch_slots


def boot_payload(
    tmdb_id: str, media_type: str, season: int, episode: int, title: str
) -> dict:
    key = f"{media_type}:{tmdb_id}:{season}:{episode}"
    now = time.time() * 1000
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            body = dict(hit[1])
            body["_cache"] = "hit"
            return body
        ev = _inflight.get(key)

    if ev is not None:
        ev.wait(timeout=60)
        with _lock:
            if key in _inflight_result:
                body = dict(_inflight_result[key])
                body["_cache"] = "coalesce"
                return body
            hit = _cache.get(key)
            if hit and hit[0] > now:
                body = dict(hit[1])
                body["_cache"] = "hit-after-wait"
                return body

    with _lock:
        if key not in _inflight:
            _inflight[key] = threading.Event()
        ev = _inflight[key]

    try:
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Origin": EMBED,
            "Referer": f"{EMBED}/embed2/play",
            "x-embed-parent": SITE,
        }
        if media_type == "tv":
            path = f"{EMBED}/api/boot/tv/{tmdb_id}/{season}/{episode}"
        else:
            path = f"{EMBED}/api/boot/movie/{tmdb_id}"
        q = {
            "type": media_type,
            "id": tmdb_id,
            "source": "0",
            "title": title or f"tmdb-{tmdb_id}",
            "shell": "1",
        }
        if media_type == "tv":
            q["season"] = str(season)
            q["episode"] = str(episode)
        url = f"{path}?{urlencode(q)}"

        last_err = "boot failed"
        for proxies in (None, _warp_proxies()):
            try:
                r = crequests.get(
                    url,
                    headers=headers,
                    proxies=proxies,
                    impersonate="chrome131",
                    timeout=35,
                )
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, dict) and data.get("meta") is not None:
                        out = {
                            "ok": True,
                            "boot": data,
                            "via": "warp" if proxies else "direct",
                        }
                        with _lock:
                            _cache[key] = (now + CACHE_TTL_MS, out)
                            _inflight_result[key] = out
                        return out
                    last_err = f"boot HTTP {r.status_code} bad json"
                else:
                    last_err = f"boot HTTP {r.status_code}"
            except Exception as e:
                last_err = str(e)
                continue

        out = {"ok": False, "error": last_err}
        with _lock:
            _cache[key] = (now + 15_000, out)
            _inflight_result[key] = out
        return out
    finally:
        with _lock:
            ev2 = _inflight.pop(key, None)
            _inflight_result.pop(key, None)
            if ev2:
                ev2.set()


ALLOWED_FETCH_HOSTS = (
    "mb.vidrift.net",
    "embed.vidrift.net",
    "vidrift.net",
)


def _allowed_fetch_url(raw: str) -> str | None:
    try:
        u = urlparse(raw)
    except Exception:
        return None
    if u.scheme not in ("http", "https"):
        return None
    host = (u.hostname or "").lower()
    if not host:
        return None
    if host in ALLOWED_FETCH_HOSTS or host.endswith(".vidrift.net"):
        return raw
    return None


def _looks_like_media_url(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    if any(path.endswith(ext) for ext in (".mp4", ".m4s", ".ts", ".m4a", ".aac")):
        return True
    if "/api/orion/" in path or "/pl/" in path:
        return True
    return False


def fetch_cdn(
    url: str, req_headers: dict | None = None, method: str = "GET"
) -> tuple[int, dict, bytes]:
    """Chrome JA3 + WARP for Orion CDN. Node/undici and plain SOCKS get CF 403."""
    headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": EMBED,
        "Referer": f"{EMBED}/embed2/play",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
    }
    has_range = False
    if req_headers:
        for k, v in req_headers.items():
            if not v:
                continue
            lk = k.lower()
            if lk in ("host", "connection", "content-length", "accept-encoding"):
                continue
            if lk == "range":
                has_range = True
            headers[k] = v
    # CRITICAL: without Range, curl_cffi buffers the ENTIRE movie into RAM and
    # holds a fetch slot for minutes → fetchFree stays 0 for everyone.
    forced_range = False
    if not has_range and _looks_like_media_url(url):
        headers["Range"] = f"bytes=0-{FETCH_MAX_BODY - 1}"
        has_range = True
        forced_range = True
    last_err = "fetch failed"
    body = b""
    status = 502
    out_headers: dict = {}
    # Range slices should finish quickly; full playlist JSON stays short too.
    timeout = 20 if has_range else 30
    for proxies in (_warp_proxies(), None):
        try:
            r = crequests.request(
                method,
                url,
                headers=headers,
                proxies=proxies,
                impersonate="chrome131",
                timeout=timeout,
                allow_redirects=True,
            )
            status = int(r.status_code or 0)
            body = r.content or b""
            if len(body) > FETCH_MAX_BODY:
                body = body[:FETCH_MAX_BODY]
            out_headers = {
                "content-type": r.headers.get("content-type")
                or "application/octet-stream",
                "cache-control": "no-store",
                "accept-ranges": r.headers.get("accept-ranges") or "bytes",
            }
            if r.headers.get("content-range"):
                out_headers["content-range"] = r.headers.get("content-range")
            elif forced_range and status in (200, 206):
                out_headers["content-range"] = (
                    f"bytes 0-{max(0, len(body) - 1)}/*"
                )
                status = 206
            if forced_range:
                out_headers["x-boot-forced-range"] = "1"
            if status == 403 and b"Just a moment" in body[:2000]:
                last_err = "cf challenge"
                continue
            if status == 403 and body.strip() == b"Forbidden":
                last_err = "forbidden"
                continue
            return status, out_headers, body
        except Exception as e:
            last_err = str(e)
            continue
    return 502, {"content-type": "text/plain; charset=utf-8"}, last_err.encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _json(self, code: int, obj: dict):
        raw = json.dumps(obj).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            _prune_cache()
            freed = _reclaim_stale_fetch_slots()
            with _lock:
                size = len(_cache)
                held = len(_fetch_held)
            return self._json(
                200,
                {
                    "ok": True,
                    "cacheSize": size,
                    "ttlMs": CACHE_TTL_MS,
                    "fetchFree": _fetch_free(),
                    "fetchHeld": held,
                    "fetchConcurrency": FETCH_CONCURRENCY,
                    "reclaimed": freed,
                },
            )
        if u.path == "/fetch":
            if len(_cache) > 2500:
                _prune_cache()
            qs = parse_qs(u.query)
            raw = (qs.get("url") or [""])[0].strip()
            target = _allowed_fetch_url(raw)
            if not target:
                return self._json(400, {"ok": False, "error": "url not allowed"})
            if not _acquire_fetch_slot(timeout=4):
                return self._json(503, {"ok": False, "error": "fetch busy"})
            try:
                req_headers = {}
                if self.headers.get("Range"):
                    req_headers["Range"] = self.headers.get("Range")
                if self.headers.get("Accept"):
                    req_headers["Accept"] = self.headers.get("Accept")
                status, out_headers, body = fetch_cdn(target, req_headers, "GET")
                try:
                    self.send_response(status)
                    for k, v in out_headers.items():
                        if v:
                            self.send_header(k, v)
                    self.send_header("content-length", str(len(body)))
                    self.send_header("access-control-allow-origin", "*")
                    self.end_headers()
                    # Chunked write — large buffers + client abort used to wedge.
                    view = memoryview(body)
                    step = 256 * 1024
                    for i in range(0, len(view), step):
                        self.wfile.write(view[i : i + step])
                except (BrokenPipeError, ConnectionResetError):
                    pass
            finally:
                _release_fetch_slot()
            return
        if u.path != "/boot":
            return self._json(404, {"ok": False, "error": "not found"})
        qs = parse_qs(u.query)
        tmdb = (qs.get("tmdbId") or qs.get("id") or [""])[0].strip()
        media_type = (qs.get("type") or ["movie"])[0].strip().lower()
        if media_type not in ("movie", "tv"):
            media_type = "movie"
        season = int((qs.get("season") or ["1"])[0] or 1)
        episode = int((qs.get("episode") or ["1"])[0] or 1)
        title = (qs.get("title") or [""])[0]
        if not tmdb:
            return self._json(400, {"ok": False, "error": "tmdbId required"})
        result = boot_payload(tmdb, media_type, season, episode, title)
        return self._json(200 if result.get("ok") else 502, result)


def _watchdog_loop():
    while True:
        try:
            n = _reclaim_stale_fetch_slots()
            if n:
                print(f"[sevenmovies-boot] reclaimed {n} stale fetch slot(s)", flush=True)
        except Exception as e:
            print(f"[sevenmovies-boot] watchdog error: {e}", flush=True)
        time.sleep(5)


def main():
    threading.Thread(target=_watchdog_loop, name="fetch-slot-watchdog", daemon=True).start()
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(
        f"[sevenmovies-boot] listening on http://{BIND}:{PORT} "
        f"concurrency={FETCH_CONCURRENCY} warp={'yes' if WARP else 'no'}",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
