# Public Sources: city decoys only (no scraper brands)

## Bug
Public viewers could see brands in the Sources list, e.g. `Seattle · 7Movies` / Videasy / Vidmoly. That came from an intentional exception in `MovyPlayerSkin.sourceSlotLabel` that appended the real name for those three providers “so taps felt less broken.”

## Policy
- **Public:** city decoys only (Miami, Boise, Seattle, …), plus optional `· 4K`.
- **Admin/owner on chillflix.lol:** real scraper names via `show_real=1` / `__toflixRealNames` (already gated in Movy PHP/`movy.js`).

## Fix (live)
1. `MovyPlayerSkin.tsx` + chunks `8887-*`: public label = city only.
2. `useSourceLoadingProgress`: default `showRealProviderNames` **false** (was true).
3. `cinepro-watch-player` + chunk `4809`: “Starting …” uses `resolveProviderUserLabel` (city/Alpha for public).
4. Cache bust: `pcv=20261116002429wjgi`.
