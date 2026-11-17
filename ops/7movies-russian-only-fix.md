# 7Movies “only Russian” (fixed 2026-11-15)

## Cause
To stop Chrome start-then-disappear on HEVC **Original (English)**, the client kept **MP4 rows only** whenever any MP4 existed:

```ts
const dubbedMp4 = dubbedAll.filter((row) => row.stream.type === "mp4")
const dubbed = dubbedMp4.length ? dubbedMp4 : dubbedAll
```

For Obsession (`1339713`) Orion has MP4 dubs (Hindi/Tamil/…/Russian) and HEVC HLS for **Original + French**. Filtering dropped English/French, so the language sheet looked like “only dubs” — and Russian was the only familiar European one left.

## Fix
1. Keep **all** language rows again (English + French + dubs).
2. Change `pickPreferredLanguageSource` to auto-pick:
   - English **MP4** if present → else any **MP4** → else English HLS → else first.
   So Chrome autoplays a progressive dub, but English stays selectable.

Live: chunk `9484-…js`, `lib/client-resolve-providers.ts`, `components/player/utils/playback.ts`, `pcv=…7mallang`.

## Note
Orion often has **no English MP4** for this title — English is HEVC HLS. It will appear in Languages; picking it on Chrome may still fail MSE. Autoselect will land on an MP4 dub (e.g. Hindi), not Russian-only.