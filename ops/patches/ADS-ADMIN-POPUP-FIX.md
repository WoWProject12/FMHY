# Admin still seeing first-click popup

## Cause
chillflix.lol HTML microcache skipped only `chillflix_session` / `toflix_session` cookies — not the real auth cookie `movy_new_token`. Logged-in admins often received **guest-cached** watch HTML with Adcash armed (`data-auth-no-ads` empty). Client role in `localStorage` arrived too late; first player click still opened a pop.

## Fix
- `/etc/nginx/conf.d/chillflix-html-cache.conf`: bypass cache when `movy_new_token` is present; purge `chillflix_fcgi`.
- `layout.php`: `__movyAdsUserAllowed` also reads `data-auth-role`; staff kill script tears down Adcash and stamps `noads=1` on player iframes as soon as role hydrates.
- Player boot `/cdn/3mbzf6w7.js`: `window.open` no-ops once `__cfNoAds` / `noads=1` is set.
