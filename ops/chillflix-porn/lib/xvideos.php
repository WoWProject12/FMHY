<?php
declare(strict_types=1);

function cfp_xv_http_get(string $url, int $timeout = 25): string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
            'Expect:',
        ],
        CURLOPT_REFERER => 'https://www.xvideos.com/',
    ]);
    $html = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($html === false || $code >= 400) {
        return '';
    }
    return (string) $html;
}

function cfp_xv_build_list_url(string $categorySlug = '', int $page = 0, string $keyword = ''): string
{
    $page = max(0, $page);
    $keyword = trim($keyword);
    if ($keyword !== '') {
        $url = 'https://www.xvideos.com/?k=' . rawurlencode($keyword);
        if ($page > 0) {
            $url .= '&p=' . $page;
        }
        return $url;
    }
    $slug = strtolower(trim($categorySlug));
    $slug = preg_replace('/\s+/', '-', $slug) ?? '';
    $slug = preg_replace('/[^a-z0-9\-_]/', '', $slug) ?? '';
    if ($slug === '' || $slug === 'category' || $slug === '0') {
        return $page > 0 ? 'https://www.xvideos.com/new/' . $page : 'https://www.xvideos.com/';
    }
    return 'https://www.xvideos.com/tags/' . rawurlencode($slug) . '/' . $page;
}

/**
 * @return list<array{id:string,title:string,duration:string,thumb:?string,href:string,actors:string}>
 */
function cfp_xv_parse_listing(string $html, int $limit = 48, string $tagHint = ''): array
{
    $limit = max(1, min(100, $limit));
    $results = [];
    if ($html === '') {
        return $results;
    }

    if (!preg_match_all(
        '/<div[^>]*\bid="video_([a-zA-Z0-9]+)"[^>]*\bdata-id="(\d+)"[^>]*class="[^"]*thumb-block[^"]*"[^>]*>(.*?)<\/div>\s*<script>xv\.thumbs\.prepareVideo/s',
        $html,
        $blocks,
        PREG_SET_ORDER
    )) {
        if (!preg_match_all(
            '/<div[^>]*\bid="video_([a-zA-Z0-9]+)"[^>]*\bdata-id="(\d+)"[^>]*>(.*?)<script>xv\.thumbs\.prepareVideo/s',
            $html,
            $blocks,
            PREG_SET_ORDER
        )) {
            return $results;
        }
    }

    $seen = [];
    foreach ($blocks as $block) {
        $eid = $block[1];
        $vid = $block[2];
        $chunk = $block[3];
        if (isset($seen[$vid])) {
            continue;
        }
        $seen[$vid] = true;

        $title = '';
        if (preg_match('/<a[^>]+title="([^"]+)"/i', $chunk, $m)) {
            $title = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        } elseif (preg_match('/<p class="title">.*?<a[^>]*>([^<]+)/is', $chunk, $m)) {
            $title = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }
        if ($title === '') {
            continue;
        }

        $href = '';
        if (preg_match('/href="(\/video\.[^"]+)"/i', $chunk, $m)) {
            $href = 'https://www.xvideos.com' . $m[1];
        } else {
            $href = 'https://www.xvideos.com/video.' . $eid . '/';
        }

        $thumb = null;
        if (preg_match('/data-src="(https?:\/\/[^"]+)"/i', $chunk, $m)) {
            $thumb = $m[1];
        } elseif (preg_match('/src="(https?:\/\/[^"]*xvideos-cdn[^"]+)"/i', $chunk, $m)) {
            $thumb = $m[1];
        }
        if (is_string($thumb) && str_starts_with($thumb, 'http://')) {
            $thumb = 'https://' . substr($thumb, 7);
        }

        $duration = '0:00';
        if (preg_match('/class="duration"[^>]*>([^<]+)</i', $chunk, $m)) {
            $duration = trim($m[1]);
        }

        $actors = '';
        if (preg_match('/class="name"[^>]*>([^<]+)</i', $chunk, $m)) {
            $actors = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        $results[] = [
            // Prefer public alphanumeric key for embeds; keep numeric as fallback id.
            'id' => (string) $vid,
            'public_id' => (string) $eid,
            'title' => $title,
            'duration' => $duration,
            'thumb' => $thumb,
            'href' => $href,
            'actors' => $actors,
            'tag' => $tagHint,
        ];
        if (count($results) >= $limit) {
            break;
        }
    }
    return $results;
}

/**
 * Extract the public xvideos key (e.g. ufuildf89e8) from a watch/embed URL.
 * Numeric-only ids no longer resolve on embedframe/video pages.
 */
function cfp_xv_key_from_url(?string $url): string
{
    $url = trim((string) $url);
    if ($url === '') {
        return '';
    }
    if (preg_match('#/(?:video|embedframe)\.([a-zA-Z0-9]+)#', $url, $m)) {
        return $m[1];
    }
    if (preg_match('#/embedframe/([a-zA-Z0-9]+)#', $url, $m)) {
        return $m[1];
    }
    return '';
}

/**
 * @return array{high?:string,low?:string,hls?:string,poster?:string,qualities?:list<array>}|null
 */
function cfp_xv_parse_streams(string $body): ?array
{
    if ($body === '' || stripos($body, 'Not found') !== false) {
        return null;
    }
    $pick = static function (string $name) use ($body): string {
        // single- or double-quoted helper args
        $pattern = '/' . preg_quote($name, '/') . "\\((['\\\"])(.*?)\\1\\)/s";
        if (!preg_match($pattern, $body, $m)) {
            return '';
        }
        return str_replace('http:', 'https:', html_entity_decode($m[2], ENT_QUOTES));
    };
    $streams = array_filter([
        'high' => $pick('setVideoUrlHigh'),
        'low' => $pick('setVideoUrlLow'),
        'hls' => $pick('setVideoHLS'),
        'poster' => $pick('setThumbUrl169'),
    ]);
    if (empty($streams['high']) && empty($streams['hls']) && empty($streams['low'])) {
        return null;
    }
    if (!empty($streams['hls'])) {
        $qualities = cfp_xv_hls_qualities((string) $streams['hls']);
        if ($qualities) {
            $streams['qualities'] = $qualities;
        }
    }
    return $streams;
}

/**
 * Resolve HLS master playlist into a quality ladder (250p…4K when available).
 * @return list<array{id:string,label:string,height:int,url:string,type:string}>
 */
function cfp_xv_hls_qualities(string $masterUrl): array
{
    $masterUrl = trim($masterUrl);
    if ($masterUrl === '') {
        return [];
    }
    $body = cfp_xv_http_get($masterUrl, 12);
    if ($body === '' || stripos($body, '#EXTM3U') === false) {
        return [];
    }
    $base = preg_replace('#/[^/]*$#', '/', $masterUrl) ?? $masterUrl;
    $out = [];
    $lines = preg_split('/\R/', $body) ?: [];
    $pending = null;
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        if (str_starts_with($line, '#EXT-X-STREAM-INF:')) {
            $height = 0;
            $name = '';
            if (preg_match('/RESOLUTION=\d+x(\d+)/i', $line, $m)) {
                $height = (int) $m[1];
            }
            if (preg_match('/NAME="([^"]+)"/i', $line, $m)) {
                $name = trim($m[1]);
            }
            $pending = ['height' => $height, 'name' => $name];
            continue;
        }
        if ($pending === null || str_starts_with($line, '#')) {
            continue;
        }
        $url = $line;
        if (!preg_match('#^https?://#i', $url)) {
            $url = $base . ltrim($url, '/');
        }
        $height = (int) ($pending['height'] ?? 0);
        $label = (string) ($pending['name'] ?? '');
        if ($label === '' && $height > 0) {
            if ($height >= 2160) {
                $label = '4K';
            } elseif ($height >= 1440) {
                $label = '2K';
            } else {
                $label = $height . 'p';
            }
        }
        if ($label === '') {
            $label = 'Auto';
        }
        // Prefer height from label like "1080p" when RESOLUTION missing
        if ($height < 1 && preg_match('/(\d{3,4})\s*p/i', $label, $m)) {
            $height = (int) $m[1];
        }
        if ($height >= 2160) {
            $label = '4K';
        } elseif ($height >= 1440) {
            $label = '2K';
        }
        $id = 'hls-' . ($height > 0 ? $height : preg_replace('/\W+/', '', strtolower($label)));
        $out[] = [
            'id' => $id,
            'label' => $label,
            'height' => $height,
            'url' => $url,
            'type' => 'hls',
        ];
        $pending = null;
    }
    usort($out, static fn(array $a, array $b): int => ($a['height'] <=> $b['height']));
    // de-dupe by height/label
    $seen = [];
    $unique = [];
    foreach ($out as $q) {
        $key = $q['height'] > 0 ? (string) $q['height'] : $q['label'];
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $unique[] = $q;
    }
    return $unique;
}

/**
 * @return array{high?:string,low?:string,hls?:string,poster?:string}|null
 */
function cfp_xv_fetch_streams(PDO $pdo, string $videoId): ?array
{
    // Accept numeric partner ids and alphanumeric public keys.
    $videoId = preg_replace('/[^a-zA-Z0-9]/', '', $videoId) ?? '';
    if ($videoId === '') {
        return null;
    }

    $st = $pdo->prepare('SELECT payload_json, expires_at FROM stream_cache WHERE video_id = ?');
    $st->execute([$videoId]);
    $cached = $st->fetch();
    if ($cached && strtotime((string) $cached['expires_at']) > time()) {
        $decoded = json_decode((string) $cached['payload_json'], true);
        if (is_array($decoded)) {
            // Older cache only had 240/360 mp4 — fill HLS ladder when missing
            if (empty($decoded['qualities']) && !empty($decoded['hls'])) {
                $decoded['qualities'] = cfp_xv_hls_qualities((string) $decoded['hls']);
                if (!empty($decoded['qualities'])) {
                    try {
                        $pdo->prepare(
                            'UPDATE stream_cache SET payload_json = ? WHERE video_id = ?'
                        )->execute([json_encode($decoded, JSON_UNESCAPED_SLASHES), $videoId]);
                    } catch (Throwable $e) {
                        // ignore cache refresh failure
                    }
                }
            }
            return $decoded;
        }
    }

    $tracking = '';
    $row = $pdo->prepare('SELECT tracking_url, embed FROM videos WHERE video_id = ? LIMIT 1');
    $row->execute([$videoId]);
    $meta = $row->fetch();
    if ($meta) {
        $tracking = (string) ($meta['tracking_url'] ?? '');
    }

    $publicKey = cfp_xv_key_from_url($tracking);
    if ($publicKey === '') {
        $publicKey = cfp_xv_key_from_url((string) ($meta['embed'] ?? ''));
    }
    // If the client already passed an alphanumeric key, use it directly.
    if ($publicKey === '' && preg_match('/[a-zA-Z]/', $videoId)) {
        $publicKey = $videoId;
    }

    $candidates = [];
    if ($publicKey !== '') {
        $candidates[] = 'https://www.xvideos.com/embedframe/' . rawurlencode($publicKey);
    }
    if ($tracking !== '') {
        $candidates[] = $tracking;
    }
    // Legacy numeric paths (usually 404 now, kept as last resort).
    if (ctype_digit($videoId)) {
        $candidates[] = 'https://www.xvideos.com/embedframe/' . $videoId;
        $candidates[] = 'https://www.xvideos.com/video.' . $videoId . '/';
    }

    $streams = null;
    foreach (array_unique($candidates) as $url) {
        $streams = cfp_xv_parse_streams(cfp_xv_http_get($url));
        if ($streams) {
            break;
        }
    }
    if (!$streams) {
        return null;
    }

    $ttl = 6 * 3600;
    foreach (['high', 'low', 'hls'] as $k) {
        if (empty($streams[$k])) {
            continue;
        }
        if (preg_match('/,(\d{10})\b/', (string) $streams[$k], $tm)) {
            $left = ((int) $tm[1]) - time() - 120;
            if ($left > 60) {
                $ttl = min($ttl, $left);
            }
        }
    }
    $expires = date('Y-m-d H:i:s', time() + max(60, $ttl));
    $up = $pdo->prepare('INSERT INTO stream_cache (video_id, payload_json, expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), expires_at=VALUES(expires_at)');
    $up->execute([$videoId, json_encode($streams, JSON_UNESCAPED_SLASHES), $expires]);
    return $streams;
}

/**
 * Parse models / channel / keyword tags from an xvideos watch HTML page.
 * @return array{people:list<array{name:string,slug:string,role:string}>,tags:list<string>}
 */
function cfp_xv_parse_video_page_meta(string $html): array
{
    $people = [];
    $tags = [];
    $seenPeople = [];
    $seenTags = [];
    if ($html === '') {
        return ['people' => [], 'tags' => []];
    }

    $addPerson = static function (string $href, string $name, string $roleHint) use (&$people, &$seenPeople): void {
        $name = trim(html_entity_decode(strip_tags($name), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $name = preg_replace('/\s+/', ' ', $name) ?? $name;
        if ($name === '') {
            return;
        }
        $href = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $slug = '';
        $role = ($roleHint === 'channel') ? 'channel' : 'model';
        // URL path is the source of truth: channels/groups vs real people
        if (preg_match('~/(?:channels|amateur-channels)/([^/?#]+)~i', $href, $m)) {
            $slug = strtolower($m[1]);
            $role = 'channel';
        } elseif (preg_match('~/(?:models|amateurs|profiles|pornstar(?:s)?)/([^/?#]+)~i', $href, $m)) {
            $slug = strtolower($m[1]);
            $role = 'model';
        } elseif (preg_match('~^/([a-z0-9][a-z0-9\-_]+)$~i', $href, $m)) {
            // Bare profile path used by channel uploaders (e.g. /pornporn851)
            $slug = strtolower($m[1]);
            if ($roleHint === 'channel') {
                $role = 'channel';
            }
        }
        if ($slug === '') {
            $slug = cfp_slug($name);
        }
        $key = $slug !== '' ? $slug : strtolower($name);
        if (isset($seenPeople[$key])) {
            // Prefer model role if the same slug was first seen as channel by mistake
            if ($role === 'model' && ($people[$seenPeople[$key]]['role'] ?? '') === 'channel') {
                $people[$seenPeople[$key]]['role'] = 'model';
            }
            return;
        }
        $seenPeople[$key] = count($people);
        $people[] = ['name' => $name, 'slug' => $slug, 'role' => $role];
    };

    // Channel / uploader / group
    if (preg_match_all(
        '/<li[^>]*class="[^"]*main-uploader[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?<span[^>]*class="name"[^>]*>(?:<span[^>]*>[\s\S]*?<\/span>\s*)?([^<]+)/i',
        $html,
        $ups,
        PREG_SET_ORDER
    )) {
        foreach ($ups as $u) {
            $addPerson($u[1], $u[2], 'channel');
        }
    }

    // Models / pornstars (real people)
    if (preg_match_all(
        '/<li[^>]*class="[^"]*\bmodel\b[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?<span[^>]*class="name"[^>]*>([^<]+)/i',
        $html,
        $mods,
        PREG_SET_ORDER
    )) {
        foreach ($mods as $mod) {
            $addPerson($mod[1], $mod[2], 'model');
        }
    }

    // Keyword tags (xvideos "is-keyword")
    if (preg_match_all(
        '/<a[^>]+href="\/tags\/([^"?#]+)"[^>]*class="[^"]*is-keyword[^"]*"[^>]*>([^<]+)<\/a>/i',
        $html,
        $tms,
        PREG_SET_ORDER
    )) {
        foreach ($tms as $tm) {
            $label = trim(html_entity_decode($tm[2], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            if ($label === '') {
                $label = str_replace('-', ' ', rawurldecode($tm[1]));
            }
            $key = strtolower($label);
            if ($label === '' || isset($seenTags[$key])) {
                continue;
            }
            $seenTags[$key] = true;
            $tags[] = $label;
        }
    }

    return ['people' => $people, 'tags' => $tags];
}

/**
 * Fetch watch page and attach real models + keyword tags (xvideos-style).
 * @return bool true when meta was written
 */
function cfp_xv_enrich_video(PDO $pdo, array $video, bool $force = false): bool
{
    $id = (int) ($video['id'] ?? 0);
    if ($id < 1) {
        return false;
    }
    if (!$force && !empty($video['enriched_at'])) {
        return false;
    }

    $url = trim((string) ($video['tracking_url'] ?? ''));
    if ($url === '' || stripos($url, 'xvideos.com') === false) {
        // Mark so we do not keep retrying dead rows
        $pdo->prepare('UPDATE videos SET enriched_at = NOW() WHERE id = ?')->execute([$id]);
        return false;
    }

    $html = cfp_xv_http_get($url, 20);
    if ($html === '') {
        // Network/temporary failure — leave enriched_at NULL so we retry later
        return false;
    }
    $meta = cfp_xv_parse_video_page_meta($html);
    if (!$meta['people'] && !$meta['tags']) {
        // Page loaded but no metadata (deleted/region) — stamp to stop retry loops
        $pdo->prepare('UPDATE videos SET enriched_at = NOW() WHERE id = ?')->execute([$id]);
        return false;
    }

    cfp_ensure_schema($pdo);
    // Replace prior links so listing-card "channel" names don't stay tagged as people
    $pdo->prepare('DELETE FROM video_actors WHERE video_id = ?')->execute([$id]);
    foreach ($meta['people'] as $person) {
        $aid = cfp_upsert_actor($pdo, (string) $person['name'], (string) $person['slug']);
        if ($aid) {
            $role = (($person['role'] ?? '') === 'channel') ? 'channel' : 'model';
            $pdo->prepare(
                'INSERT INTO video_actors (video_id, actor_id, role) VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE role = VALUES(role)'
            )->execute([$id, $aid, $role]);
        }
    }
    foreach ($meta['tags'] as $tagName) {
        $tid = cfp_upsert_tag($pdo, (string) $tagName);
        if ($tid) {
            $pdo->prepare('INSERT IGNORE INTO video_tags (video_id, tag_id) VALUES (?,?)')->execute([$id, $tid]);
        }
    }

    $pdo->prepare('UPDATE videos SET enriched_at = NOW() WHERE id = ?')->execute([$id]);
    return true;
}

/**
 * Enrich up to $limit videos that still need models/tags from xvideos.
 */
function cfp_xv_enrich_pending(PDO $pdo, int $limit = 8): int
{
    $limit = max(1, min(40, $limit));
    $st = $pdo->prepare(
        'SELECT * FROM videos
         WHERE enriched_at IS NULL AND tracking_url IS NOT NULL AND tracking_url <> \'\'
         ORDER BY views DESC, id DESC
         LIMIT ?'
    );
    $st->execute([$limit]);
    $n = 0;
    foreach ($st->fetchAll() as $row) {
        if (cfp_xv_enrich_video($pdo, $row, true)) {
            $n++;
        }
    }
    return $n;
}

/**
 * Import one listing page into DB.
 * @return int inserted or updated count
 */
function cfp_xv_import_page(PDO $pdo, string $categorySlug, string $categoryLabel, int $page = 0, int $limit = 24): int
{
    $url = cfp_xv_build_list_url($categorySlug, $page);
    $html = cfp_xv_http_get($url);
    $items = cfp_xv_parse_listing($html, $limit, $categoryLabel);
    $n = 0;
    foreach ($items as $item) {
        $embedKey = (string) ($item['public_id'] ?? '');
        if ($embedKey === '') {
            $embedKey = cfp_xv_key_from_url((string) ($item['href'] ?? '')) ?: (string) $item['id'];
        }
        $embed = '<iframe src="https://www.xvideos.com/embedframe/' . $embedKey . '" frameborder="0" width="510" height="400" scrolling="no" allowfullscreen="allowfullscreen"></iframe>';
        // Listing cards expose the channel/group name — not performers.
        $actors = $item['actors'] !== ''
            ? [['name' => $item['actors'], 'role' => 'channel']]
            : [];
        cfp_upsert_video($pdo, [
            'partner' => 'xvideos',
            'video_id' => $item['id'],
            'title' => $item['title'],
            'thumb' => $item['thumb'],
            'duration' => $item['duration'],
            'tracking_url' => $item['href'],
            'embed' => $embed,
        ], [$categoryLabel], [$categoryLabel], $actors);
        $n++;
    }
    return $n;
}

/** Default niche list (subset of previous WP mass-embedder niches). */
function cfp_xv_default_niches(): array
{
    return [
        'Amateur' => 'amateur',
        'Anal' => 'anal',
        'Asian' => 'asian',
        'Babe' => 'babe',
        'BBW' => 'bbw',
        'Big Ass' => 'big-ass',
        'Big Tits' => 'big-tits',
        'Blonde' => 'blonde',
        'Brunette' => 'brunette',
        'Creampie' => 'creampie',
        'Ebony' => 'ebony',
        'Hardcore' => 'hardcore',
        'Interracial' => 'interracial',
        'Latina' => 'latina',
        'Lesbian' => 'lesbian',
        'MILF' => 'milf',
        'POV' => 'pov',
        'Redhead' => 'redhead',
        'Teen' => 'teen',
        'Threesome' => 'threesome',
    ];
}
