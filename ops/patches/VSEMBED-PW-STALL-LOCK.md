# VSEmbed mid-play stall lock (chillflix.pw)

## Problem
On www.chillflix.pw, VSEmbed unlocks and plays, then brief HLS stalls triggered
`quietBackgroundStallCheck` which re-unlocked + remounted the player
(black flash → "finds source" again). Other titles looked fine when their CDN
did not stall.

## Fix (live on pw)
File: `/var/www/chillflix.pw/components/cinepro-watch-player.tsx`
Build: `.next-embed36` (restarted `chillflix-embed`, `chillflix-player`, `chillflix-player-b`)

- Skip quiet stall remount when `playbackStable` / `playbackActive`
- Freeze MediaPlayer key urlFp to `"locked"` once settled
- Latch playing URL via `lockedPlaybackUrlRef`
- Block stuckOnScrape upgrades after >=2s real progress

## Verify
Hard-refresh embed, play VSEmbed, confirm no mid-play remount loop.
Unlock API still: `http://127.0.0.1:3017/unlock` via `/api/vsembed/unlock`.
