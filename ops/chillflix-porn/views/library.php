<?php
declare(strict_types=1);
/** @var array $user */
/** @var array $results */
/** @var string $tab */
/** @var array $counts */
$tab = $tab ?? 'history';
$counts = $counts ?? [];
$labels = [
    'history' => 'History',
    'saved' => 'Saved',
    'liked' => 'Liked',
    'downloaded' => 'Downloaded',
];
$hints = [
    'history' => 'Videos you recently watched.',
    'saved' => 'Videos you saved for later.',
    'liked' => 'Videos you liked.',
    'downloaded' => 'Videos you downloaded.',
];
if (!isset($labels[$tab])) {
    $tab = 'history';
}
$initial = strtoupper(substr((string) $user['username'], 0, 1));
$isAdminUser = ((string) $user['username'] === 'admin') || (function_exists('cfp_admin_ok') && cfp_admin_ok());
$totalLib = (int) ($counts['history'] ?? 0) + (int) ($counts['saved'] ?? 0) + (int) ($counts['liked'] ?? 0) + (int) ($counts['downloaded'] ?? 0);
?>
<section class="cfp-ui cfp-profile">
  <div class="cfp-ui-pagehead">
    <div class="cfp-ui-pagehead-text">
      <h1 class="cfp-ui-title">Library</h1>
      <p class="cfp-ui-desc">Your watch history, saves, likes, and downloads.</p>
    </div>
    <div class="cfp-ui-pagehead-actions">
      <?php if ($isAdminUser): ?>
        <a class="cfp-ui-btn cfp-ui-btn-outline" href="<?= cfp_e(cfp_url('/admin')) ?>">Admin</a>
      <?php endif; ?>
      <a class="cfp-ui-btn cfp-ui-btn-ghost" href="<?= cfp_e(cfp_url('/auth/logout')) ?>">Log out</a>
    </div>
  </div>

  <div class="cfp-ui-card">
    <div class="cfp-ui-card-head cfp-profile-card-head">
      <div class="cfp-ui-avatar" aria-hidden="true"><?= cfp_e($initial) ?></div>
      <div class="cfp-ui-card-head-text">
        <h2 class="cfp-ui-card-title"><?= cfp_e((string) $user['username']) ?></h2>
        <p class="cfp-ui-card-desc"><?= $totalLib > 0 ? (int) $totalLib . ' items across your lists' : 'No items yet — start watching to fill your lists' ?></p>
      </div>
      <?php if ($isAdminUser): ?>
        <span class="cfp-ui-badge">Admin</span>
      <?php endif; ?>
    </div>
    <div class="cfp-ui-sep"></div>
    <div class="cfp-ui-card-body">
      <div class="cfp-ui-statgrid">
        <?php foreach ($labels as $key => $label): ?>
          <a class="cfp-ui-stat<?= $tab === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>">
            <span class="cfp-ui-stat-label"><?= cfp_e($label) ?></span>
            <span class="cfp-ui-stat-value"><?= (int) ($counts[$key] ?? 0) ?></span>
          </a>
        <?php endforeach; ?>
      </div>
    </div>
  </div>

  <div class="cfp-ui-card">
    <div class="cfp-ui-card-head">
      <div class="cfp-ui-card-head-text">
        <h2 class="cfp-ui-card-title"><?= cfp_e($labels[$tab]) ?></h2>
        <p class="cfp-ui-card-desc"><?= cfp_e($hints[$tab]) ?></p>
      </div>
    </div>
    <div class="cfp-ui-card-body">
      <div class="cfp-ui-tabs" role="tablist" aria-label="Library">
        <?php foreach ($labels as $key => $label): ?>
          <a class="cfp-ui-tab<?= $tab === $key ? ' is-on' : '' ?>" role="tab" aria-selected="<?= $tab === $key ? 'true' : 'false' ?>" href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>">
            <?= cfp_e($label) ?>
            <span class="cfp-ui-tab-count"><?= (int) ($counts[$key] ?? 0) ?></span>
          </a>
        <?php endforeach; ?>
      </div>

      <?php if (empty($results['items'])): ?>
        <div class="cfp-ui-empty">
          <p class="cfp-ui-empty-title">No <?= cfp_e(strtolower($labels[$tab])) ?> yet</p>
          <p class="cfp-ui-empty-desc">Browse the catalog and this list will fill in automatically.</p>
          <a class="cfp-ui-btn" href="<?= cfp_e(cfp_url('/')) ?>">Browse videos</a>
        </div>
      <?php else: ?>
        <div class="cfp-ui-list-pad">
          <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
          <?php
            $pager = $results;
            $basePath = '/library';
            require __DIR__ . '/_pager.php';
          ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</section>
