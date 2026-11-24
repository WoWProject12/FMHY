# Adcash not showing on chillflix.lol

## Cause
Anti-adblock rotation stored `adcashLibSrc` as `/cdn/<hash>.js` (chillflix.pw path).
On www.chillflix.lol that URL 404d, so the Adcash script never loaded.

## Fix
- `MovyAds::lolAdcashLibUrl()` serves `/assets/js/<local-hash>.js` or `/chillflix-adcash-lib.js`
- nginx `location ^~ /cdn/` aliases to `/var/www/chillflix.lol/public/cdn/`
- rotate sync script keeps the .lol alias/cdn copies updated
