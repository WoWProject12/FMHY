<?php
declare(strict_types=1);

/**
 * Cron-friendly Xvideos importer (replaces WP mass-embedder cron).
 * Usage: php bin/scrape-xvideos.php
 * Speed is controlled via scrape_state.scraper_settings (admin panel).
 */

require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = cfp_pdo();
$lockFile = cfp_scrape_lock_path();
$fh = fopen($lockFile, 'c');
if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
    echo "locked\n";
    exit(0);
}

cfp_scrape_set_running($pdo, true);
register_shutdown_function(static function () use ($pdo): void {
    try {
        cfp_scrape_set_running($pdo, false);
    } catch (Throwable $e) {
        // ignore
    }
});

$settings = cfp_scraper_settings($pdo);
$nichesPerRun = (int) $settings['niches_per_run'];
$limitPerNiche = (int) $settings['limit_per_niche'];
$enrichPerRun = (int) $settings['enrich_per_run'];
$maxPage = (int) $settings['max_page'];

$st = $pdo->prepare('SELECT v FROM scrape_state WHERE k = ?');
$st->execute(['xvideos_bulk']);
$raw = $st->fetchColumn();
$state = $raw ? (json_decode((string) $raw, true) ?: []) : [];
$offset = (int) ($state['offset'] ?? 0);
$page = (int) ($state['page'] ?? 0);

$niches = cfp_xv_default_niches();
$keys = array_keys($niches);
if ($offset >= count($keys)) {
    $offset = 0;
    $page++;
}
if ($page > $maxPage) {
    $page = 0;
}

$total = 0;
$started = microtime(true);
echo 'speed=' . $settings['speed']
    . " niches=$nichesPerRun limit=$limitPerNiche enrich=$enrichPerRun max_page=$maxPage\n";

for ($i = 0; $i < $nichesPerRun; $i++) {
    if ($offset >= count($keys)) {
        $offset = 0;
        $page++;
        if ($page > $maxPage) {
            $page = 0;
        }
    }
    $label = $keys[$offset];
    $slug = $niches[$label];
    echo "import $label ($slug) page=$page\n";
    try {
        $n = cfp_xv_import_page($pdo, $slug, $label, $page, $limitPerNiche);
        echo "  +$n\n";
        $total += $n;
    } catch (Throwable $e) {
        echo '  ERR ' . $e->getMessage() . "\n";
    }
    $offset++;
}

$enriched = 0;
if ($enrichPerRun > 0) {
    try {
        $enriched = cfp_xv_enrich_pending($pdo, $enrichPerRun);
    } catch (Throwable $e) {
        echo 'enrich ERR ' . $e->getMessage() . "\n";
    }
}

$newState = [
    'offset' => $offset,
    'page' => $page,
    'last_run_at' => date('c'),
    'last_imported' => $total,
    'last_enriched' => $enriched,
    'last_duration_sec' => round(microtime(true) - $started, 2),
    'speed' => $settings['speed'],
];
$up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
$up->execute(['xvideos_bulk', json_encode($newState, JSON_UNESCAPED_SLASHES)]);
cfp_scrape_set_running($pdo, false);
echo 'done total=' . $total . ' enriched=' . $enriched . ' state=' . json_encode($newState, JSON_UNESCAPED_SLASHES) . "\n";

flock($fh, LOCK_UN);
fclose($fh);
