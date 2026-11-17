export const EMBED_MESSAGE_DELEGATE_POPUP = "CHILLFLIX_DELEGATE_POPUP"

let delegateInstalled = false

function isFriendlyParentHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "")
  return (
    h === "chillflix.lol" ||
    h === "chillflix.pw" ||
    h === "toflix.co" ||
    h === "vuflix.co" ||
    h.endsWith(".chillflix.lol") ||
    h.endsWith(".chillflix.pw")
  )
}

function adsParkUrl(): string {
  try {
    return `${window.location.origin}/embed/ads-park`
  } catch {
    return "https://www.chillflix.pw/embed/ads-park"
  }
}

/**
 * Monkey-patch window.open so popunders from the chillflix.pw iframe still open
 * when the browser blocks iframe window.open (Brave/Safari). Parent pages must
 * listen for CHILLFLIX_DELEGATE_POPUP and call window.open themselves.
 *
 * Third-party embeds that strip/filter ads never listen — fall back to opening
 * a first-party /embed/ads-park tab where Adcash runs on chillflix.pw.
 */
export function installEmbedPopupDelegate() {
  if (typeof window === "undefined" || delegateInstalled) return
  delegateInstalled = true

  const nativeOpen = window.open.bind(window)
  let parkArmed = false

  const openAdsParkOnce = () => {
    if (parkArmed || window.__cfNoAds) return
    parkArmed = true
    try {
      nativeOpen(adsParkUrl(), "_blank")
    } catch {
      /* ignore */
    }
  }

  window.open = function openWithDelegate(
    url?: string | URL,
    target?: string,
    features?: string
  ) {
    const href = url?.toString().trim() || ""
    try {
      if (
        window.__cfNoAds ||
        new URLSearchParams(window.location.search).get("noads") === "1"
      ) {
        return null
      }
    } catch {
      /* continue */
    }
    let opened: Window | null = null
    try {
      opened = nativeOpen(url, target, features)
    } catch {
      opened = null
    }

    let blocked = !opened
    if (!blocked && opened) {
      try {
        blocked = opened.closed
      } catch {
        blocked = true
      }
    }

    if (window.parent !== window && href && blocked) {
      try {
        window.parent.postMessage(
          { type: EMBED_MESSAGE_DELEGATE_POPUP, url: href || "about:blank" },
          "*"
        )
      } catch {
        /* ignore */
      }

      // Friendly parents (lol + embed.js) handle the message. Everyone else
      // that blocks iframe pops gets a first-party Adcash park on our origin.
      let parentHost = ""
      try {
        parentHost = document.referrer ? new URL(document.referrer).hostname : ""
      } catch {
        parentHost = ""
      }
      if (!parentHost || !isFriendlyParentHost(parentHost)) {
        // about:blank parks are Adcash's gesture hold — still open our park
        // so a real popunder can fire on chillflix.pw when the iframe cannot.
        openAdsParkOnce()
      }
    }

    return opened
  }

  // Do NOT open ads-park on a bare first click. That produced an empty tab when
  // Adcash was disabled/blocked. Park only when a real window.open was blocked
  // (handled above in the open wrapper).
}
