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
  <link rel="stylesheet" href="<?= cfp_e(cfp_asset('css/porn.css?v=12parts')) ?>">
  <link rel="icon" href="<?= cfp_e(CFP_MAIN_SITE . '/favicon.ico') ?>">
</head>
<body class="<?= cfp_e($bodyClass) ?>">
<div class="aurora-bg" aria-hidden="true" hidden><div class="aurora-bg-wash"></div><div class="aurora-bg-grain"></div></div>
<script>
(function(){
  try {
    // /porn keeps a clean dark stage — no leaves/snow FX behind filters
    window.__movySiteFx = {water:false,leaves:false,snow:false};
    document.documentElement.classList.add('movy-fx-off-leaves', 'movy-fx-off-snow');
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
      <input type="search" name="q" placeholder="Search…" value="<?= cfp_e((string) ($q ?? ($filters['q'] ?? ''))) ?>" autocomplete="off">
      <button type="submit" aria-label="Search">Go</button>
    </form>
    <nav class="cfp-nav" aria-label="Primary">
      <a href="<?= cfp_e(cfp_url('/')) ?>" class="<?= ($view ?? '') === 'home' ? 'is-on' : '' ?>">Home</a>
      <div class="cfp-dd cfp-nav-dd" data-cfp-dd>
        <button type="button" class="cfp-dd-btn<?= ($view ?? '') === 'categories' ? ' is-active' : '' ?>" aria-expanded="false" aria-haspopup="listbox">
          <span class="cfp-dd-kicker">Browse</span>
          <span class="cfp-dd-value">Categories</span>
          <span class="cfp-dd-caret" aria-hidden="true"></span>
        </button>
        <div class="cfp-dd-menu" hidden>
          <div class="cfp-dd-search">
            <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
          </div>
          <div class="cfp-dd-list" role="listbox">
            <a class="cfp-dd-option" href="<?= cfp_e(cfp_url('/')) ?>" data-label="all categories">All categories</a>
            <?php foreach (($navCats ?? []) as $nc): ?>
              <a class="cfp-dd-option" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($nc['slug']))) ?>" data-label="<?= cfp_e(strtolower($nc['name'])) ?>">
                <span><?= cfp_e($nc['name']) ?></span>
                <em><?= (int) $nc['n'] ?></em>
              </a>
            <?php endforeach; ?>
          </div>
          <div class="cfp-dd-foot"><a href="<?= cfp_e(cfp_url('/categories')) ?>">Full category list</a></div>
        </div>
      </div>
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
  <p>18+ only · <a href="<?= cfp_e(CFP_MAIN_SITE) ?>">Chillflix</a></p>
</footer>

<script src="<?= cfp_e(cfp_asset('js/porn.js?v=12parts')) ?>" defer></script>
</body>
</html>
