<?php
declare(strict_types=1);

$configFile = dirname(__DIR__) . '/config.php';
if (!is_file($configFile)) {
    $configFile = dirname(__DIR__) . '/config.example.php';
}
require $configFile;

require __DIR__ . '/helpers.php';
require __DIR__ . '/db.php';
require __DIR__ . '/xvideos.php';
require __DIR__ . '/admin.php';

date_default_timezone_set('UTC');

try {
    cfp_ensure_schema(cfp_pdo());
} catch (Throwable $e) {
    // DB may be unavailable during first install
}
