# 7Movies stuck on “Starting playback…” (Odyssey / Orion)

## Root cause

1. **Meta works** via `sevenmovies-assist` (`:3027`) → boot helper (`:3887`) over **WARP** (`resolveMode: vps-boot-helper:warp`).
2. Orion CDN (`mb.vidrift.net`) returns **CF 403** to:
   - Contabo DC IP (plain curl/node)
   - WARP + plain TLS (node `https` / curl)
3. Orion **does** return 200 with **`curl_cffi` Chrome JA3 + WARP** (already implemented as `GET /fetch` on `sevenmovies-boot.py`).
4. Playback went through **cinepro `segment-proxy` / Next**, which used plain Node fetch → master m3u8 403 → player hung on **Starting playback…**.

## Fix applied (player host)

- `sevenmovies-assist.mjs`: also expose **BigBang** (`meta.bigbangUrl`) as label `Original` (plays on plain VPS IP).
- `segment-proxy.mjs`: for `*.vidrift.net`
  - decode `?data=` payloads
  - serve/rewrite playlists via `127.0.0.1:3887/fetch`
  - proxy media segments via the same boot fetch

Verified for tmdb `1368337`: Orion master → child playlist → `m4s` segment **206**.

## Files

- `ops/patches/sevenmovies-assist.mjs`
- `ops/patches/segment-proxy-vidrift-bootfetch.diff`
