# Ads + embedders (2026-11-15)

## Do ads on .pw come from chillflix.lol admin?
Yes — same MySQL `site_settings.embed_ads_config` on the player host.
Admin UI: `/admin/embed-ads` (owner). Player reads it via `/api/embed/ads`.

Toggles cover Adcash on chillflix.pw embeds, Monetag zones, vignette, domain allow/block, per-embedder rules, admin bypass (lol/toflix/vuflix).

## Bug fixed
`/api/embed/ads` was **missing** from nginx locations → fell through to
`location /` → 301 `chillflix.lol/player-api`. Embeds could not load ad config.
Also exposed `/api/admin/embed-ads` on the player origin for admin control.

## Embedders list
First-party list is `/api/internal/embed-stats` (key `EMBED_STATS_KEY`) →
`embed-analytics` on :3875. Currently returns ~25 embedders (toflix, vuflix, …).
Admin Analytics “live embed parents” is **GA4** (`embed_parent` dimension) and
stays empty if that custom dimension is not registered — different from the
internal embed-stats list.
