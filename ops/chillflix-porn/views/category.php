<?php
declare(strict_types=1);
/** @var array $cat */
/** @var array $results */
?>
<section class="cfp-section">
  <div class="cfp-section-head">
    <h1><?= cfp_e((string) $cat['name']) ?></h1>
    <span><?= (int) $results['total'] ?> videos</span>
  </div>
  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">Nothing in this category yet.</p>
  <?php else: ?>
    <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $results; $basePath = '/category/' . $cat['slug']; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
