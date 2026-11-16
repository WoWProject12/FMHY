# Videasy soft-wait (same practice as VAPlayer) — 2026-11-16

## Practice mirrored from VAPlayer
1. **Client poll soft-gap** up to ~60s (mint rate-limit / 429) instead of one
   short retry then Tap-again.
2. **Keep “Starting…” + auto-retry** on soft-gap diagnostics (not Tap-again).
3. **Do not wipe** existing Videasy rows on soft-pending empty resolve.

Videasy already plays via **cinepro proxy** + movy.sx Origin (parallel to VA
tokenized proxy). Miami-only city policy unchanged.

Hard-refresh after `pcv=20261116011507vesoft` (restart both `chillflix-player` and `chillflix-embed`).
