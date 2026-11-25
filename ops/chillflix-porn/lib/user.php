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
               created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (id),
               UNIQUE KEY uq_username (username),
               UNIQUE KEY uq_email (email)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
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

/** @return array{id:int,username:string,email:?string}|null */
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
        ];
        return $cache;
    } catch (Throwable $e) {
        return null;
    }
}

function cfp_user_login(PDO $pdo, string $username, string $password): array
{
    cfp_ensure_user_schema($pdo);
    $username = strtolower(trim($username));
    if ($username === '' || $password === '') {
        return ['ok' => false, 'error' => 'Missing username or password'];
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
