<?php
declare(strict_types=1);
?>
<div class="layout-container pb-28 pt-[calc(68px+1.25rem)] md:pb-16 md:pt-[calc(80px+1.5rem)]" id="iptvApp" data-iptv-root>
  <div class="mb-6 flex flex-col gap-3 md:mb-8 md:flex-row md:items-end md:justify-between">
    <div>
      <p class="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Broadcast</p>
      <h1 class="m-0 mt-1 text-[28px] font-bold tracking-wide text-text-hi md:text-[36px]">Live TV</h1>
      <p class="m-0 mt-2 max-w-xl text-sm text-text-mid">Live channels with EPG-style browsing — same catalog as huhu.to.</p>
    </div>
    <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      <label class="sr-only" for="iptvSearch">Search channels</label>
      <input id="iptvSearch" autocomplete="off" class="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-text-hi outline-none transition focus:border-white/20 focus:bg-white/[0.06] sm:w-64" placeholder="Search channels…" type="search">
      <label class="sr-only" for="iptvCountry">Country</label>
      <select id="iptvCountry" class="h-10 w-full rounded-xl border border-white/[0.08] bg-[#14110e] px-3 text-sm text-text-hi outline-none transition focus:border-white/20 sm:w-48">
        <option value="">All countries</option>
      </select>
    </div>
  </div>

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)] lg:items-start">
    <section class="overflow-hidden rounded-2xl border border-white/[0.08] bg-black shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div class="relative aspect-video bg-[#0a0908]">
        <video id="iptvVideo" class="absolute inset-0 h-full w-full" controls playsinline muted></video>
        <div id="iptvEmpty" class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <svg aria-hidden="true" class="text-white/25" fill="none" height="36" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24" width="36"><rect height="14" rx="2" width="20" x="2" y="5"></rect><path d="M8 21h8M12 17v4"></path></svg>
          <p class="m-0 text-sm text-white/55">Pick a channel to start watching</p>
        </div>
        <div id="iptvBusy" class="absolute inset-0 hidden items-center justify-center bg-black/55" hidden>
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#2dd4bf]"></div>
        </div>
      </div>
      <div class="border-t border-white/[0.06] px-4 py-3 md:px-5">
        <h2 id="iptvNowName" class="m-0 truncate text-[15px] font-semibold text-text-hi">No channel selected</h2>
        <p id="iptvNowMeta" class="m-0 mt-1 text-xs text-text-mid">Live TV</p>
        <p id="iptvError" class="m-0 mt-2 hidden text-xs text-amber-400"></p>
      </div>
    </section>

    <section class="min-h-[420px] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div class="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <p class="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">Channels</p>
        <p id="iptvCount" class="m-0 text-xs text-white/40">Loading…</p>
      </div>
      <div id="iptvList" class="max-h-[min(70vh,720px)] overflow-y-auto overscroll-contain p-2"></div>
    </section>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js" defer></script>
<script src="<?= movy_e(movy_asset('js/iptv-live.js')) ?>?v=1" defer></script>
