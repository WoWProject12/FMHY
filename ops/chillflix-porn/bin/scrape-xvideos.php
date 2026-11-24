<?php
declare(strict_types=1);

/**
 * Cron-friendly Xvideos importer (replaces WP mass-embedder cron).
 * Usage: php bin/scrape-xvideos.php
 * Suggested: every 10 minutes
 */

require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = cfp_pdo();
$lockFile = sys_get_temp_dir() . '/cfp-xvideos-scrape.lock';
$fh = fopen($lockFile, 'c');
if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
    echo "locked\n";
    exit(0);
}

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
if ($page > 20) {
    $page = 0;
}

$total = 0;
for ($i = 0; $i < 2; $i++) {
    if ($offset >= count($keys)) {
        $offset = 0;
        $page++;
        if ($page > 20) {
            $page = 0;
        }
    }
    $label = $keys[$offset];
    $slug = $niches[$label];
    echo "import $label ($slug) page=$page\n";
    try {
        $n = cfp_xv_import_page($pdo, $slug, $label, $page, 24);
        echo "  +$n\n";
        $total += $n;
    } catch (Throwable $e) {
        echo "  ERR " . $e->getMessage() . "\n";
    }
    $offset++;
}

$newState = json_encode(['offset' => $offset, 'page' => $page], JSON_UNESCAPED_SLASHES);
$up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
$up->execute(['xvideos_bulk', $newState]);
echo "done total=$total state=$newState\n";

flock($fh, LOCK_UN);
fclose($fh);
