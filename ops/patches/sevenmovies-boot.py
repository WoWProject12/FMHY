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
WARP = (__import__("os").environ.get("SEVENMOVIES_SOCKS") or __import__("os").environ.get("WARP_SOCKS") or "").strip()

_cache: dict[str, tuple[float, dict]] = {}
_fetch_sem = threading.Semaphore(int(__import__("os").environ.get("SEVENMOVIES_FETCH_CONCURRENCY", "6")))
_fetch_inflight = 0
_lock = threading.Lock()
_inflight: dict[str, threading.Event] = {}
_inflight_result: dict[str, dict] = {}


def _proxies():
    if not WARP:
        return None
    # Prefer direct chrome JA3; WARP only as fallback inside fetch
    return None


def _warp_proxies():
    if not WARP:
        return None
    u = WARP.replace("socks5h://", "socks5://")
    if u.startswith("socks5://") and "socks5h" not in WARP:
        # curl_cffi wants socks5h for DNS through proxy ideally
        u = WARP if "://" in WARP else f"socks5h://{WARP}"
    if u.startswith("socks5://"):
        u = "socks5h://" + u[len("socks5://") :]
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


def boot_payload(tmdb_id: str, media_type: str, season: int, episode: int, title: str) -> dict:
    key = f"{media_type}:{tmdb_id}:{season}:{episode}"
    now = time.time() * 1000
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            body = dict(hit[1])
            body["_cache"] = "hit"
            return body
        if key in _inflight:
            ev = _inflight[key]
        else:
            ev = None

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
            # short negative cache so stampedes don't hammer CF
            _cache[key] = (now + 15_000, out)
            _inflight_result[key] = out
        return out
    finally:
        with _lock:
            ev = _inflight.pop(key, None)
            _inflight_result.pop(key, None)
            if ev:
                ev.set()



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


def fetch_cdn(url: str, req_headers: dict | None = None, method: str = "GET") -> tuple[int, dict, bytes]:
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
    if req_headers:
        for k, v in req_headers.items():
            if not v:
                continue
            lk = k.lower()
            if lk in ("host", "connection", "content-length", "accept-encoding"):
                continue
            headers[k] = v
    last_err = "fetch failed"
    body = b""
    status = 502
    out_headers: dict = {}
    for proxies in (_warp_proxies(), None):
        try:
            r = crequests.request(
                method,
                url,
                headers=headers,
                proxies=proxies,
                impersonate="chrome131",
                timeout=45,
                allow_redirects=True,
            )
            status = int(r.status_code or 0)
            body = r.content or b""
            out_headers = {
                "content-type": r.headers.get("content-type") or "application/octet-stream",
                "cache-control": "no-store",
            }
            if r.headers.get("content-range"):
                out_headers["content-range"] = r.headers.get("content-range")
            if r.headers.get("accept-ranges"):
                out_headers["accept-ranges"] = r.headers.get("accept-ranges")
            # CF challenge HTML
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
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            _prune_cache()
            with _lock:
                size = len(_cache)
            free = getattr(_fetch_sem, "_value", None)
            return self._json(200, {"ok": True, "cacheSize": size, "ttlMs": CACHE_TTL_MS, "fetchFree": free})
        if u.path == "/fetch":
            if len(_cache) > 2500:
                _prune_cache()
            qs = parse_qs(u.query)
            raw = (qs.get("url") or [""])[0].strip()
            target = _allowed_fetch_url(raw)
            if not target:
                return self._json(400, {"ok": False, "error": "url not allowed"})
            # Cap concurrency — always release even on BrokenPipe during write.
            if not _fetch_sem.acquire(timeout=4):
                return self._json(503, {"ok": False, "error": "fetch busy"})
            try:
                req_headers = {}
                if self.headers.get("Range"):
                    req_headers["Range"] = self.headers.get("Range")
                if self.headers.get("Accept"):
                    req_headers["Accept"] = self.headers.get("Accept")
                status, out_headers, body = fetch_cdn(target, req_headers, "GET")
                self.send_response(status)
                for k, v in out_headers.items():
                    if v:
                        self.send_header(k, v)
                self.send_header("content-length", str(len(body)))
                self.send_header("access-control-allow-origin", "*")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                _fetch_sem.release()
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


def main():
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"[sevenmovies-boot] listening on http://{BIND}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
