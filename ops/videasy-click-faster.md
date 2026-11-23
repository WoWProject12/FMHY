# Videasy click feels slow — why + speedups (2026-11-16)

## Why it cannot be “instant” on a true cold start

Videasy needs a **one-shot wecollege seed** (via shared WARP mint) then a **Miami encrypted blob**, then decrypt. Upstream seed is ~50–150ms when free; the shared mint lane + Miami RTT are the real cost. Parallelizing cities or prefetch-minting every title stampedes CF into 429/soft-gap (historically ~16s hangs).

## What we made faster

| Lever | Effect |
|------|--------|
| Cache-first BFF (`runBff`) | No mint before 15m blob cache check |
| Server **singleflight** on `/api/videasy/fetch` | N concurrent viewers of same title share **one** mint+city |
| Blob TTL **15m** (was 3m) | Retaps / reopen stay warm longer |
| Client stream cache **15m** | In-tab retap skips resolve |
| Prefetch on **player mount** + Sources open | Resolve often done before Videasy tap |
| Mint gap **1.5s** (was 3.5s) | Less artificial wait between seeds |

Live: `pcv=20261116083045vfast2`.

## What’s left (diminishing returns)

- Cold first title on a busy mint lane can still wait (soft-gap / slot).
- Decrypted CDN URLs are not cached separately (blob+seed is); if those URLs die early, a remint is still required.
- A dedicated always-on seed pool per title would fight one-shot seed semantics and 429s.

## User tip

Hard-refresh once. Open the title (prefetch starts), then tap Videasy — should often be near-instant when the blob is warm.
