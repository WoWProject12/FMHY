# Player host optimize (2026-11-15)

Same sources/UX. Target: 4-core / 5.8GB box was pegged by segment proxy + unlocks + MeowTV Chromium, then OOM-thrashing (no swap).

## Live changes
1. **2GB swap** (`/swapfile`, swappiness=20) — stops chrome/player OOM death spirals.
2. **segment-proxy** — concurrency 48/192 → **16/64** (env-overridable); keepAlive HTTP(S) agents to reuse TLS; inbound keepAlive 65s.
3. **player** — `NODE_OPTIONS=--max-old-space-size=1024` (was 1536); `VAPLAYER_UNLOCK_MAX_INFLIGHT=2`.
4. **meowtv-assist** — idle close 10m → **3m**; **bootMutex** so concurrent requests cannot spawn multiple Chromiums.

## Verify
- Segproxy `/__segproxy_stats` → `limits.host=16`, `global=64`
- `7movies/client-meta` cached ~20ms; VAPlayer `via:cache` ~200ms
- Patches mirrored under `ops/patches/`
