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
$running = function_exists('cfp_scrape_is_running') ? cfp_scrape_is_running(cfp_pdo()) : false;
$autoOn = !empty($settings['auto']);

$presetLabels = [
    'slow' => 'Slow',
    'normal' => 'Normal',
    'fast' => 'Fast',
    'turbo' => 'Turbo',
    'max' => 'Max',
    'custom' => 'Custom',
];

$overview = [
    ['Videos', cfp_fmt_views((int) ($stats['videos'] ?? 0))],
    ['Views', cfp_fmt_views((int) ($stats['views'] ?? 0))],
    ['Likes', cfp_fmt_views((int) ($stats['likes'] ?? 0))],
    ['People', cfp_fmt_views((int) ($stats['people'] ?? 0))],
    ['Channels', cfp_fmt_views((int) ($stats['channels'] ?? 0))],
    ['Tags', cfp_fmt_views((int) ($stats['tags'] ?? 0))],
    ['Categories', cfp_fmt_views((int) ($stats['categories'] ?? 0))],
    ['With details', cfp_fmt_views((int) ($stats['enriched'] ?? 0))],
    ['Need details', cfp_fmt_views((int) ($stats['pending_enrich'] ?? 0))],
];

$lastRun = (string) ($scrapeState['last_run_at'] ?? '');
$lastRunLabel = $lastRun !== '' ? $lastRun : '—';
if ($lastRun !== '' && ($ts = strtotime($lastRun)) !== false) {
    $ago = max(0, time() - $ts);
    if ($ago < 60) {
        $lastRunLabel = $ago . 's ago';
    } elseif ($ago < 3600) {
        $lastRunLabel = (int) floor($ago / 60) . 'm ago';
    } elseif ($ago < 86400) {
        $lastRunLabel = (int) floor($ago / 3600) . 'h ago';
    } else {
        $lastRunLabel = date('M j, H:i', $ts);
    }
}

$statusRows = [
    ['Auto import', $autoOn ? 'Every 5 min' : 'Off'],
    ['Speed', $presetLabels[$speed] ?? ucfirst($speed)],
    ['Categories / run', (string) (int) ($settings['niches_per_run'] ?? 0)],
    ['Videos / category', (string) (int) ($settings['limit_per_niche'] ?? 0)],
    ['Details / run', (string) (int) ($settings['enrich_per_run'] ?? 0)],
    ['Page depth', (string) (int) ($settings['max_page'] ?? 0)],
    ['Last finished', $lastRunLabel],
    ['Last new videos', (string) (int) ($scrapeState['last_imported'] ?? 0)],
    ['Last details filled', (string) (int) ($scrapeState['last_enriched'] ?? 0)],
    ['Last duration', ((string) ($scrapeState['last_duration_sec'] ?? '—')) . 's'],
];
?>
<section class="sh"<?= $running ? ' data-scrape-running="1"' : '' ?>>
  <div class="sh-head">
    <div class="sh-user-text">
      <h1 class="sh-h1">Admin</h1>
      <p class="sh-muted">Catalog stats and video importer</p>
    </div>
    <div class="sh-actions">
      <a class="sh-btn sh-btn-outline" href="<?= cfp_e(cfp_url('/library')) ?>">Library</a>
      <a class="sh-btn<?= $running ? ' is-busy' : '' ?>" href="<?= cfp_e(cfp_url('/admin/scraper/run')) ?>">
        <?= $running ? 'Running…' : 'Run now' ?>
      </a>
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
          <h2 class="sh-card-title sh-status-title">
            <span class="sh-dot<?= $running ? ' is-on' : ' is-off' ?>" aria-hidden="true"></span>
            Scraper
            <span class="sh-status-pill<?= $running ? ' is-on' : '' ?>"><?= $running ? 'Running' : 'Idle' ?></span>
          </h2>
          <p class="sh-muted">Green = importing now · Red = idle between runs</p>
        </div>
        <a class="sh-btn sh-btn-outline sh-btn-sm" href="<?= cfp_e(cfp_url('/admin')) ?>">Refresh</a>
      </div>
      <div class="sh-card-body sh-card-body-tight">
        <div class="sh-auto">
          <div class="sh-auto-text">
            <strong>Auto import</strong>
            <span>Server cron every 5 minutes<?= $autoOn ? ' (active)' : ' (paused)' ?></span>
          </div>
          <?php if ($autoOn): ?>
            <a class="sh-btn sh-btn-outline sh-btn-sm" href="<?= cfp_e(cfp_url('/admin/scraper/auto?on=0')) ?>">Turn off</a>
          <?php else: ?>
            <a class="sh-btn sh-btn-sm" href="<?= cfp_e(cfp_url('/admin/scraper/auto?on=1')) ?>">Turn on</a>
          <?php endif; ?>
        </div>
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
          <h2 class="sh-card-title">Import speed</h2>
          <p class="sh-muted">How many videos each cron run pulls. Max = fastest.</p>
        </div>
      </div>
      <div class="sh-card-body">
        <div class="sh-seg" role="group" aria-label="Import speed">
          <?php foreach ($presets as $key => $preset): ?>
            <?php
              $cats = (int) $preset['niches_per_run'];
              $vids = (int) $preset['limit_per_niche'];
              $details = (int) $preset['enrich_per_run'];
            ?>
            <a class="sh-seg-item<?= $speed === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/admin/scraper?speed=' . rawurlencode($key))) ?>">
              <span class="sh-seg-name"><?= cfp_e($presetLabels[$key] ?? ucfirst($key)) ?></span>
              <span class="sh-seg-meta"><?= $cats ?> cats · <?= $vids ?> videos · <?= $details ?> details</span>
            </a>
          <?php endforeach; ?>
        </div>

        <p class="sh-help">
          <strong>Details</strong> = people, tags, and channel info pulled from each video page after listing import.
        </p>

        <form method="get" action="<?= cfp_e(cfp_url('/admin/scraper')) ?>" class="sh-form">
          <input type="hidden" name="mode" value="custom">
          <details class="sh-details"<?= $speed === 'custom' ? ' open' : '' ?>>
            <summary>Custom numbers</summary>
            <div class="sh-fields">
              <label>Categories / run<input type="number" name="niches_per_run" min="1" max="20" value="<?= (int) $settings['niches_per_run'] ?>"></label>
              <label>Videos / category<input type="number" name="limit_per_niche" min="6" max="80" value="<?= (int) $settings['limit_per_niche'] ?>"></label>
              <label>Details / run<input type="number" name="enrich_per_run" min="0" max="200" value="<?= (int) $settings['enrich_per_run'] ?>"></label>
              <label>Page depth<input type="number" name="max_page" min="5" max="120" value="<?= (int) $settings['max_page'] ?>"></label>
            </div>
            <button type="submit" class="sh-btn sh-btn-outline">Save</button>
          </details>
        </form>
      </div>
    </div>
  </div>
</section>
<?php if ($running): ?>
<script>
  setTimeout(function () { window.location.reload(); }, 5000);
</script>
<?php endif; ?>
