# Videasy resolve fix (2026-11-15)

Live changes on `chillflix.pw` (82.41.181.83). This workspace does not hold the player source tree; patches were applied on the VPS.

## VAPlayer

VAPlayer does **not** never-fail. Unlock/CDN JWT path still returns empty/timeouts under load (nginx shows `/api/playback/vaplayer-resolve` upstream timeouts; unlock still surfaces `failureReason`). Treat it as best-effort like other scrapers.

## Why Videasy still failed while other sources worked

1. **Burned one-shot seeds** — `videasy-seed-shim` cached seeds for 45s and re-served them without consuming. wecollege seeds are one-shot → second tap / sibling viewer got `STREAMCRYPTO_SEED_INVALID` (HTTP 401).
2. **Miami-only client path** — chillflix BFF resolve only tried `miami`. If miami missed or 500’d, it never tried `boise` (which often has the same title).
3. **BFF fetch** — no remint on 401, no city fallback. A single burned seed or miami miss ended the resolve.
4. **Upstream gaps** — some titles genuinely return `No streams available` from wecollege for both cities (content missing, not our stack).
5. **Mint soft-gap** — under stampede, `/seed` still 429/503 briefly; that is rate-limit protection, not a dead provider.

`enc=2` is required (enc=1 → always `STREAMCRYPTO_SEED_INVALID`).

## Fixes applied on VPS

| Path | Change |
|------|--------|
| `/var/www/chillflix.pw/scripts/videasy-seed-shim.mjs` | Removed 45s seed cache; inflight coalesce only; `fresh=1` passthrough; `oneShot: true` |
| `lib/providers/videasy-client-resolver.ts` + chunk `9484-*.js` | `["miami","boise"]` sequential (MAX_CITY_INFLIGHT=1); re-enable `fresh=1` on remint/retry |
| `lib/videasy-fetch.ts` + server chunk `6199.js` | `fresh=1` when `opts.fresh` or retry attempt |
| `app/api/videasy/fetch/route.ts` + compiled `route.js` | Remint on 401; try fallback city (miami↔boise) on 500/empty |

Restarted: `videasy-seed-shim`, `chillflix-player`.

## Verification (post-fix)

With mint soft-gap clear, BFF `POST /api/videasy/fetch` returned **200 encrypted blobs** for:

- Fight Club (miami + boise)
- Inception / Interstellar
- Breaking Bad S1E1
- Game of Thrones S1E1

Seed shim health reports `cacheSize: 0`, `oneShot: true`.

## Second-tap fix (Resident Evil / re-open Sources)

**Symptom:** first Videasy resolve works, immediate retry returns nothing (`seed 429` / soft-gap).

**Cause:** each Sources tap reminted; after a hit the shared WARP mint lane soft-gaps, so tap 2 dies. Encrypted blobs also need the *original* seed to decrypt.

**Fix (live):**

1. BFF **180s blob+seed cache** per title — second tap returns `cached:true` with the same blob/seed (no remint)
2. Client api path tries BFF **before** minting; decrypt uses returned seed
3. City fetch prefers **mint :3871** direct (avoids relay queue timeouts)
4. Mint soft-gap shortened (45s→8s); city 429 no longer bricks seeds for 45s

Verified Resident Evil (1577): BFF1 `200`, BFF2/3/4 `cached:true` same blob.
