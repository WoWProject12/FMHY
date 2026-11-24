<?php
declare(strict_types=1);

/**
 * Chillflix ad placements. Monetag for browse surfaces; Adcash Pop-Under on player.
 * Per-surface toggles live in admin → Ads.
 */
final class MovyAds
{
    private const FILE = '/var/www/chillflix-lol-toflix/data/chillflix-ads.json';
    private const ACLIB_CACHE = '/var/www/chillflix-lol-toflix/data/cache/aclib-tag.txt';
    private const ACLIB_PUBLIC = '/var/www/chillflix.lol/public/chillflix-adcash-lib.js';
    private const ACLIB_URL = 'https://adbpage.com/adblock?v=3';
    private const ACLIB_TTL = 300;

    /** @return array<string,bool> */
    public static function pageKeys(): array
    {
        return [
            'home' => 'Home',
            'movie' => 'Movie details',
            'tv' => 'TV details',
            'player' => 'Player',
            'browse' => 'Browse',
            'search' => 'Search',
            'other' => 'Other pages',
        ];
    }

    /** Monetag surfaces only (player uses Adcash). */
    /** @return list<string> */
    public static function monetagPageKeys(): array
    {
        return ['home', 'movie', 'tv', 'browse', 'search', 'other'];
    }

    /** @return array<string,mixed> */
    public static function defaults(): array
    {
        $pages = [];
        foreach (array_keys(self::pageKeys()) as $k) {
            $pages[$k] = true;
        }
        return [
            'popunderEnabled' => true,
            // When true, ignore the account-menu "Show ads" toggle and always load.
            'forceAds' => true,
            'popunderZone' => '11200416',
            'popunderSrc' => 'https://llvpn.com/tag.min.js',
            'adcashEnabled' => true,
            'adcashZone' => '12296418',
            'adcashAntiAdblock' => true,
            'adcashLibSrc' => '/chillflix-adcash-lib.js',
            'adcashLibFile' => '',
            'adcashRotatedAt' => 0,
            'adcashAutoRotate' => true,
            'adcashAutoRotateMinutes' => 60,
            'pages' => $pages,
            'updated' => 0,
            // Bumped by admin reset so guest cookies/localStorage opt-outs expire.
            'prefEpoch' => 0,
        ];
    }

    /** @return array<string,mixed> */
    public static function get(): array
    {
        $out = self::defaults();
        if (!is_file(self::FILE)) {
            return $out;
        }
        try {
            $raw = json_decode((string) file_get_contents(self::FILE), true);
        } catch (Throwable $e) {
            return $out;
        }
        if (!is_array($raw)) {
            return $out;
        }
        if (array_key_exists('popunderEnabled', $raw)) {
            $out['popunderEnabled'] = (bool) $raw['popunderEnabled'];
        }
        if (array_key_exists('forceAds', $raw)) {
            $out['forceAds'] = (bool) $raw['forceAds'];
        }
        $zone = preg_replace('/\D+/', '', (string) ($raw['popunderZone'] ?? '')) ?? '';
        if ($zone !== '') {
            $out['popunderZone'] = $zone;
        }
        $src = trim((string) ($raw['popunderSrc'] ?? ''));
        if ($src !== '' && preg_match('#^https://[a-z0-9.-]+/.*\.js#i', $src)) {
            $out['popunderSrc'] = $src;
        }
        if (array_key_exists('adcashEnabled', $raw)) {
            $out['adcashEnabled'] = (bool) $raw['adcashEnabled'];
        }
        $acZone = preg_replace('/\D+/', '', (string) ($raw['adcashZone'] ?? '')) ?? '';
        if ($acZone !== '') {
            $out['adcashZone'] = $acZone;
        }

        if (array_key_exists('adcashAntiAdblock', $raw)) {
            $out['adcashAntiAdblock'] = (bool) $raw['adcashAntiAdblock'];
        }
        $libSrc = trim((string) ($raw['adcashLibSrc'] ?? ''));
        if ($libSrc !== '' && str_starts_with($libSrc, '/')) {
            $out['adcashLibSrc'] = $libSrc;
        }
        $libFile = trim((string) ($raw['adcashLibFile'] ?? ''));
        if ($libFile !== '') {
            $out['adcashLibFile'] = $libFile;
        }
        if (array_key_exists('adcashRotatedAt', $raw)) {
            $out['adcashRotatedAt'] = (int) $raw['adcashRotatedAt'];
        }
        if (array_key_exists('adcashAutoRotate', $raw)) {
            $out['adcashAutoRotate'] = (bool) $raw['adcashAutoRotate'];
        }
        if (array_key_exists('adcashAutoRotateMinutes', $raw)) {
            $out['adcashAutoRotateMinutes'] = max(10, min(10080, (int) $raw['adcashAutoRotateMinutes']));
        }
        if (isset($raw['pages']) && is_array($raw['pages'])) {
            foreach (array_keys(self::pageKeys()) as $k) {
                if (array_key_exists($k, $raw['pages'])) {
                    $out['pages'][$k] = (bool) $raw['pages'][$k];
                }
            }
        }
        $out['updated'] = (int) ($raw['updated'] ?? 0);
        $out['prefEpoch'] = (int) ($raw['prefEpoch'] ?? 0);
        return $out;
    }

    /** @param array<string,mixed> $body */
    public static function save(array $body): array
    {
        $cur = self::get();
        if (array_key_exists('popunderEnabled', $body)) {
            $cur['popunderEnabled'] = (bool) $body['popunderEnabled'];
        }
        if (array_key_exists('forceAds', $body)) {
            $cur['forceAds'] = (bool) $body['forceAds'];
        }
        if (isset($body['popunderZone'])) {
            $zone = preg_replace('/\D+/', '', (string) $body['popunderZone']) ?? '';
            if ($zone !== '') {
                $cur['popunderZone'] = $zone;
            }
        }
        if (isset($body['popunderSrc'])) {
            $src = trim((string) $body['popunderSrc']);
            if ($src !== '' && preg_match('#^https://[a-z0-9.-]+/.*\.js#i', $src)) {
                $cur['popunderSrc'] = $src;
            }
        }
        if (array_key_exists('adcashEnabled', $body)) {
            $cur['adcashEnabled'] = (bool) $body['adcashEnabled'];
        }
        if (isset($body['adcashZone'])) {
            $acZone = preg_replace('/\D+/', '', (string) $body['adcashZone']) ?? '';
            if ($acZone !== '') {
                $cur['adcashZone'] = $acZone;
            }
        }
        if (array_key_exists('adcashAntiAdblock', $body)) {
            $cur['adcashAntiAdblock'] = (bool) $body['adcashAntiAdblock'];
        }
        if (array_key_exists('adcashAutoRotate', $body)) {
            $cur['adcashAutoRotate'] = (bool) $body['adcashAutoRotate'];
        }
        if (isset($body['adcashAutoRotateMinutes'])) {
            $cur['adcashAutoRotateMinutes'] = max(10, min(10080, (int) $body['adcashAutoRotateMinutes']));
        }

        if (isset($body['pages']) && is_array($body['pages'])) {
            foreach (array_keys(self::pageKeys()) as $k) {
                if (array_key_exists($k, $body['pages'])) {
                    $cur['pages'][$k] = (bool) $body['pages'][$k];
                }
            }
        }
        $cur['updated'] = time();
        $dir = dirname(self::FILE);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $tmp = self::FILE . '.tmp';
        file_put_contents($tmp, json_encode($cur, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        rename($tmp, self::FILE);
        @chmod(self::FILE, 0664);
        $cur['playerSync'] = self::syncPlayerEmbedAds($cur);
        return $cur;
    }

    /**
     * Mirror Adcash player toggles into chillflix.pw embed_ads_config
     * so Ads clicks on chillflix.lol control the iframe player too.
     *
     * @param array<string,mixed> $cfg
     * @return array<string,mixed>
     */
    private static function syncPlayerEmbedAds(array $cfg): array
    {
        try {
            if (!class_exists('MovyStreamSources')) {
                return ['ok' => false, 'error' => 'stream-sources unavailable'];
            }
            $pdo = MovyStreamSources::chillflixPdo(true);
            $key = 'embed_ads_config';
            $stmt = $pdo->prepare('SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1');
            $stmt->execute([$key]);
            $raw = (string) ($stmt->fetchColumn() ?: '');
            $cur = $raw !== '' ? json_decode($raw, true) : null;
            if (!is_array($cur)) {
                $cur = [];
            }
            $pages = is_array($cfg['pages'] ?? null) ? $cfg['pages'] : [];
            $playerPageOn = !array_key_exists('player', $pages) || !empty($pages['player']);
            $adcashOn = !empty($cfg['adcashEnabled']) && $playerPageOn;
            $cur['adcashEnabled'] = $adcashOn;
            // Keep site-player surface in lockstep so disabling Adcash in lol admin
            // actually stops iframe showAds (and the empty first-click popup path).
            $cur['sitePlayerEnabled'] = $adcashOn;
            if (array_key_exists('adcashAntiAdblock', $cfg)) {
                $cur['adcashAntiAdblock'] = (bool) $cfg['adcashAntiAdblock'];
            }
            $zone = preg_replace('/\D+/', '', (string) ($cfg['adcashZone'] ?? '')) ?? '';
            if ($zone !== '' && $zone !== '12296418') {
                $cur['adcashZone'] = $zone;
            }
            if (empty($cur['adcashZone'])) {
                $cur['adcashZone'] = '12342562';
            }
            // Prefer the rotated pw /cdn/ path when present in player config already;
            // rotate helper updates this on the player host.
            if (!empty($cfg['adcashLibSrc']) && str_starts_with((string) $cfg['adcashLibSrc'], '/cdn/')) {
                $cur['adcashLibSrc'] = (string) $cfg['adcashLibSrc'];
            }
            $json = json_encode($cur, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($json) || $json === '') {
                return ['ok' => false, 'error' => 'encode failed'];
            }
            $now = (int) round(microtime(true) * 1000);
            $exists = $pdo->prepare('SELECT setting_key FROM site_settings WHERE setting_key = ?');
            $exists->execute([$key]);
            if ($exists->fetchColumn()) {
                $upd = $pdo->prepare('UPDATE site_settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?');
                $upd->execute([$json, $now, $key]);
            } else {
                $ins = $pdo->prepare('INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)');
                $ins->execute([$key, $json, $now]);
            }
            return [
                'ok' => true,
                'adcashEnabled' => !empty($cur['adcashEnabled']),
                'adcashZone' => (string) ($cur['adcashZone'] ?? ''),
            ];
        } catch (Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    /** Public payload for the site loader (no filesystem paths). */
    public static function viewerShouldSeeAds(): bool
    {
        if (class_exists('MovyAuth') && MovyAuth::isAdmin()) {
            return false;
        }
        return true;
    }

    /** @return array<string,mixed> */
    
    /** Bump guest/device ads preference epoch (invalidates old opt-outs). */
    
    /** Guest/device ads-off prefs (cookie/localStorage opt-outs reported by clients). */
    private static function guestPrefsFile(): string
    {
        return '/var/www/chillflix-lol-toflix/data/chillflix-ads-guest-prefs.json';
    }

    /** @return array{off:int,tracked:int,updated:int} */
    public static function guestPrefStats(): array
    {
        $raw = self::readGuestPrefs();
        $off = $raw['off'] ?? [];
        if (!is_array($off)) {
            $off = [];
        }
        return [
            'off' => count($off),
            'tracked' => count($off),
            'updated' => (int) ($raw['updated'] ?? 0),
        ];
    }

    /** @return array{off:array<string,int>,updated:int} */
    private static function readGuestPrefs(): array
    {
        $file = self::guestPrefsFile();
        $out = ['off' => [], 'updated' => 0];
        if (!is_file($file)) {
            return $out;
        }
        try {
            $raw = json_decode((string) file_get_contents($file), true);
        } catch (Throwable $e) {
            return $out;
        }
        if (!is_array($raw)) {
            return $out;
        }
        $off = $raw['off'] ?? [];
        if (!is_array($off)) {
            $off = [];
        }
        $clean = [];
        foreach ($off as $id => $ts) {
            $id = preg_replace('/[^a-zA-Z0-9._:-]+/', '', (string) $id) ?? '';
            if ($id === '' || strlen($id) > 80) {
                continue;
            }
            $clean[$id] = (int) $ts;
        }
        $out['off'] = $clean;
        $out['updated'] = (int) ($raw['updated'] ?? 0);
        return $out;
    }

    private static function writeGuestPrefs(array $data): void
    {
        $file = self::guestPrefsFile();
        $dir = dirname($file);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $payload = [
            'off' => $data['off'] ?? [],
            'updated' => (int) ($data['updated'] ?? time()),
        ];
        $tmp = $file . '.tmp';
        file_put_contents($tmp, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        rename($tmp, $file);
        @chmod($file, 0664);
    }

    /**
     * Record a guest/device show-ads preference.
     * @return array{ok:bool,guestOff:int}
     */
    public static function recordGuestPref(string $deviceId, bool $showAds): array
    {
        $deviceId = preg_replace('/[^a-zA-Z0-9._:-]+/', '', $deviceId) ?? '';
        if ($deviceId === '' || strlen($deviceId) > 80) {
            throw new InvalidArgumentException('Invalid device id.');
        }
        $cur = self::readGuestPrefs();
        $off = $cur['off'];
        if ($showAds) {
            unset($off[$deviceId]);
        } else {
            $off[$deviceId] = time();
            // Cap map size so a flood cannot grow the file forever.
            if (count($off) > 20000) {
                asort($off);
                $off = array_slice($off, -15000, null, true);
            }
        }
        self::writeGuestPrefs(['off' => $off, 'updated' => time()]);
        return ['ok' => true, 'guestOff' => count($off)];
    }

    /** Clear all guest/device ads-off records. Returns how many were cleared. */
    public static function clearGuestPrefs(): int
    {
        $cur = self::readGuestPrefs();
        $n = count($cur['off'] ?? []);
        self::writeGuestPrefs(['off' => [], 'updated' => time()]);
        return $n;
    }

    public static function bumpPrefEpoch(): int
    {
        self::clearGuestPrefs();
        $cur = self::get();
        $cur['prefEpoch'] = max((int) ($cur['prefEpoch'] ?? 0) + 1, time());
        $cur['updated'] = time();
        $dir = dirname(self::FILE);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $tmp = self::FILE . '.tmp';
        file_put_contents($tmp, json_encode($cur, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "
");
        rename($tmp, self::FILE);
        @chmod(self::FILE, 0664);
        return (int) $cur['prefEpoch'];
    }


    /** Browser-reachable Adcash lib URL on chillflix.lol (not pw /cdn/). */
    private static function lolAdcashLibUrl(array $cfg): string
    {
        $file = trim((string) ($cfg['adcashLibFile'] ?? ''));
        if ($file !== '' && is_file($file)) {
            $base = basename($file);
            if ($base !== '' && preg_match('/^[a-z0-9]{6,16}\.js$/i', $base)) {
                return '/assets/js/' . $base;
            }
        }
        $src = trim((string) ($cfg['adcashLibSrc'] ?? ''));
        if ($src !== '' && str_starts_with($src, '/assets/')) {
            return $src;
        }
        // Stable nginx alias on .lol — never emit pw-only /cdn/ here.
        return '/chillflix-adcash-lib.js';
    }

    public static function publicConfig(): array
    {
        $cfg = self::get();
        $see = self::viewerShouldSeeAds();
        $force = (bool) ($cfg['forceAds'] ?? false);
        $pages = $cfg['pages'];
        // Monetag never runs on player — Adcash owns that slot.
        $monetagPages = $pages;
        $monetagPages['player'] = false;
        $adcashOn = $see
            && (bool) ($cfg['adcashEnabled'] ?? false)
            && !empty($pages['player']);
        return [
            'on' => $see && (bool) $cfg['popunderEnabled'],
            'force' => $see && $force,
            // Client can opt out via account "Show ads" unless force is on.
            'needOptIn' => $see && !$force,
            'skip' => !$see,
            'zone' => (string) $cfg['popunderZone'],
            'src' => (string) $cfg['popunderSrc'],
            'pages' => $monetagPages,
            'prefEpoch' => (int) ($cfg['prefEpoch'] ?? 0),
            'adcash' => [
                'on' => $adcashOn,
                'zone' => (string) ($cfg['adcashZone'] ?? '12296418'),
                'antiAdblock' => (bool) ($cfg['adcashAntiAdblock'] ?? true),
                // /cdn/* is pw-only; on .lol that 404s and kills Adcash.
                'lib' => self::lolAdcashLibUrl($cfg),
                'rotatedAt' => (int) ($cfg['adcashRotatedAt'] ?? 0),
                'autoRotate' => (bool) ($cfg['adcashAutoRotate'] ?? true),
                'autoRotateMinutes' => (int) ($cfg['adcashAutoRotateMinutes'] ?? 60),
            ],
        ];
    }

    /**
     * Fetch + cache Adcash anti-adblock library (script tag wrapper).
     * Adcash may return non-2xx with a valid body — accept script-like payloads.
     */
    public static function adcashLibTag(bool $force = false): string
    {
        $cache = self::ACLIB_CACHE;
        $dir = dirname($cache);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        if (!$force && is_file($cache) && (time() - (int) filemtime($cache) < self::ACLIB_TTL)) {
            $hit = (string) file_get_contents($cache);
            if ($hit !== '' && self::looksLikeAdcashLib($hit)) {
                if (!is_file(self::ACLIB_PUBLIC)) {
                    self::publishAdcashPublicJs($hit);
                }
                return $hit;
            }
        }
        $body = self::fetchAdcashLib();
        if ($body !== '' && self::looksLikeAdcashLib($body)) {
            @file_put_contents($cache, $body, LOCK_EX);
            @chmod($cache, 0664);
            self::publishAdcashPublicJs($body);
            return $body;
        }
        if (is_file($cache)) {
            $stale = (string) file_get_contents($cache);
            if ($stale !== '') {
                return $stale;
            }
        }
        return '';
    }

    private static function looksLikeAdcashLib(string $body): bool
    {
        $trim = ltrim($body);
        return str_starts_with($trim, '<script')
            || str_starts_with($trim, 'window[')
            || str_contains($trim, 'aclib')
            || strlen($trim) > 1000;
    }

    private static function fetchAdcashLib(): string
    {
        $url = self::ACLIB_URL;
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return '';
            }
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_TIMEOUT => 12,
                CURLOPT_USERAGENT => 'ChillflixAdcashCache/1.0',
            ]);
            $content = curl_exec($ch);
            curl_close($ch);
            return is_string($content) ? $content : '';
        }
        $ctx = stream_context_create([
            'http' => [
                'timeout' => 12,
                'header' => "User-Agent: ChillflixAdcashCache/1.0\r\n",
                'ignore_errors' => true,
            ],
        ]);
        $content = @file_get_contents($url, false, $ctx);
        return is_string($content) ? $content : '';
    }

    private static function publishAdcashPublicJs(string $tag): void
    {
        $js = $tag;
        if (preg_match('#<script[^>]*>(.*)</script>#si', $tag, $m)) {
            $js = $m[1];
        }
        $dest = self::ACLIB_PUBLIC;
        $dir = dirname($dest);
        if (!is_dir($dir)) {
            return;
        }
        $tmp = $dest . '.tmp';
        @file_put_contents($tmp, $js, LOCK_EX);
        @rename($tmp, $dest);
        @chmod($dest, 0644);
    }

    /** @return array<string,mixed> */
    public static function rotateAntiAdblockLib(): array
    {
        $out = [];
        $code = 1;
        @exec('sudo -n /usr/local/sbin/chillflix-adcash-rotate 2>/dev/null', $out, $code);
        $raw = trim(implode(PHP_EOL, $out));
        $decoded = json_decode($raw, true);
        $ads = self::get();
        if (!is_array($decoded)) {
            return [
                'ok' => false,
                'message' => 'Rotate helper failed',
                'error' => 'sudo',
                'adcashLibSrc' => (string) ($ads['adcashLibSrc'] ?? ''),
                'adcashRotatedAt' => (int) ($ads['adcashRotatedAt'] ?? 0),
            ];
        }
        return [
            'ok' => !empty($decoded['ok']),
            'message' => (string) ($decoded['message'] ?? 'Done'),
            'adcashLibSrc' => (string) ($decoded['adcashLibSrc'] ?? $ads['adcashLibSrc'] ?? ''),
            'adcashRotatedAt' => (int) ($decoded['adcashRotatedAt'] ?? $ads['adcashRotatedAt'] ?? 0),
            'adcashAutoRotate' => !empty($ads['adcashAutoRotate']),
            'adcashAutoRotateMinutes' => (int) ($ads['adcashAutoRotateMinutes'] ?? 60),
            'error' => isset($decoded['error']) ? (string) $decoded['error'] : null,
        ];
    }
}
