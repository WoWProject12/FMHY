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
if (!isset($labels[$tab])) {
    $tab = 'history';
}
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">My library</h1>
    <a class="cfp-chip" href="<?= cfp_e(cfp_url('/auth/logout')) ?>">Log out</a>
  </div>
  <p class="cfp-auth-sub">Signed in as <strong><?= cfp_e((string) $user['username']) ?></strong></p>

  <nav class="cfp-library-tabs" aria-label="Library">
    <?php foreach ($labels as $key => $label): ?>
      <a class="<?= $tab === $key ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>">
        <?= cfp_e($label) ?>
        <em><?= (int) ($counts[$key] ?? 0) ?></em>
      </a>
    <?php endforeach; ?>
  </nav>

  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">No <?= cfp_e(strtolower($labels[$tab])) ?> videos yet.</p>
  <?php else: ?>
    <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
    <?php
      $pager = $results;
      $basePath = '/library';
      require __DIR__ . '/_pager.php';
    ?>
  <?php endif; ?>
</section>
