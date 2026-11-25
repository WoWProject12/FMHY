(function () {
  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  function setMenuOpen(dd, open) {
    var btn = dd.querySelector(".cfp-dd-btn");
    var menu = dd.querySelector(".cfp-dd-menu");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (menu) {
      menu.classList.toggle("is-open", !!open);
      menu.hidden = !open;
    }
  }

  function closeAllMenus(except) {
    document.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      if (except && dd === except) return;
      setMenuOpen(dd, false);
    });
  }

  function initToolbar(form) {
    form.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      var btn = dd.querySelector(".cfp-dd-btn");
      var menu = dd.querySelector(".cfp-dd-menu");
      if (!btn || !menu) return;

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var willOpen = btn.getAttribute("aria-expanded") !== "true";
        closeAllMenus(willOpen ? dd : null);
        setMenuOpen(dd, willOpen);
        if (willOpen) {
          var filter = menu.querySelector("[data-cfp-dd-filter]");
          if (filter) {
            filter.value = "";
            filter.dispatchEvent(new Event("input"));
            setTimeout(function () { try { filter.focus(); } catch (err) {} }, 0);
          }
        }
      });

      // Clicks inside menu must not bubble to document closer incorrectly
      menu.addEventListener("click", function (e) {
        e.stopPropagation();
      });

      var filter = menu.querySelector("[data-cfp-dd-filter]");
      if (filter) {
        filter.addEventListener("input", function () {
          var q = (filter.value || "").toLowerCase().trim();
          menu.querySelectorAll(".cfp-dd-option").forEach(function (opt) {
            var label = (opt.getAttribute("data-label") || opt.textContent || "").toLowerCase();
            opt.hidden = q !== "" && label.indexOf(q) === -1;
          });
        });
      }
    });

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
      form.requestSubmit ? form.requestSubmit() : form.submit();
    });

    form.querySelectorAll("[data-cfp-field-select]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var field = sel.getAttribute("data-cfp-field-select");
        var input = form.querySelector('[data-cfp-field="' + field + '"]');
        if (input) input.value = sel.value;
      });
    });

    var advBtn = form.querySelector("[data-cfp-adv-toggle]");
    var adv = form.querySelector("[data-cfp-adv]");
    if (advBtn && adv) {
      advBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        var open = advBtn.getAttribute("aria-expanded") === "true";
        advBtn.setAttribute("aria-expanded", open ? "false" : "true");
        adv.hidden = open;
        adv.classList.toggle("is-open", !open);
      });
    }
  }

  document.querySelectorAll("[data-cfp-toolbar]").forEach(initToolbar);

  // Close when clicking outside any open dropdown (including elsewhere in toolbar)
  document.addEventListener("click", function (e) {
    var insideMenu = closest(e.target, ".cfp-dd-menu.is-open, .cfp-dd-btn[aria-expanded='true']");
    if (!insideMenu) closeAllMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllMenus();
  });

  // Player
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
    return streams.high || streams.hls || streams.low || "";
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
      if (!streams.high && streams.hls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = streams.hls;
      } else {
        video.src = url;
      }
      setStatus("Ready", true);
      var p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { setStatus("Tap play to start", true); });
      }
    })
    .catch(function () {
      setStatus("Could not load stream.");
    });
})();
