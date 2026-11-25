<?php
declare(strict_types=1);
/** @var array $user */
/** @var array $results */
/** @var string $tab */
/** @var array $counts */
$tab = $tab ?? 'history';
$counts = $counts ?? [];
$labels = [
    'history' => 'Continue watching',
    'saved' => 'Saved',
    'liked' => 'Liked',
    'downloaded' => 'Downloads',
];
$hints = [
    'history' => 'Pick up where you left off',
    'saved' => 'Saved for later',
    'liked' => 'Videos you liked',
    'downloaded' => 'Downloaded videos',
];
if (!isset($labels[$tab])) {
    $tab = 'history';
}
$initial = strtoupper(substr((string) $user['username'], 0, 1));
$avatarUrl = function_exists('cfp_user_avatar_url') ? cfp_user_avatar_url($user) : null;
$isAdminUser = ((string) $user['username'] === 'admin') || (function_exists('cfp_admin_ok') && cfp_admin_ok());
?>
<section class="sh">
  <div class="sh-head">
    <div class="sh-user">
      <button type="button" class="sh-avatar-btn" data-cfp-avatar-open aria-haspopup="dialog" aria-controls="cfpAvatarSheet" title="Change avatar">
        <span class="sh-avatar<?= $avatarUrl ? ' has-avatar' : '' ?>" aria-hidden="true">
          <?php if ($avatarUrl): ?>
            <img src="<?= cfp_e($avatarUrl) ?>" alt="" width="36" height="36" decoding="async" referrerpolicy="no-referrer" data-cfp-avatar-img>
          <?php else: ?>
            <span data-cfp-avatar-letter><?= cfp_e($initial) ?></span>
          <?php endif; ?>
        </span>
        <span class="sh-avatar-edit">Change</span>
      </button>
      <div class="sh-user-text">
        <div class="sh-user-row">
          <h1 class="sh-h1"><?= cfp_e((string) $user['username']) ?></h1>
          <?php if ($isAdminUser): ?><span class="sh-badge">Admin</span><?php endif; ?>
        </div>
        <p class="sh-muted">Tap your photo to change avatar</p>
      </div>
    </div>
    <div class="sh-actions">
      <?php if ($isAdminUser): ?>
        <a class="sh-btn sh-btn-outline" href="<?= cfp_e(cfp_url('/admin')) ?>">Admin</a>
      <?php endif; ?>
      <a class="sh-btn sh-btn-ghost" href="<?= cfp_e(cfp_url('/auth/logout')) ?>">Log out</a>
    </div>
  </div>

  <div class="cfp-avatar-sheet" id="cfpAvatarSheet" hidden role="dialog" aria-modal="true" aria-label="Choose avatar">
    <div class="cfp-avatar-sheet-backdrop" data-cfp-avatar-close></div>
    <div class="cfp-avatar-sheet-panel">
      <div class="cfp-avatar-sheet-head">
        <div>
          <h2>Choose avatar</h2>
          <p class="cfp-avatar-sheet-sub">Scroll and tap a performer thumbnail</p>
        </div>
        <button type="button" class="cfp-avatar-sheet-x" data-cfp-avatar-close aria-label="Close">&times;</button>
      </div>
      <div class="cfp-avatar-sheet-body">
        <div class="cfp-avatar-grid" data-cfp-avatar-grid>
          <p class="sh-muted">Loading…</p>
        </div>
      </div>
      <div class="cfp-avatar-sheet-foot">
        <button type="button" class="cfp-avatar-sheet-cancel" data-cfp-avatar-close>Cancel</button>
        <button type="button" class="cfp-avatar-sheet-done" data-cfp-avatar-close>Done</button>
      </div>
    </div>
  </div>

  <div class="sh-tabs" role="tablist">
    <?php foreach ($labels as $key => $label): ?>
      <a
        class="sh-tab<?= $tab === $key ? ' is-on' : '' ?>"
        role="tab"
        aria-selected="<?= $tab === $key ? 'true' : 'false' ?>"
        href="<?= cfp_e(cfp_url('/library?tab=' . $key)) ?>"
      ><?= cfp_e($label) ?><span><?= (int) ($counts[$key] ?? 0) ?></span></a>
    <?php endforeach; ?>
  </div>

  <div class="sh-card">
    <div class="sh-card-head">
      <div>
        <h2 class="sh-card-title"><?= cfp_e($labels[$tab]) ?></h2>
        <p class="sh-muted"><?= cfp_e($hints[$tab]) ?></p>
      </div>
    </div>
    <div class="sh-card-body">
      <?php if (empty($results['items'])): ?>
        <div class="sh-empty">
          <p>No <?= cfp_e(strtolower($labels[$tab])) ?> yet.</p>
          <a class="sh-btn" href="<?= cfp_e(cfp_url('/')) ?>">Browse</a>
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
  </div>
</section>
