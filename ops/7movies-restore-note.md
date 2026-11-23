# 7Movies resolve regression (fixed 2026-11-15)

## What happened
A surgical edit to the live client chunk (`9484-…js`) for HEVC demotion broke the browser 7Movies resolver, so Sources stopped returning even though `/api/7movies/client-meta` still had streams.

## Fix
- Restored chunk from `bak-miamionly-20261115T170722Z`.
- Applied a **minimal** sort-only change: prefer `mp4` over Original HLS in the final 7Movies sort.
- Kept server `client-meta` MP4-first + in-memory cache; removed aggressive HEAD soft-validate that could thrash cache.
- VAPlayer cache-until-broken route patch unchanged.

## User action
Hard refresh the player (cache bust `…7mrestore`).
