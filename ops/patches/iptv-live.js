(function () {
  "use strict";

  var root = document.getElementById("iptvApp");
  if (!root) return;

  var video = document.getElementById("iptvVideo");
  var listEl = document.getElementById("iptvList");
  var searchEl = document.getElementById("iptvSearch");
  var countryEl = document.getElementById("iptvCountry");
  var countEl = document.getElementById("iptvCount");
  var emptyEl = document.getElementById("iptvEmpty");
  var busyEl = document.getElementById("iptvBusy");
  var errorEl = document.getElementById("iptvError");
  var nowName = document.getElementById("iptvNowName");
  var nowMeta = document.getElementById("iptvNowMeta");

  var channels = [];
  var groups = [];
  var activeId = "";
  var hls = null;
  var searchTimer = null;

  function setBusy(on) {
    if (!busyEl) return;
    busyEl.hidden = !on;
    busyEl.style.display = on ? "flex" : "none";
  }

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
      return;
    }
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function logoUrl(channel) {
    var logo = channel && channel.logo ? String(channel.logo) : "";
    if (!logo) return "";
    if (/^https?:\/\//i.test(logo)) return logo;
    if (logo.charAt(0) === "/") return "https://huhu.to" + logo;
    return logo;
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
      try {
        hls.destroy();
      } catch (e) {}
      hls = null;
    }
    if (video) {
      try {
        video.removeAttribute("src");
        video.load();
      } catch (e2) {}
    }
  }

  function playChannel(channel) {
    if (!channel || !video) return;
    activeId = String(channel.id);
    renderList();
    if (emptyEl) emptyEl.style.display = "none";
    if (nowName) nowName.textContent = channel.name || "Live channel";
    if (nowMeta) {
      nowMeta.textContent = (channel.country || "Live") + " · Live TV";
    }
    setError("");
    setBusy(true);
    destroyPlayer();

    var src = playUrl(channel);

    function ready() {
      setBusy(false);
      video.play().catch(function () {});
    }

    function fail(msg) {
      setBusy(false);
      setError(msg || "Stream failed to load. Try another channel.");
    }

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 20,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, ready);
      hls.on(window.Hls.Events.ERROR, function (_e, data) {
        if (data && data.fatal) fail();
      });
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", ready, { once: true });
      video.addEventListener("error", function () {
        fail();
      }, { once: true });
      return;
    }

    fail("HLS is not supported in this browser.");
  }

  function filtered() {
    var q = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
    var country = countryEl ? countryEl.value : "";
    return channels.filter(function (ch) {
      if (country && ch.country !== country) return false;
      if (!q) return true;
      return (
        String(ch.name || "").toLowerCase().indexOf(q) !== -1 ||
        String(ch.country || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function renderCountries() {
    if (!countryEl) return;
    var selected = countryEl.value;
    var html = '<option value="">All countries</option>';
    groups.forEach(function (g) {
      html +=
        '<option value="' +
        escapeAttr(g) +
        '"' +
        (g === selected ? " selected" : "") +
        ">" +
        escapeHtml(g) +
        "</option>";
    });
    countryEl.innerHTML = html;
  }

  function renderList() {
    var rows = filtered();
    if (countEl) {
      countEl.textContent = rows.length ? rows.length + " channels" : "No channels";
    }
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML =
        '<p class="px-3 py-8 text-center text-sm text-white/40">No channels match.</p>';
      return;
    }

    listEl.innerHTML = rows
      .map(function (ch) {
        var id = String(ch.id);
        var active = id === activeId;
        var logo = logoUrl(ch);
        return (
          '<button type="button" class="iptv-ch flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ' +
          (active
            ? "bg-white/[0.1] ring-1 ring-white/15"
            : "hover:bg-white/[0.05]") +
          '" data-id="' +
          escapeAttr(id) +
          '">' +
          (logo
            ? '<img alt="" class="h-9 w-14 shrink-0 rounded-md object-cover bg-black/40" loading="lazy" src="' +
              escapeAttr(logo) +
              '" onerror="this.style.visibility=\'hidden\'">'
            : '<span class="flex h-9 w-14 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-[10px] text-white/35">LIVE</span>') +
          '<span class="min-w-0 flex-1">' +
          '<span class="block truncate text-[13px] font-medium text-text-hi">' +
          escapeHtml(ch.name || id) +
          "</span>" +
          '<span class="block truncate text-[11px] text-white/40">' +
          escapeHtml(ch.country || "") +
          "</span>" +
          "</span>" +
          "</button>"
        );
      })
      .join("");
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

  function loadChannels() {
    if (countEl) countEl.textContent = "Loading…";
    var params = new URLSearchParams({ source: "huhu" });
    var q = searchEl && searchEl.value ? searchEl.value.trim() : "";
    var country = countryEl ? countryEl.value : "";
    if (q) params.set("search", q);
    if (country) params.set("country", country);

    fetch("/api/iptv/channels?" + params.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.success) {
          throw new Error((data && data.error) || "Failed to load channels");
        }
        channels = Array.isArray(data.channels) ? data.channels : [];
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
        renderList();
      })
      .catch(function (err) {
        channels = [];
        renderList();
        setError(err && err.message ? err.message : "Failed to load channels");
        if (countEl) countEl.textContent = "Error";
      });
  }

  if (listEl) {
    listEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-id]");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var channel = channels.find(function (c) {
        return String(c.id) === id;
      });
      if (channel) playChannel(channel);
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadChannels, 280);
    });
  }

  if (countryEl) {
    countryEl.addEventListener("change", loadChannels);
  }

  function boot() {
    loadChannels();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
