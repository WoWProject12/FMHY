<?php
declare(strict_types=1);
/** @var string|null $flashErr */
$flashErr = $flashErr ?? null;
?>
<section class="cfp-auth">
  <h1 class="cfp-page-title">Create account</h1>
  <p class="cfp-auth-sub">Track history, saved, liked, and downloads in your library.</p>
  <?php if ($flashErr): ?>
    <p class="cfp-admin-flash is-err"><?= cfp_e($flashErr) ?></p>
  <?php endif; ?>
  <form method="get" action="<?= cfp_e(cfp_url('/auth/register')) ?>" class="cfp-auth-form">
    <label>
      Username
      <input type="text" name="user" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" autocomplete="username" autofocus>
    </label>
    <label>
      Email <span>(optional)</span>
      <input type="email" name="email" autocomplete="email">
    </label>
    <label>
      Password
      <input type="password" name="pass" required minlength="6" autocomplete="new-password">
    </label>
    <button type="submit" class="cfp-btn">Create account</button>
  </form>
  <p class="cfp-auth-switch">Already have an account? <a href="<?= cfp_e(cfp_url('/login')) ?>">Sign in</a></p>
</section>
