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
    // Match xvideos-style labels: 463.1k / 17.8M
    if ($n >= 1000000) {
        $v = round($n / 1000000, 1);
        return rtrim(rtrim(number_format($v, 1, '.', ''), '0'), '.') . 'M';
    }
    if ($n >= 1000) {
        $v = round($n / 1000, 1);
        return rtrim(rtrim(number_format($v, 1, '.', ''), '0'), '.') . 'k';
    }
    return (string) $n;
}

/** Normalize a quality label for card badges (prefer 1440p over 2K). */
function cfp_normalize_quality_label(string $label, int $height = 0): string
{
    $label = trim($label);
    if ($height >= 2160 || strcasecmp($label, '4K') === 0 || strcasecmp($label, '2160p') === 0) {
        return '4K';
    }
    if ($height >= 1440 || preg_match('/^(?:1440p|2K)$/i', $label)) {
        return '1440p';
    }
    if ($height >= 1080 || preg_match('/^1080p$/i', $label)) {
        return '1080p';
    }
    if ($height >= 720 || preg_match('/^720p$/i', $label)) {
        return '720p';
    }
    if ($height >= 480 || preg_match('/^480p$/i', $label)) {
        return '480p';
    }
    if ($height >= 360 || preg_match('/^360p$/i', $label)) {
        return '360p';
    }
    if (preg_match('/^(\d{3,4})p$/i', $label, $m)) {
        return $m[1] . 'p';
    }
    if (preg_match('/^(?:HD|SD)$/i', $label)) {
        return strtoupper($label);
    }
    if ($height > 0) {
        return $height . 'p';
    }
    return '';
}

/** Persist max known quality on a video row (never downgrade). */
function cfp_video_remember_quality(PDO $pdo, string $videoId, string $quality): void
{
    $quality = cfp_normalize_quality_label($quality);
    if ($quality === '' || $videoId === '') {
        return;
    }
    try {
        $rank = static function (string $q): int {
            if ($q === '4K') {
                return 2160;
            }
            if (preg_match('/^(\d{3,4})p$/i', $q, $m)) {
                return (int) $m[1];
            }
            return $q === 'HD' ? 720 : 0;
        };
        $st = $pdo->prepare('SELECT quality FROM videos WHERE video_id = ? LIMIT 1');
        $st->execute([$videoId]);
        $cur = (string) ($st->fetchColumn() ?: '');
        if ($cur !== '' && $rank($cur) >= $rank($quality)) {
            return;
        }
        $pdo->prepare('UPDATE videos SET quality = ? WHERE video_id = ?')->execute([$quality, $videoId]);
    } catch (Throwable $e) {
        // ignore
    }
}

/** Parse labels like 17.8M / 463.1K / 1200 into an int. */
function cfp_parse_count_label(string $label): int
{
    $label = strtoupper(trim(str_replace(',', '', $label)));
    if ($label === '') {
        return 0;
    }
    if (preg_match('/^([\d.]+)\s*([KMB])?$/', $label, $m)) {
        $n = (float) $m[1];
        $u = $m[2] ?? '';
        if ($u === 'K') {
            $n *= 1000;
        } elseif ($u === 'M') {
            $n *= 1000000;
        } elseif ($u === 'B') {
            $n *= 1000000000;
        }
        return (int) round($n);
    }
    if (ctype_digit($label)) {
        return (int) $label;
    }
    return 0;
}

/** Views shown on cards: prefer source (xvideos) count, else local. */
function cfp_card_views(array $item): int
{
    $source = (int) ($item['source_views'] ?? 0);
    $local = (int) ($item['views'] ?? 0);
    return $source > 0 ? $source : $local;
}

function cfp_card_channel(array $item): string
{
    return trim((string) ($item['channel_name'] ?? ''));
}

function cfp_card_quality(array $item): string
{
    return cfp_normalize_quality_label(trim((string) ($item['quality'] ?? '')));
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
