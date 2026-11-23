# VAPlayer “not playing” + browser IP (2026-11-15)

## What’s going wrong
Cold unlocks (captcha → streamdata → host JWT) take ~10–30s and queue behind a
global lock. Sources aborts around ~45s, so VAPlayer looks dead on many titles
even when unlock would succeed a bit later.

Cached titles are fine (`via: cache`, ~5–50ms).

## Why “just use browser IP” is not a full drop-in
VA CDN playlists only accept **`Origin: https://nextgencloudfabric.com`**.
From chillflix.pw the browser cannot set that Origin (forbidden header).
`Origin: null` (sandboxed bridge) and `Origin: chillflix.pw` both get **403**.

So playback must go through **cinepro proxy** (server sets nextgen Origin) for
**tokenized** `/pl/…?token=` masters. Viewer-direct only works for non-token /
kite-style hosts.

## Fix applied (live player)
1. Soft-timeout resolve (~18s): return alive cache, or `unlock-pending` +
   `retryAfterMs` instead of hanging 55s+ while unlock continues in singleflight.
2. Unlock gate default **4** concurrent (`VAPLAYER_UNLOCK_MAX_INFLIGHT`).
3. Source: tokenized VA stays on server-proxy with nextgen headers; client
   resolver retries once on `unlock-pending`.

Hard-refresh the embed after deploy. Prefer another source if VA returns
`no streams` (true 404 on streamdata for that title).
