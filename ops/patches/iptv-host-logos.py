#!/usr/bin/env python3
"""Download IPTV logos to local assets and rewrite logo map to same-origin paths."""
import json, os, re, time, hashlib, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

ROOTS = [
  Path("/var/www/chillflix-lol-toflix/public/new"),
  Path("/var/www/chillflix/web/public/new"),
]
MAP_PATHS = [
  Path("/var/www/chillflix-lol-toflix/public/new/assets/data/iptv-tvg-logos.json"),
  Path("/var/www/chillflix/web/public/new/assets/data/iptv-tvg-logos.json"),
  Path("/var/www/chillflix/app/public/iptv-tvg-logos.json"),
]
LOG_DIR = Path("/var/www/chillflix/data/iptv-logo-host")
LOG_DIR.mkdir(parents=True, exist_ok=True)
OUT_REL = "assets/img/iptv-logos"
UA = {"User-Agent": "Mozilla/5.0 ChillflixLogoHost/1.0", "Accept": "image/*,*/*;q=0.8", "Referer": "https://www.chillflix.lol/"}

primary = ROOTS[0] / OUT_REL
primary.mkdir(parents=True, exist_ok=True)

m = json.loads(MAP_PATHS[0].read_text())
url_set = set()
for u in list(m.get("tvg", {}).values()) + list(m.get("brand", {}).values()):
  u = str(u or "").strip()
  if u.startswith("http"):
    url_set.add(u)

EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
}

def key_for(url: str) -> str:
  return hashlib.sha1(url.encode()).hexdigest()[:20]

def detect_ext(url: str, ctype: str, data: bytes) -> str:
  ctype = (ctype or "").split(";")[0].strip().lower()
  if ctype in EXT:
    return EXT[ctype]
  path = urlparse(url).path.lower()
  for e in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
    if path.endswith(e):
      return ".jpg" if e == ".jpeg" else e
  if data[:8] == b"\x89PNG\r\n\x1a\n":
    return ".png"
  if data[:3] == b"\xff\xd8\xff":
    return ".jpg"
  if data[:4] == b"RIFF" and len(data) > 12 and data[8:12] == b"WEBP":
    return ".webp"
  if b"<svg" in data[:300].lower():
    return ".svg"
  return ".bin"

def fetch(url: str):
  k = key_for(url)
  existing = list(primary.glob(k + ".*"))
  if existing:
    return url, True, existing[0].name, "cached"
  try:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
      data = r.read()
      ctype = r.headers.get("Content-Type", "")
    if len(data) < 64 or len(data) > 3_000_000:
      return url, False, "", f"bad size {len(data)}"
    magic_ok = (
      data[:8] == b"\x89PNG\r\n\x1a\n"
      or data[:3] == b"\xff\xd8\xff"
      or (data[:4] == b"RIFF" and len(data) > 12 and data[8:12] == b"WEBP")
      or b"<svg" in data[:300].lower()
    )
    if not ((ctype or "").startswith("image/") or magic_ok):
      return url, False, "", f"not image {ctype}"
    ext = detect_ext(url, ctype, data)
    name = k + ext
    (primary / name).write_bytes(data)
    return url, True, name, "downloaded"
  except Exception as e:
    return url, False, "", type(e).__name__ + ":" + str(e)[:120]

urls = sorted(url_set)
print(f"downloading {len(urls)} unique logos -> {primary}", flush=True)
ok = fail = 0
mapping = {}
fails = []
t0 = time.time()
with ThreadPoolExecutor(max_workers=10) as ex:
  futs = [ex.submit(fetch, u) for u in urls]
  done = 0
  for fut in as_completed(futs):
    url, success, name, note = fut.result()
    done += 1
    if success:
      ok += 1
      mapping[url] = "/" + OUT_REL + "/" + name
    else:
      fail += 1
      fails.append({"url": url, "err": note})
    if done % 100 == 0 or done == len(urls):
      print(f"  {done}/{len(urls)} ok={ok} fail={fail} {time.time()-t0:.0f}s", flush=True)

for root in ROOTS[1:]:
  dest = root / OUT_REL
  dest.mkdir(parents=True, exist_ok=True)
  os.system(f"cp -a {primary}/. {dest}/")

def rewrite(obj):
  out = dict(obj)
  out["tvg"] = {k: mapping.get(v, v) for k, v in (obj.get("tvg") or {}).items()}
  out["brand"] = {k: mapping.get(v, v) for k, v in (obj.get("brand") or {}).items()}
  out["hosted"] = True
  out["hostedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
  out["hostedOk"] = ok
  out["hostedFail"] = fail
  return out

new_map = rewrite(m)
for p in MAP_PATHS:
  p.parent.mkdir(parents=True, exist_ok=True)
  p.write_text(json.dumps(new_map, ensure_ascii=False, separators=(",", ":")))
  print("wrote", p, flush=True)

(LOG_DIR / "host-fail.json").write_text(json.dumps(fails[:300], indent=2))
nbytes = sum(f.stat().st_size for f in primary.glob("*") if f.is_file())
(LOG_DIR / "host-summary.json").write_text(json.dumps({
  "ok": ok, "fail": fail, "unique": len(urls), "seconds": round(time.time()-t0,1),
  "bytes": nbytes, "files": len([f for f in primary.glob("*") if f.is_file()]),
}, indent=2))
print("DONE", ok, fail, "bytes", nbytes, flush=True)
