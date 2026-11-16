# RiveStream dead on Chillflix.pw player (2026-11-16)

## Symptom
Sources sheet showed Rive with diagnostics like:

`Rive: valiant: Internal Server Error · oberon: Internal Server Error · sentinel: Internal Server Error`

No Rive URL mounted; player never played Rivestream on chillflix.pw.

## Root cause
1. Upstream `scrapper.rivestream.app` backends **valiant / oberon / sentinel** currently return
   `{"error":"Internal Server Error"}` (HTTP 200 body error).
2. **Citadel** (and Pulse) still return real HLS — Citadel ships **hscow/fcxmb** media playlists
   whose segments are named `*.jpg` but are **MPEG-TS** (`0x47…`, `Content-Type: image/jpeg`).
3. Our `probeHlsMaster` treated “almost all segment URIs end in `.jpg`” as a **JPEG slideshow**
   decoy and rejected the playlist **without reading bytes**. Every Citadel candidate failed the
   probe → race finished with no winner → empty result whose first errors were the ISE backends.

So Rivestream “didn’t play” on our player because we threw away the only live sources.

## Fix (live `/var/www/cinepro`)
File: `src/providers/rivestream/rivestream.ts` (+ emitted `dist/.../rivestream.js`)

- Before rejecting `jpeg-slideshow`, `segmentLooksLive()` the first `*.jpg` URI.
  - Real image bytes → still reject.
  - MPEG-TS / fMP4 → **accept** as a single-variant playable playlist (hscow disguise).
- Reorder `PREFERRED` to try **citadel / pulse** before the currently-broken ISE backends.

Verified:

```bash
curl -sS 'http://127.0.0.1:3001/v1/movies/786892/provider/rivestream'
# → 1 source, quality "720p · English", proxied img1.hscow.com …/720/index_287.m3u8

# After chillflix-player restart (clears 1h in-memory sources cache):
curl -sS -H 'Host: www.chillflix.pw' \
  'http://127.0.0.1/api/cinepro/sources?type=movie&tmdbId=786892&fresh=true'
# → total 2: rivestream + cineverse (no Rive ISE diagnostic)
```

Note: `fresh=1` (not `fresh=true`) is what the Next route treats as cache-bust
(`searchParams.get("fresh") === "1"`). Stale hour-long hits can still show the old
Rive ISE until the player process cache expires or restarts.

Patch mirror in repo: `ops/patches/rivestream.ts`.
