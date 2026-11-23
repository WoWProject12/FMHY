(function () {
  try {
    var host = (location.hostname || "").replace(/^www\./, "");
    var ALLOWED = { "chillflix.lol": 1, "toflix.co": 1, "vuflix.co": 1 };
    if (!ALLOWED[host]) return;

    var framed = false;
    try { framed = window.top !== window; } catch (e) { framed = true; }
    if (framed) return;

    var KEY = "chillflix:community-prompt-session";
    var LEGACY_KEYS = [
      "chillflix_discord_home_v3",
      "chillflix_discord_home_v2",
      "chillflix_discord_announce",
      "chillflix_toflix_announce"
    ];
    var INVITE = "https://discord.gg/WbP6reJ39";
    var DELAY_MS = 1800;
    var done = false;
    var mo = null;

    var DISCORD_ICON = ""
      + '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">'
      + '<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>'
      + "</svg>";

    function seen() {
      if (done) return true;
      try {
        if (sessionStorage.getItem(KEY) === "1") return true;
        for (var i = 0; i < LEGACY_KEYS.length; i++) {
          if (sessionStorage.getItem(LEGACY_KEYS[i]) === "1") return true;
        }
      } catch (e) {}
      return false;
    }

    function mark() {
      done = true;
      try {
        sessionStorage.setItem(KEY, "1");
        for (var i = 0; i < LEGACY_KEYS.length; i++) {
          sessionStorage.setItem(LEGACY_KEYS[i], "1");
        }
      } catch (e) {}
      stopWatching();
    }

    function stopWatching() {
      done = true;
      try { if (mo) { mo.disconnect(); mo = null; } } catch (e) {}
    }

    function isHome() {
      try {
        var path = (location.pathname || "/").replace(/\/+$/, "") || "/";
        var base = "";
        try { base = (document.body && document.body.getAttribute("data-base")) || ""; } catch (e) {}
        base = String(base || "").replace(/\/+$/, "");
        if (path === "/" || path === "") return true;
        if (base && (path === base || path === base + "/")) return true;
        if (path === "/new" || path === "/new/") return true;
        var bc = (document.body && document.body.className) || "";
        if (/\bpage-home\b/.test(bc)) return true;
        if (!bc && document.getElementById("hero")) return true;
        return false;
      } catch (e) { return false; }
    }

    function isBlockedPath() {
      var path = location.pathname || "/";
      return /^\/(embed|player-api|player-ads-frame|admin|embed-ads|movie|tv|watch|party|auth|new\/(movie|tv|watch|admin|party|auth))(\/|$)/i.test(path)
        || /[?&]play=true\b/.test(location.search || "")
        || /\bpage-watch\b|\bpage-detail\b|\bpage-admin\b/.test((document.body && document.body.className) || "");
    }

    function resolveInvite() {
      try {
        var meta = document.querySelector('meta[name="chillflix-discord-invite"]');
        if (meta && meta.content) return String(meta.content).trim() || INVITE;
      } catch (e) {}
      return INVITE;
    }

    /* Match chillflix movy tokens: --surface-*, --text-*, --primary teal, soft neo chrome */
    var css = ""
      + "#tfDiscHome{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;"
      + "padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px));"
      + "background:rgba(5,7,10,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);"
      + "font-family:Inter,system-ui,\"Segoe UI\",sans-serif;color:#eef1f6;"
      + "opacity:0;animation:tfDiscFade .28s ease forwards}"
      + "#tfDiscHome *{box-sizing:border-box}"
      + "#tfDiscHome .tf-card{position:relative;width:min(380px,100%);border-radius:20px;overflow:hidden;"
      + "padding:28px 24px 22px;text-align:left;"
      + "background:linear-gradient(180deg,#141922 0%,#0b0f14 100%);"
      + "border:1px solid #2a3242;"
      + "box-shadow:0 24px 64px -20px rgba(0,0,0,.85);"
      + "transform:translateY(12px);opacity:0;animation:tfDiscIn .36s cubic-bezier(.16,.84,.18,1) .04s forwards}"
      + "#tfDiscHome .tf-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:999px;cursor:pointer;"
      + "background:#1d2430;color:#8a94a6;font-size:20px;line-height:1;display:grid;place-items:center}"
      + "#tfDiscHome .tf-x:hover{background:#2a3242;color:#eef1f6}"
      + "#tfDiscHome .tf-row{display:flex;align-items:flex-start;gap:14px;margin:0 0 18px;padding-right:28px}"
      + "#tfDiscHome .tf-ico{flex:0 0 auto;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;"
      + "background:rgba(88,101,242,.16);color:#7289da;border:1px solid rgba(88,101,242,.28)}"
      + "#tfDiscHome .tf-ico svg{width:22px;height:22px}"
      + "#tfDiscHome .tf-copy{min-width:0}"
      + "#tfDiscHome .tf-kicker{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2dd4bf}"
      + "#tfDiscHome h2{margin:0 0 6px;font-size:20px;line-height:1.25;letter-spacing:-.02em;font-weight:700;color:#eef1f6}"
      + "#tfDiscHome p{margin:0;font-size:14px;line-height:1.5;color:#8a94a6}"
      + "#tfDiscHome .tf-actions{display:flex;flex-direction:column;gap:8px}"
      + "#tfDiscHome .tf-go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:999px;"
      + "padding:12px 18px;cursor:pointer;background:#eef1f6;color:#05070a;font-size:14.5px;font-weight:700;"
      + "text-decoration:none;letter-spacing:-.01em;transition:background .15s ease,transform .12s ease}"
      + "#tfDiscHome .tf-go:hover{background:#fff}"
      + "#tfDiscHome .tf-go:active{transform:scale(.98)}"
      + "#tfDiscHome .tf-go svg{width:18px;height:18px;flex:0 0 auto}"
      + "#tfDiscHome .tf-later{width:100%;border-radius:999px;padding:11px 16px;cursor:pointer;"
      + "border:1px solid #2a3242;background:transparent;color:#8a94a6;font-size:14px;font-weight:600}"
      + "#tfDiscHome .tf-later:hover{background:#1d2430;color:#eef1f6;border-color:#2a3242}"
      + "@keyframes tfDiscFade{to{opacity:1}}"
      + "@keyframes tfDiscIn{to{transform:translateY(0);opacity:1}}"
      + "@media (max-width:480px){"
      + "#tfDiscHome{align-items:flex-end;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}"
      + "#tfDiscHome .tf-card{width:100%;border-radius:18px 18px 14px 14px;padding:24px 18px 18px}"
      + "}";

    function ensureStyle() {
      if (document.getElementById("tfDiscHomeCss")) return;
      var st = document.createElement("style");
      st.id = "tfDiscHomeCss";
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }

    function dismiss() {
      mark();
      var el = document.getElementById("tfDiscHome");
      if (!el) return;
      el.style.opacity = "0";
      el.style.transition = "opacity .18s ease";
      setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 180);
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) { if (e.key === "Escape") dismiss(); }

    function mount() {
      if (seen()) return;
      if (!isHome() || isBlockedPath()) return;
      if (document.getElementById("tfDiscHome")) return;
      if (document.getElementById("cfSaleOffer")) return;
      if (document.querySelector('[data-chillflix-share-prompt="1"]')) return;

      ensureStyle();
      var invite = resolveInvite();
      var wrap = document.createElement("div");
      wrap.id = "tfDiscHome";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.setAttribute("aria-labelledby", "tfDiscHomeTitle");
      wrap.setAttribute("data-chillflix-community-prompt", "1");
      wrap.innerHTML = ""
        + '<div class="tf-card">'
        +   '<button type="button" class="tf-x" data-tf-disc-skip aria-label="Close">&times;</button>'
        +   '<div class="tf-row">'
        +     '<div class="tf-ico" aria-hidden="true">' + DISCORD_ICON + "</div>"
        +     '<div class="tf-copy">'
        +       '<div class="tf-kicker">Community</div>'
        +       '<h2 id="tfDiscHomeTitle">Join our Discord</h2>'
        +       "<p>Get updates, request titles, and chat with other Chillflix fans.</p>"
        +     "</div>"
        +   "</div>"
        +   '<div class="tf-actions">'
        +     '<a class="tf-go" href="' + invite.replace(/"/g, "") + '" target="_blank" rel="noopener noreferrer" data-tf-disc-join>'
        +       DISCORD_ICON + "Join Discord</a>"
        +     '<button type="button" class="tf-later" data-tf-disc-skip>Not now</button>'
        +   "</div>"
        + "</div>";
      document.body.appendChild(wrap);
      document.addEventListener("keydown", onKey);
      wrap.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("[data-tf-disc-join]")) { mark(); return; }
        if (t.closest("[data-tf-disc-skip]") || t === wrap) dismiss();
      });
    }

    var tries = 0;
    function tick() {
      if (seen()) { stopWatching(); return; }
      if (isHome() && !isBlockedPath()) { mount(); return; }
      if (tries++ < 12) setTimeout(tick, 800);
    }

    function start() {
      if (seen()) { stopWatching(); return; }
      setTimeout(tick, DELAY_MS);
    }

    function onNav() {
      if (seen()) { stopWatching(); return; }
      tries = 0;
      setTimeout(tick, 400);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    window.addEventListener("pageshow", onNav);
    window.addEventListener("popstate", onNav);
    try {
      mo = new MutationObserver(function () {
        if (seen()) { stopWatching(); return; }
        if (isHome() && !isBlockedPath() && !document.getElementById("tfDiscHome")) mount();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  } catch (e) {}
})();
