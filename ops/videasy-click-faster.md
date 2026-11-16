# Videasy click feels slow — why + speedups (2026-11-16)

## Why a Sources → Videasy tap waits

On chillflix the path is **BFF mint (WARP) → Miami city blob → decrypt → cinepro play**.

| Step | Cold (typical) | Notes |
|------|----------------|-------|
| Shared mint `/seed` | ~0.2–2s when free; **many seconds** if soft-gap / slot wait | Upstream via WARP is ~50–150ms; delay is the shared lane (`SEED_GAP`, busy slot, 429 soft-gap) |
| Miami `/api/videasy/fetch` | ~1–5s | Needs a one-shot seed |
| Decrypt + HLS start | ~0.5–3s | |
| Soft-wait UI | up to ~60s | Only when mint is rate-limited |

Warm retaps should be fast via **90s client stream cache** + **180s BFF blob cache** — but the old `runBff` path **minted before** checking the blob cache, so retaps still felt cold.

## Fixes live (`pcv=20261116081022vfast`)

1. **Cache-first BFF** — `runBff` no longer pre-mints; `resolveWithMode(api)` tries the 180s blob cache with an empty seed, then mints once on miss (`9484` + `videasy-client-resolver.ts`).
2. **Shorter mint gap** — `SEED_GAP_MS` 3500 → **2000** (`seed-mint-warp.mjs`).
3. **Sources prefetch** — opening Sources (or the Sources button) calls `prefetchVideasyResolve` (single-flight per tab) so miami resolve can finish **before** the Videasy tap (`9776` + `MovyPlayerSkin.tsx`).

## What users should do

Hard-refresh the embed once (`pcv=…vfast`). Open Sources, wait a beat, then tap Videasy — second/open-Sources-then-tap should be much quicker. First cold tap on a quiet mint lane is often a few seconds; under mint soft-gap it can still wait.
