# to.vidsrc.party scraper block (2026-11-16)

## What they were doing
IP **`88.218.196.122`** hit chillflix.pw APIs at high volume
(`/api/cinepro/sources`, `/api/playback/vaplayer-resolve`, `/api/4k/resolve`, …)
while **forging** `Referer` / `parent_origin` as chillflix.pw / chillflix.lol so
playback-guard passed.

That is API stream theft with their own JWPlayer — Embedders → Block (host gate)
alone never reaches their UI.

## Live defenses (must all be on)
1. **Nginx IP deny** `88.218.196.122` in
   `/etc/nginx/snippets/chillflix-scraper-deny.conf`, included on sources /
   vaplayer / 4k / provider proxy locations.
2. **`error_page 403 = @chillflix_scraper_advertise`** → JSON with
   `advertise:true` and playable slate
   `https://www.chillflix.pw/advertise/watch-on-chillflix.mp4`
   (CTA → `https://www.chillflix.lol/?play=true`). Named location lives at
   **server scope** in `chillflix.pw-locations.conf` (`gzip off`).
3. **Node `assertIpNotBlocked`** → same advertise payload (belt-and-suspenders
   when request reaches the player).
4. **APICACHE key** for `/api/cinepro/sources` is
   `"$binary_remote_addr$request_uri"` so scrapers cannot reuse other viewers’
   cached real source lists. Flush `/var/cache/nginx` after changing this.
5. **Host gate** `to.vidsrc.party` / `vidsrc.party` for any real chillflix embed
   path (Watch free on Chillflix overlay).
6. MySQL `site_settings.setting_value` widened to **MEDIUMTEXT** (IP blocklist
   hit the old TEXT ceiling).

## Verify
```bash
# Nginx deny → advertise (temp add: deny 127.0.0.1;)
curl -sS -H 'Host: www.chillflix.pw' -H 'Accept-Encoding: identity' \
  'http://127.0.0.1/api/cinepro/sources?type=movie&tmdbId=550'
# expect: advertise:true, streams → watch-on-chillflix.mp4, header X-Chillflix-Advertise

# Player path
curl -sS -H 'X-Forwarded-For: 88.218.196.122' \
  -H 'Origin: https://www.chillflix.pw' \
  'http://127.0.0.1:3002/api/cinepro/sources?type=movie&tmdbId=550'
```

Live scraper rows in `pw-timing.log` should be **~192 (gzip) or ~630 (identity)** —
not 1KB+ real source payloads.

## How Block works now (admin)
| Where | Click | Effect |
|---|---|---|
| **Embedders → Block** | Host | Chillflix ads/watch gate on that host. Prompt asks for scraper IP → also denies streams. |
| **Stream theft → Hot IPs → Block** | IP | Denies real streams (advertise slate). Prompt asks for site host → also force-gates Chillflix ads. |

Combined API: `POST /api/internal/scrape-intel` `{ action: "blockIp", ip, host? }`.

## Notes
- Pure API scrapers never load our embed HTML — they only get the advertise JSON/MP4
  in their own player. That is intentional.
- Shared `proxy_cache_key "$request_uri"` was why Block looked broken: HITs served
  real streams without hitting Node IP checks. Fixed via per-IP cache key + nginx deny.
