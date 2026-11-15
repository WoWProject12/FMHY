# Ads + embedders (2026-11-15)

## Do ads on .pw come from chillflix.lol admin?
Yes — same MySQL `site_settings.embed_ads_config` on the player host.
Admin UI: `/admin/ads` (PHP) syncs via `MovyAds::syncPlayerEmbedAds`.
Player reads it via `/api/embed/ads` (nginx location required on .pw).

## Why zetmoon (and similar) could not embed
Not a global iframe/CSP outage. `/embed/*` allows `frame-ancestors *`.

Nginx `auth_request` → embed-analytics `/embed-gate` returns **403** when the
parent host is in `embed-host-blocklist.json` (admin **Block** on Embedders).

Blocked earlier for `ads_sandbox` by `admin@gmail.com`:
- zetmoon.live
- netplayz.top
- netplayz.icu

Chrome shows that plain 403 as “webpage might be temporarily down” inside the iframe.

**Fix applied:** unblocked all three. Zetmoon embed → 200 again. Blocked response
is now HTML explaining admin Embedders unblock (instead of opaque plain text).

## Embedders list on .lol admin
PHP `MovyEmbedders` → `https://www.chillflix.pw/api/internal/embed-stats`
(key `EMBED_STATS_KEY`, SSL verify off, resolve to player IP).

Was empty when cold stats scans (~28s) hit nginx 499 / browser 20s abort.
Player side now serves disk/SWR cache (hot ~1ms). On .lol: PHP timeout 45s,
admin.js fetch 45s, `MOVY_BUILD=20261115embedfix1` cache bust.

Hard-refresh `/admin/embedders` — expect ~24 hosts (toflix, vuflix, …).
