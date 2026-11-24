# Auto past unready VAPlayer → 7Movies

## Problem
1. VAPlayer CDN URLs first-won Auto and blocked 7Movies.
2. Demoted VA rows still won `pickPreferred` via `!requiresProbe`.
3. Probe overlay used PLACEHOLDER with `enabled:false` + gated on `streamSourcesLoading`, so the UI showed empty **Still searching...** with no VAPlayer/7Movies rows.
4. Old `pcv` / `.next-current`→embed42 hid earlier deploys.

## Fix
- Soft-demote only vaplayer when settle is not ready; 7Movies first-wins on URLs.
- Skip demoted providers in pickPreferred; wait on VA while scanning.
- PLACEHOLDER keeps default enabled catalog; show probe list while stream-sources loads.
- Live: `.next-embed45`, `pcv=20261124T1922Z7m`.
