# Episodes picker shows "No episodes" (SVU / tv/2734)

## Cause
Sidebar seasons load from `GET /api/tv/{id}` which nginx proxies to the player.

Episode rows load from `GET /api/tv/{id}/season/{n}`. Nginx only matched
`^/api/tv/[0-9]+$`, so season URLs fell through to `location /` →
`301 https://www.chillflix.lol/player-api` (HTML). The client then set
`episodes = []` and showed **No episodes**, while season counts still looked fine.

## Fix
In `/etc/nginx/snippets/chillflix.pw-locations.conf`, match season paths too:

```
location ~ ^/api/tv/[0-9]+(?:/season/[0-9]+)?$ {
```

Reload nginx.
