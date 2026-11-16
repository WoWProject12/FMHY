# to.vidsrc.party scraper block (2026-11-16)

## Goal
IP **`88.218.196.122`** scrapes chillflix.pw APIs by TMDB id with forged
chillflix Referer. For every such request we return a **fake playable stream**
that is the Chillflix advertise slate (not real movie/TV), so their JWPlayer
plays “Watch free on Chillflix / chillflix.lol”.

## Live defenses
1. Nginx **deny** `88.218.196.122` on sources / vaplayer / 4k / provider proxies.
2. `error_page 403 = @chillflix_scraper_advertise` → **sources-shaped** JSON with:
   - HLS: `https://www.chillflix.pw/stream/v1/cf/master-jpg.m3u8`
     (`.jpg`-named TS segments — same pattern their working upstreams use)
   - MP4 fallback: `https://www.chillflix.pw/stream/v1/cf/720/source.mp4`
3. Per-IP apicache key so they cannot reuse other viewers’ real source HITs.
4. Node `assertIpNotBlocked` same payload.

Do **not** put `advertise` in the stream URL path — their backend was probing
`/advertise/...` then failing JW setup. Neutral `/stream/v1/cf/...` paths are
ingested (master + playlist + `.jpg` segs + full MP4 observed in logs).

## Verify
```bash
# temp: deny 127.0.0.1 in chillflix-scraper-deny.conf
curl -sS -H 'Host: www.chillflix.pw' -H 'Accept-Encoding: identity' \
  'http://127.0.0.1/api/cinepro/sources?type=movie&tmdbId=155'
# sources[0].url → .../stream/v1/cf/master-jpg.m3u8
```

Hard-refresh the vidsrc embed after changes (their `/api/play` caches jobs).
