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
    'history' => 'Videos you recently watched',
    'saved' => 'Videos you saved for later',
    'liked' => 'Videos you liked',
    'downloaded' => 'Videos you downloaded',
];
if (!isset($labels[$tab])) {
    $tab = 'history';
}
$initial = strtoupper(substr((string) $user['username'], 0, 1));
$isAdminUser = ((string) $user['username'] === 'admin') || (function_exists('cfp_admin_ok') && cfp_admin_ok());
$totalLib = (int) ($counts['history'] ?? 0) + (int) ($counts['saved'] ?? 0) + (int) ($counts['liked'] ?? 0) + (int) ($counts['downloaded'] ?? 0);
?>
<section class="cfp-profile">
  <header class="cfp-profile-hero">
    <div class="cfp-profile-hero-bg" aria-hidden="true"></div>
    <div class="cfp-profile-hero-inner">
      <div class="cfp-profile-avatar" aria-hidden="true"><?= cfp_e($initial) ?></div>
      <div class="cfp-profile-meta">
        <p class="cfp-kicker">My library</p>
        <h1 class="cfp-profile-name"><?= cfp_e((string) $user['username']) ?></h1>
        <p class="cfp-profile-sub"><?= $totalLib > 0 ? (int) $totalLib . ' items across your lists' : 'Your lists are empty — start watching to fill them' ?></p>
      </div>
      <div class="cfp-profile-actions">
        <?php if ($isAdminUser): ?>
          <a class="cfp-btn cfp-btn-sm cfp-btn-primary" href="<?= cfp_e(cfp_url('/admin')) ?>">Admin panel</a>
        <?php endif; ?>
        <a class="cfp-btn cfp-btn-sm cfp-btn-ghost" href="<?= cfp_e(cfp_url('/auth/logout')) ?>">Log out</a>
      </div>
    </div>
    <div class="cfp-profile-stats" aria-label="Library totals">
      <?php foreach ($labels as $key => $label): ?>
        <a class="cfp-profile-stat<?= $tab === $key ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>">
          <strong><?= (int) ($counts[$key] ?? 0) ?></strong>
          <span><?= cfp_e($label) ?></span>
        </a>
      <?php endforeach; ?>
    </div>
  </header>

  <div class="cfp-profile-body">
    <div class="cfp-section-head">
      <h2 class="cfp-profile-tab-title"><?= cfp_e($labels[$tab]) ?></h2>
      <p class="cfp-profile-tab-hint"><?= cfp_e($hints[$tab]) ?></p>
    </div>

    <nav class="cfp-library-tabs" aria-label="Library">
      <?php foreach ($labels as $key => $label): ?>
        <a class="<?= $tab === $key ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>">
          <?= cfp_e($label) ?>
          <em><?= (int) ($counts[$key] ?? 0) ?></em>
        </a>
      <?php endforeach; ?>
    </nav>

    <?php if (empty($results['items'])): ?>
      <div class="cfp-profile-empty">
        <p class="cfp-empty">No <?= cfp_e(strtolower($labels[$tab])) ?> videos yet.</p>
        <a class="cfp-btn cfp-btn-sm cfp-btn-primary" href="<?= cfp_e(cfp_url('/')) ?>">Browse videos</a>
      </div>
    <?php else: ?>
      <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
      <?php
        $pager = $results;
        $basePath = '/library';
        require __DIR__ . '/_pager.php';
      ?>
    <?php endif; ?>
  </div>
</section>
