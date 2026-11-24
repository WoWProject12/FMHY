<?php
declare(strict_types=1);
/** @var array{page:int,pages:int} $pager */
/** @var string $basePath */
$query = $_GET;
unset($query['page']);
// Drop empty filter defaults so pager URLs stay clean
foreach (['category' => '', 'sort' => 'new', 'duration' => 'any', 'period' => 'any', 'density' => 'cozy'] as $k => $default) {
    if (!isset($query[$k]) || (string) $query[$k] === (string) $default) {
        unset($query[$k]);
    }
}
$mk = static function (int $p) use ($basePath, $query): string {
    $q = $query;
    if ($p > 1) {
        $q['page'] = $p;
    }
    $qs = http_build_query($q);
    $url = cfp_url($basePath);
    return $qs !== '' ? ($url . (str_contains($url, '?') ? '&' : '?') . $qs) : $url;
};
if (($pager['pages'] ?? 1) <= 1) {
    return;
}
$page = (int) $pager['page'];
$pages = (int) $pager['pages'];
?>
<nav class="cfp-pager" aria-label="Pagination">
  <?php if ($page > 1): ?>
    <a href="<?= cfp_e($mk($page - 1)) ?>">Prev</a>
  <?php endif; ?>
  <span>Page <?= (int) $page ?> / <?= (int) $pages ?></span>
  <?php if ($page < $pages): ?>
    <a href="<?= cfp_e($mk($page + 1)) ?>">Next</a>
  <?php endif; ?>
</nav>
