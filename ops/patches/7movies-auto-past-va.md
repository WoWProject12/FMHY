# Auto past unready VAPlayer → 7Movies

## Problem
For titles where VAPlayer resolve returns CDN URLs quickly (e.g. Amazing Spider-Man 2 / tmdb `102382`) but those URLs never become probe-ready, Auto treated “URLs survived settle” as first-win and **stopped the Sources walk**. The overlay stayed on “Checking VAPlayer” and never reached **7Movies**, even though `/api/7movies/client-meta` returns playable Orion MP4/HLS for that title.

## Fix
In `hooks/useMediaSources.ts` Auto walk: only first-win `break` when `hasReadySourceRef` or `playbackActiveRef` is true. If URLs returned but settle ended without ready/fail, soft-demote the provider and continue to the next row (7Movies).

## Deploy
- Live: `.next-embed43` via `start-player-b.sh` / `start-embed.sh` / `start-player-new.sh` `NEXT_DIST_DIR`
- Verified: 7Movies client-meta for `102382` returns streams; Orion MP4 proxies `206` through segproxy.
