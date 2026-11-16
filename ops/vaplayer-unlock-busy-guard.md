# VAPlayer unlock-busy guard (queue saturation)

## What went wrong
Titles like TMDB `969681` sat on `via: unlock-pending` forever.

Root cause:
1. Upstream captcha uses a **global flock** (`data/vaplayer-unlock.lock`), so unlocks are effectively serial.
2. Node still allowed up to **6** concurrent `vaplayer-unlock.py` workers (`VAPLAYER_UNLOCK_MAX_INFLIGHT=6`).
3. Extra workers slept on the flock while still occupying slots → new titles never acquired a slot → soft-timeout kept returning `unlock-pending` with `retryAfterMs`.

## Guardrails (live on chillflix.pw player / `.next-embed36`)
| Control | Default | Effect |
|---|---|---|
| `VAPLAYER_UNLOCK_MAX_INFLIGHT` | **2** | Match real serial mutex; stop parking dead waiters |
| `VAPLAYER_UNLOCK_SLOT_WAIT_MS` | **12000** | Slot wait times out → `via: unlock-busy` (no retry loop) |
| `VAPLAYER_UNLOCK_WAITERS_MAX` | **12** | Hard cap on queued waiters |
| `VAPLAYER_UNLOCK_LOCK_WAIT` | **25** | Python flock wait (was 100s) |
| Soft-timeout + not spawned | — | Returns `unlock-busy` / “queued behind captcha” instead of pending |

Cached hits (e.g. warmed `969681`) still serve `via:cache` in milliseconds.

## Client behavior
`resolveVaplayerClient` only polls while `retryAfterMs` is set. `unlock-busy` has none → Auto hard-fails VAPlayer and continues to the next source instead of spinning on pending.

## Files
- Source: `app/api/playback/vaplayer-resolve/route.ts`, `scripts/vaplayer-unlock.py`
- Start env: `start-player-new.sh`
- Patches mirrored: `ops/patches/vaplayer-resolve-route.ts`, `ops/patches/vaplayer-unlock.py`
