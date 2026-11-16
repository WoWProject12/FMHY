# VAPlayer empty on 969681 (Spider-Man: Brand New Day) — 2026-11-16

## Symptom
`https://www.chillflix.lol/movie/969681?play=true&startAt=6996` — VAPlayer suddenly returned no streams / stayed on unlock-pending.

## Cause
Global unlock mutex + `UNLOCK_MAX_INFLIGHT=6` were saturated with other titles’ captcha unlocks (processes stuck in `hrtimer_nanosleep` backoff). Resolve for `969681` joined singleflight while still waiting for a slot, so every tap got `via: unlock-pending` with empty streams.

## Fix
Forced unlock: `python3 scripts/vaplayer-unlock.py --type movie --tmdb 969681 --force` → 3 streams cached. API now `via: cache` in ~4ms.

## Videasy “can’t faster”
WARP mint is CF `403` / soft-gapped `429` right now — VPS mint cannot be made fast in that state. Browser Origin-bridge (`pcv=…vplay2`) is the fast path; open Sources and tap Miami/Videasy after hard refresh.
