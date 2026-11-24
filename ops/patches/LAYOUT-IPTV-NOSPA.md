# Live TV full-page navigation

Soft-nav left `/iptv` stuck on Loading because `iptv-live.js` never re-booted after SPA content swap.

Fixes:
- `isIptvPath()` in layout soft-nav click handler — full browser load for `/iptv` and `/channels`
- `data-no-spa="1"` on dock Live link and header Live TV link
- Always `renderList()` after channels load (no stuck Loading status after player resume)
- CSS `[hidden]` respected on player/list views
