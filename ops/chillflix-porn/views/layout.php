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
  <link rel="stylesheet" href="<?= cfp_e(cfp_asset('css/porn.css?v=74xvui')) ?>">
  <?php
    $cfpUser = cfp_current_user();
    $cfpIsAdmin = $cfpUser && (
        (string) $cfpUser['username'] === 'admin'
        || (function_exists('cfp_admin_ok') && cfp_admin_ok())
    );
    $cfpAvatarUrl = $cfpUser && function_exists('cfp_user_avatar_url')
        ? cfp_user_avatar_url($cfpUser)
        : null;
    $cfpAvatarInitial = $cfpUser
        ? strtoupper(substr((string) $cfpUser['username'], 0, 1))
        : '';
  ?>
  <link rel="icon" href="<?= cfp_e(CFP_MAIN_SITE . '/favicon.ico') ?>">
  <style>
    html,body{margin:0;padding:0;width:100%;max-width:100%;overflow-x:hidden;box-sizing:border-box;background:#0c0b09;color:#f4efe6}
    *,*:before,*:after{box-sizing:border-box}
    .cfp-header-inner,.cfp-main,.cfp-watch,.cfp-player,.cfp-watch-head,.cfp-section,.cfp-footer{width:100%;max-width:100%;min-width:0}
    .cfp-player,.cfp-player-stage{width:100%!important;max-width:100%!important;margin:0!important;left:auto!important;right:auto!important;transform:none!important}
    .cfp-player-frame{width:100%;max-width:100%;position:relative;background:#000}
    #cfpPlayer{display:block!important;background:#000;object-fit:contain}
    .cfp-player-stage:not(.is-fs):not(:fullscreen):not(:-webkit-full-screen) .cfp-player-frame{aspect-ratio:16/9;max-height:70vh}
    .cfp-player-stage:not(.is-fs):not(:fullscreen):not(:-webkit-full-screen) #cfpPlayer{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-height:none!important;aspect-ratio:auto!important}
    .cfp-watch-title{font-size:1.05rem!important;line-height:1.25;margin:0 0 .35rem}
    .cfp-watch-meta{margin:0 0 .35rem;font-size:.78rem}
    .cfp-xv-people{display:flex!important;flex-wrap:wrap!important;gap:.3rem;margin:0 0 .35rem;max-width:100%}
    .cfp-chips,.cfp-chips-watch{display:flex!important;flex-wrap:wrap!important;gap:.25rem;max-width:100%;margin:0}
    .cfp-chip{padding:.18rem .45rem!important;font-size:.7rem!important}
    .cfp-chips-cats{display:none!important}
    .cfp-section{margin:.65rem 0}.cfp-section-head h2{font-size:.95rem}
    /* Phone: exactly 1 video per row everywhere */
    .cfp-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:.55rem;width:100%}
    .cfp-card{min-width:0;max-width:100%;gap:.35rem}
    .cfp-card-media{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:0;border:0}
    .cfp-card-media>img,.cfp-card-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .cfp-card-meta{align-items:center;text-align:center}
    .cfp-card-title{font-size:.95rem;line-height:1.3;font-weight:500;-webkit-line-clamp:2;color:#fff;text-align:center}
    .cfp-card-sub{display:inline-flex!important;flex-wrap:wrap;align-items:center;justify-content:center;gap:.35rem;color:#bdbdbd;font-size:.8rem;text-align:center}
    .cfp-card-sub-main{justify-content:center;max-width:100%}
    .cfp-card-tags{position:absolute;top:6px;right:6px;z-index:3;display:inline-flex;gap:4px}
    .cfp-card-quality,.cfp-card-cc{background:rgba(0,0,0,.72);color:#fff;padding:.16rem .42rem;border-radius:2px;font-size:.78rem;font-weight:700}
    .cfp-card-dur{background:#3a3a3a;color:#f2f2f2;padding:.16rem .48rem;border-radius:3px;font-size:.72rem;font-weight:600}
    .cfp-rail{max-width:100%;overflow:hidden}
    .cfp-rail-track{display:grid!important;grid-auto-flow:row!important;grid-template-columns:minmax(0,1fr)!important;grid-auto-columns:unset!important;gap:.55rem;overflow:visible;max-width:100%}
    .cfp-rail-card{width:100%!important;max-width:100%!important}
    @media(min-width:700px){
      .cfp-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))!important}
      .cfp-card-media{aspect-ratio:16/10}
      .cfp-card-title{font-size:.78rem}
      .cfp-rail-track{grid-auto-flow:column!important;grid-template-columns:none!important;grid-auto-columns:140px!important;overflow-x:auto}
      .cfp-rail-card{width:140px!important;max-width:140px!important}
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
      <?php
        $activeCatSlugs = $filters['categories'] ?? (function_exists('cfp_parse_category_slugs')
          ? cfp_parse_category_slugs($filters['category'] ?? '')
          : []);
        $catBtnLabel = 'Categories';
        if (count($activeCatSlugs) === 1) {
            foreach (($navCats ?? []) as $nc) {
                if ($nc['slug'] === $activeCatSlugs[0]) {
                    $catBtnLabel = (string) $nc['name'];
                    break;
                }
            }
        } elseif (count($activeCatSlugs) > 1) {
            $catBtnLabel = count($activeCatSlugs) . ' categories';
        }
      ?>
      <div class="cfp-dd cfp-nav-dd cfp-nav-cats" data-cfp-dd data-cfp-multi-cats>
        <button type="button" class="cfp-dd-btn<?= $activeCatSlugs || (($view ?? '') === 'categories') ? ' is-active' : '' ?>" aria-expanded="false" aria-haspopup="listbox">
          <span class="cfp-dd-kicker">Browse</span>
          <span class="cfp-dd-value"><?= cfp_e($catBtnLabel) ?></span>
          <span class="cfp-dd-caret" aria-hidden="true"></span>
        </button>
        <div class="cfp-dd-menu cfp-cats-menu" hidden>
          <div class="cfp-dd-search">
            <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
          </div>
          <div class="cfp-dd-list" role="listbox" aria-multiselectable="true">
            <?php foreach (($navCats ?? []) as $nc):
              $on = in_array($nc['slug'], $activeCatSlugs, true);
            ?>
              <button type="button"
                class="cfp-dd-option<?= $on ? ' is-on' : '' ?>"
                data-cfp-cat-toggle="<?= cfp_e($nc['slug']) ?>"
                data-label="<?= cfp_e(strtolower($nc['name'])) ?>"
                aria-pressed="<?= $on ? 'true' : 'false' ?>">
                <span><?= cfp_e($nc['name']) ?></span>
                <em><?= (int) $nc['n'] ?></em>
              </button>
            <?php endforeach; ?>
          </div>
          <div class="cfp-dd-foot cfp-cats-foot">
            <button type="button" class="cfp-cats-clear" data-cfp-cats-clear>Clear</button>
            <button type="button" class="cfp-cats-apply" data-cfp-cats-apply>Apply</button>
          </div>
        </div>
      </div>
      <a class="cfp-nav-main" href="<?= cfp_e(CFP_MAIN_SITE) ?>">Movies</a>
      <?php if ($cfpUser): ?>
        <div class="cfp-dd cfp-nav-dd cfp-account-dd" data-cfp-dd>
          <button type="button" class="cfp-dd-btn cfp-nav-acct<?= $cfpAvatarUrl ? ' has-avatar' : '' ?>" aria-expanded="false" aria-haspopup="menu" aria-label="Account (<?= cfp_e((string) $cfpUser['username']) ?>)" title="<?= cfp_e((string) $cfpUser['username']) ?>">
            <span class="cfp-acct-av" aria-hidden="true">
              <?php if ($cfpAvatarUrl): ?>
                <img class="cfp-acct-img" src="<?= cfp_e($cfpAvatarUrl) ?>" alt="" width="22" height="22" decoding="async" referrerpolicy="no-referrer">
              <?php else: ?>
                <span class="cfp-acct-letter"><?= cfp_e($cfpAvatarInitial) ?></span>
              <?php endif; ?>
            </span>
          </button>
          <div class="cfp-dd-menu cfp-account-menu" hidden>
            <div class="cfp-account-menu-head">
              <span class="cfp-acct-av cfp-acct-av-lg" aria-hidden="true">
                <?php if ($cfpAvatarUrl): ?>
                  <img class="cfp-acct-img" src="<?= cfp_e($cfpAvatarUrl) ?>" alt="" width="32" height="32" decoding="async" referrerpolicy="no-referrer">
                <?php else: ?>
                  <span class="cfp-acct-letter"><?= cfp_e($cfpAvatarInitial) ?></span>
                <?php endif; ?>
              </span>
              <div>
                <strong><?= cfp_e((string) $cfpUser['username']) ?></strong>
                <em>Signed in</em>
              </div>
            </div>
            <div class="cfp-dd-list" role="menu">
              <a class="cfp-dd-option" role="menuitem" href="<?= cfp_e(cfp_url('/library')) ?>">My library</a>
              <a class="cfp-dd-option" role="menuitem" href="<?= cfp_e(cfp_url('/library?tab=history')) ?>">Continue watching</a>
              <a class="cfp-dd-option" role="menuitem" href="<?= cfp_e(cfp_url('/library?tab=saved')) ?>">Saved</a>
              <a class="cfp-dd-option" role="menuitem" href="<?= cfp_e(cfp_url('/library?tab=liked')) ?>">Liked</a>
              <a class="cfp-dd-option" role="menuitem" href="<?= cfp_e(cfp_url('/library?tab=downloaded')) ?>">Downloaded</a>
              <?php if ($cfpIsAdmin): ?>
                <a class="cfp-dd-option cfp-account-admin" role="menuitem" href="<?= cfp_e(cfp_url('/admin')) ?>">Admin panel</a>
              <?php endif; ?>
              <a class="cfp-dd-option cfp-account-logout" role="menuitem" href="<?= cfp_e(cfp_url('/auth/logout')) ?>">Log out</a>
            </div>
          </div>
        </div>
      <?php else: ?>
        <a class="cfp-nav-acct" href="<?= cfp_e(cfp_url('/login')) ?>" aria-label="Account" title="Account">
          <span class="cfp-acct-av" aria-hidden="true">
            <svg class="cfp-acct-fallback" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path></svg>
          </span>
        </a>
      <?php endif; ?>
    </nav>
  </div>
  <?php
  // Filter chips live in the sticky header so they stay fixed while scrolling.
  $showFilterBar = empty($needsAge) && in_array(($view ?? ''), ['home', 'search'], true);
  if ($showFilterBar):
      $activeCatSlugs = $filters['categories'] ?? cfp_parse_category_slugs($filters['category'] ?? '');
      $activeCatSlug = $activeCatSlugs ? implode(',', $activeCatSlugs) : '';
      $activeCatName = null;
      if ($activeCatSlugs && !empty($cats)) {
          $names = [];
          $bySlug = [];
          foreach ($cats as $c) {
              $bySlug[(string) $c['slug']] = (string) $c['name'];
          }
          foreach ($activeCatSlugs as $slug) {
              $names[] = $bySlug[$slug] ?? $slug;
          }
          $activeCatName = implode(', ', $names);
      }
      if (($view ?? '') === 'search') {
          $actionPath = '/search';
          $resultsTotal = (int) (($results['total'] ?? 0));
      } else {
          $actionPath = '/';
          $resultsTotal = (int) (($latest['total'] ?? 0));
      }
  ?>
  <div class="cfp-header-filters">
    <?php require __DIR__ . '/_toolbar.php'; ?>
  </div>
  <?php endif; ?>
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
  <button type="button" class="cfp-dock-cats<?= !empty($filters['categories']) ? ' is-on' : '' ?>" data-cfp-open-nav-cats>Categories</button>
  <?php if ($cfpUser): ?>
    <a href="<?= cfp_e(cfp_url('/library')) ?>" class="cfp-dock-acct<?= ($view ?? '') === 'library' ? ' is-on' : '' ?><?= $cfpAvatarUrl ? ' has-avatar' : '' ?>" aria-label="Account (<?= cfp_e((string) $cfpUser['username']) ?>)" title="<?= cfp_e((string) $cfpUser['username']) ?>">
      <span class="cfp-acct-av" aria-hidden="true">
        <?php if ($cfpAvatarUrl): ?>
          <img class="cfp-acct-img" src="<?= cfp_e($cfpAvatarUrl) ?>" alt="" width="22" height="22" decoding="async" referrerpolicy="no-referrer">
        <?php else: ?>
          <span class="cfp-acct-letter"><?= cfp_e($cfpAvatarInitial) ?></span>
        <?php endif; ?>
      </span>
    </a>
  <?php else: ?>
    <a href="<?= cfp_e(cfp_url('/login')) ?>" class="cfp-dock-acct<?= in_array(($view ?? ''), ['login', 'register'], true) ? ' is-on' : '' ?>" aria-label="Account" title="Account">
      <span class="cfp-acct-av" aria-hidden="true">
        <svg class="cfp-acct-fallback" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path></svg>
      </span>
    </a>
  <?php endif; ?>
</nav>

<footer class="cfp-footer">
  <div class="cfp-footer-inner">
    <div class="cfp-footer-brand">
      <span class="cfp-footer-mark">C</span>
      <div>
        <strong>Chillflix Porn</strong>
        <em>18+ adult videos</em>
      </div>
    </div>
    <nav class="cfp-footer-links" aria-label="Footer">
      <a href="<?= cfp_e(cfp_url('/')) ?>">Home</a>
      <a href="<?= cfp_e(cfp_url('/people')) ?>">People</a>
      <a href="<?= cfp_e(cfp_url('/library')) ?>">Library</a>
      <a href="<?= cfp_e(CFP_MAIN_SITE) ?>">Movies</a>
    </nav>
    <p class="cfp-footer-note">You must be 18 or older to use this site.</p>
  </div>
</footer>

<script src="<?= cfp_e(cfp_asset('js/hls.min.js?v=1')) ?>" defer></script>
<script>
  window.CFP_USER = <?= json_encode($cfpUser ? ['id' => $cfpUser['id'], 'username' => $cfpUser['username'], 'avatar' => $cfpAvatarUrl] : null, JSON_UNESCAPED_SLASHES) ?>;
</script>
<script src="<?= cfp_e(cfp_asset('js/porn.js?v=74xvui')) ?>" defer></script>
</body>
</html>
