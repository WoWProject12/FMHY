<?php
declare(strict_types=1);
/** @var string|null $flashErr */
/** @var string $next */
$flashErr = $flashErr ?? null;
$next = $next ?? cfp_url('/library');
?>
<section class="cfp-auth">
  <h1 class="cfp-page-title">Sign in</h1>
  <p class="cfp-auth-sub">Save videos, keep watch history, and sync likes across devices.</p>
  <?php if ($flashErr): ?>
    <p class="cfp-admin-flash is-err"><?= cfp_e($flashErr) ?></p>
  <?php endif; ?>
  <form method="get" action="<?= cfp_e(cfp_url('/auth/login')) ?>" class="cfp-auth-form">
    <input type="hidden" name="next" value="<?= cfp_e($next) ?>">
    <label>
      Username or email
      <input type="text" name="user" required autocomplete="username" autofocus>
    </label>
    <label>
      Password
      <input type="password" name="pass" required autocomplete="current-password">
    </label>
    <button type="submit" class="cfp-btn">Sign in</button>
  </form>
  <p class="cfp-auth-switch">No account? <a href="<?= cfp_e(cfp_url('/register')) ?>">Create one</a></p>
</section>
