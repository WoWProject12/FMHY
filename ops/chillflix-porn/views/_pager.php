<?php
declare(strict_types=1);
/** @var array{page:int,pages:int} $pager */
/** @var string $basePath */
$query = $_GET;
unset($query['page']);
$mk = static function (int $p) use ($basePath, $query): string {
    $query['page'] = $p;
    $qs = http_build_query($query);
    return cfp_url($basePath) . ($qs !== '' ? '?' . $qs : '');
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
