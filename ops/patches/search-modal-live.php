<?php declare(strict_types=1); ?>
<div class="search-modal" id="searchModal" hidden>
  <div class="search-modal-backdrop" data-close-search></div>
  <div class="search-sheet" role="dialog" aria-modal="true" aria-label="Search">
    <div class="search-sheet-handle" aria-hidden="true"></div>
    <div class="search-panel control-3d" id="searchPanel">
      <div class="search-filters" role="tablist" aria-label="Search filter">
        <span class="search-filter-mark" data-search-mark aria-hidden="true"></span>
        <button type="button" class="search-filter is-active" role="tab" aria-selected="true" data-search-type="all">All</button>
        <button type="button" class="search-filter" role="tab" aria-selected="false" data-search-type="movie">Movies</button>
        <button type="button" class="search-filter" role="tab" aria-selected="false" data-search-type="tv">Shows</button>
        <button type="button" class="search-filter" role="tab" aria-selected="false" data-search-type="anime">Anime</button>
        <button type="button" class="search-filter" role="tab" aria-selected="false" data-search-type="live">Live</button>
      </div>
      <div class="search-panel-body" id="searchLive" aria-live="polite"></div>
    </div>
    <div class="search-footer">
      <form class="search-bar control-3d" action="#" method="get" autocomplete="off" id="searchForm" data-no-spa="1">
        <svg class="search-bar-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="search" name="q" id="searchInput" placeholder="Search movies, shows, anime, Live TV" enterkeyhint="search" aria-label="Search">
      </form>
    </div>
  </div>
</div>
