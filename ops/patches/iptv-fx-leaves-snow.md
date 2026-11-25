# IPTV leaves/snow FX

## Cause
`iptv-live.css` force-hid `.aurora-leaves` / `.aurora-snow` on `body.page-iptv`, so admin site FX + user prefs never showed on `/iptv` even though `layout.php` mounts the canvases and loads `leaves.js` / `snow.js`.

## Fix (live on chillflix.lol origin)
Removed leaves/snow from the IPTV hide rule (kept `.huhu-dock` hidden). Cache-bust `iptv.php` `?v=48fx`.

Trees:
- `/var/www/chillflix/web/public/new/assets/css/iptv-live.css`
- `/var/www/chillflix-lol-toflix/public/new/assets/css/iptv-live.css`
- views: `.../views/iptv.php`
