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
      : pick(loginBtn, notifyBtn, dockBtn);
    notifyToast.style.zIndex = '2147483646';
    notifyToast.style.width = '';
    const panel = notifyToast.querySelector('.notify-sheet-panel');
    const caret = notifyToast.querySelector('.notify-sheet-caret');
    const gap = 10;
    if (!hit) {
      notifyToast.classList.toggle('is-point-up', !!mobile);
      notifyToast.classList.toggle('is-point-down', !mobile);
      if (mobile) {
        notifyToast.style.top = 'auto';
        notifyToast.style.bottom = '92px';
        notifyToast.style.right = '12px';
        notifyToast.style.left = 'auto';
      } else {
        notifyToast.style.top = '64px';
        notifyToast.style.right = '16px';
        notifyToast.style.bottom = 'auto';
        notifyToast.style.left = 'auto';
      }
      if (caret) caret.style.left = '';
      return;
    }
    const box = hit.r;
    const bubbleW = Math.min(222, Math.max(188, window.innerWidth - 28));
    notifyToast.style.width = `${bubbleW}px`;
    // Prefer pointing at Account: sit above dock on mobile, under header account on desktop.
    const pointUp = mobile && box.top > window.innerHeight * 0.45;
    notifyToast.classList.toggle('is-point-up', pointUp);
    notifyToast.classList.toggle('is-point-down', !pointUp);
    if (pointUp) {
      notifyToast.style.top = 'auto';
      notifyToast.style.bottom = `${Math.max(10, Math.round(window.innerHeight - box.top + gap))}px`;
    } else {
      notifyToast.style.top = `${Math.round(box.bottom + gap)}px`;
      notifyToast.style.bottom = 'auto';
    }
    // Align bubble so caret aims at the account control center.
    const idealRight = Math.round(window.innerWidth - box.right + (box.width / 2) - (bubbleW * 0.78));
    const right = Math.max(10, Math.min(window.innerWidth - bubbleW - 10, idealRight));
    notifyToast.style.right = `${right}px`;
    notifyToast.style.left = 'auto';
    if (caret) {
      const anchorX = box.left + box.width / 2;
      const bubbleLeft = window.innerWidth - right - bubbleW;
      const caretLeft = Math.max(18, Math.min(bubbleW - 18, anchorX - bubbleLeft));
      caret.style.left = `${Math.round(caretLeft)}px`;
    }
  };

  const showNotifyToast = (item) => {
    if (!notifyToast || !item) return;
    try {
      if (sessionStorage.getItem('movy_notify_toast_hide_v5') === '1') return;
    } catch (_) { /* ignore */ }
    const headline = notifyToast.querySelector('[data-notify-toast-headline]');
    const ask = notifyToast.querySelector('[data-notify-toast-ask]');
    const mobile = window.innerWidth < 768;
    const unreadN = Array.isArray(notifyItems) ? notifyItems.filter((n) => !n.read).length : 0;
    const n = Math.max(1, unreadN || 1);
    if (headline) {
      headline.textContent = n === 1 ? 'Hey — new notification' : 'Hey — new notifications';
    }
    if (ask) {
      ask.textContent = mobile ? 'Open Account to view' : 'Open Account to view';
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
    const applyPanelLock = (h) => {
      if (!shell || !(h > 0)) return;
      shell.style.setProperty('--acct-panel-h', h + 'px');
      shell.setAttribute('data-acct-panel-h', String(h));
      accountMenu.__acctHomeH = h;
    };
    const measureHomeHeight = () => {
      if (!shell || !home) return 0;
      const prevHomeHidden = home.hidden;
      const prevPanelHidden = panel ? panel.hidden : true;
      const prevNotify = accountMenu.classList.contains('is-notify-view');
      const prevLock = shell.getAttribute('data-acct-panel-h');
      const prevVar = shell.style.getPropertyValue('--acct-panel-h');
      accountMenu.classList.remove('is-notify-view');
      // Measure natural home size (no lock).
      shell.style.removeProperty('--acct-panel-h');
      shell.removeAttribute('data-acct-panel-h');
      home.hidden = false;
      if (panel) panel.hidden = true;
      void shell.offsetHeight;
      const panelH = Math.ceil(shell.getBoundingClientRect().height || 0);
      if (prevNotify) accountMenu.classList.add('is-notify-view');
      home.hidden = prevHomeHidden;
      if (panel) panel.hidden = prevPanelHidden;
      if (prevLock) shell.setAttribute('data-acct-panel-h', prevLock);
      if (prevVar) shell.style.setProperty('--acct-panel-h', prevVar);
      if (panelH > 0) accountMenu.__acctHomeH = panelH;
      return panelH;
    };
    // Always keep one shared window size for home <-> notifications.
    let h = Number(accountMenu.__acctHomeH || 0) || 0;
    if (!(h > 0)) {
      try { h = measureHomeHeight(); } catch (_) { h = 0; }
    }
    applyPanelLock(h);
    accountMenu.classList.toggle('is-notify-view', want);
    if (home) home.hidden = want;
    if (panel) panel.hidden = !want;
    if (!want) notifyOpenId = 0;
  };
