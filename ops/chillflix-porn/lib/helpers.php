<?php
declare(strict_types=1);

function cfp_e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function cfp_slug(string $s): string
{
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    $s = trim($s, '-');
    return $s !== '' ? substr($s, 0, 180) : 'video';
}

function cfp_url(string $path = '/'): string
{
    $base = rtrim(CFP_BASE, '/');
    if ($path === '' || $path === '/') {
        return $base . '/';
    }
    return $base . '/' . ltrim($path, '/');
}

function cfp_asset(string $path): string
{
    return cfp_url('assets/' . ltrim($path, '/'));
}

/** Absolute URL into main chillflix.lol asset tree. */
function cfp_main_asset(string $path): string
{
    return 'https://www.chillflix.lol/assets/' . ltrim($path, '/');
}

function cfp_duration_sec(string $duration): int
{
    $duration = trim($duration);
    if (preg_match('/^(\d+)\s*min/i', $duration, $m)) {
        return ((int) $m[1]) * 60;
    }
    if (preg_match('/^(\d+)\s*sec/i', $duration, $m)) {
        return (int) $m[1];
    }
    if (preg_match('/^(\d+):(\d+):(\d+)$/', $duration, $m)) {
        return ((int) $m[1]) * 3600 + ((int) $m[2]) * 60 + (int) $m[3];
    }
    if (preg_match('/^(\d+):(\d+)$/', $duration, $m)) {
        return ((int) $m[1]) * 60 + (int) $m[2];
    }
    if (ctype_digit($duration)) {
        return (int) $duration;
    }
    return 0;
}

function cfp_fmt_views(int $n): string
{
    if ($n >= 1000000) {
        return round($n / 1000000, 1) . 'M';
    }
    if ($n >= 1000) {
        return round($n / 1000, 1) . 'K';
    }
    return (string) $n;
}

function cfp_age_ok(): bool
{
    return isset($_COOKIE['cfp_age']) && $_COOKIE['cfp_age'] === '1';
}

function cfp_set_age_ok(): void
{
    setcookie('cfp_age', '1', [
        'expires' => time() + 60 * 60 * 24 * 400,
        'path' => '/',
        'secure' => true,
        'httponly' => false,
        'samesite' => 'Lax',
    ]);
}

function cfp_redirect(string $path): never
{
    header('Location: ' . cfp_url($path), true, 302);
    exit;
}

function cfp_json(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
