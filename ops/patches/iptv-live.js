(function () {
  "use strict";

  var root = document.getElementById("iptvApp");
  if (!root) return;

  // Site chrome can be re-shown by layout pin scripts — keep it off on Live TV
  try {
    document.body.classList.add("page-iptv");
    var siteHeader = document.getElementById("siteHeader");
    if (siteHeader) {
      siteHeader.setAttribute("hidden", "");
      siteHeader.style.setProperty("display", "none", "important");
    }
  } catch (eHdr) {}

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
  // v2 stores channel snapshots so Favorites works after refresh
  var FAV_KEY = "chillflix_iptv_favs_v2";
  var FAV_KEY_LEGACY = "chillflix:iptv-favs";
  var FAV_COOKIE = "chillflix_iptv_favs";
  var epgTimer = null;
  var activeChannel = null;

  var AVATAR_COLORS = [
    "#6b4a32", "#5a4630", "#4a3f2e", "#6b5238", "#5c4834",
    "#7a5a3a", "#4a4034", "#6b4638", "#554836", "#3f382c"
  ];

  function readCookie(name) {
    try {
      var m = document.cookie.match(
        new RegExp("(?:^|; )" + name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") + "=([^;]*)")
      );
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) {
      return "";
    }
  }

  function writeCookie(name, value) {
    try {
      document.cookie =
        name +
        "=" +
        encodeURIComponent(value) +
        "; path=/; max-age=31536000; SameSite=Lax";
    } catch (e) {}
  }

  function normalizeFavEntry(item) {
    if (item == null) return null;
    if (typeof item === "string" || typeof item === "number") {
      return { id: String(item), name: String(item), epg: [] };
    }
    if (typeof item !== "object") return null;
    var id = item.id != null ? String(item.id) : "";
    if (!id) return null;
    return {
      id: id,
      name: item.name != null ? String(item.name) : id,
      country: item.country != null ? String(item.country) : "",
      playPageUrl: item.playPageUrl || item.play_page_url || "",
      epg: Array.isArray(item.epg) ? item.epg : [],
    };
  }

  function parseFavRaw(raw) {
    if (!raw) return [];
    try {
      var data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(data)) return [];
      var out = [];
      var seen = {};
      for (var i = 0; i < data.length; i++) {
        var e = normalizeFavEntry(data[i]);
        if (!e || seen[e.id]) continue;
        seen[e.id] = true;
        out.push(e);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function loadFavEntries() {
    var fromLs = "";
    var fromLegacy = "";
    try {
      fromLs = localStorage.getItem(FAV_KEY) || "";
    } catch (e) {}
    try {
      fromLegacy = localStorage.getItem(FAV_KEY_LEGACY) || "";
    } catch (e2) {}
    var fromCookie = readCookie(FAV_COOKIE);
    var entries = parseFavRaw(fromLs);
    if (!entries.length) entries = parseFavRaw(fromCookie);
    if (!entries.length) entries = parseFavRaw(fromLegacy);
    return entries;
  }

  function saveFavEntries(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var payload = JSON.stringify(list);
    var ok = false;
    try {
      localStorage.setItem(FAV_KEY, payload);
      ok = localStorage.getItem(FAV_KEY) === payload;
    } catch (e) {
      ok = false;
    }
    // Always mirror to cookie so refresh still works if LS is flaky
    writeCookie(FAV_COOKIE, payload);
    // Keep legacy id list in sync for older builds
    try {
      localStorage.setItem(
        FAV_KEY_LEGACY,
        JSON.stringify(
          list.map(function (e) {
            return e.id;
          })
        )
      );
    } catch (e2) {}
    return ok || !!readCookie(FAV_COOKIE);
  }

  function favEntries() {
    return loadFavEntries();
  }

  function favIds() {
    return favEntries().map(function (e) {
      return e.id;
    });
  }

  function isFav(id) {
    id = String(id);
    var list = favEntries();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return true;
    }
    return false;
  }

  function findChannel(id) {
    id = String(id);
    if (activeChannel && String(activeChannel.id) === id) return activeChannel;
    for (var i = 0; i < channels.length; i++) {
      if (String(channels[i].id) === id) return channels[i];
    }
    var favsList = favEntries();
    for (var j = 0; j < favsList.length; j++) {
      if (favsList[j].id === id) return favsList[j];
    }
    return null;
  }

  function snapshotChannel(ch) {
    if (!ch) return null;
    return normalizeFavEntry(ch);
  }

  function toggleFav(id) {
    id = String(id);
    var list = favEntries();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      var snap = snapshotChannel(findChannel(id)) || {
        id: id,
        name: id,
        epg: [],
      };
      list.push(snap);
    } else {
      list.splice(idx, 1);
    }
    saveFavEntries(list);
    return isFav(id);
  }

  var lastFavTapAt = 0;
  var lastFavTapId = "";

  function heartSvg(on, size) {
    size = size || 20;
    return on
      ? '<svg viewBox="0 0 24 24" width="' +
          size +
          '" height="' +
          size +
          '" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#e4c27a"/></svg>'
      : '<svg viewBox="0 0 24 24" width="' +
          size +
          '" height="' +
          size +
          '" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  }

  function applyHeartUI(btn, on) {
    if (!btn) return;
    var player = btn.id === "iptvFavPlayer";
    btn.classList.toggle("is-on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.innerHTML = heartSvg(!!on, player ? 22 : 20);
  }

  /** Single tap only — ignore duplicate events within 700ms. */
  function favTap(id, btn) {
    id = String(id);
    var now = Date.now();
    if (id === lastFavTapId && now - lastFavTapAt < 700) {
      return isFav(id);
    }
    lastFavTapAt = now;
    lastFavTapId = id;
    var on = toggleFav(id);
    applyHeartUI(btn, on);
    if (btn && btn.id === "iptvFavPlayer" && listEl) {
      var listBtn = listEl.querySelector('.huhu-heart[data-fav="' + id + '"]');
      if (listBtn) applyHeartUI(listBtn, on);
    }
    return on;
  }

  function favButtonFromEvent(ev) {
    var t = ev && ev.target;
    if (!t) return null;
    if (t.nodeType !== 1) t = t.parentElement;
    if (!t || !t.closest) return null;
    return t.closest(".huhu-heart[data-fav], #iptvFavPlayer");
  }

  function onFavGesture(ev) {
    var btn = favButtonFromEvent(ev);
    if (!btn || !root.contains(btn)) return;
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    var id =
      btn.getAttribute("data-fav") ||
      (btn.id === "iptvFavPlayer" ? activeId : "");
    if (!id) return;
    favTap(id, btn);
    if (tab === "favs") renderList();
  }

  // Click only (capture) — pointerup+click was double-firing and wiping saves
  window.addEventListener("click", onFavGesture, true);

  function wireHeartButtons() {
    // no-op — window capture handler owns favorites
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
    var lastPast = null;
    for (var i = 0; i < list.length; i++) {
      var start = Date.parse(list[i].start);
      var end = Date.parse(list[i].end);
      if (isNaN(start) || isNaN(end)) continue;
      if (start <= now && now < end) {
        return { entry: list[i], index: i, start: start, end: end, live: true };
      }
      if (end <= now) lastPast = { entry: list[i], index: i, start: start, end: end, live: false };
    }
    if (lastPast) return lastPast;
    var first = list[0];
    return {
      entry: first,
      index: 0,
      start: Date.parse(first.start),
      end: Date.parse(first.end),
      live: false,
    };
  }

  function progressPct(epg) {
    if (!epg || isNaN(epg.start) || isNaN(epg.end) || epg.end <= epg.start) return 8;
    if (epg.live === false && Date.now() >= epg.end) return 100;
    var now = Date.now();
    var pct = ((now - epg.start) / (epg.end - epg.start)) * 100;
    // Keep a visible pink fill on live rows (never look "missing")
    return Math.max(epg.live ? 4 : 0, Math.min(100, pct));
  }

  function minutesLeft(epg) {
    if (!epg || isNaN(epg.end)) return "";
    var mins = Math.max(0, Math.round((epg.end - Date.now()) / 60000));
    return mins + " min left";
  }

  function epgLineHtml(channel) {
    var cur = currentEpg(channel);
    if (!cur || !cur.entry) {
      return '<span class="huhu-epg-show">Live now</span>';
    }
    var when =
      formatTime(cur.entry.start) + " – " + formatTime(cur.entry.end);
    var title = cur.entry.title || "";
    return (
      '<span class="huhu-epg-when">' +
      escapeHtml(when) +
      "</span>" +
      (title
        ? ' <span class="huhu-epg-show">' + escapeHtml(title) + "</span>"
        : "")
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
    // Prefer live channel objects when present; otherwise use saved snapshots
    // so Favorites still lists channels after refresh.
    var entries = favEntries();
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var live = null;
      for (var j = 0; j < channels.length; j++) {
        if (String(channels[j].id) === entries[i].id) {
          live = channels[j];
          break;
        }
      }
      out.push(live || entries[i]);
    }
    return out;
  }

  function renderCountries() {
    var menu = document.getElementById("iptvCountryMenu");
    var btn = document.getElementById("iptvCountryBtn");
    if (!menu || !countryEl) return;
    var selected = countryEl.value || "";
    var opts = [{ value: "", label: "Country: all" }].concat(
      groups.map(function (g) {
        return { value: g, label: "Country: " + g };
      })
    );
    menu.innerHTML = opts
      .map(function (o) {
        return (
          '<button type="button" class="huhu-dd-option' +
          (o.value === selected ? " is-on" : "") +
          '" role="option" data-value="' +
          escapeAttr(o.value) +
          '">' +
          escapeHtml(o.label) +
          "</button>"
        );
      })
      .join("");
    if (btn) {
      var cur = opts.find(function (o) {
        return o.value === selected;
      });
      btn.textContent = cur ? cur.label : "Country: all";
    }
  }

  function setStatus(msg, withRetry) {
    if (!statusEl) return;
    if (!withRetry) {
      statusEl.textContent = msg;
      return;
    }
    statusEl.innerHTML =
      escapeHtml(msg) +
      '<div class="huhu-status-actions"><button type="button" class="huhu-retry-btn" id="iptvRetryLoad">Retry</button></div>';
    var retry = document.getElementById("iptvRetryLoad");
    if (retry) {
      retry.addEventListener("click", function () {
        loadChannels(false);
      });
    }
  }

  function renderList() {
    var rows = visibleChannels();
    if (statusEl) {
      if (!rows.length) {
        setStatus(tab === "favs" ? "No favorites yet." : "No channels");
      } else {
        setStatus(
          rows.length +
            (totalAll > rows.length && tab === "live" ? " / " + totalAll : "") +
            " channels"
        );
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
          epgLineHtml(ch) +
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
          heartSvg(fav) +
          "</button>" +
          "</div>"
        );
      })
      .join("");
    wireHeartButtons();
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
      if (!next) {
        nextEl.textContent = "";
      } else {
        nextEl.innerHTML =
          '<span class="huhu-epg-when">' +
          escapeHtml(formatTime(next.start) + " – " + formatTime(next.end)) +
          "</span>" +
          (next.title
            ? ' <span class="huhu-epg-show">' +
              escapeHtml(next.title) +
              "</span>"
            : "");
      }
    }
  }


  var parkedDocks = [];
  var dockWatchTimer = null;

  function parkSiteDock() {
    document.body.classList.add("is-iptv-player");
    document.documentElement.classList.add("is-iptv-player");
    document.querySelectorAll(
      "nav.toflix-mobile-dock, nav[aria-label='Mobile navigation']"
    ).forEach(function (el) {
      if (el.getAttribute("data-iptv-parked") === "1") return;
      parkedDocks.push({
        el: el,
        parent: el.parentNode,
        next: el.nextSibling,
      });
      el.setAttribute("data-iptv-parked", "1");
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    if (dockWatchTimer) clearInterval(dockWatchTimer);
    // Site scripts force-reinject the dock with inline !important — keep parking it.
    dockWatchTimer = setInterval(function () {
      if (!root.classList.contains("is-player")) return;
      document.querySelectorAll(
        "nav.toflix-mobile-dock, nav[aria-label='Mobile navigation']"
      ).forEach(function (el) {
        if (el.getAttribute("data-iptv-parked") === "1") {
          if (el.parentNode) el.parentNode.removeChild(el);
          return;
        }
        parkedDocks.push({
          el: el,
          parent: el.parentNode,
          next: el.nextSibling,
        });
        el.setAttribute("data-iptv-parked", "1");
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    }, 250);
  }

  function restoreSiteDock() {
    document.body.classList.remove("is-iptv-player");
    document.documentElement.classList.remove("is-iptv-player");
    if (dockWatchTimer) {
      clearInterval(dockWatchTimer);
      dockWatchTimer = null;
    }
    parkedDocks.forEach(function (item) {
      try {
        item.el.removeAttribute("data-iptv-parked");
        item.el.removeAttribute("hidden");
        item.el.style.removeProperty("display");
        item.el.style.removeProperty("visibility");
        item.el.style.removeProperty("opacity");
        item.el.style.removeProperty("pointer-events");
        item.el.style.removeProperty("transform");
        item.el.style.removeProperty("height");
        if (!item.parent) return;
        if (item.next && item.next.parentNode === item.parent) {
          item.parent.insertBefore(item.el, item.next);
        } else {
          item.parent.appendChild(item.el);
        }
      } catch (e) {}
    });
    parkedDocks = [];
  }

  function setSiteDockHidden(hidden) {
    if (hidden) parkSiteDock();
    else restoreSiteDock();
  }

  function showPlayer(channel, index) {
    activeId = String(channel.id);
    activeChannel = channel || null;
    activeIndex = index;
    // Channel open is a user gesture — unlock audio for unmuted playback
    if (video) {
      preferAudible();
      try {
        var unlock = video.play();
        if (unlock && unlock.catch) unlock.catch(function () {});
      } catch (eUnlock) {}
    }
    root.classList.add("is-player");
    setSiteDockHidden(true);
    if (listView) listView.hidden = true;
    if (playerView) playerView.hidden = false;
    showPlayerChrome(true);

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
    if (favBtn) applyHeartUI(favBtn, isFav(channel.id));

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
    setSiteDockHidden(false);
    if (playerView) {
      playerView.hidden = true;
      playerView.classList.remove("chrome-hidden");
    }
    clearChromeTimer();
    if (listView) listView.hidden = false;
    destroyPlayer();
    setPlayerError("");
    setBusy(false);
    if (epgTimer) {
      clearInterval(epgTimer);
      epgTimer = null;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    }
    renderList();
  }

  var chromeTimer = null;
  var CHROME_HIDE_MS = 2000;

  function clearChromeTimer() {
    if (chromeTimer) {
      clearTimeout(chromeTimer);
      chromeTimer = null;
    }
  }

  function showPlayerChrome(restartHide) {
    if (!playerView) return;
    playerView.classList.remove("chrome-hidden");
    clearChromeTimer();
    if (restartHide !== false) scheduleChromeHide();
  }

  function hidePlayerChrome() {
    if (!playerView || playerView.hidden) return;
    if (!root.classList.contains("is-player")) return;
    playerView.classList.add("chrome-hidden");
    clearChromeTimer();
  }

  function scheduleChromeHide() {
    clearChromeTimer();
    if (!root.classList.contains("is-player")) return;
    chromeTimer = setTimeout(hidePlayerChrome, CHROME_HIDE_MS);
  }

  function togglePlayerChrome() {
    if (!playerView) return;
    if (playerView.classList.contains("chrome-hidden")) {
      showPlayerChrome(true);
    } else {
      hidePlayerChrome();
    }
  }

  function preferAudible() {
    if (!video) return;
    try {
      video.volume = 1;
      video.muted = false;
    } catch (e) {}
  }

  /** Play with sound on by default; only mute if the browser blocks autoplay. */
  function playWithSound() {
    if (!video) return Promise.resolve();
    preferAudible();
    return video.play().catch(function () {
      // Autoplay policy blocked unmuted — start muted then unmute ASAP
      video.muted = true;
      return video
        .play()
        .then(function () {
          preferAudible();
          return video.play().catch(function () {
            // Still blocked — leave muted; user can tap the speaker
          });
        })
        .catch(function () {});
    }).then(function () {
      syncMute();
    });
  }

  function startStream(channel) {
    if (!video) return;
    setPlayerError("");
    setBusy(true);
    destroyPlayer();
    preferAudible();

    var src = playUrl(channel);

    function ready() {
      setBusy(false);
      playWithSound();
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

  var loadAbort = null;
  var loadSeq = 0;

  function loadChannels(append) {
    if (append) {
      if (loadingMore || channels.length >= totalAll) return;
      loadingMore = true;
    } else {
      loadingMore = false;
      setStatus("Loading…");
      if (loadAbort) {
        try {
          loadAbort.abort();
        } catch (e) {}
      }
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

    var seq = ++loadSeq;
    var attempts = 0;
    var maxAttempts = append ? 1 : 2;

    function fail(err) {
      if (seq !== loadSeq) return;
      loadingMore = false;
      if (!append) {
        channels = [];
        if (listEl) listEl.innerHTML = "";
        setStatus(
          (err && err.message) || "Failed to load channels",
          true
        );
      }
    }

    function attempt() {
      attempts += 1;
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (!append) loadAbort = ctrl;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, 12000);

      fetch("/api/iptv/channels?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (r) {
          if (!r.ok) throw new Error("Channels unavailable (" + r.status + ")");
          return r.text().then(function (text) {
            try {
              return JSON.parse(text);
            } catch (e) {
              throw new Error("Bad channels response");
            }
          });
        })
        .then(function (data) {
          clearTimeout(timer);
          if (seq !== loadSeq) return;
          loadingMore = false;
          if (!data || !data.success) {
            throw new Error((data && data.error) || "Failed to load channels");
          }
          var batch = Array.isArray(data.channels) ? data.channels : [];
          totalAll =
            Number(data.totalAll || data.total || batch.length) || batch.length;
          channels = append ? channels.concat(batch) : batch;

          if (!append) {
            if (Array.isArray(data.countryCounts) && data.countryCounts.length) {
              groups = data.countryCounts
                .map(function (c) {
                  return c.country;
                })
                .filter(Boolean);
            } else {
              groups = Array.from(
                new Set(
                  channels
                    .map(function (c) {
                      return c.country;
                    })
                    .filter(Boolean)
                )
              ).sort();
            }
            renderCountries();
          }
          renderList();
        })
        .catch(function (err) {
          clearTimeout(timer);
          if (seq !== loadSeq) return;
          var aborted = err && (err.name === "AbortError" || /abort/i.test(String(err)));
          if (!append && attempts < maxAttempts) {
            setStatus(aborted ? "Still loading…" : "Retrying…");
            setTimeout(attempt, aborted ? 400 : 700);
            return;
          }
          fail(
            aborted
              ? new Error("Loading timed out")
              : err || new Error("Failed to load")
          );
        });
    }

    attempt();
  }

  function closeAllDropdowns() {
    root.querySelectorAll(".huhu-dd.is-open").forEach(function (dd) {
      dd.classList.remove("is-open");
      var menu = dd.querySelector(".huhu-dd-menu");
      var btn = dd.querySelector(".huhu-dd-btn");
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function wireDropdowns() {
    root.querySelectorAll(".huhu-dd").forEach(function (dd) {
      var btn = dd.querySelector(".huhu-dd-btn");
      var menu = dd.querySelector(".huhu-dd-menu");
      var input = dd.querySelector('input[type="hidden"]');
      if (!btn || !menu || !input) return;

      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var open = !dd.classList.contains("is-open");
        closeAllDropdowns();
        if (!open) return;
        dd.classList.add("is-open");
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      });

      menu.addEventListener("click", function (ev) {
        var opt = ev.target && ev.target.closest ? ev.target.closest(".huhu-dd-option") : null;
        if (!opt || !menu.contains(opt)) return;
        ev.preventDefault();
        ev.stopPropagation();
        var value = opt.getAttribute("data-value");
        if (value == null) value = "";
        input.value = value;
        btn.textContent = opt.textContent || value;
        menu.querySelectorAll(".huhu-dd-option").forEach(function (o) {
          o.classList.toggle("is-on", o === opt);
        });
        closeAllDropdowns();
        loadChannels(false);
      });
    });

    document.addEventListener(
      "click",
      function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest(".huhu-dd")) return;
        closeAllDropdowns();
      },
      true
    );
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

  // Row click opens player — hearts handle themselves via wireHeartButtons()
  if (listEl) {
    listEl.addEventListener(
      "click",
      function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest(".huhu-heart, [data-fav]")) {
          return;
        }
        var row = ev.target.closest(".huhu-row[data-id], [data-id]");
        if (!row || !listEl.contains(row)) return;
        var id = row.getAttribute("data-id");
        var rows = visibleChannels();
        var idx = rows.findIndex(function (c) {
          return String(c.id) === id;
        });
        if (idx < 0) return;
        showPlayer(rows[idx], idx);
      },
      false
    );
  }

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { loadChannels(false); }, 280);
    });
  }
  wireDropdowns();
  renderCountries();

  var dockSearch = document.getElementById("iptvDockSearch");
  var sideHandle = document.getElementById("iptvSideHandle");
  if (sideHandle) {
    sideHandle.addEventListener("click", function () {
      if (searchEl) {
        searchEl.focus();
        try { searchEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      }
    });
  }

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

  // Player favorite uses the same window capture handlers as list hearts.

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

  // Tap video area: show/hide controls (same in fullscreen)
  var stageEl = playerView
    ? playerView.querySelector(".huhu-stage")
    : null;
  if (stageEl) {
    stageEl.addEventListener("click", function (ev) {
      if (!root.classList.contains("is-player")) return;
      // Ignore clicks on busy/error overlays buttons if any
      togglePlayerChrome();
    });
  }

  var sheetEl = document.getElementById("iptvSheet");
  if (sheetEl) {
    ["pointerdown", "touchstart", "click"].forEach(function (type) {
      sheetEl.addEventListener(
        type,
        function () {
          showPlayerChrome(true);
        },
        { passive: true }
      );
    });
  }

  var fsBtn = document.getElementById("iptvFs");
  if (fsBtn && playerView) {
    fsBtn.addEventListener("click", function () {
      showPlayerChrome(true);
      var fsRoot = playerView;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(function () {});
      } else if (fsRoot.requestFullscreen) {
        fsRoot.requestFullscreen().catch(function () {
          if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        });
      } else if (fsRoot.webkitRequestFullscreen) {
        fsRoot.webkitRequestFullscreen();
      } else if (video && video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    });
  }

  document.addEventListener("fullscreenchange", function () {
    if (root.classList.contains("is-player")) showPlayerChrome(true);
  });

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
