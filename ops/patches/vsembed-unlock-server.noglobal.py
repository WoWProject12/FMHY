#!/usr/bin/env python3
"""VSEmbed unlock: mint viewer-IP apiToken via XFF, return native playlist URLs."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse, urlencode

from PIL import Image
import numpy as np

HOST = "127.0.0.1"
PORT = 3017
EMBED_HOST = "https://vidsrc.sh"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

import threading
from collections import OrderedDict

# Stampede guard: vidsrc.sh 429s when every viewer unlocks in parallel.
_POS_TTL = float(os.environ.get("VSEMBED_CACHE_TTL", "900"))
_NEG_TTL = float(os.environ.get("VSEMBED_NEG_TTL", "45"))
_MAX_INFLIGHT = int(os.environ.get("VSEMBED_MAX_INFLIGHT", "2"))
_CACHE_MAX = 256
_cache_lock = threading.Lock()
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_neg: dict[str, float] = {}
_global_cooldown_until = 0.0
_inflight = 0
_inflight_cv = threading.Condition(_cache_lock)


def _ck(media_type: str, tmdb_id: str, season: str, episode: str) -> str:
    if media_type == "tv":
        return f"tv:{tmdb_id}:{season}:{episode}"
    return f"movie:{tmdb_id}"


def _cache_get(key: str):
    now = time.time()
    with _cache_lock:
        item = _cache.get(key)
        if not item:
            return None
        exp, val = item
        if exp < now:
            _cache.pop(key, None)
            return None
        _cache.move_to_end(key)
        return val


def _cache_put(key: str, val: dict, ttl: float):
    with _cache_lock:
        _cache[key] = (time.time() + ttl, val)
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


def _neg_active(key: str) -> str | None:
    # Per-title only. A global vs_src pause blocked unlocks that would still
    # succeed for other viewers/titles while one IP/title was 429'd.
    now = time.time()
    with _cache_lock:
        until = _neg.get(key, 0)
        if now < until:
            return f"vs_src negative cache {int(until - now)}s"
    return None


def _neg_put(key: str, code: int):
    # Keep 429 backoff short and title-scoped so other titles keep unlocking.
    ttl = min(20.0, _NEG_TTL) if code == 429 else _NEG_TTL
    with _cache_lock:
        _neg[key] = time.time() + ttl


class _Inflight:
    def __enter__(self):
        global _inflight
        with _inflight_cv:
            while _inflight >= _MAX_INFLIGHT:
                _inflight_cv.wait(timeout=2.0)
                if _inflight >= _MAX_INFLIGHT:
                    raise RuntimeError("vsembed busy (inflight cap)")
            _inflight += 1
        return self

    def __exit__(self, *a):
        global _inflight
        with _inflight_cv:
            _inflight = max(0, _inflight - 1)
            _inflight_cv.notify_all()


def http(url: str, headers: dict | None = None, data: bytes | None = None, timeout: int = 25) -> tuple[int, bytes]:
    """Use curl — Cloudflare blocks Python urllib on data.vidsrc.sh."""
    out = tempfile.NamedTemporaryFile(delete=False, prefix="vsembed-http-")
    out_path = out.name
    out.close()
    try:
        cmd = [
            "curl", "-sS", "-L", "-o", out_path, "-w", "%{http_code}",
            "-A", UA, "--max-time", str(timeout), "--connect-timeout", "10",
        ]
        for k, v in (headers or {}).items():
            cmd += ["-H", f"{k}: {v}"]
        if data is not None:
            cmd += ["--data-binary", "@-"]
            cmd.append(url)
            proc = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout + 5)
        else:
            cmd.append(url)
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
        code_s = (proc.stdout or b"").decode("ascii", "ignore").strip()
        try:
            code = int(code_s) if code_s else 0
        except ValueError:
            code = 0
        body = Path(out_path).read_bytes()
        if proc.returncode != 0 and not body:
            return 0, (proc.stderr or b"curl failed")
        return code, body
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def find_x_ncc(bg: np.ndarray, pc: np.ndarray, y: int) -> tuple[float, int]:
    bg = bg.astype(np.float32)
    pc = pc.astype(np.float32)
    ph, pw = pc.shape[:2]
    mask = pc[:, :, 3] > 128
    if int(mask.sum()) < 30:
        mask = pc[:, :, 3] > 40
    a = pc[:, :, :3][mask].reshape(-1)
    a0 = a - a.mean()
    an = float(np.sqrt((a0 * a0).sum()) + 1e-6)
    best = None
    max_x = bg.shape[1] - pw
    for x in range(0, max_x + 1):
        region = bg[y : y + ph, x : x + pw]
        b = region[:, :, :3][mask].reshape(-1)
        b0 = b - b.mean()
        ncc = float((a0 * b0).sum() / (an * (np.sqrt((b0 * b0).sum()) + 1e-6)))
        if best is None or ncc > best[0]:
            best = (ncc, x)
    return best  # type: ignore


def quality_from_file_name(name: str | None) -> str:
    n = name or ""
    if re.search(r"2160|4\s*k|uhd", n, re.I):
        return "4K"
    if re.search(r"1080", n, re.I):
        return "1080p"
    if re.search(r"720", n, re.I):
        return "720p"
    if re.search(r"480|360", n, re.I):
        return "480p"
    return "Auto"


def decrypt_stream_urls(encrypted: str, wasm_url: str) -> list[str]:
    code, wasm = http(wasm_url)
    if code != 200:
        raise RuntimeError(f"wasm HTTP {code} url={wasm_url} body={wasm[:120]!r}")
    if wasm[:4] != bytes([0, 97, 115, 109]):
        raise RuntimeError(f"wasm magic bad: {wasm[:40]!r} url={wasm_url}")
    td = tempfile.mkdtemp(prefix="vsembed-dec-")
    b64p = os.path.join(td, "enc.b64")
    wasmp = os.path.join(td, "dec.wasm")
    cjsp = os.path.join(td, "dec.cjs")
    Path(b64p).write_text(encrypted)
    Path(wasmp).write_bytes(wasm)
    # Absolute paths inlined; run node with cwd=td
    Path(cjsp).write_text(
        "const fs=require('fs');\n"
        "(async()=>{\n"
        "  const e=fs.readFileSync('enc.b64','utf8');\n"
        "  const w=fs.readFileSync('dec.wasm');\n"
        "  const m=await WebAssembly.compile(w);\n"
        "  const i=await WebAssembly.instantiate(m,{});\n"
        "  const {alloc,decrypt,memory}=i.exports;\n"
        "  const b=Uint8Array.from(Buffer.from(e,'base64'));\n"
        "  const p=alloc(b.length);\n"
        "  new Uint8Array(memory.buffer,p,b.length).set(b);\n"
        "  const n=decrypt(p,b.length);\n"
        "  if(!(n>0)) throw new Error('decrypt returned '+n);\n"
        "  process.stdout.write(new TextDecoder().decode(new Uint8Array(memory.buffer,p+12,n)));\n"
        "})().catch(e=>{console.error(e);process.exit(1)});\n"
    )
    try:
        drop = {"NODE_OPTIONS", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_APP_INSTANCE"}
        env = {k: v for k, v in os.environ.items() if k not in drop}
        proc = subprocess.run(
            ["node", "dec.cjs"],
            cwd=td,
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
        out = proc.stdout or ""
        urls = [u.strip() for u in out.splitlines() if u.strip().startswith("http")]
        if urls:
            return urls
        keep = "/tmp/vsembed-dec-fail"
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(td, keep)
        Path(keep + "/stderr.txt").write_text(proc.stderr or "")
        Path(keep + "/stdout.txt").write_text(out)
        Path(keep + "/meta.txt").write_text(
            "rc=%s\nwasm_url=%s\nenc_len=%s\nwasm_len=%s\n"
            % (proc.returncode, wasm_url, len(encrypted), len(wasm))
        )
        raise RuntimeError(
            "node decrypt rc=%s stderr=%r kept=%s"
            % (proc.returncode, (proc.stderr or "")[:300], keep)
        )
    finally:
        shutil.rmtree(td, ignore_errors=True)


def solve_captcha(origin: str, player: str, xff: dict) -> str:
    for attempt in range(6):
        code, body = http(
            f"{origin}/vs_captcha/public/api.php?action=create&type=slide&_={int(time.time()*1000)}",
            {"Referer": player, "Origin": origin, **xff},
        )
        if code != 200:
            time.sleep(1)
            continue
        ch = json.loads(body)
        if ch.get("locked") or not ch.get("bg"):
            time.sleep(int(ch.get("retry_after") or 2) + 0.5)
            continue
        _, bg_b = http(urljoin(origin, ch["bg"]), {"Referer": player, **xff})
        _, pc_b = http(urljoin(origin, ch["piece"]), {"Referer": player, **xff})
        td = tempfile.mkdtemp(prefix="vsembed-cap-")
        try:
            Path(os.path.join(td, "bg")).write_bytes(bg_b)
            Path(os.path.join(td, "piece")).write_bytes(pc_b)
            bg = np.asarray(Image.open(os.path.join(td, "bg")).convert("RGBA"))
            pc = np.asarray(Image.open(os.path.join(td, "piece")).convert("RGBA"))
            ncc, x = find_x_ncc(bg, pc, int(ch["y"]))
        finally:
            shutil.rmtree(td, ignore_errors=True)
        time.sleep(1.25)
        form = urlencode({"id": ch["id"], "value": f"{x:.2f}", "duration": str(1600 + attempt * 40)}).encode()
        code, body = http(
            f"{origin}/vs_captcha/public/api.php?action=verify",
            {
                "Referer": player,
                "Origin": origin,
                "Content-Type": "application/x-www-form-urlencoded",
                **xff,
            },
            data=form,
        )
        vr = json.loads(body) if body else {}
        if vr.get("success") and vr.get("token"):
            return vr["token"]
        time.sleep(int(vr.get("retry_after") or 2) + 0.3)
    raise RuntimeError("captcha solve failed")


def unlock(media_type: str, tmdb_id: str, season: str, episode: str, viewer_ip: str) -> dict:
    if not re.fullmatch(r"\d+", tmdb_id):
        raise ValueError("invalid tmdb id")
    xff = {"X-Forwarded-For": viewer_ip, "X-Real-IP": viewer_ip}
    if media_type == "tv":
        vs = f"{EMBED_HOST}/vs_src.php?type=tv&id={tmdb_id}&season={max(1,int(season or 1))}&episode={max(1,int(episode or 1))}"
    else:
        vs = f"{EMBED_HOST}/vs_src.php?type=movie&id={tmdb_id}"
    code, body = http(vs, {"Referer": f"{EMBED_HOST}/", "Accept": "application/json", **xff})
    if code != 200:
        raise RuntimeError(f"vs_src HTTP {code}")
    src = json.loads(body).get("src")
    if not src:
        raise RuntimeError("vs_src missing src")
    code, body = http(src, {"Referer": f"{EMBED_HOST}/", **xff})
    if code != 200:
        raise RuntimeError(f"landing HTTP {code}")
    land = body.decode("utf-8", "ignore")
    cfg_m = re.search(r"window\.CFG\s*=\s*(\{.+?\});", land, re.S)
    if not cfg_m:
        raise RuntimeError("landing CFG missing")
    cfg = json.loads(cfg_m.group(1))
    player = urljoin(src, cfg["playerUrl"])
    embed_origin = urlparse(src).scheme + "://" + urlparse(src).netloc
    code, body = http(player, {"Referer": src, **xff})
    if code != 200:
        raise RuntimeError(f"player HTTP {code}")
    html = body.decode("utf-8", "ignore")
    api_token = re.search(r'"apiToken":"([^"]*)"', html)
    api_token_s = api_token.group(1) if api_token else ""
    if not api_token_s:
        ticket_m = re.search(r'"gateTicket":"([^"]+)"', html)
        if not ticket_m:
            raise RuntimeError("apiToken and gateTicket missing")
        captcha_tok = solve_captcha(embed_origin, player, xff)
        form = urlencode(
            {"captcha": "cst", "token": captcha_tok, "gate_ticket": ticket_m.group(1)}
        ).encode()
        code, body = http(
            urljoin(player, "/embed/verify_cst.php"),
            {
                "Referer": player,
                "Origin": embed_origin,
                "Content-Type": "application/x-www-form-urlencoded",
                **xff,
            },
            data=form,
        )
        jt = json.loads(body) if body else {}
        api_token_s = jt.get("apiToken") or ""
        if not api_token_s:
            raise RuntimeError(f"verify_cst failed: {body[:200]!r}")

    stream_url = f"https://data.vidsrc.sh/api.php?type={'tv' if media_type=='tv' else 'movie'}&tmdb={tmdb_id}&stream_urls&api_token={api_token_s}"
    if media_type == "tv":
        stream_url += f"&season={max(1,int(season or 1))}&episode={max(1,int(episode or 1))}"
    code, body = http(
        stream_url,
        {"Referer": player, "Origin": embed_origin, "Accept": "application/json", **xff},
    )
    if code != 200:
        raise RuntimeError(f"stream_urls HTTP {code}: {body[:160]!r}")
    payload = json.loads(body)
    if str(payload.get("status_code")) == "403":
        raise RuntimeError(payload.get("error") or "stream_urls 403")
    surls = payload.get("data", {}).get("stream_urls")
    file_name = payload.get("data", {}).get("file_name")
    if isinstance(surls, list):
        urls = [u for u in surls if u]
    elif isinstance(surls, str) and surls:
        wasm = (payload.get("vs") or {}).get("wasm_url")
        if not wasm:
            raise RuntimeError("wasm_url missing")
        urls = decrypt_stream_urls(surls, wasm)
    else:
        raise RuntimeError("no stream_urls")
    if not urls:
        raise RuntimeError("decrypted empty")
    quality = quality_from_file_name(file_name)
    return {
        "ok": True,
        "apiToken": api_token_s,
        "referer": f"{embed_origin}/",
        "origin": embed_origin,
        "playerUrl": player,
        "fileName": file_name,
        "viewerIp": viewer_ip,
        "streams": [{"url": u, "quality": quality, "fileName": file_name} for u in urls],
        "headers": {
            "Referer": f"{embed_origin}/",
            "Origin": embed_origin,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    xff = handler.headers.get("X-Forwarded-For") or ""
    if xff:
        ip = xff.split(",")[0].strip()
        if ip:
            return ip
    real = (handler.headers.get("X-Real-IP") or "").strip()
    if real:
        return real
    return handler.client_address[0]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[vsembed-unlock]", self.address_string(), fmt % args)

    def _cors(self):
        # CORS is applied by nginx in front; avoid duplicate ACAO headers.
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, obj: dict):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def _handle(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.rstrip("/") not in ("/unlock", "/api/vsembed/unlock", ""):
                if parsed.path in ("/health", "/healthz"):
                    return self._json(200, {"ok": True})
                return self._json(404, {"ok": False, "error": "not found"})
            qs = parse_qs(parsed.query)
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length > 0 else b""
            if body:
                try:
                    posted = json.loads(body.decode())
                    for k, v in posted.items():
                        qs.setdefault(k, [str(v)])
                except Exception:
                    pass
            media_type = (qs.get("type") or ["movie"])[0]
            tmdb_id = (qs.get("tmdbId") or qs.get("id") or [""])[0]
            season = (qs.get("season") or ["1"])[0]
            episode = (qs.get("episode") or ["1"])[0]
            viewer = client_ip(self)
            if not tmdb_id:
                return self._json(400, {"ok": False, "error": "tmdbId required"})
            key = _ck(media_type, tmdb_id, season, episode)
            cached = _cache_get(key)
            if cached:
                out = dict(cached)
                out["via"] = "cache"
                out["viewerIp"] = viewer
                return self._json(200, out)
            neg = _neg_active(key)
            if neg:
                return self._json(429, {"ok": False, "error": neg, "streams": [], "via": "cooldown"})
            t0 = time.time()
            try:
                with _Inflight():
                    result = unlock(media_type, tmdb_id, season, episode, viewer)
            except RuntimeError as e:
                msg = str(e)
                code = 429 if ("429" in msg or "busy" in msg or "cooldown" in msg) else 500
                if "429" in msg:
                    _neg_put(key, 429)
                traceback.print_exc()
                return self._json(code, {"ok": False, "error": msg, "streams": []})
            result["ms"] = int((time.time() - t0) * 1000)
            result["via"] = "live"
            # Cache streams without binding to one viewer IP token forever —
            # apiToken is IP-minted; still useful briefly for same CDN edge bursts.
            _cache_put(key, {k: v for k, v in result.items() if k != "viewerIp"}, _POS_TTL)
            return self._json(200, result)
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": str(e), "streams": []})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[vsembed-unlock] listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
