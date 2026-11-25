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
      <div class="cfp-player-gear" id="cfpQuality">
        <button type="button" class="cfp-gear-btn" id="cfpGearBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Quality settings" hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.58.23-1.12.54-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.4 1.04.72 1.62.94l.36 2.54c.05.24.25.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.58-.23 1.12-.54 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>
          <span class="cfp-gear-label" id="cfpGearLabel"></span>
        </button>
        <div class="cfp-qmenu" id="cfpQualityMenu" hidden role="menu" aria-label="Quality">
          <div class="cfp-qmenu-head">Quality</div>
          <div class="cfp-quality-opts" role="group"></div>
        </div>
      </div>
    </div>
  </div>

  <?php
    $vote = cfp_vote_state(cfp_pdo(), $vid);
  ?>
  <div class="cfp-yt" data-cfp-actions data-video-id="<?= cfp_e($vid) ?>" data-mine="<?= (int) $vote['mine'] ?>" data-likes="<?= (int) $vote['likes'] ?>" data-dislikes="<?= (int) $vote['dislikes'] ?>">
    <p class="cfp-yt-views"><strong data-cfp-views><?= cfp_e(cfp_fmt_views((int) $video['views'])) ?></strong> views</p>
    <div class="cfp-yt-row" role="toolbar" aria-label="Video actions">
      <div class="cfp-yt-seg" role="group" aria-label="Like or dislike">
        <button type="button" class="cfp-yt-btn cfp-yt-like<?= $vote['mine'] === 1 ? ' is-on' : '' ?>" data-cfp-vote="1" aria-label="Like" aria-pressed="<?= $vote['mine'] === 1 ? 'true' : 'false' ?>">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/></svg>
          <span data-cfp-likes><?= cfp_e(cfp_fmt_views((int) $vote['likes'])) ?></span>
        </button>
        <button type="button" class="cfp-yt-btn cfp-yt-dislike<?= $vote['mine'] === -1 ? ' is-on' : '' ?>" data-cfp-vote="-1" aria-label="Dislike" aria-pressed="<?= $vote['mine'] === -1 ? 'true' : 'false' ?>">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
          <span data-cfp-dislikes class="cfp-sr-only"><?= cfp_e(cfp_fmt_views((int) $vote['dislikes'])) ?></span>
        </button>
      </div>
      <button type="button" class="cfp-yt-pill" data-cfp-share aria-label="Share">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1L15 9.86V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-9-8-9z"/></svg>
        <span>Share</span>
      </button>
    </div>
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
