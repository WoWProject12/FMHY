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
    menu.style.maxHeight = "";
  }

  /** Always open the same way: bottom sheet on phone/tablet, below the button on desktop. */
  function placeMenu(dd, menu) {
    clearMenuPosition(menu);
    if (isNarrow()) {
      menu.style.position = "fixed";
      menu.style.left = "0.5rem";
      menu.style.right = "0.5rem";
      menu.style.top = "auto";
      menu.style.bottom = "calc(4.75rem + env(safe-area-inset-bottom, 0px))";
      menu.style.width = "auto";
      menu.style.maxHeight = "min(68vh, 560px)";
      return;
    }
    var btn = dd.querySelector(".cfp-dd-btn");
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var menuWidth = Math.max(260, Math.min(340, window.innerWidth - 24));
    var left = rect.left;
    if (left + menuWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - menuWidth - 12);
    }
    menu.style.position = "fixed";
    menu.style.left = left + "px";
    menu.style.right = "auto";
    menu.style.top = Math.round(rect.bottom + 6) + "px";
    menu.style.bottom = "auto";
    menu.style.width = menuWidth + "px";
    menu.style.maxHeight = "min(420px, calc(100vh - " + Math.round(rect.bottom + 18) + "px))";
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
      document.documentElement.classList.add("cfp-dd-open");
    } else {
      menu.classList.remove("is-open");
      menu.hidden = true;
      clearMenuPosition(menu);
      if (!document.querySelector(".cfp-dd-menu.is-open")) {
        document.documentElement.classList.remove("cfp-dd-open");
      }
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

  // Hover / long-press card previews via same-origin proxy
  var activePreview = null;
  var previewTimer = null;

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

  function startPreview(card) {
    var id = card.getAttribute("data-video-id") || "";
    if (!id) return;
    if (activePreview && activePreview !== card) stopPreview(activePreview);
    activePreview = card;
    card.classList.add("is-previewing");

    var media = card.querySelector(".cfp-card-media");
    if (!media) return;
    var vid = card.querySelector(".cfp-card-preview");
    if (!vid) {
      vid = document.createElement("video");
      vid.className = "cfp-card-preview";
      vid.muted = true;
      vid.defaultMuted = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.preload = "auto";
      vid.setAttribute("muted", "");
      vid.setAttribute("playsinline", "");
      vid.setAttribute("webkit-playsinline", "");
      vid.referrerPolicy = "no-referrer";
      media.appendChild(vid);
    }

    var proxyUrl = "/porn/api/preview?id=" + encodeURIComponent(id);
    vid.hidden = false;
    if (vid.getAttribute("src") !== proxyUrl) {
      vid.src = proxyUrl;
    }
    var p = vid.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        // Retry once after metadata
        vid.addEventListener(
          "loadeddata",
          function () {
            if (activePreview === card) {
              var again = vid.play();
              if (again && again.catch) again.catch(function () {});
            }
          },
          { once: true }
        );
      });
    }
  }

  function bindCardPreview(card) {
    if (!card.getAttribute("data-video-id")) return;
    var coarse = false;
    try {
      coarse = window.matchMedia("(pointer: coarse)").matches;
    } catch (e) {}

    card.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "touch") return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () { startPreview(card); }, 140);
    });
    card.addEventListener("pointerleave", function () {
      clearTimeout(previewTimer);
      stopPreview(card);
    });

    card.addEventListener("mouseenter", function () {
      if (coarse) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () { startPreview(card); }, 140);
    });
    card.addEventListener("mouseleave", function () {
      clearTimeout(previewTimer);
      stopPreview(card);
    });

    var touchTimer = null;
    card.addEventListener("touchstart", function () {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(function () {
        startPreview(card);
      }, 380);
    }, { passive: true });
    card.addEventListener("touchend", function () {
      clearTimeout(touchTimer);
    });
    card.addEventListener("touchmove", function () {
      clearTimeout(touchTimer);
    }, { passive: true });
    card.addEventListener("touchcancel", function () {
      clearTimeout(touchTimer);
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
