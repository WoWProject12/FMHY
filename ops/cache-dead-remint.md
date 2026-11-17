# Cache-until-broken: fast hit + remint when dead

## Behavior (live)

### 7Movies (`/api/7movies/client-meta`)
| Case | Result |
|------|--------|
| Memory/disk cache hit (TTL ≤ 6h) | **Instant** (`cached: true`, ~5–20ms) |
| `?refresh=1` | Remint meta, rewrite cache |
| TTL expired / no cache | Rebuild (boot), then cache |
| Build fails but stale exists | `resolveMode: cache-stale` |

Disk: `data/7movies-meta-cache/*.json` (survives player restart).

### VAPlayer (`/api/playback/vaplayer-resolve`)
| Case | Result |
|------|--------|
| Disk cache + CDN JWT still valid | **Instant** (`via: cache` / `cache-reuse`, ~10–60ms) |
| JWT expired / missing | Remint via unlock (may take tens of seconds; upstream **429** possible under load) |
| `?refresh=1` | Force remint (`--force`), skip disk cache |
| Unlock empty | One automatic retry; then `cache-fallback` only if JWT still somehow valid |

### Client
- Chunk reads `sessionStorage` flags `va-dead:…` / `7m-dead:…` and adds `refresh=1` on next resolve.
- `MediaPlayer` marks those flags on proxy 403/404/410 refetch (source; live after next full player build).

## Verify
```bash
# 7m instant
curl -s -o /dev/null -w '%{time_total}\n' 'http://127.0.0.1:3002/api/7movies/client-meta?tmdbId=1339713&type=movie'
# 7m remint
curl -s 'http://127.0.0.1:3002/api/7movies/client-meta?tmdbId=1339713&type=movie&refresh=1' | jq '.streams|length'

# VA instant
curl -s -H 'Origin: https://www.chillflix.pw' -H 'Referer: https://www.chillflix.pw/x' \
  'http://127.0.0.1:3002/api/playback/vaplayer-resolve?type=movie&tmdbId=1339713' | jq '.via'
```

## Note on 429
When many titles remint at once, VA unlock can 429. Cache-until-broken avoids that for live JWTs; dead-JWT remint may need a retry after the unlock lane cools.