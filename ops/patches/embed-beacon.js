(function () {
  try {
    if (window.__cfEmbedBeacon) return
    window.__cfEmbedBeacon = true
    var ENDPOINT = "/api/analytics/player"
    var SITE = "https://www.chillflix.lol"
    var SELF = (location.hostname || "").toLowerCase()
    var path = location.pathname + location.search
    if (!/\/embed\//i.test(location.pathname)) return

    function hostFromReferrer() {
      try {
        if (!document.referrer) return null
        var h = new URL(document.referrer).hostname.toLowerCase()
        if (!h || h === SELF) return null
        return h
      } catch (e) {
        return null
      }
    }

    function hostFromParentOrigin() {
      try {
        var p = new URLSearchParams(location.search).get("parent_origin")
        if (!p) return null
        var h = new URL(p).hostname.toLowerCase()
        if (!h || h === SELF) return null
        return h
      } catch (e) {
        return null
      }
    }

    // Chrome/Edge: parent host even when Referrer-Policy strips document.referrer.
    function hostFromAncestorOrigins() {
      try {
        var ao = location.ancestorOrigins
        if (!ao || !ao.length) return null
        var h = new URL(ao[0]).hostname.toLowerCase()
        if (!h || h === SELF) return null
        return h
      } catch (e) {
        return null
      }
    }

    function isOwnBrand(host) {
      if (!host) return false
      var h = String(host).toLowerCase().replace(/^www\./, "")
      return (
        h === "chillflix.lol" ||
        h === "chillflix.pw" ||
        h === "toflix.co" ||
        h === "vuflix.co" ||
        h === "localhost" ||
        h === "127.0.0.1"
      )
    }

    function sessionKey() {
      var k = "cf_embed_sid"
      try {
        var existing = sessionStorage.getItem(k)
        if (existing && existing.length >= 16) return existing
        var bytes = new Uint8Array(16)
        ;(crypto.getRandomValues || function () {})(bytes)
        var id = Array.from(bytes)
          .map(function (b) {
            return ("0" + b.toString(16)).slice(-2)
          })
          .join("")
        sessionStorage.setItem(k, id)
        return id
      } catch (e) {
        return String(Date.now()) + Math.random().toString(16).slice(2)
      }
    }

    function parseMedia() {
      var m = location.pathname.match(/\/embed\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/i)
      if (!m) return null
      return {
        mediaType: m[1].toLowerCase(),
        mediaId: Number(m[2]),
        season: m[3] ? Number(m[3]) : null,
        episode: m[4] ? Number(m[4]) : null,
      }
    }

    function chillflixWatchUrl(media) {
      if (!media) return SITE + "/?play=true"
      if (media.mediaType === "tv") {
        var s = media.season != null ? media.season : 1
        var e = media.episode != null ? media.episode : 1
        return SITE + "/tv/" + media.mediaId + "?play=true&s=" + s + "&e=" + e
      }
      return SITE + "/movie/" + media.mediaId + "?play=true"
    }

    function openOnChillflix(url, ev) {
      if (ev) {
        try {
          ev.preventDefault()
          ev.stopPropagation()
        } catch (e0) {}
      }
      // Sandboxed embeds often block target=_blank (no allow-popups).
      // Prefer replacing the top window so the user lands on Chillflix.
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = url
          return false
        }
      } catch (e1) {}
      try {
        window.location.href = url
        return false
      } catch (e2) {}
      try {
        var w = window.open(url, "_blank")
        if (w) return false
      } catch (e3) {}
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url)
        }
      } catch (e4) {}
      try {
        window.prompt("Copy this Chillflix link:", url)
      } catch (e5) {}
      return false
    }

    function readFrameSandbox() {
      try {
        var fe = window.frameElement
        if (!fe) return null
        var attr = fe.getAttribute("sandbox")
        if (attr == null && !(fe.sandbox && fe.sandbox.length)) {
          return { sandboxed: false, canPopup: true }
        }
        var tokens = ""
        try {
          tokens =
            attr != null
              ? String(attr).toLowerCase()
              : Array.prototype.join.call(fe.sandbox, " ").toLowerCase()
        } catch (e) {
          tokens = String(attr || "").toLowerCase()
        }
        var canPopup =
          tokens.indexOf("allow-popups") !== -1 ||
          tokens.indexOf("allow-popups-to-escape-sandbox") !== -1
        return { sandboxed: true, canPopup: canPopup }
      } catch (e) {
        return null
      }
    }

    function probeAdsLib() {
      try {
        if (window.aclib && typeof window.aclib.runPop === "function") return true
        if (window.__chillflixAdcashArmed) return true
        if (document.getElementById("cf-xlib") || document.getElementById("cf-xboot")) return true
        if (document.getElementById("chillflix-embed-ads-llvpn-tag")) return true
        if (document.getElementById("chillflix-embed-ads-jnbhi-tag")) return true
      } catch (e) {}
      return false
    }

    function showWatchOnChillflix(media, reason) {
      if (window.__cfEmbedGateShown) return
      window.__cfEmbedGateShown = true
      try {
        if (document.getElementById("cf-embed-site-gate")) return
      } catch (e) {}

      var wrap = document.createElement("div")
      wrap.id = "cf-embed-site-gate"
      wrap.setAttribute("role", "dialog")
      wrap.setAttribute("aria-modal", "true")
      wrap.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
        "padding:18px;background:rgba(6,8,12,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f5f5f5;"

      var card = document.createElement("div")
      card.style.cssText =
        "width:min(420px,100%);border:1px solid rgba(255,255,255,.12);border-radius:16px;" +
        "background:linear-gradient(180deg,rgba(28,32,40,.98),rgba(12,14,18,.98));" +
        "box-shadow:0 20px 60px rgba(0,0,0,.45);padding:22px 20px 16px;text-align:center;"

      var brand = document.createElement("div")
      brand.textContent = "Chillflix"
      brand.style.cssText =
        "font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#f5c451;font-weight:700;margin-bottom:10px;"

      var title = document.createElement("h2")
      title.textContent = "Watch free on Chillflix"
      title.style.cssText = "margin:0 0 8px;font-size:22px;line-height:1.2;font-weight:750;"

      var body = document.createElement("p")
      body.textContent =
        "This site blocked Chillflix ads. Open Chillflix to keep watching movies & TV free."
      body.style.cssText =
        "margin:0 0 16px;font-size:14px;line-height:1.45;color:rgba(255,255,255,.72);"

      var watchUrl = chillflixWatchUrl(media)
      var cta = document.createElement("a")
      cta.href = watchUrl
      cta.target = "_top"
      cta.rel = "noopener noreferrer"
      cta.textContent = "Continue on Chillflix"
      cta.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:44px;" +
        "border-radius:999px;background:#f5c451;color:#111;font-weight:750;font-size:15px;" +
        "text-decoration:none;margin-bottom:10px;cursor:pointer;"
      cta.addEventListener("click", function (ev) {
        openOnChillflix(watchUrl, ev)
      })

      var note = document.createElement("div")
      note.textContent = reason === "sandbox" ? "Ads were blocked by this site’s player settings." : "Ads could not run in this embed."
      note.style.cssText = "font-size:11px;color:rgba(255,255,255,.4);margin-bottom:8px;"

      var link = document.createElement("div")
      link.textContent = watchUrl
      link.style.cssText =
        "font-size:10px;line-height:1.35;color:rgba(255,255,255,.35);word-break:break-all;margin-top:4px;"

      card.appendChild(brand)
      card.appendChild(title)
      card.appendChild(body)
      card.appendChild(cta)
      card.appendChild(note)
      card.appendChild(link)
      wrap.appendChild(card)

      var mount = document.body || document.documentElement
      mount.appendChild(wrap)

      function killPlayer() {
        try {
          document.querySelectorAll("video, audio").forEach(function (v) {
            try {
              v.pause()
            } catch (e0) {}
            try {
              v.muted = true
              v.volume = 0
            } catch (e1) {}
            try {
              v.removeAttribute("autoplay")
              v.autoplay = false
            } catch (e2) {}
            try {
              // Detach media so decoding/audio fully stops.
              v.removeAttribute("src")
              while (v.firstChild) v.removeChild(v.firstChild)
              v.load()
            } catch (e3) {}
            try {
              v.style.pointerEvents = "none"
            } catch (e4) {}
          })
        } catch (e5) {}
        try {
          // Hide player chrome under the gate.
          document.querySelectorAll("video, audio, canvas, iframe").forEach(function (el) {
            if (el.id === "cf-embed-site-gate") return
            try {
              el.style.visibility = "hidden"
            } catch (e6) {}
          })
        } catch (e7) {}
      }

      killPlayer()
      // Player frameworks often auto-resume — keep killing.
      var killTimes = 0
      var killTimer = setInterval(function () {
        killPlayer()
        killTimes += 1
        if (killTimes > 40) clearInterval(killTimer)
      }, 250)

      try {
        document.addEventListener(
          "play",
          function (ev) {
            try {
              var t = ev.target
              if (!t || (t.tagName !== "VIDEO" && t.tagName !== "AUDIO")) return
              t.pause()
              t.muted = true
              t.removeAttribute("src")
              while (t.firstChild) t.removeChild(t.firstChild)
              t.load()
            } catch (e8) {}
          },
          true
        )
      } catch (e9) {}

      try {
        // Block clicks reaching the player under the overlay.
        wrap.style.pointerEvents = "auto"
        document.documentElement.style.overflow = "hidden"
        document.body && (document.body.style.overflow = "hidden")
      } catch (e10) {}
    }

    var media = parseMedia()
    if (!media) return
    var inIframe = false
    try {
      inIframe = window.parent !== window
    } catch (e) {
      inIframe = true
    }
    var embedHost = hostFromParentOrigin() || hostFromAncestorOrigins() || hostFromReferrer()
    var context = inIframe || embedHost ? "embed" : "site"
    if (context === "embed" && !embedHost) embedHost = "(unknown)"
    var sid = sessionKey()
    var played = false
    var gestureProbed = false

    function send(event, extra) {
      var payload = {
        event: event,
        context: context,
        embedHost: context === "embed" ? embedHost : null,
        mediaType: media.mediaType,
        mediaId: media.mediaId,
        season: media.season,
        episode: media.episode,
        path: path,
        sessionKey: sid,
      }
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k]
        }
      }
      var body = JSON.stringify(payload)
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))
          return
        }
      } catch (e) {}
      try {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
          credentials: "omit",
        }).catch(function () {})
      } catch (e) {}
    }

    send("view")
    var heart = setInterval(function () {
      send("heartbeat")
    }, 25000)

    function onPlay() {
      if (played) return
      played = true
      send("play")
    }
    document.addEventListener(
      "play",
      function (ev) {
        if (ev.target && ev.target.tagName === "VIDEO") onPlay()
      },
      true
    )

    /**
     * In-player Chillflix gate — STRICT. Do not use window.open or
     * Permissions-Policy: both fire on normal embeds that still show ads
     * (clicking Play was popping the gate). Only gate when:
     * 1) Same-origin readable sandbox omits allow-popups
     * 2) Server force-gate list (known sandbox hosts)
     * 3) Ads enabled for host but ad scripts never appear (and stay missing)
     */
    function readableSandboxBlocksPopups() {
      var frame = readFrameSandbox()
      if (!frame) return null
      if (frame.sandboxed && !frame.canPopup) return true
      return false
    }

    function maybeGate(reason, force) {
      if (context !== "embed") return
      if (isOwnBrand(embedHost)) return
      if (embedHost === "(unknown)") return
      // "ads" = scripts missing. Skip if they loaded.
      // force/sandbox hosts still gate even when script tags exist (popups blocked).
      if (!force && reason === "ads" && probeAdsLib()) return
      if (!force && !reason && probeAdsLib()) return
      showWatchOnChillflix(media, reason || "sandbox")
    }

    function softProbe() {
      var readable = readableSandboxBlocksPopups()
      var adsLib = probeAdsLib()
      send("ad_probe", {
        canPopup: readable === true ? false : true,
        sandboxed: readable === true,
        adsLib: adsLib,
        probeKind: readable == null ? "soft" : "frame",
      })
      if (readable === true) maybeGate("sandbox", true)
    }
    setTimeout(softProbe, 2500)
    setTimeout(softProbe, 9000)

    // Server force-gate list (zetmoon.live etc). Always show — these hosts
    // sandbox the iframe so popunder ads cannot run even if aclib loads.
    function forceGateCheck() {
      if (context !== "embed") return
      if (!embedHost || embedHost === "(unknown)") {
        embedHost = hostFromParentOrigin() || hostFromAncestorOrigins() || hostFromReferrer() || embedHost
      }
      if (isOwnBrand(embedHost)) return
      if (!embedHost || embedHost === "(unknown)") return
      var url = "/api/analytics/gate-check?host=" + encodeURIComponent(embedHost)
      fetch(url, { cache: "no-store", credentials: "omit" })
        .then(function (r) {
          return r.json()
        })
        .then(function (data) {
          if (data && data.gate) maybeGate("sandbox", true)
        })
        .catch(function () {})
    }
    forceGateCheck()
    setTimeout(forceGateCheck, 400)
    setTimeout(forceGateCheck, 1500)
    setTimeout(forceGateCheck, 4000)
    setTimeout(forceGateCheck, 10000)

    // Ads enabled for this embedder but scripts never show up.
    function adsMissingGate() {
      if (context !== "embed") return
      if (isOwnBrand(embedHost)) return
      if (embedHost === "(unknown)") return
      if (probeAdsLib()) return
      if (window.__cfNoAds) return
      var url = "/api/embed/ads?host=" + encodeURIComponent(embedHost)
      fetch(url, { cache: "no-store", credentials: "omit" })
        .then(function (r) {
          return r.json()
        })
        .then(function (data) {
          if (!data || !data.showAds) return
          if (probeAdsLib()) return
          setTimeout(function () {
            if (probeAdsLib()) return
            maybeGate("ads", false)
          }, 4000)
        })
        .catch(function () {})
    }
    setTimeout(adsMissingGate, 12000)

    function gestureProbe() {
      if (gestureProbed) return
      gestureProbed = true
      var readable = readableSandboxBlocksPopups()
      var openOk = true
      try {
        var w = window.open("about:blank", "_blank")
        if (!w) openOk = false
        else {
          try {
            w.close()
          } catch (e1) {}
        }
      } catch (e2) {
        openOk = false
      }
      send("ad_probe", {
        canPopup: readable === true ? false : openOk,
        sandboxed: readable === true,
        adsLib: probeAdsLib(),
        probeKind: readable == null ? "gesture" : "gesture-frame",
      })
      // Analytics only on click — never show the gate from a Play tap.
      try {
        document.removeEventListener("click", gestureProbe, true)
      } catch (e3) {}
    }
    document.addEventListener("click", gestureProbe, true)

    window.addEventListener("pagehide", function () {
      clearInterval(heart)
      send("heartbeat")
    })
  } catch (e) {}
})()
