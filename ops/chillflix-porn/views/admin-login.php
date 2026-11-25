<?php
declare(strict_types=1);
/** @var string|null $flashErr */
$flashErr = $flashErr ?? null;
?>
<section class="cfp-admin cfp-admin-login">
  <h1 class="cfp-page-title">Admin login</h1>
  <?php if ($flashErr): ?>
    <p class="cfp-admin-flash is-err"><?= cfp_e($flashErr) ?></p>
  <?php endif; ?>
  <form method="get" action="<?= cfp_e(cfp_url('/admin/login')) ?>" class="cfp-admin-login-form">
    <label>
      Password
      <input type="password" name="password" required autocomplete="current-password" autofocus>
    </label>
    <button type="submit" class="cfp-btn">Sign in</button>
  </form>
</section>
