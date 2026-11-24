<?php
declare(strict_types=1);
/** @var array $latest */
/** @var array $popular */
/** @var array $cats */
/** @var array $filters */
$filters = $filters ?? cfp_filters_from_request();
$hero = $latest['items'][0] ?? ($popular['items'][0] ?? null);
$density = $filters['density'] ?? 'cozy';
$resultsTotal = (int) ($latest['total'] ?? 0);
$actionPath = '/';
$activeCatName = null;
if (!empty($filters['category'])) {
    foreach ($cats as $c) {
        if ($c['slug'] === $filters['category']) {
            $activeCatName = $c['name'];
            break;
        }
    }
}
?>
<?php if ($hero && empty($filters['category']) && ($filters['page'] ?? 1) <= 1 && ($filters['q'] ?? '') === ''): ?>
<section class="cfp-strip" aria-label="Featured">
  <a class="cfp-strip-media" href="<?= cfp_e(cfp_url('/video/' . $hero['slug'])) ?>">
    <?php if (!empty($hero['thumb'])): ?>
      <img src="<?= cfp_e($hero['thumb']) ?>" alt="" decoding="async" referrerpolicy="no-referrer">
    <?php endif; ?>
  </a>
  <div class="cfp-strip-copy">
    <p class="cfp-kicker">Just in</p>
    <h1 class="cfp-strip-title"><?= cfp_e((string) $hero['title']) ?></h1>
    <p class="cfp-strip-meta">
      <?php if (!empty($hero['duration'])): ?><span><?= cfp_e((string) $hero['duration']) ?></span><?php endif; ?>
      <span><?= cfp_e(cfp_fmt_views((int) ($hero['views'] ?? 0))) ?> views</span>
    </p>
    <a class="cfp-btn cfp-btn-primary cfp-btn-sm" href="<?= cfp_e(cfp_url('/video/' . $hero['slug'])) ?>">Play</a>
  </div>
</section>
<?php endif; ?>

<?php require __DIR__ . '/_toolbar.php'; ?>

<?php if (!empty($popular['items']) && empty($filters['category']) && ($filters['sort'] ?? 'new') === 'new' && ($filters['page'] ?? 1) <= 1): ?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h2>Trending</h2>
  </div>
  <div class="cfp-rail" data-cfp-rail>
    <div class="cfp-rail-track">
      <?php foreach ($popular['items'] as $item):
        $href = cfp_url('/video/' . $item['slug']);
      ?>
        <a class="cfp-rail-card" href="<?= cfp_e($href) ?>">
          <div class="cfp-card-media">
            <?php if (!empty($item['thumb'])): ?>
              <img src="<?= cfp_e($item['thumb']) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
            <?php else: ?>
              <div class="cfp-card-ph" aria-hidden="true"></div>
            <?php endif; ?>
            <?php if (!empty($item['duration'])): ?>
              <span class="cfp-card-dur"><?= cfp_e((string) $item['duration']) ?></span>
            <?php endif; ?>
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
    <h2><?= !empty($filters['category']) ? cfp_e((string) ($activeCatName ?: 'Filtered')) : 'Library' ?></h2>
  </div>
  <?php if (empty($latest['items'])): ?>
    <p class="cfp-empty">No videos match these filters.</p>
  <?php else: ?>
    <?php $items = $latest['items']; $gridClass = $density === 'compact' ? 'cfp-grid cfp-grid-compact' : 'cfp-grid'; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $latest; $basePath = '/'; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
