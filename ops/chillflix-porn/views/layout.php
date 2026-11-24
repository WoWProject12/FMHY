<?php
declare(strict_types=1);
/** @var string $pageTitle */
/** @var string $pageDescription */
/** @var string $bodyClass */
/** @var string $view */
/** @var bool $needsAge */
?>
<!DOCTYPE html>
<html lang="en" class="toflix-app cfp-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title><?= cfp_e($pageTitle) ?></title>
  <meta name="description" content="<?= cfp_e($pageDescription) ?>">
  <meta name="robots" content="noindex,nofollow">
  <meta name="rating" content="adult">
  <link rel="stylesheet" href="<?= cfp_e(cfp_main_asset('css/cinema.css?v=97fxovertoast1')) ?>">
  <link rel="stylesheet" href="<?= cfp_e(cfp_main_asset('css/bridge.css?v=20261123notif22acctontop1phoneplayer5noshrink2nospa1fxuser5nocardfx1maylike1settingsback1')) ?>">
  <link rel="stylesheet" href="<?= cfp_e(cfp_asset('css/porn.css?v=1')) ?>">
  <link rel="icon" href="<?= cfp_e(CFP_MAIN_SITE . '/favicon.ico') ?>">
</head>
<body class="<?= cfp_e($bodyClass) ?>">
<div class="aurora-bg" aria-hidden="true"><div class="aurora-bg-wash"></div><div class="aurora-bg-grain"></div></div>
<canvas class="aurora-leaves" aria-hidden="true"></canvas>
<canvas class="aurora-snow" aria-hidden="true"></canvas>
<script>
(function(){
  try {
    window.__movySiteFx = {water:true,leaves:true,snow:true};
    var root = document.documentElement;
    var u = {water:true,leaves:true,snow:true};
    try {
      var raw = JSON.parse(localStorage.getItem('movy_fx_user') || 'null');
      if (raw && typeof raw === 'object') {
        if ('water' in raw) u.water = !!raw.water;
        if ('leaves' in raw) u.leaves = !!raw.leaves;
        if ('snow' in raw) u.snow = !!raw.snow;
      }
    } catch (e) {}
    var fx = {water:!!u.water, leaves:!!u.leaves, snow:!!u.snow};
    root.classList.toggle('movy-fx-off-leaves', !fx.leaves);
    root.classList.toggle('movy-fx-off-snow', !fx.snow);
    document.querySelectorAll('.aurora-leaves').forEach(function(el){ el.hidden = !fx.leaves; });
    document.querySelectorAll('.aurora-snow').forEach(function(el){ el.hidden = !fx.snow; });
    document.querySelectorAll('.aurora-bg').forEach(function(el){ el.hidden = !fx.water; });
  } catch (err) {}
})();
</script>

<header class="cfp-header" id="siteHeader">
  <div class="cfp-header-inner">
    <a class="cfp-brand" href="<?= cfp_e(cfp_url('/')) ?>" aria-label="<?= cfp_e(CFP_SITE_NAME) ?>">
      <span class="cfp-brand-mark">C</span>
      <span class="cfp-brand-text">Chillflix <em>Porn</em></span>
    </a>
    <form class="cfp-search" action="<?= cfp_e(cfp_url('/search')) ?>" method="get" role="search">
      <input type="search" name="q" placeholder="Search videos…" value="<?= cfp_e((string) ($q ?? '')) ?>" autocomplete="off">
      <button type="submit" aria-label="Search">Search</button>
    </form>
    <nav class="cfp-nav" aria-label="Primary">
      <a href="<?= cfp_e(cfp_url('/')) ?>">Home</a>
      <a href="<?= cfp_e(cfp_url('/categories')) ?>">Categories</a>
      <a class="cfp-nav-main" href="<?= cfp_e(CFP_MAIN_SITE) ?>">Movies</a>
    </nav>
  </div>
</header>

<main id="main" class="cfp-main">
<?php if (!empty($needsAge)): ?>
  <?php require __DIR__ . '/agegate.php'; ?>
<?php else: ?>
  <?php require __DIR__ . '/' . $view . '.php'; ?>
<?php endif; ?>
</main>

<nav class="cfp-dock" aria-label="Mobile navigation">
  <a href="<?= cfp_e(cfp_url('/')) ?>" class="<?= ($view ?? '') === 'home' ? 'is-on' : '' ?>">Home</a>
  <a href="<?= cfp_e(cfp_url('/categories')) ?>" class="<?= ($view ?? '') === 'categories' ? 'is-on' : '' ?>">Cats</a>
  <a href="<?= cfp_e(cfp_url('/search')) ?>">Search</a>
  <a href="<?= cfp_e(CFP_MAIN_SITE) ?>">Movies</a>
</nav>

<footer class="cfp-footer">
  <p>18+ only. <?= cfp_e(CFP_SITE_NAME) ?> — same Chillflix look, own catalog.</p>
  <p><a href="<?= cfp_e(CFP_MAIN_SITE) ?>">Back to Chillflix</a></p>
</footer>

<script src="<?= cfp_e(cfp_main_asset('js/leaves.js?v=29fxuser')) ?>" defer></script>
<script src="<?= cfp_e(cfp_main_asset('js/snow.js?v=5fxuser')) ?>" defer></script>
<script src="<?= cfp_e(cfp_asset('js/porn.js?v=1')) ?>" defer></script>
</body>
</html>
