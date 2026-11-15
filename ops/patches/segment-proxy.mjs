/**
 * Stream signed media segments without entering the Next.js process.
 * Playlists still forward to Next so URLs can be rewritten.
 * Listens on 127.0.0.1:3003. nginx sends /api/cinepro/proxy here.
 */
import crypto from "crypto"
import fs from "fs"
import http from "http"
import https from "https"
import { URL } from "url"
import zlib from "zlib"
import { SocksProxyAgent } from "socks-proxy-agent"

const PORT = 3003
const NEXT_PORT = 3002
const ENV_PATH = "/var/www/chillflix.pw/.env.local"

function loadEnvFile(path) {
    let text = ""
    try {
        text = fs.readFileSync(path, "utf8")
    } catch {
        return
    }
    for (const line of text.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq)
        if (process.env[key]) continue
        let value = trimmed.slice(eq + 1).trim()
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }
        process.env[key] = value
    }
}

loadEnvFile(ENV_PATH)

const SECRET = process.env.AUTH_SECRET || "chillflix-dev-secret-change-in-production"

const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, Accept, Origin, Content-Type",
    "access-control-expose-headers":
        "Content-Length, Content-Range, Accept-Ranges, X-Chillflix-Source-Duration",
}

const HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
])

let blockedIps = new Set()

/** Soft per-host concurrency so ABR segment stampedes don't 429 the CDN mid-watch.
 * Defaults sized for a 4-core / ~6GB player host. Override via env without code edits. */
const HOST_CONCURRENCY = Math.max(4, Number(process.env.SEGPROXY_HOST_CONCURRENCY || 16) || 16)
const GLOBAL_CONCURRENCY = Math.max(8, Number(process.env.SEGPROXY_GLOBAL_CONCURRENCY || 64) || 64)
const HOST_WAIT_MS = Math.max(5_000, Number(process.env.SEGPROXY_HOST_WAIT_MS || 25_000) || 25_000)
const hostInflight = new Map()
let globalActive = 0
const globalWaiters = []
/** Upstream 429/503 retries — mid-stream page-XX.html used to fail hard on one blip. */
const UPSTREAM_RETRY_STATUSES = new Set([429, 503])
const UPSTREAM_RETRIES = 5
const UPSTREAM_RETRY_BASE_MS = 280

const WARP_SOCKS =
    process.env.VIDEASY_CDN_SOCKS?.trim() ||
    process.env.WARP_SOCKS?.trim() ||
    "socks5h://127.0.0.1:40000"
const VIDEASY_CDN_HOST_RE =
    /(?:^|\.)(goldenkite\.top|silverkite\.top|bronzekite\.top|kite\.top)$/i
let warpAgent = null
function getWarpAgent() {
    if (!warpAgent) warpAgent = new SocksProxyAgent(WARP_SOCKS)
    return warpAgent
}

/** Reuse TLS sockets — default undici/http agents open a new handshake per segment. */
const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: Math.max(16, GLOBAL_CONCURRENCY),
    maxFreeSockets: 64,
    scheduling: "lifo",
})
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: Math.max(16, GLOBAL_CONCURRENCY),
    maxFreeSockets: 64,
    scheduling: "lifo",
})
function getDirectAgent(protocol) {
    return protocol === "https:" ? httpsAgent : httpAgent
}
function isVideasyCdnHostname(hostname) {
    return VIDEASY_CDN_HOST_RE.test(String(hostname || ""))
}
const CNO_CDN_HOST_RE = /^v\.[a-z0-9-]+\.top$/i
function isCnoCdnHostname(hostname) {
    return CNO_CDN_HOST_RE.test(String(hostname || ""))
}
const FILESUN_CDN_HOST_RE =
    /(?:^|\.)(vmpx\.online|vmnow\.online|vidmoly\.(?:to|me|net)|embedsun\.cc)$/i
function isFilesunCdnHostname(hostname) {
    return FILESUN_CDN_HOST_RE.test(String(hostname || ""))
}



function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function acquireGlobalSlot() {
    if (globalActive < GLOBAL_CONCURRENCY) {
        globalActive += 1
        return Promise.resolve(() => {
            globalActive = Math.max(0, globalActive - 1)
            const next = globalWaiters.shift()
            if (next) next()
        })
    }
    return new Promise((resolve, reject) => {
        const waiter = () => {
            globalActive += 1
            resolve(() => {
                globalActive = Math.max(0, globalActive - 1)
                const n = globalWaiters.shift()
                if (n) n()
            })
        }
        globalWaiters.push(waiter)
        setTimeout(() => {
            const idx = globalWaiters.indexOf(waiter)
            if (idx < 0) return
            globalWaiters.splice(idx, 1)
            reject(new Error("global busy"))
        }, HOST_WAIT_MS)
    })
}

function acquireHostSlot(hostname) {
    const key = String(hostname || "").toLowerCase()
    const state = hostInflight.get(key) || { active: 0, waiters: [] }
    hostInflight.set(key, state)
    const hostReady =
        state.active < HOST_CONCURRENCY
            ? Promise.resolve().then(() => {
                  state.active += 1
                  return () => releaseHostSlot(key)
              })
            : new Promise((resolve, reject) => {
                  const waiter = () => {
                      state.active += 1
                      resolve(() => releaseHostSlot(key))
                  }
                  state.waiters.push(waiter)
                  setTimeout(() => {
                      const idx = state.waiters.indexOf(waiter)
                      if (idx < 0) return
                      state.waiters.splice(idx, 1)
                      reject(new Error("host busy"))
                  }, HOST_WAIT_MS)
              })
    return Promise.all([acquireGlobalSlot(), hostReady]).then(([releaseGlobal, releaseHost]) => () => {
        releaseHost()
        releaseGlobal()
    })
}

function releaseHostSlot(key) {
    const state = hostInflight.get(key)
    if (!state) return
    state.active = Math.max(0, state.active - 1)
    const next = state.waiters.shift()
    if (next) next()
    else if (state.active === 0) hostInflight.delete(key)
}


/** Reclaim leaked concurrency if active counts drift (redirect races, killed sockets). */
function snapshotSlotStats() {
    let hostActive = 0
    let hostWaiters = 0
    const hosts = []
    for (const [host, state] of hostInflight) {
        hostActive += state.active
        hostWaiters += state.waiters.length
        if (state.active || state.waiters.length) {
            hosts.push({ host, active: state.active, waiters: state.waiters.length })
        }
    }
    return {
        globalActive,
        globalWaiters: globalWaiters.length,
        hostActive,
        hostWaiters,
        hosts: hosts.sort((a, b) => b.active - a.active).slice(0, 20),
        limits: { host: HOST_CONCURRENCY, global: GLOBAL_CONCURRENCY },
    }
}

function reclaimLeakedSlots(reason = "watchdog") {
    let fixed = false
    if (globalActive > GLOBAL_CONCURRENCY || globalActive < 0) {
        console.warn(`[segproxy] reclaim globalActive ${globalActive} (${reason})`)
        globalActive = Math.min(Math.max(globalActive, 0), GLOBAL_CONCURRENCY)
        fixed = true
    }
    while (globalActive < GLOBAL_CONCURRENCY && globalWaiters.length) {
        const next = globalWaiters.shift()
        if (next) next()
        fixed = true
    }
    for (const [key, state] of hostInflight) {
        if (state.active > HOST_CONCURRENCY || state.active < 0) {
            console.warn(
                `[segproxy] reclaim host ${key} active=${state.active} (${reason})`
            )
            state.active = Math.min(Math.max(state.active, 0), HOST_CONCURRENCY)
            fixed = true
        }
        while (state.active < HOST_CONCURRENCY && state.waiters.length) {
            const next = state.waiters.shift()
            if (next) next()
            fixed = true
        }
        if (state.active === 0 && state.waiters.length === 0) hostInflight.delete(key)
    }
    return fixed
}

setInterval(() => {
    reclaimLeakedSlots("interval")
}, 15_000).unref?.()


function looksLikeObviousPlaylist(upstreamUrl) {
    if (looksLikePlaylistPath(upstreamUrl)) return true
    const lower = upstreamUrl.toLowerCase()
    const path = lower.split("?")[0]?.split("#")[0] ?? lower
    // Master playlists on the VAPlayer CDN have no .m3u8. They live under /pl/.
    return path.includes("/pl/")
}

const STREAM_PATH_PREFIX = "/api/cinepro/proxy/s/"
const SAFE_MEDIA_FILE =
    /^(?:page-\d+\.html|chunk-\d+\.js|[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.(?:ts|m4s|mp4|m4a|aac|vtt|png|jpg|jpeg|gif|webp))$/

function isSafeMediaPath(rel) {
    if (!rel || rel.includes("..") || rel.includes("\\")) return false
    const parts = rel.split("/")
    if (parts.length < 1 || parts.length > 8) return false
    if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._~-]{1,400}$/.test(part))) {
        return false
    }
    return SAFE_MEDIA_FILE.test(parts[parts.length - 1] || "")
}

function parseStreamPath(pathname) {
    if (!pathname.startsWith(STREAM_PATH_PREFIX)) return null
    const raw = pathname.slice(STREAM_PATH_PREFIX.length).split("/")
    if (raw.length < 3) return null
    let parts
    try {
        parts = raw.map((part) => decodeURIComponent(part))
    } catch {
        return null
    }
    const px = parts[0] || ""
    const pt = parts[1] || ""
    if (!px || !pt) return null
    if (parts[2] === "b") {
        const rel = parts.slice(3).join("/")
        if (!isSafeMediaPath(rel)) return null
        return { px, pt, file: rel, media: true }
    }
    if (parts.length !== 3) return null
    const file = parts[2] || ""
    if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) return null
    return { px, pt, file, media: false }
}

function applyStreamFile(payload, file, media) {
    let signed
    try {
        signed = new URL(payload.url)
    } catch {
        return null
    }
    if (!media) {
        const signedName = signed.pathname.split("/").pop() || ""
        if (file === signedName) return payload
        if (!SAFE_MEDIA_FILE.test(file)) return null
        const slash = signed.pathname.lastIndexOf("/")
        signed.pathname = `${signed.pathname.slice(0, slash + 1)}${file}`
        signed.search = ""
        signed.hash = ""
        return { url: signed.toString(), headers: payload.headers }
    }
    if (!isSafeMediaPath(file)) return null
    const folder = signed.pathname.split("/").filter(Boolean).slice(-2, -1)[0] || ""
    const pieces = file.split("/")
    if (pieces.length === 1) {
        const slash = signed.pathname.lastIndexOf("/")
        signed.pathname = `${signed.pathname.slice(0, slash + 1)}${file}`
    } else if (folder && pieces.includes(folder)) {
        signed.pathname = `/${pieces.join("/")}`
    } else {
        return null
    }
    signed.search = ""
    signed.hash = ""
    return { url: signed.toString(), headers: payload.headers }
}

function looksLikePlaylistPath(upstreamUrl) {
    const lower = upstreamUrl.toLowerCase()
    const path = lower.split("?")[0]?.split("#")[0] ?? lower
    if (path.includes(".m3u8") || path.endsWith(".m3u")) return true
    if (/\/(?:config|data)-[^/]+\.json$/.test(path)) return true
    return false
}

function looksLikeMediaSegmentPath(upstreamUrl) {
    const lower = upstreamUrl.toLowerCase()
    const path = lower.split("?")[0]?.split("#")[0] ?? lower
    const qIdx = lower.indexOf("?")
    const query = qIdx >= 0 ? lower.slice(qIdx + 1) : ""
    if (looksLikePlaylistPath(lower)) return false
    return (
        path.endsWith(".ts") ||
        path.endsWith(".m4s") ||
        path.endsWith(".mp4") ||
        path.endsWith(".m4a") ||
        path.endsWith(".aac") ||
        path.endsWith(".vtt") ||
        path.endsWith(".jpg") ||
        path.endsWith(".jpeg") ||
        path.endsWith(".png") ||
        path.includes("/segment") ||
        path.includes("ts-segment") ||
        /\/chunk-\d+\.js$/.test(path) ||
        (path.endsWith(".js") && query.includes("type=m3u8")) ||
        /\/page-\d+\.html$/.test(path)
    )
}

function safeEqual(a, b) {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    if (left.length !== right.length) return false
    return crypto.timingSafeEqual(left, right)
}

const playbackTokenCache = new Map()
let playbackTokenCacheSweepAt = 0
function verifyPlaybackToken(token) {
    if (!token) return false
    const now = Date.now()
    const cached = playbackTokenCache.get(token)
    if (cached) {
        if (cached > now) return true
        playbackTokenCache.delete(token)
    }
    const parts = token.split(".")
    if (parts.length !== 3) return false
    const [header, body, signature] = parts
    const expected = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url")
    if (!safeEqual(expected, signature)) return false
    let payload
    try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    } catch {
        return false
    }
    if (payload.scope !== "cinepro") return false
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return false
    playbackTokenCache.set(token, payload.exp * 1000)
    if (now >= playbackTokenCacheSweepAt) {
        playbackTokenCacheSweepAt = now + 60_000
        for (const [k, exp] of playbackTokenCache) {
            if (exp <= now) playbackTokenCache.delete(k)
        }
        if (playbackTokenCache.size > 4000) {
            let drop = playbackTokenCache.size - 3000
            for (const k of playbackTokenCache.keys()) {
                playbackTokenCache.delete(k)
                if (--drop <= 0) break
            }
        }
    }
    return true
}

function decodePx(px) {
    if (!px) return undefined
    const dot = px.lastIndexOf(".")
    if (dot <= 0) return undefined
    const body = px.slice(0, dot)
    const signature = px.slice(dot + 1)
    const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url")
    if (!safeEqual(expected, signature)) return undefined
    let json
    try {
        json = zlib.inflateSync(Buffer.from(body, "base64url")).toString("utf8")
    } catch {
        return undefined
    }
    let parsed
    try {
        parsed = JSON.parse(json)
    } catch {
        return undefined
    }
    if (typeof parsed.exp !== "number" || parsed.exp <= Date.now()) return undefined
    if (typeof parsed.url !== "string" || !parsed.url) return undefined
    const headers =
        parsed.headers && typeof parsed.headers === "object" && !Array.isArray(parsed.headers)
            ? Object.fromEntries(
                  Object.entries(parsed.headers).filter(([, value]) => typeof value === "string")
              )
            : {}
    return { url: parsed.url, headers }
}

function isPublicUrl(raw) {
    let target
    try {
        target = new URL(raw)
    } catch {
        return false
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") return false
    const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false
    if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false
    if (/^(10\.|192\.168\.|169\.254\.|127\.)/.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
    return true
}

function clientIp(req) {
    const cf = req.headers["cf-connecting-ip"]
    if (typeof cf === "string" && cf.trim()) return cf.trim().toLowerCase()
    const real = req.headers["x-real-ip"]
    if (typeof real === "string" && real.trim()) return real.trim().toLowerCase()
    const forwarded = req.headers["x-forwarded-for"]
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim().toLowerCase()
    }
    return ""
}

function isAthenaUpstreamHost(hostname) {
    const host = String(hostname || "").toLowerCase()
    return (
        host === "totallyacdn.cc" ||
        host.endsWith(".totallyacdn.cc") ||
        host === "cdn.hls.lol" ||
        host.endsWith(".hls.lol") ||
        host === "atlantic.st" ||
        host.endsWith(".atlantic.st")
    )
}

function writeJson(res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
        ...CORS,
    })
    res.end(payload)
}

function forwardToNext(req, res) {
    const headers = { ...req.headers }
    for (const key of HOP) delete headers[key]
    const upstream = http.request(
        {
            hostname: "127.0.0.1",
            port: NEXT_PORT,
            path: req.url,
            method: req.method,
            headers,
            timeout: 60_000,
        },
        (upstreamRes) => {
            const headers = { ...upstreamRes.headers }
            for (const key of HOP) delete headers[key]
            res.writeHead(upstreamRes.statusCode || 502, headers)
            upstreamRes.pipe(res)
        }
    )
    upstream.on("timeout", () => upstream.destroy())
    upstream.on("error", () => {
        if (!res.headersSent) writeJson(res, 502, { error: "Player is busy." })
        else res.destroy()
    })
    if (req.method === "GET" || req.method === "HEAD") upstream.end()
    else req.pipe(upstream)
}

function writeUpstream(res, upstreamRes, method, peeked) {
    const out = {}
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (HOP.has(key)) continue
        if (value !== undefined) out[key] = value
    }
    Object.assign(out, CORS)
    out["x-accel-buffering"] = "no"
    // Athena disguises fMP4 as image/* — MSE needs a media type.
    const ctype = String(out["content-type"] || out["Content-Type"] || "").toLowerCase()
    if (
        ctype.startsWith("image/") ||
        ctype.includes("iso.segment") ||
        ctype === "application/octet-stream"
    ) {
        // CNO/Athena disguise fMP4 as images. Chrome MSE is happier with video/mp4.
        out["content-type"] = "video/mp4"
        delete out["Content-Type"]
    }
    res.writeHead(upstreamRes.statusCode || 502, out)
    if (method === "HEAD") {
        upstreamRes.resume()
        res.end()
        return
    }
    for (const chunk of peeked) res.write(chunk)
    upstreamRes.pipe(res)
}

function peekThenSend(req, res, upstreamRes, method) {
    if (method === "HEAD") {
        writeUpstream(res, upstreamRes, method, [])
        return
    }
    const contentType = String(upstreamRes.headers["content-type"] || "").toLowerCase()
    if (contentType.includes("mpegurl")) {
        upstreamRes.destroy()
        forwardToNext(req, res)
        return
    }

    let settled = false
    upstreamRes.once("data", (chunk) => {
        if (settled) return
        settled = true
        upstreamRes.pause()
        const sample = chunk.subarray(0, 24).toString("utf8").replace(/^\uFEFF/, "").trimStart()
        if (sample.startsWith("#EXTM3U")) {
            upstreamRes.destroy()
            forwardToNext(req, res)
            return
        }
        // Put the bytes back. pipe() sends them with the rest of the file.
        upstreamRes.unshift(chunk)
        writeUpstream(res, upstreamRes, method, [])
    })
    upstreamRes.once("end", () => {
        if (settled || res.headersSent) return
        settled = true
        writeUpstream(res, upstreamRes, method, [])
    })
    upstreamRes.on("error", () => {
        if (!res.headersSent) writeJson(res, 502, { error: "Upstream did not answer." })
        else res.destroy()
    })
}

function streamSegment(req, res, payload, peek) {
    const method = req.method === "HEAD" ? "HEAD" : "GET"
    const range = typeof req.headers.range === "string" ? req.headers.range : undefined
    let finished = false
    let releaseSlot = null
    let slotReleased = false
    let currentUpstream = null
    /** Bumped on every redirect/retry so dead hops cannot finish() or release the slot. */
    let attemptGen = 0

    const releaseOnce = () => {
        if (slotReleased) return
        slotReleased = true
        if (releaseSlot) {
            const release = releaseSlot
            releaseSlot = null
            try {
                release()
            } catch {}
        }
    }

    const finish = () => {
        if (finished) return
        finished = true
        if (currentUpstream) {
            const stuck = currentUpstream
            currentUpstream = null
            try {
                stuck.destroy()
            } catch {}
        }
        releaseOnce()
    }
    res.on("close", finish)

    const attempt = (targetUrl, redirectsLeft, retriesLeft) => {
        if (finished || res.headersSent) {
            finish()
            return
        }
        if (!isPublicUrl(targetUrl)) {
            writeJson(res, 502, {
                error: "Upstream is not allowed.",
                detail: targetUrl.slice(0, 120),
            })
            finish()
            return
        }
        const gen = ++attemptGen
        const target = new URL(targetUrl)
        const headers = {
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ...payload.headers,
            Host: target.host,
        }
        if (isAthenaUpstreamHost(target.hostname)) {
            const viewer = clientIp(req)
            if (viewer) headers["X-Viewer-Ip"] = viewer
        }
        if (range) headers.Range = range
        if (peek) headers["Accept-Encoding"] = "identity"
        // Cine4K master rejects any Origin/Referer (403).
        if (
            target.hostname === "cine4k.mpddash.workers.dev" ||
            target.hostname.endsWith(".mpddash.workers.dev")
        ) {
            delete headers.Origin
            delete headers.Referer
            delete headers.origin
            delete headers.referer
        }
        for (const key of HOP) delete headers[key]
        delete headers["content-length"]

        const lib = target.protocol === "https:" ? https : http
        const useWarp =
            isCnoCdnHostname(target.hostname) ||
            isFilesunCdnHostname(target.hostname) /* vidmoly/vmnow/vmpx 403 .ts on Contabo DC */
        const upstream = lib.request(
            {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || (target.protocol === "https:" ? 443 : 80),
                path: `${target.pathname}${target.search}`,
                method,
                headers,
                timeout: 20_000,
                agent: useWarp ? getWarpAgent() : getDirectAgent(target.protocol),
            },
            (upstreamRes) => {
                // Stale hop (redirect/retry already moved on).
                if (gen !== attemptGen || finished || res.headersSent) {
                    upstreamRes.resume()
                    return
                }
                const status = upstreamRes.statusCode || 502
                const location = upstreamRes.headers.location
                if (
                    location &&
                    redirectsLeft > 0 &&
                    (status === 301 ||
                        status === 302 ||
                        status === 303 ||
                        status === 307 ||
                        status === 308)
                ) {
                    upstreamRes.resume()
                    let nextUrl
                    try {
                        nextUrl = new URL(location, targetUrl).toString()
                    } catch {
                        writeJson(res, 502, { error: "Upstream redirect is invalid." })
                        finish()
                        return
                    }
                    // Invalidate this hop WITHOUT destroy() — destroy sync-emits
                    // error and previously raced finish()/releaseSlot.
                    attemptGen += 1
                    if (currentUpstream === upstream) currentUpstream = null
                    attempt(nextUrl, redirectsLeft - 1, retriesLeft)
                    return
                }

                // Mid-watch HLS: CDN 429/503 — drain, backoff, retry.
                if (
                    !peek &&
                    UPSTREAM_RETRY_STATUSES.has(status) &&
                    retriesLeft > 0 &&
                    method === "GET"
                ) {
                    upstreamRes.resume()
                    const waitMs =
                        UPSTREAM_RETRY_BASE_MS * (UPSTREAM_RETRIES - retriesLeft + 1)
                    attemptGen += 1
                    if (currentUpstream === upstream) currentUpstream = null
                    sleep(waitMs).then(() => {
                        if (finished || res.headersSent) {
                            finish()
                            return
                        }
                        attempt(targetUrl, redirectsLeft, retriesLeft - 1)
                    })
                    return
                }

                // Successful (or final) response — keep host slot until body ends.
                upstreamRes.on("close", finish)
                upstreamRes.on("end", finish)

                if (peek) {
                    peekThenSend(req, res, upstreamRes, method)
                    return
                }
                writeUpstream(res, upstreamRes, method, [])
            }
        )
        currentUpstream = upstream
        upstream.on("timeout", () => {
            if (gen !== attemptGen) return
            upstream.destroy(new Error("upstream timeout"))
        })
        upstream.on("error", (err) => {
            // Dead hop after redirect/retry — never finish() or release the slot.
            if (gen !== attemptGen) return
            if (finished || res.headersSent) {
                finish()
                return
            }
            if (retriesLeft > 0 && method === "GET") {
                const waitMs =
                    UPSTREAM_RETRY_BASE_MS * (UPSTREAM_RETRIES - retriesLeft + 1)
                attemptGen += 1
                if (currentUpstream === upstream) currentUpstream = null
                sleep(waitMs).then(() => {
                    if (finished || res.headersSent) {
                        finish()
                        return
                    }
                    attempt(targetUrl, redirectsLeft, retriesLeft - 1)
                })
                return
            }
            writeJson(res, 502, {
                error: "Upstream did not answer.",
                detail: String(err?.message || err || "error").slice(0, 160),
                host: target.hostname,
            })
            finish()
        })
        upstream.end()
    }

    acquireHostSlot(new URL(payload.url).hostname)
        .then((release) => {
            if (finished || res.headersSent) {
                try {
                    release()
                } catch {}
                return
            }
            releaseSlot = release
            attempt(payload.url, 5, UPSTREAM_RETRIES)
        })
        .catch((err) => {
            if (finished || res.headersSent) return
            writeJson(res, 502, {
                error: "Upstream did not answer.",
                detail: String(err?.message || err || "slot").slice(0, 80),
            })
            finish()
        })
}


async function refreshBlocklist() {
    if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) return
    let conn
    try {
        const mysql = await import("mysql2/promise")
        conn = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: Number(process.env.MYSQL_PORT || 3306),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            connectTimeout: 4000,
        })
        const [rows] = await conn.query(
            "SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1",
            ["security_ip_blocklist"]
        )
        const raw = Array.isArray(rows) && rows[0] ? rows[0].setting_value : ""
        const parsed = raw ? JSON.parse(raw) : []
        const next = new Set()
        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (entry && typeof entry.ip === "string" && entry.ip.trim()) {
                    next.add(entry.ip.trim().toLowerCase())
                }
            }
        }
        blockedIps = next
    } catch (error) {
        console.error("segproxy blocklist refresh failed", error instanceof Error ? error.message : error)
    } finally {
        if (conn) await conn.end().catch(() => {})
    }
}

const server = http.createServer((req, res) => {
    try {
        const u = new URL(req.url || "/", "http://127.0.0.1")
        if (u.pathname === "/__segproxy_stats") {
            reclaimLeakedSlots("stats")
            writeJson(res, 200, snapshotSlotStats())
            return
        }
    } catch {}

    const url = new URL(req.url || "/", "http://127.0.0.1")

    if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain", ...CORS })
        res.end("ok")
        return
    }

    if (req.method === "OPTIONS") {
        res.writeHead(204, CORS)
        res.end()
        return
    }

    if (!url.pathname.startsWith("/api/cinepro/proxy")) {
        writeJson(res, 404, { error: "Not found." })
        return
    }

    // Browser cannot verify signed ?px= (needs AUTH_SECRET). Unwrap VA CDN
    // targets so MediaPlayer can play on the viewer IP instead of proxy 401.
    if (url.searchParams.get("unwrap") === "1") {
        let payload = decodePx(url.searchParams.get("px") || "")
        if (!payload) {
            const hrefRaw = url.searchParams.get("href") || ""
            try {
                const href = new URL(hrefRaw, "https://www.chillflix.pw")
                if (href.pathname.includes("/api/cinepro/proxy")) {
                    payload = decodePx(href.searchParams.get("px") || "")
                    if (!payload) {
                        const data = href.searchParams.get("data")
                        if (data) {
                            try {
                                const parsed = JSON.parse(decodeURIComponent(data))
                                if (typeof parsed?.url === "string" && parsed.url) {
                                    payload = {
                                        url: parsed.url,
                                        headers:
                                            parsed.headers && typeof parsed.headers === "object"
                                                ? Object.fromEntries(
                                                      Object.entries(parsed.headers).filter(
                                                          ([, v]) => typeof v === "string"
                                                      )
                                                  )
                                                : {},
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            } catch {}
        }
        if (!payload?.url) {
            writeJson(res, 400, { ok: false, error: "Invalid or expired proxy payload." })
            return
        }
        let host = ""
        try {
            host = new URL(payload.url).hostname.toLowerCase()
        } catch {
            writeJson(res, 400, { ok: false, error: "Bad upstream URL." })
            return
        }
        const vaHost =
            /(?:^|\.)(strategicgrowthpartners|influencerstrategygroup|nicheauthorityengine|remoteconsultinggroup|boldvisionstrategy|onlinecoachingacademy|onlinecoursecreator)\.site$/i.test(
                host
            ) ||
            /(?:^|\.)stellarconductornexus\.com$/i.test(host) ||
            (host.endsWith(".site") && /\/pl\//i.test(payload.url))
        if (!vaHost) {
            writeJson(res, 403, { ok: false, error: "Unwrap limited to VAPlayer CDN hosts." })
            return
        }
        writeJson(res, 200, {
            ok: true,
            url: payload.url,
            headers: payload.headers || {},
        })
        return
    }

    const streamed = parseStreamPath(url.pathname)
    const px = streamed?.px || url.searchParams.get("px")
    const pt = url.searchParams.get("pt") || streamed?.pt || ""
    let payload = decodePx(px)
    if (payload && streamed) {
        payload = applyStreamFile(payload, streamed.file, streamed.media)
    }
    const allowed = Boolean(payload && isPublicUrl(payload.url))
    // Extensionless Movy pieces (paleoak, emptylemon, …) are media with no
    // filename suffix. Playlists still go to Next so their links can be rewritten.
    const knownSegment = Boolean(allowed && looksLikeMediaSegmentPath(payload.url))
    const obviousPlaylist = !payload || looksLikeObviousPlaylist(payload.url)

    if (!allowed || obviousPlaylist) {
        // Playlists are rewritten by Next, which reads the token from the query.
        // Sibling video URLs keep the token in the path so it is not dropped.
        if (streamed?.pt && !url.searchParams.get("pt")) {
            url.searchParams.set("pt", streamed.pt)
            req.url = `${url.pathname}?${url.searchParams.toString()}`
        }
        forwardToNext(req, res)
        return
    }

    const ip = clientIp(req)
    if (ip && blockedIps.has(ip)) {
        writeJson(res, 403, { error: "Access denied." })
        return
    }

    if (!verifyPlaybackToken(pt)) {
        writeJson(res, 403, { error: "Invalid or expired playback token." })
        return
    }

    streamSegment(req, res, payload, !knownSegment)
})

server.requestTimeout = 0
server.headersTimeout = 20_000
server.keepAliveTimeout = 65_000
server.listen(PORT, "127.0.0.1", () => {
    console.log(`segproxy listening on 127.0.0.1:${PORT}`)
    refreshBlocklist()
    setInterval(refreshBlocklist, 60_000).unref()
})
