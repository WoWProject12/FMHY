# Disable MeowTV Puppeteer + remove unused v2 player (2026-11-16)

## MeowTV
MeowTV still used `meowtv-assist` + Puppeteer/Chromium. Under real traffic that
is easy to abuse and expensive (chrome storms already spiked host load earlier).

Done live:
- `stream_sources_config` MySQL: `meowtv.enabled=false`
- JSON mirrors updated; cinepro scrape allowlist synced to
  `rivestream,vidmoly,cineverse` (no meowtv)
- `pm2 delete meowtv-assist`; Chromium processes killed
- Public `/api/stream-sources` no longer lists MeowTV in `enabledIds`

## V2 player
Unused by the current cinema/embed build. Removed source and blocked routes:

- Moved off tree: `app/v2`, `app/api/v2`, `components/v2-player.tsx`,
  `hooks/useStreams.ts` → `/var/www/chillflix.pw/backups/v2-removed-*`
- nginx `/v2`, `/v2/embed`, `/api/v2/` → **410**
- Player build `.next-embed36` has no v2 routes in the manifest

Live: `pcv=20261116054717nomeowv2`
