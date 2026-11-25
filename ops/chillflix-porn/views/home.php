<?php
declare(strict_types=1);
/** @var array $latest */
/** @var array $popular */
/** @var array $cats */
/** @var array $filters */
$filters = $filters ?? cfp_filters_from_request();
$density = $filters['density'] ?? 'cozy';
$resultsTotal = (int) ($latest['total'] ?? 0);
$actionPath = '/';
$activeCatName = null;
$activeCatSlug = (string) ($filters['category'] ?? '');
if ($activeCatSlug !== '') {
    foreach ($cats as $c) {
        if ($c['slug'] === $activeCatSlug) {
            $activeCatName = $c['name'];
            break;
        }
    }
}
$isFiltered = $activeCatSlug !== ''
    || ($filters['sort'] ?? 'new') !== 'new'
    || ($filters['duration'] ?? 'any') !== 'any'
    || ($filters['period'] ?? 'any') !== 'any';
$heading = $activeCatName ?: ($isFiltered ? 'Results' : 'Newest videos');
?>
<?php if ($activeCatName): ?>
  <header class="cfp-cat-head">
    <h1 class="cfp-page-title"><?= cfp_e((string) $activeCatName) ?></h1>
    <p class="cfp-cat-sub"><?= number_format($resultsTotal) ?> videos</p>
  </header>
<?php endif; ?>

<?php require __DIR__ . '/_toolbar.php'; ?>

<?php
// xvideos-like: on clean homepage show a short “Best of” strip, then the main Newest grid.
// Hide when browsing a category or applying filters so the page stays focused.
?>
<?php if (!$isFiltered && ($filters['page'] ?? 1) <= 1 && !empty($popular['items'])): ?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h2>Best of the week</h2>
    <a href="<?= cfp_e(cfp_url('/?sort=views&period=week')) ?>">More</a>
  </div>
  <div class="cfp-rail" data-cfp-rail>
    <div class="cfp-rail-track">
      <?php foreach (array_slice($popular['items'], 0, 10) as $item): ?>
        <a class="cfp-rail-card cfp-card" href="<?= cfp_e(cfp_url('/video/' . $item['slug'])) ?>" data-video-id="<?= cfp_e((string) ($item['video_id'] ?? '')) ?>">
          <div class="cfp-card-media">
            <?php if (!empty($item['thumb'])): ?>
              <img src="<?= cfp_e($item['thumb']) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
            <?php else: ?>
              <div class="cfp-card-ph" aria-hidden="true"></div>
            <?php endif; ?>
            <?php if (!empty($item['duration'])): ?>
              <span class="cfp-card-dur"><?= cfp_e((string) $item['duration']) ?></span>
            <?php endif; ?>
            <span class="cfp-card-play" aria-hidden="true"></span>
          </div>
          <h3 class="cfp-card-title"><?= cfp_e((string) $item['title']) ?></h3>
        </a>
      <?php endforeach; ?>
    </div>
  </div>
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
