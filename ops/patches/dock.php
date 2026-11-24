<?php
declare(strict_types=1);
$nav = $nav ?? '';
$itemClass = 'Dock-module-scss-module__qZDorW__dockItem dock-item';
$activeClass = ' Dock-module-scss-module__qZDorW__active';
$items = [
  ['home', 'Home', movy_url('/'), false],
  ['movie', 'Movies', movy_url('/browse/movie'), false],
  ['tv', 'Shows', movy_url('/browse/tv'), false],
  ['iptv', 'Live', movy_url('/iptv'), false],
  ['anime', 'Anime', movy_url('/browse/anime'), false],
];
?>
<style id="toflix-dock-desktop-hide">
/* PC uses the top header — never show the bottom dock on desktop. */
@media (min-width: 768px) {
  nav[aria-label="Mobile navigation"],
  nav.toflix-mobile-dock {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    height: 0 !important;
    overflow: hidden !important;
  }
}
</style>
<style id="toflix-dock-live-new">
  .dock-item-live {
    position: relative;
  }
  .dock-new-badge {
    position: absolute;
    top: 0;
    right: 2px;
    left: auto;
    transform: none;
    z-index: 3;
    padding: 0 3px;
    border-radius: 4px;
    font-size: 7px;
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1.35;
    color: #0c0b09;
    background: #e4c27a;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    white-space: nowrap;
  }
  .dock-item-live .Dock-module-scss-module__qZDorW__dockIcon,
  .dock-item-live .dock-label {
    position: relative;
  }
</style>
<nav class="fixed bottom-0 left-0 right-0 z-40 pointer-events-none md:hidden toflix-mobile-dock" aria-label="Mobile navigation">
  <div class="Dock-module-scss-module__qZDorW__dockOuter">
    <div aria-label="Primary navigation dock" class="Dock-module-scss-module__qZDorW__dockPanel dock-panel pointer-events-auto" role="toolbar">
      <a aria-label="Home" href="<?= movy_e(movy_url('/')) ?>" class="<?= $itemClass . ($nav === 'home' ? $activeClass : '') ?>" title="Home">
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        </span>
        <span class="dock-label">Home</span>
      </a>
      <a aria-label="Movies" href="<?= movy_e(movy_url('/browse/movie')) ?>" class="<?= $itemClass . ($nav === 'movie' ? $activeClass : '') ?>" title="Movies">
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M7 3v18"></path><path d="M3 7.5h4"></path><path d="M3 12h18"></path><path d="M3 16.5h4"></path><path d="M17 3v18"></path><path d="M17 7.5h4"></path><path d="M17 16.5h4"></path></svg>
        </span>
        <span class="dock-label">Movies</span>
      </a>
      <a aria-label="Shows" href="<?= movy_e(movy_url('/browse/tv')) ?>" class="<?= $itemClass . ($nav === 'tv' ? $activeClass : '') ?>" title="Shows">
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path></svg>
        </span>
        <span class="dock-label">Shows</span>
      </a>
      <a aria-label="Live TV" href="<?= movy_e(movy_url('/iptv')) ?>" class="<?= $itemClass . ' dock-item-live' . ($nav === 'iptv' ? $activeClass : '') ?>" title="Live TV">
        <span class="dock-new-badge" aria-hidden="true">NEW</span>
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><path d="m8 3 4 4 4-4"/><rect width="20" height="13" x="2" y="7" rx="2"/><circle cx="12" cy="13.5" r="2.25"/><path d="M7 20h10"/></svg>
        </span>
        <span class="dock-label">Live</span>
      </a>
      <a aria-label="Anime" href="<?= movy_e(movy_url('/browse/anime')) ?>" class="<?= $itemClass . ($nav === 'anime' ? $activeClass : '') ?>" title="Anime">
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><path d="M12 3l1.85 5.7H20l-4.75 3.45 1.8 5.55L12 14.7 6.95 17.7l1.8-5.55L4 8.7h6.15z"></path></svg>
        </span>
        <span class="dock-label">Anime</span>
      </a>
      <span class="Dock-module-scss-module__qZDorW__divider dock-divider" aria-hidden="true"></span>
      <button type="button" aria-label="Search" class="<?= $itemClass ?>" id="dockSearch" title="Search">
        <span class="Dock-module-scss-module__qZDorW__dockIcon" aria-hidden="true">
          <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        </span>
        <span class="dock-label">Search</span>
      </button>
      <button type="button" aria-label="Account" class="<?= $itemClass ?>" id="dockLogin" title="Account">
        <span class="Dock-module-scss-module__qZDorW__dockIcon dock-acct-icon" aria-hidden="true" data-acct-nav-av>
          <svg class="dock-acct-fallback" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="20"><circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path></svg>
        </span>
        <span class="acct-av-badge" data-notify-badge data-acct-av-badge hidden>0</span>
        <span class="dock-label">Account</span>
      </button>
    </div>
  </div>
</nav>
