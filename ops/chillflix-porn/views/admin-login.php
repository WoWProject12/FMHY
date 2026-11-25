<?php
declare(strict_types=1);
/** @var string|null $flashErr */
$flashErr = $flashErr ?? null;
?>
<section class="sh sh-center">
  <div class="sh-card sh-card-sm">
    <div class="sh-card-head">
      <div>
        <h1 class="sh-card-title">Admin</h1>
        <p class="sh-muted">Enter password to continue</p>
      </div>
    </div>
    <div class="sh-card-body">
      <?php if ($flashErr): ?>
        <div class="sh-alert sh-alert-err"><?= cfp_e($flashErr) ?></div>
      <?php endif; ?>
      <form method="get" action="<?= cfp_e(cfp_url('/admin/login')) ?>" class="sh-form">
        <label class="sh-field">Password
          <input type="password" name="password" required autocomplete="current-password" autofocus>
        </label>
        <button type="submit" class="sh-btn sh-btn-block">Sign in</button>
      </form>
    </div>
  </div>
</section>
