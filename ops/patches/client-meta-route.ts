import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMBED = "https://embed.vidrift.net"
const ORION = "https://mb.vidrift.net"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

const CACHE_TTL_MS = Number(process.env.SEVENMOVIES_META_CACHE_TTL_MS || 20 * 60 * 1000)
type MetaPayload = {
  streams: Array<{
    url: string
    type: "hls" | "mp4"
    quality: string
    label: string
    rungs: number[]
    codec?: "hevc" | "avc" | "unknown"
  }>
  referer: string
  headers: Record<string, string>
  failureReason?: string
  resolveMode: string
  cached?: boolean
}
const metaCache = new Map<string, { expiresAt: number; payload: MetaPayload }>()
const metaInflight = new Map<string, Promise<MetaPayload>>()

function absUrl(url: string): string {
  if (!url) return ""
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith("/api/orion/") || url.startsWith("/api/")) return `${ORION}${url}`
  if (url.startsWith("/")) return `${EMBED}${url}`
  return url
}

async function probeCodec(url: string): Promise<"hevc" | "avc" | "unknown"> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4500)
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: `${EMBED}/embed2/play`,
        Origin: EMBED,
        Accept: "*/*",
      },
      signal: ctrl.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    if (!res.ok) return "unknown"
    const text = (await res.text()).slice(0, 4000)
    const hevc = /hvc1|hev1|hvc1\.|hev1\./i.test(text)
    const avc = /avc1|avc3/i.test(text)
    if (hevc && !avc) return "hevc"
    if (avc) return "avc"
    return "unknown"
  } catch {
    return "unknown"
  }
}

async function streamReachable(url: string, type: "hls" | "mp4"): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      method: type === "mp4" ? "HEAD" : "GET",
      headers: {
        "User-Agent": UA,
        Referer: `${EMBED}/embed2/play`,
        Origin: EMBED,
        Accept: "*/*",
        ...(type === "mp4" ? { Range: "bytes=0-1" } : {}),
      },
      signal: ctrl.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    if (type === "mp4") return res.ok || res.status === 206
    if (!res.ok) return false
    const body = (await res.text()).slice(0, 200)
    return /#EXTM3U/i.test(body)
  } catch {
    return false
  }
}

function cacheKey(type: string, tmdbId: string, season: string, episode: string) {
  return type === "tv" ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`
}

async function buildMeta(
  type: "movie" | "tv",
  tmdbId: string,
  season: string,
  episode: string
): Promise<MetaPayload> {
  const bootUrl =
    type === "tv"
      ? `${EMBED}/api/boot/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
      : `${EMBED}/api/boot/movie/${encodeURIComponent(tmdbId)}`

  const response = await fetch(bootUrl, {
    headers: {
      "User-Agent": UA,
      Referer: `${EMBED}/`,
      Origin: EMBED,
      Accept: "application/json",
    },
    cache: "no-store",
  })

  if (!response.ok) {
    return {
      streams: [],
      referer: `${EMBED}/embed2/play`,
      headers: {
        Referer: `${EMBED}/embed2/play`,
        Origin: EMBED,
        Accept: "*/*",
      },
      failureReason: `boot HTTP ${response.status}`,
      resolveMode: "vps-boot",
    }
  }

  const boot = (await response.json()) as {
    meta?: {
      orionStreams?: Array<{
        url?: string
        name?: string
        type?: string
        rungs?: Array<{ height?: number }>
      }>
    }
  }
  const rows = boot.meta?.orionStreams || []
  const mapped = rows
    .map((row) => {
      const url = absUrl(String(row.url || ""))
      if (!url) return null
      const isHls =
        String(row.type || "").toLowerCase() === "hls" || /\.m3u8/i.test(url)
      return {
        url,
        type: (isHls ? "hls" : "mp4") as "hls" | "mp4",
        quality: "Auto",
        label: String(row.name || "Orion").trim(),
        rungs: Array.isArray(row.rungs)
          ? row.rungs.map((r) => Number(r?.height) || 0).filter((h) => h > 0)
          : [],
        codec: undefined as undefined | "hevc" | "avc" | "unknown",
      }
    })
    .filter(Boolean) as MetaPayload["streams"]

  // Probe HLS masters for codec so Chrome can prefer MP4.
  await Promise.all(
    mapped.map(async (row) => {
      if (row.type !== "hls") {
        row.codec = "avc"
        return
      }
      row.codec = await probeCodec(row.url)
    })
  )

  mapped.sort((a, b) => {
    const score = (s: (typeof mapped)[number]) => {
      const n = s.label.toLowerCase()
      const orig = /original|english/.test(n)
      if (s.type === "mp4") return orig ? 200 : 160
      if (s.codec === "hevc") return orig ? 40 : 20
      if (orig) return 120
      return 50
    }
    return score(b) - score(a)
  })

  return {
    streams: mapped,
    referer: `${EMBED}/embed2/play`,
    headers: {
      Referer: `${EMBED}/embed2/play`,
      Origin: EMBED,
      Accept: "*/*",
    },
    failureReason: mapped.length ? undefined : "No Orion streams",
    resolveMode: "vps-boot",
  }
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") === "tv" ? "tv" : "movie"
  const tmdbId = String(request.nextUrl.searchParams.get("tmdbId") || "").trim()
  const season = request.nextUrl.searchParams.get("season") || "1"
  const episode = request.nextUrl.searchParams.get("episode") || "1"
  const force = request.nextUrl.searchParams.get("refresh") === "1"

  if (!tmdbId) {
    return NextResponse.json({ streams: [], failureReason: "Missing tmdbId" })
  }

  const key = cacheKey(type, tmdbId, season, episode)

  try {
    if (!force) {
      const hit = metaCache.get(key)
      if (hit && hit.expiresAt > Date.now() && hit.payload.streams.length) {
        // Soft-validate first stream; only remint when broken.
        const first = hit.payload.streams[0]
        const ok = await streamReachable(first.url, first.type)
        if (ok) {
          return NextResponse.json({ ...hit.payload, cached: true })
        }
        metaCache.delete(key)
      }
    }

    let inflight = metaInflight.get(key)
    if (!inflight) {
      inflight = buildMeta(type, tmdbId, season, episode).finally(() => {
        metaInflight.delete(key)
      })
      metaInflight.set(key, inflight)
    }
    const payload = await inflight
    if (payload.streams.length) {
      metaCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
    }
    return NextResponse.json(payload)
  } catch (error) {
    const stale = metaCache.get(key)
    if (stale?.payload.streams.length) {
      return NextResponse.json({ ...stale.payload, cached: true, resolveMode: "cache-stale" })
    }
    return NextResponse.json({
      streams: [],
      failureReason: error instanceof Error ? error.message : "boot failed",
    })
  }
}
