# VAPlayer CDN token inheritance

## Symptom
Tokenized VA masters (`/pl/...?token=JWT`) load, but child playlists and `page-N.html` segments return Cloudflare **403**. JWTs themselves are fine (`ip_cidr` bound to the VPS `/24`, hours of TTL).

## Cause
1. HLS children are absolute-path URIs. `new URL(child, master)` drops the master's `?token=` query.
2. `/api/cinepro/proxy/s/...` sibling rewrites called `signed.search = ""`, wiping the CDN JWT when swapping files.

Without `?token=` on the upstream URL, the CDN returns HTML 403. Master-only requests still 200 with `Origin: https://nextgencloudfabric.com`.

## Fix
- `lib/cinepro/proxy.ts`: inherit `token` / `cast_token` onto proxied absolute URLs; keep those keys in `applyStreamFile`.
- `scripts/segment-proxy.mjs`: same `keepUpstreamAuthQuery` in `applyStreamFile`.

Patches: `ops/patches/cinepro-proxy.ts`, `ops/patches/segment-proxy.mjs`.
