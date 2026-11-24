# VSEmbed mid-play flicker / loading-list (chillflix.pw)

## Symptom
Plays → black flicker → source probe / loading list again, even though it was already playing.

## Cause
1. Buffer/proxy stall recovery remounted MediaPlayer (`bumpSourceSwitch` / re-unlock).
2. On remount, `isLoading` + `currentTime≈0` made `SourceStatusOverlay` show the probe list again.

## Fix (live on pw `.next-embed36`)
- `cinepro-watch-player.tsx`: skip quiet stall / proxy remount after ≥0.5s progress; `bumpSourceSwitch` refuses after progress; early `playbackStable` lock.
- `MediaPlayer.tsx`: never call parent `onBufferStall` after first paint; keep `hasPlayedOnce` for overlay progress.
- `SourceStatusOverlay.tsx`: latch probe panel off once a source has played.

Hard-refresh the embed (cache-bust) before retesting.
