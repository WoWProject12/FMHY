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
- `cinepro-watch-player.tsx`: exclude hold providers from trusted probe IDs;
  block auto `resolvedSourceId` and force-pick until primary client-resolve is
  `clientResolved` or scan-failed.

## Deploy
Player build → `pm2 restart chillflix-player chillflix-embed` → nginx `pcv`
bust `pcv=20261116015630listord` (chunk `9484-49de2428aa5261a0.js`).
