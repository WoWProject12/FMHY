import "server-only"

import { createHmac, timingSafeEqual } from "crypto"

const TTL_SEC = 20 * 60

function secret() {
  return (
    process.env.IPTV_LIVE_FETCH_SECRET ||
    process.env.PLAYBACK_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "chillflix-iptv-live-fetch-v1"
  )
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8")
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function fromB64url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/")
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, "base64")
}

/** Stateless signed token — survives Next HMR / multi-instance (no Map misses → 400). */
export function mintLiveFetchToken(targetUrl: string) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC
  const body = b64url(JSON.stringify({ u: targetUrl, e: exp }))
  const sig = b64url(createHmac("sha256", secret()).update(body).digest())
  return `${body}.${sig}`
}

export function resolveLiveFetchToken(token: string) {
  if (!token || !token.includes(".")) return null

  const [body, sig] = token.split(".")
  if (!body || !sig) return null

  const expected = b64url(createHmac("sha256", secret()).update(body).digest())
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as {
      u?: string
      e?: number
    }
    if (!payload?.u || typeof payload.u !== "string") return null
    if (!payload.e || payload.e < Math.floor(Date.now() / 1000)) return null
    return payload.u
  } catch {
    return null
  }
}

export function liveFetchProxyPath(origin: string, targetUrl: string) {
  const token = mintLiveFetchToken(targetUrl)
  const base = origin.replace(/\/$/, "")
  return `${base}/api/iptv/live-fetch?t=${encodeURIComponent(token)}`
}
