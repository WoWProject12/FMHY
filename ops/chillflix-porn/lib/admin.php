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
        'niches_per_run' => 4,
        'limit_per_niche' => 30,
        'enrich_per_run' => 30,
        'max_page' => 30,
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
    $defaults['niches_per_run'] = max(1, min(12, (int) $defaults['niches_per_run']));
    $defaults['limit_per_niche'] = max(6, min(48, (int) $defaults['limit_per_niche']));
    $defaults['enrich_per_run'] = max(0, min(80, (int) $defaults['enrich_per_run']));
    $defaults['max_page'] = max(5, min(60, (int) $defaults['max_page']));
    $defaults['speed'] = (string) ($defaults['speed'] ?? 'fast');
    return $defaults;
}

function cfp_scraper_presets(): array
{
    return [
        'slow' => ['niches_per_run' => 1, 'limit_per_niche' => 12, 'enrich_per_run' => 8, 'max_page' => 15],
        'normal' => ['niches_per_run' => 2, 'limit_per_niche' => 24, 'enrich_per_run' => 15, 'max_page' => 20],
        'fast' => ['niches_per_run' => 4, 'limit_per_niche' => 30, 'enrich_per_run' => 30, 'max_page' => 30],
        'turbo' => ['niches_per_run' => 6, 'limit_per_niche' => 36, 'enrich_per_run' => 50, 'max_page' => 40],
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
        'niches_per_run' => max(1, min(12, (int) ($settings['niches_per_run'] ?? 4))),
        'limit_per_niche' => max(6, min(48, (int) ($settings['limit_per_niche'] ?? 30))),
        'enrich_per_run' => max(0, min(80, (int) ($settings['enrich_per_run'] ?? 30))),
        'max_page' => max(5, min(60, (int) ($settings['max_page'] ?? 30))),
        'speed' => $speed,
    ];
    $up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
    $up->execute(['scraper_settings', json_encode($out, JSON_UNESCAPED_SLASHES)]);
    return $out;
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
    $log = '/tmp/cfp-scrape-manual.log';
    $cmd = 'nohup /usr/bin/php ' . escapeshellarg($bin) . ' >> ' . escapeshellarg($log) . ' 2>&1 &';
    exec($cmd);
    return true;
}
