(function () {
  "use strict";

  var root = document.getElementById("iptvApp");
  if (!root) return;

  var listView = document.getElementById("iptvListView");
  var playerView = document.getElementById("iptvPlayerView");
  var listEl = document.getElementById("iptvList");
  var statusEl = document.getElementById("iptvListStatus");
  var searchEl = document.getElementById("iptvSearch");
  var sortEl = document.getElementById("iptvSort");
  var countryEl = document.getElementById("iptvCountry");
  var video = document.getElementById("iptvVideo");
  var busyEl = document.getElementById("iptvBusy");
  var playerErrorEl = document.getElementById("iptvPlayerError");

  var channels = [];
  var groups = [];
  var tab = "live";
  var activeId = "";
  var activeIndex = -1;
  var hls = null;
  var searchTimer = null;
  var loadingMore = false;
  var totalAll = 0;
  var PAGE = 300;
  var FAV_KEY = "chillflix:iptv-favs";
  var epgTimer = null;

  var AVATAR_COLORS = [
    "#6b4a32", "#5a4630", "#4a3f2e", "#6b5238", "#5c4834",
    "#3f382c", "#7a5a3a", "#4a4034", "#6b4638", "#554836"
  ];

  function favs() {
    try {
      var raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function setFavs(list) {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  }

  function isFav(id) {
    return favs().indexOf(String(id)) !== -1;
  }

  function toggleFav(id) {
    id = String(id);
    var list = favs();
    var i = list.indexOf(id);
    if (i === -1) list.push(id);
    else list.splice(i, 1);
    setFavs(list);
    return list.indexOf(id) !== -1;
  }

  function avatarColor(name) {
    var s = String(name || "?");
    var hash = 0;
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function initial(name) {
    var s = String(name || "?").trim();
    return (s.charAt(0) || "?").toUpperCase();
  }

  /** Player title: keep name, drop trailing channel numbers like " (7)" / " #1". */
  function displayNameNoNumber(name) {
    return String(name || "Channel")
      .replace(/\s*[\(\[]\s*#?\d+\s*[\)\]]\s*$/g, "")
      .replace(/\s+#\d+\s*$/g, "")
      .trim() || "Channel";
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

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function currentEpg(channel) {
    var list = channel && Array.isArray(channel.epg) ? channel.epg : [];
    if (!list.length) return null;
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      var start = Date.parse(list[i].start);
      var end = Date.parse(list[i].end);
      if (!isNaN(start) && !isNaN(end) && start <= now && now < end) {
        return { entry: list[i], index: i, start: start, end: end };
      }
    }
    var first = list[0];
    return {
      entry: first,
      index: 0,
      start: Date.parse(first.start),
      end: Date.parse(first.end),
    };
  }

  function progressPct(epg) {
    if (!epg || isNaN(epg.start) || isNaN(epg.end) || epg.end <= epg.start) return 0;
    var now = Date.now();
    var pct = ((now - epg.start) / (epg.end - epg.start)) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  function minutesLeft(epg) {
    if (!epg || isNaN(epg.end)) return "";
    var mins = Math.max(0, Math.round((epg.end - Date.now()) / 60000));
    return mins + " min left";
  }

  function epgLine(channel) {
    var cur = currentEpg(channel);
    if (!cur || !cur.entry) return "Live now";
    return (
      formatTime(cur.entry.start) +
      " – " +
      formatTime(cur.entry.end) +
      " " +
      (cur.entry.title || "")
    );
  }

  function playUrl(channel) {
    var id = encodeURIComponent(String(channel.id));
    var url = "/api/iptv/live/" + id + "/index.m3u8";
    if (channel.playPageUrl) {
      url += "?playPageUrl=" + encodeURIComponent(String(channel.playPageUrl));
    }
    return url;
  }

  function setBusy(on) {
    if (busyEl) busyEl.hidden = !on;
  }

  function setPlayerError(msg) {
    if (!playerErrorEl) return;
    if (!msg) {
      playerErrorEl.hidden = true;
      playerErrorEl.textContent = "";
      return;
    }
    playerErrorEl.hidden = false;
    playerErrorEl.textContent = msg;
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

  function visibleChannels() {
    if (tab !== "favs") return channels;
    var f = favs();
    return channels.filter(function (c) { return f.indexOf(String(c.id)) !== -1; });
  }

  function renderCountries() {
    if (!countryEl) return;
    var selected = countryEl.value;
    var html = '<option value="">Country: all</option>';
    groups.forEach(function (g) {
      html +=
        '<option value="' +
        escapeAttr(g) +
        '"' +
        (g === selected ? " selected" : "") +
        ">Country: " +
        escapeHtml(g) +
        "</option>";
    });
    countryEl.innerHTML = html;
  }

  function renderList() {
    var rows = visibleChannels();
    if (statusEl) {
      if (!rows.length) {
        statusEl.textContent = tab === "favs" ? "No favorites yet." : "No channels";
      } else {
        statusEl.textContent =
          rows.length +
          (totalAll > rows.length && tab === "live" ? " / " + totalAll : "") +
          " channels";
      }
    }
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = "";
      return;
    }

    listEl.innerHTML = rows
      .map(function (ch, idx) {
        var id = String(ch.id);
        var cur = currentEpg(ch);
        var pct = progressPct(cur);
        var on = id === activeId;
        var fav = isFav(id);
        return (
          '<div class="huhu-row' +
          (on ? " is-on" : "") +
          '" role="listitem" data-id="' +
          escapeAttr(id) +
          '">' +
          '<span class="huhu-idx">' +
          (idx + 1) +
          "</span>" +
          '<span class="huhu-avatar" style="background:' +
          avatarColor(ch.name) +
          '">' +
          escapeHtml(initial(ch.name)) +
          "</span>" +
          '<span class="huhu-meta">' +
          '<span class="huhu-name">' +
          escapeHtml(ch.name || id) +
          "</span>" +
          '<span class="huhu-epg-line">' +
          escapeHtml(epgLine(ch)) +
          "</span>" +
          '<span class="huhu-mini-progress"><i style="width:' +
          pct.toFixed(1) +
          '%"></i></span>' +
          "</span>" +
          '<button type="button" class="huhu-heart' +
          (fav ? " is-on" : "") +
          '" data-fav="' +
          escapeAttr(id) +
          '" aria-label="Favorite">' +
          (fav
            ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>') +
          "</button>" +
          "</div>"
        );
      })
      .join("");
  }

  function updatePlayerEpg(channel) {
    var cur = currentEpg(channel);
    var next =
      channel && Array.isArray(channel.epg) && cur
        ? channel.epg[cur.index + 1]
        : null;

    var nowTime = document.getElementById("iptvEpgNowTime");
    var nowTitle = document.getElementById("iptvEpgNowTitle");
    var left = document.getElementById("iptvEpgLeft");
    var bar = document.getElementById("iptvEpgBar");
    var nextEl = document.getElementById("iptvEpgNext");

    if (cur && cur.entry) {
      if (nowTime) {
        nowTime.textContent =
          formatTime(cur.entry.start) + " – " + formatTime(cur.entry.end);
      }
      if (nowTitle) nowTitle.textContent = cur.entry.title || "Live";
      if (left) left.textContent = minutesLeft(cur);
      if (bar) bar.style.width = progressPct(cur).toFixed(1) + "%";
    } else {
      if (nowTime) nowTime.textContent = "";
      if (nowTitle) nowTitle.textContent = "Live";
      if (left) left.textContent = "";
      if (bar) bar.style.width = "0%";
    }

    if (nextEl) {
      nextEl.textContent = next
        ? formatTime(next.start) +
          " – " +
          formatTime(next.end) +
          " " +
          (next.title || "")
        : "";
    }
  }

  function showPlayer(channel, index) {
    activeId = String(channel.id);
    activeIndex = index;
    root.classList.add("is-player");
    if (listView) listView.hidden = true;
    if (playerView) playerView.hidden = false;

    var avatar = document.getElementById("iptvNowAvatar");
    var rank = document.getElementById("iptvNowRank");
    var name = document.getElementById("iptvNowName");
    var favBtn = document.getElementById("iptvFavPlayer");

    if (avatar) {
      avatar.textContent = initial(channel.name);
      avatar.style.background = avatarColor(channel.name);
    }
    if (rank) {
      rank.hidden = true;
      rank.textContent = "";
    }
    if (name) name.textContent = displayNameNoNumber(channel.name);
    if (favBtn) favBtn.classList.toggle("is-on", isFav(channel.id));

    updatePlayerEpg(channel);
    if (epgTimer) clearInterval(epgTimer);
    epgTimer = setInterval(function () {
      updatePlayerEpg(channel);
      renderList();
    }, 30000);

    startStream(channel);
  }

  function hidePlayer() {
    root.classList.remove("is-player");
    if (playerView) playerView.hidden = true;
    if (listView) listView.hidden = false;
    destroyPlayer();
    setPlayerError("");
    setBusy(false);
    if (epgTimer) {
      clearInterval(epgTimer);
      epgTimer = null;
    }
    renderList();
  }

  function startStream(channel) {
    if (!video) return;
    setPlayerError("");
    setBusy(true);
    destroyPlayer();
    video.muted = true;

    var src = playUrl(channel);

    function ready() {
      setBusy(false);
      video.play().catch(function () {});
      syncMute();
    }

    function fail(msg) {
      setBusy(false);
      setPlayerError(msg || "Stream failed. Try another channel.");
    }

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 24,
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
      video.addEventListener(
        "error",
        function () { fail(); },
        { once: true }
      );
      return;
    }

    fail("HLS is not supported in this browser.");
  }

  function syncMute() {
    var btn = document.getElementById("iptvMute");
    if (!btn || !video) return;
    btn.classList.toggle("is-on", !video.muted);
  }

  function loadChannels(append) {
    if (append) {
      if (loadingMore || channels.length >= totalAll) return;
      loadingMore = true;
    } else if (statusEl) {
      statusEl.textContent = "Loading…";
    }

    var params = new URLSearchParams({
      source: "huhu",
      limit: String(PAGE),
      offset: String(append ? channels.length : 0),
    });
    var q = searchEl && searchEl.value ? searchEl.value.trim() : "";
    var country = countryEl ? countryEl.value : "";
    var sort = sortEl ? sortEl.value : "trending";
    if (q) params.set("search", q);
    if (country) params.set("country", country);
    if (sort) params.set("sort", sort);

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
            groups = data.countryCounts
              .map(function (c) { return c.country; })
              .filter(Boolean);
          } else {
            groups = Array.from(
              new Set(channels.map(function (c) { return c.country; }).filter(Boolean))
            ).sort();
          }
          renderCountries();
        }
        renderList();
      })
      .catch(function (err) {
        loadingMore = false;
        if (!append) {
          channels = [];
          renderList();
          if (statusEl) {
            statusEl.textContent = err && err.message ? err.message : "Failed to load";
          }
        }
      });
  }

  // Tabs
  root.querySelectorAll(".huhu-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      tab = btn.getAttribute("data-tab") || "live";
      root.querySelectorAll(".huhu-tab").forEach(function (b) {
        b.classList.toggle("is-on", b === btn);
      });
      renderList();
    });
  });

  // List interactions
  if (listEl) {
    listEl.addEventListener("click", function (ev) {
      var favBtn = ev.target.closest("[data-fav]");
      if (favBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleFav(favBtn.getAttribute("data-fav"));
        renderList();
        return;
      }
      var row = ev.target.closest("[data-id]");
      if (!row) return;
      var id = row.getAttribute("data-id");
      var rows = visibleChannels();
      var idx = rows.findIndex(function (c) { return String(c.id) === id; });
      if (idx < 0) return;
      showPlayer(rows[idx], idx);
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { loadChannels(false); }, 280);
    });
  }
  if (countryEl) countryEl.addEventListener("change", function () { loadChannels(false); });
  if (sortEl) sortEl.addEventListener("change", function () { loadChannels(false); });

  var dockSearch = document.getElementById("iptvDockSearch");
  if (dockSearch && searchEl) {
    dockSearch.addEventListener("click", function () {
      searchEl.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Player controls
  var muteBtn = document.getElementById("iptvMute");
  if (muteBtn && video) {
    muteBtn.addEventListener("click", function () {
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
      syncMute();
    });
  }

  var favPlayer = document.getElementById("iptvFavPlayer");
  if (favPlayer) {
    favPlayer.addEventListener("click", function () {
      if (!activeId) return;
      var on = toggleFav(activeId);
      favPlayer.classList.toggle("is-on", on);
      renderList();
    });
  }

  function zap(delta) {
    var rows = visibleChannels();
    if (!rows.length) return;
    var next = activeIndex + delta;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    showPlayer(rows[next], next);
  }

  var prevBtn = document.getElementById("iptvPrev");
  var nextBtn = document.getElementById("iptvNext");
  if (prevBtn) prevBtn.addEventListener("click", function () { zap(-1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { zap(1); });

  ["iptvBackList", "iptvClose"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", hidePlayer);
  });

  var fsBtn = document.getElementById("iptvFs");
  if (fsBtn && video) {
    fsBtn.addEventListener("click", function () {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(function () {});
      } else if (video.requestFullscreen) {
        video.requestFullscreen().catch(function () {});
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    });
  }

  var pipBtn = document.getElementById("iptvPip");
  if (pipBtn && video) {
    pipBtn.addEventListener("click", function () {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().catch(function () {});
      }
    });
  }

  window.addEventListener(
    "scroll",
    function () {
      if (root.classList.contains("is-player")) return;
      if (tab !== "live") return;
      if (loadingMore || channels.length >= totalAll) return;
      var nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 900;
      if (nearBottom) loadChannels(true);
    },
    { passive: true }
  );

  document.addEventListener("keydown", function (ev) {
    if (!root.classList.contains("is-player")) return;
    if (ev.key === "Escape") hidePlayer();
    if (ev.key === "ArrowUp") zap(-1);
    if (ev.key === "ArrowDown") zap(1);
  });

  loadChannels(false);
})();
