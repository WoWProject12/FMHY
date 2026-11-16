import {
  VIDEASY_API,
  VIDEASY_BROWSER_HEADERS,
  VIDEASY_ENC_VERSION,
  VIDEASY_SERVERS,
  normalizeImdbId,
  type VideasyMedia,
} from "@/lib/videasy-api"
import { decryptStreamcryptoPayload } from "@/lib/providers/movy-client-resolver"

export type VideasyClientMedia = VideasyMedia

export type VideasyClientStream = {
  url: string
  type: "hls" | "file"
  quality: string
}

export type VideasyClientResolveResult = {
  streams: VideasyClientStream[]
  failureReason?: string
}

export type VideasyClientResolveOptions = {
  /** Called when the labeled ladder grows (first city, then late 4K, …). */
  onPartial?: (streams: VideasyClientStream[]) => void
  /**
   * Starting-toast progress (session → cities → retry). Keep messages short —
   * MediaPlayer overlays them as `Starting Videasy… {phase}`.
   */
  onProgress?: (phase: string) => void
}

type TitleMeta = {
  title: string
  year: string
  imdbId: string
}

type ServerHit = {
  streams: VideasyClientStream[]
  blocked?: boolean
  fetchError?: string
  decryptError?: string
}

type SeedCacheEntry = {
  seed: string
  expiresAt: number
}

/** Prefer the cities that EncDec marks as likely 4K; return as soon as one hits. */
const PRIORITY_SERVERS = ["miami"] as const
const SERVER_FETCH_TIMEOUT_MS = 4_000
const PRIORITY_FETCH_TIMEOUT_MS = 3_500
/** Rest cities start after this, or immediately once a priority city is usable. */
const REST_CITY_STAGGER_MS = 40
/**
 * One city at a time. Parallel miami+boise looked faster on the VPS but
 * doubled /seed pressure and pushed real users into mint 429/503 soft-gap
 * (~16s). Miami-only first paint is the stable path.
 */
const MAX_CITY_INFLIGHT = 1
const SEED_CACHE_SLACK_MS = 5_000

/**
 * Prefetch pool: movy/vidy cache one seed per title, but upstream seeds are
 * effectively one-shot per city. We keep a small pool so Sources-open warmup
 * covers miami+boise without a mint stampede on tap.
 */
/** One warm seed is enough for first city; more stamps the mint into 429. */
const SEED_POOL_TARGET = 1
/** Serialize exclusive bridge seeds so miami+boise do not stampede wecollege. */
const SEED_MIN_GAP_MS = 200
/** Hard wall for tap → first stream / give-up (keeps Starting from hanging). */
const RESOLVE_BUDGET_MS = 45_000
/** Keep a resolved ladder so Sources tap can return instantly after embed warmup. */
const STREAM_CACHE_TTL_MS = 90_000
const seedPool = new Map<string, SeedCacheEntry[]>()
const seedMintInflight = new Map<string, Promise<string | null>>()
const streamCache = new Map<
  string,
  { streams: VideasyClientStream[]; expiresAt: number }
>()
const streamPrefetchInflight = new Map<string, Promise<VideasyClientStream[]>>()
/** Global seed queue — one bridge/mint seed at a time across all titles. */
let seedQueue: Promise<unknown> = Promise.resolve()
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function mediaCacheKey(media: VideasyClientMedia): string {
  if (media.type === "tv") {
    return `tv:${media.tmdbId}:${Math.max(1, Number(media.season) || 1)}:${Math.max(1, Number(media.episode) || 1)}`
  }
  return `movie:${media.tmdbId}`
}

function rememberStreams(media: VideasyClientMedia, streams: VideasyClientStream[]) {
  if (!streams.length) return
  streamCache.set(mediaCacheKey(media), {
    streams: streams.map((s) => ({ ...s })),
    expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
  })
}

function takeCachedStreams(media: VideasyClientMedia): VideasyClientStream[] | null {
  const key = mediaCacheKey(media)
  const hit = streamCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now() || !hit.streams.length) {
    streamCache.delete(key)
    return null
  }
  return hit.streams.map((s) => ({ ...s }))
}

function poolOf(tmdbId: string): SeedCacheEntry[] {
  const list = seedPool.get(tmdbId) || []
  const now = Date.now()
  const live = list.filter((e) => e.expiresAt - SEED_CACHE_SLACK_MS > now)
  if (live.length !== list.length) seedPool.set(tmdbId, live)
  return live
}

function rememberSeed(tmdbId: string, seed: string, ttlMs = 30_000) {
  const list = poolOf(tmdbId)
  // BFF/relay cache can return the same seed twice — duplicates cause both
  // miami+boise to share one seed → STREAMCRYPTO_SEED_INVALID.
  if (list.some((e) => e.seed === seed)) return
  const ttl = Math.min(55_000, Math.max(8_000, ttlMs)) - SEED_CACHE_SLACK_MS
  const entry: SeedCacheEntry = {
    seed,
    expiresAt: Date.now() + Math.max(3_000, ttl),
  }
  list.push(entry)
  seedPool.set(tmdbId, list)
}

function takePooledSeed(tmdbId: string): string | null {
  const list = poolOf(tmdbId)
  const next = list.shift()
  seedPool.set(tmdbId, list)
  return next?.seed ?? null
}

function invalidateSeed(tmdbId: string) {
  seedPool.delete(tmdbId)
  seedMintInflight.delete(tmdbId)
}

/**
 * Warm Videasy seed pool before the user taps (Sources sheet open / embed mount).
 * Hides the mint RTT that movy/vidy avoid via browser→api direct + Map cache.
 */
/**
 * Prefetch on embed load / Sources open:
 *  1) Warm the hidden vidy.st sslip bridge iframe (saves ~200–800ms on tap)
 *  2) Mint a seed via the bridge (viewer IP) into the pool
 * Never hits the VPS mint tunnel here — mintSeedOnce allowMintFallback=false.
 */
/** iOS/Android nested iframes often block the third-party vidy.st bridge. */
function isLikelyMobileVideasyHost(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent || ""
  return /iPhone|iPad|iPod|Android|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
    ua
  )
}

export function prefetchVideasySeed(tmdbId: string): void {
  const id = String(tmdbId || "").trim()
  if (!/^\d+$/.test(id)) return
  if (typeof window === "undefined") return
  markViewerDirectDeadIfNonNative()
  // Always warm the movy.sx.anyip viewer-IP bridge (iframe). Do NOT mint via
  // BFF here — that stampeded movy-relay into mint_soft_gap / 429 storms.
  // Bridge only — seeding here competed with the tap and caused 429 storms.
  void warmVideasyOriginBridge()
}

/**
 * Resolve miami/boise into a short cache while the embed is idle so the
 * Sources tap can return immediately instead of waiting on seed+city RTT.
 */
export function prefetchVideasyResolve(media: VideasyClientMedia): void {
  if (typeof window === "undefined") return
  const id = String(media?.tmdbId || "").trim()
  if (!/^\d+$/.test(id)) return
  // Warm bridge only. Full resolve-prefetch doubled seed traffic and fed the
  // shared mint into 429/503 so taps hung ~16s on the BFF fallback.
  markViewerDirectDeadIfNonNative()
  void warmVideasyOriginBridge()
}

/** Warm bridge iframe early so tap does not wait on sslip TLS + ready ping. */
export function warmVideasyOriginBridge(): void {
  if (typeof window === "undefined") return
  markViewerDirectDeadIfNonNative()
  void ensureVideasyOriginBridge()
}

async function mintSeedOnce(
  tmdbId: string,
  opts?: { pool?: boolean; fresh?: boolean; allowMintFallback?: boolean }
): Promise<string | null> {
  const pool = opts?.pool !== false
  const fresh = Boolean(opts?.fresh)
  // Viewer path must NOT fall through to BFF/mint on every city miss — that
  // stampeded the egress tunnel into permanent soft-gap while bridge was
  // only rate-limited briefly.
  const allowMintFallback = opts?.allowMintFallback === true
  const inflightKey = fresh ? `${tmdbId}:fresh` : tmdbId

  // Pool callers share one in-flight mint (do not wait-then-mint-again).
  if (pool) {
    const existing = seedMintInflight.get(inflightKey)
    if (existing) return existing
  }

  const run = async (): Promise<string | null> => {
    // Exclusive city claims must use fresh=1 so upstream does not recycle the
    // same one-shot seed (shared seed → empty Quality).
    const wantFresh = !pool || fresh
    // 1) Same-tab only on native movy/vidy document Origin (real CF ACL match).
    //    Chillflix.* always CF-403s — never burn 6–8s before the bridge.
    markViewerDirectDeadIfNonNative()
    if (!viewerDirectDead && isNativeVideasyHostOrigin()) {
      const direct = await fetchSeedViaViewerDirectDetailed(
        tmdbId,
        wantFresh,
        6_000
      )
      if (direct.seed) {
        if (pool) rememberSeed(tmdbId, direct.seed, 30_000)
        return direct.seed
      }
      if (direct.rateLimited) await sleep(500)
    }
    // 2) Viewer-IP origin-bridge (usually the real path on chillflix.*).
    // When allowMintFallback is set we are already on the BFF last-resort path —
    // skip bridge retries so the 5.5s city race still has time to use the mint.
    if (!allowMintFallback) for (let attempt = 0; attempt < (isNativeVideasyHostOrigin() ? 4 : 2); attempt++) {
      if (attempt > 0) {
        resetVideasyOriginBridge()
        videasyBridgeUrlIndex += 1
        await sleep(300 * attempt)
      }
      const bridged = await fetchSeedViaOriginBridgeDetailed(tmdbId, wantFresh)
      if (bridged.seed) {
        if (pool) rememberSeed(tmdbId, bridged.seed, 30_000)
        return bridged.seed
      }
      if (bridged.rateLimited) {
        await sleep(600 * (attempt + 1))
        continue
      }
      if (typeof console !== "undefined") {
        console.warn("[videasy] bridge seed miss", attempt, tmdbId)
      }
    }
    // 3) NON-COMPLIANT last resort — VPS/mint tunnel, not viewer IP.
    if (!allowMintFallback) return null
    if (typeof console !== "undefined") {
      console.warn(
        "[videasy] NON-COMPLIANT mint fallback via BFF/relay — resolve is NOT viewer-IP"
      )
    }
    return fetchSeedViaApiNetwork(tmdbId, { pool, fresh })
  }

  // Serialize all seed ops so parallel cities cannot stampede wecollege.
  const pending = seedQueue.then(run, run)
  seedQueue = pending.then(
    () => sleep(SEED_MIN_GAP_MS),
    () => sleep(SEED_MIN_GAP_MS)
  )

  if (pool) {
    seedMintInflight.set(inflightKey, pending)
    try {
      return await pending
    } finally {
      if (seedMintInflight.get(inflightKey) === pending) {
        seedMintInflight.delete(inflightKey)
      }
    }
  }
  return pending
}

async function ensureSeedPool(tmdbId: string, target: number): Promise<void> {
  while (poolOf(tmdbId).length < target) {
    const before = poolOf(tmdbId).length
    const seed = await mintSeedOnce(tmdbId, {
      pool: true,
      fresh: false,
      allowMintFallback: false,
    })
    if (!seed) break
    if (poolOf(tmdbId).length === before) {
      // Duplicate after fresh mint — stop to avoid a 429 stampede.
      break
    }
  }
}

/** Claim one seed for a city (pool first, else exclusive mint). One-shot. */
async function claimSeedForCity(
  tmdbId: string,
  allowMintFallback = false
): Promise<string | null> {
  const pooled = takePooledSeed(tmdbId)
  if (pooled) {
    return pooled
  }
  return mintSeedOnce(tmdbId, { pool: false, allowMintFallback })
}

function detectType(url: string, hint?: string): "hls" | "file" {
  const lower = (hint ?? "").toLowerCase()
  if (
    lower.includes("hls") ||
    lower.includes("m3u8") ||
    url.toLowerCase().includes(".m3u8")
  ) {
    return "hls"
  }
  return "file"
}

function normalizeQuality(raw?: string): string {
  if (!raw) return "Auto"
  const trimmed = raw.trim()
  if (/^\d{3,4}p$|^4K$|^8K$|^HD$|^SD$/i.test(trimmed)) {
    if (/^4k$/i.test(trimmed) || /^2160p$/i.test(trimmed)) return "4K"
    if (/^8k$/i.test(trimmed)) return "8K"
    if (/^hd$/i.test(trimmed)) return "720p"
    if (/^sd$/i.test(trimmed)) return "480p"
    return trimmed.toLowerCase()
  }
  // Pull a rung out of longer host labels ("1080p WEB-DL", "UHD 2160p").
  const m = trimmed.match(/\b(2160p|1440p|1080p|720p|480p|360p|4K|8K)\b/i)
  if (m?.[1]) {
    const tok = m[1]
    if (/^4k$/i.test(tok) || /^2160p$/i.test(tok)) return "4K"
    if (/^8k$/i.test(tok)) return "8K"
    return tok.toLowerCase()
  }
  if (/\buhd\b|\b4\s*k\b/i.test(trimmed)) return "4K"
  if (/\bfull\s*hd\b|\bfhd\b/i.test(trimmed)) return "1080p"
  return "Auto"
}

function scoreQuality(raw?: string): number {
  const q = normalizeQuality(raw).toUpperCase()
  if (q === "2160P" || q === "4K") return 2160
  if (q === "1440P") return 1440
  if (q === "1080P") return 1080
  if (q === "720P") return 720
  if (q === "480P") return 480
  if (q === "360P") return 360
  return 0
}

async function fetchMovieMeta(tmdbId: string): Promise<TitleMeta | null> {
  try {
    const response = await fetch(`/api/movie/${encodeURIComponent(tmdbId)}`, {
      cache: "no-store",
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      title?: string
      release_date?: string
      imdb_id?: string
      external_ids?: { imdb_id?: string }
    }

    if (!data.title) return null

    return {
      title: data.title,
      year: data.release_date?.slice(0, 4) ?? "",
      imdbId: normalizeImdbId(data.imdb_id ?? data.external_ids?.imdb_id),
    }
  } catch {
    return null
  }
}

async function fetchTvMeta(tmdbId: string): Promise<TitleMeta | null> {
  try {
    const response = await fetch(`/api/tv/${encodeURIComponent(tmdbId)}`, {
      cache: "no-store",
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      name?: string
      first_air_date?: string
      imdb_id?: string
      external_ids?: { imdb_id?: string }
    }

    if (!data.name) return null

    return {
      title: data.name,
      year: data.first_air_date?.slice(0, 4) ?? "",
      imdbId: normalizeImdbId(data.imdb_id ?? data.external_ids?.imdb_id),
    }
  } catch {
    return null
  }
}

const titleMetaCache = new Map<string, { meta: TitleMeta; expiresAt: number }>()

async function fetchTitleMeta(media: VideasyClientMedia): Promise<TitleMeta | null> {
  const key = `${media.type}:${media.tmdbId}`
  const hit = titleMetaCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.meta
  const meta =
    media.type === "tv"
      ? await fetchTvMeta(media.tmdbId)
      : await fetchMovieMeta(media.tmdbId)
  if (meta) {
    titleMetaCache.set(key, { meta, expiresAt: Date.now() + 10 * 60_000 })
  }
  return meta
}

function buildDirectSourcesUrl(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string
) {
  const title = encodeURIComponent(meta.title)
  const params = new URLSearchParams({
    mediaType: media.type === "movie" ? "movie" : "tv",
    tmdbId: media.tmdbId,
    imdbId: meta.imdbId,
    episodeId: String(media.type === "tv" ? media.episode ?? "1" : "1"),
    seasonId: String(media.type === "tv" ? media.season ?? "1" : "1"),
    enc: VIDEASY_ENC_VERSION,
    seed,
  })
  if (media.type === "movie") {
    params.set("year", meta.year)
  }
  return `${VIDEASY_API}/${server}/sources?title=${title}&${params.toString()}`
}

/**
 * Seed / city path (browser-origin resolve 2026-10-24):
 *
 * CF on api.wecollege.net uses a *substring* Origin ACL: any Origin whose
 * host string contains `vidy.st` or `movy.sx` gets 200 (+ ACAO:*). Exact
 * chillflix.pw / null / player.videasy.to → 403 CF HTML. www.movy.sx is
 * X-Frame-Options: DENY; www.vidy.st is framable but only postMessages
 * MEDIA_DATA (no stream export).
 *
 * Primary path (viewer IP + allowlisted Origin):
 *   sslip.io, nip.io and traefik.me sink 31.171.131.116, so the bridge host is anyip.dev.
 *   Hidden iframe → https://vidy.st.31-171-131-116.anyip.dev/bridge.html
 *   Document Origin contains `vidy.st` → CF accepts seed/city fetches from
 *   the viewer's browser. Results return via postMessage.
 *
 * Last resort only: BFF → movy-relay → mint tunnel (NOT viewer IP — logged
 * as NON-COMPLIANT).
 */
const VIDEASY_SEED_API = "https://api.wecollege.net"
/**
 * Atlantic Helios runner host. CF on api.wecollege.net allowlists Origins whose
 * host string contains `movy.sx` (see movy.sx.hls.lol/runner.js). Same pattern:
 * viewer IP + Accept:application/json only — no Referer spoof required.
 */
const VIDEASY_ORIGIN_BRIDGE_ORIGIN =
  "https://movy.sx.31-171-131-116.anyip.dev"
const VIDEASY_ORIGIN_BRIDGE_URLS = [
  `${VIDEASY_ORIGIN_BRIDGE_ORIGIN}/`, // index-runner.html + runner.js
  "https://vidy.st.31-171-131-116.anyip.dev/",
] as const
const VIDEASY_BRIDGE_SOURCE = "chillflix-videasy-bridge"
let videasyBridgeUrlIndex = 0

/** anyip.dev may rewrite the hostname; accept any *.anyip.dev bridge reply.
 *  event.source is still checked against our iframe window.
 */
function isVideasyBridgeOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    if (host.endsWith(".anyip.dev") || host === "anyip.dev") return true
    return host.includes("movy.sx") || host.includes("vidy.st")
  } catch {
    return false
  }
}

/**
 * Atlantic/Helios trick: CF Origin ACL on api.wecollege.net also accepts
 * requests whose Referer URL contains `movy.sx` / `vidy.st` when the client
 * is a real browser (TLS fingerprint). Datacenter IPs still 403.
 * This keeps seed+city on the VIEWER IP with no third-party iframe.
 */
function movyReferrerInit(timeoutMs = 8_000): RequestInit {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://www.chillflix.pw"
  return {
    credentials: "omit",
    mode: "cors",
    cache: "no-store",
    referrer: `${origin}/?x=movy.sx`,
    referrerPolicy: "unsafe-url",
    headers: { Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(timeoutMs),
  }
}


/**
 * True when we should attempt same-tab viewer-IP fetches to wecollege.
 * CF Origin ACL wants vidy.st/movy.sx, but real browsers also pass when
 * Referer contains those substrings (see movyReferrerInit). Always try on
 * chillflix.* so mobile does not depend on the nested anyip iframe.
 */
function isAllowlistedVideasyDocumentOrigin(): boolean {
  return typeof window !== "undefined"
}

function isNativeVideasyHostOrigin(): boolean {
  if (typeof window === "undefined") return false
  try {
    const host = String(window.location.hostname || "").toLowerCase()
    return host.includes("vidy.st") || host.includes("movy.sx")
  } catch {
    return false
  }
}

/** Same-tab chillflix→wecollege Referer path failed this session — skip it. */
let viewerDirectDead = false

/** Chillflix Origin is not CF-allowlisted. The Origin header is always the
 *  page origin (chillflix.*), so a movy.sx Referer cannot satisfy CF ACL.
 *  Skipping avoids burning 6–8s before the anyip bridge on every mobile tap.
 */
function markViewerDirectDeadIfNonNative(): void {
  if (typeof window === "undefined") return
  if (!isNativeVideasyHostOrigin()) viewerDirectDead = true
}

async function fetchSeedViaViewerDirectDetailed(
  tmdbId: string,
  fresh = false,
  timeoutMs = 7_000
): Promise<{ seed: string | null; rateLimited: boolean }> {
  if (typeof window === "undefined") {
    return { seed: null, rateLimited: false }
  }
  try {
    let url = `${VIDEASY_SEED_API}/seed?mediaId=${encodeURIComponent(tmdbId)}`
    if (fresh) url += `&fresh=1&_=${Date.now().toString(36)}`
    const res = await fetch(url, movyReferrerInit(timeoutMs))
    const text = await res.text()
    if (res.status === 429) return { seed: null, rateLimited: true }
    if (!res.ok) {
      if (/rate_limited|too many|429/i.test(text)) {
        return { seed: null, rateLimited: true }
      }
      return { seed: null, rateLimited: false }
    }
    const data = JSON.parse(text) as { seed?: string; error?: string }
    if (/rate_limited|too many|429/i.test(String(data.error || ""))) {
      return { seed: null, rateLimited: true }
    }
    const seed = String(data.seed || "").trim() || null
    if (seed && typeof console !== "undefined") {
      console.info(
        "[videasy] seed via viewer-direct (browser IP + movy Referer)",
        tmdbId,
        fresh ? "fresh" : "warm"
      )
    }
    return { seed, rateLimited: false }
  } catch {
    return { seed: null, rateLimited: false }
  }
}

async function fetchBlobViaViewerDirect(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string
): Promise<{ blob?: string; error?: string; blocked?: boolean }> {
  if (typeof window === "undefined") {
    return { error: "Viewer-direct unavailable." }
  }
  const url = buildDirectSourcesUrl(server, meta, media, seed)
  try {
    const res = await fetch(url, movyReferrerInit(SERVER_FETCH_TIMEOUT_MS + 2_000))
    const body = await res.text()
    return interpretCityBody(res.status, body)
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      error: timedOut
        ? "Videasy fetch timed out."
        : "Videasy viewer-direct city fetch failed.",
    }
  }
}




type BridgeResponse = {
  ok: boolean
  status: number
  text: string
  error?: string
  origin?: string
}

let bridgeIframe: HTMLIFrameElement | null = null
let bridgeReadyPromise: Promise<WindowProxy | null> | null = null
let bridgeReadyWin: WindowProxy | null | undefined

function resetVideasyOriginBridge() {
  try {
    bridgeIframe?.remove()
  } catch {
    /* ignore */
  }
  bridgeIframe = null
  bridgeReadyPromise = null
  bridgeReadyWin = undefined
}

export function primeVideasyBridgeGesture(): void {
  // Intentionally no window.open — blank anyip popups are unacceptable UX.
  // Warm the on-screen 12×12 runner iframe only.
  if (typeof window === "undefined") return
  void ensureVideasyOriginBridge()
}

function mountBridgeIframe(url: string, timeoutMs: number): Promise<WindowProxy | null> {
  if (typeof document === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe")
    iframe.setAttribute("aria-hidden", "true")
    iframe.setAttribute("title", "Videasy origin bridge")
    iframe.setAttribute("loading", "eager")
    // Keep inside the viewport — off-screen frames are frozen on mobile.
    // Slightly larger + low opacity so WebKit still schedules network.
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:12px;height:12px;opacity:0.05;pointer-events:none;border:0;z-index:2147483646"
    let settled = false
    const finish = (win: WindowProxy | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener("message", onReady)
      if (!win) {
        try {
          iframe.remove()
        } catch {
          /* ignore */
        }
      } else {
        bridgeIframe = iframe
      }
      resolve(win)
    }
    const onReady = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data as { source?: string; type?: string; ok?: boolean } | null
      if (!data) return
      if (data.source && data.source !== VIDEASY_BRIDGE_SOURCE) return
      if (data.type === "ready" || data.ok === true) {
        finish(iframe.contentWindow)
      }
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    window.addEventListener("message", onReady)
    iframe.addEventListener("load", () => {
      const requestId = `videasy-bridge-ping-${Math.random().toString(36).slice(2)}`
      const onPing = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return
        const data = event.data as {
          source?: string
          requestId?: string
          ok?: boolean
        } | null
        if (
          !data ||
          data.source !== VIDEASY_BRIDGE_SOURCE ||
          data.requestId !== requestId
        ) {
          return
        }
        window.removeEventListener("message", onPing)
        finish(data.ok ? iframe.contentWindow : null)
      }
      window.addEventListener("message", onPing)
      try {
        iframe.contentWindow?.postMessage(
          {
            source: VIDEASY_BRIDGE_SOURCE,
            requestId,
            op: "ping",
          },
          "*"
        )
      } catch {
        finish(null)
      }
    })
    iframe.src = url
    document.body.appendChild(iframe)
  })
}

function ensureVideasyOriginBridge(): Promise<WindowProxy | null> {
  if (typeof document === "undefined") return Promise.resolve(null)
  // Warm hit.
  if (bridgeReadyWin) return Promise.resolve(bridgeReadyWin)
  // In-flight — but if a prior attempt settled null, rebuild (do not stick dead).
  if (bridgeReadyPromise) {
    if (bridgeReadyWin === undefined) return bridgeReadyPromise
    if (bridgeReadyWin === null) resetVideasyOriginBridge()
    else return Promise.resolve(bridgeReadyWin)
  }

  bridgeReadyPromise = (async () => {
    // Race both anyip runner URLs in parallel (first ready wins).
    // Never open a visible popup/tab to anyip — users reject the blank page.
    const timeoutMs = isLikelyMobileVideasyHost() ? 12_000 : 9_000
    const urls = VIDEASY_ORIGIN_BRIDGE_URLS.map(
      (_, i) =>
        VIDEASY_ORIGIN_BRIDGE_URLS[
          (videasyBridgeUrlIndex + i) % VIDEASY_ORIGIN_BRIDGE_URLS.length
        ]!
    )
    const winner = await new Promise<WindowProxy | null>((resolve) => {
      let done = false
      let pending = urls.length
      const finish = (win: WindowProxy | null) => {
        pending -= 1
        if (done) return
        if (win) {
          done = true
          resolve(win)
          return
        }
        if (pending <= 0) resolve(null)
      }
      for (const url of urls) {
        void mountBridgeIframe(url, timeoutMs).then(finish)
      }
    })
    if (!winner) {
      videasyBridgeUrlIndex += 1
      bridgeReadyWin = null
      return null
    }
    bridgeReadyWin = winner
    return winner
  })()

  return bridgeReadyPromise
}

/**
 * Atlantic Helios runner protocol: one postMessage resolve → seed+city blob
 * from viewer IP with Origin https://movy.sx.… (CF allowlisted substring).
 */
async function resolveViaMovyRunner(
  media: VideasyClientMedia,
  city = "boise"
): Promise<{ seed: string; body: string } | null> {
  if (typeof window === "undefined") return null
  const win = await ensureVideasyOriginBridge()
  if (!win) return null
  const season = Math.max(1, Number(media.season) || 1)
  const episode = Math.max(1, Number(media.episode) || 1)
  const kind = media.type === "tv" ? "tv" : "movie"
  return await new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    let settled = false
    const finish = (value: { seed: string; body: string } | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve(value)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return
      if (!isVideasyBridgeOrigin(String(event.origin || ""))) return
      const data = event.data as {
        type?: string
        id?: number
        seed?: string
        body?: string
        error?: string
      } | null
      if (!data || data.id !== id) return
      if (data.type === "result" && data.seed && data.body) {
        finish({ seed: String(data.seed), body: String(data.body) })
        return
      }
      if (data.type === "error") {
        if (typeof console !== "undefined") {
          console.warn("[videasy] runner resolve error", data.error)
        }
        finish(null)
        return
      }
    }
    // runner.js TIMEOUT_MS=7000 per fetch; seed+city needs headroom past that.
    const timer = window.setTimeout(() => {
      if (typeof console !== "undefined") {
        console.warn("[videasy] runner resolve timeout")
      }
      finish(null)
    }, 16_000)
    window.addEventListener("message", onMessage)
    try {
      win.postMessage(
        {
          type: "resolve",
          id,
          tmdbId: String(media.tmdbId),
          kind,
          season,
          episode,
          city,
        },
        "*"
      )
    } catch {
      finish(null)
    }
  })
}

function bridgeRequest(
  op: "seed" | "city" | "fetch" | "ping",
  payload: Record<string, unknown>,
  timeoutMs = 6_000
): Promise<BridgeResponse | null> {
  if (typeof window === "undefined") return Promise.resolve(null)
  return ensureVideasyOriginBridge().then((win) => {
    if (!win) return null
    return new Promise((resolve) => {
      const requestId = `videasy-bridge-${Math.random().toString(36).slice(2)}`
      let settled = false
      const finish = (value: BridgeResponse | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        window.removeEventListener("message", onMessage)
        resolve(value)
      }
      const onMessage = (event: MessageEvent) => {
        if (event.source !== win) return
        if (!isVideasyBridgeOrigin(String(event.origin || ""))) return
        const data = event.data as
          | (BridgeResponse & { source?: string; requestId?: string })
          | null
        if (
          !data ||
          data.source !== VIDEASY_BRIDGE_SOURCE ||
          data.requestId !== requestId
        ) {
          return
        }
        finish({
          ok: Boolean(data.ok),
          status: Number(data.status) || 0,
          text: typeof data.text === "string" ? data.text : "",
          error: typeof data.error === "string" ? data.error : undefined,
          origin: typeof data.origin === "string" ? data.origin : undefined,
        })
      }
      const timer = window.setTimeout(() => finish(null), timeoutMs)
      window.addEventListener("message", onMessage)
      try {
        win.postMessage(
          {
            source: VIDEASY_BRIDGE_SOURCE,
            requestId,
            op,
            ...payload,
          },
          "*"
        )
      } catch {
        finish(null)
      }
    })
  })
}

async function fetchSeedViaOriginBridgeDetailed(
  tmdbId: string,
  fresh = false
): Promise<{ seed: string | null; rateLimited: boolean }> {
  const res = await bridgeRequest(
    "seed",
    { tmdbId, fresh: fresh ? 1 : 0 },
    isLikelyMobileVideasyHost() ? 12_000 : 8_000
  )
  if (!res) return { seed: null, rateLimited: false }
  if (res.status === 429) return { seed: null, rateLimited: true }
  const text = res.text || ""
  if (!res.ok) {
    try {
      const data = JSON.parse(text) as { error?: string }
      if (/rate_limited|too many|429/i.test(String(data.error || ""))) {
        return { seed: null, rateLimited: true }
      }
    } catch {
      /* CF HTML 403/etc */
    }
    return { seed: null, rateLimited: false }
  }
  try {
    const data = JSON.parse(text) as {
      seed?: string
      ttlMs?: number
      error?: string
    }
    if (/rate_limited|too many|429/i.test(String(data.error || ""))) {
      return { seed: null, rateLimited: true }
    }
    const seed = data.seed?.trim() || null
    if (seed && typeof console !== "undefined") {
      console.info(
        "[videasy] seed via origin-bridge (viewer IP + vidy.st Origin)",
        tmdbId,
        fresh ? "fresh" : "warm"
      )
    }
    // Do NOT rememberSeed here — caller decides (pool vs exclusive one-shot).
    return { seed, rateLimited: false }
  } catch {
    return { seed: null, rateLimited: false }
  }
}

async function fetchSeedViaOriginBridge(tmdbId: string): Promise<string | null> {
  const { seed } = await fetchSeedViaOriginBridgeDetailed(tmdbId, false)
  return seed
}

async function fetchSeedDirect(tmdbId: string): Promise<string | null> {
  return mintSeedOnce(tmdbId, { pool: true, allowMintFallback: true })
}

async function fetchSeedViaApiNetwork(
  tmdbId: string,
  opts?: { pool?: boolean; fresh?: boolean }
): Promise<string | null> {
  const pool = opts?.pool !== false
  const fresh = Boolean(opts?.fresh)
  // Soft-gap / 429: honor retryAfterMs but do NOT stampede mint (was 8).
  // Prefetch is disabled on chillflix; tap gets a few tries only.
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 350 * attempt))
      }
      const qs = new URLSearchParams({ tmdbId })
      // fresh=1 only on explicit remint / retry — avoids burned one-shot reuse.
      if (fresh || attempt > 0) qs.set("fresh", "1")
      const response = await fetch(`/api/videasy/seed?${qs.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(22_000),
      })
      if (
        response.status === 429 ||
        response.status === 502 ||
        response.status === 503
      ) {
        let wait = 700 * (attempt + 1)
        try {
          const j = (await response.clone().json()) as { retryAfterMs?: number }
          if (Number.isFinite(j.retryAfterMs) && (j.retryAfterMs as number) > 0) {
            // Honor mint soft-gap fully (was capped at 8s → re-stampeded rate_limited).
            wait = Math.min(45_000, Math.max(600, Number(j.retryAfterMs) + 200))
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) return null
        continue
      }
      const data = (await response.json()) as { seed?: string; ttlMs?: number }
      const seed = data.seed?.trim() || null
      if (seed) {
        if (pool) rememberSeed(tmdbId, seed, Number(data.ttlMs) || 30_000)
        return seed
      }
    } catch {
      // timeout / network — retry
    }
  }
  return null
}

async function fetchSeedViaApi(tmdbId: string): Promise<string | null> {
  return claimSeedForCity(tmdbId)
}

function interpretCityBody(
  status: number,
  body: string
): { blob?: string; error?: string; blocked?: boolean } {
  if (status === 403 || status === 503) {
    return { blocked: true, error: "Videasy city blocked this request." }
  }
  if (status === 400 || status === 401) {
    return { error: "Videasy seed expired or invalid." }
  }
  if (status < 200 || status >= 300) {
    return { error: `Videasy city HTTP ${status}.` }
  }
  const blob = body.trim()
  if (!blob || blob.length < 10) {
    return { error: "Videasy city returned an empty payload." }
  }
  if (blob.startsWith("<!DOCTYPE") || blob.startsWith("<html")) {
    return { error: "Videasy returned a non-encrypted payload." }
  }
  // Some cities return JSON {sources:[...]} already decrypted — treat as blob
  // only when encrypted (non-JSON). JSON without sources is an error.
  if (blob.startsWith("{")) {
    try {
      const parsed = JSON.parse(blob) as {
        sources?: unknown
        error?: string
        data?: string
      }
      if (typeof parsed.data === "string" && parsed.data.length > 10) {
        return { blob: parsed.data }
      }
      if (parsed.error) {
        return { error: String(parsed.error) }
      }
    } catch {
      /* fall through */
    }
    return { error: "Videasy returned a non-encrypted payload." }
  }
  return { blob }
}

/** City fetch via origin-bridge iframe (viewer IP + vidy.st Origin). */
async function fetchBlobViaOriginBridge(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string
): Promise<{ blob?: string; error?: string; blocked?: boolean }> {
  const url = buildDirectSourcesUrl(server, meta, media, seed)
  const res = await bridgeRequest("city", { url }, SERVER_FETCH_TIMEOUT_MS + 2_000)
  if (!res) {
    return { error: "Videasy origin-bridge unavailable." }
  }
  return interpretCityBody(res.status, res.text || "")
}

async function fetchBlobDirect(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string
): Promise<{ blob?: string; error?: string; blocked?: boolean }> {
  // 1) Same-tab Referer only on native movy/vidy (chillflix always skips).
  markViewerDirectDeadIfNonNative()
  if (
    !viewerDirectDead &&
    (isNativeVideasyHostOrigin() || isLikelyMobileVideasyHost())
  ) {
    const direct = await fetchBlobViaViewerDirect(server, meta, media, seed)
    if (direct.blob || direct.blocked) return direct
    if (/seed expired|HTTP 401|HTTP 400/i.test(direct.error || "")) {
      return direct
    }
  }

  // 2) Origin-bridge iframe (viewer IP + allowlisted Origin).
  const bridged = await fetchBlobViaOriginBridge(server, meta, media, seed)
  if (bridged.blob || bridged.blocked) return bridged
  if (bridged.error && !/origin-bridge unavailable/i.test(bridged.error)) {
    return bridged
  }

  // Prefer a concrete error from either path over a silent miss.
  return {
    error: bridged.error || "Videasy city fetch failed on viewer-IP paths.",
  }
}

async function fetchBlobViaApi(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string,
  timeoutMs = SERVER_FETCH_TIMEOUT_MS + 1_000
): Promise<{ blob?: string; error?: string; blocked?: boolean }> {
  try {
    const response = await fetch("/api/videasy/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        server,
        mediaType: media.type,
        tmdbId: media.tmdbId,
        title: meta.title,
        year: meta.year,
        imdbId: meta.imdbId,
        seasonId: media.season,
        episodeId: media.episode,
        seed,
      }),
    })

    const data = (await response.json()) as {
      blob?: string
      seed?: string
      error?: string
      blocked?: boolean
      cached?: boolean
    }

    if (!response.ok) {
      return { error: data.error ?? `Videasy fetch failed (HTTP ${response.status}).` }
    }

    // Prefer server seed on cache hits — blob decrypt requires the mint that made it.
    return { blob: data.blob, seed: data.seed, blocked: data.blocked }
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return { error: timedOut ? "Videasy fetch timed out." : "Videasy fetch request failed." }
  }
}

/** Local STREAMCRYPTO (movy/vidy path) — ~1ms, no enc-dec / BFF hop. */
function decryptLocal(
  blob: string,
  tmdbId: string,
  seed: string
): { sources?: Array<{ quality?: string; url: string; type?: string }>; error?: string } {
  try {
    const plain = decryptStreamcryptoPayload(blob, seed, tmdbId)
    const parsed = JSON.parse(plain) as {
      sources?: Array<{ quality?: string; url: string; type?: string }>
    }
    if (parsed.sources?.length) return { sources: parsed.sources }
    return { error: "Local decrypt returned no sources." }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Local STREAMCRYPTO decrypt failed.",
    }
  }
}

async function decryptDirect(
  blob: string,
  tmdbId: string,
  seed: string
): Promise<{ sources?: Array<{ quality?: string; url: string; type?: string }>; error?: string }> {
  // Fallback only — movy/vidy never hit enc-dec. One short try then BFF.
  try {
    const response = await fetch("https://enc-dec.app/api/dec-videasy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://enc-dec.app",
        Referer: "https://enc-dec.app/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3_500),
      body: JSON.stringify({ text: blob, id: tmdbId, seed }),
    })
    if (!response.ok || response.status === 204) {
      return { error: `Decrypt service returned HTTP ${response.status}.` }
    }
    const raw = (await response.text()).trim()
    if (!raw) return { error: "Decrypt returned an empty body." }
    const json = JSON.parse(raw) as {
      status: number
      result?: { sources?: Array<{ quality?: string; url: string; type?: string }> }
      error?: string
    }
    if (json.status !== 200 || !json.result?.sources?.length) {
      return { error: json.error ?? "Decrypt returned no sources." }
    }
    return { sources: json.result.sources }
  } catch {
    return { error: "Decrypt request failed." }
  }
}

async function decryptViaApi(
  blob: string,
  tmdbId: string,
  seed: string
): Promise<{ sources?: Array<{ quality?: string; url: string; type?: string }>; error?: string }> {
  try {
    const response = await fetch("/api/videasy/decrypt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ text: blob, tmdbId, seed }),
    })

    const data = (await response.json()) as {
      sources?: Array<{ quality?: string; url: string; type?: string }>
      error?: string
    }

    if (!response.ok) {
      return { error: data.error ?? `Decrypt failed (HTTP ${response.status}).` }
    }

    return { sources: data.sources }
  } catch {
    return { error: "Decrypt request failed." }
  }
}

/**
 * Videasy sometimes decrypts to Cloudflare Worker "bridge" hosts
 * (`*.workers.dev`). Playback always goes through our VPS cinepro proxy, and
 * those Worker URLs return HTTP 404 "未找到" from the player IP — so they are
 * dead for every Chillflix viewer (including the residential client that
 * minted them). Drop them so we keep paleoak/zenoak/etc. or fail cleanly
 * instead of poisoning shared-stream-cache.
 */
function isUnproxiedVideasyDeadHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === "workers.dev" || host.endsWith(".workers.dev")
  } catch {
    return false
  }
}

function toStreams(
  sources: Array<{ quality?: string; url: string; type?: string }>
): VideasyClientStream[] {
  return sources
    .filter((source) => Boolean(source?.url) && !isUnproxiedVideasyDeadHost(source.url))
    .map((source) => ({
      url: source.url,
      type: detectType(source.url, source.type),
      quality: normalizeQuality(source.quality),
    }))
    .sort((a, b) => scoreQuality(b.quality) - scoreQuality(a.quality))
}

async function heliosViaApi(
  blob: string,
  tmdbId: string,
  seed: string,
  media: VideasyClientMedia
): Promise<{ sources?: Array<{ quality?: string; url: string; type?: string }>; error?: string }> {
  try {
    const response = await fetch("/api/videasy/helios", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
      body: JSON.stringify({
        seed,
        body: blob,
        tmdbId,
        type: media.type,
        season: Number(media.season || 1) || 1,
        episode: Number(media.episode || 1) || 1,
      }),
    })
    if (!response.ok) {
      const err = await response.text().catch(() => "")
      return { error: `Helios HTTP ${response.status}${err ? `: ${err.slice(0, 120)}` : ""}` }
    }
    const data = (await response.json()) as {
      url?: string
      sources?: Array<{ quality?: string; url: string; type?: string }>
      error?: string
    }
    if (data.sources?.length) return { sources: data.sources }
    if (data.url) {
      return { sources: [{ quality: "Auto", url: data.url, type: "hls" }] }
    }
    return { error: data.error || "Helios returned no sources." }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Helios request failed.",
    }
  }
}


async function fetchCityBlob(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string,
  mode: "direct" | "api",
  cityTimeout: number
) {
  if (mode === "direct") {
    return fetchBlobDirect(server, meta, media, seed)
  }
  // api mode = NON-COMPLIANT VPS mint city path (last resort only)
  if (typeof console !== "undefined") {
    console.warn(
      "[videasy] NON-COMPLIANT city fetch via BFF/relay — not viewer-IP",
      server
    )
  }
  return fetchBlobViaApi(server, meta, media, seed, cityTimeout)
}

/**
 * One city = one seed (movy/vidy model). Shared seeds across parallel cities
 * return STREAMCRYPTO_SEED_INVALID (401) after the first city consumes it.
 */
async function fetchFromServer(
  server: string,
  meta: TitleMeta,
  media: VideasyClientMedia,
  _unusedSeed: string,
  mode: "direct" | "api",
  timeoutMs?: number
): Promise<ServerHit> {
  const isPriority = (PRIORITY_SERVERS as readonly string[]).includes(server)
  // direct = origin-bridge (viewer IP); allow full city RTT, not the old 3s
  // page-origin probe that always CF-403'd.
  const cityTimeout =
    timeoutMs ??
    (isPriority ? PRIORITY_FETCH_TIMEOUT_MS : SERVER_FETCH_TIMEOUT_MS)

  // Primary: Atlantic runner (seed+city in one shot from viewer IP). This is
  // what actually works on chillflix — bridge seed/city alone was not enough
  // after we removed it. Timeout matches runner.js (7s fetches) + slack.
  if (mode === "direct") {
    const ran = await resolveViaMovyRunner(media, server)
    if (ran?.seed && ran.body) {
      const interpreted = interpretCityBody(200, ran.body)
      if (interpreted.blob) {
        let decrypted = decryptLocal(interpreted.blob, media.tmdbId, ran.seed)
        if (!decrypted.sources?.length) {
          decrypted = await decryptDirect(interpreted.blob, media.tmdbId, ran.seed)
        }
        if (!decrypted.sources?.length) {
          decrypted = await decryptViaApi(interpreted.blob, media.tmdbId, ran.seed)
        }
        if (decrypted.sources?.length) {
          if (typeof console !== "undefined") {
            console.info("[videasy] city via runner (local decrypt)", server)
          }
          return { streams: toStreams(decrypted.sources) }
        }
      }
    }
  }

  // Fallback: explicit bridge seed + city (or BFF when mode=api).
  const allowMint = mode === "api"
  let seed = ""
  if (mode === "api") {
    // Soft try: pooled seed only — do NOT mint yet. BFF may return a
    // 180s blob cache hit (second Sources tap) without touching mint.
    seed = takePooledSeed(media.tmdbId) || ""
  } else {
    seed = (await claimSeedForCity(media.tmdbId, allowMint)) || ""
    if (!seed) {
      return {
        streams: [],
        fetchError:
          "Could not get Videasy session. Hard-refresh and try again (bridge blocked or busy).",
      }
    }
  }

  let fetched = await fetchCityBlob(server, meta, media, seed, mode, cityTimeout)
  // Cache miss with no seed — mint once then retry BFF.
  if (mode === "api" && !fetched.blob && !fetched.blocked) {
    const minted = await mintSeedOnce(media.tmdbId, {
      pool: false,
      fresh: false,
      allowMintFallback: true,
    })
    if (minted) {
      seed = minted
      fetched = await fetchCityBlob(server, meta, media, seed, mode, cityTimeout)
    } else if (!seed) {
      return {
        streams: [],
        fetchError:
          "Videasy session is rate-limited right now. Wait a few seconds and retry.",
      }
    }
  }

  // movy: on 401 remint once for this city only (do not wipe sibling pool).
  // Direct/bridge mode must still allow one BFF remint — burned shared cache
  // seeds were leaving Starting stuck with STREAMCRYPTO_SEED_INVALID.
  if (
    !fetched.blob &&
    /seed expired|HTTP 401|HTTP 400|SEED_INVALID/i.test(fetched.error ?? "")
  ) {
    const remint = await mintSeedOnce(media.tmdbId, {
      pool: false,
      fresh: true,
      allowMintFallback: mode === "api",
    })
    if (remint) {
      seed = remint
      fetched = await fetchCityBlob(server, meta, media, seed, mode, cityTimeout)
    }
  }

  if (fetched.blocked) {
    return { streams: [], blocked: true, fetchError: fetched.error }
  }
  if (!fetched.blob) {
    return { streams: [], fetchError: fetched.error ?? "Videasy fetch failed." }
  }

  // Cache hits return the original seed — required to decrypt the blob.
  const decryptSeed =
    typeof (fetched as { seed?: string }).seed === "string" &&
    (fetched as { seed?: string }).seed!.trim()
      ? (fetched as { seed?: string }).seed!.trim()
      : seed

  // NEVER Helios/Atlantic CDN (burns atlantic.st watermark). Raw kite only.
  let decrypted = decryptLocal(fetched.blob, media.tmdbId, decryptSeed)
  if (!decrypted.sources?.length) {
    decrypted = await decryptDirect(fetched.blob, media.tmdbId, decryptSeed)
  }
  if (!decrypted.sources?.length) {
    decrypted = await decryptViaApi(fetched.blob, media.tmdbId, decryptSeed)
  }
  if (!decrypted.sources?.length) {
    return { streams: [], decryptError: decrypted.error }
  }

  return { streams: toStreams(decrypted.sources) }
}

function mergeHits(hits: ServerHit[]) {
  const seen = new Set<string>()
  const streams: VideasyClientStream[] = []
  let blockedCount = 0
  let fetchFailures = 0
  let decryptFailures = 0
  let lastFetchError: string | undefined
  let lastDecryptError: string | undefined

  for (const result of hits) {
    if (result.blocked) blockedCount += 1
    if (result.fetchError && !result.blocked) {
      fetchFailures += 1
      lastFetchError = result.fetchError
    }
    if (result.decryptError) {
      decryptFailures += 1
      lastDecryptError = result.decryptError
    }
    for (const stream of result.streams) {
      if (seen.has(stream.url)) continue
      seen.add(stream.url)
      streams.push(stream)
    }
  }

  streams.sort((a, b) => scoreQuality(b.quality) - scoreQuality(a.quality))

  return {
    streams,
    blockedCount,
    fetchFailures,
    decryptFailures,
    lastFetchError,
    lastDecryptError,
  }
}

function discreteRungCount(streams: Array<{ quality?: string }>): number {
  const seen = new Set<number>()
  for (const stream of streams) {
    const score = scoreQuality(stream.quality)
    if (score > 0) seen.add(score)
  }
  return seen.size
}

/**
 * Query city servers in parallel and merge labeled rungs (4K/1080/720/…).
 *
 * Progressive model (2026-10-23): return as soon as the first usable city
 * lands so playback can start, keep the remaining cities fetching, and emit
 * onPartial whenever new labeled heights arrive (esp. late miami/boise 4K).
 * Do not block first frame on a multi-second 4K wait.
 *
 * Speed (2026-10-23 tap-faster): fire miami/boise first so the mint tunnel is
 * not contended by 13 cities; stagger the rest; shorter first-usable grace.
 */
async function raceServersForStreams(
  servers: readonly string[],
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string,
  mode: "direct" | "api",
  onPartial?: (streams: VideasyClientStream[]) => void
) {
  if (servers.length === 0) {
    return [] as Array<Awaited<ReturnType<typeof fetchFromServer>>>
  }

  const priority = servers.filter((s) =>
    (PRIORITY_SERVERS as readonly string[]).includes(s)
  )
  const rest = servers.filter(
    (s) => !(PRIORITY_SERVERS as readonly string[]).includes(s)
  )
  // First paint: Miami only. No boise / rest-city tail.
  const firstWave = (priority.length ? priority : [...servers]).slice(0, 1)
  const laterWave: string[] = []
  const total = firstWave.length

  const MAX_WAIT_MS = Math.max(SERVER_FETCH_TIMEOUT_MS + 1_500, 5_500)
  // First labeled city — return immediately so client-resolve can start playback.
  const FIRST_USABLE_GRACE_MS = 0

  return await new Promise<Array<Awaited<ReturnType<typeof fetchFromServer>>>>((resolve) => {
    const hits: Array<Awaited<ReturnType<typeof fetchFromServer>>> = []
    let pending = total
    let returned = false
    let restStarted = laterWave.length === 0
    let exitTimer: ReturnType<typeof setTimeout> | null = null
    let restTimer: ReturnType<typeof setTimeout> | null = null
    let emittedHeightKey = ""

    const collapsedStreams = () =>
      collapseStreamsByQuality(mergeHits(hits).streams)

    const heightKeyOf = (streams: VideasyClientStream[]) =>
      Array.from(
        new Set(
          streams
            .map((stream) => scoreQuality(stream.quality))
            .filter((score) => score > 0)
        )
      )
        .sort((a, b) => b - a)
        .join(",")

    const emitIfGrew = () => {
      const streams = collapsedStreams()
      if (!streams.length) return
      const nextKey = heightKeyOf(streams)
      if (!nextKey || nextKey === emittedHeightKey) return
      const prev = new Set(
        emittedHeightKey
          .split(",")
          .filter(Boolean)
          .map((value) => Number(value))
      )
      const grew =
        !emittedHeightKey ||
        nextKey.split(",").some((value) => {
          const score = Number(value)
          return Number.isFinite(score) && score > 0 && !prev.has(score)
        })
      if (!grew) return
      emittedHeightKey = nextKey
      onPartial?.(streams)
    }

    const returnNow = () => {
      if (returned) return
      returned = true
      clearTimeout(maxTimer)
      if (exitTimer) clearTimeout(exitTimer)
      // Snapshot for the caller; live `hits` keeps accepting late cities.
      resolve(hits.slice())
    }

    const scheduleReturn = (ms: number) => {
      if (returned) return
      if (exitTimer) clearTimeout(exitTimer)
      exitTimer = setTimeout(returnNow, ms)
    }

    const queue = [...firstWave]
    let laterQueued = false
    let inflight = 0

    const pump = () => {
      // After first playable, do not open the long rest-city tail (429 risk).
      // Keep draining firstWave siblings already queued (miami/boise race).
      if (returned && discreteRungCount(mergeHits(hits).streams) >= 1) {
        // Drop only non-priority leftovers if any were queued.
        for (let i = queue.length - 1; i >= 0; i--) {
          if (!(PRIORITY_SERVERS as readonly string[]).includes(queue[i]!)) {
            queue.splice(i, 1)
          }
        }
        if (queue.length === 0) return
      }
      while (inflight < MAX_CITY_INFLIGHT && queue.length > 0) {
        const server = queue.shift()!
        inflight += 1
        void fetchFromServer(server, meta, media, seed, mode).then((hit) => {
          hits.push(hit)
          pending -= 1
          inflight -= 1

          const merged = mergeHits(hits).streams
          const rungs = discreteRungCount(merged)
          if (rungs >= 1) {
            emitIfGrew()
            // Prefer first-playable over racing every city for 4K under rate limit.
            if (!returned) {
              scheduleReturn(FIRST_USABLE_GRACE_MS)
            }
          }

          if (pending === 0) {
            emitIfGrew()
            returnNow()
          } else {
            // First wave done with no playable yet → only then open rest cities.
            if (
              !returned &&
              discreteRungCount(mergeHits(hits).streams) < 1 &&
              queue.length === 0 &&
              inflight === 0
            ) {
              startRest()
            }
            pump()
          }
        })
      }
    }

    const startRest = () => {
      if (restStarted) return
      // Only pull rest cities if first wave has not already produced a rung.
      if (discreteRungCount(mergeHits(hits).streams) >= 1) {
        restStarted = true
        return
      }
      restStarted = true
      if (restTimer) clearTimeout(restTimer)
      if (!laterQueued) {
        laterQueued = true
        queue.push(...laterWave)
      }
      pump()
    }

    const maxTimer = setTimeout(returnNow, MAX_WAIT_MS)

    // Priority cities first (movy: Miami/Boise are the fast 4K scrapers).
    // Do NOT schedule rest cities at 40ms — that raced the full city list
    // before miami/boise returned, stampeded /seed into CF 429, and made
    // taps feel like ~10–16s soft-gap. Rest only if first wave yields nothing.
    pump()
  })
}

/** Prefer one URL per resolution so Quality lists 4K / 1080p / 720p / 480p. */
function collapseStreamsByQuality(
  streams: VideasyClientStream[]
): VideasyClientStream[] {
  const best = new Map<number, VideasyClientStream>()
  const passthrough: VideasyClientStream[] = []
  for (const stream of streams) {
    const score = scoreQuality(stream.quality)
    if (score <= 0) {
      passthrough.push(stream)
      continue
    }
    const prev = best.get(score)
    if (!prev) {
      best.set(score, stream)
    }
  }
  const ranked = Array.from(best.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, stream]) => stream)
  // Keep one Auto fallback only if we somehow have no labeled rungs.
  if (ranked.length === 0 && passthrough.length) {
    return [passthrough[0]!]
  }
  return ranked
}

async function resolveWithMode(
  meta: TitleMeta,
  media: VideasyClientMedia,
  seed: string,
  mode: "direct" | "api",
  onPartial?: (streams: VideasyClientStream[]) => void,
  servers?: readonly string[]
): Promise<VideasyClientResolveResult> {
  // Miami/Boise first. Optional servers override (mobile BFF = priority only).
  const pool = servers && servers.length ? servers : VIDEASY_SERVERS
  const ordered = [
    ...pool.filter((s) =>
      (PRIORITY_SERVERS as readonly string[]).includes(s)
    ),
    ...pool.filter(
      (s) => !(PRIORITY_SERVERS as readonly string[]).includes(s)
    ),
  ]

  // Drop late partials only when this attempt is abandoned for a seed retry.
  let acceptPartials = true
  const hits = await raceServersForStreams(
    ordered,
    meta,
    media,
    seed,
    mode,
    (streams) => {
      if (acceptPartials) onPartial?.(streams)
    }
  )
  const merged = mergeHits(hits)
  const streams = collapseStreamsByQuality(merged.streams)

  if (streams.length) {
    // Keep acceptPartials true so background cities can still push 4K.
    return { streams }
  }

  acceptPartials = false

  if (merged.blockedCount === ordered.length && ordered.length > 0) {
    return {
      streams: [],
      failureReason:
        merged.lastFetchError ??
        "Videasy blocked this network (HTTP 403). Turn off VPN and retry.",
    }
  }

  if (merged.decryptFailures > 0) {
    return {
      streams: [],
      failureReason:
        merged.lastDecryptError ??
        "Got encrypted data but decrypt failed. Retry or pick another source.",
    }
  }

  if (merged.fetchFailures > 0) {
    return {
      streams: [],
      failureReason:
        merged.lastFetchError ?? "Videasy fetch failed. Retry or pick another source.",
    }
  }

  return {
    streams: [],
    failureReason: "No Videasy streams found for this title right now.",
  }
}

export async function resolveVideasyStreamsClient(
  media: VideasyClientMedia,
  options?: VideasyClientResolveOptions,
  internal?: { joinPrefetch?: boolean }
): Promise<VideasyClientResolveResult> {
  const mobileHost = isLikelyMobileVideasyHost()
  markViewerDirectDeadIfNonNative()
  // Bridge iframe is the chillflix path; BFF/mint last.
  const budgetMs = mobileHost ? 45_000 : Math.max(RESOLVE_BUDGET_MS, 40_000)
  const startedAt = Date.now()
  const budgetLeft = () => Math.max(0, budgetMs - (Date.now() - startedAt))
  const progress = (phase: string) => {
    try {
      options?.onProgress?.(phase)
    } catch {
      /* UI only */
    }
  }

  const cached = takeCachedStreams(media)
  if (cached?.length) {
    progress("ready")
    try {
      options?.onPartial?.(cached)
    } catch {
      /* UI only */
    }
    return { streams: cached }
  }

  const cacheKey = mediaCacheKey(media)
  if (internal?.joinPrefetch !== false) {
    const inflightPrefetch = streamPrefetchInflight.get(cacheKey)
    if (inflightPrefetch) {
      progress("prefetch")
      try {
        const warmed = await inflightPrefetch
        if (warmed.length) {
          progress("ready")
          try {
            options?.onPartial?.(warmed)
          } catch {
            /* UI only */
          }
          return { streams: warmed }
        }
      } catch {
        /* fall through to live resolve */
      }
    }
  }

  progress("session")
  const meta = await fetchTitleMeta(media)
  if (!meta) {
    return {
      streams: [],
      failureReason: "Could not load TMDB metadata for this title.",
    }
  }

  const onPartial = options?.onPartial

  const runBff = async () => {
    progress("mint-fallback")
    if (typeof console !== "undefined") {
      console.info("[videasy] BFF/yoru seed+city fallback (shared mint lane)")
    }
    // Same practice as VAPlayer unlock-pending: soft-gap can take 20–60s under
    // load. Keep polling until streams appear, a hard miss, or the deadline —
    // so every title gets a fair wait without per-title warming.
    const waitMs = Math.min(60_000, Math.max(12_000, budgetLeft()))
    const deadline = Date.now() + waitMs
    let attempt = 0
    let lastFailure =
      "Videasy session is rate-limited right now. Wait a few seconds and retry."

    while (Date.now() + 500 < deadline) {
      attempt += 1
      if (attempt > 1) {
        progress("mint-retry")
        const delay = Math.min(
          6_000,
          Math.max(1_500, 2_000 * Math.min(attempt - 1, 3)),
          Math.max(500, deadline - Date.now())
        )
        await new Promise((r) => setTimeout(r, delay))
      }

      const mintSeed = await mintSeedOnce(media.tmdbId, {
        pool: true,
        fresh: attempt > 1,
        allowMintFallback: true,
      })
      if (!mintSeed) {
        lastFailure =
          "Videasy session is rate-limited right now. Wait a few seconds and retry."
        continue
      }

      // One pooled seed for miami.
      rememberSeed(media.tmdbId, mintSeed, 12_000)
      const hit = await resolveWithMode(
        meta,
        media,
        "",
        "api",
        onPartial,
        ["miami"]
      )
      if (hit.streams.length) return hit

      invalidateSeed(media.tmdbId)
      const reason = String(hit.failureReason || "")
      // Hard content miss — stop polling (same title will stay empty).
      if (/no streams available|not found|copyright/i.test(reason)) {
        return hit
      }
      lastFailure =
        reason ||
        "Videasy session is rate-limited right now. Wait a few seconds and retry."
    }

    return {
      streams: [],
      failureReason: lastFailure,
    }
  }

  // On chillflix.* anyip bridge is often dead/slow - BFF/WARP first so
  // Starting Videasy does not hang. Native movy/vidy keep viewer-IP.
  let last: VideasyClientResolveResult = { streams: [] }

  if (!isNativeVideasyHostOrigin()) {
    progress("mint-fallback")
    last = await runBff()
    if (last.streams.length) {
      rememberStreams(media, last.streams)
      progress("ready")
      return last
    }
  }

  progress("bridge")
  void warmVideasyOriginBridge()

  progress("cities")
  last = await resolveWithMode(meta, media, "", "direct", onPartial, ["miami"])
  if (last.streams.length) {
    rememberStreams(media, last.streams)
    progress("ready")
    return last
  }

    // Miami-only.

  // Last ditch: rebuild bridge and one runner resolve (mobile iframe often
  // needs a second TLS attempt after the first timeout).
  if (budgetLeft() >= 5_000) {
    progress("bridge-retry")
    resetVideasyOriginBridge()
    videasyBridgeUrlIndex += 1
    void warmVideasyOriginBridge()
    invalidateSeed(media.tmdbId)
    const ran = await resolveViaMovyRunner(media, "miami")
    if (ran?.seed && ran.body) {
      const interpreted = interpretCityBody(200, ran.body)
      if (interpreted.blob) {
        let decrypted = decryptLocal(interpreted.blob, media.tmdbId, ran.seed)
        if (!decrypted.sources?.length) {
          decrypted = await decryptDirect(interpreted.blob, media.tmdbId, ran.seed)
        }
        if (!decrypted.sources?.length) {
          decrypted = await decryptViaApi(interpreted.blob, media.tmdbId, ran.seed)
        }
        if (decrypted.sources?.length) {
          last = { streams: toStreams(decrypted.sources) }
          rememberStreams(media, last.streams)
          progress("ready")
          return last
        }
      }
    }
  }

    // Bridge/direct viewer-IP failed (common on chillflix.*). Fall back to
  // BFF/movy-relay seed + WARP city so Sources -> Videasy still starts.
  if (budgetLeft() >= 3_000) {
    progress("mint-fallback")
    last = await runBff()
    if (last.streams.length) {
      rememberStreams(media, last.streams)
      progress("ready")
      return last
    }
  }

return {
    streams: [],
    failureReason:
      last.failureReason ||
      "Could not get Videasy session. Hard-refresh and try Boise · Videasy again.",
  }
}
