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
            $meta = cfp_video_meta($pdo, (int) $video['id']);
            $related = cfp_related($pdo, (int) $video['id'], 12);
            $view = 'watch';
            $bodyClass = 'page-porn page-porn-watch';
            $viewData = compact('video', 'meta', 'related');
            $pageTitle = $video['title'] . ' — ' . CFP_SITE_NAME;
            $pageDescription = $video['title'];
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
require dirname(__DIR__) . '/views/layout.php';
