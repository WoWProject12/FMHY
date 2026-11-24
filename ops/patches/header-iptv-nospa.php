<?php
declare(strict_types=1);
$siteName = (string) movy_config('site_name', 'Chillflix');
$isToflixBrand = strcasecmp($siteName, 'Toflix') === 0;
$nav = $nav ?? '';
$active = static function (string $section, string $current): string {
    return $section === $current
        ? 'text-white font-semibold'
        : 'text-white/70 hover:text-white hover:bg-white/[0.07]';
};
$appHref = movy_url('/app');
$appMark = '';
?>
<header class="fixed left-0 right-0 top-0 z-40 pointer-events-none" id="siteHeader">
  <div aria-hidden="true" class="header-fade absolute inset-x-0 top-0 h-20 md:h-24 pointer-events-none opacity-0 transition-opacity duration-250"
       style="background:linear-gradient(180deg, rgba(16,12,9,0.92) 0%, rgba(16,12,9,0.55) 40%, rgba(16,12,9,0.3) 62%, rgba(16,12,9,0.13) 79%, rgba(16,12,9,0.04) 91%, rgba(16,12,9,0) 100%)"></div>
  <div class="layout-container pointer-events-auto relative">
    <div class="flex items-center justify-between h-[68px] md:h-[80px]">
      <div class="flex items-center min-w-0">
      <a aria-label="<?= movy_e($siteName) ?>" class="relative z-10 shrink-0 drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] inline-flex items-center gap-2" href="<?= movy_e(!empty($isAdminPage) ? movy_url('/admin') : movy_url('/')) ?>">
        <span class="site-lockup"><?php $brandName = (string) $siteName; $brandSplit = (bool) preg_match('/flix$/i', $brandName); ?><?php if ($brandSplit): ?><span class="site-lockup-lead"><?= movy_e(substr($brandName, 0, -4)) ?></span><span class="site-lockup-tail"><?= movy_e(substr($brandName, -4)) ?></span><?php else: ?><span class="site-lockup-tail"><?= movy_e($brandName) ?></span><?php endif; ?></span>
      </a>
      <?php if (!empty($isAdminPage)): ?>
        <span class="header-admin-mark<?= movy_e($adminMarkClass ?? '') ?>"><?= movy_e($adminMark ?: 'Admin') ?></span>
      <?php endif; ?>
      </div>

      <!-- Desktop: nav + search + login in ONE cluster (toflix.co) — hidden on mobile -->
      <nav aria-label="Main" class="header-search-cluster control-3d relative hidden md:flex items-center h-10 pl-1 pr-1 rounded-[12px]" id="headerSearchCluster" data-search-open="false">
        <div class="relative h-10 overflow-hidden" id="headerNavWrap" style="width:auto">
          <div class="relative flex items-center gap-0.5 h-10 whitespace-nowrap transition-opacity duration-200" id="headerNavLinks" style="opacity:1">
            <span aria-hidden="true" class="absolute left-0 top-1 h-8 rounded-[8px] bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" data-nav-marker style="transform:translateX(0px);width:0;opacity:0;transition:transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), width 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s"></span>
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('home', $nav) ?>" href="<?= movy_e(movy_url('/')) ?>"<?= $nav === 'home' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="currentColor" height="14" viewBox="0 0 23.6719 22.1631" width="14"><path d="M14.1699 18.938L9.13086 18.938L9.13086 12.4829C9.13086 12.0337 9.43359 11.7407 9.88281 11.7407L13.4277 11.7407C13.877 11.7407 14.1699 12.0337 14.1699 12.4829ZM3.04688 18.3521C3.04688 19.7095 3.86719 20.5103 5.24414 20.5103L18.0859 20.5103C19.4629 20.5103 20.2734 19.7095 20.2734 18.3521L20.2734 10.6177L12.2461 3.88916C11.875 3.57666 11.4355 3.58643 11.0742 3.88916L3.04688 10.6177ZM0 9.64111C0 10.0415 0.3125 10.4224 0.839844 10.4224C1.11328 10.4224 1.33789 10.2759 1.54297 10.1099L11.3184 1.90674C11.5332 1.71143 11.7969 1.71143 12.0117 1.90674L21.7871 10.1099C21.9824 10.2759 22.207 10.4224 22.4805 10.4224C22.9395 10.4224 23.3105 10.1392 23.3105 9.67041C23.3105 9.37744 23.2129 9.18213 23.0078 9.00635L12.8418 0.461426C12.1191-0.153809 11.2207-0.153809 10.4883 0.461426L0.3125 9.00635C0.0976562 9.18213 0 9.4165 0 9.64111ZM17.8223 5.23682L20.2734 7.30713L20.2734 2.79541C20.2734 2.36572 20 2.09229 19.5703 2.09229L18.5254 2.09229C18.1055 2.09229 17.8223 2.36572 17.8223 2.79541Z" fill-opacity="0.85"></path></svg>
              Home
            </a>
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('movie', $nav) ?>" href="<?= movy_e(movy_url('/browse/movie')) ?>"<?= $nav === 'movie' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="currentColor" height="14" viewBox="0 0 23.3887 18.0176" width="14"><path d="M1.98242 18.0176L21.0449 18.0176C22.2559 18.0176 23.0273 17.2461 23.0273 16.0645L23.0273 1.97266C23.0273 0.800781 22.2559 0.0292969 21.0449 0.0292969L1.98242 0.0292969C0.78125 0.0292969 0 0.800781 0 1.97266L0 16.0645C0 17.2461 0.78125 18.0176 1.98242 18.0176ZM1.99219 16.4453C1.67969 16.4453 1.47461 16.2305 1.47461 15.9375L1.47461 14.834C1.47461 14.5605 1.66992 14.3652 1.95312 14.3652L3.21289 14.3652C3.49609 14.3652 3.68164 14.5605 3.68164 14.834L3.68164 15.9668C3.68164 16.2402 3.49609 16.4453 3.21289 16.4453ZM1.95312 13.2129C1.66992 13.2129 1.47461 12.998 1.47461 12.7441L1.47461 11.6309C1.47461 11.3379 1.66016 11.1523 1.95312 11.1523L3.21289 11.1523C3.49609 11.1523 3.68164 11.3379 3.68164 11.6309L3.68164 12.7441C3.68164 12.998 3.49609 13.2129 3.21289 13.2129ZM1.95312 10.0488C1.66992 10.0488 1.47461 9.84375 1.47461 9.58984L1.47461 8.47656C1.47461 8.18359 1.66016 7.99805 1.95312 7.99805L3.21289 7.99805C3.49609 7.99805 3.68164 8.18359 3.68164 8.47656L3.68164 9.58984C3.68164 9.84375 3.49609 10.0488 3.21289 10.0488ZM1.95312 6.91406C1.66992 6.91406 1.47461 6.69922 1.47461 6.45508L1.47461 5.33203C1.47461 5.04883 1.66016 4.85352 1.95312 4.85352L3.21289 4.85352C3.49609 4.85352 3.68164 5.04883 3.68164 5.33203L3.68164 6.45508C3.68164 6.69922 3.49609 6.91406 3.21289 6.91406ZM1.95312 3.68164C1.66992 3.68164 1.47461 3.47656 1.47461 3.22266L1.47461 2.11914C1.47461 1.80664 1.67969 1.60156 1.99219 1.60156L3.21289 1.60156C3.49609 1.60156 3.68164 1.79688 3.68164 2.08008L3.68164 3.22266C3.68164 3.47656 3.49609 3.68164 3.21289 3.68164ZM5.52734 16.4453C5.23438 16.4453 5.05859 16.2695 5.05859 15.9766L5.05859 10.2832C5.05859 10 5.23438 9.82422 5.52734 9.82422L17.5098 9.82422C17.793 9.82422 17.9688 10 17.9688 10.2832L17.9688 15.9766C17.9688 16.2695 17.793 16.4453 17.5098 16.4453ZM5.52734 8.24219C5.23438 8.24219 5.05859 8.07617 5.05859 7.7832L5.05859 2.05078C5.05859 1.75781 5.23438 1.60156 5.52734 1.60156L17.5098 1.60156C17.793 1.60156 17.9688 1.75781 17.9688 2.05078L17.9688 7.7832C17.9688 8.07617 17.793 8.24219 17.5098 8.24219ZM19.8145 16.4453C19.5312 16.4453 19.3457 16.2402 19.3457 15.9668L19.3457 14.834C19.3457 14.5605 19.5312 14.3652 19.8145 14.3652L21.0742 14.3652C21.3672 14.3652 21.5527 14.5605 21.5527 14.834L21.5527 15.9375C21.5527 16.2305 21.3574 16.4453 21.0352 16.4453ZM19.8145 13.2129C19.5312 13.2129 19.3457 12.998 19.3457 12.7441L19.3457 11.6309C19.3457 11.3379 19.5312 11.1523 19.8145 11.1523L21.0742 11.1523C21.3672 11.1523 21.5527 11.3379 21.5527 11.6309L21.5527 12.7441C21.5527 12.998 21.3672 13.2129 21.0742 13.2129ZM19.8145 10.0488C19.5312 10.0488 19.3457 9.84375 19.3457 9.58984L19.3457 8.47656C19.3457 8.18359 19.5312 7.99805 19.8145 7.99805L21.0742 7.99805C21.3672 7.99805 21.5527 8.18359 21.5527 8.47656L21.5527 9.58984C21.5527 9.84375 21.3672 10.0488 21.0742 10.0488ZM19.8145 6.91406C19.5312 6.91406 19.3457 6.69922 19.3457 6.45508L19.3457 5.33203C19.3457 5.04883 19.5312 4.85352 19.8145 4.85352L21.0742 4.85352C21.3672 4.85352 21.5527 5.04883 21.5527 5.33203L21.5527 6.45508C21.5527 6.69922 21.3672 6.91406 21.0742 6.91406ZM19.8145 3.68164C19.5312 3.68164 19.3457 3.47656 19.3457 3.22266L19.3457 2.08008C19.3457 1.79688 19.5312 1.60156 19.8145 1.60156L21.0352 1.60156C21.3574 1.60156 21.5527 1.80664 21.5527 2.11914L21.5527 3.22266C21.5527 3.47656 21.3672 3.68164 21.0742 3.68164Z" fill-opacity="0.85"></path></svg>
              Movies
            </a>
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('tv', $nav) ?>" href="<?= movy_e(movy_url('/browse/tv')) ?>"<?= $nav === 'tv' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="currentColor" height="14" viewBox="0 0 24.7754 19.541" width="14"><path d="M2.50977 16.2207L21.9043 16.2207C23.4668 16.2207 24.4141 15.2637 24.4141 13.7109L24.4141 2.50977C24.4141 0.957031 23.4668 0 21.9043 0L2.50977 0C0.957031 0 0 0.957031 0 2.50977L0 13.7109C0 15.2637 0.957031 16.2207 2.50977 16.2207ZM2.53906 14.6484C1.93359 14.6484 1.57227 14.2871 1.57227 13.6914L1.57227 2.5293C1.57227 1.93359 1.93359 1.57227 2.53906 1.57227L21.875 1.57227C22.4805 1.57227 22.8418 1.93359 22.8418 2.5293L22.8418 13.6914C22.8418 14.2871 22.4805 14.6484 21.875 14.6484ZM7.29492 19.5312L17.1191 19.5312C17.5488 19.5312 17.9102 19.1797 17.9102 18.7402C17.9102 18.3008 17.5488 17.9492 17.1191 17.9492L7.29492 17.9492C6.86523 17.9492 6.50391 18.3008 6.50391 18.7402C6.50391 19.1797 6.86523 19.5312 7.29492 19.5312Z" fill-opacity="0.85"></path></svg>
              Shows
            </a>
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('iptv', $nav) ?>" href="<?= movy_e(movy_url('/iptv')) ?>" data-no-spa="1"<?= $nav === 'iptv' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14"><rect height="14" rx="2" width="20" x="2" y="5"></rect><path d="M8 21h8M12 17v4"></path></svg>
              Live TV
            </a>
            <a class="relative z-[1] inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors duration-200 <?= $active('anime', $nav) ?>" href="<?= movy_e(movy_url('/browse/anime')) ?>"<?= $nav === 'anime' ? ' aria-current="page" data-marker-active="true"' : '' ?>>
              <svg aria-hidden="true" class="shrink-0" fill="currentColor" height="14" viewBox="0 0 22.0527 22.1191" width="14"><path d="M4.16109 20.5469C4.56149 20.8594 5.0693 20.752 5.67477 20.3125L10.8408 16.5137L16.0166 20.3125C16.622 20.752 17.1201 20.8594 17.5302 20.5469C17.9306 20.2441 18.0185 19.7461 17.7744 19.0332L15.7334 12.959L20.9482 9.20898C21.5537 8.7793 21.7978 8.33008 21.6416 7.8418C21.4853 7.37305 21.0263 7.13867 20.2744 7.14844L13.8779 7.1875L11.9345 1.08398C11.7002 0.361328 11.3486 0 10.8408 0C10.3427 0 9.99117 0.361328 9.7568 1.08398L7.81344 7.1875L1.41695 7.14844C0.665001 7.13867 0.206017 7.37305 0.0497668 7.8418C-0.116249 8.33008 0.137657 8.7793 0.743126 9.20898L5.95797 12.959L3.91695 19.0332C3.67281 19.7461 3.7607 20.2441 4.16109 20.5469Z" fill-opacity="0.85"></path></svg>
              Anime
            </a>
          </div>
          <form class="header-inline-search absolute inset-0 flex items-center gap-2 px-2 opacity-0 pointer-events-none" id="headerInlineSearch" action="<?= movy_e(movy_url('/search')) ?>" method="get" autocomplete="off" role="search">
            <svg aria-hidden="true" class="shrink-0 text-white/70" fill="currentColor" height="16" viewBox="0 0 19.4434 19.2676" width="16"><path d="M0 7.79297C0 12.0898 3.49609 15.5859 7.79297 15.5859C9.49219 15.5859 11.0449 15.0391 12.3242 14.1211L17.1289 18.9355C17.3535 19.1602 17.6465 19.2676 17.959 19.2676C18.623 19.2676 19.082 18.7695 19.082 18.1152C19.082 17.8027 18.9648 17.5195 18.7598 17.3145L13.9844 12.5098C14.9902 11.2012 15.5859 9.57031 15.5859 7.79297C15.5859 3.49609 12.0898 0 7.79297 0C3.49609 0 0 3.49609 0 7.79297ZM1.66992 7.79297C1.66992 4.41406 4.41406 1.66992 7.79297 1.66992C11.1719 1.66992 13.916 4.41406 13.916 7.79297C13.916 11.1719 11.1719 13.916 7.79297 13.916C4.41406 13.916 1.66992 11.1719 1.66992 7.79297Z" fill-opacity="0.85"></path></svg>
            <input class="header-inline-search-input min-w-0 flex-1 bg-transparent border-0 outline-none text-[13px] text-white placeholder:text-white/45" id="headerSearchInput" name="q" placeholder="Search movies, shows, and anime" type="search">
          </form>
        </div>
        <span aria-hidden="true" class="w-px h-4 mx-1.5 shrink-0 bg-white/15 transition-opacity duration-200" id="headerNavDivider"></span>
        <button aria-label="Search" aria-expanded="false" class="flex items-center justify-center h-8 w-8 rounded-[8px] text-white/75 hover:text-white hover:bg-white/[0.07] transition-colors duration-200" type="button" id="searchOpen">
          <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 19.4434 19.2676" width="16"><path d="M0 7.79297C0 12.0898 3.49609 15.5859 7.79297 15.5859C9.49219 15.5859 11.0449 15.0391 12.3242 14.1211L17.1289 18.9355C17.3535 19.1602 17.6465 19.2676 17.959 19.2676C18.623 19.2676 19.082 18.7695 19.082 18.1152C19.082 17.8027 18.9648 17.5195 18.7598 17.3145L13.9844 12.5098C14.9902 11.2012 15.5859 9.57031 15.5859 7.79297C15.5859 3.49609 12.0898 0 7.79297 0C3.49609 0 0 3.49609 0 7.79297ZM1.66992 7.79297C1.66992 4.41406 4.41406 1.66992 7.79297 1.66992C11.1719 1.66992 13.916 4.41406 13.916 7.79297C13.916 11.1719 11.1719 13.916 7.79297 13.916C4.41406 13.916 1.66992 11.1719 1.66992 7.79297Z" fill-opacity="0.85"></path></svg>
        </button>
        <div class="relative header-notify-wrap" hidden>
          <a href="<?= movy_e(movy_url('/scan')) ?>" class="header-notify-btn flex items-center justify-center h-8 w-8 rounded-[8px] text-white/75 hover:text-white hover:bg-white/[0.07] transition-colors duration-200" aria-label="Scan QR" title="Scan QR">
            <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="16" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="4" height="4" rx="0.5"/><rect x="13" y="7" width="4" height="4" rx="0.5"/><rect x="7" y="13" width="4" height="4" rx="0.5"/><path d="M13 13h4v4h-4z"/></svg>
          </a>
          <button type="button" aria-label="Notifications" class="header-notify-btn flex items-center justify-center h-8 w-8 rounded-[8px] text-white/75 hover:text-white hover:bg-white/[0.07] transition-colors duration-200" id="notifyOpen">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="16"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            <span class="header-notify-badge" data-notify-badge hidden></span>
          </button>
        </div>
        <div class="relative profile-trigger">
          <button aria-label="Account" class="flex items-center justify-center h-8 w-8 rounded-[8px] text-white/75 hover:text-white hover:bg-white/[0.07] transition-colors duration-200" type="button" id="loginOpen" data-acct-nav-av-wrap>
            <span class="header-acct-av" data-acct-nav-av>
              <svg class="lucide lucide-user-round dock-acct-fallback" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" viewBox="0 0 24 24" width="16"><circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path></svg>
            </span>
            <span class="acct-av-badge" data-notify-badge data-acct-av-badge hidden>0</span>
          </button>
        </div>
        <div class="header-inline-search-live" id="headerSearchLive" hidden></div>
      </nav>
    </div>
  </div>
</header>
<style>#siteHeader.is-scrolled .header-fade{opacity:1}</style>
