<?php
declare(strict_types=1);
/** @var array $cats */
?>
<section class="cfp-section">
  <div class="cfp-section-head"><h1>Categories</h1></div>
  <div class="cfp-chips cfp-chips-wrap">
    <?php foreach ($cats as $c): ?>
      <a class="cfp-chip" href="<?= cfp_e(cfp_url('/category/' . $c['slug'])) ?>"><?= cfp_e($c['name']) ?> <span><?= (int) $c['n'] ?></span></a>
    <?php endforeach; ?>
  </div>
</section>
