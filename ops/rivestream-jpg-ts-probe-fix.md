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

## Languages + quality ladder (follow-up)
Provider previously kept **only the first** playable URL (`break` after one probe) and
the race resolved to a **single** source — so Hindi/Tamil/Telugu and 480p never reached
the Chillflix player.

Now the winning subprovider (usually Citadel) returns **all** probed rows (e.g. Furiosa:
`720p/480p × English/Hindi/Tamil/Telugu`) with `audioTracks` language labels.

**Why max 720p on Furiosa?** Upstream Citadel only lists 720p and 480p for that TMDB id —
there is no 1080p/4K row from that backend (sibling `/1080/` `/2160/` paths 403). Other Rive
backends were empty/ISE/decoy for this title when checked. Use **Cine4K** (or another 4K
source) for UHD — Rivestream cannot invent rungs Citadel does not publish.

## Quality sheet vs Languages (follow-up)
Labels like `720p · Hindi` were treated as **heights only** by
`collapseSourcesByProvider` (`qualityHeight > 0` ⇒ not a language). The settings sheet
then showed only **720p HD / 480p SD** and **no Languages column**.

Reshape for the player:
- English → pure heights (`720p`, `480p`) → **Quality**
- Dubs → pure language names (`Hindi`, `Tamil`, `Telugu`) → **Languages**
- Also merge other Rive backends for ~4.5s after the first hit so a late 1080p (e.g. valiant)
  can join when Citadel is only 720p.
