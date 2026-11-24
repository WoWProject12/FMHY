<?php
declare(strict_types=1);
/** @var array $cats */
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">Categories</h1>
    <span><?= count($cats) ?></span>
  </div>
  <div class="cfp-cat-grid">
    <?php foreach ($cats as $c): ?>
      <a class="cfp-cat-card" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>">
        <strong><?= cfp_e($c['name']) ?></strong>
        <span><?= (int) $c['n'] ?> videos</span>
      </a>
    <?php endforeach; ?>
  </div>
</section>
