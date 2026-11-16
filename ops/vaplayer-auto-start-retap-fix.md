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
2. `cinepro-watch-player.tsx`: `commitAutoStartOption` remounts client-resolve at
   **start@0** (nonce bump) — same as the useful half of a Sources tap.
3. First auto client-resolve mount forces `resumeTime=0` if commit has not stamped it yet.

## Regression (same night)
First cut also **alwaysFresh re-scraped** VAPlayer on auto-start. Soft-timeout empty
`replaceProviderIds` wiped the streams the scan had just resolved → black player at
00:00 with pause UI (e.g. Bridget Jones `95610`). Auto-start now **remounts only**;
manual Sources tap still alwaysFresh.

Hard-refresh embeds after the latest `pcv` bust.
