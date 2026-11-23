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
    const bubbleW = Math.min(210, Math.max(168, window.innerWidth - 28));
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
      ask.textContent = mobile
        ? 'Tap Account below to open them'
        : 'Open Account to see them';
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
