# Live dock stays active after leaving /iptv

Soft-nav `syncNav()` mapped dock labels Home/Movies/Shows/Anime/Search but **skipped** `aria-label="Live TV"`.
After a full load of `/iptv` (Live active), soft-nav to Home added Home active and never cleared Live.

Fix in layout soft-nav:
- `navKey()` recognizes `/iptv` and `/channels` → `iptv`
- dock map includes `'Live TV': 'iptv'`
- header link sync recognizes `/iptv`
