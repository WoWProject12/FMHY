<?php
declare(strict_types=1);
/** @var array $stats */
/** @var array $settings */
/** @var array $scrapeState */
/** @var array $presets */
/** @var string|null $flash */
/** @var string|null $flashErr */
$stats = $stats ?? [];
$settings = $settings ?? cfp_scraper_settings(cfp_pdo());
$scrapeState = $scrapeState ?? [];
$presets = $presets ?? cfp_scraper_presets();
$flash = $flash ?? null;
$flashErr = $flashErr ?? null;
$speed = (string) ($settings['speed'] ?? 'fast');
?>
<section class="cfp-admin">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">Admin</h1>
    <a class="cfp-chip" href="<?= cfp_e(cfp_url('/admin/logout')) ?>">Log out</a>
  </div>

  <?php if ($flash): ?>
    <p class="cfp-admin-flash"><?= cfp_e($flash) ?></p>
  <?php endif; ?>
  <?php if ($flashErr): ?>
    <p class="cfp-admin-flash is-err"><?= cfp_e($flashErr) ?></p>
  <?php endif; ?>

  <div class="cfp-admin-grid">
    <article class="cfp-admin-card">
      <h2>Site stats</h2>
      <dl class="cfp-admin-stats">
        <div><dt>Videos</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['videos'] ?? 0))) ?></dd></div>
        <div><dt>Views</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['views'] ?? 0))) ?></dd></div>
        <div><dt>Likes</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['likes'] ?? 0))) ?></dd></div>
        <div><dt>People</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['people'] ?? 0))) ?></dd></div>
        <div><dt>Channels</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['channels'] ?? 0))) ?></dd></div>
        <div><dt>Tags</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['tags'] ?? 0))) ?></dd></div>
        <div><dt>Categories</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['categories'] ?? 0))) ?></dd></div>
        <div><dt>Enriched</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['enriched'] ?? 0))) ?></dd></div>
        <div><dt>Pending enrich</dt><dd><?= cfp_e(cfp_fmt_views((int) ($stats['pending_enrich'] ?? 0))) ?></dd></div>
      </dl>
    </article>

    <article class="cfp-admin-card">
      <h2>Scraper status</h2>
      <dl class="cfp-admin-stats">
        <div><dt>Speed</dt><dd><?= cfp_e((string) ($settings['speed'] ?? 'fast')) ?></dd></div>
        <div><dt>Niches / run</dt><dd><?= (int) ($settings['niches_per_run'] ?? 0) ?></dd></div>
        <div><dt>Videos / niche</dt><dd><?= (int) ($settings['limit_per_niche'] ?? 0) ?></dd></div>
        <div><dt>Enrich / run</dt><dd><?= (int) ($settings['enrich_per_run'] ?? 0) ?></dd></div>
        <div><dt>Max page</dt><dd><?= (int) ($settings['max_page'] ?? 0) ?></dd></div>
        <div><dt>Last run</dt><dd><?= cfp_e((string) ($scrapeState['last_run_at'] ?? '—')) ?></dd></div>
        <div><dt>Last imported</dt><dd><?= (int) ($scrapeState['last_imported'] ?? 0) ?></dd></div>
        <div><dt>Last enriched</dt><dd><?= (int) ($scrapeState['last_enriched'] ?? 0) ?></dd></div>
        <div><dt>Last duration</dt><dd><?= cfp_e((string) ($scrapeState['last_duration_sec'] ?? '—')) ?>s</dd></div>
        <div><dt>Cursor</dt><dd>offset <?= (int) ($scrapeState['offset'] ?? 0) ?> · page <?= (int) ($scrapeState['page'] ?? 0) ?></dd></div>
      </dl>
      <div class="cfp-admin-actions">
        <a class="cfp-btn" href="<?= cfp_e(cfp_url('/admin/scraper/run')) ?>">Run scrape now</a>
      </div>
    </article>
  </div>

  <article class="cfp-admin-card cfp-admin-card-wide">
    <h2>Scraper speed (xvideos)</h2>
    <p class="cfp-admin-help">Faster pulls more niches/pages and enriches more models per cron tick. Turbo is aggressive — use if xvideos is stable.</p>
    <div class="cfp-admin-speed">
      <div class="cfp-admin-presets" role="group" aria-label="Speed presets">
        <?php foreach ($presets as $key => $preset): ?>
          <a class="cfp-admin-preset<?= $speed === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/admin/scraper?speed=' . rawurlencode($key))) ?>">
            <strong><?= cfp_e(ucfirst($key)) ?></strong>
            <span><?= (int) $preset['niches_per_run'] ?> niches · <?= (int) $preset['limit_per_niche'] ?>/niche · enrich <?= (int) $preset['enrich_per_run'] ?></span>
          </a>
        <?php endforeach; ?>
      </div>
      <form method="get" action="<?= cfp_e(cfp_url('/admin/scraper')) ?>" class="cfp-admin-advanced-form">
        <input type="hidden" name="mode" value="custom">
        <details class="cfp-admin-advanced"<?= $speed === 'custom' ? ' open' : '' ?>>
          <summary>Custom numbers</summary>
          <div class="cfp-admin-fields">
            <label>Niches per run
              <input type="number" name="niches_per_run" min="1" max="12" value="<?= (int) $settings['niches_per_run'] ?>">
            </label>
            <label>Videos per niche
              <input type="number" name="limit_per_niche" min="6" max="48" value="<?= (int) $settings['limit_per_niche'] ?>">
            </label>
            <label>Enrich per run
              <input type="number" name="enrich_per_run" min="0" max="80" value="<?= (int) $settings['enrich_per_run'] ?>">
            </label>
            <label>Max page depth
              <input type="number" name="max_page" min="5" max="60" value="<?= (int) $settings['max_page'] ?>">
            </label>
          </div>
          <button type="submit" class="cfp-btn cfp-btn-ghost">Save custom</button>
        </details>
      </form>
    </div>
  </article>
</section>
