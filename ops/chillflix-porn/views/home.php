<?php
declare(strict_types=1);
/** @var array $latest */
/** @var array $popular */
/** @var array $cats */
/** @var array $filters */
/** @var list<array> $suggested */
$filters = $filters ?? cfp_filters_from_request();
$density = $filters['density'] ?? 'cozy';
$resultsTotal = (int) ($latest['total'] ?? 0);
$actionPath = '/';
$suggested = $suggested ?? [];
$activeCatSlugs = $filters['categories'] ?? cfp_parse_category_slugs($filters['category'] ?? '');
$activeCatNames = [];
if ($activeCatSlugs) {
    $bySlug = [];
    foreach ($cats as $c) {
        $bySlug[(string) $c['slug']] = (string) $c['name'];
    }
    foreach ($activeCatSlugs as $slug) {
        $activeCatNames[] = $bySlug[$slug] ?? $slug;
    }
}
$activeCatName = $activeCatNames ? implode(', ', $activeCatNames) : null;
$activeCatSlug = $activeCatSlugs ? implode(',', $activeCatSlugs) : '';
$isFiltered = $activeCatSlugs
    || ($filters['sort'] ?? 'new') !== 'new'
    || ($filters['duration'] ?? 'any') !== 'any'
    || ($filters['period'] ?? 'any') !== 'any';
$heading = $activeCatName ?: ($isFiltered ? 'Results' : 'Newest videos');
$showDiscovery = !$isFiltered && ($filters['page'] ?? 1) <= 1;
?>
<?php if ($activeCatName): ?>
  <header class="cfp-cat-head">
    <h1 class="cfp-page-title"><?= cfp_e((string) $activeCatName) ?></h1>
    <p class="cfp-cat-sub"><?= number_format($resultsTotal) ?> videos</p>
  </header>
<?php endif; ?>

<?php
// xvideos-style discovery stack (clean homepage only):
// 1) Suggested for you (history → related niches; cold start → popular)
// 2) Best of the week
// 3) Newest grid
// Continue watching lives in profile/library history.
?>
<?php if ($showDiscovery && $suggested): ?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h2>Suggested for you</h2>
  </div>
  <?php $items = array_slice($suggested, 0, 12); require __DIR__ . '/_rail.php'; ?>
</section>
<?php endif; ?>

<?php if ($showDiscovery && !empty($popular['items'])): ?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h2>Best of the week</h2>
    <a href="<?= cfp_e(cfp_url('/?sort=views&period=week')) ?>">More</a>
  </div>
  <?php $items = array_slice($popular['items'], 0, 10); require __DIR__ . '/_rail.php'; ?>
</section>
<?php endif; ?>

<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h2><?= cfp_e($heading) ?></h2>
  </div>
  <?php if (empty($latest['items'])): ?>
    <p class="cfp-empty">No videos match these filters.</p>
  <?php else: ?>
    <?php $items = $latest['items']; $gridClass = $density === 'compact' ? 'cfp-grid cfp-grid-compact' : 'cfp-grid'; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $latest; $basePath = '/'; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
