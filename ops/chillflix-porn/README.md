# Chillflix Porn (custom, no WordPress)

Own PHP catalog at `/porn` on chillflix.lol — Chillflix cinema UI, xvideos scraper + native stream player.

## Layout
- `public/` — web root (`index.php`, assets)
- `lib/` — db, xvideos scrape/stream helpers
- `views/` — Chillflix-styled templates
- `bin/migrate-wp.php` — import existing WP `pornx` posts
- `bin/scrape-xvideos.php` — cron importer

## Deploy (lol origin)
1. Create DB user + apply `schema.sql`
2. Copy tree to `/var/www/chillflix-porn`
3. Write `config.php` from `config.example.php`
4. Point nginx `location ^~ /porn/` at `/var/www/chillflix-porn/public`
5. `WP_DB_PASS=… php bin/migrate-wp.php`
6. Cron: `*/5 * * * * php /var/www/chillflix-porn/bin/scrape-xvideos.php`
7. Set `CFP_ADMIN_PASS` in `config.php` and open `/porn/admin` for stats + scraper speed

WP tree at `/var/www/porn` can stay as backup offline.
