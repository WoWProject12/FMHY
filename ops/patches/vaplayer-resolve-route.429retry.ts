import { getErrorMessage } from "@/lib/api-error"
import { playbackJsonResponse } from "@/lib/playback-response"
import { assertPlaybackRateLimit } from "@/lib/rate-limit"
import { assertSitePlaybackClient } from "@/lib/playback-guard"
import {
  copyrightUnavailableJson,
  isCopyrightRemoved,
} from "@/lib/copyright-takedowns"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UNLOCK_QUEUE_DIR = path.join(process.cwd(), "data", "vaplayer-unlock-queue")

/** Disk queue so unlock-busy titles are reminted by vaplayer-unlock-rotator. */
function enqueueUnlockJob(job: {
  type: string
  tmdbId: string
  season?: number
  episode?: number
  force?: boolean
  reason?: string
}) {
  try {
    const tmdbId = String(job.tmdbId || "").trim()
    if (!/^\d+$/.test(tmdbId)) return null
    const type = job.type === "tv" ? "tv" : "movie"
    const payload = {
      type,
      tmdbId,
      season: type === "tv" ? Math.max(1, Number(job.season) || 1) : undefined,
      episode: type === "tv" ? Math.max(1, Number(job.episode) || 1) : undefined,
      force: Boolean(job.force),
      reason: String(job.reason || "resolve").slice(0, 80),
      enqueuedAt: Date.now(),
    }
    const raw =
      type === "tv"
        ? `tv:${tmdbId}:${payload.season}:${payload.episode}`
        : `movie:${tmdbId}`
    const id = createHash("sha1").update(raw).digest("hex")
    mkdirSync(UNLOCK_QUEUE_DIR, { recursive: true })
    const file = path.join(UNLOCK_QUEUE_DIR, `${id}.json`)
    // Keep FIFO position if already queued (rewrites would send demand to the back).
    if (existsSync(file)) {
      if (payload.force) {
        try {
          const existing = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
          if (!existing.force) {
            const st = statSync(file)
            writeFileSync(
              file,
              JSON.stringify({ ...existing, force: true, reason: payload.reason })
            )
            utimesSync(file, st.atime, st.mtime)
          }
        } catch {
          /* ignore */
        }
      }
      return id
    }
    writeFileSync(file, JSON.stringify(payload))
    return id
  } catch {
    return null
  }
}

const IFRAME_ORIGIN = "https://nextgencloudfabric.com"
const UNLOCK_PY = path.join(process.cwd(), "scripts", "vaplayer-unlock.py")
const CACHE_DIR = path.join(process.cwd(), "data", "vaplayer-unlock-cache")
/** Soft TTL for background refresh hints; we still serve while CDN JWT is alive. */
const CACHE_TTL_MS = Number(process.env.VAPLAYER_UNLOCK_CACHE_TTL || 14400) * 1000
/** How often to soft-probe a cached playlist. Hot path skips probe otherwise. */
const CACHE_REVALIDATE_MS = Number(process.env.VAPLAYER_CACHE_REVALIDATE_MS || 10 * 60 * 1000)

type UnlockResult = {
  ok?: boolean
  streams?: string[]
  fileName?: string | null
  title?: string | null
  referer?: string
  via?: string
  matchedAs?: string
  error?: string
  _ts?: number
}

function cacheKey(
  type: "movie" | "tv",
  tmdbId: string,
  season?: number,
  episode?: number
) {
  const raw =
    type === "tv"
      ? `tv:${tmdbId}:${season || ""}:${episode || ""}`
      : `movie:${tmdbId}::`
  return createHash("sha1").update(raw).digest("hex")
}

function streamNeedsCdnToken(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (/(?:^|\.)stellarconductornexus\.com$/i.test(host)) return true
    if (host.endsWith(".site") && /\/pl\//i.test(parsed.pathname + parsed.search)) return true
    if (
      /(?:^|\.)(strategicgrowthpartners|influencerstrategygroup|nicheauthorityengine|remoteconsultinggroup|boldvisionstrategy|onlinecoachingacademy|onlinecoursecreator|scalablecontentengine|modernconsultinglab)\.site$/i.test(
        host
      )
    ) {
      return true
    }
  } catch {
    return /[?&]token=/.test(url) || /\.site\/.*\/pl\//i.test(url)
  }
  return false
}

function streamsTokenAlive(streams: unknown, skewSec = 90): boolean {
  const now = Date.now() / 1000
  if (!Array.isArray(streams) || !streams.length) return false
  let sawToken = false
  let needsToken = false
  let minLeft: number | null = null
  for (const u of streams) {
    const url = String(u || "")
    if (streamNeedsCdnToken(url)) needsToken = true
    const m = url.match(/[?&]token=([^&]+)/)
    if (!m) continue
    sawToken = true
    try {
      const tok = decodeURIComponent(m[1])
      const parts = tok.split(".")
      if (parts.length < 2) return false
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      ) as { exp?: number }
      const exp = Number(payload.exp || 0)
      if (exp) {
        const left = exp - now
        if (minLeft == null || left < minLeft) minLeft = left
        if (left <= skewSec) return false
      }
    } catch {
      return false
    }
  }
  // Tokenized VA CDN hosts must carry a live JWT — bare URLs after generate.php
  // failure used to look "alive" forever and play black after a few hours.
  if (needsToken && !sawToken) return false
  return true
}

/** Seconds until the soonest CDN JWT expires; null if unknown/missing. */
function streamsTokenTtlSec(streams: unknown): number | null {
  const now = Date.now() / 1000
  if (!Array.isArray(streams) || !streams.length) return null
  let minLeft: number | null = null
  for (const u of streams) {
    const m = String(u || "").match(/[?&]token=([^&]+)/)
    if (!m) continue
    try {
      const tok = decodeURIComponent(m[1])
      const parts = tok.split(".")
      if (parts.length < 2) continue
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      ) as { exp?: number }
      const exp = Number(payload.exp || 0)
      if (!exp) continue
      const left = exp - now
      if (minLeft == null || left < minLeft) minLeft = left
    } catch {
      /* ignore */
    }
  }
  return minLeft
}

async function readUnlockCacheFile(key: string): Promise<UnlockResult | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")
    return JSON.parse(raw) as UnlockResult
  } catch {
    return null
  }
}

/** Serve any cached unlock while CDN JWTs are still valid (cache-until-broken). */
async function readUnlockCacheAlive(key: string): Promise<UnlockResult | null> {
  const data = await readUnlockCacheFile(key)
  if (!data?.ok || !Array.isArray(data.streams) || !data.streams.length) return null
  if (!streamsTokenAlive(data.streams)) return null
  const ageMs = Date.now() - Number(data._ts || 0) * 1000
  const via = ageMs <= CACHE_TTL_MS ? "cache" : "cache-reuse"
  return { ...data, via }
}

async function playlistReachable(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: `${IFRAME_ORIGIN}/`,
        Accept: "*/*",
      },
      signal: ctrl.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    if (!res.ok) return false
    const body = (await res.text()).slice(0, 240)
    return /#EXTM3U/i.test(body)
  } catch {
    return false
  }
}

/** Cap concurrent unlock Pythons.
 *  Upstream captcha uses a global flock, so >2 workers mostly sleep on the
 *  mutex while still occupying slots — that starved titles like 969681.
 */
const UNLOCK_MAX_INFLIGHT = Math.max(
  1,
  Number(process.env.VAPLAYER_UNLOCK_MAX_INFLIGHT || 2)
)
/** How long a title may wait for a free unlock slot before deferring to the rotator. */
const UNLOCK_SLOT_WAIT_MS = Math.max(
  2_000,
  Number(process.env.VAPLAYER_UNLOCK_SLOT_WAIT_MS || 45_000)
)
const UNLOCK_WAITERS_MAX = Math.max(
  4,
  Number(process.env.VAPLAYER_UNLOCK_WAITERS_MAX || 64)
)
let unlockInflight = 0
const unlockWaiters: Array<() => void> = []
const unlockSingleflight = new Map<string, Promise<UnlockResult>>()
/** Keys that have acquired a slot and spawned Python (vs still queued). */
const unlockSpawned = new Set<string>()

class UnlockSlotTimeout extends Error {
  constructor() {
    super("VAPlayer unlock busy (slot wait timeout)")
    this.name = "UnlockSlotTimeout"
  }
}

async function acquireUnlockSlot(): Promise<() => void> {
  const release = () => {
    unlockInflight = Math.max(0, unlockInflight - 1)
    const next = unlockWaiters.shift()
    if (next) next()
  }
  if (unlockInflight < UNLOCK_MAX_INFLIGHT) {
    unlockInflight += 1
    return release
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const idx = unlockWaiters.indexOf(wake)
      if (idx >= 0) unlockWaiters.splice(idx, 1)
      reject(new UnlockSlotTimeout())
    }, UNLOCK_SLOT_WAIT_MS)
    const wake = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unlockInflight += 1
      resolve()
    }
    // Allow a larger waiter backlog so load doesn't fail instantly; hard-cap at 2x.
    if (unlockWaiters.length >= UNLOCK_WAITERS_MAX) {
      unlockWaiters.shift() // oldest keeps its timer and becomes UnlockSlotTimeout
    }
    if (unlockWaiters.length >= UNLOCK_WAITERS_MAX * 2) {
      clearTimeout(timer)
      reject(new UnlockSlotTimeout())
      return
    }
    unlockWaiters.push(wake)
  })
  return release
}

function runUnlock(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: number
  episode?: number
  force?: boolean
  /** Same key as unlockSingleflight / unlockSpawned. */
  spawnKey: string
}): Promise<UnlockResult> {
  const args = [UNLOCK_PY, "--type", params.type, "--tmdb", params.tmdbId]
  if (params.type === "tv") {
    args.push("--season", String(params.season || 1), "--episode", String(params.episode || 1))
  }
  if (params.force) args.push("--force")
  return new Promise((resolve) => {
    void (async () => {
      let release: (() => void) | null = null
      const flightKey = params.spawnKey
      try {
        release = await acquireUnlockSlot()
      } catch (err) {
        resolve({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "VAPlayer unlock busy (slot wait timeout)",
          streams: [],
          via: "unlock-busy",
        })
        return
      }
      unlockSpawned.add(flightKey)
      const child = spawn("python3", args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
      }, 90_000)
      const finish = (result: UnlockResult) => {
        unlockSpawned.delete(flightKey)
        release?.()
        resolve(result)
      }
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk)
        if (stdout.length > 4 * 1024 * 1024) child.kill("SIGKILL")
      })
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk)
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        finish({ ok: false, error: err.message, streams: [] })
      })
      child.on("close", () => {
        clearTimeout(timer)
        const raw = stdout.trim()
        if (!raw) {
          finish({
            ok: false,
            error: (stderr || "unlock produced no output").slice(0, 300),
            streams: [],
          })
          return
        }
        const line = raw.split("\n").filter(Boolean).at(-1) || raw
        try {
          finish(JSON.parse(line) as UnlockResult)
        } catch {
          finish({ ok: false, error: `unlock bad json: ${line.slice(0, 180)}`, streams: [] })
        }
      })
    })()
  })
}

function runUnlockSingleflight(
  key: string,
  params: {
    type: "movie" | "tv"
    tmdbId: string
    season?: number
    episode?: number
    force?: boolean
  }
): Promise<UnlockResult> {
  const flightKey = params.force ? `${key}:force` : key
  const existing = unlockSingleflight.get(flightKey)
  if (existing) return existing
  const p = runUnlock({ ...params, spawnKey: flightKey }).finally(() => {
    unlockSingleflight.delete(flightKey)
    unlockSpawned.delete(flightKey)
  })
  unlockSingleflight.set(flightKey, p)
  return p
}

function okStreams(unlocked: UnlockResult | null | undefined): string[] {
  return Array.isArray(unlocked?.streams)
    ? unlocked!.streams.filter((u) => typeof u === "string" && u.startsWith("http"))
    : []
}

export async function GET(request: Request) {
  console.log("[VA-RESOLVE] hit", request.url)
  const rateLimited = assertPlaybackRateLimit(request, "sources")
  if (rateLimited) return rateLimited

  const denied = assertSitePlaybackClient(request)
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const typeRaw = String(searchParams.get("type") || "").toLowerCase()
  const type = typeRaw === "tv" || typeRaw === "show" ? "tv" : "movie"
  const tmdbId = String(
    searchParams.get("tmdbId") || searchParams.get("tmdb") || ""
  ).trim()
  const season = searchParams.get("season") ?? undefined
  const episode = searchParams.get("episode") ?? undefined
  const force = searchParams.get("refresh") === "1"

  if (!/^\d+$/.test(tmdbId)) {
    return playbackJsonResponse({ ok: false, error: "Missing tmdbId." }, { status: 400 })
  }

  if (isCopyrightRemoved(type, tmdbId)) {
    return playbackJsonResponse(copyrightUnavailableJson(), { status: 410 })
  }

  if (type === "tv" && (!season || !episode)) {
    return playbackJsonResponse(
      { ok: false, error: "Missing season or episode." },
      { status: 400 }
    )
  }

  const seasonN = Math.max(1, Number(season) || 1)
  const episodeN = Math.max(1, Number(episode) || 1)

  try {
    const key = cacheKey(
      type,
      tmdbId,
      type === "tv" ? seasonN : undefined,
      type === "tv" ? episodeN : undefined
    )

    // 1) Serve cached streams while JWT still valid — only remint when broken/expired.
    // Instant hot path: trust streamsTokenAlive (JWT). Do NOT probe CDN on every
    // Sources tap — that made cache feel as slow as a fresh unlock (1–120s).
    // Client/playback errors can pass ?refresh=1 to force remint.
    if (!force) {
      const cached = await readUnlockCacheAlive(key)
      const cachedStreams = okStreams(cached)
      if (cached && cachedStreams.length) {
        const ttl = streamsTokenTtlSec(cachedStreams)
        // Remint before the ~4h CDN JWT dies — rotator was starved under load.
        if (ttl != null && ttl < 25 * 60) {
          enqueueUnlockJob({
            type,
            tmdbId,
            season: seasonN,
            episode: episodeN,
            force: true,
            reason: `expire-in-${Math.max(0, Math.floor(ttl))}s`,
          })
          void runUnlockSingleflight(key, {
            type,
            tmdbId,
            season: seasonN,
            episode: episodeN,
            force: true,
          }).catch(() => undefined)
        }
        return playbackJsonResponse({
          ok: true,
          streams: cachedStreams,
          fileName: cached.fileName || undefined,
          referer: cached.referer || `${IFRAME_ORIGIN}/`,
          via: cached.via || "cache",
          matchedAs: cached.matchedAs || `tmdb:${type}:${tmdbId}`,
          title: cached.title || undefined,
          playbackMode: "server-proxy",
          tried: [`unlock:tmdb:${type}:${tmdbId}`],
        })
      }
    }

    // 2) Remint with soft timeout so Sources can fall through (~45s client budget).
    // Unlock keeps running in singleflight for the next viewer / retry.
    // Auto passes budgetMs≈4000 so Sources can leave VA after one row budget.
    // Manual taps omit it and keep the longer unlock soft-timeout.
    const budgetRaw = Number(
      searchParams.get("budgetMs") || searchParams.get("waitMs") || 0
    )
    // Cap HTTP wait hard — long budgetMs (e.g. 60s) was holding nginx max_conns
    // slots and cascading 503 "no live upstreams" across the player.
    const SOFT_MS = Math.max(
      2_000,
      Math.min(
        8_000,
        budgetRaw > 0
          ? budgetRaw
          : Number(process.env.VAPLAYER_RESOLVE_SOFT_MS || 8_000)
      )
    )
    const unlockPromise = runUnlockSingleflight(key, {
      type,
      tmdbId,
      season: seasonN,
      episode: episodeN,
      force,
    })
    const softTimer = new Promise<"soft-timeout">((resolve) => {
      setTimeout(() => resolve("soft-timeout"), SOFT_MS)
    })
    const raced = await Promise.race([
      unlockPromise.then((u) => ({ kind: "unlock" as const, u })),
      softTimer.then((k) => ({ kind: k, u: null as UnlockResult | null })),
    ])

    let unlocked: UnlockResult | null =
      raced.kind === "unlock" ? raced.u : null
    let streams = okStreams(unlocked)

    // Soft-timeout: prefer any still-alive cache rather than hanging the player.
    if (!streams.length) {
      const fallback = await readUnlockCacheAlive(key)
      const fbStreams = okStreams(fallback)
      if (fallback && fbStreams.length) {
        unlocked = {
          ...fallback,
          via: raced.kind === "soft-timeout" ? "cache-soft" : "cache-fallback",
        }
        streams = fbStreams
      }
    }

    if (streams.length) {
      return playbackJsonResponse({
        ok: true,
        streams,
        fileName: unlocked?.fileName || undefined,
        referer: unlocked?.referer || `${IFRAME_ORIGIN}/`,
        via: unlocked?.via || "unlock",
        matchedAs: unlocked?.matchedAs || `tmdb:${type}:${tmdbId}`,
        title: unlocked?.title || undefined,
        playbackMode: "server-proxy",
        tried: [`unlock:tmdb:${type}:${tmdbId}`],
      })
    }

    // Still unlocking / queued — keep client polling. Also enqueue on disk so the
    // rotator remints even if this request's slot wait expires.
    if (raced.kind === "soft-timeout") {
      const flightKey = `${key}${force ? ":force" : ""}`
      if (!unlockSpawned.has(flightKey)) {
        enqueueUnlockJob({
          type,
          tmdbId,
          season: seasonN,
          episode: episodeN,
          force,
          reason: "soft-timeout-queued",
        })
      }
      return playbackJsonResponse({
        ok: false,
        error: unlockSpawned.has(flightKey)
          ? "VAPlayer unlock still running — retry"
          : "VAPlayer unlock queued — retry",
        retryAfterMs: 4000,
        streams: [],
        via: "unlock-pending",
        tried: [`unlock:tmdb:${type}:${tmdbId}`],
      })
    }

    // Slot/mutex saturation — hand off to rotator and keep client retrying.
    if (unlocked?.via === "unlock-busy" || /unlock busy/i.test(unlocked?.error || "")) {
      enqueueUnlockJob({
        type,
        tmdbId,
        season: seasonN,
        episode: episodeN,
        force,
        reason: "unlock-busy",
      })
      // Only serve still-alive CDN JWTs when busy. Dead/expired tokens here are
      // why VA "returned sources" after a few hours then played black.
      const stale = await readUnlockCacheAlive(key)
      const staleStreams = okStreams(stale)
      if (stale && staleStreams.length) {
        return playbackJsonResponse({
          ok: true,
          streams: staleStreams,
          fileName: stale.fileName || undefined,
          referer: stale.referer || `${IFRAME_ORIGIN}/`,
          via: "cache-busy",
          matchedAs: stale.matchedAs || `tmdb:${type}:${tmdbId}`,
          title: stale.title || undefined,
          playbackMode: "server-proxy",
          tried: [`unlock:tmdb:${type}:${tmdbId}`],
        })
      }
      return playbackJsonResponse({
        ok: false,
        error: unlocked?.error || "VAPlayer unlock busy — queued",
        retryAfterMs: 4000,
        streams: [],
        via: "unlock-pending",
        tried: [`unlock:tmdb:${type}:${tmdbId}`],
      })
    }

    // Rate-limit: do NOT force-remint (that worsens 429). Keep client polling.
    const unlockErr = String(unlocked?.error || "")
    if (/429|Too Many Requests|rate.?limit/i.test(unlockErr)) {
      enqueueUnlockJob({
        type,
        tmdbId,
        season: seasonN,
        episode: episodeN,
        force: false,
        reason: "429",
      })
      return playbackJsonResponse({
        ok: false,
        error: "VAPlayer rate limited — retry",
        retryAfterMs: 8_000,
        streams: [],
        via: "unlock-pending",
        tried: [`unlock:tmdb:${type}:${tmdbId}`],
      })
    }

    // Hard empty (unlock finished, no streams) — queue remint unless catalog miss.
    const catalogMiss = /404|catalog-miss|streamdata failed|no stream_urls/i.test(unlockErr)
    enqueueUnlockJob({
      type,
      tmdbId,
      season: seasonN,
      episode: episodeN,
      force: !catalogMiss,
      reason: catalogMiss ? "catalog-miss" : "empty-result",
    })
    return playbackJsonResponse({
      ok: false,
      error: unlocked?.error || "no streams for this title/episode",
      retryAfterMs: catalogMiss ? 0 : 6000,
      streams: [],
      via: catalogMiss ? "catalog-miss" : "unlock-pending",
      tried: [`unlock:tmdb:${type}:${tmdbId}`],
    })
  } catch (error) {
    return playbackJsonResponse(
      {
        ok: false,
        error: getErrorMessage(error, "VAPlayer resolve failed"),
        streams: [],
      },
      { status: 500 }
    )
  }
}
