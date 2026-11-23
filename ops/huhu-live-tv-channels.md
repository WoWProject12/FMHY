# Huhu Live TV (`huhu.to/#/channels`) on chillflix.lol

## What we learned

Huhu rebuilt Live TV on **mHub Addon Protocol v2** (MediaHubMX / Vuma):

| Step | Endpoint |
|------|----------|
| Addon list | `GET https://huhu.to/mhub-addon.json` → `./live` |
| Live manifest | `GET https://huhu.to/live/mhub-addon.json` |
| Channel catalog | `GET https://huhu.to/live/catalog/live/channels.json?sort=trending` |
| Item + EPG | `GET https://huhu.to/live/item/live/{id}.json` |
| Resolve HLS | `GET https://huhu.to/live/resolve?url=https://huhu.to/live/play/{id}` |

Resolved streams are **HTTP** HLS (`sunshine` CDN). Browsers on HTTPS need a same-origin proxy (Chillflix already has `/api/iptv/live-fetch`).

Legacy `POST /mediaurl-catalog.json` now returns `500` — do not use it.

## What we shipped on chillflix.lol

1. **Huhu catalog client** → mHub v2 GET catalog (`lib/iptv/huhu-iptv-catalog.ts`)
2. **Resolve** → `GET /live/resolve?url=` (`lib/iptv/live-play-proxy.ts`)
3. **Channels API** prefers Huhu (`/api/iptv/channels?source=huhu|live`)
4. **Nginx** IPTV routes no longer prefix `/old` (Next runs without `basePath`); added `/iptv`, `/channels`→`/iptv`, `/iptv-fetch`, `/iptv-play`
5. **Nav** “Live TV” → `/iptv`

## URLs

- UI: https://www.chillflix.lol/iptv (also `/channels`)
- API: https://www.chillflix.lol/api/iptv/channels?source=huhu
- Play: https://www.chillflix.lol/api/iptv/live/{id}/index.m3u8

## Patches in this repo

- `ops/patches/huhu-iptv-catalog.mhub-v2.ts`
- `ops/patches/live-play-proxy.huhu-mhub-v2.ts`
- `ops/patches/iptv-channels-route.huhu-first.ts`
- `ops/patches/chillflix.lol-iptv.conf`
- `ops/patches/patch-header-livetv-nav.py`
