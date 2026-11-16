# Ads: first-click blank popup + Adcash `/cdn/` rotation

## Causes
1. `embed-beacon.js` `gestureProbe` always did `window.open("about:blank")` on the first player click (analytics only) — looks like a popup with no ad.
2. `installEmbedPopupDelegate()` armed even when `showAds` was false, and a gesture fallback opened `/embed/ads-park` when Adcash never armed.
3. Player anti-adblock lib stayed pinned at `/cdn/5367ztx5.js` — rotate cron/helpers were missing, so Brave/EasyList could block the fixed URL.
4. chillflix.lol admin sync only flipped `adcashEnabled`, not `sitePlayerEnabled`, so “ads off” in admin could still leave iframe `showAds=true`.

## Fixes (live)
- Beacon: passive gesture probe (no `window.open`).
- EmbedForcedAds + compiled chunk: install popup delegate only when `showAds`.
- Delegate: removed empty first-click ads-park gesture fallback.
- PW: `/usr/local/sbin/chillflix-pw-adcash-rotate` + cron every 5m (content refresh + filename rotate ~60m) updating MySQL `embed_ads_config.adcashLibSrc`.
- LOL: restored `/usr/local/sbin/chillflix-adcash-rotate` (SSH to pw) + auto-rotate-check; `MovyAds::syncPlayerEmbedAds` also sets `sitePlayerEnabled`.
