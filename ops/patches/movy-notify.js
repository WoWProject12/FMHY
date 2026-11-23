  const placeNotifyToast = () => {
    if (!notifyToast) return;
    const loginBtn = document.getElementById('loginOpen');
    const dockBtn = document.getElementById('dockLogin') || document.querySelector('[data-dock-account], #dockAccount, .dock-account');
    const notifyBtn = document.getElementById('notifyOpen');
    const mobile = window.innerWidth < 768;
    const pick = (...els) => {
      for (const el of els) {
        if (!el || el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { el, r };
      }
      return null;
    };
    const hit = mobile
      ? pick(dockBtn, loginBtn, notifyBtn)
      : pick(notifyBtn, loginBtn, dockBtn);
    notifyToast.style.zIndex = '2147483646';
    notifyToast.style.width = `${Math.min(260, Math.max(210, window.innerWidth - 24))}px`;
    if (!hit) {
      if (mobile) {
        notifyToast.style.top = 'auto';
        notifyToast.style.bottom = '92px';
        notifyToast.style.right = '12px';
        notifyToast.style.left = 'auto';
      } else {
        notifyToast.style.top = '72px';
        notifyToast.style.right = '18px';
        notifyToast.style.bottom = 'auto';
        notifyToast.style.left = 'auto';
      }
      return;
    }
    const box = hit.r;
    if (mobile && box.top > window.innerHeight * 0.45) {
      const gap = 10;
      notifyToast.style.top = 'auto';
      notifyToast.style.bottom = `${Math.max(12, Math.round(window.innerHeight - box.top + gap))}px`;
      notifyToast.style.right = `${Math.max(10, Math.round(window.innerWidth - box.right))}px`;
      notifyToast.style.left = 'auto';
      return;
    }
    notifyToast.style.top = `${Math.round(box.bottom + 8)}px`;
    notifyToast.style.right = `${Math.max(10, Math.round(window.innerWidth - box.right))}px`;
    notifyToast.style.left = 'auto';
    notifyToast.style.bottom = 'auto';
  };

  const showNotifyToast = (item) => {
    if (!notifyToast || !item) return;
    try {
      if (sessionStorage.getItem('movy_notify_toast_hide_v5') === '1') return;
    } catch (_) { /* ignore */ }
    const title = notifyToast.querySelector('[data-notify-toast-title]');
    const headline = notifyToast.querySelector('[data-notify-toast-headline]');
    const ask = notifyToast.querySelector('[data-notify-toast-ask]');
    const body = notifyToast.querySelector('[data-notify-toast-body]');
    const kindEl = notifyToast.querySelector('[data-notify-toast-kind]');
    const kind = String(item.kind || 'info');
    const itemTitle = String(item.title || 'Site update').trim() || 'Site update';
    if (headline) headline.textContent = 'You have a new notification';
    if (title) title.textContent = itemTitle;
    if (ask) ask.textContent = 'Want to check it out?';
    if (body) {
      body.textContent = '';
      body.hidden = true;
    }
    if (kindEl) {
      kindEl.textContent = kind === 'warning' ? 'Warning' : kind === 'update' ? 'Update' : 'Info';
      kindEl.classList.remove('is-warning', 'is-info', 'is-update');
      kindEl.classList.add(kind === 'warning' ? 'is-warning' : kind === 'update' ? 'is-update' : 'is-info');
    }
    notifyToast.style.zIndex = '2147483646';
    try { placeNotifyToast(); } catch (_) {}
    notifyToast.hidden = false;
    requestAnimationFrame(() => {
      try { placeNotifyToast(); } catch (_) {}
      notifyToast.classList.add('is-on');
      try {
        const id = Number(item.id || window.__movyNotifyPendingToastId || 0) || 0;
        if (id > 0) localStorage.setItem(NOTIFY_TOAST_KEY, String(id));
        window.__movyNotifyPendingToastId = 0;
      } catch (_) { /* ignore */ }
    });
  };

  const showAcctNotifyView = (on) => {
    if (!accountMenu) return;
    const want = !!on;
    const shell = accountMenu.querySelector('.acct-menu-panel');
    const home = accountMenu.querySelector('[data-acct-home]');
    const panel = accountMenu.querySelector('[data-acct-notify-panel]');
    const lockToHomeHeight = () => {
      if (!shell || !home) return;
      const prevHomeHidden = home.hidden;
      const prevPanelHidden = panel ? panel.hidden : true;
      const prevNotify = accountMenu.classList.contains('is-notify-view');
      accountMenu.classList.remove('is-notify-view');
      home.hidden = false;
      if (panel) panel.hidden = true;
      void shell.offsetHeight;
      const panelH = Math.round(shell.getBoundingClientRect().height || 0);
      if (panelH > 0) {
        shell.style.setProperty('--acct-panel-h', panelH + 'px');
        shell.setAttribute('data-acct-panel-h', String(panelH));
        accountMenu.__acctHomeH = panelH;
      }
      if (prevNotify) accountMenu.classList.add('is-notify-view');
      home.hidden = prevHomeHidden;
      if (panel) panel.hidden = prevPanelHidden;
    };
    if (want) {
      const cached = Number(accountMenu.__acctHomeH || 0) || 0;
      if (cached > 0 && shell) {
        shell.style.setProperty('--acct-panel-h', cached + 'px');
        shell.setAttribute('data-acct-panel-h', String(cached));
      } else {
        try { lockToHomeHeight(); } catch (_) {}
      }
    }
    accountMenu.classList.toggle('is-notify-view', want);
    if (home) home.hidden = want;
    if (panel) panel.hidden = !want;
    if (!want) {
      notifyOpenId = 0;
      const cached = Number(accountMenu.__acctHomeH || (shell && shell.getAttribute('data-acct-panel-h')) || 0) || 0;
      if (cached > 0 && shell) {
        shell.style.setProperty('--acct-panel-h', cached + 'px');
        shell.setAttribute('data-acct-panel-h', String(cached));
      }
    }
  };

  const openNotifyInbox = () => {
    setNotifyNudge(false);
    hideNotifyToast();
    try { sessionStorage.setItem('movy_notify_toast_hide_v5', '1'); } catch (_) {}
    if (!accountMenu) return;
    const alreadyOpen = accountMenu.classList.contains('is-open');
    if (!alreadyOpen) {
      accountMenu.classList.remove('is-notify-view');
      const home = accountMenu.querySelector('[data-acct-home]');
      const panel = accountMenu.querySelector('[data-acct-notify-panel]');
      if (home) home.hidden = false;
      if (panel) panel.hidden = true;
      openAccountMenu();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          showAcctNotifyView(true);
          refreshNotifications();
        });
      });
      return;
    }
    showAcctNotifyView(true);
    refreshNotifications();
  };
