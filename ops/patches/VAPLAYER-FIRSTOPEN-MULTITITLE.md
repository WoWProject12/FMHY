# VAPlayer first-open + multi-title

## Changes (chillflix.pw live)
1. **Nginx** `/api/playback/vaplayer-resolve`: `proxy_cache off` (was caching empty/pending 200s for 45s). Higher `limit_req` burst. Read timeout 12s.
2. **Prewarm** on player open (`prewarmVaplayerUnlock`) so unlock starts before Auto finishes the VA row.
3. **Background promote**: after Auto soft-fails VA, keep polling ~45s and merge sources when unlock lands (no manual retap).
4. **Multi-title**: unlock.py releases captcha mutex during 429 backoff; player-b `MAX_INFLIGHT=2`, `SLOT_WAIT=15s`; HTTP 429 treated as soft retry.
