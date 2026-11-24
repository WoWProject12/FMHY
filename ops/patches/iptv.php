<?php
declare(strict_types=1);
?>
<link rel="stylesheet" href="<?= movy_e(movy_asset('css/iptv-live.css')) ?>?v=43">

<div id="iptvApp" class="huhu" data-iptv-root>
  <!-- LIST -->
  <div id="iptvListView" class="huhu-list-view">
    <header class="huhu-top">
      <div class="huhu-tabs" role="tablist">
        <button type="button" class="huhu-tab" data-tab="favs" role="tab">Favorites</button>
        <button type="button" class="huhu-tab is-on" data-tab="live" role="tab">Live TV</button>
      </div>

      <label class="huhu-search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="iptvSearch" type="search" placeholder="Search channels..." autocomplete="off">
      </label>

      <div class="huhu-filters">
        <div class="huhu-dd" data-dd="sort">
          <button type="button" class="huhu-dd-btn" id="iptvSortBtn" aria-haspopup="listbox" aria-expanded="false">Trending</button>
          <div class="huhu-dd-menu" id="iptvSortMenu" role="listbox" hidden>
            <button type="button" class="huhu-dd-option is-on" role="option" data-value="trending">Trending</button>
            <button type="button" class="huhu-dd-option" role="option" data-value="name">A–Z</button>
          </div>
          <input type="hidden" id="iptvSort" value="trending">
        </div>
        <div class="huhu-dd" data-dd="country">
          <button type="button" class="huhu-dd-btn" id="iptvCountryBtn" aria-haspopup="listbox" aria-expanded="false">Country: all</button>
          <div class="huhu-dd-menu" id="iptvCountryMenu" role="listbox" hidden>
            <button type="button" class="huhu-dd-option is-on" role="option" data-value="">Country: all</button>
          </div>
          <input type="hidden" id="iptvCountry" value="">
        </div>
      </div>
    </header>

    <div id="iptvList" class="huhu-rows" role="list"></div>
    <p id="iptvListStatus" class="huhu-status">Loading…</p>
  </div>

  <!-- PLAYER -->
  <div id="iptvPlayerView" class="huhu-player-view" hidden>
    <div class="huhu-stage">
      <video id="iptvVideo" class="huhu-video" playsinline></video>
      <div id="iptvBusy" class="huhu-busy" hidden><span class="huhu-spin"></span></div>
      <div id="iptvPlayerError" class="huhu-player-error" hidden></div>
    </div>

    <aside class="huhu-sheet" id="iptvSheet" aria-label="Player controls">
      <div class="huhu-sheet-head">
        <div id="iptvNowAvatar" class="huhu-avatar huhu-avatar-lg" aria-hidden="true">?</div>
        <strong id="iptvNowName" class="huhu-now-name">Channel</strong>
      </div>

      <div class="huhu-toolbar" role="toolbar">
        <button type="button" id="iptvMute" class="huhu-icon-btn" title="Mute" aria-label="Mute">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
        <button type="button" id="iptvFavPlayer" class="huhu-icon-btn" title="Favorite" aria-label="Favorite">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" id="iptvPrev" class="huhu-icon-btn" title="Previous" aria-label="Previous channel">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="m7 14 5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" id="iptvNext" class="huhu-icon-btn" title="Next" aria-label="Next channel">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" id="iptvBackList" class="huhu-icon-btn" title="Channels" aria-label="Back to channels">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
        <button type="button" id="iptvPip" class="huhu-icon-btn" title="Picture in picture" aria-label="Picture in picture">
          <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="12" y="11" width="7" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
        <button type="button" id="iptvFs" class="huhu-icon-btn" title="Fullscreen" aria-label="Fullscreen">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <a href="<?= movy_e(movy_url('/party')) ?>" id="iptvParty" class="huhu-icon-btn" title="Watch Party" aria-label="Watch Party" data-no-spa="1">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.2"/>
            <path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>
            <path d="M18 7v4M20 9h-4"/>
          </svg>
        </a>
        <!-- Logged-in indicator only (not clickable) — uses site profile avatar -->
        <span id="iptvAccount" class="huhu-icon-btn huhu-account-badge" title="Logged in" aria-label="Logged in" hidden>
          <span class="huhu-account-av" data-acct-nav-av aria-hidden="true">
            <svg class="dock-acct-fallback" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>
          </span>
        </span>
      </div>

      <div class="huhu-epg-block">
        <div class="huhu-epg-now">
          <span id="iptvEpgNowTime" class="huhu-epg-time"></span>
          <strong id="iptvEpgNowTitle" class="huhu-epg-title"></strong>
          <span id="iptvEpgLeft" class="huhu-epg-left"></span>
        </div>
        <div class="huhu-progress" aria-hidden="true"><i id="iptvEpgBar"></i></div>
        <div id="iptvEpgNext" class="huhu-epg-next"></div>
      </div>
    </aside>
  </div>


</div>

<script src="<?= movy_e(movy_asset('js/hls.min.js')) ?>?v=32" defer></script>
<script src="<?= movy_e(movy_asset('js/iptv-live.js')) ?>?v=43" defer></script>
