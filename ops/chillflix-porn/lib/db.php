<?php
declare(strict_types=1);

function cfp_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        CFP_DB_HOST,
        CFP_DB_NAME
    );
    $pdo = new PDO($dsn, CFP_DB_USER, CFP_DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function cfp_ensure_unique_slug(PDO $pdo, string $slug, ?int $exceptId = null): string
{
    $base = $slug;
    $n = 0;
    while (true) {
        $try = $n === 0 ? $base : $base . '-' . $n;
        $sql = 'SELECT id FROM videos WHERE slug = ?';
        $args = [$try];
        if ($exceptId) {
            $sql .= ' AND id <> ?';
            $args[] = $exceptId;
        }
        $st = $pdo->prepare($sql);
        $st->execute($args);
        if (!$st->fetch()) {
            return $try;
        }
        $n++;
        if ($n > 50) {
            return $base . '-' . bin2hex(random_bytes(3));
        }
    }
}

function cfp_upsert_category(PDO $pdo, string $name): int
{
    $name = trim($name);
    if ($name === '') {
        $name = 'General';
    }
    $slug = cfp_slug($name);
    $st = $pdo->prepare('INSERT INTO categories (slug, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)');
    $st->execute([$slug, $name]);
    $st = $pdo->prepare('SELECT id FROM categories WHERE slug = ?');
    $st->execute([$slug]);
    return (int) $st->fetchColumn();
}

function cfp_upsert_tag(PDO $pdo, string $name): int
{
    $name = trim($name);
    if ($name === '') {
        return 0;
    }
    $slug = cfp_slug($name);
    $st = $pdo->prepare('INSERT INTO tags (slug, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)');
    $st->execute([$slug, $name]);
    $st = $pdo->prepare('SELECT id FROM tags WHERE slug = ?');
    $st->execute([$slug]);
    return (int) $st->fetchColumn();
}

/**
 * One-shot: listing scrapes used to tag channel/group names as people (role=model).
 * Flip those links to channel and queue enriched videos for a clean re-parse.
 */
function cfp_repair_actor_roles(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS scrape_state (
               k VARCHAR(64) NOT NULL PRIMARY KEY,
               v TEXT NULL
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
    } catch (Throwable $e) {
        return;
    }
    $st = $pdo->prepare('SELECT v FROM scrape_state WHERE k = ?');
    $st->execute(['people_roles_v1']);
    if ($st->fetchColumn()) {
        return;
    }

    // Unenriched rows only ever got the listing-card channel name.
    $pdo->exec(
        'UPDATE video_actors va
         INNER JOIN videos v ON v.id = va.video_id
         SET va.role = \'channel\'
         WHERE va.role = \'model\' AND v.enriched_at IS NULL'
    );

    // Drop stale people links on enriched videos and re-parse from xvideos.
    $pdo->exec(
        'DELETE va FROM video_actors va
         INNER JOIN videos v ON v.id = va.video_id
         WHERE v.enriched_at IS NOT NULL'
    );
    $pdo->exec('UPDATE videos SET enriched_at = NULL WHERE enriched_at IS NOT NULL');

    $up = $pdo->prepare('INSERT INTO scrape_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
    $up->execute(['people_roles_v1', date('c')]);
}

function cfp_upsert_actor(PDO $pdo, string $name, ?string $slugOverride = null): int
{
    $name = trim($name);
    if ($name === '') {
        return 0;
    }
    $slug = trim((string) $slugOverride);
    if ($slug === '') {
        $slug = cfp_slug($name);
    } else {
        $slug = cfp_slug($slug);
    }
    if ($slug === '' || $slug === 'video') {
        return 0;
    }
    $st = $pdo->prepare('INSERT INTO actors (slug, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)');
    $st->execute([$slug, $name]);
    $st = $pdo->prepare('SELECT id FROM actors WHERE slug = ?');
    $st->execute([$slug]);
    return (int) $st->fetchColumn();
}

/** Ensure optional columns used by people/tag enrichment exist. */
function cfp_ensure_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM videos LIKE 'enriched_at'")->fetchAll();
        if (!$cols) {
            $pdo->exec('ALTER TABLE videos ADD COLUMN enriched_at DATETIME NULL DEFAULT NULL, ADD KEY idx_enriched (enriched_at)');
        }
    } catch (Throwable $e) {
        // ignore — older MySQL or missing privilege; enrich will no-op safely
    }
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM video_actors LIKE 'role'")->fetchAll();
        if (!$cols) {
            $pdo->exec("ALTER TABLE video_actors ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'model'");
            // One-shot: re-enrich so channel vs model roles populate on next view
            $pdo->exec(
                'UPDATE videos v
                 INNER JOIN video_actors va ON va.video_id = v.id
                 SET v.enriched_at = NULL'
            );
        }
    } catch (Throwable $e) {
        // ignore
    }
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM videos LIKE 'likes'")->fetchAll();
        if (!$cols) {
            $pdo->exec('ALTER TABLE videos ADD COLUMN likes INT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN dislikes INT UNSIGNED NOT NULL DEFAULT 0');
        }
    } catch (Throwable $e) {
        // ignore
    }
    try {
        $pdo->query('SELECT 1 FROM video_votes LIMIT 1');
    } catch (Throwable $e) {
        try {
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS video_votes (
                   video_id BIGINT UNSIGNED NOT NULL,
                   voter_key VARCHAR(64) NOT NULL,
                   vote TINYINT NOT NULL,
                   updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                   PRIMARY KEY (video_id, voter_key),
                   KEY idx_vote (video_id, vote),
                   CONSTRAINT fk_vv_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
                 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
            );
        } catch (Throwable $e2) {
            // ignore
        }
    }
    try {
        cfp_repair_actor_roles($pdo);
    } catch (Throwable $e) {
        // ignore
    }
}

/** Stable anonymous voter id (cookie). */
function cfp_voter_key(): string
{
    $key = (string) ($_COOKIE['cfp_voter'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
        $key = bin2hex(random_bytes(16));
        setcookie('cfp_voter', $key, [
            'expires' => time() + 60 * 60 * 24 * 400,
            'path' => '/',
            'secure' => true,
            'httponly' => false,
            'samesite' => 'Lax',
        ]);
        $_COOKIE['cfp_voter'] = $key;
    }
    return $key;
}

/**
 * Apply like/dislike for a partner video_id. $vote: 1 like, -1 dislike, 0 clear.
 * @return array{likes:int,dislikes:int,mine:int}
 */
function cfp_cast_vote(PDO $pdo, string $partnerVideoId, int $vote): array
{
    cfp_ensure_schema($pdo);
    $vote = $vote >= 1 ? 1 : ($vote <= -1 ? -1 : 0);
    $st = $pdo->prepare('SELECT id, likes, dislikes FROM videos WHERE video_id = ? LIMIT 1');
    $st->execute([$partnerVideoId]);
    $row = $st->fetch();
    if (!$row) {
        return ['likes' => 0, 'dislikes' => 0, 'mine' => 0];
    }
    $id = (int) $row['id'];
    $voter = cfp_voter_key();
    $prevSt = $pdo->prepare('SELECT vote FROM video_votes WHERE video_id = ? AND voter_key = ?');
    $prevSt->execute([$id, $voter]);
    $prev = $prevSt->fetchColumn();
    $prev = $prev === false ? 0 : (int) $prev;

    $likes = (int) $row['likes'];
    $dislikes = (int) $row['dislikes'];
    if ($prev === 1) {
        $likes = max(0, $likes - 1);
    } elseif ($prev === -1) {
        $dislikes = max(0, $dislikes - 1);
    }

    if ($vote === 0) {
        $pdo->prepare('DELETE FROM video_votes WHERE video_id = ? AND voter_key = ?')->execute([$id, $voter]);
    } else {
        $pdo->prepare(
            'INSERT INTO video_votes (video_id, voter_key, vote) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE vote = VALUES(vote)'
        )->execute([$id, $voter, $vote]);
        if ($vote === 1) {
            $likes++;
        } else {
            $dislikes++;
        }
    }
    $pdo->prepare('UPDATE videos SET likes = ?, dislikes = ? WHERE id = ?')->execute([$likes, $dislikes, $id]);
    return ['likes' => $likes, 'dislikes' => $dislikes, 'mine' => $vote];
}

/** @return array{likes:int,dislikes:int,mine:int} */
function cfp_vote_state(PDO $pdo, string $partnerVideoId): array
{
    cfp_ensure_schema($pdo);
    $st = $pdo->prepare('SELECT id, likes, dislikes FROM videos WHERE video_id = ? LIMIT 1');
    $st->execute([$partnerVideoId]);
    $row = $st->fetch();
    if (!$row) {
        return ['likes' => 0, 'dislikes' => 0, 'mine' => 0];
    }
    $mine = 0;
    $voter = (string) ($_COOKIE['cfp_voter'] ?? '');
    if (preg_match('/^[a-f0-9]{32}$/', $voter)) {
        $prev = $pdo->prepare('SELECT vote FROM video_votes WHERE video_id = ? AND voter_key = ?');
        $prev->execute([(int) $row['id'], $voter]);
        $v = $prev->fetchColumn();
        if ($v !== false) {
            $mine = (int) $v;
        }
    }
    return [
        'likes' => (int) $row['likes'],
        'dislikes' => (int) $row['dislikes'],
        'mine' => $mine,
    ];
}

/**
 * Insert or update a video by partner+video_id.
 * @return int video row id
 */
function cfp_upsert_video(PDO $pdo, array $row, array $cats = [], array $tags = [], array $actors = []): int
{
    $partner = (string) ($row['partner'] ?? 'xvideos');
    $videoId = (string) ($row['video_id'] ?? '');
    if ($videoId === '') {
        throw new InvalidArgumentException('missing video_id');
    }
    $title = trim((string) ($row['title'] ?? 'Untitled'));
    $slug = cfp_slug((string) ($row['slug'] ?? $title));
    $duration = (string) ($row['duration'] ?? '');
    $durationSec = (int) ($row['duration_sec'] ?? cfp_duration_sec($duration));

    $st = $pdo->prepare('SELECT id, slug FROM videos WHERE partner = ? AND video_id = ?');
    $st->execute([$partner, $videoId]);
    $existing = $st->fetch();

    if ($existing) {
        $id = (int) $existing['id'];
        $u = $pdo->prepare('UPDATE videos SET title=?, thumb=?, duration=?, duration_sec=?, tracking_url=?, embed=?, updated_at=NOW() WHERE id=?');
        $u->execute([
            $title,
            $row['thumb'] ?? null,
            $duration !== '' ? $duration : null,
            $durationSec,
            $row['tracking_url'] ?? null,
            $row['embed'] ?? null,
            $id,
        ]);
    } else {
        $slug = cfp_ensure_unique_slug($pdo, $slug);
        $ins = $pdo->prepare('INSERT INTO videos (video_id, slug, title, thumb, duration, duration_sec, partner, tracking_url, embed, views, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $created = $row['created_at'] ?? date('Y-m-d H:i:s');
        $ins->execute([
            $videoId,
            $slug,
            $title,
            $row['thumb'] ?? null,
            $duration !== '' ? $duration : null,
            $durationSec,
            $partner,
            $row['tracking_url'] ?? null,
            $row['embed'] ?? null,
            (int) ($row['views'] ?? 0),
            $created,
        ]);
        $id = (int) $pdo->lastInsertId();
    }

    foreach ($cats as $catName) {
        $cid = cfp_upsert_category($pdo, (string) $catName);
        $pdo->prepare('INSERT IGNORE INTO video_categories (video_id, category_id) VALUES (?,?)')->execute([$id, $cid]);
    }
    foreach ($tags as $tagName) {
        $tid = cfp_upsert_tag($pdo, (string) $tagName);
        if ($tid) {
            $pdo->prepare('INSERT IGNORE INTO video_tags (video_id, tag_id) VALUES (?,?)')->execute([$id, $tid]);
        }
    }
    foreach ($actors as $actor) {
        $actorName = '';
        $role = 'model';
        if (is_array($actor)) {
            $actorName = (string) ($actor['name'] ?? '');
            $role = (($actor['role'] ?? '') === 'channel') ? 'channel' : 'model';
            $slugOverride = isset($actor['slug']) ? (string) $actor['slug'] : null;
        } else {
            $actorName = (string) $actor;
            $slugOverride = null;
        }
        $aid = cfp_upsert_actor($pdo, $actorName, $slugOverride);
        if ($aid) {
            $pdo->prepare(
                'INSERT INTO video_actors (video_id, actor_id, role) VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE role = VALUES(role)'
            )->execute([$id, $aid, $role]);
        }
    }

    return $id;
}

/**
 * Normalize list/filter query params from $_GET.
 * @return array{sort:string,duration:string,period:string,density:string,per:int,page:int,category:string,q:string}
 */
function cfp_filters_from_request(array $get = null): array
{
    $get = $get ?? $_GET;
    $sort = (string) ($get['sort'] ?? 'new');
    if (!in_array($sort, ['new', 'views', 'az', 'long', 'short'], true)) {
        $sort = 'new';
    }
    $duration = (string) ($get['duration'] ?? 'any');
    if (!in_array($duration, ['any', 'short', 'medium', 'long'], true)) {
        $duration = 'any';
    }
    $period = (string) ($get['period'] ?? 'any');
    if (!in_array($period, ['any', 'day', 'week', 'month', 'year'], true)) {
        $period = 'any';
    }
    $density = (string) ($get['density'] ?? 'cozy');
    if (!in_array($density, ['cozy', 'compact'], true)) {
        $density = 'cozy';
    }
    $perDefault = $density === 'compact' ? 36 : 24;
    $per = max(12, min(48, (int) ($get['per'] ?? $perDefault)));
    return [
        'sort' => $sort,
        'duration' => $duration,
        'period' => $period,
        'density' => $density,
        'per' => $per,
        'page' => max(1, (int) ($get['page'] ?? 1)),
        'category' => trim((string) ($get['category'] ?? '')),
        'q' => trim((string) ($get['q'] ?? '')),
    ];
}

function cfp_list_videos(PDO $pdo, array $opts = []): array
{
    $page = max(1, (int) ($opts['page'] ?? 1));
    $per = max(1, min(48, (int) ($opts['per'] ?? 24)));
    $offset = ($page - 1) * $per;
    $q = trim((string) ($opts['q'] ?? ''));
    $cat = trim((string) ($opts['category'] ?? ''));
    $sort = (string) ($opts['sort'] ?? 'new');
    $duration = (string) ($opts['duration'] ?? 'any');
    $period = (string) ($opts['period'] ?? 'any');

    $where = ['1=1'];
    $args = [];
    $join = '';

    if ($q !== '') {
        $where[] = 'v.title LIKE ?';
        $args[] = '%' . $q . '%';
    }
    if ($cat !== '') {
        $join .= ' INNER JOIN video_categories vc ON vc.video_id = v.id INNER JOIN categories c ON c.id = vc.category_id ';
        $where[] = 'c.slug = ?';
        $args[] = $cat;
    }

    if ($duration === 'short') {
        $where[] = 'v.duration_sec > 0 AND v.duration_sec < 600';
    } elseif ($duration === 'medium') {
        $where[] = 'v.duration_sec >= 600 AND v.duration_sec < 1200';
    } elseif ($duration === 'long') {
        $where[] = 'v.duration_sec >= 1200';
    }

    $periodMap = [
        'day' => '1 DAY',
        'week' => '7 DAY',
        'month' => '30 DAY',
        'year' => '365 DAY',
    ];
    if (isset($periodMap[$period])) {
        $where[] = 'v.created_at >= (NOW() - INTERVAL ' . $periodMap[$period] . ')';
    }

    $order = match ($sort) {
        'views' => 'v.views DESC, v.created_at DESC',
        'az' => 'v.title ASC',
        'long' => 'v.duration_sec DESC, v.created_at DESC',
        'short' => 'CASE WHEN v.duration_sec = 0 THEN 1 ELSE 0 END ASC, v.duration_sec ASC, v.created_at DESC',
        default => 'v.created_at DESC',
    };

    $sqlWhere = implode(' AND ', $where);
    $countSt = $pdo->prepare("SELECT COUNT(DISTINCT v.id) FROM videos v $join WHERE $sqlWhere");
    $countSt->execute($args);
    $total = (int) $countSt->fetchColumn();

    $listArgs = $args;
    $listArgs[] = $per;
    $listArgs[] = $offset;
    $st = $pdo->prepare("SELECT DISTINCT v.* FROM videos v $join WHERE $sqlWhere ORDER BY $order LIMIT ? OFFSET ?");
    $st->execute($listArgs);
    $rows = $st->fetchAll();

    return [
        'items' => $rows,
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'pages' => max(1, (int) ceil($total / $per)),
    ];
}

function cfp_get_video_by_slug(PDO $pdo, string $slug): ?array
{
    $st = $pdo->prepare('SELECT * FROM videos WHERE slug = ? LIMIT 1');
    $st->execute([$slug]);
    $row = $st->fetch();
    return $row ?: null;
}

function cfp_get_video_by_id(PDO $pdo, int $id): ?array
{
    $st = $pdo->prepare('SELECT * FROM videos WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ?: null;
}

function cfp_bump_views(PDO $pdo, int $id): void
{
    $pdo->prepare('UPDATE videos SET views = views + 1 WHERE id = ?')->execute([$id]);
}

/**
 * Related clips: shared people first, then tags, then categories.
 * Excludes $excludeIds (current + already shown “more from” clips).
 */
function cfp_related(PDO $pdo, int $id, int $limit = 12, array $excludeIds = []): array
{
    $exclude = array_values(array_unique(array_map('intval', array_merge([$id], $excludeIds))));
    $seen = [];
    $out = [];

    $push = static function (array $rows) use (&$out, &$seen, $limit): void {
        foreach ($rows as $row) {
            $vid = (int) $row['id'];
            if (isset($seen[$vid])) {
                continue;
            }
            $seen[$vid] = true;
            $out[] = $row;
            if (count($out) >= $limit) {
                return;
            }
        }
    };

    $excludeSql = implode(',', array_fill(0, count($exclude), '?'));

    $actorIds = $pdo->prepare('SELECT actor_id FROM video_actors WHERE video_id = ?');
    $actorIds->execute([$id]);
    $aids = $actorIds->fetchAll(PDO::FETCH_COLUMN);
    if ($aids && count($out) < $limit) {
        $in = implode(',', array_fill(0, count($aids), '?'));
        $args = array_merge($aids, $exclude);
        $args[] = $limit;
        $q = $pdo->prepare(
            "SELECT v.*, COUNT(*) AS overlap FROM videos v
             INNER JOIN video_actors va ON va.video_id = v.id
             WHERE va.actor_id IN ($in) AND v.id NOT IN ($excludeSql)
             GROUP BY v.id ORDER BY overlap DESC, v.views DESC, v.created_at DESC LIMIT ?"
        );
        $q->execute($args);
        $push($q->fetchAll());
    }

    $tagIds = $pdo->prepare('SELECT tag_id FROM video_tags WHERE video_id = ?');
    $tagIds->execute([$id]);
    $tids = $tagIds->fetchAll(PDO::FETCH_COLUMN);
    if ($tids && count($out) < $limit) {
        $need = $limit - count($out);
        $in = implode(',', array_fill(0, count($tids), '?'));
        $already = array_keys($seen);
        $ex2 = array_values(array_unique(array_merge($exclude, $already)));
        $exSql = implode(',', array_fill(0, count($ex2), '?'));
        $args = array_merge($tids, $ex2);
        $args[] = $need;
        $q = $pdo->prepare(
            "SELECT v.*, COUNT(*) AS overlap FROM videos v
             INNER JOIN video_tags vt ON vt.video_id = v.id
             WHERE vt.tag_id IN ($in) AND v.id NOT IN ($exSql)
             GROUP BY v.id ORDER BY overlap DESC, v.views DESC, v.created_at DESC LIMIT ?"
        );
        $q->execute($args);
        $push($q->fetchAll());
    }

    if (count($out) < $limit) {
        $st = $pdo->prepare('SELECT category_id FROM video_categories WHERE video_id = ?');
        $st->execute([$id]);
        $cats = $st->fetchAll(PDO::FETCH_COLUMN);
        if ($cats) {
            $need = $limit - count($out);
            $in = implode(',', array_fill(0, count($cats), '?'));
            $already = array_keys($seen);
            $ex2 = array_values(array_unique(array_merge($exclude, $already)));
            $exSql = implode(',', array_fill(0, count($ex2), '?'));
            $args = array_merge($cats, $ex2);
            $args[] = $need;
            $q = $pdo->prepare(
                "SELECT v.* FROM videos v
                 INNER JOIN video_categories vc ON vc.video_id = v.id
                 WHERE vc.category_id IN ($in) AND v.id NOT IN ($exSql)
                 GROUP BY v.id ORDER BY v.views DESC, v.created_at DESC LIMIT ?"
            );
            $q->execute($args);
            $push($q->fetchAll());
        }
    }

    if (count($out) < $limit) {
        $need = $limit - count($out);
        $already = array_keys($seen);
        $ex2 = array_values(array_unique(array_merge($exclude, $already)));
        $exSql = implode(',', array_fill(0, count($ex2), '?'));
        $args = $ex2;
        $args[] = $need;
        $q = $pdo->prepare("SELECT * FROM videos WHERE id NOT IN ($exSql) ORDER BY created_at DESC LIMIT ?");
        $q->execute($args);
        $push($q->fetchAll());
    }

    return $out;
}

/**
 * Other videos from each person on this clip (xvideos-style “more from”).
 * @return list<array{person:array{id:int,slug:string,name:string},items:list<array>}>
 */
function cfp_more_from_people(PDO $pdo, int $videoId, int $perPerson = 8): array
{
    // Prefer real people (models) linked to the video — not channels/groups.
    $st = $pdo->prepare(
        'SELECT a.id, a.slug, a.name FROM actors a
         INNER JOIN video_actors va ON va.actor_id = a.id
         WHERE va.video_id = ? AND va.role = \'model\'
         ORDER BY a.name ASC'
    );
    $st->execute([$videoId]);
    $people = $st->fetchAll();
    if (!$people) {
        // Fallback: channel/uploader when no models are attached yet
        $st = $pdo->prepare(
            'SELECT a.id, a.slug, a.name FROM actors a
             INNER JOIN video_actors va ON va.actor_id = a.id
             WHERE va.video_id = ?
             ORDER BY CASE WHEN va.role = \'channel\' THEN 0 ELSE 1 END, a.name ASC'
        );
        $st->execute([$videoId]);
        $people = $st->fetchAll();
    }
    $sections = [];
    foreach ($people as $person) {
        $q = $pdo->prepare(
            'SELECT v.* FROM videos v
             INNER JOIN video_actors va ON va.video_id = v.id
             WHERE va.actor_id = ? AND v.id <> ?
             ORDER BY v.views DESC, v.created_at DESC LIMIT ?'
        );
        $q->execute([(int) $person['id'], $videoId, $perPerson]);
        $items = $q->fetchAll();
        if ($items) {
            $sections[] = [
                'person' => [
                    'id' => (int) $person['id'],
                    'slug' => (string) $person['slug'],
                    'name' => (string) $person['name'],
                ],
                'items' => $items,
            ];
        }
    }
    return $sections;
}

function cfp_top_categories(PDO $pdo, int $limit = 24): array
{
    $st = $pdo->prepare('SELECT c.slug, c.name, COUNT(*) AS n FROM categories c INNER JOIN video_categories vc ON vc.category_id = c.id GROUP BY c.id ORDER BY n DESC LIMIT ?');
    $st->execute([$limit]);
    return $st->fetchAll();
}

/**
 * People (models/pornstars) with video counts — excludes channels/groups.
 * @return array{items:list<array>,total:int,page:int,per:int,pages:int}
 */
function cfp_list_people(PDO $pdo, array $opts = []): array
{
    $page = max(1, (int) ($opts['page'] ?? 1));
    $per = max(12, min(96, (int) ($opts['per'] ?? 48)));
    $offset = ($page - 1) * $per;
    $q = trim((string) ($opts['q'] ?? ''));
    $role = (string) ($opts['role'] ?? 'model');
    if (!in_array($role, ['model', 'channel', 'any'], true)) {
        $role = 'model';
    }
    $where = ['1=1'];
    $args = [];
    if ($role !== 'any') {
        $where[] = 'va.role = ?';
        $args[] = $role;
    }
    if ($q !== '') {
        $where[] = 'a.name LIKE ?';
        $args[] = '%' . $q . '%';
    }
    $sqlWhere = implode(' AND ', $where);

    $countSt = $pdo->prepare(
        "SELECT COUNT(*) FROM (
           SELECT a.id FROM actors a
           INNER JOIN video_actors va ON va.actor_id = a.id
           WHERE $sqlWhere
           GROUP BY a.id
         ) t"
    );
    $countSt->execute($args);
    $total = (int) $countSt->fetchColumn();

    $listArgs = $args;
    $listArgs[] = $per;
    $listArgs[] = $offset;
    $st = $pdo->prepare(
        "SELECT a.id, a.slug, a.name, COUNT(*) AS n,
                (SELECT v.thumb FROM videos v
                 INNER JOIN video_actors va2 ON va2.video_id = v.id
                 WHERE va2.actor_id = a.id AND v.thumb IS NOT NULL AND v.thumb <> ''
                 ORDER BY v.views DESC LIMIT 1) AS thumb
         FROM actors a
         INNER JOIN video_actors va ON va.actor_id = a.id
         WHERE $sqlWhere
         GROUP BY a.id
         ORDER BY n DESC, a.name ASC
         LIMIT ? OFFSET ?"
    );
    $st->execute($listArgs);

    return [
        'items' => $st->fetchAll(),
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'pages' => max(1, (int) ceil($total / max(1, $per))),
    ];
}

function cfp_get_person_by_slug(PDO $pdo, string $slug): ?array
{
    $st = $pdo->prepare(
        "SELECT a.id, a.slug, a.name, COUNT(va.video_id) AS n,
                (SELECT v.thumb FROM videos v
                 INNER JOIN video_actors va2 ON va2.video_id = v.id
                 WHERE va2.actor_id = a.id AND v.thumb IS NOT NULL AND v.thumb <> ''
                 ORDER BY v.views DESC LIMIT 1) AS thumb
         FROM actors a
         LEFT JOIN video_actors va ON va.actor_id = a.id
         WHERE a.slug = ?
         GROUP BY a.id
         LIMIT 1"
    );
    $st->execute([$slug]);
    $row = $st->fetch();
    return $row ?: null;
}

function cfp_videos_by_person(PDO $pdo, int $actorId, array $opts = []): array
{
    $page = max(1, (int) ($opts['page'] ?? 1));
    $per = max(12, min(48, (int) ($opts['per'] ?? 24)));
    $offset = ($page - 1) * $per;
    $sort = (string) ($opts['sort'] ?? 'views');
    $order = match ($sort) {
        'new' => 'v.created_at DESC',
        'az' => 'v.title ASC',
        default => 'v.views DESC, v.created_at DESC',
    };

    $countSt = $pdo->prepare('SELECT COUNT(*) FROM video_actors WHERE actor_id = ?');
    $countSt->execute([$actorId]);
    $total = (int) $countSt->fetchColumn();

    $st = $pdo->prepare(
        "SELECT v.* FROM videos v
         INNER JOIN video_actors va ON va.video_id = v.id
         WHERE va.actor_id = ?
         ORDER BY $order
         LIMIT ? OFFSET ?"
    );
    $st->execute([$actorId, $per, $offset]);

    return [
        'items' => $st->fetchAll(),
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'pages' => max(1, (int) ceil($total / max(1, $per))),
    ];
}

function cfp_get_tag_by_slug(PDO $pdo, string $slug): ?array
{
    $st = $pdo->prepare(
        'SELECT t.id, t.slug, t.name, COUNT(vt.video_id) AS n
         FROM tags t
         LEFT JOIN video_tags vt ON vt.tag_id = t.id
         WHERE t.slug = ?
         GROUP BY t.id
         LIMIT 1'
    );
    $st->execute([$slug]);
    $row = $st->fetch();
    return $row ?: null;
}

function cfp_videos_by_tag(PDO $pdo, int $tagId, array $opts = []): array
{
    $page = max(1, (int) ($opts['page'] ?? 1));
    $per = max(12, min(48, (int) ($opts['per'] ?? 24)));
    $offset = ($page - 1) * $per;
    $sort = (string) ($opts['sort'] ?? 'views');
    $order = match ($sort) {
        'new' => 'v.created_at DESC',
        'az' => 'v.title ASC',
        default => 'v.views DESC, v.created_at DESC',
    };

    $countSt = $pdo->prepare('SELECT COUNT(*) FROM video_tags WHERE tag_id = ?');
    $countSt->execute([$tagId]);
    $total = (int) $countSt->fetchColumn();

    $st = $pdo->prepare(
        "SELECT v.* FROM videos v
         INNER JOIN video_tags vt ON vt.video_id = v.id
         WHERE vt.tag_id = ?
         ORDER BY $order
         LIMIT ? OFFSET ?"
    );
    $st->execute([$tagId, $per, $offset]);

    return [
        'items' => $st->fetchAll(),
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'pages' => max(1, (int) ceil($total / max(1, $per))),
    ];
}

function cfp_video_meta(PDO $pdo, int $id): array
{
    $cats = $pdo->prepare('SELECT c.slug, c.name FROM categories c INNER JOIN video_categories vc ON vc.category_id = c.id WHERE vc.video_id = ?');
    $cats->execute([$id]);
    $tags = $pdo->prepare('SELECT t.slug, t.name FROM tags t INNER JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ? ORDER BY t.name ASC');
    $tags->execute([$id]);
    $actors = $pdo->prepare(
        'SELECT a.id, a.slug, a.name, va.role,
                (SELECT COUNT(*) FROM video_actors va2 WHERE va2.actor_id = a.id) AS n
         FROM actors a
         INNER JOIN video_actors va ON va.actor_id = a.id
         WHERE va.video_id = ?
         ORDER BY CASE WHEN va.role = \'model\' THEN 0 ELSE 1 END, a.name ASC'
    );
    $actors->execute([$id]);
    return [
        'categories' => $cats->fetchAll(),
        'tags' => $tags->fetchAll(),
        'actors' => $actors->fetchAll(),
    ];
}

/** Tags commonly used on a person's videos (xvideos-style profile tags). */
function cfp_person_tags(PDO $pdo, int $actorId, int $limit = 32): array
{
    $limit = max(1, min(60, $limit));
    $st = $pdo->prepare(
        'SELECT t.slug, t.name, COUNT(*) AS n
         FROM tags t
         INNER JOIN video_tags vt ON vt.tag_id = t.id
         INNER JOIN video_actors va ON va.video_id = vt.video_id
         WHERE va.actor_id = ?
         GROUP BY t.id
         ORDER BY n DESC, t.name ASC
         LIMIT ?'
    );
    $st->execute([$actorId, $limit]);
    return $st->fetchAll();
}
