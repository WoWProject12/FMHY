# Continue Watching: deferred seek (ROLLED BACK LIVE)

## Status
**Rolled back on chillflix.pw** (2026-11-24 ~15:34Z). Live traffic is back on `.next-embed38` (`pcv=20261124T1533Zrollback`).

The `.next-embed39` deploy that included deferred seek left the player stuck on “Looking for the fastest source” / SourceProbeFlow for titles such as movie `1368337`. VA resolve itself still returned streams; the client never left the probe overlay.

## Intended fix (not live)
Keep client-resolve remounts at t=0, stash Continue Watching / `?startAt=` in `deferredContinueAt`, seek once in MediaPlayer after HAVE_CURRENT_DATA.

## Do not re-flip to embed39 until
1. Deferred-seek change is re-tested on a side process (e.g. player A :3002) with a real embed open.
2. Probe overlay clears and playback starts for a fresh title and a Continue Watching title.
