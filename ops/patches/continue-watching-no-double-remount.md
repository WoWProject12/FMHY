# Continue Watching: stop double remount flash

## Symptom
Stream briefly seeks to the saved position, then appears to reload sources
(scrubber snaps to 0:00), then seeks/plays at continue again.

## Cause
1. Auto-commit bumped `sourceSwitchNonce` after MediaPlayer had already mounted
   with Continue Watching — forced a full remount.
2. Client-resolve URL fingerprint in the React `key` changed when VA/7Movies
   unlock refreshed the CDN URL before `playbackStable`.

## Fix (live `.next-embed41`, pcv `20261124T1756Zcd1e`)
- Skip nonce remount on auto-commit when opening `startAt` is set.
- Freeze `urlFp` to `"pending"` for client-resolve until playback is stable.
