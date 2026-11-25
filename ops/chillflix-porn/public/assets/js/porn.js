(function () {
  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  function isNarrow() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch (e) {
      return window.innerWidth <= 900;
    }
  }

  function clearMenuPosition(menu) {
    menu.style.position = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.top = "";
    menu.style.bottom = "";
    menu.style.width = "";
    menu.style.maxWidth = "";
    menu.style.maxHeight = "";
  }

  /** Always open directly under the clicked button (never a distant bottom sheet). */
  function placeMenu(dd, menu) {
    clearMenuPosition(menu);
    var btn = dd.querySelector(".cfp-dd-btn");
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var gap = 6;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var pad = 10;
    var dock = isNarrow() ? 64 : 12;
    var spaceBelow = Math.max(120, vh - rect.bottom - gap - dock);
    var menuWidth = isNarrow()
      ? Math.min(vw - pad * 2, Math.max(rect.width, 260))
      : Math.max(220, Math.min(320, vw - pad * 2));
    var left = rect.left;
    if (isNarrow()) {
      left = Math.max(pad, Math.min(left, vw - menuWidth - pad));
    } else if (left + menuWidth > vw - pad) {
      left = Math.max(pad, vw - menuWidth - pad);
    }
    var maxH = Math.min(isNarrow() ? 280 : 360, spaceBelow);
    menu.style.position = "fixed";
    menu.style.left = Math.round(left) + "px";
    menu.style.right = "auto";
    menu.style.top = Math.round(rect.bottom + gap) + "px";
    menu.style.bottom = "auto";
    menu.style.width = Math.round(menuWidth) + "px";
    menu.style.maxWidth = "calc(100vw - 20px)";
    menu.style.maxHeight = Math.round(maxH) + "px";
  }

  function setMenuOpen(dd, open) {
    var btn = dd.querySelector(".cfp-dd-btn");
    var menu = dd.querySelector(".cfp-dd-menu");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!menu) return;
    if (open) {
      menu.hidden = false;
      menu.classList.add("is-open");
      placeMenu(dd, menu);
    } else {
      menu.classList.remove("is-open");
      menu.hidden = true;
      clearMenuPosition(menu);
    }
  }

  function closeAllMenus(except) {
    document.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      if (except && dd === except) return;
      setMenuOpen(dd, false);
    });
  }

  function initDropdown(dd) {
    var btn = dd.querySelector(".cfp-dd-btn");
    var menu = dd.querySelector(".cfp-dd-menu");
    if (!btn || !menu) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var willOpen = !menu.classList.contains("is-open");
      closeAllMenus(willOpen ? dd : null);
      setMenuOpen(dd, willOpen);
      if (willOpen) {
        var filter = menu.querySelector("[data-cfp-dd-filter]");
        var list = menu.querySelector(".cfp-dd-list");
        if (filter) {
          filter.value = "";
          filter.dispatchEvent(new Event("input"));
        }
        if (list) list.scrollTop = 0;
        if (filter && window.matchMedia("(pointer: fine)").matches) {
          setTimeout(function () {
            try { filter.focus(); } catch (err) {}
          }, 0);
        }
      }
    });

    menu.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    var filter = menu.querySelector("[data-cfp-dd-filter]");
    if (filter) {
      filter.addEventListener("input", function () {
        var q = (filter.value || "").toLowerCase().trim();
        menu.querySelectorAll(".cfp-dd-option, .cfp-cat-row").forEach(function (opt) {
          var label = (opt.getAttribute("data-label") || opt.textContent || "").toLowerCase();
          opt.hidden = q !== "" && label.indexOf(q) === -1;
        });
      });
    }
  }

  function initToolbar(form) {
    form.querySelectorAll("[data-cfp-dd]").forEach(initDropdown);

    form.addEventListener("click", function (e) {
      var opt = closest(e.target, "[data-cfp-set]");
      if (!opt || !form.contains(opt)) return;
      e.preventDefault();
      e.stopPropagation();
      var field = opt.getAttribute("data-cfp-set");
      var value = opt.getAttribute("data-value");
      if (value === null) value = "";
      var input = form.querySelector('[data-cfp-field="' + field + '"]');
      if (input) input.value = value;
      closeAllMenus();
      if (form.requestSubmit) form.requestSubmit();
      else form.submit();
    });
  }

  function syncHeaderHeight() {
    var header = document.getElementById("siteHeader") || document.querySelector(".cfp-header");
    if (!header) return;
    var h = Math.ceil(header.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty("--cfp-header-h", h + "px");
    }
  }
  syncHeaderHeight();
  window.addEventListener("load", syncHeaderHeight);
  if (window.ResizeObserver) {
    var headerEl = document.getElementById("siteHeader") || document.querySelector(".cfp-header");
    if (headerEl) {
      try {
        new ResizeObserver(syncHeaderHeight).observe(headerEl);
      } catch (err) {}
    }
  }

  document.querySelectorAll("[data-cfp-toolbar]").forEach(initToolbar);
  document.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
    if (!closest(dd, "[data-cfp-toolbar]")) initDropdown(dd);
  });

  document.addEventListener("click", function (e) {
    if (closest(e.target, ".cfp-dd-menu.is-open, .cfp-dd-btn")) return;
    closeAllMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllMenus();
  });
  window.addEventListener("resize", function () {
    syncHeaderHeight();
    document.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      var menu = dd.querySelector(".cfp-dd-menu.is-open");
      if (menu) placeMenu(dd, menu);
    });
  });

  // Categories page live filter
  var catFilter = document.querySelector("[data-cfp-cats-filter]");
  if (catFilter) {
    catFilter.addEventListener("input", function () {
      var q = (catFilter.value || "").toLowerCase().trim();
      document.querySelectorAll("[data-cfp-cat-letter]").forEach(function (section) {
        var visible = 0;
        section.querySelectorAll(".cfp-cat-row").forEach(function (row) {
          var label = (row.getAttribute("data-label") || row.textContent || "").toLowerCase();
          var hide = q !== "" && label.indexOf(q) === -1;
          row.hidden = hide;
          if (!hide) visible++;
        });
        section.hidden = visible === 0;
      });
    });
  }

  // xvideos-style preview: play ~2.5s of real video at 8 different parts, then jump.
  // Touch rule: once a hold-preview starts, it keeps playing even if the finger
  // leaves the card or lifts — stop only on feed scroll or a new tap.
  var activePreview = null;
  var previewTimer = null;
  var previewUrlCache = Object.create(null);
  var streamInflight = Object.create(null);
  var segmentTimer = null;
  var scrubResumeTimer = null;
  var scrubbing = false;
  var holdScrollY = 0;
  var partGen = 0;
  var holdFingerDown = false;
  var holdCard = null;
  var stickyPreview = false; // touch preview survives finger leave / lift
  var isCoarse = false;
  try {
    isCoarse = window.matchMedia("(pointer: coarse)").matches;
  } catch (e) {}

  // 8 parts across the movie; play each for ~2.5s like xvideos trailers
  var PART_FRACS = [0.05, 0.17, 0.29, 0.41, 0.53, 0.65, 0.77, 0.89];
  var PART_HOLD_MS = 2500;

  function cardHref(card) {
    return card.getAttribute("data-href") || card.getAttribute("href") || "";
  }

  function openCard(card) {
    var href = cardHref(card);
    if (href) window.location.href = href;
  }

  function clearTours() {
    partGen += 1;
    if (segmentTimer) {
      clearTimeout(segmentTimer);
      segmentTimer = null;
    }
    if (scrubResumeTimer) {
      clearTimeout(scrubResumeTimer);
      scrubResumeTimer = null;
    }
    scrubbing = false;
  }

  function stopPreview(card) {
    if (!card) return;
    clearTours();
    card.classList.remove("is-previewing", "is-preview-loading", "is-scrubbing");
    var vid = card.querySelector(".cfp-card-preview");
    if (vid) {
      try { vid.pause(); } catch (e) {}
      try {
        vid.removeAttribute("src");
        vid.removeAttribute("data-src");
        vid.load();
      } catch (e2) {}
      vid.hidden = true;
      vid.style.opacity = "";
    }
    if (activePreview === card) activePreview = null;
    if (holdCard === card) holdCard = null;
    stickyPreview = false;
    holdFingerDown = false;
  }

  function ensurePreviewVideo(media) {
    var vid = media.querySelector(".cfp-card-preview");
    if (vid) return vid;
    vid = document.createElement("video");
    vid.className = "cfp-card-preview";
    vid.muted = true;
    vid.defaultMuted = true;
    vid.volume = 0;
    vid.playsInline = true;
    vid.loop = false;
    vid.preload = "auto";
    vid.controls = false;
    vid.disablePictureInPicture = true;
    vid.setAttribute("muted", "");
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
    vid.setAttribute("disablepictureinpicture", "");
    vid.setAttribute("referrerpolicy", "no-referrer");
    vid.referrerPolicy = "no-referrer";
    vid.hidden = true;
    media.appendChild(vid);
    return vid;
  }

  function previewProxyUrl(id) {
    return "/porn/api/preview?id=" + encodeURIComponent(id);
  }

  function resolveStreamUrl(id) {
    if (!id) return Promise.resolve("");
    if (previewUrlCache[id]) return Promise.resolve(previewUrlCache[id]);
    if (streamInflight[id]) return streamInflight[id];
    streamInflight[id] = fetch("/porn/api/stream?id=" + encodeURIComponent(id), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        delete streamInflight[id];
        if (!data || !data.ok || !data.streams) return "";
        var url = data.streams.low || data.streams.high || "";
        if (url) previewUrlCache[id] = url;
        return url;
      })
      .catch(function () {
        delete streamInflight[id];
        return "";
      });
    return streamInflight[id];
  }

  function seekSafe(vid, t) {
    try {
      if (!isFinite(vid.duration) || vid.duration < 1) return false;
      var target = Math.max(0.05, Math.min(t, Math.max(0.1, vid.duration - 0.35)));
      vid.currentTime = target;
      return true;
    } catch (e) {
      return false;
    }
  }

  function revealVideo(card, vid) {
    if (activePreview !== card) return;
    if (!(vid.videoWidth > 0) && vid.readyState < 2) return;
    vid.hidden = false;
    vid.style.opacity = "1";
    card.classList.remove("is-preview-loading");
    card.classList.add("is-previewing");
  }

  /**
   * Play ~2.5s at part idx, then jump to the next part (xvideos trailer style).
   * Waits for seeked so each scene actually plays motion, not a still.
   */
  function playPart(card, vid, idx, gen) {
    if (activePreview !== card || gen !== partGen || scrubbing) return;
    if (!isFinite(vid.duration) || vid.duration < 2) {
      try { vid.loop = true; vid.play(); } catch (e) {}
      return;
    }
    vid.loop = false;
    var i = ((idx % PART_FRACS.length) + PART_FRACS.length) % PART_FRACS.length;
    card.__cfpPartIdx = i;
    var done = false;

    var afterSeek = function () {
      if (done) return;
      done = true;
      vid.removeEventListener("seeked", afterSeek);
      if (activePreview !== card || gen !== partGen) return;
      revealVideo(card, vid);
      var p = vid.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      if (segmentTimer) clearTimeout(segmentTimer);
      segmentTimer = setTimeout(function () {
        if (activePreview !== card || gen !== partGen || scrubbing) return;
        playPart(card, vid, i + 1, gen);
      }, PART_HOLD_MS);
    };

    vid.addEventListener("seeked", afterSeek);
    if (!seekSafe(vid, vid.duration * PART_FRACS[i])) {
      afterSeek();
      return;
    }
    // Fallback if seeked doesn't fire (already at target / stalled)
    segmentTimer = setTimeout(function () {
      if (activePreview !== card || gen !== partGen) return;
      afterSeek();
    }, 700);
  }

  function startSegmentTour(card, vid) {
    clearTours();
    if (!vid || activePreview !== card) return;
    var gen = partGen;
    var go = function () {
      if (activePreview !== card || gen !== partGen) return;
      playPart(card, vid, 0, gen);
    };
    if (isFinite(vid.duration) && vid.duration > 0) go();
    else {
      vid.addEventListener("loadedmetadata", function onMeta() {
        vid.removeEventListener("loadedmetadata", onMeta);
        go();
      });
    }
  }

  function scrubPreview(card, clientX) {
    var media = card.querySelector(".cfp-card-media");
    var vid = card.querySelector(".cfp-card-preview");
    if (!media || !vid || !isFinite(vid.duration) || vid.duration < 1) return;
    scrubbing = true;
    card.classList.add("is-scrubbing");
    if (segmentTimer) {
      clearTimeout(segmentTimer);
      segmentTimer = null;
    }
    var rect = media.getBoundingClientRect();
    var ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    ratio = Math.max(0, Math.min(0.999, ratio));
    // Snap to nearest of the 8 parts while scrubbing
    var idx = Math.min(PART_FRACS.length - 1, Math.floor(ratio * PART_FRACS.length));
    card.__cfpPartIdx = idx;
    seekSafe(vid, vid.duration * PART_FRACS[idx]);
    if (vid.paused) {
      try { vid.play(); } catch (e) {}
    }
    revealVideo(card, vid);

    if (scrubResumeTimer) clearTimeout(scrubResumeTimer);
    scrubResumeTimer = setTimeout(function () {
      scrubbing = false;
      card.classList.remove("is-scrubbing");
      if (activePreview === card) {
        playPart(card, vid, idx + 1, partGen);
      }
    }, 500);
  }

  function playPreview(card, url) {
    if (!url || activePreview !== card) return;
    var media = card.querySelector(".cfp-card-media");
    if (!media) return;
    var vid = ensurePreviewVideo(media);

    card.classList.add("is-preview-loading");
    card.classList.remove("is-previewing");
    vid.hidden = false;
    vid.style.opacity = "0";

    var kickTour = function () {
      if (activePreview !== card) return;
      revealVideo(card, vid);
      if (!scrubbing) startSegmentTour(card, vid);
    };

    vid.onplaying = function () { revealVideo(card, vid); };
    vid.onloadeddata = function () { revealVideo(card, vid); };

    var tryPlay = function (src, allowFallback) {
      if (activePreview !== card) return;
      if (vid.getAttribute("data-src") !== src) {
        vid.setAttribute("data-src", src);
        vid.src = src;
      }
      vid.muted = true;
      vid.defaultMuted = true;
      vid.volume = 0;
      var p = vid.play();
      if (p && typeof p.then === "function") {
        p.then(kickTour).catch(function () {
          if (activePreview !== card) return;
          if (!allowFallback) {
            card.classList.remove("is-preview-loading", "is-previewing");
            vid.hidden = true;
            return;
          }
          tryPlay(previewProxyUrl(card.getAttribute("data-video-id") || ""), false);
        });
      } else {
        kickTour();
      }
    };

    tryPlay(url, true);
  }

  function startPreview(card) {
    var id = card.getAttribute("data-video-id") || "";
    if (!id) return;
    if (activePreview && activePreview !== card) stopPreview(activePreview);
    activePreview = card;
    scrubbing = false;
    card.classList.add("is-preview-loading");
    card.classList.remove("is-scrubbing");

    resolveStreamUrl(id).then(function (url) {
      if (activePreview !== card) return;
      playPreview(card, url || previewProxyUrl(id));
    });
  }

  function bindCardPreview(card) {
    if (!card.getAttribute("data-video-id") && !cardHref(card)) return;

    var blockMenu = function (e) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    card.addEventListener("contextmenu", blockMenu, true);
    card.setAttribute("draggable", "false");

    card.addEventListener("click", function (e) {
      if (card.__cfpSuppressClick) {
        e.preventDefault();
        e.stopPropagation();
        card.__cfpSuppressClick = false;
        return;
      }
      if (cardHref(card)) openCard(card);
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCard(card);
      }
    });

    // Hover preview — desktop only. On phones, mouseleave is fake and kills touch previews.
    if (!isCoarse) {
      card.addEventListener("mouseenter", function () {
        if (stickyPreview || holdFingerDown) return;
        clearTimeout(previewTimer);
        resolveStreamUrl(card.getAttribute("data-video-id") || "");
        previewTimer = setTimeout(function () { startPreview(card); }, 100);
      });
      card.addEventListener("mouseleave", function () {
        if (stickyPreview || holdFingerDown) return;
        clearTimeout(previewTimer);
        stopPreview(card);
      });
    }

    var touchTimer = null;
    var startX = 0;
    var startY = 0;
    var previewArmed = false;
    var fingerMoved = false;
    var id = card.getAttribute("data-video-id") || "";

    function detachDocHold() {
      document.removeEventListener("touchmove", onDocTouchMove, true);
      document.removeEventListener("touchend", onDocTouchEnd, true);
      document.removeEventListener("touchcancel", onDocTouchEnd, true);
    }

    function releaseFingerKeepPreview() {
      // Finger left / lifted — preview STAYS playing (sticky).
      clearTimeout(touchTimer);
      holdFingerDown = false;
      detachDocHold();
      card.__cfpSuppressClick = true;
      setTimeout(function () { card.__cfpSuppressClick = false; }, 500);
    }

    function onDocTouchMove(e) {
      if (holdCard !== card) return;
      if (!e.touches || !e.touches[0]) return;
      var adx = Math.abs(e.touches[0].clientX - startX);
      var ady = Math.abs(e.touches[0].clientY - startY);
      if (adx > 12 || ady > 12) fingerMoved = true;
      if (!previewArmed && ady > 50 && ady > adx * 1.15) {
        clearTimeout(touchTimer);
      }
      // Never stop preview here.
    }

    function onDocTouchEnd(e) {
      if (holdCard !== card) return;
      if (e.type === "touchend" && e.touches && e.touches.length > 0) return;

      clearTimeout(touchTimer);

      if (previewArmed || stickyPreview || activePreview === card) {
        // Preview already running (or about to): keep it. Moving/lifting must NOT cut it.
        stickyPreview = true;
        previewArmed = true;
        releaseFingerKeepPreview();
        return;
      }

      // Hold never engaged — just clean up
      holdFingerDown = false;
      holdCard = null;
      detachDocHold();
    }

    card.addEventListener("touchstart", function (e) {
      if (!e.touches || !e.touches[0]) return;

      // New gesture while a sticky preview is on another card → stop that one
      if (activePreview && activePreview !== card) {
        stopPreview(activePreview);
      }

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      holdScrollY = window.scrollY || window.pageYOffset || 0;
      previewArmed = false;
      fingerMoved = false;
      holdFingerDown = true;
      holdCard = card;
      scrubbing = false;
      card.__cfpSuppressClick = false;
      clearTimeout(touchTimer);
      detachDocHold();
      document.addEventListener("touchmove", onDocTouchMove, { passive: true, capture: true });
      document.addEventListener("touchend", onDocTouchEnd, { passive: true, capture: true });
      document.addEventListener("touchcancel", onDocTouchEnd, { passive: true, capture: true });
      resolveStreamUrl(id);
      touchTimer = setTimeout(function () {
        if (holdCard !== card) return;
        previewArmed = true;
        stickyPreview = true;
        card.__cfpSuppressClick = true;
        startPreview(card);
      }, 150);
    }, { passive: true });
  }

  document.addEventListener("contextmenu", function (e) {
    if (e.target && e.target.closest && e.target.closest(".cfp-card, .cfp-rail-card")) {
      e.preventDefault();
    }
  }, true);

  // Scroll the feed → stop sticky preview
  window.addEventListener("scroll", function () {
    if (!activePreview) return;
    var scrollY = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(scrollY - holdScrollY) < 50) return;
    stopPreview(activePreview);
  }, { passive: true });

  // Tap anywhere (new gesture) while sticky preview is running → stop
  document.addEventListener("touchstart", function (e) {
    if (!stickyPreview || !activePreview || holdFingerDown) return;
    stopPreview(activePreview);
  }, { passive: true, capture: true });

  document.querySelectorAll(".cfp-card[data-video-id], .cfp-rail-card[data-video-id]").forEach(bindCardPreview);

  // YouTube-style vote / share bar
  (function initActions() {
    var bar = document.querySelector("[data-cfp-actions]");
    if (!bar) return;
    var vid = bar.getAttribute("data-video-id") || "";
    function fmt(n) {
      n = Number(n) || 0;
      if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M";
      if (n >= 1000) return (Math.round(n / 100) / 10) + "K";
      return String(n);
    }
    function paint(state) {
      var likes = bar.querySelector("[data-cfp-likes]");
      var dislikes = bar.querySelector("[data-cfp-dislikes]");
      if (likes) likes.textContent = fmt(state.likes);
      if (dislikes) dislikes.textContent = fmt(state.dislikes);
      bar.querySelectorAll("[data-cfp-vote]").forEach(function (btn) {
        var v = parseInt(btn.getAttribute("data-cfp-vote") || "0", 10);
        var on = v === state.mine;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      bar.setAttribute("data-mine", String(state.mine || 0));
    }
    bar.addEventListener("click", function (e) {
      var voteBtn = closest(e.target, "[data-cfp-vote]");
      if (voteBtn) {
        e.preventDefault();
        var next = parseInt(voteBtn.getAttribute("data-cfp-vote") || "0", 10);
        var cur = parseInt(bar.getAttribute("data-mine") || "0", 10);
        if (next === cur) next = 0;
        // Optimistic UI, then sync (GET — Cloudflare often challenges POSTs)
        var likesEl = bar.querySelector("[data-cfp-likes]");
        var dislikesEl = bar.querySelector("[data-cfp-dislikes]");
        var likesN = parseInt((likesEl && likesEl.textContent) || "0", 10) || 0;
        var dislikesN = parseInt((dislikesEl && dislikesEl.textContent) || "0", 10) || 0;
        // crude parse for K/M display back to approx int is skipped — use data attrs
        likesN = parseInt(bar.getAttribute("data-likes") || String(likesN), 10) || 0;
        dislikesN = parseInt(bar.getAttribute("data-dislikes") || String(dislikesN), 10) || 0;
        if (cur === 1) likesN = Math.max(0, likesN - 1);
        if (cur === -1) dislikesN = Math.max(0, dislikesN - 1);
        if (next === 1) likesN += 1;
        if (next === -1) dislikesN += 1;
        bar.setAttribute("data-likes", String(likesN));
        bar.setAttribute("data-dislikes", String(dislikesN));
        paint({ likes: likesN, dislikes: dislikesN, mine: next });

        var voteUrl = "/porn/api/vote?id=" + encodeURIComponent(vid) + "&vote=" + encodeURIComponent(String(next));
        fetch(voteUrl, {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        })
          .then(function (r) {
            if (!r.ok) throw new Error("vote " + r.status);
            return r.json();
          })
          .then(function (data) {
            if (data && data.ok) {
              bar.setAttribute("data-likes", String(data.likes));
              bar.setAttribute("data-dislikes", String(data.dislikes));
              paint(data);
            }
          })
          .catch(function () {});
        return;
      }
      var shareBtn = closest(e.target, "[data-cfp-share]");
      if (shareBtn) {
        e.preventDefault();
        var url = window.location.href;
        var label = shareBtn.querySelector("span:last-child");
        if (navigator.share) {
          navigator.share({ title: document.title, url: url }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            if (label) {
              label.textContent = "Copied";
              setTimeout(function () { label.textContent = "Share"; }, 1400);
            }
          }).catch(function () {});
        }
        return;
      }
      var saveBtn = closest(e.target, "[data-cfp-save]");
      if (saveBtn) {
        e.preventDefault();
        var key = "cfp_saved";
        var list = [];
        try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch (err) { list = []; }
        if (!Array.isArray(list)) list = [];
        var id = bar.getAttribute("data-video-id") || "";
        var idx = list.indexOf(id);
        var on = idx === -1;
        if (on) list.push(id);
        else list.splice(idx, 1);
        try { localStorage.setItem(key, JSON.stringify(list)); } catch (err2) {}
        saveBtn.classList.toggle("is-on", on);
        saveBtn.setAttribute("aria-pressed", on ? "true" : "false");
        var sl = saveBtn.querySelector("[data-cfp-save-label]");
        if (sl) sl.textContent = on ? "Saved" : "Save";
      }
    });
    // hydrate save state
    try {
      var saved = JSON.parse(localStorage.getItem("cfp_saved") || "[]");
      var saveBtn0 = bar.querySelector("[data-cfp-save]");
      if (saveBtn0 && Array.isArray(saved) && saved.indexOf(bar.getAttribute("data-video-id") || "") !== -1) {
        saveBtn0.classList.add("is-on");
        saveBtn0.setAttribute("aria-pressed", "true");
        var sl0 = saveBtn0.querySelector("[data-cfp-save-label]");
        if (sl0) sl0.textContent = "Saved";
      }
    } catch (err3) {}
  })();

  // Full player (watch page) — MP4 + HLS ladder (480p/720p/1080p/2K/4K)
  var root = document.querySelector(".cfp-player");
  if (!root) return;
  var videoId = root.getAttribute("data-video-id") || "";
  var video = document.getElementById("cfpPlayer");
  var status = document.getElementById("cfpPlayerStatus");
  var qualityOpts = document.querySelector("#cfpQualityMenu .cfp-quality-opts") || document.getElementById("cfpQuality");
  var gearBtn = document.getElementById("cfpGearBtn");
  var gearLabel = document.getElementById("cfpGearLabel");
  var qualityMenu = document.getElementById("cfpQualityMenu");
  var downloadBtn = document.getElementById("cfpDownload");
  if (!videoId || !video) return;

  function setGearOpen(open) {
    if (!gearBtn || !qualityMenu) return;
    gearBtn.setAttribute("aria-expanded", open ? "true" : "false");
    qualityMenu.hidden = !open;
  }
  if (gearBtn) {
    gearBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setGearOpen(!!(qualityMenu && qualityMenu.hidden));
    });
  }
  document.addEventListener("click", function (e) {
    if (!qualityMenu || qualityMenu.hidden) return;
    if (closest(e.target, ".cfp-player-gear")) return;
    setGearOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setGearOpen(false);
  });

  function setStatus(msg, ready) {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("is-ready", !!ready);
  }

  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("controls", "");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.referrerPolicy = "no-referrer";

  var proxyUrl = "/porn/api/preview?id=" + encodeURIComponent(videoId);
  var qualities = []; // [{id,label,url,type,height}]
  var activeQ = "";
  var loadGen = 0;
  var failFallback = false;
  var hls = null;
  var canNativeHls = false;
  try {
    canNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
  } catch (e0) {}

  function destroyHls() {
    if (hls) {
      try { hls.destroy(); } catch (e1) {}
      hls = null;
    }
  }

  function tryPlay() {
    var p = video.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        setStatus("Tap play to start", false);
      });
    }
  }

  var titleQuality = document.getElementById("cfpTitleQuality");

  function setTitleQualityLabel(label) {
    if (!titleQuality) return;
    if (!label) {
      titleQuality.hidden = true;
      titleQuality.textContent = "";
      return;
    }
    titleQuality.textContent = label;
    titleQuality.hidden = false;
  }

  function markQuality(id) {
    activeQ = id;
    if (qualityOpts) {
      qualityOpts.querySelectorAll("button").forEach(function (btn) {
        btn.classList.toggle("is-on", btn.getAttribute("data-q") === id);
      });
    }
    var on = qualities.find(function (q) { return q.id === id; });
    if (on) {
      setTitleQualityLabel(on.label);
      if (gearLabel) gearLabel.textContent = on.label;
      if (downloadBtn && on.type !== "hls") {
        downloadBtn.hidden = false;
        downloadBtn.href = on.url;
      } else if (downloadBtn) {
        // Prefer any mp4 for download
        var mp4 = qualities.find(function (q) { return q.type !== "hls"; });
        if (mp4) {
          downloadBtn.hidden = false;
          downloadBtn.href = mp4.url;
        }
      }
    }
  }

  function playMp4(url, id, seekTo, wasPlaying) {
    destroyHls();
    var my = ++loadGen;
    failFallback = false;
    markQuality(id);
    setStatus("Loading…");
    video.referrerPolicy = "no-referrer";
    video.src = url;
    try { video.load(); } catch (e) {}
    var onMeta = function () {
      video.removeEventListener("loadedmetadata", onMeta);
      if (my !== loadGen) return;
      if (seekTo && isFinite(seekTo) && seekTo > 0.5) {
        try { video.currentTime = seekTo; } catch (e2) {}
      }
      if (wasPlaying !== false) tryPlay();
      setStatus("", true);
    };
    video.addEventListener("loadedmetadata", onMeta);
    setTimeout(function () {
      if (my === loadGen && video.readyState < 1) tryPlay();
    }, 40);
  }

  function playHls(url, id, seekTo, wasPlaying) {
    var my = ++loadGen;
    failFallback = false;
    markQuality(id);
    setStatus("Loading…");
    destroyHls();

    if (canNativeHls) {
      video.src = url;
      try { video.load(); } catch (e3) {}
      var onMeta = function () {
        video.removeEventListener("loadedmetadata", onMeta);
        if (my !== loadGen) return;
        if (seekTo && isFinite(seekTo) && seekTo > 0.5) {
          try { video.currentTime = seekTo; } catch (e4) {}
        }
        if (wasPlaying !== false) tryPlay();
        setStatus("", true);
      };
      video.addEventListener("loadedmetadata", onMeta);
      return;
    }

    if (!window.Hls || !window.Hls.isSupported()) {
      // Fall back to any mp4 quality
      var mp4 = qualities.find(function (q) { return q.type !== "hls"; });
      if (mp4) {
        playMp4(mp4.url, mp4.id, seekTo, wasPlaying);
        return;
      }
      playMp4(proxyUrl, "proxy", seekTo, wasPlaying);
      return;
    }

    hls = new window.Hls({
      enableWorker: true,
      maxBufferLength: 30,
      xhrSetup: function (xhr) {
        try { xhr.withCredentials = false; } catch (e5) {}
      },
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
      if (my !== loadGen) return;
      if (seekTo && isFinite(seekTo) && seekTo > 0.5) {
        try { video.currentTime = seekTo; } catch (e6) {}
      }
      if (wasPlaying !== false) tryPlay();
      setStatus("", true);
    });
    hls.on(window.Hls.Events.ERROR, function (_ev, data) {
      if (!data || !data.fatal || my !== loadGen) return;
      destroyHls();
      var mp4 = qualities.find(function (q) { return q.type !== "hls" && q.id !== activeQ; });
      if (mp4) playMp4(mp4.url, mp4.id, video.currentTime || 0, true);
      else playMp4(proxyUrl, "proxy", video.currentTime || 0, true);
    });
  }

  function playSource(q, seekTo, wasPlaying) {
    if (!q) return;
    if (q.type === "hls") playHls(q.url, q.id, seekTo, wasPlaying);
    else playMp4(q.url, q.id, seekTo, wasPlaying);
  }

  function buildQualityUi(streams) {
    qualities = [];
    var ladder = Array.isArray(streams.qualities) ? streams.qualities.slice() : [];
    ladder.forEach(function (q) {
      if (!q || !q.url) return;
      qualities.push({
        id: String(q.id || q.label || "hls"),
        label: String(q.label || "HLS"),
        url: String(q.url),
        type: "hls",
        height: Number(q.height) || 0,
      });
    });
    // Progressive MP4 only when that height isn't already in the HLS ladder
    var haveH = Object.create(null);
    qualities.forEach(function (q) {
      if (q.height > 0) haveH[q.height] = true;
    });
    if (streams.low && !haveH[240]) {
      qualities.push({ id: "mp4-low", label: "240p", url: streams.low, type: "mp4", height: 240 });
    }
    if (streams.high && !haveH[360]) {
      qualities.push({ id: "mp4-high", label: "360p", url: streams.high, type: "mp4", height: 360 });
    }
    qualities.sort(function (a, b) {
      return (a.height || 0) - (b.height || 0);
    });

    if (!qualityOpts || qualities.length < 1) {
      if (gearBtn) gearBtn.hidden = true;
      setGearOpen(false);
      return;
    }
    qualityOpts.innerHTML = "";
    qualities.slice().reverse().forEach(function (q) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cfp-quality-btn";
      btn.setAttribute("data-q", q.id);
      btn.setAttribute("role", "menuitemradio");
      btn.textContent = q.label;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setGearOpen(false);
        if (q.id === activeQ) return;
        playSource(q, video.currentTime || 0, !video.paused);
      });
      qualityOpts.appendChild(btn);
    });
    if (gearBtn) gearBtn.hidden = qualities.length < 2;
    if (qualities.length) {
      var best = qualities[qualities.length - 1];
      setTitleQualityLabel(best.label);
      if (gearLabel) gearLabel.textContent = best.label;
    }
  }

  function pickStartQuality() {
    if (!qualities.length) return null;
    var coarse = false;
    try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch (e1) {}
    // Prefer best HLS available; on phones start a bit lower to save data
    var hlsQs = qualities.filter(function (q) { return q.type === "hls"; });
    var pool = hlsQs.length ? hlsQs : qualities;
    if (coarse) {
      // ~720p max auto on phones when available, else highest under 720, else best
      var under = pool.filter(function (q) { return q.height > 0 && q.height <= 720; });
      if (under.length) return under[under.length - 1];
    }
    return pool[pool.length - 1];
  }

  video.addEventListener("loadeddata", function () {
    if (video.videoWidth > 0) setStatus("", true);
  });
  video.addEventListener("playing", function () {
    setStatus("", true);
  });
  video.addEventListener("error", function () {
    if (hls) return; // HLS errors handled separately
    if (failFallback) {
      setStatus("Stream unavailable — try again later.");
      return;
    }
    var next = qualities.find(function (q) { return q.id !== activeQ; });
    if (next) {
      failFallback = true;
      playSource(next, video.currentTime || 0, true);
      return;
    }
    failFallback = true;
    playMp4(proxyUrl, "proxy", video.currentTime || 0, true);
  });

  fetch("/porn/api/stream?id=" + encodeURIComponent(videoId), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.ok || !data.streams) {
        playMp4(proxyUrl, "proxy", 0, true);
        return;
      }
      var s = data.streams;
      if (s.poster) video.setAttribute("poster", s.poster);
      buildQualityUi(s);
      var start = pickStartQuality();
      if (!start) {
        playMp4(proxyUrl, "proxy", 0, true);
        return;
      }
      playSource(start, 0, true);
    })
    .catch(function () {
      playMp4(proxyUrl, "proxy", 0, true);
    });
})();
