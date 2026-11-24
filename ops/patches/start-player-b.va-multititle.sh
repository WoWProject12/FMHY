#!/bin/bash
cd /var/www/chillflix.pw
set -a
# shellcheck disable=SC1091
[ -f .env.local ] && . ./.env.local
set +a
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER="${MYSQL_USER:-chillflix}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-lhPU2B4n7lbuKuqUt8JSlmhe}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-chillflix}"
export NODE_ENV=production
export NEXT_DIST_DIR=.next-embed36
export NODE_OPTIONS="--max-old-space-size=640"
export VAPLAYER_RESOLVE_SHED=0
export VAPLAYER_RESOLVE_SOFT_MS="${VAPLAYER_RESOLVE_SOFT_MS:-8000}"
export VAPLAYER_UNLOCK_MAX_INFLIGHT="${VAPLAYER_UNLOCK_MAX_INFLIGHT:-2}"
export VAPLAYER_UNLOCK_WAITERS_MAX=32
export VAPLAYER_UNLOCK_SLOT_WAIT_MS="${VAPLAYER_UNLOCK_SLOT_WAIT_MS:-15000}"
export EMBED_STATS_KEY="${EMBED_STATS_KEY:-cf-embed-stats-7f3a9c}"
exec /usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3029
