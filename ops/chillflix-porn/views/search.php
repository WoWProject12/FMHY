<?php
declare(strict_types=1);
/** @var string $q */
/** @var array $results */
/** @var array $cats */
/** @var array $filters */
$filters = $filters ?? cfp_filters_from_request();
$filters['q'] = $q ?? ($filters['q'] ?? '');
$resultsTotal = (int) ($results['total'] ?? 0);
$actionPath = '/search';
$activeCatName = null;
$density = $filters['density'] ?? 'cozy';
$showCatQuick = false;
if (!empty($filters['category'])) {
    foreach ($cats as $c) {
        if ($c['slug'] === $filters['category']) {
            $activeCatName = $c['name'];
            break;
        }
    }
}
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title"><?= $q !== '' ? '“' . cfp_e($q) . '”' : 'Search' ?></h1>
  </div>
  <?php require __DIR__ . '/_toolbar.php'; ?>
  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">No matches.</p>
  <?php else: ?>
    <?php $items = $results['items']; $gridClass = $density === 'compact' ? 'cfp-grid cfp-grid-compact' : 'cfp-grid'; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $results; $basePath = '/search'; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
