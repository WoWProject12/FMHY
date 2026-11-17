# Admin still seeing first-click popup

## Cause
1. chillflix.lol HTML microcache skipped only `chillflix_session` / `toflix_session` — not the real auth cookie `movy_new_token`. Logged-in admins often received **guest-cached** watch HTML with Adcash armed.
2. Staff hard-block in `<head>` could not see PHP auth yet: `setcookie('movy_staff')` ran **after** HTML started (cookie never set), cookie regex was double-escaped (`\\s` → never matched), and body `data-auth-*` does not exist during the first head script.
3. Adcash can reassign `window.open` after a soft block, so a late staff detect still left pops working.

## Fix
- `/etc/nginx/conf.d/chillflix-html-cache.conf`: bypass on `movy_new_token` **and** `movy_staff`.
- `layout.php` (live `MOVY_BUILD=20261116adminads3`):
  - Resolve `MovyAuth::currentUser()` **before** `<!DOCTYPE>`; `setcookie('movy_staff=1')` while headers are still open.
  - Inject `var serverNoAds = 1` into the first head script for owner/admin (and when admin Ads panel has Adcash/player off).
  - Lock `window.open` via `Object.defineProperty` so Adcash cannot re-enable external pops.
  - `__movyAdsApply` prefers body `data-auth-role` / `movy_staff` over a stale `localStorage` `user` role.
- `MovyAuth::setTokenCookie` / `clearTokenCookie`: maintain readable `movy_staff` for owner/admin.
- Player boot `/cdn/3mbzf6w7.js`: `window.open` no-ops once `__cfNoAds` / `noads=1` is set.
- Staff hydrate still tears down Adcash and stamps `noads=1` on player iframes.

## Live verify
- Owner session HTML: `serverNoAds = 1`, `Set-Cookie: movy_staff=1`, `__movyAdsCfg.skip=true`, `adcash.on=false`, embed URLs include `noads=1`.
- Guest HTML: `serverNoAds = 0`, adcash can still arm (site Adcash toggle remains on until disabled in Admin → Ads).
- `https://www.chillflix.pw/embed/movie/550?noads=1` → `showAds:false` (no `/cdn/*` Adcash scripts).
