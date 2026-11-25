<?php
declare(strict_types=1);
/** @var array $video */
/** @var array $meta */
/** @var array $related */
/** @var list<array{person:array,items:list<array>}> $fromPeople */
$vid = (string) $video['video_id'];
$fromPeople = $fromPeople ?? [];
$actors = $meta['actors'] ?? [];
$tags = $meta['tags'] ?? [];
$cats = $meta['categories'] ?? [];
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

    <?php if ($actors): ?>
      <div class="cfp-people-row" aria-label="People">
        <?php foreach ($actors as $a): ?>
          <a class="cfp-person-chip" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($a['slug']))) ?>">
            <span class="cfp-person-chip-mark"><?= cfp_e(strtoupper(substr((string) $a['name'], 0, 1))) ?></span>
            <span class="cfp-person-chip-text">
              <strong><?= cfp_e((string) $a['name']) ?></strong>
              <?php if (!empty($a['n'])): ?><em><?= (int) $a['n'] ?> videos</em><?php endif; ?>
            </span>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($cats || $tags): ?>
      <div class="cfp-chips">
        <?php foreach ($cats as $c): ?>
          <a class="cfp-chip" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>"><?= cfp_e($c['name']) ?></a>
        <?php endforeach; ?>
        <?php foreach ($tags as $t): ?>
          <a class="cfp-chip cfp-chip-soft" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($t['slug']))) ?>"><?= cfp_e($t['name']) ?></a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </header>

  <?php foreach ($fromPeople as $sec): ?>
  <section class="cfp-section">
    <div class="cfp-section-head">
      <h2>More from <a href="<?= cfp_e(cfp_url('/people/' . rawurlencode($sec['person']['slug']))) ?>"><?= cfp_e($sec['person']['name']) ?></a></h2>
      <a class="cfp-section-more" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($sec['person']['slug']))) ?>">See all</a>
    </div>
    <?php $items = $sec['items']; require __DIR__ . '/_grid.php'; ?>
  </section>
  <?php endforeach; ?>

  <?php if (!empty($related)): ?>
  <section class="cfp-section">
    <div class="cfp-section-head"><h2>Similar videos</h2></div>
    <?php $items = $related; require __DIR__ . '/_grid.php'; ?>
  </section>
  <?php endif; ?>
</article>
