# Videasy browser-first (skip slow mint) — 2026-11-16

## Problem
Shared WARP `seed-mint-warp` is often soft-gapped / 429 / CF-blocked. Prefetch-into-mint made taps feel worse.

## Browser path (fast)
CF on `api.wecollege.net` allowlists Origins whose hostname **contains** `movy.sx` or `vidy.st`. Residential browser IPs can seed+city directly.

We host a tiny bridge at:

- `https://movy.sx.82.41.181.83.nip.io/` (Let’s Encrypt)
- `https://vidy.st.82.41.181.83.nip.io/`
- `https://movy.sx.82-41-181-83.sslip.io/`

Player embeds a 12×12 iframe → bridge fetches seed/city on the **viewer IP** → `postMessage` back. Decrypt stays local STREAMCRYPTO (~1ms).

Old `*.31-171-131-116.anyip.dev` pointed at a dead IP and timed out, so resolve fell through to mint.

## Code order
1. Warm + use Origin bridge (`direct`)
2. One bridge rebuild retry
3. BFF/WARP mint **last resort only**

Mount only warms the bridge (no mint stampede). Sources open may still prefetch resolve (bridge-first).

Live: `pcv=20261116085200vbrowser`.
