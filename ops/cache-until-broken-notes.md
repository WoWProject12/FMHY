# Cache-until-broken + 7Movies Chrome play (2026-11-15)

Live on player host `chillflix.pw` (`.next-embed27`, `chillflix-player`).

## Problem
- **7Movies** resolved but often failed to play in Chrome: Orion **Original** is HEVC-only (`hvc1`), so MSE ends with 0 levels.
- **VAPlayer** reminted on every cache miss / soft-TTL expiry → upstream **429** under concurrent viewers.
- Same class of waste for 7Movies boot hits.

## Fix

### 7Movies play
- `/api/7movies/client-meta` probes HLS masters for codec, sorts **MP4 / AVC first**, demotes HEVC.
- Client resolver prefers assist meta, demotes HEVC Original when the browser cannot play HEVC.
- For Obsession (`1339713`): first playable row is Hindi MP4 (AVC); Original/French HEVC stay listed for HEVC-capable browsers.

### Cache-until-broken
**VAPlayer** (`/api/playback/vaplayer-resolve`):
- Serve disk cache while CDN JWT is still valid (not only within soft TTL).
- Soft-validate playlist (`#EXTM3U`); remint only when dead/expired.
- Singleflight unlock (already present); on unlock failure/429, fall back to token-alive cache.

**7Movies** (`/api/7movies/client-meta`):
- In-memory cache (~20 min) + singleflight.
- Soft-validate first stream; remint only when unreachable.
- `?refresh=1` forces remint.

## Patch files
- `ops/patches/7movies-client-resolver.ts`
- `ops/patches/client-meta-route.ts`
- `ops/patches/vaplayer-resolve-route.ts`

## Verify
```bash
curl -s 'http://127.0.0.1:3002/api/7movies/client-meta?type=movie&tmdbId=1339713'
# MP4 first, codec tags, cached:true on second hit

curl -s -H 'Origin: https://chillflix.pw' -H 'Referer: https://chillflix.pw/movie/1339713' \
  'http://127.0.0.1:3002/api/playback/vaplayer-resolve?type=movie&tmdbId=1339713'
# via: cache | cache-reuse
```
