import "server-only"

import { createHash, randomBytes } from "crypto"

type Entry = {
  url: string
  expiresAt: number
}

const TTL_MS = 15 * 60 * 1000
const store = new Map<string, Entry>()

function prune(now = Date.now()) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

/** Opaque token so CF Bot Fight does not challenge open-proxy `?u=http://...` URLs. */
export function mintLiveFetchToken(targetUrl: string) {
  prune()
  const token = randomBytes(16).toString("hex")
  store.set(token, {
    url: targetUrl,
    expiresAt: Date.now() + TTL_MS,
  })
  // Also index by short hash for stable segment URLs within a playlist window.
  const hash = createHash("sha256").update(targetUrl).digest("hex").slice(0, 24)
  store.set(hash, {
    url: targetUrl,
    expiresAt: Date.now() + TTL_MS,
  })
  return token
}

export function resolveLiveFetchToken(token: string) {
  if (!token) return null
  prune()
  const entry = store.get(token)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    store.delete(token)
    return null
  }
  return entry.url
}

export function liveFetchProxyPath(origin: string, targetUrl: string) {
  const token = mintLiveFetchToken(targetUrl)
  const base = origin.replace(/\/$/, "")
  return `${base}/api/iptv/live-fetch?t=${encodeURIComponent(token)}`
}
