# 7Movies play: unwedge boot `/fetch` slots

## Symptom
`/api/7movies/client-meta` returned streams, but selecting 7Movies did not play.
`sevenmovies-boot` health showed `fetchFree: 0` — Orion media proxy via segproxy → boot `/fetch` returned 503 `fetch busy`.

## Cause
Boot buffered full CDN responses under a small semaphore (6). Stuck/slow WARP fetches + client disconnects left all slots held, so every new play failed busy.

## Fix (live)
- Explicit slot counter + held-thread map (not only `Semaphore._value`)
- Watchdog reclaims slots held >55s
- Concurrency 6 → 12 (WARP still on)
- Cap runaway non-Range bodies; chunked client writes; safe BrokenPipe on JSON

Restarted via `start-sevenmovies-boot.sh` with `SEVENMOVIES_SOCKS`/`WARP_SOCKS`.
