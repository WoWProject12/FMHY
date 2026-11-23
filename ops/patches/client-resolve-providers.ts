import { resolveVideasyStreamsClient } from "@/lib/providers/videasy-client-resolver"
import { buildCineproProxyHref } from "@/lib/cinepro/proxy"
import { fourKStreamNeedsRemux } from "@/lib/4khdhub/codec"
import { resolveFourKStreamsClient } from "@/lib/providers/4khdhub-client-resolver"
import {
  resolveClientPlaybackProxyOrigin,
  resolveFourKApiOrigin,
} from "@/lib/playback-proxy-origin"
import { resolveVidifyStreamsClient } from "@/lib/providers/vidify-client-resolver"
import { resolveVidrockStreamsClient } from "@/lib/providers/vidrock-client-resolver"
import { resolveVaplayerClient } from "@/lib/providers/vaplayer-client"
import { resolveMovyStreamsClient, MOVY_STREAM_HEADERS } from "@/lib/providers/movy-client-resolver"
import { resolveSevenMoviesStreamsClient, SEVENMOVIES_CLIENT_HEADERS } from "@/lib/providers/7movies-client-resolver"
import { resolveCine4kStreamsClient, CINE4K_PROXY_HEADERS } from "@/lib/providers/cine4k-client-resolver"
import {
  resolveAthenaStreamsClient,
  resolveAthenaQ62Ladder,
  ATHENA_STREAM_HEADERS,
} from "@/lib/providers/athena-client-resolver"
import { resolveMovieboxStreamsClient } from "@/lib/providers/moviebox-client-resolver"
import {
  resolveGaiaflixStreamsClient,
  GAIAFLIX_STREAM_HEADERS,
} from "@/lib/providers/gaiaflix-client-resolver"
import {
  resolveHollymoviehdStreamsClient,
  HOLLY_STREAM_HEADERS,
} from "@/lib/providers/hollymoviehd-client-resolver"
import {
  resolveVsembedStreamsClient,
  buildVsembedStreamHeaders,
  VSEMBED_STREAM_HEADERS,
} from "@/lib/providers/vsembed-client-resolver"
import {
  resolveGlendaleStreamsClient,
  GLENDALE_STREAM_HEADERS,
} from "@/lib/providers/glendale-client-resolver"
import {
  resolveFilesunStreamsClient,
  FILESUN_STREAM_HEADERS,
} from "@/lib/providers/filesun-client-resolver"
import {
  resolveVidsrcToStreamsClient,
  VIDSRC_TO_STREAM_HEADERS,
} from "@/lib/providers/vidsrc-client-resolver"
import {
  CLIENT_RESOLVE_PROVIDER_IDS,
  DEFAULT_PROVIDER_LABELS,
  normalizeProviderName,
} from "@/lib/stream-sources-defaults"
import {
  isVidrockClientPlaybackTestEnabled,
  VIDROCK_CLIENT_TEST_MESSAGE,
} from "@/lib/vidrock-client-test"

export type ClientResolvedSource = {
  url: string
  type: string
  quality: string
  provider: { id: string; name: string }
  audioTracks: Array<{ id: string; language: string; label: string }>
  directClientPlayback?: boolean
  clientPlaybackHeaders?: Record<string, string>
  iframeEmbed?: boolean
  /** Crop Vidy controls; Chillflix skin owns the chrome. */
  videasyPlayerSurface?: boolean
}

export { VIDROCK_CLIENT_TEST_MESSAGE }

export type ClientResolveParams = {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
  playbackToken?: string
  requestOrigin?: string
  /** Cap unlock/soft-gap polling (Auto scan passes ~4s). */
  waitMs?: number
}

function inferSourceType(streamUrl: string) {
  const lower = streamUrl.toLowerCase()
  if (lower.includes(".m3u8")) return "hls"
  // VAPlayer/YTS masters are extensionless /pl/... playlists
  if (/\/pl\/[a-z0-9._-]+/i.test(lower)) return "hls"
  if (lower.includes("onlinecoachingacademy.site/")) return "hls"
  if (lower.includes("remoteconsultinggroup.site/")) return "hls"
  return "file"
}

function buildProxyHeaders(referer: string) {
  return {
    Referer: referer,
    Origin: "https://cloudorchestranova.com",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  }
}

function buildVideasyProxyHeaders() {
  // Videasy/wecollege kite CDN expects movy.sx (same as seed Origin ACL).
  return {
    Referer: "https://www.movy.sx/",
    Origin: "https://www.movy.sx",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  }
}

export function isClientResolveProvider(providerId: string) {
  const key = normalizeProviderName(providerId)
  if (key === "vidrock") {
    return isVidrockClientPlaybackTestEnabled()
  }
  return CLIENT_RESOLVE_PROVIDER_IDS.has(key)
}

export function isServerScrapeDiagnosticForClientProvider(diagnostic: {
  code?: string
  message?: string
}) {
  if (diagnostic.code !== "PROVIDER_ERROR") return false

  const match = diagnostic.message?.match(/^([^:]+):/)
  if (!match) return false

  return isClientResolveProvider(match[1].trim())
}

export function stripClientProviderServerDiagnostics<
  T extends { code?: string; message?: string },
>(diagnostics: T[]): T[] {
  return diagnostics.filter((item) => !isServerScrapeDiagnosticForClientProvider(item))
}

export const CLIENT_RESOLVE_PROVIDER_MESSAGE =
  "Resolves in the viewer's browser (uses their IP), not on the VPS. Test by playing a title on the site, or use Test on this provider while logged in here."

export async function resolveClientProviderSources(
  providerId: string,
  params: ClientResolveParams
): Promise<{ sources: ClientResolvedSource[]; failureReason?: string }> {
  const key = normalizeProviderName(providerId)
  // Prefer www.chillflix.pw — apex (chillflix.pw) rewrite/CORS mismatches black-screen
  // HLS after source switches (Movy/VAPlayer child playlists).
  const origin =
    params.requestOrigin ??
    (typeof window !== "undefined"
      ? resolveClientPlaybackProxyOrigin() || window.location.origin
      : "https://www.chillflix.pw")

  if (key === "vidify") {
    const resolved = await resolveVidifyStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason }
    }

    const proxyHeaders = buildProxyHeaders(resolved.referer)
    const label = DEFAULT_PROVIDER_LABELS.vidify ?? "Vidify"

    const sources = resolved.streams.map((streamUrl, index) => ({
      url: buildCineproProxyHref(
        origin,
        streamUrl,
        proxyHeaders,
        params.playbackToken
      ),
      type: inferSourceType(streamUrl),
      quality: index === 0 ? "Auto" : `Stream ${index + 1}`,
      provider: { id: "vidify", name: label },
      audioTracks: [{ id: "original", language: "Original", label: "Original" }],
    }))

    return { sources }
  }

  if (key === "4khdhub") {
    const fourKOrigin = resolveFourKApiOrigin(origin)

    const resolved = await resolveFourKStreamsClient(
      {
        type: params.type,
        tmdbId: params.tmdbId,
        season: params.season,
        episode: params.episode,
      },
      fourKOrigin
    )

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason }
    }

    const label = DEFAULT_PROVIDER_LABELS["4khdhub"] ?? "4K"

    const sources = resolved.streams.map((stream) => {
      if (stream.codec === "hevc") {
        const search = new URLSearchParams({
          tmdbId: params.tmdbId,
          type: params.type,
          quality: stream.quality,
          filename: stream.filename,
          mode: "transcode",
        })
        if (params.season) search.set("season", params.season)
        if (params.episode) search.set("episode", params.episode)

        return {
          url: `${fourKOrigin}/api/4k/hls/manifest?${search.toString()}`,
          type: "hls",
          quality: stream.quality,
          provider: { id: "4khdhub", name: label },
          audioTracks: [{ id: "original", language: "en", label: "English" }],
        }
      }

      if (fourKStreamNeedsRemux(stream)) {
          const search = new URLSearchParams({
            tmdbId: params.tmdbId,
            type: params.type,
            quality: stream.quality,
            filename: stream.filename,
            mode: "remux",
          })
          if (params.season) search.set("season", params.season)
          if (params.episode) search.set("episode", params.episode)

          return {
            url: `${fourKOrigin}/api/4k/hls/manifest?${search.toString()}`,
            type: "hls",
            quality: stream.quality,
            provider: { id: "4khdhub", name: label },
            audioTracks: [{ id: "original", language: "en", label: "English" }],
          }
        }

        const proxyHeaders = {
          Referer: "https://hubcloud.ist/",
          Origin: "https://hubcloud.ist",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        }

        return {
          url: buildCineproProxyHref(
            origin,
            stream.url,
            proxyHeaders,
            params.playbackToken
          ),
          type: "file",
          quality: stream.quality,
          provider: { id: "4khdhub", name: label },
          audioTracks: [{ id: "original", language: "en", label: "English" }],
        }
      })

    return { sources }
  }

  if (key === "videasy") {
    const proxyHeaders = buildVideasyProxyHeaders()
    const label = DEFAULT_PROVIDER_LABELS.videasy ?? "Videasy"

    const qualityRank = (q?: string) => {
      const v = String(q || "").toLowerCase()
      if (v.includes("2160") || v.includes("4k")) return 2160
      if (v.includes("1440")) return 1440
      if (v.includes("1080")) return 1080
      if (v.includes("720")) return 720
      if (v.includes("480")) return 480
      if (v.includes("360")) return 360
      return 0
    }

    const toSources = (
      streams: Array<{ url: string; type?: string; quality?: string }>
    ) => {
      const ranked = [...streams].sort((a, b) => {
        const ra = qualityRank(a.quality)
        const rb = qualityRank(b.quality)
        const score = (r: number) =>
          r === 720 ? 10_000 : r === 1080 ? 9_000 : r > 1080 ? r : r + 5000
        return score(rb) - score(ra)
      })
      return ranked.map((stream) => ({
        // Goldenkite needs viewer IP OR WARP egress. Bridge anyip is flaky on
        // embed; cinepro->WARP plays reliably (verified 200 on moon.goldenkite).
        url: buildCineproProxyHref(
          origin,
          String(stream.url || ""),
          proxyHeaders,
          params.playbackToken
        ),
        type: (stream.type === "hls" || stream.type === "file"
          ? stream.type
          : "hls") as "hls" | "file",
        quality: stream.quality || "Auto",
        provider: { id: "videasy", name: label },
        audioTracks: [{ id: "original", language: "en", label: "English" }],
        clientResolved: true,
        clientResolvedAt: Date.now(),
      }))
    }

    return await new Promise<{
      sources: ClientResolvedSource[]
      failureReason?: string
    }>((resolve) => {
      let settled = false
      const settle = (result: {
        sources: ClientResolvedSource[]
        failureReason?: string
      }) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      void resolveVideasyStreamsClient(
        {
          type: params.type,
          tmdbId: params.tmdbId,
          season: params.season,
          episode: params.episode,
        },
        {
          onPartial: (streams) => {
            if (!streams?.length) return
            settle({ sources: toSources(streams) })
          },
        }
      )
        .then((resolved) => {
          if (!resolved.streams.length) {
            settle({
              sources: [],
              failureReason:
                resolved.failureReason || "Videasy returned no streams",
            })
            return
          }
          settle({ sources: toSources(resolved.streams) })
        })
        .catch((err) => {
          settle({
            sources: [],
            failureReason:
              err instanceof Error ? err.message : "Videasy resolve failed",
          })
        })
    })
  }

  if (key === "vaplayer") {
    const resolved = await resolveVaplayerClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
      waitMs: params.waitMs,
    })

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason || resolved.error }
    }

    const label = DEFAULT_PROVIDER_LABELS.vaplayer ?? "VAPlayer"
    // Server unlock mints IP-bound CDN tokens for the VPS. Play through cinepro
    // proxy so segments are fetched with those tokens (viewer IP cannot use them).
    const proxyHeaders = {
      Referer: "https://nextgencloudfabric.com/",
      Origin: "https://nextgencloudfabric.com",
      Accept: "*/*",
    }
    const sources = resolved.streams.map((streamUrl, index) => ({
      url: buildCineproProxyHref(
        origin,
        streamUrl,
        proxyHeaders,
        params.playbackToken
      ),
      type: inferSourceType(streamUrl),
      quality:
        index === 0
          ? "Auto"
          : resolved.fileName
            ? `Mirror ${index + 1}`
            : `Stream ${index + 1}`,
      provider: { id: "vaplayer", name: label },
      audioTracks: [{ id: "original", language: "Original", label: "Original" }],
    }))

    return { sources }
  }

  if (key === "vidrock") {
    const resolved = await resolveVidrockStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason }
    }

    const label = DEFAULT_PROVIDER_LABELS.vidrock ?? "VidRock"

    const sources = resolved.streams.map((stream) => ({
      url: stream.url,
      type: stream.type,
      quality: stream.quality,
      provider: { id: "vidrock", name: label },
      audioTracks: [{ id: "original", language: "en", label: "English" }],
      directClientPlayback: true,
      clientPlaybackHeaders: stream.headers,
    }))

    return { sources }
  }



  if (key === "7movies") {
    const resolved = await resolveSevenMoviesStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason }
    }

    const label = DEFAULT_PROVIDER_LABELS["7movies"] ?? "7Movies"
    // Boot/API resolves in the viewer browser (user IP). Orion CDN requires
    // Referer embed.vidrift.net which browsers forbid forging — proxy media.
    const proxyHeaders = {
      ...SEVENMOVIES_CLIENT_HEADERS,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }

    const languageName = (rawLabel: string) => {
      const name = rawLabel
        .replace(/^7Movies\s+/i, "")
        .replace(/^Orion\s*·\s*/i, "")
        .trim()
        .toLowerCase()
      if (name === "original" || name.includes("english")) return "English"
      if (name.includes("latin american")) return "Latin American Spanish"
      if (name.includes("brazilian")) return "Brazilian Portuguese"
      const table: Record<string, string> = {
        russian: "Russian",
        spanish: "Spanish",
        portuguese: "Portuguese",
        french: "French",
        hindi: "Hindi",
        ukrainian: "Ukrainian",
        german: "German",
        italian: "Italian",
        arabic: "Arabic",
        turkish: "Turkish",
        polish: "Polish",
        japanese: "Japanese",
        korean: "Korean",
        chinese: "Chinese",
        dutch: "Dutch",
        tamil: "Tamil",
        telugu: "Telugu",
        filipino: "Filipino",
        malayalam: "Malayalam",
        kannada: "Kannada",
        bengali: "Bengali",
      }
      return table[name] || ""
    }

    // Original is the English track. Other named dubs stay in the language list.
    // Keep ALL languages (incl. HEVC Original/French). Autoselect prefers MP4 so
    // Chrome does not start-then-vanish on HEVC English — see pickPreferredLanguageSource.
    const dubbedAll = resolved.streams.flatMap((stream) => {
      const language = languageName(stream.label || "")
      return language ? [{ stream, language }] : []
    })
    const dubbed = [...dubbedAll].sort((a, b) => {
      const ae = a.language === "English" ? 0 : 1
      const be = b.language === "English" ? 0 : 1
      if (ae !== be) return ae - be
      // Prefer mp4 when both are English (or same lang)
      const am = a.stream.type === "mp4" ? 0 : 1
      const bm = b.stream.type === "mp4" ? 0 : 1
      return am - bm
    })

    // One row per language. Do NOT expand rungs into 1080p/720p/480p rows —
    // those keys collide across Hindi/French/Original and leave only Russian.
    // HLS ABR still fills the Quality sheet after the stream starts.
    const sources = dubbed.length
      ? dubbed.map(({ stream, language }) => {
          const proxied = buildCineproProxyHref(
            origin,
            stream.url,
            proxyHeaders,
            params.playbackToken
          )
          return {
            url: proxied,
            type: stream.type === "hls" ? ("hls" as const) : ("mp4" as const),
            quality: language,
            provider: { id: "7movies", name: label },
            audioTracks: [
              {
                id: language.toLowerCase().replace(/[^a-z0-9]+/g, ""),
                language,
                label: language,
              },
            ],
          }
        })
      : resolved.streams.map((stream, index) => ({
          url: buildCineproProxyHref(
            origin,
            stream.url,
            proxyHeaders,
            params.playbackToken
          ),
          type: stream.type === "hls" ? "hls" : "file",
          quality:
            index === 0
              ? stream.quality || stream.label || "Auto"
              : `${stream.quality || "Auto"} · ${stream.label}`,
          provider: {
            id: "7movies",
            name: stream.label ? `${label} ${stream.label}` : label,
          },
          audioTracks: [{ id: "original", language: "Original", label: "Original" }],
        }))

    return { sources }
  }


  if (key === "novahd") {
    const q = new URLSearchParams({
      type: params.type,
      tmdbId: params.tmdbId,
    })
    if (params.season) q.set("season", params.season)
    if (params.episode) q.set("episode", params.episode)

    const response = await fetch(`/api/novahd/client-meta?${q}`, {
      cache: "no-store",
    })
    const data = (await response.json()) as {
      streams?: Array<{ url?: string; quality?: string; label?: string; type?: string }>
      headers?: Record<string, string>
      failureReason?: string
    }

    const rows = Array.isArray(data.streams) ? data.streams : []
    if (!rows.length) {
      return { sources: [], failureReason: data.failureReason || "No NovaHD streams" }
    }

    const label = DEFAULT_PROVIDER_LABELS.novahd ?? "NovaHD"
    const proxyHeaders = data.headers || {
      Referer: "https://novahd.cc/",
      Origin: "https://novahd.cc",
      Accept: "*/*",
    }

    const sources = rows.map((stream, index) => ({
      url: buildCineproProxyHref(
        origin,
        String(stream.url || ""),
        proxyHeaders,
        params.playbackToken
      ),
      type: stream.type === "hls" ? ("hls" as const) : ("mp4" as const),
      quality: stream.quality || stream.label || (index === 0 ? "Auto" : `Stream ${index + 1}`),
      provider: { id: "novahd", name: label },
      audioTracks: [{ id: "original", language: "Original", label: "Original" }],
    }))

    return { sources }
  }

  if (key === "movy") {
    const resolved = await resolveMovyStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason }
    }

    const proxyHeaders = {
      Referer: "https://www.movy.sx/",
      Origin: "https://www.movy.sx",
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }
    const label = DEFAULT_PROVIDER_LABELS.movy ?? "Movy"

    const qualityRank = (q?: string) => {
      const v = String(q || "").toLowerCase()
      if (v.includes("2160") || v.includes("4k")) return 2160
      if (v.includes("1440")) return 1440
      if (v.includes("1080")) return 1080
      if (v.includes("720")) return 720
      if (v.includes("480")) return 480
      if (v.includes("360")) return 360
      return 0
    }

    // Prefer Full HD as the default playable URL; keep 4K in Quality.
    const rankedStreams = [...resolved.streams].sort((a, b) => {
      const ra = qualityRank(a.quality)
      const rb = qualityRank(b.quality)
      const score = (r: number) => (r === 1080 ? 10_000 : r > 1080 ? r : r + 5000)
      return score(rb) - score(ra)
    })

    const sources = rankedStreams.map((stream, index) => {
      const rawUrl = String(stream.url || "")
      const path = rawUrl.split("?")[0]?.toLowerCase() ?? ""
      // Playlists are config-/data-*.json or .m3u8. Miami/Boise (zenoak etc.)
      // ship HLS media playlists with no extension — treat those as HLS too.
      const isPlaylist =
        path.includes(".m3u8") ||
        /\/(?:config|data)-[^/]+\.json$/.test(path) ||
        !/\.(mp4|m4v|mkv|webm|mov)(?:$|\?)/i.test(path)
      return {
        url: buildCineproProxyHref(
          origin,
          rawUrl,
          proxyHeaders,
          params.playbackToken
        ),
        type: (isPlaylist ? "hls" : "mp4") as "hls" | "mp4",
        quality:
          index === 0
            ? stream.quality || "Auto"
            : `${stream.quality || "Auto"} · ${stream.city}`,
        provider: {
          id: "movy",
          name: stream.city
            ? `${label} ${stream.city.charAt(0).toUpperCase()}${stream.city.slice(1)}`
            : label,
        },
        audioTracks: [{ id: "original", language: "Original", label: "Original" }],
      }
    })

    return { sources }
  }


  if (key === "moviebox") {
    const resolved = await resolveMovieboxStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.moviebox ?? "MovieBox"
    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason || "MovieBox returned no streams" }
    }
    const sources = resolved.streams.map((stream) => ({
      url: String(stream.url || ""),
      type: "mp4" as const,
      quality: stream.quality || "Auto",
      provider: { id: "moviebox", name: label },
      audioTracks: [{ id: "original", language: "Original", label: "Original" }],
      directClientPlayback: true,
    }))
    return { sources }
  }

  if (key === "cine4k") {
    const resolved = await resolveCine4kStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.cine4k ?? "Cine4K"
    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason || "Cine4K returned no streams" }
    }
    const sources = resolved.streams.map((stream) => ({
      url: buildCineproProxyHref(
        origin,
        String(stream.url || ""),
        resolved.headers || CINE4K_PROXY_HEADERS,
        params.playbackToken
      ),
      type: "hls" as const,
      quality: stream.quality || "Auto",
      provider: { id: "cine4k", name: label },
      audioTracks: [{ id: "english", language: "English", label: "English" }],
    }))
    return { sources }
  }

  if (key === "athena") {
    // Helios/Light on transcode.cfd:
    // - Browser Origin chillflix.* → CDN 403 (ACAO only atlantic.st) so
    //   directClientPlayback hangs on "Starting playback…"/black.
    // - Fetch via WARP socks → Atlantic serves the Warp interstitial video.
    // Play through cinepro proxy on the plain VPS IP (no WARP).
    const resolved = await resolveAthenaStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.athena ?? "Athena"
    const cleanStreams = resolved.streams.filter(
      (s) => s?.url && !/zstream-proxy\.bluevelvet\.space/i.test(String(s.url))
    )
    if (!cleanStreams.length) {
      return {
        sources: [],
        failureReason:
          resolved.failureReason ||
          "Athena clean stream unavailable — try again or pick another source",
      }
    }
    const primary = cleanStreams[0]!
    let rawUrl = String(primary.url || "")
    if (rawUrl.startsWith("/")) rawUrl = `${origin}${rawUrl}`
    rawUrl = rawUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, origin)
    const isSameOriginAthena = rawUrl.startsWith("/api/athena/")
    const language =
      String((primary as { language?: string }).language || "").trim() || "English"
    const sources = [
      {
        url: isSameOriginAthena
          ? rawUrl
          : buildCineproProxyHref(
              origin,
              rawUrl,
              {
                ...(resolved.headers || ATHENA_STREAM_HEADERS),
                Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
              },
              params.playbackToken
            ),
        type: "hls" as const,
        quality: /4\s*k|2160|uhd/i.test(String(primary.quality || ""))
          ? "1080p"
          : String(primary.quality || "1080p"),
        provider: { id: "athena", name: label },
        providerId: "athena",
        has4k: false,
        audioTracks: [
          {
            id: language.toLowerCase().replace(/[^a-z0-9]+/g, "") || "english",
            language,
            label: language,
          },
        ],
      },
    ]
    return { sources }
  }

  if (key === "gaiaflix") {
    const resolved = await resolveGaiaflixStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.gaiaflix ?? "GaiaFlix"
    if (resolved.streams.some((stream) => String(stream.url || "").includes("/api/gaiaflix/playlist"))) {
      return {
        sources: resolved.streams.map((stream) => ({
          url: String(stream.url || ""),
          type: "hls" as const,
          quality: stream.quality || "1080p",
          provider: { id: "gaiaflix", name: label },
          audioTracks: [{ id: "english", language: "English", label: "English" }],
        })),
      }
    }
    if (resolved.iframeEmbedUrl) {
      return {
        sources: [
          {
            url: resolved.iframeEmbedUrl,
            type: "embed" as const,
            quality: "1080p",
            provider: { id: "gaiaflix", name: label },
            iframeEmbed: true,
            audioTracks: [{ id: "english", language: "English", label: "English" }],
          },
        ],
      }
    }
    if (!resolved.streams.length) {
      return { sources: [], failureReason: resolved.failureReason || "GaiaFlix returned no streams" }
    }
    const proxyHeaders = {
      ...(resolved.headers || GAIAFLIX_STREAM_HEADERS),
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    }
    const sources = resolved.streams.map((stream) => ({
      url: buildCineproProxyHref(
        origin,
        String(stream.url || ""),
        proxyHeaders,
        params.playbackToken
      ),
      type: "hls" as const,
      quality: stream.quality || "Auto",
      provider: { id: "gaiaflix", name: label },
      audioTracks: [{ id: "english", language: "English", label: "English" }],
    }))
    return { sources }
  }

  if (key === "vsembed") {
    console.info("[vsembed] client-resolve start", params)
    const resolved = await resolveVsembedStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    const label = DEFAULT_PROVIDER_LABELS.vsembed ?? "VSEmbed"
    console.info("[vsembed] client-resolve done", {
      streams: resolved.streams.length,
      failureReason: resolved.failureReason,
    })

    if (resolved.streams.length) {
      const proxyHeaders = {
        ...(resolved.headers || buildVsembedStreamHeaders(resolved.origin) || VSEMBED_STREAM_HEADERS),
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      }

      const sources = resolved.streams.map((stream) => {
        const rawUrl = String(stream.url || "")
        // Tunnel so Referer/Origin match the gate host from vs_src landing.
        return {
          url: buildCineproProxyHref(origin, rawUrl, proxyHeaders, params.playbackToken),
          type: "hls" as const,
          quality: stream.quality || "Auto",
          provider: { id: "vsembed", name: label },
          audioTracks: [{ id: "english", language: "English", label: "English" }],
        }
      })

      return { sources }
    }

    return { sources: [], failureReason: resolved.failureReason || "VSEmbed scrape returned no streams" }
  }


  if (key === "vidsrc") {
    const resolved = await resolveVidsrcToStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })

    const label = DEFAULT_PROVIDER_LABELS.vidsrc ?? "Vidsrc.to"

    if (resolved.streams.length) {
      const proxyHeaders = {
        ...(resolved.headers || VIDSRC_TO_STREAM_HEADERS),
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      }
      const sources = resolved.streams.map((stream) => ({
        url: buildCineproProxyHref(origin, stream.url, proxyHeaders, params.playbackToken),
        type: "hls" as const,
        quality: stream.quality || "Auto",
        provider: { id: "vidsrc", name: label },
        audioTracks: [{ id: "english", language: "English", label: "English" }],
      }))
      return { sources }
    }

    if (resolved.iframeEmbedUrl) {
      return {
        sources: [
          {
            url: resolved.iframeEmbedUrl,
            type: "embed",
            quality: "Auto",
            provider: { id: "vidsrc", name: label },
            audioTracks: [{ id: "english", language: "English", label: "English" }],
            iframeEmbed: true,
          },
        ],
      }
    }

    return {
      sources: [],
      failureReason: resolved.failureReason || "Vidsrc.to returned no streams",
    }
  }


  if (key === "hollymoviehd") {
    const resolved = await resolveHollymoviehdStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = "HollyMovieHD"
    if (!resolved.streams.length) {
      return {
        sources: [],
        failureReason: resolved.failureReason || "HollyMovieHD returned no streams",
      }
    }
    const sources = resolved.streams.map((stream) => {
      const rawUrl = String(stream.url || "")
      const proxyHeaders = {
        ...(stream.headers || resolved.headers || HOLLY_STREAM_HEADERS),
        Accept: "*/*",
      }
      return {
        url: buildCineproProxyHref(origin, rawUrl, proxyHeaders, params.playbackToken),
        type: inferSourceType(rawUrl),
        quality: stream.quality || "Auto",
        provider: { id: "hollymoviehd", name: label },
        audioTracks: [{ id: "original", language: "Original", label: "Original" }],
      }
    })
    return { sources }
  }

  
  if (key === "cinesu") {
    const resolved = await resolveGlendaleStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.cinesu ?? "Koddo"
    // Browser-IP path: embed Koddo watch page (viewer completes gate on koddo.to).
    if (resolved.iframeEmbedUrl) {
      return {
        sources: [
          {
            url: resolved.iframeEmbedUrl,
            type: "embed" as const,
            quality: "Auto",
            provider: { id: "cinesu", name: label },
            iframeEmbed: true,
            audioTracks: [{ id: "english", language: "English", label: "English" }],
          },
        ],
      }
    }
    if (!resolved.streams.length) {
      return {
        sources: [],
        failureReason: resolved.failureReason || "Koddo / Glendale returned no streams",
      }
    }
    const proxyHeaders = {
      ...(resolved.headers || GLENDALE_STREAM_HEADERS),
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    }
    const sources = resolved.streams.map((stream) => ({
      url: buildCineproProxyHref(
        origin,
        String(stream.url || ""),
        proxyHeaders,
        params.playbackToken
      ),
      type: "hls" as const,
      quality: stream.quality || "Auto",
      provider: { id: "cinesu", name: label },
      audioTracks: [{ id: "english", language: "English", label: "English" }],
    }))
    return { sources }
  }


  if (key === "filesun") {
    // Native HLS in Chillflix only — never mount filesun.sbs iframe.
    const resolved = await resolveFilesunStreamsClient({
      type: params.type,
      tmdbId: params.tmdbId,
      season: params.season,
      episode: params.episode,
    })
    const label = DEFAULT_PROVIDER_LABELS.filesun ?? "FileSuN"
    if (!resolved.streams.length) {
      return {
        sources: [],
        failureReason:
          resolved.failureReason ||
          "FileSuN returned no playable HLS for Chillflix player",
      }
    }
    const proxyHeaders = {
      ...(resolved.headers || FILESUN_STREAM_HEADERS),
      Accept: "*/*",
    }
    const sources = resolved.streams.map((stream) => ({
      url: buildCineproProxyHref(
        origin,
        String(stream.url || ""),
        proxyHeaders,
        params.playbackToken
      ),
      type: "hls" as const,
      quality: stream.quality || "Auto",
      provider: { id: "filesun", name: label },
      audioTracks: [{ id: "original", language: "Original", label: "Original" }],
    }))
    return { sources }
  }

return { sources: [], failureReason: `Unknown client-resolve provider: ${providerId}` }
}
