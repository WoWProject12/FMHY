# 7Movies “doesn’t return” — nginx 502 (fixed 2026-11-15)

## Root cause
Browser calls same-origin `/api/7movies/client-meta?tmdbId=…`.  
Nginx had:

```nginx
location = /api/7movies/client-meta {
    proxy_pass http://127.0.0.1:3027;  # sevenmovies-assist
}
```

`sevenmovies-assist` / `sevenmovies-boot` are **stopped**, and nothing listens on `:3027`.  
Cloudflare then returned **502** in ~100ms → client `if (!r.ok) return []` → 7Movies never appears in Sources.

Local Next on `:3002` still had healthy cached streams (`resolveMode: vps-boot`).

## Fix (live)
Point the exact location at the player upstream (same as `/api/7movies/`):

```nginx
location = /api/7movies/client-meta {
    # sevenmovies-assist :3027 is stopped; use Next player route (cached).
    proxy_pass http://chillflix_player;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 90s;
}
```

File: `/etc/nginx/snippets/chillflix.pw-locations.conf`  
Also bumped embed `pcv=202611151913227mfix2` so clients pick the MP4-preferring chunk.

## Verify
```bash
curl -sS 'https://www.chillflix.pw/api/7movies/client-meta?tmdbId=1339713&type=movie' | jq '.streams|length'
# expect 8 (MP4 dubs first, HEVC Original last)
```

Hard-refresh the embed after the pcv bump.
