# VAPlayer unlock rotator (always-return)

## Problem
Cold titles (not in unlock cache) competed for 2 captcha slots. Slot wait
timeout returned `via: unlock-busy` with **no retryAfterMs**, so the client
abandoned the title and **nothing reminted it** → “some titles don’t return”.

CDN JWTs also die ~4h after mint; without proactive remint, caches go dark in
waves and stampede the same 2 slots.

## Fix
1. **Disk queue** `data/vaplayer-unlock-queue/*.json` — resolve enqueues busy/empty titles.
2. **`vaplayer-unlock-rotator`** (pm2) drains the queue one-at-a-time and remints
   cache rows whose JWT expires within ~25 minutes.
3. Resolve returns **`unlock-pending` + `retryAfterMs`** (not hard `unlock-busy`)
   so the client keeps polling until streams land.
4. Unlock cache rows store `mediaType` / `tmdbId` / `season` / `episode` for refresh.

## Files
- `scripts/vaplayer-unlock-queue.cjs`
- `scripts/vaplayer-unlock-rotator.mjs`
- `scripts/vaplayer-unlock.py`
- `app/api/playback/vaplayer-resolve/route.ts`
- patches under `ops/patches/`
