<?php
declare(strict_types=1);
/** @var list<array> $items */
/** @var string|null $gridClass */
$gridClass = $gridClass ?? 'cfp-grid';
?>
<div class="<?= cfp_e($gridClass) ?>">
<?php foreach ($items as $item):
  $href = cfp_url('/video/' . $item['slug']);
  $thumb = $item['thumb'] ?: '';
?>
  <a class="cfp-card" href="<?= cfp_e($href) ?>">
    <div class="cfp-card-media">
      <?php if ($thumb): ?>
        <img src="<?= cfp_e($thumb) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <?php else: ?>
        <div class="cfp-card-ph" aria-hidden="true"></div>
      <?php endif; ?>
      <?php if (!empty($item['duration'])): ?>
        <span class="cfp-card-dur"><?= cfp_e((string) $item['duration']) ?></span>
      <?php endif; ?>
      <span class="cfp-card-play" aria-hidden="true"></span>
    </div>
    <div class="cfp-card-meta">
      <h3 class="cfp-card-title"><?= cfp_e((string) $item['title']) ?></h3>
      <p class="cfp-card-sub"><?= cfp_e(cfp_fmt_views((int) ($item['views'] ?? 0))) ?> views</p>
    </div>
  </a>
<?php endforeach; ?>
</div>
