#!/bin/bash
cd /var/www/chillflix.pw
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=chillflix
export MYSQL_PASSWORD="${MYSQL_PASSWORD:?set in env}"
export MYSQL_DATABASE=chillflix
export NODE_ENV=production
export NEXT_DIST_DIR=.next-embed27
# 1024 leaves headroom for segproxy + unlock pythons on 6GB host (was 1536)
export NODE_OPTIONS="--max-old-space-size=1024"
# Cap concurrent VA unlocks (each ~40MB + CPU); singleflight still merges duplicates
export VAPLAYER_UNLOCK_MAX_INFLIGHT="${VAPLAYER_UNLOCK_MAX_INFLIGHT:-2}"
exec /usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3002
