/**
 * 7Movies (Vidrift Orion) — resolved in the viewer's browser when CF allows,
 * with same-origin /api/7movies/client-meta VPS assist as fallback.
 *
 * Orion CDN requires Referer embed.vidrift.net (browsers cannot forge it), so
 * client-resolve always plays through the cinepro proxy (VPS egress). Assist
 * therefore matches playback IP and is the reliable path when boot is challenged.
 *
 * Orion Original HLS is often HEVC-only (hvc1). Chrome MSE then gets 0 levels,
 * so we prefer MP4 / non-HEVC first unless the browser can play HEVC.
 */

const EMBED = "https://embed.vidrift.net"

export type SevenMoviesClientStream = {
  url: string
  type: "hls" | "mp4"
  quality: string
  label: string
  /** Orion ABR ladder heights when known (Quality sheet). */
  rungs?: number[]
  /** Set when master is hvc1/hev1-only. */
  codec?: "hevc" | "avc" | "unknown"
}

export type SevenMoviesClientResult = {
  streams: SevenMoviesClientStream[]
  failureReason?: string
  referer: string
}

type SevenMoviesMedia = {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
}

type OrionStream = {
  index?: number
  url?: string
  proxyUrl?: string
  type?: string
  provider?: string
  direct?: boolean
  name?: string
  rungs?: Array<{ width?: number; height?: number }>
}

type BootMeta = {
  evionUrl?: string
  selfhostUrl?: string | null
  selfhostKind?: string | null
  orionStreams?: OrionStream[]
  warmStreams?: OrionStream[] | null
}

type BootResponse = {
  meta?: BootMeta
  shell?: {
    subtitles?: Array<{ code?: string; label?: string; lang?: string; url?: string }>
  }
}

const ORION_CDN = "https://mb.vidrift.net"

function absUrl(url: string): string {
  if (!url) return ""
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith("/api/orion/") || url.startsWith("/api/")) {
    return `${ORION_CDN}${url}`
  }
  if (url.startsWith("/")) return `${EMBED}${url}`
  return url
}

function browserSupportsHevc(): boolean {
  if (typeof document === "undefined") return false
  try {
    const video = document.createElement("video")
    return (
      video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') !== "" ||
      video.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"') !== "" ||
      video.canPlayType('video/mp4; codecs="hvc1"') !== ""
    )
  } catch {
    return false
  }
}

function playScore(s: SevenMoviesClientStream): number {
  const hevcOk = browserSupportsHevc()
  const n = String(s.label || "").toLowerCase()
  const isOrig = /original|english/.test(n)
  if (s.type === "mp4") return isOrig ? 200 : 160
  if (s.codec === "hevc" && !hevcOk) return isOrig ? 20 : 10
  if (isOrig) return 120
  return 50
}

function mapOrion(streams: OrionStream[] | undefined): SevenMoviesClientStream[] {
  const rows = [...(streams || [])].filter((s) =>
    /^https?:\/\//i.test(absUrl(String(s.url || "")))
  )
  const out: SevenMoviesClientStream[] = []
  for (const row of rows) {
    const url = absUrl(String(row.url))
    const isHls =
      String(row.type || "").toLowerCase() === "hls" || /\.m3u8(\?|$)/i.test(url)
    const label = String(row.name || row.provider || "Orion").trim()
    const rungs = Array.isArray(row.rungs)
      ? row.rungs
          .map((r) => Number(r?.height) || 0)
          .filter((h) => h > 0)
          .sort((a, b) => b - a)
      : []
    out.push({
      url,
      type: isHls ? "hls" : "mp4",
      quality: isHls ? (rungs[0] ? `${rungs[0] >= 1080 ? 1080 : rungs[0]}p` : "Auto") : "Auto",
      label,
      ...(rungs.length ? { rungs } : {}),
      // Boot does not advertise codecs; Orion HLS Original is typically HEVC-only.
      ...(isHls && /original/i.test(label) ? { codec: "hevc" as const } : {}),
    })
  }
  out.sort((a, b) => playScore(b) - playScore(a))
  return out
}

function streamsFromBoot(boot: BootResponse): SevenMoviesClientStream[] {
  const meta = boot.meta || {}
  const streams: SevenMoviesClientStream[] = []
  streams.push(...mapOrion(meta.orionStreams || undefined))
  streams.push(...mapOrion(meta.warmStreams || undefined))

  if (meta.evionUrl && /^https?:\/\//i.test(meta.evionUrl)) {
    streams.unshift({
      url: absUrl(meta.evionUrl),
      type: "hls",
      quality: "Auto",
      label: "Evion",
    })
  }
  if (meta.selfhostUrl && /^https?:\/\//i.test(String(meta.selfhostUrl))) {
    const kind = String(meta.selfhostKind || "").toLowerCase()
    streams.unshift({
      url: absUrl(String(meta.selfhostUrl)),
      type: kind === "mp4" ? "mp4" : "hls",
      quality: "Auto",
      label: "Direct",
    })
  }
  return streams
}

async function fetchViaVpsAssist(
  media: SevenMoviesMedia
): Promise<SevenMoviesClientStream[]> {
  if (typeof window === "undefined") return []
  try {
    const q = new URLSearchParams({
      type: media.type,
      tmdbId: String(media.tmdbId),
    })
    if (media.type === "tv") {
      q.set("season", String(Math.max(1, Number(media.season) || 1)))
      q.set("episode", String(Math.max(1, Number(media.episode) || 1)))
    }
    const response = await fetch(`/api/7movies/client-meta?${q}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) return []
    const data = (await response.json()) as {
      streams?: Array<{
        url?: string
        quality?: string
        label?: string
        type?: string
        codec?: string
        rungs?: number[]
      }>
    }
    const rows = Array.isArray(data.streams) ? data.streams : []
    return rows
      .map((row, index) => {
        const url = String(row.url || "").trim()
        if (!/^https?:\/\//i.test(url)) return null
        const isHls =
          String(row.type || "").toLowerCase() === "hls" || /\.m3u8(\?|$)/i.test(url)
        const label =
          String(row.label || "").trim() ||
          (index === 0 ? "Orion" : `Orion ${index + 1}`)
        const codecRaw = String(row.codec || "").toLowerCase()
        const codec =
          codecRaw === "hevc" || codecRaw === "avc" || codecRaw === "unknown"
            ? (codecRaw as "hevc" | "avc" | "unknown")
            : isHls && /original/i.test(label)
              ? ("hevc" as const)
              : undefined
        return {
          url,
          type: (isHls ? "hls" : "mp4") as "hls" | "mp4",
          quality: String(row.quality || (isHls ? "Auto" : "Auto")),
          label,
          ...(Array.isArray(row.rungs) && row.rungs.length ? { rungs: row.rungs } : {}),
          ...(codec ? { codec } : {}),
        }
      })
      .filter((row): row is SevenMoviesClientStream => Boolean(row))
  } catch {
    return []
  }
}

export async function resolveSevenMoviesStreamsClient(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
  title?: string
}): Promise<SevenMoviesClientResult> {
  const referer = `${EMBED}/embed2/play`
  const tmdbId = String(params.tmdbId || "").trim()
  if (!tmdbId) {
    return { streams: [], failureReason: "Missing TMDB id", referer }
  }

  const type = params.type === "tv" ? "tv" : "movie"
  const season = Number(params.season ?? 1) || 1
  const episode = Number(params.episode ?? 1) || 1
  const title = String(params.title || "").trim() || `tmdb-${tmdbId}`
  const media: SevenMoviesMedia = {
    type,
    tmdbId,
    season: String(season),
    episode: String(episode),
  }

  const path =
    type === "tv"
      ? `${EMBED}/api/boot/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
      : `${EMBED}/api/boot/movie/${encodeURIComponent(tmdbId)}`

  const url = new URL(path)
  url.searchParams.set("type", type)
  url.searchParams.set("id", tmdbId)
  url.searchParams.set("source", "0")
  url.searchParams.set("title", title)
  url.searchParams.set("shell", "1")
  if (type === "tv") {
    url.searchParams.set("season", String(season))
    url.searchParams.set("episode", String(episode))
  }

  // VPS assist first (cached, codec-tagged, MP4-first). Browser boot fills gaps.
  let bootFailure: string | undefined
  const assisted = await fetchViaVpsAssist(media)

  let bootStreams: SevenMoviesClientStream[] = []
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      bootFailure = `boot HTTP ${response.status}`
    } else {
      const boot = (await response.json()) as BootResponse
      bootStreams = streamsFromBoot(boot)
      if (!bootStreams.length) bootFailure = "No Orion/Evion streams in boot response"
    }
  } catch (error) {
    bootFailure =
      error instanceof Error ? error.message : "boot fetch failed"
  }

  const byLabel = new Map<string, SevenMoviesClientStream>()
  const labelKey = (s: SevenMoviesClientStream) =>
    String(s.label || "").trim().toLowerCase() || s.url

  // Prefer playable rows: MP4 / non-HEVC over HEVC HLS for the same language.
  const prefer = (prev: SevenMoviesClientStream, next: SevenMoviesClientStream) => {
    const hevcOk = browserSupportsHevc()
    const prevHevcBad = prev.codec === "hevc" && !hevcOk && prev.type === "hls"
    const nextHevcBad = next.codec === "hevc" && !hevcOk && next.type === "hls"
    if (prevHevcBad && next.type === "mp4") return next
    if (nextHevcBad && prev.type === "mp4") return prev
    if (prev.type === "hls" && next.type === "mp4" && !hevcOk) return next
    if (prev.type === "mp4" && next.type === "hls" && nextHevcBad) return prev
    // Keep multi-rung HLS when browser can play it (Quality sheet).
    const prevRungs = prev.rungs?.length || 0
    const nextRungs = next.rungs?.length || 0
    if (hevcOk && next.type === "hls" && nextRungs >= 2 && prev.type === "mp4") return next
    if (prevRungs < 2 && nextRungs >= 2 && !(nextHevcBad && prev.type === "mp4")) return next
    return prev
  }

  for (const row of assisted) byLabel.set(labelKey(row), row)
  for (const row of bootStreams) {
    const k = labelKey(row)
    const prev = byLabel.get(k)
    if (!prev) {
      byLabel.set(k, row)
      continue
    }
    byLabel.set(k, prefer(prev, row))
  }

  const streams = [...byLabel.values()].sort((a, b) => playScore(b) - playScore(a))
  if (streams.length) {
    return { streams, referer }
  }

  return {
    streams: [],
    failureReason: `${bootFailure || "boot empty"} (VPS assist empty)`,
    referer,
  }
}

export const SEVENMOVIES_CLIENT_HEADERS: Record<string, string> = {
  Referer: `${EMBED}/embed2/play`,
  Origin: EMBED,
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
}
