#!/usr/bin/env python3
"""VAPlayer unlock: captcha -> apiToken -> stream_urls (wasm) -> CDN host token.
Prints JSON {ok, streams, fileName, title, referer, via} to stdout.
"""
from __future__ import annotations

import argparse
import fcntl
import base64
import hashlib
import http.cookiejar
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageFilter
import numpy as np

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
IFRAME_ORIGIN = "https://nextgencloudfabric.com"
VAPLAYER = "https://vaplayer.ru"
STREAMDATA = "https://streamdata.vaplayer.ru/api.php"
CACHE_DIR = Path(os.environ.get("VAPLAYER_UNLOCK_CACHE", "/var/www/chillflix.pw/data/vaplayer-unlock-cache"))
CACHE_TTL = int(os.environ.get("VAPLAYER_UNLOCK_CACHE_TTL", "14400"))  # ~CDN token lifetime
WASM_DECRYPT = Path("/var/www/chillflix.pw/scripts/vaplayer-wasm-decrypt.mjs")

UNLOCK_LOCK = Path(os.environ.get("VAPLAYER_UNLOCK_LOCK", "/var/www/chillflix.pw/data/vaplayer-unlock.lock"))


def with_unlock_mutex():
    """Serialize captcha/unlock work across concurrent resolve workers."""
    UNLOCK_LOCK.parent.mkdir(parents=True, exist_ok=True)
    fh = open(UNLOCK_LOCK, "a+")
    deadline = time.time() + float(os.environ.get("VAPLAYER_UNLOCK_LOCK_WAIT", "25"))
    while True:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fh
        except BlockingIOError:
            if time.time() >= deadline:
                fh.close()
                raise TimeoutError("vaplayer unlock busy (lock timeout)")
            time.sleep(0.35)



def fail(msg: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": msg, "streams": []}))
    sys.exit(code)


def fetch(op, url, headers=None, data=None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    try:
        with op.open(req, timeout=30) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        # Surface 429 clearly for retry logic / logs.
        raise RuntimeError(f"HTTP Error {e.code}: {e.reason}") from e


def cache_key(media_type: str, tmdb: str, season: int | None, episode: int | None) -> str:
    raw = f"{media_type}:{tmdb}:{season or ''}:{episode or ''}"
    return hashlib.sha1(raw.encode()).hexdigest()


def _stream_needs_cdn_token(url: str) -> bool:
    try:
        parts = urllib.parse.urlparse(url)
        host = (parts.hostname or "").lower()
        path_q = f"{parts.path}?{parts.query}"
        if host.endswith("stellarconductornexus.com"):
            return True
        if host.endswith(".site") and "/pl/" in path_q:
            return True
        if re.search(
            r"(?:^|\.)(strategicgrowthpartners|influencerstrategygroup|nicheauthorityengine|remoteconsultinggroup|boldvisionstrategy|onlinecoachingacademy|onlinecoursecreator|scalablecontentengine|modernconsultinglab)\.site$",
            host,
        ):
            return True
    except Exception:
        return bool(re.search(r"\.site/.*/pl/", url, re.I))
    return False


def _streams_token_alive(streams, skew: int = 90) -> bool:
    """CDN host JWTs die ~4h after mint; never serve dead tokens from cache."""
    now = time.time()
    saw_token = False
    needs_token = False
    for u in streams or []:
        url = str(u)
        if _stream_needs_cdn_token(url):
            needs_token = True
        m = re.search(r"[?&]token=([^&]+)", url)
        if not m:
            continue
        saw_token = True
        tok = urllib.parse.unquote(m.group(1))
        parts = tok.split(".")
        if len(parts) < 2:
            return False
        try:
            pad = "=" * (-len(parts[1]) % 4)
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad).decode())
            exp = float(payload.get("exp") or 0)
            if exp and exp <= now + skew:
                return False
        except Exception:
            return False
    # Bare .site/pl URLs without JWT must not be treated as warm cache hits.
    if needs_token and not saw_token:
        return False
    return True


def read_cache(key: str, allow_stale: bool = False, stale_grace: int = 7200):
    p = CACHE_DIR / f"{key}.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        age = time.time() - float(data.get("_ts", 0))
        if age > CACHE_TTL and not allow_stale:
            return None
        if age > CACHE_TTL + stale_grace:
            return None
        if data.get("ok") and data.get("streams"):
            if not _streams_token_alive(data.get("streams")):
                return None
            if age > CACHE_TTL:
                data = dict(data)
                data["via"] = "cache-stale"
            return data
    except Exception:
        return None
    return None


def write_cache(key: str, data: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["_ts"] = time.time()
    (CACHE_DIR / f"{key}.json").write_text(json.dumps(data))


def embed_path(media_type: str, tmdb: str, season: int, episode: int) -> str:
    if media_type == "tv":
        return f"/embed/tv/{tmdb}/{season}/{episode}"
    return f"/embed/movie/{tmdb}"


def get_src(op, path: str) -> str:
    url = f"{VAPLAYER}/embed/va_src.php?path={urllib.parse.quote(path, safe='')}"
    _, body, _ = fetch(
        op,
        url,
        {
            "Accept": "application/json",
            "Referer": f"{VAPLAYER}{path}",
            "Origin": VAPLAYER,
        },
    )
    data = json.loads(body.decode())
    src = data.get("src")
    if not src:
        raise RuntimeError(data.get("error") or "va_src empty")
    return src


def create_captcha(op, src: str) -> dict:
    fetch(op, src, {"Referer": f"{VAPLAYER}/"})
    _, body, _ = fetch(
        op,
        f"{IFRAME_ORIGIN}/embed/captcha/api.php?action=create&type=slide&_={int(time.time()*1000)}",
        {"Referer": src, "Accept": "application/json"},
    )
    try:
        data = json.loads(body.decode())
    except Exception as e:
        raise RuntimeError(f"captcha create bad json: {e}") from e
    if not isinstance(data, dict):
        raise RuntimeError(f"captcha create bad payload: {body[:120]!r}")
    # Rate-limit / soft failures return error objects without bg/piece.
    if data.get("error") or data.get("locked") or not data.get("bg") or not data.get("piece"):
        raise RuntimeError(f"captcha create incomplete: {data}")
    return data


def find_x(op, cr: dict, src: str) -> int:
    bg_path = cr.get("bg")
    piece_path = cr.get("piece")
    if not bg_path or not piece_path:
        raise RuntimeError(f"captcha missing bg/piece: {list(cr.keys())}")
    _, bg_b, _ = fetch(op, IFRAME_ORIGIN + str(bg_path), {"Referer": src})
    _, pc_b, _ = fetch(op, IFRAME_ORIGIN + str(piece_path), {"Referer": src})
    bg = Image.open(BytesIO(bg_b)).convert("RGB")
    piece = Image.open(BytesIO(pc_b)).convert("RGBA")
    y = int(cr["y"])
    box = int(cr["box"])
    width = int(cr["width"])
    bg_a = np.asarray(bg).astype(np.float32)
    pc = np.asarray(piece)
    alpha = pc[:, :, 3] > 128
    edges = np.asarray(bg.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32)
    ay = np.zeros_like(alpha, dtype=bool)
    ay[:, 1:] |= alpha[:, 1:] != alpha[:, :-1]
    ay[1:, :] |= alpha[1:, :] != alpha[:-1, :]
    best_x, best = 0, -1.0
    for x in range(0, width - box + 1):
        win = edges[y : y + box, x : x + box]
        score = float(win[ay].mean()) if ay.any() else 0.0
        dark = float(255 - bg_a[y : y + box, x : x + box].mean(axis=2)[alpha].mean())
        score = score + dark * 0.25
        if score > best:
            best = score
            best_x = x
    return best_x


def solve_captcha(op, src: str | None = None) -> tuple[str, str]:
    last_err = "captcha failed"
    for _ in range(10):
        try:
            src = src or get_src(op, "/embed/movie/0")  # placeholder overwritten by caller
        except Exception:
            pass
        if not src:
            raise RuntimeError("missing src")
        try:
            cr = create_captcha(op, src)
            x = find_x(op, cr, src)
        except Exception as e:
            last_err = str(e)
            time.sleep(0.6)
            continue
        time.sleep(1.15)
        body = urllib.parse.urlencode(
            {"id": cr["id"], "value": f"{x:.2f}", "duration": 1700}
        ).encode()
        _, raw, _ = fetch(
            op,
            f"{IFRAME_ORIGIN}/embed/captcha/api.php?action=verify",
            {
                "Referer": src,
                "Origin": IFRAME_ORIGIN,
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data=body,
        )
        j = json.loads(raw.decode())
        if j.get("error") == "locked":
            time.sleep(int(j.get("retry_after") or 3) + 1)
            continue
        if j.get("success") and j.get("token"):
            return src, j["token"]
        last_err = str(j)
    raise RuntimeError(last_err)


def redeem_pass(op, src: str, token: str) -> str:
    body = urllib.parse.urlencode({"token": token}).encode()
    _, raw, _ = fetch(
        op,
        f"{IFRAME_ORIGIN}/embed/captcha/verify.php",
        {
            "Referer": src,
            "Origin": IFRAME_ORIGIN,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data=body,
    )
    j = json.loads(raw.decode())
    if not (j.get("success") and j.get("pass")):
        raise RuntimeError(f"redeem failed: {j}")
    return j["pass"]


def load_player_config(op, src: str, cst: str) -> tuple[str, dict]:
    u = urllib.parse.urlparse(src)
    q = urllib.parse.parse_qs(u.query)
    q["_cst"] = [cst]
    play = urllib.parse.urlunparse(
        (
            u.scheme,
            u.netloc,
            u.path,
            u.params,
            urllib.parse.urlencode([(k, v) for k, vals in q.items() for v in vals]),
            "",
        )
    )
    _, raw, _ = fetch(op, play, {"Referer": f"{VAPLAYER}/embed/"})
    html = raw.decode("utf-8", "replace")
    m = re.search(r"CONFIG\s*=\s*(\{.*?\});", html, re.S)
    if not m:
        raise RuntimeError("player CONFIG missing (captcha again?)")
    cfg = json.loads(m.group(1))
    if not cfg.get("apiToken"):
        raise RuntimeError("apiToken missing")
    return play, cfg


def decrypt_streams(enc_b64: str, wasm_url: str) -> list[str]:
    _, wasm, _ = fetch(
        urllib.request.build_opener(),
        wasm_url,
        {"Referer": IFRAME_ORIGIN + "/", "Accept": "*/*", "User-Agent": UA},
    )
    wasm_path = Path("/tmp") / f"va-{os.getpid()}.wasm"
    wasm_path.write_bytes(wasm)
    try:
        out = subprocess.check_output(
            ["node", str(WASM_DECRYPT), str(wasm_path), enc_b64],
            text=True,
            timeout=20,
        )
    finally:
        try:
            wasm_path.unlink()
        except Exception:
            pass
    urls = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("http")]
    if not urls:
        raise RuntimeError("wasm decrypt produced no urls")
    return urls


def host_token(op, origin: str, api_token: str) -> str:
    _, raw, _ = fetch(
        op,
        f"{origin}/generate.php?api_token={urllib.parse.quote(api_token)}",
        {
            "Referer": IFRAME_ORIGIN + "/",
            "Origin": IFRAME_ORIGIN,
            "Accept": "*/*",
        },
    )
    tok = raw.decode().strip()
    if not tok or tok.startswith("<") or "invalid" in tok.lower():
        raise RuntimeError(f"generate.php failed: {tok[:120]}")
    return tok


def with_token(url: str, token: str) -> str:
    if "token=" in url:
        return url
    return url + ("&" if "?" in url else "?") + "token=" + urllib.parse.quote(token)


def _is_rate_limited(err: BaseException) -> bool:
    s = str(err)
    return ("429" in s) or ("Too Many Requests" in s)


def unlock(media_type: str, tmdb: str, season: int, episode: int, force: bool = False) -> dict:
    key = cache_key(media_type, tmdb, season if media_type == "tv" else None, episode if media_type == "tv" else None)
    if not force:
        cached = read_cache(key)
        if cached:
            cached["via"] = "cache"
            return cached

    lock_fh = with_unlock_mutex()
    try:
        # Re-check after waiting — another worker may have filled cache.
        if not force:
            cached = read_cache(key)
            if cached:
                cached["via"] = "cache"
                return cached
        attempts = max(1, int(os.environ.get("VAPLAYER_UNLOCK_429_RETRIES", "4")))
        last_err: BaseException | None = None
        for i in range(attempts):
            try:
                return _unlock_uncached(media_type, tmdb, season, episode, key)
            except Exception as e:
                last_err = e
                # Upstream rate-limit: wait and retry while holding the mutex so
                # we do not stampede captcha slots. Live resolve soft-times out
                # and polls; rotator backs off separately.
                if _is_rate_limited(e) and i + 1 < attempts:
                    delay = min(40.0, 5.0 * (2 ** i)) + random.uniform(0.4, 1.8)
                    time.sleep(delay)
                    continue
                stale = read_cache(key, allow_stale=True)
                if stale:
                    stale["via"] = "cache-stale"
                    stale["warning"] = str(e)[:160]
                    return stale
                raise
        if last_err:
            raise last_err
        raise RuntimeError("vaplayer unlock failed")
    finally:
        try:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
        finally:
            lock_fh.close()


def _unlock_uncached(media_type: str, tmdb: str, season: int, episode: int, key: str) -> dict:
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    path = embed_path(media_type, tmdb, season, episode)
    src = get_src(op, path)
    src, token = solve_captcha(op, src)
    cst = redeem_pass(op, src, token)
    play, cfg = load_player_config(op, src, cst)
    api_token = cfg["apiToken"]

    api = cfg.get("streamDataApiUrl") or STREAMDATA
    q = {"type": media_type, "stream_urls": ""}
    if cfg.get("idType") == "imdb":
        q["imdb"] = str(cfg.get("mediaId") or tmdb)
    else:
        q["tmdb"] = str(cfg.get("mediaId") or tmdb)
    if media_type == "tv":
        q["season"] = str(season)
        q["episode"] = str(episode)
    # build query with bare &stream_urls flag
    qs = urllib.parse.urlencode({k: v for k, v in q.items() if k != "stream_urls"})
    sd_url = f"{api}?{qs}&stream_urls&api_token={urllib.parse.quote(api_token)}"
    _, raw, _ = fetch(
        op,
        sd_url,
        {
            "Accept": "application/json",
            "Referer": play,
            "Origin": IFRAME_ORIGIN,
        },
    )
    payload = json.loads(raw.decode())
    if str(payload.get("status_code")) != "200" or not payload.get("data"):
        raise RuntimeError(f"streamdata failed: {payload}")
    data = payload["data"]
    su = data.get("stream_urls")
    if isinstance(su, list):
        urls = [str(u).strip() for u in su if str(u).strip().startswith("http")]
    elif isinstance(su, str) and su:
        va = payload.get("va") or payload.get("vp") or {}
        wasm_url = va.get("wasm_url")
        if not wasm_url:
            raise RuntimeError("encrypted stream_urls without wasm_url")
        urls = decrypt_streams(su, wasm_url)
    else:
        raise RuntimeError("no stream_urls in streamdata response")

    # stamp host tokens per origin
    by_origin: dict[str, str] = {}
    stamped: list[str] = []
    for u in urls:
        if "tmstrd.justhd.tv" in u:
            continue
        origin = f"{urllib.parse.urlparse(u).scheme}://{urllib.parse.urlparse(u).netloc}"
        if origin not in by_origin:
            by_origin[origin] = host_token(op, origin, api_token)
        stamped.append(with_token(u, by_origin[origin]))
    if not stamped:
        raise RuntimeError("no usable streams after host token")

    out = {
        "ok": True,
        "streams": stamped,
        "fileName": data.get("file_name") if isinstance(data.get("file_name"), str) else None,
        "title": data.get("title") if isinstance(data.get("title"), str) else None,
        "referer": f"{IFRAME_ORIGIN}/",
        "via": "unlock",
        "matchedAs": f"tmdb:{media_type}:{tmdb}",
        # Rotator uses these to remint before CDN JWT expiry.
        "mediaType": media_type,
        "tmdbId": str(tmdb),
        "season": int(season) if media_type == "tv" else None,
        "episode": int(episode) if media_type == "tv" else None,
    }
    write_cache(key, out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["movie", "tv"], required=True)
    ap.add_argument("--tmdb", required=True)
    ap.add_argument("--season", type=int, default=1)
    ap.add_argument("--episode", type=int, default=1)
    ap.add_argument("--force", action="store_true", help="Ignore disk cache and remint")
    args = ap.parse_args()
    if not re.fullmatch(r"\d+", args.tmdb):
        fail("invalid tmdb")
    try:
        result = unlock(args.type, args.tmdb, max(1, args.season), max(1, args.episode), force=bool(args.force))
        print(json.dumps(result))
    except Exception as e:
        fail(str(e))


if __name__ == "__main__":
    main()
