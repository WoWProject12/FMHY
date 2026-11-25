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

  // xvideos-style in-thumb previews: jump through parts of the video while held.
  // Finger can move on the card (scrub); only stop on release or when scrolling away.
  var activePreview = null;
  var previewTimer = null;
  var previewUrlCache = Object.create(null);
  var streamInflight = Object.create(null);
  var segmentTimer = null;
  var scrubbing = false;

  // Sample points across the video (xvideos-style "parts" trailer)
  var PART_FRACS = [0.08, 0.22, 0.38, 0.52, 0.68, 0.82];
  var PART_HOLD_MS = 1400;

  function cardHref(card) {
    return card.getAttribute("data-href") || card.getAttribute("href") || "";
  }

  function openCard(card) {
    var href = cardHref(card);
    if (href) window.location.href = href;
  }

  function clearSegmentTour() {
    if (segmentTimer) {
      clearInterval(segmentTimer);
      segmentTimer = null;
    }
    scrubbing = false;
  }

  function stopPreview(card) {
    if (!card) return;
    clearSegmentTour();
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
    vid.loop = false; // we jump parts ourselves
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
      if (!isFinite(vid.duration) || vid.duration < 1) return;
      var target = Math.max(0.05, Math.min(t, vid.duration - 0.2));
      if (Math.abs(vid.currentTime - target) > 0.35) {
        vid.currentTime = target;
      }
    } catch (e) {}
  }

  /** Jump through several parts of the video, like xvideos hover previews. */
  function startSegmentTour(card, vid) {
    clearSegmentTour();
    if (!vid || activePreview !== card) return;

    var startTour = function () {
      if (activePreview !== card || scrubbing) return;
      var dur = vid.duration;
      if (!isFinite(dur) || dur < 3) {
        // Short clip — just play through
        try { vid.loop = true; vid.play(); } catch (e) {}
        return;
      }
      vid.loop = false;
      var idx = 0;
      seekSafe(vid, dur * PART_FRACS[0]);
      try { vid.play(); } catch (e2) {}

      segmentTimer = setInterval(function () {
        if (activePreview !== card || scrubbing) return;
        if (!isFinite(vid.duration) || vid.duration < 3) return;
        idx = (idx + 1) % PART_FRACS.length;
        seekSafe(vid, vid.duration * PART_FRACS[idx]);
        if (vid.paused) {
          try { vid.play(); } catch (e3) {}
        }
      }, PART_HOLD_MS);
    };

    if (isFinite(vid.duration) && vid.duration > 0) {
      startTour();
    } else {
      vid.addEventListener("loadedmetadata", function onMeta() {
        vid.removeEventListener("loadedmetadata", onMeta);
        startTour();
      });
    }
  }

  /** Finger X across the thumb → seek through the whole video (scrub). */
  function scrubPreview(card, clientX) {
    var vid = card.querySelector(".cfp-card-preview");
    var media = card.querySelector(".cfp-card-media");
    if (!vid || !media || !isFinite(vid.duration) || vid.duration < 1) return;
    clearSegmentTour();
    scrubbing = true;
    card.classList.add("is-scrubbing");
    var rect = media.getBoundingClientRect();
    var ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    ratio = Math.max(0, Math.min(1, ratio));
    seekSafe(vid, vid.duration * ratio);
    if (vid.paused) {
      try { vid.play(); } catch (e) {}
    }
  }

  function resumeSegmentTour(card) {
    var vid = card.querySelector(".cfp-card-preview");
    if (!vid || activePreview !== card) return;
    scrubbing = false;
    card.classList.remove("is-scrubbing");
    startSegmentTour(card, vid);
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

    var reveal = function () {
      if (activePreview !== card) return;
      if (!(vid.videoWidth > 0) && vid.readyState < 2) return;
      vid.style.opacity = "1";
      card.classList.remove("is-preview-loading");
      card.classList.add("is-previewing");
      if (!scrubbing) startSegmentTour(card, vid);
    };

    vid.onplaying = reveal;
    vid.onloadeddata = reveal;
    vid.oncanplay = reveal;

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
        p.then(reveal).catch(function () {
          if (activePreview !== card) return;
          if (!allowFallback) {
            card.classList.remove("is-preview-loading", "is-previewing");
            vid.hidden = true;
            return;
          }
          tryPlay(previewProxyUrl(card.getAttribute("data-video-id") || ""), false);
        });
      }
    };

    tryPlay(url, true);
  }

  function startPreview(card) {
    var id = card.getAttribute("data-video-id") || "";
    if (!id) return;
    if (activePreview && activePreview !== card) stopPreview(activePreview);
    activePreview = card;
    card.classList.add("is-preview-loading");

    resolveStreamUrl(id).then(function (url) {
      if (activePreview !== card) return;
      playPreview(card, url || previewProxyUrl(id));
    });
  }

  function pointInCard(card, x, y) {
    var r = card.getBoundingClientRect();
    return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
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

    card.addEventListener("mouseenter", function () {
      clearTimeout(previewTimer);
      resolveStreamUrl(card.getAttribute("data-video-id") || "");
      previewTimer = setTimeout(function () { startPreview(card); }, 120);
    });
    card.addEventListener("mouseleave", function () {
      clearTimeout(previewTimer);
      stopPreview(card);
    });

    var touchTimer = null;
    var startX = 0;
    var startY = 0;
    var lastX = 0;
    var lastY = 0;
    var previewArmed = false;
    var scrolledAway = false;
    var id = card.getAttribute("data-video-id") || "";

    card.addEventListener("touchstart", function (e) {
      if (!e.touches || !e.touches[0]) return;
      startX = lastX = e.touches[0].clientX;
      startY = lastY = e.touches[0].clientY;
      previewArmed = false;
      scrolledAway = false;
      scrubbing = false;
      card.__cfpSuppressClick = false;
      clearTimeout(touchTimer);
      resolveStreamUrl(id);
      touchTimer = setTimeout(function () {
        previewArmed = true;
        card.__cfpSuppressClick = true;
        startPreview(card);
      }, 160);
    }, { passive: true });

    card.addEventListener("touchmove", function (e) {
      if (!e.touches || !e.touches[0]) return;
      var x = e.touches[0].clientX;
      var y = e.touches[0].clientY;
      var dx = x - startX;
      var dy = y - startY;
      var adx = Math.abs(dx);
      var ady = Math.abs(dy);
      lastX = x;
      lastY = y;

      // Before preview starts: only cancel if user is clearly scrolling the feed
      if (!previewArmed) {
        if (ady > 28 && ady > adx * 1.2) {
          clearTimeout(touchTimer);
          scrolledAway = true;
        }
        return;
      }

      // Preview active: keep playing while finger stays on/near the card.
      // Vertical scroll that leaves the card → pause. Horizontal → scrub parts.
      if (!pointInCard(card, x, y) && ady > 40) {
        stopPreview(card);
        previewArmed = false;
        scrolledAway = true;
        card.__cfpSuppressClick = true;
        return;
      }

      if (adx > 18 && adx >= ady) {
        // Slide across thumb → scrub through video timeline (xvideos-style)
        scrubPreview(card, x);
      }
    }, { passive: true });

    card.addEventListener("touchend", function () {
      clearTimeout(touchTimer);
      var wasPreview = previewArmed;
      // If they were scrubbing, briefly resume isn't needed — release stops like xvideos
      stopPreview(card);
      previewArmed = false;
      if (wasPreview || scrolledAway) {
        card.__cfpSuppressClick = true;
        setTimeout(function () { card.__cfpSuppressClick = false; }, 400);
      }
    });
    card.addEventListener("touchcancel", function () {
      clearTimeout(touchTimer);
      stopPreview(card);
      previewArmed = false;
      card.__cfpSuppressClick = true;
      setTimeout(function () { card.__cfpSuppressClick = false; }, 400);
    });
  }

  document.addEventListener("contextmenu", function (e) {
    if (e.target && e.target.closest && e.target.closest(".cfp-card, .cfp-rail-card")) {
      e.preventDefault();
    }
  }, true);

  // If the page scrolls under a held preview, pause it
  var scrollStopTimer = null;
  window.addEventListener("scroll", function () {
    if (!activePreview) return;
    clearTimeout(scrollStopTimer);
    scrollStopTimer = setTimeout(function () {
      if (!activePreview) return;
      var r = activePreview.getBoundingClientRect();
      var vh = window.innerHeight || 0;
      if (r.bottom < 40 || r.top > vh - 40) {
        stopPreview(activePreview);
      }
    }, 50);
  }, { passive: true });

  document.querySelectorAll(".cfp-card[data-video-id], .cfp-rail-card[data-video-id]").forEach(bindCardPreview);

  // Full player (watch page)
  var root = document.querySelector(".cfp-player");
  if (!root) return;
  var videoId = root.getAttribute("data-video-id") || "";
  var video = document.getElementById("cfpPlayer");
  var status = document.getElementById("cfpPlayerStatus");
  if (!videoId || !video) return;

  function setStatus(msg, ready) {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("is-ready", !!ready);
  }

  function pickUrl(streams) {
    return streams.high || streams.low || streams.hls || "";
  }

  fetch("/porn/api/stream?id=" + encodeURIComponent(videoId), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.ok || !data.streams) {
        setStatus("Stream unavailable — try again later.");
        return;
      }
      var streams = data.streams;
      if (streams.poster && !video.getAttribute("poster")) {
        video.setAttribute("poster", streams.poster);
      }
      var url = pickUrl(streams);
      if (!url) {
        setStatus("No playable source.");
        return;
      }
      video.referrerPolicy = "no-referrer";
      video.src = url;
      setStatus("Ready", true);
      var p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          // Fallback: same-origin proxy if CDN blocks the player
          video.src = "/porn/api/preview?id=" + encodeURIComponent(videoId);
          video.play().catch(function () {
            setStatus("Tap play to start", true);
          });
        });
      }
    })
    .catch(function () {
      setStatus("Could not load stream.");
    });
})();
