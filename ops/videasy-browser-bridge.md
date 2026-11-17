# Videasy browser-first + play fix — 2026-11-16

## Why it “didn’t play”
1. Origin-bridge iframe was pointed at a **dead anyip IP**; replaced with `movy.sx.82.41.181.83.nip.io` (Let’s Encrypt).
2. Parent called Atlantic **runner** `postMessage({ type: "resolve" })`, but bridge HTML only handled `{ op: "seed"|"city" }` — every tap waited **~16s** then failed.
3. Shared WARP mint was often **soft-gapped / 429**, so BFF fallback returned `Videasy seed returned HTTP 429` → empty Starting.

## Fixes live
- Bridge HTML implements **both** protocols (runner `resolve` + chillflix `op`).
- Client races bridge vs BFF/mint (mint starts after 700ms) so a dead iframe can’t hang playback.
- Runner timeout 16s → 9s.
- Mint restarted / soft-gap cleared; BFF blob cache verified (`550` 200 + cached).

Hard refresh: `pcv=20261116090245vplay`.
