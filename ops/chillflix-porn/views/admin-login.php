<?php
declare(strict_types=1);
/** @var string|null $flashErr */
$flashErr = $flashErr ?? null;
?>
<section class="cfp-ui cfp-admin cfp-admin-login">
  <div class="cfp-ui-card cfp-ui-card-narrow">
    <div class="cfp-ui-card-head">
      <div class="cfp-ui-card-head-text">
        <h1 class="cfp-ui-card-title">Admin login</h1>
        <p class="cfp-ui-card-desc">Enter the admin password to manage scraper settings and stats.</p>
      </div>
    </div>
    <div class="cfp-ui-card-body">
      <?php if ($flashErr): ?>
        <div class="cfp-ui-alert cfp-ui-alert-destructive" role="alert"><?= cfp_e($flashErr) ?></div>
      <?php endif; ?>
      <form method="get" action="<?= cfp_e(cfp_url('/admin/login')) ?>" class="cfp-ui-form">
        <label class="cfp-ui-field">
          <span>Password</span>
          <input type="password" name="password" required autocomplete="current-password" autofocus>
        </label>
        <button type="submit" class="cfp-ui-btn">Sign in</button>
      </form>
    </div>
  </div>
</section>
