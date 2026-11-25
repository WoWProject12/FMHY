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
$primaryChannel = $channels[0] ?? null;
$tagList = array_values($tags);
$chipAll = [];
foreach ($cats as $c) {
    $chipAll[] = ['kind' => 'cat', 'slug' => (string) ($c['slug'] ?? ''), 'name' => (string) ($c['name'] ?? '')];
}
foreach ($tagList as $t) {
    $chipAll[] = ['kind' => 'tag', 'slug' => (string) ($t['slug'] ?? ''), 'name' => (string) ($t['name'] ?? '')];
}
$chipPrimary = array_slice($chipAll, 0, 3);
$chipExtra = array_slice($chipAll, 3);
$durationLabel = trim((string) ($video['duration'] ?? ''));
$vote = cfp_vote_state(cfp_pdo(), $vid);
$likesN = (int) $vote['likes'];
$dislikesN = (int) $vote['dislikes'];
$voteTotal = max(1, $likesN + $dislikesN);
$likePct = (int) round(($likesN / $voteTotal) * 100);
$dislikePct = max(0, 100 - $likePct);
$viewsLabel = cfp_fmt_views((int) ($video['source_views'] ?? $video['views'] ?? 0));
?>
<article class="cfp-watch">
  <header class="cfp-watch-head cfp-watch-head-above">
    <h1 class="cfp-watch-title">
      <span class="cfp-watch-title-text"><?= cfp_e((string) $video['title']) ?></span>
    </h1>
    <p class="cfp-watch-badges">
      <?php if ($durationLabel !== ''): ?>
        <span class="cfp-badge cfp-badge-dur"><?= cfp_e($durationLabel) ?></span>
      <?php endif; ?>
      <span class="cfp-badge cfp-badge-q" id="cfpTitleQuality" hidden></span>
    </p>
    <?php if ($models || $channels): ?>
      <div class="cfp-xv-people cfp-xv-people-top" aria-label="People">
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
            <span class="cfp-xv-name"><?= cfp_e((string) $a['name']) ?></span>
            <?php if (!empty($a['n'])): ?>
              <span class="cfp-xv-count"><?= cfp_e(cfp_fmt_views((int) $a['n'])) ?></span>
            <?php endif; ?>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </header>

  <div class="cfp-player" data-video-id="<?= cfp_e($vid) ?>" data-poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>">
    <div class="cfp-player-stage is-chrome is-paused">
      <video id="cfpPlayer" playsinline preload="metadata" poster="<?= cfp_e((string) ($video['thumb'] ?? '')) ?>"></video>
      <div class="cfp-player-status" id="cfpPlayerStatus">Loading stream…</div>

      <button type="button" class="cfp-player-bigplay" id="cfpBigPlay" aria-label="Play">
        <span class="cfp-player-bigplay-box" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
        </span>
      </button>

      <div class="cfp-player-top">
        <div class="cfp-player-gear">
          <button type="button" class="cfp-overlay-btn" id="cfpGearBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.58.23-1.12.54-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.4 1.04.72 1.62.94l.36 2.54c.05.24.25.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.58-.23 1.12-.54 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>
          </button>
          <div class="cfp-qdrop" id="cfpQualityMenu" hidden role="menu" aria-label="Quality">
            <div class="cfp-qdrop-head">
              <strong>Quality</strong>
              <span id="cfpGearLabel"></span>
            </div>
            <div class="cfp-quality-opts" id="cfpQuality" role="group"></div>
          </div>
        </div>
        <button type="button" class="cfp-overlay-btn" id="cfpCamBtn" aria-label="Screenshot">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9z"/></svg>
        </button>
      </div>

      <div class="cfp-player-chrome" id="cfpPlayerChrome">
        <div class="cfp-player-bar">
          <button type="button" class="cfp-ctrl-btn" id="cfpMuteBtn" aria-label="Mute">
            <svg class="cfp-ico-vol" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            <svg class="cfp-ico-mute" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" hidden><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v4h4l5 4v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
          </button>
          <span class="cfp-player-time" id="cfpPlayerTime">00:00 / <?= cfp_e($durationLabel !== '' ? $durationLabel : '00:00') ?></span>
          <div class="cfp-seek" id="cfpSeek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
            <div class="cfp-seek-track">
              <div class="cfp-seek-fill" id="cfpSeekFill"></div>
              <div class="cfp-seek-knob" id="cfpSeekKnob"></div>
            </div>
          </div>
          <button type="button" class="cfp-ctrl-btn" id="cfpFsBtn" aria-label="Fullscreen">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <header class="cfp-watch-head cfp-watch-head-below">

    <div
      class="cfp-xv-actions"
      data-cfp-actions
      data-video-id="<?= cfp_e($vid) ?>"
      data-mine="<?= (int) $vote['mine'] ?>"
      data-likes="<?= $likesN ?>"
      data-dislikes="<?= $dislikesN ?>"
    >
      <div class="cfp-xv-stats">
        <span class="cfp-xv-views" title="Views">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
          <strong data-cfp-views><?= cfp_e($viewsLabel) ?></strong>
        </span>
        <div class="cfp-xv-votes" role="group" aria-label="Like or dislike">
          <button type="button" class="cfp-xv-vote cfp-xv-like<?= $vote['mine'] === 1 ? ' is-on' : '' ?>" data-cfp-vote="1" aria-label="Like" aria-pressed="<?= $vote['mine'] === 1 ? 'true' : 'false' ?>">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/></svg>
            <span data-cfp-like-pct><?= (int) $likePct ?>%</span>
            <span class="cfp-sr-only" data-cfp-likes><?= cfp_e(cfp_fmt_views($likesN)) ?></span>
          </button>
          <button type="button" class="cfp-xv-vote cfp-xv-dislike<?= $vote['mine'] === -1 ? ' is-on' : '' ?>" data-cfp-vote="-1" aria-label="Dislike" aria-pressed="<?= $vote['mine'] === -1 ? 'true' : 'false' ?>">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
            <span data-cfp-dislike-pct><?= (int) $dislikePct ?>%</span>
            <span class="cfp-sr-only" data-cfp-dislikes><?= cfp_e(cfp_fmt_views($dislikesN)) ?></span>
          </button>
          <div class="cfp-xv-ratio" aria-hidden="true">
            <i data-cfp-ratio style="width:<?= (int) $likePct ?>%"></i>
          </div>
        </div>
      </div>

      <div class="cfp-xv-tools" role="toolbar" aria-label="Video actions">
        <button type="button" class="cfp-xv-tool" disabled title="Comments coming soon">
          <span class="cfp-xv-tool-ico">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
            <em class="cfp-xv-badge">0</em>
          </span>
          <span>Comments</span>
        </button>
        <a class="cfp-xv-tool cfp-yt-download" id="cfpDownload" href="#" download hidden>
          <span class="cfp-xv-tool-ico">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>
          </span>
          <span>Download</span>
        </a>
        <button type="button" class="cfp-xv-tool" data-cfp-save aria-label="Save" aria-pressed="false">
          <span class="cfp-xv-tool-ico">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
          </span>
          <span data-cfp-save-label>Save</span>
        </button>
        <button type="button" class="cfp-xv-tool" data-cfp-share aria-label="Share">
          <span class="cfp-xv-tool-ico">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
          </span>
          <span>Share</span>
        </button>
        <button type="button" class="cfp-xv-tool" data-cfp-report aria-label="Report">
          <span class="cfp-xv-tool-ico">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2 1 21h22L12 2zm0 4.5 7.2 12.5H4.8L12 6.5zM11 10v5h2v-5h-2zm0 6v2h2v-2h-2z"/></svg>
          </span>
          <span>Report</span>
        </button>
      </div>
    </div>

    <?php if ($chipPrimary || $chipExtra): ?>
      <div class="cfp-chips cfp-chips-watch" aria-label="Tags">
        <?php foreach ($chipPrimary as $i => $chip): ?>
          <?php if ($chip['kind'] === 'cat'): ?>
            <a class="cfp-chip<?= $i === 0 ? ' cfp-chip-hot' : '' ?>" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($chip['slug']))) ?>"><?= cfp_e($chip['name']) ?></a>
          <?php else: ?>
            <a class="cfp-chip cfp-chip-soft<?= $i === 0 ? ' cfp-chip-hot' : '' ?>" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($chip['slug']))) ?>"><?= cfp_e($chip['name']) ?></a>
          <?php endif; ?>
        <?php endforeach; ?>
        <?php if ($chipExtra): ?>
          <details class="cfp-tags-more">
            <summary>+<?= count($chipExtra) ?> more</summary>
            <div class="cfp-chips">
              <?php foreach ($chipExtra as $chip): ?>
                <?php if ($chip['kind'] === 'cat'): ?>
                  <a class="cfp-chip" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($chip['slug']))) ?>"><?= cfp_e($chip['name']) ?></a>
                <?php else: ?>
                  <a class="cfp-chip cfp-chip-soft" href="<?= cfp_e(cfp_url('/tag/' . rawurlencode($chip['slug']))) ?>"><?= cfp_e($chip['name']) ?></a>
                <?php endif; ?>
              <?php endforeach; ?>
            </div>
          </details>
        <?php endif; ?>
      </div>
    <?php endif; ?>
  </header>

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
    <div class="cfp-section-head"><h2>Related videos</h2></div>
    <?php $items = $related; require __DIR__ . '/_rail.php'; ?>
  </section>
  <?php endif; ?>
</article>
