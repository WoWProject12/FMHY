# Videasy mint deadlock fix — 2026-11-16

## Symptom
Videasy stayed on Starting / never played. Soft-wait client was fine; mint was dead.

## Root cause
`seed-mint-warp` (`:3871`) held `seedBusy=true` with an unbounded waiter queue.
A hung WARP/socks upstream never released the lock → `/seed` hung (0 bytes),
`movy-relay` reported `mintBusy:true`, `/api/videasy/seed` returned 502/503.

## Fix
1. Restarted mint chain (`seed-mint-warp`, `movy-relay`, `videasy-seed-shim`).
2. Patched `seed-mint-warp.mjs`:
   - waiter timeout (8s) → `503 mint_soft_gap` instead of hang
   - hard 14s race on upstream (socks can ignore req timeout)
   - force-clear stale `seedBusy`
   - health exposes `seedBusy` / waiters

Soft-wait client practice (60s poll + Starting…) remains; it needs a live mint.

Hard-refresh embeds (`pcv=20261116011507vesoft` still current) and tap Videasy.
