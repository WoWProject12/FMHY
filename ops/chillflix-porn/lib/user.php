<?php
declare(strict_types=1);

function cfp_ensure_user_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS users (
               id INT UNSIGNED NOT NULL AUTO_INCREMENT,
               username VARCHAR(64) NOT NULL,
               email VARCHAR(190) NULL DEFAULT NULL,
               pass_hash VARCHAR(255) NOT NULL,
               avatar_url VARCHAR(500) NULL DEFAULT NULL,
               created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (id),
               UNIQUE KEY uq_username (username),
               UNIQUE KEY uq_email (email)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
        try {
            $pdo->exec('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL DEFAULT NULL');
        } catch (Throwable $e) {
            // column already exists
        }
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS user_library (
               user_id INT UNSIGNED NOT NULL,
               video_id BIGINT UNSIGNED NOT NULL,
               kind VARCHAR(20) NOT NULL,
               updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
               PRIMARY KEY (user_id, video_id, kind),
               KEY idx_user_kind (user_id, kind, updated_at),
               CONSTRAINT fk_ul_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
               CONSTRAINT fk_ul_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
    } catch (Throwable $e) {
        // ignore
    }
}

function cfp_user_cookie_secret(): string
{
    $base = defined('CFP_DB_PASS') ? (string) CFP_DB_PASS : 'cfp';
    if (defined('CFP_ADMIN_PASS') && CFP_ADMIN_PASS !== '') {
        $base .= '|' . (string) CFP_ADMIN_PASS;
    }
    return hash('sha256', $base . '|cfp-user-auth');
}

function cfp_user_set_auth_cookie(int $userId): void
{
    $sig = hash_hmac('sha256', (string) $userId, cfp_user_cookie_secret());
    $val = $userId . '.' . $sig;
    // Path / so cookie survives /porn and /porn/ equally
    $opts = [
        'expires' => time() + 60 * 60 * 24 * 60,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ];
    setcookie('cfp_auth', $val, $opts);
    // Clear any older cookie scoped to /porn/
    if (CFP_BASE !== '') {
        setcookie('cfp_auth', '', [
            'expires' => time() - 3600,
            'path' => rtrim(CFP_BASE, '/') . '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    $_COOKIE['cfp_auth'] = $val;
}

function cfp_user_clear_auth_cookie(): void
{
    $opts = [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ];
    setcookie('cfp_auth', '', $opts);
    if (CFP_BASE !== '') {
        setcookie('cfp_auth', '', [
            'expires' => time() - 3600,
            'path' => rtrim(CFP_BASE, '/') . '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    unset($_COOKIE['cfp_auth']);
}

/** @return array{id:int,username:string,email:?string,avatar_url:?string}|null */
function cfp_current_user(PDO $pdo = null): ?array
{
    $raw = (string) ($_COOKIE['cfp_auth'] ?? '');
    if ($raw === '' || !str_contains($raw, '.')) {
        return null;
    }
    [$idRaw, $sig] = explode('.', $raw, 2);
    $id = (int) $idRaw;
    if ($id < 1 || $sig === '') {
        return null;
    }
    $expect = hash_hmac('sha256', (string) $id, cfp_user_cookie_secret());
    if (!hash_equals($expect, $sig)) {
        return null;
    }
    static $cache = null;
    if (is_array($cache) && (int) $cache['id'] === $id) {
        return $cache;
    }
    try {
        $pdo = $pdo ?: cfp_pdo();
        cfp_ensure_user_schema($pdo);
        $st = $pdo->prepare('SELECT id, username, email, avatar_url FROM users WHERE id = ? LIMIT 1');
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        $cache = [
            'id' => (int) $row['id'],
            'username' => (string) $row['username'],
            'email' => $row['email'] !== null ? (string) $row['email'] : null,
            'avatar_url' => !empty($row['avatar_url']) ? (string) $row['avatar_url'] : null,
        ];
        return $cache;
    } catch (Throwable $e) {
        // Older DBs without avatar_url column — retry without it
        try {
            $pdo = $pdo ?: cfp_pdo();
            $st = $pdo->prepare('SELECT id, username, email FROM users WHERE id = ? LIMIT 1');
            $st->execute([$id]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                return null;
            }
            $cache = [
                'id' => (int) $row['id'],
                'username' => (string) $row['username'],
                'email' => $row['email'] !== null ? (string) $row['email'] : null,
                'avatar_url' => null,
            ];
            return $cache;
        } catch (Throwable $e2) {
            return null;
        }
    }
}

/** Ensure a site "admin" user exists (password = admin panel pass). @return array{id:int,username:string,email:?string} */
function cfp_ensure_admin_user(PDO $pdo): array
{
    cfp_ensure_user_schema($pdo);
    $adminPass = function_exists('cfp_admin_pass') ? cfp_admin_pass() : (defined('CFP_ADMIN_PASS') ? (string) CFP_ADMIN_PASS : '');
    $st = $pdo->prepare('SELECT id, username, email, pass_hash FROM users WHERE username = ? LIMIT 1');
    $st->execute(['admin']);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        // Keep hash in sync with current admin panel password when provided
        if ($adminPass !== '' && !password_verify($adminPass, (string) $row['pass_hash'])) {
            $hash = password_hash($adminPass, PASSWORD_DEFAULT);
            $pdo->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([$hash, (int) $row['id']]);
        }
        return [
            'id' => (int) $row['id'],
            'username' => (string) $row['username'],
            'email' => $row['email'] !== null ? (string) $row['email'] : null,
        ];
    }
    $hash = password_hash($adminPass !== '' ? $adminPass : bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
    $pdo->prepare('INSERT INTO users (username, email, pass_hash) VALUES (?,?,?)')
        ->execute(['admin', null, $hash]);
    return [
        'id' => (int) $pdo->lastInsertId(),
        'username' => 'admin',
        'email' => null,
    ];
}

function cfp_user_login(PDO $pdo, string $username, string $password): array
{
    cfp_ensure_user_schema($pdo);
    $username = strtolower(trim($username));
    if ($username === '' || $password === '') {
        return ['ok' => false, 'error' => 'Missing username or password'];
    }

    // Site admin credentials also work on the public Login form
    $adminPass = function_exists('cfp_admin_pass') ? cfp_admin_pass() : (defined('CFP_ADMIN_PASS') ? (string) CFP_ADMIN_PASS : '');
    if ($username === 'admin' && $adminPass !== '' && hash_equals($adminPass, $password)) {
        $user = cfp_ensure_admin_user($pdo);
        cfp_user_set_auth_cookie((int) $user['id']);
        if (function_exists('cfp_admin_login')) {
            cfp_admin_login($password);
        }
        return ['ok' => true, 'user' => $user];
    }

    $st = $pdo->prepare(
        'SELECT id, username, email, pass_hash FROM users
         WHERE username = ? OR LOWER(COALESCE(email, \'\')) = ? LIMIT 1'
    );
    $st->execute([$username, $username]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row || !password_verify($password, (string) $row['pass_hash'])) {
        return ['ok' => false, 'error' => 'Wrong username or password. Create an account if you are new here.'];
    }
    cfp_user_set_auth_cookie((int) $row['id']);
    // If this is the admin user signing in with their user password, open admin session too
    if ((string) $row['username'] === 'admin' && $adminPass !== '' && hash_equals($adminPass, $password) && function_exists('cfp_admin_login')) {
        cfp_admin_login($password);
    }
    return [
        'ok' => true,
        'user' => [
            'id' => (int) $row['id'],
            'username' => (string) $row['username'],
            'email' => $row['email'] !== null ? (string) $row['email'] : null,
        ],
    ];
}

function cfp_user_register(PDO $pdo, string $username, string $password, ?string $email = null): array
{
    cfp_ensure_user_schema($pdo);
    $username = strtolower(trim($username));
    $email = $email !== null ? strtolower(trim($email)) : null;
    if ($email === '') {
        $email = null;
    }
    if (!preg_match('/^[a-z0-9_]{3,32}$/', $username)) {
        return ['ok' => false, 'error' => 'Username must be 3–32 chars (a-z, 0-9, _)'];
    }
    if (strlen($password) < 6) {
        return ['ok' => false, 'error' => 'Password must be at least 6 characters'];
    }
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid email'];
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    try {
        $st = $pdo->prepare('INSERT INTO users (username, email, pass_hash) VALUES (?,?,?)');
        $st->execute([$username, $email, $hash]);
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => 'Username or email already taken'];
    }
    return cfp_user_login($pdo, $username, $password);
}

function cfp_user_logout(): void
{
    cfp_user_clear_auth_cookie();
}

/** @return list<string> */
function cfp_library_kinds(): array
{
    return ['history', 'saved', 'liked', 'downloaded'];
}

function cfp_library_add(PDO $pdo, int $userId, string $partnerVideoId, string $kind): bool
{
    $kind = strtolower($kind);
    if (!in_array($kind, cfp_library_kinds(), true) || $partnerVideoId === '') {
        return false;
    }
    cfp_ensure_user_schema($pdo);
    $st = $pdo->prepare('SELECT id FROM videos WHERE video_id = ? LIMIT 1');
    $st->execute([$partnerVideoId]);
    $vid = (int) $st->fetchColumn();
    if ($vid < 1) {
        return false;
    }
    $pdo->prepare(
        'INSERT INTO user_library (user_id, video_id, kind, updated_at) VALUES (?,?,?,NOW())
         ON DUPLICATE KEY UPDATE updated_at = NOW()'
    )->execute([$userId, $vid, $kind]);

    // Cap history length
    if ($kind === 'history') {
        $pdo->prepare(
            'DELETE FROM user_library
             WHERE user_id = ? AND kind = \'history\' AND video_id NOT IN (
               SELECT video_id FROM (
                 SELECT video_id FROM user_library
                 WHERE user_id = ? AND kind = \'history\'
                 ORDER BY updated_at DESC LIMIT 100
               ) t
             )'
        )->execute([$userId, $userId]);
    }
    return true;
}

function cfp_library_remove(PDO $pdo, int $userId, string $partnerVideoId, string $kind): bool
{
    $kind = strtolower($kind);
    if (!in_array($kind, cfp_library_kinds(), true) || $partnerVideoId === '') {
        return false;
    }
    $st = $pdo->prepare('SELECT id FROM videos WHERE video_id = ? LIMIT 1');
    $st->execute([$partnerVideoId]);
    $vid = (int) $st->fetchColumn();
    if ($vid < 1) {
        return false;
    }
    $pdo->prepare('DELETE FROM user_library WHERE user_id = ? AND video_id = ? AND kind = ?')
        ->execute([$userId, $vid, $kind]);
    return true;
}

/**
 * @return array{items:list<array>,total:int,page:int,per:int,pages:int}
 */
function cfp_library_list(PDO $pdo, int $userId, string $kind, int $page = 1, int $per = 24): array
{
    $kind = strtolower($kind);
    if (!in_array($kind, cfp_library_kinds(), true)) {
        $kind = 'history';
    }
    $page = max(1, $page);
    $per = max(12, min(48, $per));
    $offset = ($page - 1) * $per;
    cfp_ensure_user_schema($pdo);

    $count = $pdo->prepare('SELECT COUNT(*) FROM user_library WHERE user_id = ? AND kind = ?');
    $count->execute([$userId, $kind]);
    $total = (int) $count->fetchColumn();

    $st = $pdo->prepare(
        'SELECT v.* FROM videos v
         INNER JOIN user_library ul ON ul.video_id = v.id
         WHERE ul.user_id = ? AND ul.kind = ?
         ORDER BY ul.updated_at DESC
         LIMIT ? OFFSET ?'
    );
    $st->execute([$userId, $kind, $per, $offset]);

    return [
        'items' => $st->fetchAll(),
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'pages' => max(1, (int) ceil($total / max(1, $per))),
    ];
}

/** @return array<string,int> */
function cfp_library_counts(PDO $pdo, int $userId): array
{
    cfp_ensure_user_schema($pdo);
    $out = ['history' => 0, 'saved' => 0, 'liked' => 0, 'downloaded' => 0];
    $st = $pdo->prepare('SELECT kind, COUNT(*) AS n FROM user_library WHERE user_id = ? GROUP BY kind');
    $st->execute([$userId]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $k = (string) $row['kind'];
        if (isset($out[$k])) {
            $out[$k] = (int) $row['n'];
        }
    }
    return $out;
}

/** @return array{history:bool,saved:bool,liked:bool,downloaded:bool} */
function cfp_library_flags(PDO $pdo, int $userId, string $partnerVideoId): array
{
    $out = ['history' => false, 'saved' => false, 'liked' => false, 'downloaded' => false];
    if ($partnerVideoId === '' || $userId < 1) {
        return $out;
    }
    cfp_ensure_user_schema($pdo);
    $st = $pdo->prepare('SELECT id FROM videos WHERE video_id = ? LIMIT 1');
    $st->execute([$partnerVideoId]);
    $vid = (int) $st->fetchColumn();
    if ($vid < 1) {
        return $out;
    }
    $st2 = $pdo->prepare('SELECT kind FROM user_library WHERE user_id = ? AND video_id = ?');
    $st2->execute([$userId, $vid]);
    foreach ($st2->fetchAll(PDO::FETCH_COLUMN) as $kind) {
        $k = (string) $kind;
        if (isset($out[$k])) {
            $out[$k] = true;
        }
    }
    return $out;
}

/**
 * Actor-thumb choices for the profile avatar picker.
 * @return list<array{url:string,name:string}>
 */
function cfp_avatar_choices(?PDO $pdo = null, int $limit = 48): array
{
    $limit = max(12, min(96, $limit));
    static $cached = null;
    static $cachedLimit = 0;
    if (is_array($cached) && $cachedLimit >= $limit) {
        return array_slice($cached, 0, $limit);
    }
    try {
        $pdo = $pdo ?: cfp_pdo();
        $st = $pdo->query(
            "SELECT a.name,
                    (
                      SELECT v2.thumb FROM videos v2
                      INNER JOIN video_actors va2 ON va2.video_id = v2.id
                      WHERE va2.actor_id = a.id AND v2.thumb IS NOT NULL AND v2.thumb <> ''
                      ORDER BY GREATEST(COALESCE(v2.source_views,0), COALESCE(v2.views,0)) DESC
                      LIMIT 1
                    ) AS thumb
             FROM actors a
             INNER JOIN video_actors va ON va.actor_id = a.id AND va.role = 'model'
             LEFT JOIN videos v ON v.id = va.video_id
             GROUP BY a.id
             HAVING thumb IS NOT NULL AND thumb <> ''
             ORDER BY COALESCE(SUM(GREATEST(COALESCE(v.source_views,0), COALESCE(v.views,0))), 0) DESC
             LIMIT " . (int) $limit
        );
        $out = [];
        $seen = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $url = trim((string) ($row['thumb'] ?? ''));
            if ($url === '' || isset($seen[$url])) {
                continue;
            }
            $seen[$url] = true;
            $out[] = [
                'url' => $url,
                'name' => (string) ($row['name'] ?? ''),
            ];
        }
        $cached = $out;
        $cachedLimit = $limit;
        return $out;
    } catch (Throwable $e) {
        return [];
    }
}

function cfp_user_set_avatar(PDO $pdo, int $userId, ?string $url): bool
{
    cfp_ensure_user_schema($pdo);
    $url = $url !== null ? trim($url) : null;
    if ($url === '') {
        $url = null;
    }
    if ($url !== null) {
        if (strlen($url) > 500) {
            return false;
        }
        // Only allow thumbs from the actor pool
        $ok = false;
        foreach (cfp_avatar_choices($pdo, 96) as $choice) {
            if (hash_equals($choice['url'], $url)) {
                $ok = true;
                break;
            }
        }
        if (!$ok) {
            return false;
        }
    }
    $st = $pdo->prepare('UPDATE users SET avatar_url = ? WHERE id = ?');
    $st->execute([$url, $userId]);
    return true;
}

/**
 * Profile avatar: saved choice first, else history actor, else popular pool.
 */
function cfp_user_avatar_url(?array $user, ?PDO $pdo = null): ?string
{
    if (!$user || empty($user['id'])) {
        return null;
    }
    if (!empty($user['avatar_url'])) {
        return (string) $user['avatar_url'];
    }
    $uid = (int) $user['id'];
    static $cache = [];
    if (array_key_exists($uid, $cache)) {
        return $cache[$uid];
    }
    try {
        $pdo = $pdo ?: cfp_pdo();
        // Prefer actor thumb from recent history
        $st = $pdo->prepare(
            "SELECT (
                SELECT v2.thumb FROM videos v2
                INNER JOIN video_actors va2 ON va2.video_id = v2.id
                WHERE va2.actor_id = a.id AND v2.thumb IS NOT NULL AND v2.thumb <> ''
                ORDER BY GREATEST(COALESCE(v2.source_views,0), COALESCE(v2.views,0)) DESC
                LIMIT 1
             ) AS thumb
             FROM user_library ul
             INNER JOIN video_actors va ON va.video_id = ul.video_id
             INNER JOIN actors a ON a.id = va.actor_id
             WHERE ul.user_id = ? AND ul.kind = 'history' AND va.role = 'model'
             ORDER BY ul.updated_at DESC
             LIMIT 16"
        );
        $st->execute([$uid]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $thumb) {
            $thumb = trim((string) $thumb);
            if ($thumb !== '') {
                $cache[$uid] = $thumb;
                return $thumb;
            }
        }
        $pool = cfp_avatar_choices($pdo, 48);
        if ($pool) {
            $cache[$uid] = $pool[$uid % count($pool)]['url'];
            return $cache[$uid];
        }
    } catch (Throwable $e) {
        // ignore
    }
    $cache[$uid] = null;
    return null;
}
