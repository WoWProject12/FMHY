# Continue Watching: preserve startAt across Auto remount

## Cause
After the short Auto settle (~2s `PROVIDER_SETTLE_MS`), client-resolve auto-commit
forced `upgradeResumeTime = 0` and `autoClientResolveResumeTime = 0`. MediaPlayer
treats `resumeTime === 0` as an explicit fresh start, so Continue Watching / `?startAt=`
always restarted at 0 after the source remount.

## Fix (live `.next-embed40`, pcv `20261124T1702Zcd1e`)
1. `cinepro-watch-player.tsx` — if opening `startAt` > 0.5, keep that resume through
   auto-commit instead of sticky-zero; only force 0 when there is no continue position.
2. `MediaPlayer.tsx` — delay high continue seeks until HAVE_CURRENT_DATA / buffer so
   the CDN does not black-stall; also retry on loadeddata/canplay.

Manual Sources taps still remount at 0 (CDN safety).
