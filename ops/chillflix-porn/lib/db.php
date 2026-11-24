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

function cfp_upsert_actor(PDO $pdo, string $name): int
{
    $name = trim($name);
    if ($name === '') {
        return 0;
    }
    $slug = cfp_slug($name);
    $st = $pdo->prepare('INSERT INTO actors (slug, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)');
    $st->execute([$slug, $name]);
    $st = $pdo->prepare('SELECT id FROM actors WHERE slug = ?');
    $st->execute([$slug]);
    return (int) $st->fetchColumn();
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
    foreach ($actors as $actorName) {
        $aid = cfp_upsert_actor($pdo, (string) $actorName);
        if ($aid) {
            $pdo->prepare('INSERT IGNORE INTO video_actors (video_id, actor_id) VALUES (?,?)')->execute([$id, $aid]);
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

function cfp_related(PDO $pdo, int $id, int $limit = 12): array
{
    $st = $pdo->prepare('SELECT category_id FROM video_categories WHERE video_id = ?');
    $st->execute([$id]);
    $cats = $st->fetchAll(PDO::FETCH_COLUMN);
    if ($cats) {
        $in = implode(',', array_fill(0, count($cats), '?'));
        $args = $cats;
        $args[] = $id;
        $args[] = $limit;
        $q = $pdo->prepare("SELECT v.* FROM videos v INNER JOIN video_categories vc ON vc.video_id = v.id WHERE vc.category_id IN ($in) AND v.id <> ? GROUP BY v.id ORDER BY v.created_at DESC LIMIT ?");
        $q->execute($args);
        $rows = $q->fetchAll();
        if ($rows) {
            return $rows;
        }
    }
    $q = $pdo->prepare('SELECT * FROM videos WHERE id <> ? ORDER BY created_at DESC LIMIT ?');
    $q->execute([$id, $limit]);
    return $q->fetchAll();
}

function cfp_top_categories(PDO $pdo, int $limit = 24): array
{
    $st = $pdo->prepare('SELECT c.slug, c.name, COUNT(*) AS n FROM categories c INNER JOIN video_categories vc ON vc.category_id = c.id GROUP BY c.id ORDER BY n DESC LIMIT ?');
    $st->execute([$limit]);
    return $st->fetchAll();
}

function cfp_video_meta(PDO $pdo, int $id): array
{
    $cats = $pdo->prepare('SELECT c.slug, c.name FROM categories c INNER JOIN video_categories vc ON vc.category_id = c.id WHERE vc.video_id = ?');
    $cats->execute([$id]);
    $tags = $pdo->prepare('SELECT t.slug, t.name FROM tags t INNER JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ?');
    $tags->execute([$id]);
    $actors = $pdo->prepare('SELECT a.slug, a.name FROM actors a INNER JOIN video_actors va ON va.actor_id = a.id WHERE va.video_id = ?');
    $actors->execute([$id]);
    return [
        'categories' => $cats->fetchAll(),
        'tags' => $tags->fetchAll(),
        'actors' => $actors->fetchAll(),
    ];
}
