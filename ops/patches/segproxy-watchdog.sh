#!/bin/bash
# Auto-recover if segment-proxy concurrency wedges (VAPlayer black-at-zero).
set -euo pipefail
STATS_URL="${SEGPROXY_STATS_URL:-http://127.0.0.1:3003/__segproxy_stats}"
HEALTH_URL="${SEGPROXY_HEALTH_URL:-http://127.0.0.1:3003/health}"
STATE_FILE="${SEGPROXY_WATCH_STATE:-/tmp/segproxy-watch.state}"
LOG="${SEGPROXY_WATCH_LOG:-/var/log/segproxy-watchdog.log}"
PM2_NAME="${SEGPROXY_PM2_NAME:-chillflix-segproxy}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

restart_proxy() {
  echo "$(ts) RESTART $PM2_NAME — $1" | tee -a "$LOG"
  /usr/bin/pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || \
    /usr/bin/pm2 restart "$PM2_NAME" >/dev/null 2>&1 || true
  rm -f "$STATE_FILE"
}

if ! curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
  restart_proxy "health fail"
  exit 0
fi

json=$(curl -fsS -m 3 "$STATS_URL" 2>/dev/null || echo "")
if [[ -z "$json" ]]; then
  restart_proxy "stats empty"
  exit 0
fi

eval "$(python3 -c 'import json,sys
d=json.loads(sys.argv[1])
print("GA=%d" % int(d.get("globalActive") or 0))
print("GW=%d" % int(d.get("globalWaiters") or 0))
print("HA=%d" % int(d.get("hostActive") or 0))
print("HW=%d" % int(d.get("hostWaiters") or 0))
print("GL=%d" % int((d.get("limits") or {}).get("global") or 64))
' "$json")"

WEDGED=0
if (( GW >= 64 && GA >= GL )); then WEDGED=1; fi
if (( HA > (GL * 4) )); then WEDGED=1; fi
if (( HW >= 128 && GA >= GL )); then WEDGED=1; fi

if (( WEDGED == 1 )); then
  count=1
  if [[ -f "$STATE_FILE" ]]; then
    count=$(( $(cat "$STATE_FILE" 2>/dev/null || echo 0) + 1 ))
  fi
  echo "$count" > "$STATE_FILE"
  echo "$(ts) wedge signal ga=$GA gw=$GW ha=$HA hw=$HW count=$count" | tee -a "$LOG"
  if (( count >= 2 )); then
    restart_proxy "confirmed wedge ga=$GA gw=$GW ha=$HA hw=$HW"
  fi
else
  rm -f "$STATE_FILE"
fi
