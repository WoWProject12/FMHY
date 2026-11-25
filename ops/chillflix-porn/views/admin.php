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

$overview = [
    ['Videos', cfp_fmt_views((int) ($stats['videos'] ?? 0))],
    ['Views', cfp_fmt_views((int) ($stats['views'] ?? 0))],
    ['Likes', cfp_fmt_views((int) ($stats['likes'] ?? 0))],
    ['People', cfp_fmt_views((int) ($stats['people'] ?? 0))],
    ['Channels', cfp_fmt_views((int) ($stats['channels'] ?? 0))],
    ['Tags', cfp_fmt_views((int) ($stats['tags'] ?? 0))],
    ['Categories', cfp_fmt_views((int) ($stats['categories'] ?? 0))],
    ['Enriched', cfp_fmt_views((int) ($stats['enriched'] ?? 0))],
    ['Pending', cfp_fmt_views((int) ($stats['pending_enrich'] ?? 0))],
];
$statusRows = [
    ['Preset', (string) ($settings['speed'] ?? 'fast')],
    ['Niches / run', (string) (int) ($settings['niches_per_run'] ?? 0)],
    ['Per niche', (string) (int) ($settings['limit_per_niche'] ?? 0)],
    ['Enrich / run', (string) (int) ($settings['enrich_per_run'] ?? 0)],
    ['Max page', (string) (int) ($settings['max_page'] ?? 0)],
    ['Last run', (string) ($scrapeState['last_run_at'] ?? '—')],
    ['Imported', (string) (int) ($scrapeState['last_imported'] ?? 0)],
    ['Enriched', (string) (int) ($scrapeState['last_enriched'] ?? 0)],
    ['Duration', ((string) ($scrapeState['last_duration_sec'] ?? '—')) . 's'],
    ['Cursor', (int) ($scrapeState['offset'] ?? 0) . ' / p' . (int) ($scrapeState['page'] ?? 0)],
];
?>
<section class="sh">
  <div class="sh-head">
    <div class="sh-user-text">
      <h1 class="sh-h1">Admin</h1>
      <p class="sh-muted">Stats &amp; scraper controls</p>
    </div>
    <div class="sh-actions">
      <a class="sh-btn sh-btn-outline" href="<?= cfp_e(cfp_url('/library')) ?>">Library</a>
      <a class="sh-btn" href="<?= cfp_e(cfp_url('/admin/scraper/run')) ?>">Run scrape</a>
      <a class="sh-btn sh-btn-ghost" href="<?= cfp_e(cfp_url('/admin/logout')) ?>">Log out</a>
    </div>
  </div>

  <?php if ($flash): ?>
    <div class="sh-alert"><?= cfp_e($flash) ?></div>
  <?php endif; ?>
  <?php if ($flashErr): ?>
    <div class="sh-alert sh-alert-err"><?= cfp_e($flashErr) ?></div>
  <?php endif; ?>

  <div class="sh-kpi">
    <?php foreach ($overview as [$label, $value]): ?>
      <div class="sh-kpi-item">
        <span class="sh-kpi-label"><?= cfp_e($label) ?></span>
        <span class="sh-kpi-value"><?= cfp_e($value) ?></span>
      </div>
    <?php endforeach; ?>
  </div>

  <div class="sh-split">
    <div class="sh-card">
      <div class="sh-card-head">
        <div>
          <h2 class="sh-card-title">Scraper status</h2>
          <p class="sh-muted">Last run details</p>
        </div>
      </div>
      <div class="sh-card-body sh-card-body-tight">
        <dl class="sh-rows">
          <?php foreach ($statusRows as [$k, $v]): ?>
            <div class="sh-row">
              <dt><?= cfp_e($k) ?></dt>
              <dd><?= cfp_e($v) ?></dd>
            </div>
          <?php endforeach; ?>
        </dl>
      </div>
    </div>

    <div class="sh-card">
      <div class="sh-card-head">
        <div>
          <h2 class="sh-card-title">Speed</h2>
          <p class="sh-muted">Cron pull intensity</p>
        </div>
      </div>
      <div class="sh-card-body">
        <div class="sh-seg" role="group" aria-label="Speed">
          <?php foreach ($presets as $key => $preset): ?>
            <a class="sh-seg-item<?= $speed === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/admin/scraper?speed=' . rawurlencode($key))) ?>">
              <span class="sh-seg-name"><?= cfp_e(ucfirst($key)) ?></span>
              <span class="sh-seg-meta"><?= (int) $preset['niches_per_run'] ?>×<?= (int) $preset['limit_per_niche'] ?> · e<?= (int) $preset['enrich_per_run'] ?></span>
            </a>
          <?php endforeach; ?>
        </div>

        <form method="get" action="<?= cfp_e(cfp_url('/admin/scraper')) ?>" class="sh-form">
          <input type="hidden" name="mode" value="custom">
          <details class="sh-details"<?= $speed === 'custom' ? ' open' : '' ?>>
            <summary>Custom</summary>
            <div class="sh-fields">
              <label>Niches<input type="number" name="niches_per_run" min="1" max="12" value="<?= (int) $settings['niches_per_run'] ?>"></label>
              <label>Per niche<input type="number" name="limit_per_niche" min="6" max="48" value="<?= (int) $settings['limit_per_niche'] ?>"></label>
              <label>Enrich<input type="number" name="enrich_per_run" min="0" max="80" value="<?= (int) $settings['enrich_per_run'] ?>"></label>
              <label>Max page<input type="number" name="max_page" min="5" max="60" value="<?= (int) $settings['max_page'] ?>"></label>
            </div>
            <button type="submit" class="sh-btn sh-btn-outline">Save</button>
          </details>
        </form>
      </div>
    </div>
  </div>
</section>
