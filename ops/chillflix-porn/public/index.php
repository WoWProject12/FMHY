<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/bootstrap.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$base = rtrim(CFP_BASE, '/');
if ($base !== '' && str_starts_with($path, $base)) {
    $path = substr($path, strlen($base)) ?: '/';
}
$path = '/' . trim($path, '/');
if ($path !== '/') {
    $path = rtrim($path, '/');
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$pdo = cfp_pdo();

if ($path === '/age-confirm' && $method === 'POST') {
    cfp_set_age_ok();
    $next = (string) ($_POST['next'] ?? cfp_url('/'));
    if (!str_starts_with($next, cfp_url('/')) && $next !== cfp_url('/')) {
        $next = cfp_url('/');
    }
    header('Location: ' . $next, true, 302);
    exit;
}

if ($path === '/api/stream' && $method === 'GET') {
    $vid = preg_replace('/[^a-zA-Z0-9]/', '', (string) ($_GET['id'] ?? '')) ?? '';
    if ($vid === '') {
        cfp_json(['ok' => false, 'error' => 'missing id'], 400);
    }
    $streams = cfp_xv_fetch_streams($pdo, $vid);
    if (!$streams) {
        cfp_json(['ok' => false, 'error' => 'no streams'], 404);
    }
    cfp_json(['ok' => true, 'streams' => $streams]);
}

// Same-origin muted preview fallback (primary path plays CDN URL directly in JS).
if ($path === '/api/preview' && $method === 'GET') {
    $vid = preg_replace('/[^a-zA-Z0-9]/', '', (string) ($_GET['id'] ?? '')) ?? '';
    if ($vid === '') {
        http_response_code(400);
        exit;
    }
    $streams = cfp_xv_fetch_streams($pdo, $vid);
    $url = (string) (($streams['low'] ?? '') ?: ($streams['high'] ?? ''));
    if ($url === '') {
        http_response_code(404);
        exit;
    }
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    $range = (string) ($_SERVER['HTTP_RANGE'] ?? '');
    $headers = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer: https://www.xvideos.com/',
        'Accept: */*',
    ];
    if ($range !== '') {
        $headers[] = 'Range: ' . $range;
    }

    header('Content-Type: video/mp4');
    header('Accept-Ranges: bytes');
    header('Cache-Control: private, max-age=120');
    header('X-Content-Type-Options: nosniff');
    header('X-Accel-Buffering: no');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $headerLine): int {
            $len = strlen($headerLine);
            $trim = trim($headerLine);
            if ($trim === '') {
                return $len;
            }
            if (stripos($trim, 'HTTP/') === 0) {
                if (preg_match('/\s(\d{3})\s/', $trim, $m)) {
                    http_response_code((int) $m[1]);
                }
                return $len;
            }
            $pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
            foreach ($pass as $name) {
                if (stripos($trim, $name . ':') === 0) {
                    header($trim, true);
                    break;
                }
            }
            return $len;
        },
        CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk): int {
            echo $chunk;
            if (function_exists('fastcgi_finish_request') === false) {
                flush();
            }
            return strlen($chunk);
        },
    ]);
    $ok = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($ok === false && $code === 0) {
        http_response_code(502);
    }
    exit;
}

$needsAge = !cfp_age_ok()
    && !str_starts_with($path, '/api/')
    && $path !== '/age-confirm';

$pageTitle = CFP_SITE_NAME;
$pageDescription = 'Watch free adult videos on Chillflix.';
$bodyClass = 'page-porn';
$view = 'home';
$viewData = [];
$filters = cfp_filters_from_request();

try {
    if ($path === '/' || $path === '/index.php') {
        $listOpts = [
            'page' => $filters['page'],
            'per' => $filters['per'],
            'sort' => $filters['sort'],
            'duration' => $filters['duration'],
            'period' => $filters['period'],
            'category' => $filters['category'],
        ];
        $latest = cfp_list_videos($pdo, $listOpts);
        // xvideos-style: top strip is “best this week”, main grid is newest (or filtered)
        $popular = cfp_list_videos($pdo, ['page' => 1, 'per' => 14, 'sort' => 'views', 'period' => 'week']);
        $cats = cfp_top_categories($pdo, 60);
        $view = 'home';
        $viewData = compact('latest', 'popular', 'cats', 'filters');
        $pageTitle = CFP_SITE_NAME . ' — Free Adult Videos';
        if ($filters['density'] === 'compact') {
            $bodyClass .= ' is-compact';
        }
    } elseif ($path === '/search') {
        $filters['q'] = trim((string) ($_GET['q'] ?? ''));
        $results = cfp_list_videos($pdo, [
            'q' => $filters['q'],
            'page' => $filters['page'],
            'per' => $filters['per'],
            'sort' => $filters['sort'],
            'duration' => $filters['duration'],
            'period' => $filters['period'],
            'category' => $filters['category'],
        ]);
        $cats = cfp_top_categories($pdo, 60);
        $q = $filters['q'];
        $view = 'search';
        $viewData = compact('q', 'results', 'cats', 'filters');
        $pageTitle = ($q !== '' ? $q . ' — ' : '') . 'Search · ' . CFP_SITE_NAME;
        if ($filters['density'] === 'compact') {
            $bodyClass .= ' is-compact';
        }
    } elseif (preg_match('#^/category/([a-z0-9\-]+)$#', $path, $m)) {
        // Canonicalize into home filters for one consistent UI
        $slug = $m[1];
        $qs = $_GET;
        $qs['category'] = $slug;
        unset($qs['page']);
        $query = http_build_query($qs);
        header('Location: ' . cfp_url('/' . ($query !== '' ? '?' . $query : '')), true, 302);
        exit;
    } elseif (preg_match('#^/video/([a-z0-9\-]+)$#', $path, $m)) {
        $video = cfp_get_video_by_slug($pdo, $m[1]);
        if (!$video) {
            http_response_code(404);
            $view = '404';
        } else {
            cfp_bump_views($pdo, (int) $video['id']);
            // Pull real models + keyword tags from xvideos watch page (once)
            if (empty($video['enriched_at'])) {
                cfp_xv_enrich_video($pdo, $video, true);
                $fresh = cfp_get_video_by_slug($pdo, $m[1]);
                if ($fresh) {
                    $video = $fresh;
                }
            }
            $meta = cfp_video_meta($pdo, (int) $video['id']);
            $fromPeople = cfp_more_from_people($pdo, (int) $video['id'], 8);
            $exclude = [];
            foreach ($fromPeople as $sec) {
                foreach ($sec['items'] as $it) {
                    $exclude[] = (int) $it['id'];
                }
            }
            $related = cfp_related($pdo, (int) $video['id'], 14, $exclude);
            $view = 'watch';
            $bodyClass = 'page-porn page-porn-watch';
            $viewData = compact('video', 'meta', 'related', 'fromPeople');
            $pageTitle = $video['title'] . ' — ' . CFP_SITE_NAME;
            $pageDescription = $video['title'];
        }
    } elseif ($path === '/people') {
        $peopleQ = trim((string) ($_GET['q'] ?? ''));
        $people = cfp_list_people($pdo, [
            'q' => $peopleQ,
            'page' => $filters['page'],
            'per' => 60,
        ]);
        $view = 'people';
        $viewData = compact('people', 'peopleQ');
        $pageTitle = 'People — ' . CFP_SITE_NAME;
    } elseif (preg_match('#^/people/([a-z0-9\-]+)$#', $path, $m)) {
        $person = cfp_get_person_by_slug($pdo, $m[1]);
        if (!$person || (int) ($person['n'] ?? 0) < 1) {
            http_response_code(404);
            $view = '404';
        } else {
            $personSort = (isset($_GET['sort']) && (string) $_GET['sort'] === 'new') ? 'new' : 'views';
            $filters['sort'] = $personSort;
            $results = cfp_videos_by_person($pdo, (int) $person['id'], [
                'page' => $filters['page'],
                'per' => $filters['per'],
                'sort' => $personSort,
            ]);
            $personTags = cfp_person_tags($pdo, (int) $person['id'], 36);
            $view = 'person';
            $viewData = compact('person', 'results', 'filters', 'personTags');
            $pageTitle = $person['name'] . ' — ' . CFP_SITE_NAME;
            $pageDescription = 'Videos from ' . $person['name'];
            if ($filters['density'] === 'compact') {
                $bodyClass .= ' is-compact';
            }
        }
    } elseif (preg_match('#^/tag/([a-z0-9\-]+)$#', $path, $m)) {
        $tag = cfp_get_tag_by_slug($pdo, $m[1]);
        if (!$tag || (int) ($tag['n'] ?? 0) < 1) {
            http_response_code(404);
            $view = '404';
        } else {
            $tagSort = (isset($_GET['sort']) && (string) $_GET['sort'] === 'new') ? 'new' : 'views';
            $filters['sort'] = $tagSort;
            $results = cfp_videos_by_tag($pdo, (int) $tag['id'], [
                'page' => $filters['page'],
                'per' => $filters['per'],
                'sort' => $tagSort,
            ]);
            $view = 'tag';
            $viewData = compact('tag', 'results', 'filters');
            $pageTitle = $tag['name'] . ' — ' . CFP_SITE_NAME;
            $pageDescription = 'Videos tagged ' . $tag['name'];
            if ($filters['density'] === 'compact') {
                $bodyClass .= ' is-compact';
            }
        }
    } elseif ($path === '/categories') {
        $cats = cfp_top_categories($pdo, 120);
        $view = 'categories';
        $viewData = compact('cats');
        $pageTitle = 'Categories — ' . CFP_SITE_NAME;
    } else {
        http_response_code(404);
        $view = '404';
        $pageTitle = 'Not found — ' . CFP_SITE_NAME;
    }
} catch (Throwable $e) {
    http_response_code(500);
    $view = 'error';
    $viewData = ['message' => $e->getMessage()];
    $pageTitle = 'Error — ' . CFP_SITE_NAME;
}

extract($viewData, EXTR_SKIP);
// Nav category dropdown needs cats on every page
if (empty($cats) && empty($needsAge)) {
    try {
        $cats = cfp_top_categories($pdo, 80);
    } catch (Throwable $e) {
        $cats = [];
    }
}
$navCats = $cats ?? [];
require dirname(__DIR__) . '/views/layout.php';
