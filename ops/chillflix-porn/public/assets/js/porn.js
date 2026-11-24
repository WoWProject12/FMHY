(function () {
  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  function closeAllMenus(except) {
    document.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      if (except && dd === except) return;
      var btn = dd.querySelector(".cfp-dd-btn");
      var menu = dd.querySelector(".cfp-dd-menu");
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    });
  }

  function initToolbar(form) {
    form.querySelectorAll("[data-cfp-dd]").forEach(function (dd) {
      var btn = dd.querySelector(".cfp-dd-btn");
      var menu = dd.querySelector(".cfp-dd-menu");
      if (!btn || !menu) return;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var open = btn.getAttribute("aria-expanded") === "true";
        closeAllMenus();
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        menu.hidden = open;
        if (!open) {
          var filter = menu.querySelector("[data-cfp-dd-filter]");
          if (filter) {
            filter.value = "";
            filter.dispatchEvent(new Event("input"));
            setTimeout(function () { filter.focus(); }, 0);
          }
        }
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
      var field = opt.getAttribute("data-cfp-set");
      var value = opt.getAttribute("data-value") || "";
      var input = form.querySelector('[data-cfp-field="' + field + '"]');
      if (input) input.value = value;
      // Reset page when filters change
      var page = form.querySelector('[name="page"]');
      if (page) page.remove();
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
      advBtn.addEventListener("click", function () {
        var open = advBtn.getAttribute("aria-expanded") === "true";
        advBtn.setAttribute("aria-expanded", open ? "false" : "true");
        adv.hidden = open;
      });
    }

    document.addEventListener("click", function (e) {
      if (!closest(e.target, "[data-cfp-dd], [data-cfp-toolbar]")) {
        closeAllMenus();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAllMenus();
    });
  }

  document.querySelectorAll("[data-cfp-toolbar]").forEach(initToolbar);

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
