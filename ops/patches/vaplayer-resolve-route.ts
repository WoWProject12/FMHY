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
import { promises as fs } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

function streamsTokenAlive(streams: unknown, skewSec = 90): boolean {
  const now = Date.now() / 1000
  if (!Array.isArray(streams) || !streams.length) return false
  let sawToken = false
  for (const u of streams) {
    const m = String(u || "").match(/[?&]token=([^&]+)/)
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
      if (exp && exp <= now + skewSec) return false
    } catch {
      return false
    }
  }
  // No JWT in URLs — treat as alive until playlist probe says otherwise.
  return true
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

/** Cap concurrent unlock Pythons — each waits on a flock but still eats ~40MB. */
const UNLOCK_MAX_INFLIGHT = Math.max(
  1,
  Number(process.env.VAPLAYER_UNLOCK_MAX_INFLIGHT || 2)
)
let unlockInflight = 0
const unlockWaiters: Array<() => void> = []
const unlockSingleflight = new Map<string, Promise<UnlockResult>>()

async function acquireUnlockSlot(): Promise<() => void> {
  if (unlockInflight < UNLOCK_MAX_INFLIGHT) {
    unlockInflight += 1
    return () => {
      unlockInflight = Math.max(0, unlockInflight - 1)
      const next = unlockWaiters.shift()
      if (next) next()
    }
  }
  await new Promise<void>((resolve) => {
    unlockWaiters.push(() => {
      unlockInflight += 1
      resolve()
    })
  })
  return () => {
    unlockInflight = Math.max(0, unlockInflight - 1)
    const next = unlockWaiters.shift()
    if (next) next()
  }
}

function runUnlock(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: number
  episode?: number
}): Promise<UnlockResult> {
  const args = [UNLOCK_PY, "--type", params.type, "--tmdb", params.tmdbId]
  if (params.type === "tv") {
    args.push("--season", String(params.season || 1), "--episode", String(params.episode || 1))
  }
  return new Promise((resolve) => {
    void (async () => {
      const release = await acquireUnlockSlot()
      const child = spawn("python3", args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
      }, 90_000)
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk)
        if (stdout.length > 4 * 1024 * 1024) child.kill("SIGKILL")
      })
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk)
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        release()
        resolve({ ok: false, error: err.message, streams: [] })
      })
      child.on("close", () => {
        clearTimeout(timer)
        release()
        const raw = stdout.trim()
        if (!raw) {
          resolve({
            ok: false,
            error: (stderr || "unlock produced no output").slice(0, 300),
            streams: [],
          })
          return
        }
        const line = raw.split("\n").filter(Boolean).at(-1) || raw
        try {
          resolve(JSON.parse(line) as UnlockResult)
        } catch {
          resolve({ ok: false, error: `unlock bad json: ${line.slice(0, 180)}`, streams: [] })
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
  }
): Promise<UnlockResult> {
  const existing = unlockSingleflight.get(key)
  if (existing) return existing
  const p = runUnlock(params).finally(() => {
    unlockSingleflight.delete(key)
  })
  unlockSingleflight.set(key, p)
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

    // 2) Remint (singleflight so concurrent viewers share one unlock → fewer 429s).
    let unlocked = await runUnlockSingleflight(key, {
      type,
      tmdbId,
      season: seasonN,
      episode: episodeN,
    })
    let streams = okStreams(unlocked)

    // 3) Unlock failed / 429 → last-resort reuse if JWT somehow still valid.
    if (!streams.length) {
      const fallback = await readUnlockCacheAlive(key)
      const fbStreams = okStreams(fallback)
      if (fallback && fbStreams.length) {
        unlocked = { ...fallback, via: "cache-fallback" }
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
    return playbackJsonResponse({
      ok: false,
      error: unlocked?.error || "no streams for this title/episode",
      streams: [],
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
