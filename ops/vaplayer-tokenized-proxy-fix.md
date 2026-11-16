# VAPlayer black at 00:00 — tokenized unwrap (2026-11-16)

## Cause
Every live VA unlock returns **tokenized** `/pl/…?token=` masters (1255/1255 in
cache). Those require `Origin: https://nextgencloudfabric.com`. Browsers on
chillflix.* cannot set that header → CDN **403**.

`client-resolve` correctly wrapped streams in `/api/cinepro/proxy`, but
`unwrapVaplayerViewerSource` always stripped the proxy and set
`directClientPlayback` — so the player fetched the CDN from chillflix Origin and
sat black at 00:00 with pause UI (duration from TMDB, e.g. Bridget Jones `95610`).

## Fix
Keep tokenized VA URLs on cinepro proxy (server sets nextgen Origin). Only unwrap
untokenized / kite-style hosts to viewer-direct.

Hard-refresh after `pcv=20261116005938wfiw`.
