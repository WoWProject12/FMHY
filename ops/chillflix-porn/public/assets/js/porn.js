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

  // Desktop hover previews only (touch long-press was starting then dying + showing a filmstrip UI)
  var activePreview = null;
  var previewTimer = null;
  var previewUrlCache = Object.create(null);
  var canHover = false;
  try {
    canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch (e) {}

  function stopPreview(card) {
    if (!card) return;
    card.classList.remove("is-previewing");
    var vid = card.querySelector(".cfp-card-preview");
    if (vid) {
      try { vid.pause(); } catch (e) {}
      try {
        vid.removeAttribute("src");
        vid.load();
      } catch (e2) {}
      vid.hidden = true;
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
    vid.playsInline = true;
    vid.loop = true;
    vid.preload = "metadata";
    vid.controls = false;
    vid.disablePictureInPicture = true;
    vid.setAttribute("muted", "");
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
    vid.setAttribute("disablepictureinpicture", "");
    vid.referrerPolicy = "no-referrer";
    media.appendChild(vid);
    return vid;
  }

  function playPreview(card, url) {
    if (!url || activePreview !== card) return;
    var media = card.querySelector(".cfp-card-media");
    if (!media) return;
    var vid = ensurePreviewVideo(media);
    var show = function () {
      if (activePreview !== card) return;
      vid.hidden = false;
      card.classList.add("is-previewing");
    };
    vid.onplaying = show;
    if (vid.getAttribute("data-src") !== url) {
      vid.setAttribute("data-src", url);
      vid.src = url;
    }
    var p = vid.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        // Fallback through same-origin proxy
        var proxy = "/porn/api/preview?id=" + encodeURIComponent(card.getAttribute("data-video-id") || "");
        if (vid.getAttribute("data-src") === proxy) return;
        vid.setAttribute("data-src", proxy);
        vid.src = proxy;
        vid.play().then(show).catch(function () {
          stopPreview(card);
        });
      });
    }
  }

  function startPreview(card) {
    var id = card.getAttribute("data-video-id") || "";
    if (!id || !canHover) return;
    if (activePreview && activePreview !== card) stopPreview(activePreview);
    activePreview = card;

    if (previewUrlCache[id]) {
      playPreview(card, previewUrlCache[id]);
      return;
    }

    fetch("/porn/api/stream?id=" + encodeURIComponent(id), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (activePreview !== card || !data || !data.ok || !data.streams) return;
        var url = data.streams.low || data.streams.high || "";
        if (!url) return;
        previewUrlCache[id] = url;
        playPreview(card, url);
      })
      .catch(function () {});
  }

  function bindCardPreview(card) {
    if (!canHover || !card.getAttribute("data-video-id")) return;
    card.addEventListener("mouseenter", function () {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () { startPreview(card); }, 160);
    });
    card.addEventListener("mouseleave", function () {
      clearTimeout(previewTimer);
      stopPreview(card);
    });
  }

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
