# Ads + embedders (2026-11-15)

## Do ads on .pw come from chillflix.lol admin?
Yes — same MySQL `site_settings.embed_ads_config` on the player host.
Admin UI: `/admin/ads` (PHP) syncs via `MovyAds::syncPlayerEmbedAds`.
Player reads it via `/api/embed/ads` (nginx location required on .pw).

## Embedders → Block (Chillflix advertise gate)
Admin **Block** writes the parent host into `embed-host-blocklist.json`
(`hosts` + `gateHosts`).

Intended UX: load the embed, then show the in-player **“Watch free on Chillflix”**
overlay (same gate used when a site sandboxes/blocks Chillflix ads) and kill
`<video>` playback — not a Chrome “temporarily down” dead iframe.

### Why Block looked broken
1. Nginx `auth_request` **hard-403** when Referer matched the blocklist → embed
   HTML/beacon never loaded → overlay could not show (Chrome “page down”).
2. Many parents strip Referer → hard-403 never fired → streams kept playing, and
   beacon had `embedHost=(unknown)` so `/api/analytics/gate-check` never ran.

### Fix
- `/embed-gate` always **204** (no hard kill of the shell).
- `gate-check` treats `hosts` **or** `gateHosts` as force-gate.
- `embed-beacon.js` detects parent via `location.ancestorOrigins` (Chrome) when
  Referer is missing; busted as `embed-beacon.js?v=adgate10`.
- Overlay still pauses/detaches media and shows Chillflix CTA.

Verify: Block host in `/admin/embedders` → open that site’s embed → within ~1s
see Chillflix gate; `GET /api/analytics/gate-check?host=…` returns `"gate":true`.

## Embedders list on .lol admin
PHP `MovyEmbedders` → `https://www.chillflix.pw/api/internal/embed-stats`.
Hardened timeouts + player SWR cache. Hard-refresh `/admin/embedders`.
