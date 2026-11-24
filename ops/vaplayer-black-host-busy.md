# VAPlayer black at 00:00 — prevent recurrence

## Symptom
Pause UI + 1080p + duration, but video stuck at `00:00:00` (e.g. `tv/276161`).

## Cause
Playlists loaded; **segments** hit `segment-proxy` (`chillflix-segproxy` / `:3003`).
A `Promise.all([global, host])` acquire leaked slots when host wait timed out →
proxy wedged (`host busy` / global full) → black frame.

## Prevention (live)

1. **Fix leak** — sequential acquire + rollback on reject.
2. **Reclaim every 5s** — force-drain global/host when waiters pile up at cap.
3. **Watchdog cron** (`/usr/local/sbin/segproxy-watchdog.sh`, every minute via
   `/etc/cron.d/chillflix-segproxy-watchdog`) — if health/stats look wedged for
   2 consecutive checks, `pm2 restart chillflix-segproxy`.
4. Process owned by **PM2** `chillflix-segproxy` (not a competing systemd unit).

## Patches
- `ops/patches/segment-proxy-slot-leak-fix.mjs.snippet`
- `ops/patches/segproxy-watchdog.sh`
