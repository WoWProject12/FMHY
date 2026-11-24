# Hosted IPTV logos

Logos are downloaded to the live site:

- `/var/www/chillflix-lol-toflix/public/new/assets/img/iptv-logos/` (~2.1k files)
- Map: `assets/data/iptv-tvg-logos.json` (`hosted: true`) points at `/assets/img/iptv-logos/...`
- Rebuild/download: `/var/www/chillflix/data/iptv-logo-host/host-logos.py`

External URLs are only kept for the small residual that failed to download; the client/API still fall back to the logo proxy for those.
