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
    $maxQ = '';
    $previewUrl = '';
    $ladder = is_array($streams['qualities'] ?? null) ? $streams['qualities'] : [];
    $bestH = 0;
    $best720 = null;
    foreach ($ladder as $q) {
        if (!is_array($q)) {
            continue;
        }
        $h = (int) ($q['height'] ?? 0);
        $label = cfp_normalize_quality_label((string) ($q['label'] ?? ''), $h);
        if ($h > $bestH) {
            $bestH = $h;
            $maxQ = $label !== '' ? $label : ($h . 'p');
        }
        if ($h >= 680 && $h <= 800) {
            $best720 = $q;
        }
    }
    if ($maxQ !== '') {
        cfp_video_remember_quality($pdo, $vid, $maxQ);
        $streams['max_quality'] = $maxQ;
    }
    // Card hover preview uses progressive MP4 (no hls.js on thumbs).
    // Badge still shows 720p while previewing; prefer "high" (~360-720) over low.
    if (!empty($streams['high'])) {
        $streams['preview'] = (string) $streams['high'];
    } elseif (!empty($streams['low'])) {
        $streams['preview'] = (string) $streams['low'];
    } elseif (is_array($best720) && !empty($best720['url']) && (($best720['type'] ?? '') !== 'hls')) {
        $streams['preview'] = (string) $best720['url'];
    }
    $streams['preview_quality'] = '720p';
    cfp_json(['ok' => true, 'streams' => $streams]);
}

// GET (preferred — Cloudflare often challenges POSTs) or POST
if ($path === '/api/vote' && ($method === 'GET' || $method === 'POST')) {
    $body = $_GET;
    if ($method === 'POST') {
        $raw = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true);
        if (is_array($json)) {
            $body = $json + $body;
        } else {
            $body = $_POST + $body;
        }
    }
    $vid = preg_replace('/[^a-zA-Z0-9]/', '', (string) ($body['id'] ?? '')) ?? '';
    $voteRaw = $body['vote'] ?? 0;
    if ($voteRaw === 'up' || $voteRaw === 'like') {
        $vote = 1;
    } elseif ($voteRaw === 'down' || $voteRaw === 'dislike') {
        $vote = -1;
    } else {
        $vote = (int) $voteRaw;
    }
    if ($vid === '') {
        cfp_json(['ok' => false, 'error' => 'missing id'], 400);
    }
    $state = cfp_cast_vote($pdo, $vid, $vote);
    // Mirror likes into user library when signed in
    $user = cfp_current_user($pdo);
    if ($user) {
        if ($vote === 1) {
            cfp_library_add($pdo, (int) $user['id'], $vid, 'liked');
        } else {
            cfp_library_remove($pdo, (int) $user['id'], $vid, 'liked');
        }
    }
    cfp_json(['ok' => true] + $state);
}

// User library sync (history / saved / liked / downloaded) — GET preferred for CF
if ($path === '/api/library' && ($method === 'GET' || $method === 'POST')) {
    $user = cfp_current_user($pdo);
    if (!$user) {
        cfp_json(['ok' => false, 'error' => 'login required'], 401);
    }
    $body = $_GET;
    if ($method === 'POST') {
        $raw = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true);
        if (is_array($json)) {
            $body = $json + $body;
        } else {
            $body = $_POST + $body;
        }
    }
    $vid = preg_replace('/[^a-zA-Z0-9]/', '', (string) ($body['id'] ?? '')) ?? '';
    $kind = strtolower(trim((string) ($body['kind'] ?? '')));
    $op = strtolower(trim((string) ($body['op'] ?? 'add')));
    if ($vid === '' || !in_array($kind, cfp_library_kinds(), true)) {
        cfp_json(['ok' => false, 'error' => 'bad request'], 400);
    }
    $ok = $op === 'remove'
        ? cfp_library_remove($pdo, (int) $user['id'], $vid, $kind)
        : cfp_library_add($pdo, (int) $user['id'], $vid, $kind);
    $flags = cfp_library_flags($pdo, (int) $user['id'], $vid);
    cfp_json(['ok' => $ok, 'flags' => $flags]);
}

if ($path === '/api/library/flags' && $method === 'GET') {
    $user = cfp_current_user($pdo);
    if (!$user) {
        cfp_json(['ok' => false, 'error' => 'login required'], 401);
    }
    $vid = preg_replace('/[^a-zA-Z0-9]/', '', (string) ($_GET['id'] ?? '')) ?? '';
    if ($vid === '') {
        cfp_json(['ok' => false, 'error' => 'missing id'], 400);
    }
    cfp_json(['ok' => true, 'flags' => cfp_library_flags($pdo, (int) $user['id'], $vid)]);
}

// Profile avatar: list choices (GET) or save (GET/POST with url=)
if ($path === '/api/avatar' && ($method === 'GET' || $method === 'POST')) {
    $user = cfp_current_user($pdo);
    if (!$user) {
        cfp_json(['ok' => false, 'error' => 'login required'], 401);
    }
    $body = $_GET;
    if ($method === 'POST') {
        $raw = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true);
        if (is_array($json)) {
            $body = $json + $body;
        } else {
            $body = $_POST + $body;
        }
    }
    $urlRaw = $body['url'] ?? null;
    $clear = isset($body['clear']) && (string) $body['clear'] !== '' && (string) $body['clear'] !== '0';
    if ($urlRaw !== null || $clear) {
        $url = $clear ? null : (string) $urlRaw;
        $ok = cfp_user_set_avatar($pdo, (int) $user['id'], $url);
        if (!$ok) {
            cfp_json(['ok' => false, 'error' => 'invalid avatar'], 400);
        }
        // Refresh current avatar
        $fresh = ['id' => (int) $user['id'], 'username' => (string) $user['username'], 'avatar_url' => $url];
        cfp_json([
            'ok' => true,
            'avatar' => cfp_user_avatar_url($fresh, $pdo),
        ]);
    }
    cfp_json([
        'ok' => true,
        'avatar' => cfp_user_avatar_url($user, $pdo),
        'choices' => cfp_avatar_choices($pdo, 48),
    ]);
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
    && $path !== '/age-confirm'
    && !str_starts_with($path, '/admin')
    && !in_array($path, ['/login', '/register', '/auth/login', '/auth/register', '/auth/logout'], true);

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
            'categories' => $filters['categories'],
        ];
        $latest = cfp_list_videos($pdo, $listOpts);
        // xvideos-style discovery: Best (popularity) + Suggested (watch history) + Newest
        $popular = cfp_list_videos($pdo, ['page' => 1, 'per' => 14, 'sort' => 'views', 'period' => 'week']);
        $cats = cfp_top_categories($pdo, 60);
        $suggested = [];
        $isCleanHome = empty($filters['categories'])
            && ($filters['sort'] ?? 'new') === 'new'
            && ($filters['duration'] ?? 'any') === 'any'
            && ($filters['period'] ?? 'any') === 'any'
            && ($filters['page'] ?? 1) <= 1;
        if ($isCleanHome) {
            $homeUser = cfp_current_user($pdo);
            $excludeSuggest = [];
            foreach (($popular['items'] ?? []) as $popItem) {
                $excludeSuggest[] = (int) ($popItem['id'] ?? 0);
            }
            $suggested = cfp_home_suggested($pdo, $homeUser, 14, $excludeSuggest);
        }
        $view = 'home';
        $viewData = compact('latest', 'popular', 'cats', 'filters', 'suggested');
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
            'categories' => $filters['categories'],
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
        $peopleSort = strtolower(trim((string) ($_GET['sort'] ?? 'popular')));
        if (!in_array($peopleSort, ['popular', 'videos', 'az', 'new'], true)) {
            $peopleSort = 'popular';
        }
        $peopleRole = strtolower(trim((string) ($_GET['role'] ?? 'model')));
        if (!in_array($peopleRole, ['model', 'channel', 'any'], true)) {
            $peopleRole = 'model';
        }
        $people = cfp_list_people($pdo, [
            'q' => $peopleQ,
            'sort' => $peopleSort,
            'role' => $peopleRole,
            'page' => $filters['page'],
            'per' => 60,
        ]);
        $view = 'people';
        $viewData = compact('people', 'peopleQ', 'peopleSort', 'peopleRole');
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
    } elseif ($path === '/login') {
        if (cfp_current_user($pdo)) {
            header('Location: ' . cfp_url('/library'), true, 302);
            exit;
        }
        $next = (string) ($_GET['next'] ?? cfp_url('/library'));
        if (!str_starts_with($next, cfp_url('/'))) {
            $next = cfp_url('/library');
        }
        $flashErr = null;
        if (isset($_GET['err'])) {
            $flashErr = 'Wrong username or password. Create an account if you are new here.';
        }
        $prefillUser = (string) ($_GET['user'] ?? '');
        $view = 'login';
        $viewData = ['flashErr' => $flashErr, 'next' => $next, 'prefillUser' => $prefillUser];
        $pageTitle = 'Sign in — ' . CFP_SITE_NAME;
    } elseif ($path === '/register') {
        if (cfp_current_user($pdo)) {
            header('Location: ' . cfp_url('/library'), true, 302);
            exit;
        }
        $flashErr = isset($_GET['err']) ? (string) ($_GET['err']) : null;
        if ($flashErr === '1') {
            $flashErr = 'Could not create account. Try a different username.';
        }
        $prefillUser = (string) ($_GET['user'] ?? '');
        $view = 'register';
        $viewData = ['flashErr' => $flashErr, 'prefillUser' => $prefillUser];
        $pageTitle = 'Create account — ' . CFP_SITE_NAME;
    } elseif ($path === '/auth/login') {
        // Prefer POST (password not in URL). GET kept as fallback.
        $user = (string) ($_POST['user'] ?? $_GET['user'] ?? '');
        $pass = (string) ($_POST['pass'] ?? $_GET['pass'] ?? '');
        $next = (string) ($_POST['next'] ?? $_GET['next'] ?? cfp_url('/library'));
        if (!str_starts_with($next, cfp_url('/'))) {
            $next = cfp_url('/library');
        }
        $res = cfp_user_login($pdo, $user, $pass);
        if (!empty($res['ok'])) {
            // Also mark age confirmed so library isn't blocked
            cfp_set_age_ok();
            header('Location: ' . $next, true, 302);
            exit;
        }
        $q = http_build_query([
            'err' => '1',
            'user' => strtolower(trim($user)),
            'next' => $next,
        ]);
        header('Location: ' . cfp_url('/login?' . $q), true, 302);
        exit;
    } elseif ($path === '/auth/register') {
        $user = (string) ($_POST['user'] ?? $_GET['user'] ?? '');
        $pass = (string) ($_POST['pass'] ?? $_GET['pass'] ?? '');
        $email = trim((string) ($_POST['email'] ?? $_GET['email'] ?? ''));
        $res = cfp_user_register($pdo, $user, $pass, $email !== '' ? $email : null);
        if (!empty($res['ok'])) {
            cfp_set_age_ok();
            header('Location: ' . cfp_url('/library'), true, 302);
            exit;
        }
        $q = http_build_query([
            'err' => (string) ($res['error'] ?? '1'),
            'user' => strtolower(trim($user)),
        ]);
        header('Location: ' . cfp_url('/register?' . $q), true, 302);
        exit;
    } elseif ($path === '/auth/logout') {
        cfp_user_logout();
        header('Location: ' . cfp_url('/'), true, 302);
        exit;
    } elseif ($path === '/library') {
        $user = cfp_current_user($pdo);
        if (!$user) {
            header('Location: ' . cfp_url('/login?next=' . rawurlencode(cfp_url('/library'))), true, 302);
            exit;
        }
        $tab = strtolower(trim((string) ($_GET['tab'] ?? 'history')));
        if (!in_array($tab, cfp_library_kinds(), true)) {
            $tab = 'history';
        }
        $results = cfp_library_list($pdo, (int) $user['id'], $tab, $filters['page'], $filters['per']);
        $counts = cfp_library_counts($pdo, (int) $user['id']);
        $view = 'library';
        $viewData = compact('user', 'results', 'tab', 'counts', 'filters');
        $pageTitle = 'My library — ' . CFP_SITE_NAME;
        if ($filters['density'] === 'compact') {
            $bodyClass .= ' is-compact';
        }
    } elseif ($path === '/admin/login') {
        // GET preferred — Cloudflare often challenges POSTs from bots/datacenters
        $pass = (string) ($_POST['password'] ?? $_GET['password'] ?? '');
        $pageTitle = 'Admin — ' . CFP_SITE_NAME;
        $bodyClass = 'page-porn page-porn-admin';
        if ($pass !== '' && cfp_admin_login($pass)) {
            header('Location: ' . cfp_url('/admin'), true, 302);
            exit;
        }
        $view = 'admin-login';
        $viewData = ['flashErr' => $pass !== '' ? 'Wrong password' : null];
    } elseif ($path === '/admin/logout') {
        cfp_admin_logout();
        header('Location: ' . cfp_url('/admin'), true, 302);
        exit;
    } elseif ($path === '/admin/scraper') {
        if (!cfp_admin_ok()) {
            header('Location: ' . cfp_url('/admin'), true, 302);
            exit;
        }
        $mode = (string) ($_GET['mode'] ?? $_POST['mode'] ?? 'preset');
        if ($mode === 'custom') {
            $saved = cfp_save_scraper_settings($pdo, [
                'speed' => 'custom',
                'niches_per_run' => (int) ($_GET['niches_per_run'] ?? $_POST['niches_per_run'] ?? 4),
                'limit_per_niche' => (int) ($_GET['limit_per_niche'] ?? $_POST['limit_per_niche'] ?? 30),
                'enrich_per_run' => (int) ($_GET['enrich_per_run'] ?? $_POST['enrich_per_run'] ?? 30),
                'max_page' => (int) ($_GET['max_page'] ?? $_POST['max_page'] ?? 30),
            ]);
        } else {
            $saved = cfp_save_scraper_settings($pdo, [
                'speed' => (string) ($_GET['speed'] ?? $_POST['speed'] ?? 'fast'),
            ]);
        }
        header('Location: ' . cfp_url('/admin?saved=1&speed=' . rawurlencode((string) $saved['speed'])), true, 302);
        exit;
    } elseif ($path === '/admin/scraper/run') {
        if (!cfp_admin_ok()) {
            header('Location: ' . cfp_url('/admin'), true, 302);
            exit;
        }
        $ok = cfp_trigger_scrape_async();
        header('Location: ' . cfp_url('/admin?' . ($ok ? 'running=1' : 'runerr=1')), true, 302);
        exit;
    } elseif ($path === '/admin/scraper/auto') {
        if (!cfp_admin_ok()) {
            header('Location: ' . cfp_url('/admin'), true, 302);
            exit;
        }
        $on = !isset($_GET['on']) || (string) $_GET['on'] === '1' || (string) $_GET['on'] === 'true';
        if (isset($_GET['on']) && ((string) $_GET['on'] === '0' || (string) $_GET['on'] === 'off')) {
            $on = false;
        }
        cfp_scraper_set_auto($pdo, $on);
        header('Location: ' . cfp_url('/admin?auto=' . ($on ? '1' : '0')), true, 302);
        exit;
    } elseif ($path === '/admin') {
        $pageTitle = 'Admin — ' . CFP_SITE_NAME;
        $bodyClass = 'page-porn page-porn-admin';
        if (!cfp_admin_ok()) {
            $view = 'admin-login';
            $viewData = [];
        } else {
            $stats = cfp_site_stats($pdo);
            $settings = cfp_scraper_settings($pdo);
            $scrapeState = cfp_scrape_state($pdo);
            $presets = cfp_scraper_presets();
            $flash = null;
            $flashErr = null;
            if (isset($_GET['saved'])) {
                $flash = 'Import speed saved (' . (string) ($_GET['speed'] ?? $settings['speed']) . ').';
            }
            if (isset($_GET['running'])) {
                $flash = 'Importer started — green dot means it is running.';
            }
            if (isset($_GET['runerr'])) {
                $flashErr = 'Could not start the importer.';
            }
            if (isset($_GET['auto'])) {
                $flash = ((string) $_GET['auto'] === '1')
                    ? 'Auto-import ON — fills the catalog continuously until you turn it off.'
                    : 'Auto-import OFF — only Run now will import.';
            }
            $view = 'admin';
            $viewData = compact('stats', 'settings', 'scrapeState', 'presets', 'flash', 'flashErr');
        }
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
