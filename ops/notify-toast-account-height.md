# Notify toast + account notifications panel

## Bugs
1. **Popup toast missing on normal site** — `#notifyToast` sat under `#siteHeader`; guest HTML cache + toast “seen” state also hid retries. Admin skipped HTML cache so it looked fine there (and often at the top).
2. **Account → Notifications height jump** — notify view grew taller than the account dropdown.
3. **Toast styling** — keep Chillflix gold (`#e8dcc8`), friendly copy, not random accent colors.

## Fix (live on chillflix.lol)
- Toast z-index `2147483646`, dock/account anchoring (above mobile dock / near account).
- Lock `.acct-menu-panel` to account-home height via `--acct-panel-h`.
- Toast copy: “You have a new notification” + title + “Want to check it out?” / CTA **Check it out** (gold).
- Cache bust: `MOVY_BUILD=20261123notif17goldcheck1`

## Files
- `public/new/assets/js/movy.js`
- `public/new/assets/css/bridge.css`
- `public/new/views/layout.php`
- Patch mirrors: `ops/patches/{movy-notify.js,bridge-notify.css,notify-toast.html}`
