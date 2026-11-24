# 7Movies play: unwedge boot `/fetch` slots

## Symptom
`client-meta` OK but 7Movies play failed. Boot health `fetchFree: 0` → segproxy `/fetch` 503 busy.

## Cause
1. Small semaphore + stuck WARP fetches.
2. **Full-file GETs without `Range`** — curl_cffi buffered entire Orion MP4s into RAM (~1GB+) and held every slot for minutes, so free stayed 0 even though the watchdog never saw “stale” (slots kept refreshing under load).

## Fix (live)
- Explicit slot counter + held-thread map; reclaim >25s
- Concurrency 12 + WARP
- **Force `Range: bytes=0-(max-1)` on media URLs when client omits Range** so upstream never streams a whole movie into one slot
- Cap body size; chunked client writes

## Verify
- `curl /health` → `fetchFree` > 0 under load
- Ranged `/fetch` → 206 quickly
- No-Range media `/fetch` → 206 with capped body in a few seconds (not multi-minute)
