# Continue Watching: deferred seek after client-resolve remount

## Symptom
After VAPlayer / Videasy / 7Movies / Movy (client-resolve) auto-pick or Sources remount, Continue Watching / `?startAt=` opened from the beginning instead of the saved position.

## Cause
Client-resolve remounts intentionally force `upgradeResumeTime = 0` so a fresh CDN URL can start without black-stall. That sticky zero also blocked `resolveResumeTime` / opening `startAt`, so MediaPlayer always mounted at t=0 with no later seek.

## Fix (live on chillflix.pw, build `.next-embed39`)
1. `cinepro-watch-player.tsx` — keep remount-at-0 for client-resolve, but stash the intended time in `deferredContinueAt` (from opening `startAt` or prior hold time) and pass it as `deferredResumeTime` to MediaPlayer.
2. `MediaPlayer.tsx` — once the video has current data / buffer, seek once to `deferredResumeTime` (skip if the user already scrubbed past ~20s).

## Deploy notes
- `NEXT_DIST_DIR=.next-embed39` in `start-player-new.sh`, `start-player-b.sh`, `start-embed.sh`
- pcv buster `20261124T1529Zcd1e`
- Active upstream remains `chillflix-player-b` on `:3029`
