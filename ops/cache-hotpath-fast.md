# Cache-until-broken must be instant (fixed 2026-11-15)

## What felt wrong
Second Sources tap / leave-and-retry took as long as the first unlock. Cache existed (`via: cache`) but every hit **soft-probed** the CDN playlist (`playlistReachable`, up to 6–120s). That made “cached” feel like a remint.

## Fix
**VAPlayer** (`vaplayer-resolve` compiled + source):
- If disk cache has streams and CDN JWT is still valid → **return immediately**.
- Remint only when JWT expired/missing or `?refresh=1`.
- Timed after fix: ~0.10–0.35s on cache hit (was 1.3s–timeout).

**7Movies** (`client-meta`):
- Compiled path already returned memory cache without probe.
- Default TTL **20m → 6h** so leave-and-come-back still hits cache after player restarts less often.
- Source TS aligned (no soft-validate on hot path).

## Expectation
| Path | First (cold) | Retry (JWT/TTL alive) |
|------|----------------|------------------------|
| VAPlayer | unlock (slow) | **instant** `via: cache` / `cache-reuse` |
| 7Movies | build meta | **instant** `cached: true` |

Playback errors can force remint with `?refresh=1`.