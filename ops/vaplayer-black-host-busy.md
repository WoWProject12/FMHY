# VAPlayer black at 00:00 (pause UI, 1080p, duration) — segproxy slot leak

## Symptom (e.g. `chillflix.lol/tv/276161?play=true&s=1&e=1`)
Player looks ready: pause icon, Quality **1080P**, duration filled, scrubber at 0 —
but video stays black and clock never advances.

## Why it looked “ready”
1. VA resolve returned tokenized `/pl/…?token=` masters (`playbackMode: server-proxy`).
2. Master + child playlists load through Next rewrite → HLS.js builds the ladder and
   duration → UI shows 1080p / `00:52:42`.
3. **Segments** go through `segment-proxy` (`:3003`). When that lane is wedged they
   502 with `{"error":"Upstream did not answer.","detail":"host busy"}` → no frames.

## Root cause
`acquireHostSlot` used `Promise.all([acquireGlobalSlot(), hostReady])`.
If the host waiter timed out (`host busy`) after the global slot was already taken,
the global release never ran → **permanent global/host counter leak**.

Observed before restart: `globalActive: 64`, `globalWaiters: 324`, `hostActive: 3947`.

CDN JWTs are fine (`ip_cidr` = VPS `/24`); Next can fetch segments. Only the
wedged proxy made phones sit black.

## Fix
1. Restarted `segment-proxy` (immediate unblock).
2. Sequential acquire + rollback on reject; reclaim force-drains hosts stuck at cap
   with waiter backlog.
3. Snippet: `ops/patches/segment-proxy-slot-leak-fix.mjs.snippet`

Hard-refresh the watch page and tap VAPlayer again.
