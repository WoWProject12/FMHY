<?php
declare(strict_types=1);
/** @var list<array> $items */
?>
<div class="cfp-rail" data-cfp-rail>
  <div class="cfp-rail-track">
    <?php foreach ($items as $item):
      $href = cfp_url('/video/' . $item['slug']);
      $thumb = $item['thumb'] ?: '';
    ?>
      <div class="cfp-rail-card cfp-card" role="link" tabindex="0" data-href="<?= cfp_e($href) ?>" data-video-id="<?= cfp_e((string) ($item['video_id'] ?? '')) ?>">
        <div class="cfp-card-media">
          <?php if ($thumb): ?>
            <img src="<?= cfp_e($thumb) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">
          <?php else: ?>
            <div class="cfp-card-ph" aria-hidden="true"></div>
          <?php endif; ?>
          <?php if (!empty($item['duration'])): ?>
            <span class="cfp-card-dur"><?= cfp_e((string) $item['duration']) ?></span>
          <?php endif; ?>
          <span class="cfp-card-play" aria-hidden="true"></span>
        </div>
        <h3 class="cfp-card-title"><?= cfp_e((string) $item['title']) ?></h3>
      </div>
    <?php endforeach; ?>
  </div>
</div>
