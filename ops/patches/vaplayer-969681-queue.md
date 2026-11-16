# 969681 empty VAPlayer (2026-11-16)

## Symptom
`https://www.chillflix.lol/movie/969681?play=true&startAt=6996` — VAPlayer returned no streams / unlock-pending under load.

## Immediate recovery
Forced unlock + cache write so resolve returned `via:cache` with 3 streams (~4ms).

## Durable fix
See `ops/vaplayer-unlock-busy-guard.md`:
- Cap inflight unlocks at 2
- Timeout slot acquire → `unlock-busy`
- Soft-timeout while still queued → `unlock-busy` (no `retryAfterMs`)
- Shorter Python flock wait (25s)
