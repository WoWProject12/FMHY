<?php
declare(strict_types=1);
/** @var string $pageTitle */
/** @var string $pageDescription */
/** @var string $bodyClass */
/** @var string $view */
/** @var bool $needsAge */
?>
<!DOCTYPE html>
<html lang="en" class="cfp-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <title><?= cfp_e($pageTitle) ?></title>
  <meta name="description" content="<?= cfp_e($pageDescription) ?>">
  <meta name="robots" content="noindex,nofollow">
  <meta name="rating" content="adult">
  <!-- Standalone /porn CSS only — main-site cinema/bridge was shoving layout right on phones -->
  <link rel="stylesheet" href="<?= cfp_e(cfp_asset('css/porn.css?v=28cdn')) ?>">
  <link rel="icon" href="<?= cfp_e(CFP_MAIN_SITE . '/favicon.ico') ?>">
  <style>
    html,body{margin:0;padding:0;width:100%;max-width:100%;overflow-x:hidden;box-sizing:border-box;background:#0c0b09;color:#f4efe6}
    *,*:before,*:after{box-sizing:border-box}
    .cfp-header-inner,.cfp-main,.cfp-watch,.cfp-player,.cfp-watch-head,.cfp-section,.cfp-footer{width:100%;max-width:100%;min-width:0}
    .cfp-player,.cfp-player-stage,#cfpPlayer{width:100%!important;max-width:100%!important;margin-left:0!important;margin-right:0!important;left:auto!important;right:auto!important;transform:none!important}
    #cfpPlayer{display:block!important;position:static!important;height:auto!important;aspect-ratio:16/9;background:#000;object-fit:contain}
    .cfp-people-row,.cfp-chips,.cfp-person-tags,.cfp-watch-meta{display:flex!important;flex-wrap:wrap!important;gap:.4rem;max-width:100%;overflow:visible!important}
    .cfp-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.65rem .5rem;width:100%}
    .cfp-card{min-width:0;max-width:100%}
    .cfp-card-media{position:relative;width:100%;aspect-ratio:16/10;overflow:hidden}
    .cfp-card-media>img,.cfp-card-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .cfp-rail{max-width:100%;overflow:hidden}
    .cfp-rail-track{display:grid;grid-auto-flow:column;grid-auto-columns:42vw;gap:.5rem;overflow-x:auto;max-width:100%}
    .cfp-rail-card{width:42vw;max-width:42vw}
    @media(min-width:600px){
      .cfp-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))!important}
      .cfp-rail-track{grid-auto-columns:148px}
      .cfp-rail-card{width:148px;max-width:148px}
    }
  </style>
</head>
<body class="<?= cfp_e($bodyClass) ?>">

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
      <a href="<?= cfp_e(cfp_url('/people')) ?>" class="<?= in_array(($view ?? ''), ['people', 'person'], true) ? 'is-on' : '' ?>">People</a>
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
  <a href="<?= cfp_e(cfp_url('/people')) ?>" class="<?= in_array(($view ?? ''), ['people', 'person'], true) ? 'is-on' : '' ?>">People</a>
  <a href="<?= cfp_e(cfp_url('/categories')) ?>" class="<?= ($view ?? '') === 'categories' ? 'is-on' : '' ?>">Cats</a>
  <a href="<?= cfp_e(cfp_url('/search')) ?>">Search</a>
</nav>

<footer class="cfp-footer">
  <p>18+ only · <a href="<?= cfp_e(CFP_MAIN_SITE) ?>">Chillflix</a></p>
</footer>

<script src="<?= cfp_e(cfp_asset('js/porn.js?v=28cdn')) ?>" defer></script>
</body>
</html>
