(function () {
  "use strict";

  var root = document.getElementById("iptvApp");
  if (!root) return;

  var video = document.getElementById("iptvVideo");
  var listEl = document.getElementById("iptvList");
  var searchEl = document.getElementById("iptvSearch");
  var chipsEl = document.getElementById("iptvCountries");
  var countEl = document.getElementById("iptvCount");
  var emptyEl = document.getElementById("iptvEmpty");
  var busyEl = document.getElementById("iptvBusy");
  var errorEl = document.getElementById("iptvError");
  var nowName = document.getElementById("iptvNowName");
  var nowMeta = document.getElementById("iptvNowMeta");
  var toggleBtn = document.getElementById("iptvToggle");
  var muteBtn = document.getElementById("iptvMute");
  var fsBtn = document.getElementById("iptvFs");

  var channels = [];
  var groups = [];
  var country = "";
  var activeId = "";
  var hls = null;
  var searchTimer = null;
  var started = false;
  var offset = 0;
  var totalAll = 0;
  var loadingMore = false;
  var PAGE = 300;

  function setBusy(on) {
    if (!busyEl) return;
    busyEl.hidden = !on;
  }

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function nowEpg(channel) {
    var list = channel && Array.isArray(channel.epg) ? channel.epg : [];
    if (!list.length) return "";
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      var start = Date.parse(list[i].start);
      var end = Date.parse(list[i].end);
      if (!isNaN(start) && !isNaN(end) && start <= now && now < end) {
        return list[i].title || "";
      }
    }
    return list[0].title || "";
  }

  function playUrl(channel) {
    var id = encodeURIComponent(String(channel.id));
    var url = "/api/iptv/live/" + id + "/index.m3u8";
    if (channel.playPageUrl) {
      url += "?playPageUrl=" + encodeURIComponent(String(channel.playPageUrl));
    }
    return url;
  }

  function destroyPlayer() {
    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch (e2) {}
    }
  }

  function syncChrome() {
    if (!video) return;
    if (toggleBtn) toggleBtn.textContent = video.paused ? "▶" : "❚❚";
    if (muteBtn) muteBtn.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
  }

  function playChannel(channel, opts) {
    opts = opts || {};
    if (!channel || !video) return;
    activeId = String(channel.id);
    renderList();

    if (emptyEl) emptyEl.style.display = "none";
    if (nowName) nowName.textContent = channel.name || "Live channel";
    var epg = nowEpg(channel);
    if (nowMeta) {
      nowMeta.textContent = epg
        ? epg + (channel.country ? " · " + channel.country : "")
        : (channel.country || "Live TV");
    }
    setError("");
    setBusy(true);
    destroyPlayer();

    // Start muted only for autoplay policy; user unmute button clears it.
    video.muted = opts.auto ? true : video.muted;
    var src = playUrl(channel);

    function ready() {
      setBusy(false);
      video.play().then(syncChrome).catch(function () {
        setBusy(false);
        syncChrome();
      });
    }

    function fail(msg) {
      setBusy(false);
      setError(msg || "Stream failed. Try another channel.");
      syncChrome();
    }

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 24,
        xhrSetup: function (xhr) {
          try { xhr.withCredentials = false; } catch (e) {}
        },
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, ready);
      hls.on(window.Hls.Events.ERROR, function (_e, data) {
        if (!data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          try { hls.startLoad(); } catch (err) { fail(); }
          return;
        }
        fail();
      });
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", ready, { once: true });
      video.addEventListener("error", function () { fail(); }, { once: true });
      return;
    }

    fail("HLS is not supported in this browser.");
  }

  function filtered() {
    // Server already filters search/country; keep local list as-is.
    return channels;
  }

  function renderChips() {
    if (!chipsEl) return;
    var html =
      '<button type="button" class="iptv-chip' +
      (!country ? " is-on" : "") +
      '" data-country="">All</button>';
    groups.forEach(function (g) {
      html +=
        '<button type="button" class="iptv-chip' +
        (country === g ? " is-on" : "") +
        '" data-country="' +
        escapeAttr(g) +
        '">' +
        escapeHtml(g) +
        "</button>";
    });
    chipsEl.innerHTML = html;
  }

  function renderList() {
    var rows = filtered();
    if (countEl) {
      countEl.textContent = rows.length
        ? rows.length + (totalAll > rows.length ? " / " + totalAll : "") + " channels"
        : "No channels";
    }
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,.4);padding:2rem 0">No channels match.</p>';
      return;
    }

    listEl.innerHTML = rows
      .map(function (ch) {
        var id = String(ch.id);
        var active = id === activeId;
        var logo = ch.logo ? String(ch.logo) : "";
        var epg = nowEpg(ch) || "Live now";
        return (
          '<button type="button" class="iptv-card' +
          (active ? " is-on" : "") +
          '" data-id="' +
          escapeAttr(id) +
          '">' +
          (ch.country
            ? '<span class="iptv-card-country">' + escapeHtml(ch.country) + "</span>"
            : "") +
          '<span class="iptv-card-media">' +
          (logo
            ? '<img alt="" loading="lazy" src="' +
              escapeAttr(logo) +
              '" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'iptv-card-fallback\',textContent:\'LIVE\'}))">'
            : '<span class="iptv-card-fallback">LIVE</span>') +
          "</span>" +
          '<span class="iptv-card-body">' +
          '<span class="iptv-card-name">' +
          escapeHtml(ch.name || id) +
          "</span>" +
          '<span class="iptv-card-epg">' +
          escapeHtml(epg) +
          "</span>" +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function loadChannels(thenPlay, append) {
    if (append) {
      if (loadingMore || channels.length >= totalAll) return;
      loadingMore = true;
    } else {
      offset = 0;
      if (countEl) countEl.textContent = "Loading…";
    }

    var params = new URLSearchParams({
      source: "huhu",
      limit: String(PAGE),
      offset: String(append ? channels.length : 0),
    });
    var q = searchEl && searchEl.value ? searchEl.value.trim() : "";
    if (q) params.set("search", q);
    if (country) params.set("country", country);

    fetch("/api/iptv/channels?" + params.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        loadingMore = false;
        if (!data || !data.success) {
          throw new Error((data && data.error) || "Failed to load channels");
        }
        var batch = Array.isArray(data.channels) ? data.channels : [];
        totalAll = Number(data.totalAll || data.total || batch.length) || batch.length;
        channels = append ? channels.concat(batch) : batch;
        if (!append) {
          if (Array.isArray(data.countryCounts) && data.countryCounts.length) {
            groups = data.countryCounts.map(function (c) { return c.country; }).filter(Boolean);
          } else {
            groups = Array.from(
              new Set(channels.map(function (c) { return c.country; }).filter(Boolean))
            ).sort();
          }
          renderChips();
        }
        renderList();

        if (thenPlay && !started && channels.length) {
          started = true;
          playChannel(channels[0], { auto: true });
        }
      })
      .catch(function (err) {
        loadingMore = false;
        if (!append) {
          channels = [];
          renderList();
          setError(err && err.message ? err.message : "Failed to load channels");
          if (countEl) countEl.textContent = "Error";
        }
      });
  }

  if (listEl) {
    listEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-id]");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var channel = channels.find(function (c) { return String(c.id) === id; });
      if (channel) playChannel(channel, { auto: false });
    });
  }

  if (chipsEl) {
    chipsEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-country]");
      if (!btn) return;
      country = btn.getAttribute("data-country") || "";
      loadChannels(false);
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { loadChannels(false); }, 280);
    });
  }

  if (toggleBtn && video) {
    toggleBtn.addEventListener("click", function () {
      if (video.paused) video.play().catch(function () {});
      else video.pause();
      syncChrome();
    });
  }

  if (muteBtn && video) {
    muteBtn.addEventListener("click", function () {
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
      syncChrome();
    });
  }

  if (fsBtn && video) {
    fsBtn.addEventListener("click", function () {
      var stage = root.querySelector(".iptv-stage");
      var el = stage || video;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(function () {});
      } else if (el.requestFullscreen) {
        el.requestFullscreen().catch(function () {});
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    });
  }

  if (video) {
    video.addEventListener("play", syncChrome);
    video.addEventListener("pause", syncChrome);
    video.addEventListener("volumechange", syncChrome);
  }

  window.addEventListener(
    "scroll",
    function () {
      if (loadingMore || channels.length >= totalAll) return;
      var nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 900;
      if (nearBottom) loadChannels(false, true);
    },
    { passive: true }
  );

  function boot() {
    loadChannels(true, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
