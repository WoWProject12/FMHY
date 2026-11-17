# VAPlayer “No stream… Tap again” (The Odyssey / 1368337)

## What you saw
On `chillflix.lol/movie/1368337?play=true`, another source kept playing (Universal intro) while the overlay said **No stream from VAPlayer right now. Tap VAPlayer again.**

The watch page iframes `https://www.chillflix.pw/embed/...`. The player keeps the current source mounted while the next provider resolves — so a failed VAPlayer tap overlays that toast on top of whatever was already playing.

## Root causes

1. **Soft-timeout without client retry (main toast bug)**  
   Server `/api/playback/vaplayer-resolve` returns `unlock-pending` + `retryAfterMs` after ~18s when remint is slow.  
   Live chunk `9484-*.js` still had the **old one-shot** client (no `retryAfterMs` handling), so empty streams → immediate toast.  
   Source `vaplayer-client.ts` had a single retry, but it was never shipped in the chunk.

2. **Broken .lol → player SSH tunnel**  
   `chillflix-player-tunnel.service` still targeted old IP `31.171.131.116` (no route; 50k+ restarts).  
   `/embed/*` on .lol → 502. (Movy watch uses `.pw` embed directly, so main site watch still worked.)

3. **`.lol /api/playback/*` hit catalog Next**  
   Same-origin calls to `/api/playback/vaplayer-resolve` on .lol went to `:3000/old` → **404** (seen in logs for 1368337).  
   Added nginx snippet to proxy `/api/playback/` through the player tunnel (`:3102`, Host `www.chillflix.pw`).

## Fixes applied (live)
- Tunnel → `root@82.41.181.83` (`:3002`). Embed on .lol → **200** again.
- `/etc/nginx/snippets/chillflix.lol-playback-api-proxy.conf` included from `chillflix.lol`.
- Patched live `9484` chunk + source: retry up to **4×** on `retryAfterMs` (~unlock-pending).
- Player cache bust `pcv=20261116000423n68o` so embeds pick up the chunk.

## Verify
- `https://www.chillflix.pw/api/playback/vaplayer-resolve?type=movie&tmdbId=1368337` → `ok`, `via=cache`, 3 streams.
- Hard-refresh the Odyssey watch page (or open embed with new `pcv`) and tap VAPlayer — should start or keep “Starting VAPlayer…” while unlock finishes, not the Tap-again toast.
