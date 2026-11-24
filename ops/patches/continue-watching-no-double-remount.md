# Continue Watching: stop double remount flash

## Symptom
Stream seeks to saved time, scrubber snaps to 0:00, then seeks/plays again.

## Causes fixed
1. Auto-commit `sourceSwitchNonce` remount when `startAt` set — skipped.
2. **Root cause of remaining flash:** React `key` used `urlFp = playbackStable ? "locked" : "pending"`.
   Continue Watching seeks `currentTime` past 0.5 → `playbackStable` flips → key changes
   `pending`→`locked` → full MediaPlayer remount (0:00 flash).
3. Fix: client-resolve `urlFp` is always `"cdn"` (never flips with stable).

## Live
`.next-embed42` / pcv `20261124T1838Zcd1e`
