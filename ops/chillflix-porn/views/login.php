<?php
declare(strict_types=1);
/** @var string|null $flashErr */
/** @var string $next */
/** @var string $prefillUser */
$flashErr = $flashErr ?? null;
$next = $next ?? cfp_url('/library');
$prefillUser = $prefillUser ?? '';
?>
<section class="cfp-auth">
  <h1 class="cfp-page-title">Sign in</h1>
  <p class="cfp-auth-sub">Save videos, keep watch history, and sync likes across devices. This is your Chillflix Porn account (separate from the admin panel).</p>
  <?php if ($flashErr): ?>
    <p class="cfp-admin-flash is-err"><?= cfp_e($flashErr) ?></p>
  <?php endif; ?>
  <form method="post" action="<?= cfp_e(cfp_url('/auth/login')) ?>" class="cfp-auth-form" autocomplete="on">
    <input type="hidden" name="next" value="<?= cfp_e($next) ?>">
    <label>
      Username or email
      <input type="text" name="user" required autocomplete="username" autofocus value="<?= cfp_e($prefillUser) ?>">
    </label>
    <label>
      Password
      <input type="password" name="pass" required autocomplete="current-password">
    </label>
    <button type="submit" class="cfp-btn">Sign in</button>
  </form>
  <p class="cfp-auth-switch">No account yet? <a href="<?= cfp_e(cfp_url('/register')) ?>">Create one</a> — free, takes a few seconds.</p>
</section>
