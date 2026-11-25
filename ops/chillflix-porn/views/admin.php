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

$siteMetrics = [
    ['Videos', (int) ($stats['videos'] ?? 0)],
    ['Views', (int) ($stats['views'] ?? 0)],
    ['Likes', (int) ($stats['likes'] ?? 0)],
    ['People', (int) ($stats['people'] ?? 0)],
    ['Channels', (int) ($stats['channels'] ?? 0)],
    ['Tags', (int) ($stats['tags'] ?? 0)],
    ['Categories', (int) ($stats['categories'] ?? 0)],
    ['Enriched', (int) ($stats['enriched'] ?? 0)],
    ['Pending enrich', (int) ($stats['pending_enrich'] ?? 0)],
];
$scrapeMetrics = [
    ['Speed', (string) ($settings['speed'] ?? 'fast')],
    ['Niches / run', (string) (int) ($settings['niches_per_run'] ?? 0)],
    ['Videos / niche', (string) (int) ($settings['limit_per_niche'] ?? 0)],
    ['Enrich / run', (string) (int) ($settings['enrich_per_run'] ?? 0)],
    ['Max page', (string) (int) ($settings['max_page'] ?? 0)],
    ['Last run', (string) ($scrapeState['last_run_at'] ?? '—')],
    ['Last imported', (string) (int) ($scrapeState['last_imported'] ?? 0)],
    ['Last enriched', (string) (int) ($scrapeState['last_enriched'] ?? 0)],
    ['Last duration', ((string) ($scrapeState['last_duration_sec'] ?? '—')) . 's'],
    ['Cursor', 'offset ' . (int) ($scrapeState['offset'] ?? 0) . ' · page ' . (int) ($scrapeState['page'] ?? 0)],
];
?>
<section class="cfp-ui cfp-admin">
  <div class="cfp-ui-pagehead">
    <div class="cfp-ui-pagehead-text">
      <h1 class="cfp-ui-title">Admin</h1>
      <p class="cfp-ui-desc">Site stats and scraper controls for Chillflix Porn.</p>
    </div>
    <div class="cfp-ui-pagehead-actions">
      <a class="cfp-ui-btn cfp-ui-btn-outline" href="<?= cfp_e(cfp_url('/library')) ?>">Library</a>
      <a class="cfp-ui-btn cfp-ui-btn-ghost" href="<?= cfp_e(cfp_url('/admin/logout')) ?>">Log out</a>
    </div>
  </div>

  <?php if ($flash): ?>
    <div class="cfp-ui-alert" role="status"><?= cfp_e($flash) ?></div>
  <?php endif; ?>
  <?php if ($flashErr): ?>
    <div class="cfp-ui-alert cfp-ui-alert-destructive" role="alert"><?= cfp_e($flashErr) ?></div>
  <?php endif; ?>

  <div class="cfp-ui-card">
    <div class="cfp-ui-card-head">
      <div class="cfp-ui-card-head-text">
        <h2 class="cfp-ui-card-title">Overview</h2>
        <p class="cfp-ui-card-desc">Catalog size and engagement at a glance.</p>
      </div>
    </div>
    <div class="cfp-ui-card-body">
      <div class="cfp-ui-metricgrid">
        <?php foreach ($siteMetrics as [$label, $value]): ?>
          <div class="cfp-ui-metric">
            <span class="cfp-ui-metric-label"><?= cfp_e($label) ?></span>
            <span class="cfp-ui-metric-value"><?= cfp_e(cfp_fmt_views((int) $value)) ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    </div>
  </div>

  <div class="cfp-ui-grid-2">
    <div class="cfp-ui-card">
      <div class="cfp-ui-card-head">
        <div class="cfp-ui-card-head-text">
          <h2 class="cfp-ui-card-title">Scraper status</h2>
          <p class="cfp-ui-card-desc">Current preset and last cron run.</p>
        </div>
        <a class="cfp-ui-btn cfp-ui-btn-sm" href="<?= cfp_e(cfp_url('/admin/scraper/run')) ?>">Run now</a>
      </div>
      <div class="cfp-ui-card-body">
        <div class="cfp-ui-metricgrid cfp-ui-metricgrid-tight">
          <?php foreach ($scrapeMetrics as [$label, $value]): ?>
            <div class="cfp-ui-metric">
              <span class="cfp-ui-metric-label"><?= cfp_e($label) ?></span>
              <span class="cfp-ui-metric-value cfp-ui-metric-value-sm"><?= cfp_e($value) ?></span>
            </div>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-ui-card">
      <div class="cfp-ui-card-head">
        <div class="cfp-ui-card-head-text">
          <h2 class="cfp-ui-card-title">Scraper speed</h2>
          <p class="cfp-ui-card-desc">Faster presets pull more niches and enrich more models per tick.</p>
        </div>
      </div>
      <div class="cfp-ui-card-body">
        <div class="cfp-ui-toggle" role="group" aria-label="Speed presets">
          <?php foreach ($presets as $key => $preset): ?>
            <a class="cfp-ui-toggle-item<?= $speed === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/admin/scraper?speed=' . rawurlencode($key))) ?>">
              <strong><?= cfp_e(ucfirst($key)) ?></strong>
              <span><?= (int) $preset['niches_per_run'] ?> niches · <?= (int) $preset['limit_per_niche'] ?>/niche · enrich <?= (int) $preset['enrich_per_run'] ?></span>
            </a>
          <?php endforeach; ?>
        </div>

        <form method="get" action="<?= cfp_e(cfp_url('/admin/scraper')) ?>" class="cfp-ui-form">
          <input type="hidden" name="mode" value="custom">
          <details class="cfp-ui-details"<?= $speed === 'custom' ? ' open' : '' ?>>
            <summary>Custom numbers</summary>
            <div class="cfp-ui-fieldgrid">
              <label class="cfp-ui-field">
                <span>Niches per run</span>
                <input type="number" name="niches_per_run" min="1" max="12" value="<?= (int) $settings['niches_per_run'] ?>">
              </label>
              <label class="cfp-ui-field">
                <span>Videos per niche</span>
                <input type="number" name="limit_per_niche" min="6" max="48" value="<?= (int) $settings['limit_per_niche'] ?>">
              </label>
              <label class="cfp-ui-field">
                <span>Enrich per run</span>
                <input type="number" name="enrich_per_run" min="0" max="80" value="<?= (int) $settings['enrich_per_run'] ?>">
              </label>
              <label class="cfp-ui-field">
                <span>Max page depth</span>
                <input type="number" name="max_page" min="5" max="60" value="<?= (int) $settings['max_page'] ?>">
              </label>
            </div>
            <button type="submit" class="cfp-ui-btn cfp-ui-btn-outline">Save custom</button>
          </details>
        </form>
      </div>
    </div>
  </div>
</section>
