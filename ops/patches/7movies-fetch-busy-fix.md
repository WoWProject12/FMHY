# 7Movies: sources OK but play fails (fetch busy / Orion 403)

## Symptom
7Movies returns streams in Sources, but playback stalls / never starts (especially Orion langs).

## Root cause
`sevenmovies-boot` (`:3887/fetch`) is required to pull Orion CDN (`mb.vidrift.net`) past Cloudflare.
It was returning **503 `fetch busy`** because:
1. Semaphore slots leaked when clients disconnected mid-write (`BrokenPipeError` before `release`)
2. Cache ballooned (~14k entries / ~1.4GB), increasing pressure
3. Restart without `WARP_SOCKS` made Orion return raw **403**

## Fix (2026-11-24)
- Always `release()` the fetch semaphore in `finally`
- Cap/prune boot cache
- Raise default concurrency 3→6
- Always start via `start-sevenmovies-boot.sh` (sets `WARP_SOCKS=socks5h://127.0.0.1:40000`)

## Verify
```bash
curl -s http://127.0.0.1:3887/health
curl -s "http://127.0.0.1:3887/fetch?url=https%3A%2F%2Fmb.vidrift.net%2Fapi%2Forion%2F...%2Fmaster.m3u8" | head
```
