<?php
declare(strict_types=1);

function cfp_admin_pass(): string
{
    return defined('CFP_ADMIN_PASS') ? (string) CFP_ADMIN_PASS : '';
}

function cfp_admin_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('cfp_admin');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 12,
        'path' => CFP_BASE !== '' ? rtrim(CFP_BASE, '/') . '/' : '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function cfp_admin_ok(): bool
{
    if (cfp_admin_pass() === '') {
        return false;
    }
    cfp_admin_session_start();
    return !empty($_SESSION['cfp_admin_ok']);
}

function cfp_admin_login(string $password): bool
{
    $expected = cfp_admin_pass();
    if ($expected === '' || !hash_equals($expected, $password)) {
        return false;
    }
    cfp_admin_session_start();
    $_SESSION['cfp_admin_ok'] = 1;
    session_regenerate_id(true);
    return true;
}

function cfp_admin_logout(): void
{
    cfp_admin_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $p['path'] ?? '/',
            'secure' => !empty($p['secure']),
            'httponly' => !empty($p['httponly']),
            'samesite' => $p['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
}

/** @return array{niches_per_run:int,limit_per_niche:int,enrich_per_run:int,max_page:int,speed:string} */
function cfp_scraper_settings(PDO $pdo): array
{
    $defaults = [
        'niches_per_run' => 8,
        'limit_per_niche' => 40,
        'enrich_per_run' => 60,
        'max_page' => 50,
        'speed' => 'fast',
    ];
    try {
        $st = $pdo->prepare('SELECT v FROM scrape_state WHERE k = ?');
        $st->execute(['scraper_settings']);
        $raw = $st->fetchColumn();
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $defaults = array_merge($defaults, $decoded);
            }
        }
    } catch (Throwable $e) {
        // ignore
    }
    $defaults['niches_per_run'] = max(1, min(20, (int) $defaults['niches_per_run']));
    $defaults['limit_per_niche'] = max(6, min(80, (int) $defaults['limit_per_niche']));
    $defaults['enrich_per_run'] = max(0, min(200, (int) $defaults['enrich_per_run']));
    $defaults['max_page'] = max(5, min(120, (int) $defaults['max_page']));
    $defaults['speed'] = (string) ($defaults['speed'] ?? 'fast');
    return $defaults;
}

function cfp_scraper_presets(): array
{
    return [
        'slow' => ['niches_per_run' => 1, 'limit_per_niche' => 12, 'enrich_per_run' => 8, 'max_page' => 15],
        'normal' => ['niches_per_run' => 3, 'limit_per_niche' => 24, 'enrich_per_run' => 20, 'max_page' => 25],
        'fast' => ['niches_per_run' => 8, 'limit_per_niche' => 40, 'enrich_per_run' => 60, 'max_page' => 50],
        'turbo' => ['niches_per_run' => 12, 'limit_per_niche' => 48, 'enrich_per_run' => 100, 'max_page' => 80],
        'max' => ['niches_per_run' => 16, 'limit_per_niche' => 60, 'enrich_per_run' => 150, 'max_page' => 100],
    ];
}

function cfp_save_scraper_settings(PDO $pdo, array $settings): array
{
    $presets = cfp_scraper_presets();
    $speed = (string) ($settings['speed'] ?? 'fast');
    if (isset($presets[$speed])) {
        $settings = array_merge($presets[$speed], ['speed' => $speed]);
    } else {
        $speed = 'custom';
        $settings['speed'] = 'custom';
    }
    $out = [
        'niches_per_run' => max(1, min(20, (int) ($settings['niches_per_run'] ?? 8))),
        'limit_per_niche' => max(6, min(80, (int) ($settings['limit_per_niche'] ?? 40))),
        'enrich_per_run' => max(0, min(200, (int) ($settings['enrich_per_run'] ?? 60))),
        'max_page' => max(5, min(120, (int) ($settings['max_page'] ?? 50))),
        'speed' => $speed,
    ];
    $up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
    $up->execute(['scraper_settings', json_encode($out, JSON_UNESCAPED_SLASHES)]);
    return $out;
}

function cfp_scrape_lock_path(): string
{
    return sys_get_temp_dir() . '/cfp-xvideos-scrape.lock';
}

function cfp_scrape_set_running(PDO $pdo, bool $on): void
{
    try {
        $payload = $on
            ? json_encode(['running' => 1, 'started_at' => date('c')], JSON_UNESCAPED_SLASHES)
            : json_encode(['running' => 0, 'stopped_at' => date('c')], JSON_UNESCAPED_SLASHES);
        $up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
        $up->execute(['scrape_running', $payload]);
    } catch (Throwable $e) {
        // ignore
    }
}

function cfp_scrape_is_running(PDO $pdo = null): bool
{
    // Live lock file is the source of truth while a scrape holds it
    $lock = cfp_scrape_lock_path();
    if (is_file($lock)) {
        $fh = @fopen($lock, 'c');
        if ($fh) {
            $busy = !flock($fh, LOCK_EX | LOCK_NB);
            if (!$busy) {
                flock($fh, LOCK_UN);
            }
            fclose($fh);
            if ($busy) {
                return true;
            }
        }
    }
    try {
        $pdo = $pdo ?: cfp_pdo();
        $st = $pdo->prepare('SELECT v FROM scrape_state WHERE k = ?');
        $st->execute(['scrape_running']);
        $raw = $st->fetchColumn();
        if (!is_string($raw) || $raw === '') {
            return false;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || empty($decoded['running'])) {
            return false;
        }
        $started = isset($decoded['started_at']) ? strtotime((string) $decoded['started_at']) : false;
        // Stale flag after 15 minutes
        if ($started !== false && (time() - $started) > 900) {
            cfp_scrape_set_running($pdo, false);
            return false;
        }
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

/** Convenience: apply a named preset. */
function cfp_apply_scraper_preset(PDO $pdo, string $speed): array
{
    $presets = cfp_scraper_presets();
    if (!isset($presets[$speed])) {
        $speed = 'fast';
    }
    return cfp_save_scraper_settings($pdo, ['speed' => $speed]);
}

function cfp_scrape_state(PDO $pdo): array
{
    $st = $pdo->prepare('SELECT v FROM scrape_state WHERE k = ?');
    $st->execute(['xvideos_bulk']);
    $raw = $st->fetchColumn();
    $decoded = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
    return is_array($decoded) ? $decoded : [];
}

function cfp_site_stats(PDO $pdo): array
{
    $q = static function (string $sql) use ($pdo) {
        try {
            return (int) $pdo->query($sql)->fetchColumn();
        } catch (Throwable $e) {
            return 0;
        }
    };
    $roles = [];
    try {
        foreach ($pdo->query('SELECT role, COUNT(DISTINCT actor_id) AS actors, COUNT(*) AS links FROM video_actors GROUP BY role') as $row) {
            $roles[(string) $row['role']] = [
                'actors' => (int) $row['actors'],
                'links' => (int) $row['links'],
            ];
        }
    } catch (Throwable $e) {
        // ignore
    }
    return [
        'videos' => $q('SELECT COUNT(*) FROM videos'),
        'views' => $q('SELECT COALESCE(SUM(views),0) FROM videos'),
        'likes' => $q('SELECT COALESCE(SUM(likes),0) FROM videos'),
        'dislikes' => $q('SELECT COALESCE(SUM(dislikes),0) FROM videos'),
        'tags' => $q('SELECT COUNT(*) FROM tags'),
        'categories' => $q('SELECT COUNT(*) FROM categories'),
        'people' => (int) ($roles['model']['actors'] ?? 0),
        'channels' => (int) ($roles['channel']['actors'] ?? 0),
        'enriched' => $q('SELECT COUNT(*) FROM videos WHERE enriched_at IS NOT NULL'),
        'pending_enrich' => $q('SELECT COUNT(*) FROM videos WHERE enriched_at IS NULL AND tracking_url IS NOT NULL AND tracking_url <> \'\''),
        'roles' => $roles,
    ];
}

function cfp_trigger_scrape_async(): bool
{
    $bin = dirname(__DIR__) . '/bin/scrape-xvideos.php';
    if (!is_file($bin)) {
        return false;
    }
    try {
        cfp_scrape_set_running(cfp_pdo(), true);
    } catch (Throwable $e) {
        // continue
    }
    $log = '/tmp/cfp-scrape-manual.log';
    $cmd = 'nohup /usr/bin/php ' . escapeshellarg($bin) . ' >> ' . escapeshellarg($log) . ' 2>&1 &';
    exec($cmd);
    return true;
}
