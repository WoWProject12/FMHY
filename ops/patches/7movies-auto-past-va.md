# Auto past unready VAPlayer → 7Movies

## Problem
1. VAPlayer resolve returned CDN URLs that never became probe-ready; Auto treated “URLs survived settle” as first-win and stopped the Sources walk on “Checking VAPlayer”.
2. `pickPreferredPlaybackSource` still locked onto demoted VAPlayer rows that still had URLs (`!requiresProbe` fast-path), so 7Movies never auto-started even after soft-fail.
3. Deployed builds were invisible while nginx `.next-current` pointed at embed42 and `pcv` stayed on `20261124T1838Zcd1e`.

## Fix
- `hooks/useMediaSources.ts`: only soft-demote **vaplayer** when settle ends without ready; other client-resolve (7Movies) first-wins on URLs.
- `components/player/utils/playback.ts`: skip demoted providers even when they have URLs; while scanning, do not optimistic-pick VAPlayer.
- Live: `.next-embed44`, `.next-current` → embed44, `pcv=20261124T1916Z7m`.

## Note
7Movies meta needs assist/boot (WARP). Transient boot 403/429 yields empty streams — retry; do not treat as “title missing”.
