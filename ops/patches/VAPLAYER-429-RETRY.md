# VAPlayer 429 retry hardening

## Why VA "sometimes fails"
- Cold unlocks hit upstream `HTTP 429` (same class of throttle as VSEmbed).
- Soft resolve timeout (~8s) returns before retries finish; Auto scan budget is ~4s.
- Prior empty-result path force-reminted on 429, which made throttling worse.
- Queue depth often ~500 jobs; only a few captcha slots — unlock-busy is common.

## Changes
1. `vaplayer-unlock.py`: retry up to 4 times on 429 with exponential backoff while holding the mutex (avoids stampede). Env: `VAPLAYER_UNLOCK_429_RETRIES`.
2. `vaplayer-resolve/route.ts`: on 429 return `unlock-pending` + `retryAfterMs: 8000` without `force` remint; catalog misses skip force remint.

## Limits
Cannot guarantee 100%: true catalog misses (404 / no stream_urls) stay empty. Cached titles still return instantly.
