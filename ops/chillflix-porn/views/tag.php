<?php
declare(strict_types=1);
/** @var array $tag */
/** @var array $results */
/** @var array $filters */
$sort = (string) ($filters['sort'] ?? 'views');
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">#<?= cfp_e((string) $tag['name']) ?></h1>
    <span><?= (int) $tag['n'] ?> videos</span>
  </div>

  <div class="cfp-person-sort">
    <a class="<?= $sort !== 'new' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($tag['slug']))) ?>">Popular</a>
    <a class="<?= $sort === 'new' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($tag['slug']) . '?sort=new')) ?>">Newest</a>
  </div>

  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">No videos for this tag.</p>
  <?php else: ?>
    <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
    <?php
      $pager = $results;
      $basePath = '/tag/' . $tag['slug'] . ($sort === 'new' ? '?sort=new' : '');
      require __DIR__ . '/_pager.php';
    ?>
  <?php endif; ?>
</section>
