<?php
declare(strict_types=1);
/** @var array $latest */
/** @var array $popular */
/** @var array $cats */
/** @var string $sort */
$hero = $latest['items'][0] ?? null;
?>
<section class="cfp-hero">
  <div class="cfp-hero-copy">
    <p class="cfp-kicker">Chillflix · Adult</p>
    <h1>Free adult videos</h1>
    <p class="cfp-lede">Same Chillflix cinema look — our own catalog, xvideos-powered streams.</p>
    <div class="cfp-hero-actions">
      <a class="cfp-btn cfp-btn-primary" href="<?= cfp_e(cfp_url('/categories')) ?>">Browse categories</a>
      <?php if ($hero): ?>
        <a class="cfp-btn cfp-btn-ghost" href="<?= cfp_e(cfp_url('/video/' . $hero['slug'])) ?>">Watch latest</a>
      <?php endif; ?>
    </div>
  </div>
  <?php if ($hero && !empty($hero['thumb'])): ?>
    <a class="cfp-hero-visual" href="<?= cfp_e(cfp_url('/video/' . $hero['slug'])) ?>" aria-label="<?= cfp_e($hero['title']) ?>">
      <img src="<?= cfp_e($hero['thumb']) ?>" alt="" decoding="async" referrerpolicy="no-referrer">
    </a>
  <?php endif; ?>
</section>

<?php if (!empty($cats)): ?>
<section class="cfp-section">
  <div class="cfp-section-head">
    <h2>Categories</h2>
    <a href="<?= cfp_e(cfp_url('/categories')) ?>">See all</a>
  </div>
  <div class="cfp-chips">
    <?php foreach ($cats as $c): ?>
      <a class="cfp-chip" href="<?= cfp_e(cfp_url('/category/' . $c['slug'])) ?>"><?= cfp_e($c['name']) ?> <span><?= (int) $c['n'] ?></span></a>
    <?php endforeach; ?>
  </div>
</section>
<?php endif; ?>

<?php if (!empty($popular['items'])): ?>
<section class="cfp-section">
  <div class="cfp-section-head">
    <h2>Popular</h2>
  </div>
  <?php $items = $popular['items']; require __DIR__ . '/_grid.php'; ?>
</section>
<?php endif; ?>

<section class="cfp-section">
  <div class="cfp-section-head">
    <h2>Latest</h2>
    <div class="cfp-sort">
      <a class="<?= $sort === 'new' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/?sort=new')) ?>">New</a>
      <a class="<?= $sort === 'views' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/?sort=views')) ?>">Views</a>
    </div>
  </div>
  <?php if (empty($latest['items'])): ?>
    <p class="cfp-empty">No videos yet — scraper will fill this shortly.</p>
  <?php else: ?>
    <?php $items = $latest['items']; require __DIR__ . '/_grid.php'; ?>
    <?php $pager = $latest; $basePath = '/'; require __DIR__ . '/_pager.php'; ?>
  <?php endif; ?>
</section>
