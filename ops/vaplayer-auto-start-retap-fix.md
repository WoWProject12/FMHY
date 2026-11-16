# VAPlayer auto-start black until Sources retap (2026-11-16)

## Bug
Auto-picked VAPlayer mounted the player on a bare `setSelectedSourceId` without the
Sources-tap path. That skipped:

1. **start@0** — Continue Watching / `?startAt=` mid-seek on a fresh CDN URL stalls
   black (empty Quality) until remount.
2. **alwaysFresh resolve + remount** — manual Sources tap always re-scrapes VAPlayer
   and bumps `sourceSwitchNonce`.

## Fix (live `.pw` player)
1. `playback.ts`: auto-start eligibility requires `clientResolved` for VAPlayer /
   Videasy / Movy — never pick unresolved bulk/shared stubs.
2. `cinepro-watch-player.tsx`: `commitAutoStartOption` for auto/force/upgrade picks —
   VAPlayer/NoTorrent re-resolve like Sources, all client-resolve remount at 0.
3. First auto client-resolve mount forces `resumeTime=0` if commit has not stamped it yet.

Hard-refresh embeds after `pcv=20261116004041o0yh`.
