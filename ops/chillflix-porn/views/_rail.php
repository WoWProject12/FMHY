<?php
declare(strict_types=1);
/** @var list<array> $items */
?>
<div class="cfp-rail" data-cfp-rail>
  <div class="cfp-rail-track">
    <?php foreach ($items as $item):
      $href = cfp_url('/video/' . $item['slug']);
      $thumb = $item['thumb'] ?: '';
      $quality = cfp_card_quality($item);
      $channel = cfp_card_channel($item);
      $views = cfp_card_views($item);
      $duration = trim((string) ($item['duration'] ?? ''));
      $hasCc = !empty($item['has_cc']);
      $channelHref = $channel !== '' ? cfp_url('/people/' . rawurlencode(cfp_slug($channel))) : '';
    ?>
      <div class="cfp-rail-card cfp-card" role="link" tabindex="0" data-href="<?= cfp_e($href) ?>" data-video-id="<?= cfp_e((string) ($item['video_id'] ?? '')) ?>" data-max-quality="<?= cfp_e($quality) ?>">
        <div class="cfp-card-media">
          <?php if ($thumb): ?>
            <img src="<?= cfp_e($thumb) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">
          <?php else: ?>
            <div class="cfp-card-ph" aria-hidden="true"></div>
          <?php endif; ?>
          <span class="cfp-card-tags<?= ($quality === '' && !$hasCc) ? ' is-empty' : '' ?>" aria-hidden="true">
            <?php if ($hasCc): ?><span class="cfp-card-cc">CC</span><?php endif; ?>
            <span class="cfp-card-quality"<?= $quality === '' ? ' hidden' : '' ?>><?= cfp_e($quality !== '' ? $quality : '') ?></span>
          </span>
        </div>
        <div class="cfp-card-meta">
          <h3 class="cfp-card-title"><?= cfp_e((string) $item['title']) ?></h3>
          <div class="cfp-card-sub">
            <span class="cfp-card-sub-main">
              <?php if ($channel !== ''): ?>
                <?php if ($channelHref !== ''): ?>
                  <a class="cfp-card-channel" href="<?= cfp_e($channelHref) ?>"><?= cfp_e($channel) ?></a>
                <?php else: ?>
                  <span class="cfp-card-channel"><?= cfp_e($channel) ?></span>
                <?php endif; ?>
                <?php if ($views > 0): ?><span class="cfp-card-sep"> - </span><?php endif; ?>
              <?php endif; ?>
              <?php if ($views > 0): ?>
                <span class="cfp-card-views"><?= cfp_e(cfp_fmt_views($views)) ?> Views</span>
              <?php endif; ?>
              <?php if (!empty($item['suggested'])): ?>
                <span class="cfp-card-sep"> - </span><span class="cfp-card-suggested">Suggested</span>
              <?php endif; ?>
            </span>
            <?php if ($duration !== ''): ?>
              <span class="cfp-card-dur"><?= cfp_e($duration) ?></span>
            <?php endif; ?>
          </div>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
