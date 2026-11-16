<?php
declare(strict_types=1);

/**
 * Proxy scrape / stream-theft intel from chillflix.pw player host.
 */
final class MovyScrapeIntel
{
    /** @return array<string, string> */
    private static function playerEnv(): array
    {
        static $cache = null;
        if (is_array($cache)) {
            return $cache;
        }

        $cache = [];
        if (class_exists('MovyStreamSources')) {
            try {
                $ref = new ReflectionClass('MovyStreamSources');
                if ($ref->hasMethod('playerEnv')) {
                    $m = $ref->getMethod('playerEnv');
                    $m->setAccessible(true);
                    $env = $m->invoke(null);
                    if (is_array($env)) {
                        $cache = $env;
                    }
                }
            } catch (Throwable $e) {
                // fall through to file parse
            }
        }

        foreach (['/etc/chillflix-stream-sources.env', '/var/www/chillflix/app/.env.local'] as $envFile) {
            if (!is_readable($envFile)) {
                continue;
            }
            foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $line = trim((string) $line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                    continue;
                }
                [$k, $v] = explode('=', $line, 2);
                $k = trim($k);
                $v = trim($v, " \t\"'");
                if (
                    in_array(
                        $k,
                        [
                            'STREAM_SOURCES_SYNC_SECRET',
                            'STREAM_SOURCES_RELOAD_URL',
                            'STREAM_SOURCES_RELOAD_ORIGIN_IP',
                        ],
                        true
                    ) && !isset($cache[$k])
                ) {
                    $cache[$k] = $v;
                }
            }
        }
        return $cache;
    }

    /**
     * @param array<string, mixed>|null $body
     * @return array<string, mixed>
     */
    private static function request(string $method, string $query = '', ?array $body = null): array
    {
        $env = self::playerEnv();
        $secret = $env['STREAM_SOURCES_SYNC_SECRET'] ?? (getenv('STREAM_SOURCES_SYNC_SECRET') ?: '');
        if ($secret === '') {
            return ['ok' => false, 'error' => 'Missing STREAM_SOURCES_SYNC_SECRET'];
        }

        $originIp = $env['STREAM_SOURCES_RELOAD_ORIGIN_IP']
            ?? (getenv('STREAM_SOURCES_RELOAD_ORIGIN_IP') ?: '82.41.181.83');
        $path = '/api/internal/scrape-intel' . $query;
        $url = 'https://www.chillflix.pw' . $path;

        $headers = [
            'Accept: application/json',
            'Content-Type: application/json',
            'X-Stream-Sources-Sync: ' . $secret,
            'Host: www.chillflix.pw',
        ];

        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RESOLVE => ['www.chillflix.pw:443:' . $originIp],
            // Origin IP presents a cert that may not match when we resolve past CF.
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ];
        if (strtoupper($method) === 'POST') {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = json_encode($body ?? new stdClass(), JSON_UNESCAPED_SLASHES);
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            return ['ok' => false, 'error' => $err !== '' ? $err : 'Player host unreachable', 'http' => $http];
        }

        $json = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($json)) {
            return ['ok' => false, 'error' => 'Bad JSON from player host', 'http' => $http];
        }
        if ($http >= 400) {
            return [
                'ok' => false,
                'error' => (string) ($json['error'] ?? ('HTTP ' . $http)),
                'http' => $http,
            ];
        }

        $json['ok'] = true;
        $json['http'] = $http;
        return $json;
    }

    /** @return array<string, mixed> */
    public static function summary(int $hours = 24): array
    {
        $hours = max(1, min(72, $hours));
        $json = self::request('GET', '?hours=' . $hours);
        if (empty($json['ok']) || !is_array($json['summary'] ?? null)) {
            return $json;
        }

        $summary = $json['summary'];

        // Bound payload size — large recentAttempts + intel blew past mobile
        // admin timeouts and looked like "error loading" even when PHP succeeded.
        if (isset($summary['recentAttempts']) && is_array($summary['recentAttempts'])) {
            $summary['recentAttempts'] = array_slice($summary['recentAttempts'], 0, 40);
        }
        if (isset($summary['hotIps']) && is_array($summary['hotIps'])) {
            $summary['hotIps'] = array_slice($summary['hotIps'], 0, 20);
        }

        $ips = [];
        foreach (($summary['hotIps'] ?? []) as $row) {
            if (is_array($row) && !empty($row['ip'])) {
                $ips[] = (string) $row['ip'];
            }
        }
        foreach (($summary['recentAttempts'] ?? []) as $row) {
            if (is_array($row) && !empty($row['ip'])) {
                $ips[] = (string) $row['ip'];
            }
        }

        // Enrichment is best-effort — never fail the whole admin payload if DNS/API stalls.
        $intel = [];
        if (class_exists('MovyIpIntel')) {
            try {
                $intel = MovyIpIntel::enrichMany($ips, 2.5);
            } catch (Throwable $e) {
                $intel = [];
            }
        }

        if (isset($summary['hotIps']) && is_array($summary['hotIps'])) {
            foreach ($summary['hotIps'] as &$row) {
                if (!is_array($row)) {
                    continue;
                }
                $ip = (string) ($row['ip'] ?? '');
                $info = $intel[$ip] ?? null;
                if (is_array($info)) {
                    $row['intel'] = $info;
                    $row['scrapeRisk'] = self::scrapeRisk($row, $info);
                }
            }
            unset($row);
        }

        if (isset($summary['recentAttempts']) && is_array($summary['recentAttempts'])) {
            foreach ($summary['recentAttempts'] as &$row) {
                if (!is_array($row)) {
                    continue;
                }
                $ip = (string) ($row['ip'] ?? '');
                if (isset($intel[$ip])) {
                    $row['intel'] = [
                        'kind' => $intel[$ip]['kind'] ?? 'unknown',
                        'label' => $intel[$ip]['label'] ?? '',
                        'org' => $intel[$ip]['org'] ?? '',
                        'rdns' => $intel[$ip]['rdns'] ?? '',
                        'links' => $intel[$ip]['links'] ?? [],
                    ];
                }
            }
            unset($row);
        }

        // Clarify foreign hosts: search engines are not pirate players.
        if (isset($summary['foreignBlockedHosts']) && is_array($summary['foreignBlockedHosts'])) {
            foreach ($summary['foreignBlockedHosts'] as &$hostRow) {
                if (!is_array($hostRow)) {
                    continue;
                }
                $host = strtolower((string) ($hostRow['key'] ?? ''));
                $hostRow['verdict'] = self::hostVerdict($host);
            }
            unset($hostRow);
        }

        $json['summary'] = $summary;
        $json['ipIntel'] = $intel;
        return $json;
    }

    /**
     * @param array<string, mixed> $hot
     * @param array<string, mixed> $info
     */
    private static function scrapeRisk(array $hot, array $info): string
    {
        $blocked = (int) ($hot['blocked'] ?? 0);
        $sources = (int) ($hot['sources'] ?? 0);
        $kind = (string) ($info['kind'] ?? 'unknown');

        if ($kind === 'search_bot') {
            return 'low';
        }
        if ($kind === 'datacenter' && $blocked >= 5) {
            return 'high';
        }
        if ($kind === 'datacenter' && ($blocked >= 2 || $sources >= 200)) {
            return 'medium';
        }
        if ($kind === 'proxy_vpn' && $blocked >= 3) {
            return 'medium';
        }
        if ($blocked >= 20) {
            return 'high';
        }
        if ($blocked >= 5) {
            return 'medium';
        }
        return 'low';
    }

    private static function hostVerdict(string $host): array
    {
        $search = ['yandex.', 'google.', 'bing.', 'duckduckgo.', 'baidu.', 'yahoo.', 'brave.com'];
        foreach ($search as $needle) {
            if ($host === rtrim($needle, '.') || str_contains($host, $needle)) {
                return [
                    'code' => 'search_referrer',
                    'label' => 'Search / crawler referrer',
                    'note' => 'Not a pirate player by itself — usually a search click or bot Referer.',
                ];
            }
        }
        if ($host === '(none)' || $host === '') {
            return [
                'code' => 'no_host',
                'label' => 'No Origin/Referer',
                'note' => 'Scripts and scrapers often omit site headers. High signal when paired with script UAs.',
            ];
        }
        if (str_contains($host, 'chillflix.') || str_contains($host, 'toflix.') || str_contains($host, 'vuflix.')) {
            return [
                'code' => 'own',
                'label' => 'Own brand host',
                'note' => 'Should not appear as a foreign scrape host.',
            ];
        }
        return [
            'code' => 'foreign_site',
            'label' => 'Foreign site',
            'note' => 'If this keeps showing with guard blocks, that site (or someone spoofing it) is calling your player APIs.',
        ];
    }

    /** @return array<string, mixed> */
    public static function blockIp(string $ip, string $note = '', string $host = ''): array
    {
        $ip = trim($ip);
        if ($ip === '') {
            return ['ok' => false, 'error' => 'IP is required'];
        }
        $payload = [
            'action' => 'blockIp',
            'ip' => $ip,
            'note' => $note !== '' ? $note : ('Blocked from chillflix.lol admin ' . gmdate('c')),
        ];
        $host = strtolower(trim($host));
        $host = preg_replace('#^https?://#', '', $host) ?? $host;
        $host = explode('/', $host)[0];
        $host = explode(':', $host)[0];
        if ($host !== '' && preg_match('/^[a-z0-9.-]+$/', $host)) {
            $payload['host'] = $host;
        }
        return self::request('POST', '', $payload);
    }
}
