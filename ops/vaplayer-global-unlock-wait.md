# VAPlayer: global unlock wait (all titles)

## Problem
Cold VAPlayer unlock often exceeds the ~18s API soft-timeout. The live client used to treat that as a hard empty result and show **No stream from VAPlayer… Tap again** over whatever else was already playing. Warming one title’s cache did not help the next cold title.

## Global fix (not per-title)
1. **Client** (`vaplayer-client` / chunk `9484`): poll `/api/playback/vaplayer-resolve` for up to **60s** while the API returns `retryAfterMs` / unlock-pending. Works for every movie/TV episode the same way.
2. **Toast** (`cinepro-watch-player` / chunk `4809`): if the diagnostic still says unlock is running, keep **Starting VAPlayer…** and auto-retry once — never flash Tap-again for pending unlock.
3. **Unlock concurrency**: `VAPLAYER_UNLOCK_MAX_INFLIGHT=6` (was 4) so fewer titles sit in the queue past soft-timeout.
4. Cache bust: `pcv=202611160014182xgl` (hard-refresh once).

## Still true
- Tokenized VA CDN stays on **cinepro proxy** (browser cannot set `Origin: nextgencloudfabric.com`).
- Soft-timeout on the API remains (~18s) so Sources can fall through; the **browser** keeps waiting out unlock for that title.
- Hard empty after unlock actually finishes (no streams for that title) can still show Tap-again — that is a real miss, not a queue stall.
