<?php
declare(strict_types=1);

/**
 * One-shot / cron helper: pull models + keyword tags from xvideos watch pages.
 * Usage: php bin/enrich-xvideos.php [limit=40]
 */

require dirname(__DIR__) . '/lib/bootstrap.php';

$limit = max(1, min(200, (int) ($argv[1] ?? 40)));
$pdo = cfp_pdo();
cfp_ensure_schema($pdo);
$n = cfp_xv_enrich_pending($pdo, $limit);
echo "enriched=$n limit=$limit\n";
