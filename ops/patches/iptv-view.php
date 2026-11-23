<?php
declare(strict_types=1);
?>
<link rel="stylesheet" href="<?= movy_e(movy_asset('css/iptv-live.css')) ?>?v=4">

<div class="iptv-shell layout-container" id="iptvApp" data-iptv-root>
  <div class="iptv-top">
    <div class="iptv-heading">
      <p class="iptv-kicker">Live</p>
      <h1 class="iptv-title">Channels</h1>
    </div>
    <div class="iptv-tools">
      <input id="iptvSearch" class="iptv-search" type="search" placeholder="Search channels" autocomplete="off">
      <div id="iptvCountries" class="iptv-chips" role="listbox" aria-label="Countries"></div>
    </div>
  </div>

  <section class="iptv-player-wrap" aria-label="Live player">
    <div class="iptv-stage">
      <video id="iptvVideo" class="iptv-video" playsinline></video>
      <div id="iptvEmpty" class="iptv-empty">
        <span>Select a channel</span>
      </div>
      <div id="iptvBusy" class="iptv-busy" hidden>
        <span class="iptv-spinner"></span>
      </div>
      <div class="iptv-chrome">
        <div class="iptv-chrome-left">
          <button type="button" id="iptvToggle" class="iptv-btn" aria-label="Play/Pause">▶</button>
          <button type="button" id="iptvMute" class="iptv-btn" aria-label="Unmute">🔊</button>
          <span class="iptv-live-pill">LIVE</span>
          <div class="iptv-now">
            <strong id="iptvNowName">No channel</strong>
            <span id="iptvNowMeta">Pick a channel to start</span>
          </div>
        </div>
        <div class="iptv-chrome-right">
          <button type="button" id="iptvFs" class="iptv-btn" aria-label="Fullscreen">⛶</button>
        </div>
      </div>
    </div>
    <p id="iptvError" class="iptv-error" hidden></p>
  </section>

  <section class="iptv-grid-wrap">
    <div class="iptv-grid-head">
      <h2>All channels</h2>
      <span id="iptvCount">Loading…</span>
    </div>
    <div id="iptvList" class="iptv-grid"></div>
  </section>
</div>

<script src="<?= movy_e(movy_asset('js/hls.min.js')) ?>?v=1" defer></script>
<script src="<?= movy_e(movy_asset('js/iptv-live.js')) ?>?v=4" defer></script>
