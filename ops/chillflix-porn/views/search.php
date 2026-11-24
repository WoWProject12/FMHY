<?php
declare(strict_types=1);
/** @var string $q */
/** @var array $results */
?>
<section class="cfp-section">
  <div class="cfp-section-head">
    <h1><?= $q !== '' ? 'Results for “' . cfp_e($q) . '”' : 'Search' ?></h1>
    <span><?= (int) $results['total'] ?> videos</span>
  </div>
  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">No matches.</p>
  <?php else: ?>
    <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $results; $basePath = '/search'; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
