<?php
declare(strict_types=1);

/**
 * One-shot: copy published WP pornx posts into chillflix_porn.videos
 * Usage: php bin/migrate-wp.php
 */

require dirname(__DIR__) . '/lib/bootstrap.php';

$wpHost = getenv('WP_DB_HOST') ?: CFP_DB_HOST;
$wpName = getenv('WP_DB_NAME') ?: 'pornx';
$wpUser = getenv('WP_DB_USER') ?: 'pornx';
$wpPass = getenv('WP_DB_PASS') ?: '';

if ($wpPass === '') {
    fwrite(STDERR, "Set WP_DB_PASS\n");
    exit(1);
}

$wp = new PDO(
    sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $wpHost, $wpName),
    $wpUser,
    $wpPass,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$pdo = cfp_pdo();

echo "Reading WP posts…\n";
$posts = $wp->query("SELECT ID, post_title, post_name, post_date FROM wp_posts WHERE post_type='post' AND post_status='publish' ORDER BY ID ASC")->fetchAll();
echo "Found " . count($posts) . " posts\n";

$metaSt = $wp->prepare("SELECT meta_key, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key IN ('video_id','thumb','duration','partner','tracking_url','embed','post_views_count')");
$termSt = $wp->prepare("SELECT t.name, tt.taxonomy FROM wp_terms t INNER JOIN wp_term_taxonomy tt ON tt.term_id=t.term_id INNER JOIN wp_term_relationships tr ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tr.object_id = ?");

$ok = 0;
$skip = 0;
foreach ($posts as $p) {
    $metaSt->execute([(int) $p['ID']]);
    $meta = [];
    foreach ($metaSt->fetchAll() as $row) {
        $meta[$row['meta_key']] = $row['meta_value'];
    }
    $videoId = (string) ($meta['video_id'] ?? '');
    if ($videoId === '') {
        $skip++;
        continue;
    }
    $termSt->execute([(int) $p['ID']]);
    $cats = [];
    $tags = [];
    $actors = [];
    foreach ($termSt->fetchAll() as $t) {
        $tax = (string) $t['taxonomy'];
        $name = (string) $t['name'];
        if ($tax === 'category') {
            $cats[] = $name;
        } elseif ($tax === 'post_tag') {
            $tags[] = $name;
        } elseif ($tax === 'pornstars') {
            $actors[] = $name;
        }
    }
    cfp_upsert_video($pdo, [
        'partner' => (string) ($meta['partner'] ?? 'xvideos'),
        'video_id' => $videoId,
        'slug' => (string) $p['post_name'],
        'title' => (string) $p['post_title'],
        'thumb' => $meta['thumb'] ?? null,
        'duration' => $meta['duration'] ?? null,
        'tracking_url' => $meta['tracking_url'] ?? null,
        'embed' => $meta['embed'] ?? null,
        'views' => (int) ($meta['post_views_count'] ?? 0),
        'created_at' => (string) $p['post_date'],
    ], $cats, $tags, $actors);
    $ok++;
    if ($ok % 200 === 0) {
        echo "  migrated $ok\n";
    }
}
echo "Done. upserted=$ok skipped=$skip\n";
