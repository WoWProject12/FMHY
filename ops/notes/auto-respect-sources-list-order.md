# Auto must respect Sources list order (2026-11-16)

## Bug
With VAPlayer #1 and RiveStream lower in admin Sources, Auto still jumped to
RiveStream. Manual VAPlayer tap worked.

## Why hold alone was not enough
`shouldHoldForHigherRankedProviders` blocked scrapes in some pick paths, but:

1. Embed `skipHealthProbe` **trusted** RiveStream URLs (no probe) → marked ready.
2. After head-start / scan quiet, `pickPreferred` non-health path returned the
   first eligible URL while VAPlayer was still unlocking and **absent** from the
   clientResolved pool.
3. `hasPlayableBatch` bypassed the scan gate as soon as any scrape URL arrived.
4. Force-pick / `resolvedSourceId` unlocked peers once scanning flags cleared,
   even though #1 was still soft-pending.

## Fix
- `playback.ts`: keep client-resolve #1 gated after head-start; never treat a
  quiet scan as “resolved” for client-resolve; wait on higher client-resolve
  before force-pick or preferred pick (health + skipHealth); don’t trust hold
  scrapes ahead of an unresolved #1.
- **Root hole**: `pickAutoStartPlaybackSource` honored `pickPreferred`’s
  “wait” (`undefined`) only when health probing — with embed/toflix
  `skipHealthProbe` it fell through and returned the first pool URL
  (RiveStream). Now an undefined preferred always means wait.
- `cinepro-watch-player.tsx`: exclude hold providers from trusted probe IDs;
  block auto `resolvedSourceId`, force-pick, **and** the parallel
  `commitAutoStartOption` effect until primary is `clientResolved` or
  scan-failed; `commitAutoStartOption` itself refuses demotions.
- `usePlaybackSourceFallback`: pass through `scanFailedProviderIds`.

## Demotion when #1 is empty
Waiting on VAPlayer must not block forever when it has **no** streams.
Client-resolve hard-empty now marks `scanFailed` immediately (`hard: true`),
and between-pass clears no longer wipe hard fails — Auto can move to #2
(RiveStream/7Movies) right away. Soft unlock-pending still waits.

## Sequential Auto walk (testing / failed circles)
Auto now tests Sources **one-by-one** in admin order (`scanningProviderId`
tracks the active row). Soft unlock-pending / timeouts soft-fail so the
spinner moves to the next row; hard-empty stays sticky. Overlay/settings
already render testing spinner + failed X via `SourceProbeFlow`.

## Sources sheet circles (MediaPlayer path)
`scanFailedProviderIds` / `activeTestingProviderId` now flow
cinepro → MediaPlayer → PlayerControls → PlayerSettings **and**
SourceStatusOverlay. Each Sources row shows a status circle (spin /
failed X / ready check / queued dash) while Auto walks the list; the
mobile PlayerSettings path also gets testing + failed props (was missing).

## Embed Auto must show the probe
`quietScanUi` used to blank the entire overlay whenever `embedMode` was
set, so sequential Testing/Failed never appeared on `.pw/embed`. Quiet
blanking now only applies when Auto is **not** scanning.

## Deploy
Player build → `pm2 restart chillflix-player chillflix-embed` → nginx `pcv`
bust `pcv=20261116024658seqscan` (chunks `1643-a8bc…` / `8887-8aee…`),
then `pcv=20261116025945sheetscan` (chunk `8887-1c68996d8af993c7.js`) after MediaPlayer Sources circle wiring,
then `pcv=20261116033055embedprobe` after embed quietScanUi exception for active scans.
