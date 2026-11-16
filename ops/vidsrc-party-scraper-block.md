# to.vidsrc.party scraper block (2026-11-16)

## What they were doing
IP **`88.218.196.122`** hit chillflix.pw APIs at high volume
(`/api/cinepro/sources`, `/api/playback/vaplayer-resolve`, `/api/4k/resolve`, …)
while **forging** `Referer` / `parent_origin` as chillflix.pw / chillflix.lol so
playback-guard passed.

They run **their own JWPlayer** (`vidsrc.party/embed.js`) fed by their
`/api/play/...` backend — not our embed HTML — so Embedders host-gate alone
never paints “Watch free on Chillflix” on their page.

## Live defenses
1. **Nginx IP deny** `88.218.196.122` in
   `/etc/nginx/snippets/chillflix-scraper-deny.conf` on sources / vaplayer / 4k /
   provider proxies.
2. **`error_page 403 = @chillflix_scraper_advertise`** returns a **normal
   `/api/cinepro/sources`-shaped JSON** (not a custom advertise blob) with one
   HLS source:
   `https://www.chillflix.pw/advertise/master.m3u8`
   → media playlist + `.ts` segments. Slate video text:
   **Watch free on Chillflix / Open chillflix.lol**.
3. **APICACHE key** `"$binary_remote_addr$request_uri"` so scrapers cannot reuse
   other viewers’ real source HITs.
4. **Node `assertIpNotBlocked`** same payload (belt-and-suspenders).
5. Host gate for any real chillflix embed; MySQL blocklist column **MEDIUMTEXT**.

## Why the spinner (no ad) happened
- First advertise JSON did not match their sources schema / was mp4-only → their
  `/api/play` ignored it → endless “Finding source”.
- Their client also requested `/advertise/master.m3u8` (404 until added).
- Even when Chillflix is blocked, vidsrc may still try **other** providers
  (`anv.to`, etc.). The Chillflix slate only appears when their backend
  **selects** our returned HLS.

## Verify
```bash
# Deny → sources-shaped advertise
curl -sS -H 'Host: www.chillflix.pw' -H 'Accept-Encoding: identity' \
  'http://127.0.0.1/api/cinepro/sources?type=tv&tmdbId=1429&season=1&episode=1'
# (with deny 127.0.0.1 temporarily) expect sources[0].url = .../advertise/master.m3u8

curl -sI https://www.chillflix.pw/advertise/master.m3u8
curl -s https://www.chillflix.pw/advertise/hls/index.m3u8
```

`pw-timing.log` for `88.218.196.122`: API bodies ~192/464 bytes; should also
show `GET /advertise/master.m3u8` and ideally `/advertise/hls/seg*.ts`.

## Admin Block
| Where | Effect |
|---|---|
| Embedders → Block | Host gate + optional scraper IP |
| Stream theft → Hot IPs → Block | IP deny → advertise HLS + optional host |

`POST /api/internal/scrape-intel` `{ action: "blockIp", ip, host? }`.
