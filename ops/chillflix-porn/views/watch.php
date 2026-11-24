<?php
declare(strict_types=1);
/** @var array $video */
/** @var array $meta */
/** @var array $related */
$vid = (string) $video['video_id'];
?>
<article class="cfp-watch">
  <div class="cfp-player" data-video-id="<?= cfp_e($vid) ?>" data-poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>">
    <div class="cfp-player-stage">
      <video id="cfpPlayer" playsinline controls preload="metadata" poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>"></video>
      <div class="cfp-player-status" id="cfpPlayerStatus">Loading stream…</div>
    </div>
  </div>

  <header class="cfp-watch-head">
    <h1><?= cfp_e((string) $video['title']) ?></h1>
    <p class="cfp-watch-meta">
      <?php if (!empty($video['duration'])): ?><span><?= cfp_e((string) $video['duration']) ?></span><?php endif; ?>
      <span><?= cfp_e(cfp_fmt_views((int) $video['views'])) ?> views</span>
    </p>
    <?php if (!empty($meta['categories']) || !empty($meta['tags'])): ?>
      <div class="cfp-chips">
        <?php foreach ($meta['categories'] as $c): ?>
          <a class="cfp-chip" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>"><?= cfp_e($c['name']) ?></a>
        <?php endforeach; ?>
        <?php foreach ($meta['tags'] as $t): ?>
          <a class="cfp-chip cfp-chip-soft" href="<?= cfp_e(cfp_url('/search?q=' . rawurlencode($t['name']))) ?>"><?= cfp_e($t['name']) ?></a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </header>

  <?php if (!empty($related)): ?>
  <section class="cfp-section">
    <div class="cfp-section-head"><h2>More like this</h2></div>
    <?php $items = $related; require __DIR__ . '/_grid.php'; ?>
  </section>
  <?php endif; ?>
</article>
