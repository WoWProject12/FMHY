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

// Unique people; channels first (xvideos-style header chips)
$peopleUnique = [];
foreach ($actors as $a) {
    $key = (string) ($a['slug'] ?? $a['name'] ?? '');
    if ($key === '' || isset($peopleUnique[$key])) {
        continue;
    }
    $peopleUnique[$key] = $a;
}
$peopleUnique = array_values($peopleUnique);
$channels = [];
$models = [];
foreach ($peopleUnique as $a) {
    if (($a['role'] ?? '') === 'channel') {
        $channels[] = $a;
    } else {
        $models[] = $a;
    }
}
$tagList = array_values($tags);
$tagPrimary = array_slice($tagList, 0, 8);
$tagExtra = array_slice($tagList, 8);
$durationLabel = trim((string) ($video['duration'] ?? ''));
?>
<article class="cfp-watch">
  <header class="cfp-watch-head">
    <h1 class="cfp-watch-title">
      <span class="cfp-watch-title-text"><?= cfp_e((string) $video['title']) ?></span>
      <?php if ($durationLabel !== ''): ?>
        <span class="cfp-badge cfp-badge-dur"><?= cfp_e($durationLabel) ?></span>
      <?php endif; ?>
      <span class="cfp-badge cfp-badge-q" id="cfpTitleQuality" hidden></span>
    </h1>

    <?php if ($channels || $models): ?>
      <div class="cfp-xv-people" aria-label="People">
        <?php foreach ($channels as $a): ?>
          <a class="cfp-xv-chip cfp-xv-chip-channel" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($a['slug']))) ?>">
            <span class="cfp-xv-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h16V8H4zm6 1.5 5 2.5-5 2.5v-5z"/></svg>
            </span>
            <span class="cfp-xv-name"><?= cfp_e((string) $a['name']) ?></span>
            <?php if (!empty($a['n'])): ?>
              <span class="cfp-xv-count"><?= cfp_e(cfp_fmt_views((int) $a['n'])) ?></span>
            <?php endif; ?>
          </a>
        <?php endforeach; ?>
        <?php foreach ($models as $a): ?>
          <a class="cfp-xv-chip cfp-xv-chip-model" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($a['slug']))) ?>">
            <span class="cfp-xv-ico" aria-hidden="true">★</span>
            <span class="cfp-xv-name"><?= cfp_e((string) $a['name']) ?></span>
            <?php if (!empty($a['n'])): ?>
              <span class="cfp-xv-count"><?= cfp_e(cfp_fmt_views((int) $a['n'])) ?></span>
            <?php endif; ?>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($tagPrimary || $cats): ?>
      <div class="cfp-chips cfp-chips-watch" aria-label="Tags">
        <?php foreach ($cats as $c): ?>
          <a class="cfp-chip" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>"><?= cfp_e($c['name']) ?></a>
        <?php endforeach; ?>
        <?php foreach ($tagPrimary as $t): ?>
          <a class="cfp-chip cfp-chip-soft" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($t['slug']))) ?>"><?= cfp_e($t['name']) ?></a>
        <?php endforeach; ?>
        <?php if ($tagExtra): ?>
          <details class="cfp-tags-more">
            <summary>+<?= count($tagExtra) ?> more</summary>
            <div class="cfp-chips">
              <?php foreach ($tagExtra as $t): ?>
                <a class="cfp-chip cfp-chip-soft" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($t['slug']))) ?>"><?= cfp_e($t['name']) ?></a>
              <?php endforeach; ?>
            </div>
          </details>
        <?php endif; ?>
      </div>
    <?php endif; ?>
  </header>

  <div class="cfp-player" data-video-id="<?= cfp_e($vid) ?>" data-poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>">
    <div class="cfp-player-stage">
      <video id="cfpPlayer" playsinline controls preload="metadata" poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>"></video>
      <div class="cfp-player-status" id="cfpPlayerStatus">Loading stream…</div>
    </div>
    <div class="cfp-quality" id="cfpQuality" hidden>
      <span class="cfp-quality-label">Quality</span>
      <div class="cfp-quality-opts" role="group" aria-label="Video quality"></div>
    </div>
  </div>

  <?php
    $vote = cfp_vote_state(cfp_pdo(), $vid);
    $likePct = (($vote['likes'] + $vote['dislikes']) > 0)
      ? (int) round(100 * $vote['likes'] / max(1, $vote['likes'] + $vote['dislikes']))
      : null;
  ?>
  <div class="cfp-actions" data-cfp-actions data-video-id="<?= cfp_e($vid) ?>" data-mine="<?= (int) $vote['mine'] ?>" data-likes="<?= (int) $vote['likes'] ?>" data-dislikes="<?= (int) $vote['dislikes'] ?>">
    <span class="cfp-action cfp-action-stat" title="Views">
      <span class="cfp-action-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg></span>
      <strong data-cfp-views><?= cfp_e(cfp_fmt_views((int) $video['views'])) ?></strong>
      <em>views</em>
    </span>
    <button type="button" class="cfp-action<?= $vote['mine'] === 1 ? ' is-on' : '' ?>" data-cfp-vote="1" aria-label="Like" aria-pressed="<?= $vote['mine'] === 1 ? 'true' : 'false' ?>">
      <span class="cfp-action-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.3l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg></span>
      <strong data-cfp-likes><?= cfp_e(cfp_fmt_views((int) $vote['likes'])) ?></strong>
      <?php if ($likePct !== null): ?><em data-cfp-like-pct><?= $likePct ?>%</em><?php endif; ?>
    </button>
    <button type="button" class="cfp-action<?= $vote['mine'] === -1 ? ' is-on' : '' ?>" data-cfp-vote="-1" aria-label="Dislike" aria-pressed="<?= $vote['mine'] === -1 ? 'true' : 'false' ?>">
      <span class="cfp-action-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg></span>
      <strong data-cfp-dislikes><?= cfp_e(cfp_fmt_views((int) $vote['dislikes'])) ?></strong>
    </button>
    <button type="button" class="cfp-action" data-cfp-share aria-label="Share">
      <span class="cfp-action-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18 16.1c-.8 0-1.4.3-2 .8l-7.1-4.1c.1-.3.1-.6.1-.8s0-.5-.1-.8L16 7.2c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.8L8 10.9c-.6-.5-1.3-.9-2.1-.9-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2.1-.9l7.1 4.2c-.1.3-.1.5-.1.8 0 1.7 1.3 3 3 3s3-1.3 3-3-1.3-3-3-3z"/></svg></span>
      <strong>Share</strong>
    </button>
  </div>

  <?php foreach ($fromPeople as $sec): ?>
  <section class="cfp-section">
    <div class="cfp-section-head">
      <h2>More from <a href="<?= cfp_e(cfp_url('/people/' . rawurlencode($sec['person']['slug']))) ?>"><?= cfp_e($sec['person']['name']) ?></a></h2>
      <a class="cfp-section-more" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($sec['person']['slug']))) ?>">See all</a>
    </div>
    <?php $items = $sec['items']; require __DIR__ . '/_rail.php'; ?>
  </section>
  <?php endforeach; ?>

  <?php if (!empty($related)): ?>
  <section class="cfp-section">
    <div class="cfp-section-head"><h2>Similar videos</h2></div>
    <?php $items = $related; require __DIR__ . '/_rail.php'; ?>
  </section>
  <?php endif; ?>
</article>
