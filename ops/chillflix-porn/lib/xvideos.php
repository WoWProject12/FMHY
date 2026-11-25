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
 * @return array{high?:string,low?:string,hls?:string,poster?:string}|null
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
    return $streams;
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
        $actors = $item['actors'] !== '' ? [$item['actors']] : [];
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
