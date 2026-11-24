"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
    getOrderedEnabledProviderIds,
    isBackgroundSourcesPending,
    isVidLinkOnlySources,
    normalizeCinemacityCdnPlaybackUrl,
    parseUnavailableProviders,
    playbackUrlWithoutToken,
    shouldHoldEmptyStateForDiscovery,
    shouldHoldForHigherRankedProviders,
    TERMINAL_SOURCE_DIAGNOSTIC_CODES,
} from "@/components/player/utils/playback"
import {
  isClientResolveProvider,
  resolveClientProviderSources,
  stripClientProviderServerDiagnostics,
} from "@/lib/client-resolve-providers"
import { decodeCineproProxyPayloadFromHref } from "@/lib/cinepro/proxy"
import { buildEmergencyVidlinkPayload } from "@/lib/emergency-vidlink-source"
import { stripNativeFlixhqSources } from "@/lib/native-flixhq"
import { stripNativeHuhuSources } from "@/lib/native-huhu"
import { isNativeChillflixProvider } from "@/lib/native-chillflix-providers"
import { stripNativeVidlinkSources } from "@/lib/native-vidlink"
import {
  PLAYBACK_MAX_AGE_SEC,
  requiresPlaybackTokenUrl,
  withPlaybackToken,
} from "@/lib/playback-token"
import {
    ensureStreamSourcesConfigReady,
    getEnabledProviderIds,
    getHeadStartMs,
    getProviderFetchTimeoutMs,
    isStreamSourcesConfigReady,
} from "@/hooks/useStreamSourcesConfig"
import {
    filterSourcesByEnabledIds,
    STREAM_SOURCES_CONFIG_EVENT,
} from "@/lib/stream-sources-client"
import { resolveTitleUnavailableMessage } from "@/lib/playback-user-messages"
import {
  INITIAL_SOURCES_FETCH_TIMEOUT_MS,
  PROVIDER_SOURCE_FETCH_TIMEOUT_MS,
} from "@/lib/source-probe-constants"
import { MANUAL_ONLY_PROVIDER_IDS, normalizeProviderName } from "@/lib/stream-sources-defaults"
import { stripVidrockServerSourcesWhenClientTest } from "@/lib/vidrock-client-test"
import {
  buildMediaSourcesCacheKey,
  MEDIA_SOURCES_CACHE_TTL_MS,
  prefetchMediaSources,
  schedulePrefetchMediaSources,
  type PrefetchMediaSourcesParams,
} from "@/lib/prefetch-media-sources"
import {
  forgetSharedStreamCache,
  publishSharedStreamCache,
  readSharedStreamCache,
} from "@/lib/shared-stream-cache-client"

export {
  buildMediaSourcesCacheKey,
  prefetchMediaSources,
  schedulePrefetchMediaSources,
}
export type { UseMediaSourcesParams }

function stripNativePlaybackSources<T extends { url: string }>(
  sources: T[],
  options?: { manual?: boolean; provider?: string }
) {
  const manualNativeProvider = Boolean(
    options?.provider && isNativeChillflixProvider(options.provider)
  )

  const manual = Boolean(options?.manual || manualNativeProvider)
  return stripNativeHuhuSources(
    stripNativeFlixhqSources(stripNativeVidlinkSources(sources, { ...options, manual }), {
      ...options,
      manual,
    }),
    { manual }
  )
}

interface MediaSource {
  url: string
  type: string
  quality: string
  provider: { id: string; name: string }
  audioTracks: Array<{ id: string; language: string; label: string }>
  cinemacityPageUrl?: string
  directClientPlayback?: boolean
  clientPlaybackHeaders?: Record<string, string>
  /** Browser resolver finished. Bulk CinePro rows for the same provider are not this. */
  clientResolved?: boolean
  /** When clientResolved became true (ms). Used to reuse streams on provider switch. */
  clientResolvedAt?: number
  iframeEmbed?: boolean
}

interface MediaSubtitle {
  id: string
  label: string
  language: string
  kind: string
  src: string
}

interface MediaDiagnostic {
  code: string
  message: string
  severity: string
}

type UseMediaSourcesParams = PrefetchMediaSourcesParams & {
  enabled?: boolean
  /** When true, skip background source polling/scans — playback is already running. */
  playbackActive?: boolean
  /**
   * Updated by the player while a scan is in flight. When a health probe marks
   * any source ready, the walk stops immediately (first working stream wins).
   */
  hasReadySourceRef?: { current: boolean }
  /**
   * Provider ids whose streams all failed health probes — settle waits exit
   * early so the next admin-ordered provider is fetched without a long delay.
   */
  healthFailedProviderIdsRef?: { current: readonly string[] }
  /** Embed / third-party iframe: start on first CinePro batch, defer full provider walk. */
  embedFastStart?: boolean
}

interface SourcesPayload {
  sources: MediaSource[]
  subtitles: MediaSubtitle[]
  diagnostics: MediaDiagnostic[]
}

interface UseMediaSourcesResult {
  sources: MediaSource[]
  subtitles: MediaSubtitle[]
  diagnostics: MediaDiagnostic[]
  playbackToken?: string
  isLoading: boolean
  isLoadingMore: boolean
  error: string | undefined
  refetchSources: () => void
  refetchSourcesAsync: () => Promise<SourcesPayload>
  requestProvider: (providerId: string) => Promise<SourcesPayload>
  scanningProviderId?: string
  scanFailedProviderIds: string[]
  isScanningProviders: boolean
  providerScanStartedAt?: number
  resolvedParamsKey: string
}

const FETCH_TIMEOUT_MS = 65_000
const PROVIDER_FETCH_TIMEOUT_MS = PROVIDER_SOURCE_FETCH_TIMEOUT_MS
const OFFLINE_RETRY_MS = 10_000
const BACKGROUND_POLL_MS = 20_000
const BACKGROUND_POLL_FIRST_MS = 5_000
const BACKGROUND_PENDING_CAP_MS = 28_000
const INITIAL_LOADING_CAP_MS = 18_000
const PROVIDER_BOOTSTRAP_DELAY_MS = 300
const BACKGROUND_MERGE_KICK_MS = 1_500
/** One try + one retry. Extra retries used to refill the Node queue under load. */
const SOURCE_FETCH_ATTEMPTS = 2
const RETRYABLE_HTTP_STATUSES = new Set([408, 500, 502, 503, 504])
const TOKEN_REFRESH_LEAD_MS = 30 * 60 * 1000
const TOKEN_REFRESH_INTERVAL_MS = PLAYBACK_MAX_AGE_SEC * 1000 - TOKEN_REFRESH_LEAD_MS

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function fetchSourcesWithTimeout(
  fetchSources: (
    options?: {
      retry?: boolean
      fresh?: boolean
      merge?: boolean
      provider?: string
      preserveNativeVidlink?: boolean
    }
  ) => Promise<SourcesPayload>,
  options?: {
    retry?: boolean
    fresh?: boolean
    merge?: boolean
    provider?: string
    preserveNativeVidlink?: boolean
  }
) {
  const raceTimeoutMs = options?.provider
    ? getProviderFetchTimeoutMs(options.provider, PROVIDER_FETCH_TIMEOUT_MS)
    : PROVIDER_FETCH_TIMEOUT_MS
  return Promise.race([
    fetchSources(options),
    sleep(raceTimeoutMs).then(() => {
      throw new Error("Provider scan timed out")
    }),
  ])
}

function purgeMalformedCinemacitySourceCaches() {
  if (typeof window === "undefined") return

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith("media-sources:")) continue

      const raw = localStorage.getItem(key)
      if (!raw) continue

      if (raw.includes(",urlset") || raw.includes("public_files/,")) {
        localStorage.removeItem(key)
        continue
      }

      try {
        const parsed = JSON.parse(raw) as { sources?: Array<{ url?: string }> }
        const hasMalformedUrl = (parsed.sources ?? []).some((source) =>
          source.url?.includes(",urlset")
        )
        if (hasMalformedUrl) {
          localStorage.removeItem(key)
        }
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // ignore
  }
}

if (typeof window !== "undefined") {
  purgeMalformedCinemacitySourceCaches()
}

const buildCacheKey = buildMediaSourcesCacheKey
const sourcesFetchInflight = new Map<string, Promise<SourcesPayload>>()

function buildSourcesFetchDedupeKey(
  params: URLSearchParams,
  options?: { provider?: string; fresh?: boolean }
) {
  if (options?.provider) {
    // Ignore retry=1 so the first-paint primary kick and the provider scan
    // share one in-flight request instead of resolving #1 twice.
    const provider = normalizeProviderName(options.provider)
    const type = params.get("type") ?? ""
    const tmdbId = params.get("tmdbId") ?? ""
    const season = params.get("season") ?? ""
    const episode = params.get("episode") ?? ""
    const fresh = options.fresh || params.get("fresh") === "1" ? "1" : "0"
    return `provider|${provider}|${type}|${tmdbId}|${season}|${episode}|fresh=${fresh}`
  }

  return [
    params.get("type") ?? "",
    params.get("tmdbId") ?? "",
    params.get("season") ?? "",
    params.get("episode") ?? "",
  ].join("|")
}

/** Auto-scan per-provider budget (legacy fallback). */
const AUTO_PROVIDER_SCAN_TIMEOUT_MS = 4_000
/**
 * Multi-pass discovery (3 circles through admin order).
 * Keep each Auto row short (~4s) so unlock-pending VA doesn't freeze the
 * testing spinner; later passes get a bit more budget for cold scrapes.
 */
const SCAN_PASS_TIMEOUTS_MS = [4_000, 6_000, 10_000] as const
const SCAN_PASS_COUNT = 3
/** No extra hang on #1 — same 4s budget as the rest of the list. */
const SCAN_PRIMARY_TIMEOUT_BONUS_MS = 0
/**
 * Auto Sources walk is sequential (one provider at a time) so the Sources
 * sheet can show a single testing spinner and failed X marks in list order.
 * Parallel secondaries made scanningProviderId jump and skipped visible demotion.
 */
const SCAN_SECONDARY_CONCURRENCY = 1

function shouldAutoRetry(diagnostics: MediaDiagnostic[]) {
  return diagnostics.some((item) => item.code === "CINEPRO_OFFLINE")
}

function refreshSourcePlaybackToken(url: string, token: string) {
  if (!requiresPlaybackTokenUrl(url)) {
    return url
  }

  return withPlaybackToken(url, token)
}

function sourcesHavePlaybackTokens(sources: unknown) {
  if (!Array.isArray(sources)) return false

  return sources.every((source) => {
    if (!source || typeof source !== "object") return false
    const url = (source as MediaSource).url
    if (typeof url !== "string" || !url) return false
    if (!requiresPlaybackTokenUrl(url)) return true
    return url.includes("pt=")
  })
}

function sourcesIncludeProvider(sources: MediaSource[], providerId: string) {
  const key = normalizeProviderName(providerId)
  return sources.some((source) => normalizeProviderName(source.provider.id) === key)
}

/** Client-resolve providers are not "found" until the browser resolver ran.
 *  A bulk CinePro master for VAPlayer lists 1080/720/360 and then never starts. */
function sourcesIncludeStartedProvider(sources: MediaSource[], providerId: string) {
  const key = normalizeProviderName(providerId)
  if (!isClientResolveProvider(key)) return sourcesIncludeProvider(sources, providerId)
  return sources.some(
    (source) =>
      normalizeProviderName(source.provider.id) === key &&
      source.clientResolved === true
  )
}

/** VAPlayer/Videasy/7Movies/… — not RiveStream/CNO/FileSuN bulk scrapes. */
function sourcesHavePreferredAutoStartProvider(sources: MediaSource[]): boolean {
  return sources.some((source) => {
    const id = source.provider?.id || ""
    // Only a resolved client-resolve row is "preferred" enough to stop waiting
    // on VAPlayer #1. RiveStream URLs used to count here and auto-skipped VA.
    if (!isClientResolveProvider(id)) return false
    return source.clientResolved === true
  })
}

/** Cached client-resolve CDN links die quickly — never skip re-scrape for them. */
function warmCacheHasClientResolveSources(sources: MediaSource[]): boolean {
  return sources.some((source) =>
    isClientResolveProvider(source.provider?.id || source.provider?.name || "")
  )
}

function withoutManualOnlyProviders(providerIds: string[]) {
  return providerIds.filter(
    (id) => !MANUAL_ONLY_PROVIDER_IDS.has(normalizeProviderName(id))
  )
}

function filterSourcesForEnabledProviders(sources: MediaSource[]) {
  if (!isStreamSourcesConfigReady()) {
    return sources
  }

  const enabledIds = getEnabledProviderIds()
  // Empty enabledIds is not a valid "disable everything" signal — it means the
  // config cache is incomplete. Wiping sources here left only a prior FileSuN
  // pick visible in the Sources sheet.
  if (enabledIds.length === 0) {
    return sources
  }

  return filterSourcesByEnabledIds(sources, enabledIds)
}

function sourceMergeKey(source: MediaSource) {
  return `${normalizeProviderName(source.provider.id)}:${source.quality}:${source.type}`
}

function mergeSources(existing: MediaSource[], incoming: MediaSource[], token?: string) {
  const byKey = new Map<string, MediaSource>()
  const seenUrls = new Set<string>()

  const sealUrl = (url: string) => (token ? refreshSourcePlaybackToken(url, token) : url)

  for (const source of existing) {
    const key = sourceMergeKey(source)
    const urlKey = playbackUrlWithoutToken(source.url)
    byKey.set(key, { ...source, url: sealUrl(source.url) })
    seenUrls.add(urlKey)
  }

  for (const source of incoming) {
    const key = sourceMergeKey(source)
    const urlKey = playbackUrlWithoutToken(source.url)
    const previous = byKey.get(key)

    if (previous) {
      byKey.set(key, {
        ...previous,
        ...source,
        // Always take the incoming stream URL. Client-resolve providers
        // (Videasy/Movy/VAPlayer) re-scrape expired CDNs — keeping previous.url
        // made Source taps look dead (menu closed, old source kept playing).
        url: sealUrl(source.url),
      })
      continue
    }

    if (seenUrls.has(urlKey)) {
      continue
    }

    byKey.set(key, { ...source, url: sealUrl(source.url) })
    seenUrls.add(urlKey)
  }

  return Array.from(byKey.values())
}

export function useMediaSources({
  id,
  type,
  season,
  episode,
  enabled = true,
  playbackActive = false,
  hasReadySourceRef,
  healthFailedProviderIdsRef,
  embedFastStart = false,
}: UseMediaSourcesParams): UseMediaSourcesResult {
  const [sources, setSources] = useState<MediaSource[]>([])
  const [subtitles, setSubtitles] = useState<MediaSubtitle[]>([])
  const [diagnostics, setDiagnostics] = useState<MediaDiagnostic[]>([])
  const [playbackToken, setPlaybackToken] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [scanningProviderId, setScanningProviderId] = useState<string | undefined>()
  const [providerScanStartedAt, setProviderScanStartedAt] = useState<number | undefined>()
  const [scanFailedProviderIds, setScanFailedProviderIds] = useState<string[]>([])
  const [isScanningProviders, setIsScanningProviders] = useState(false)
  const [error, setError] = useState<string>()
  const [resolvedParamsKey, setResolvedParamsKey] = useState("")
  const [streamSourcesReady, setStreamSourcesReady] = useState(isStreamSourcesConfigReady())
  const paramsKey = `${id}|${type}|${season ?? ""}|${episode ?? ""}`
  const sourcesRef = useRef(sources)
  const playbackTokenRef = useRef(playbackToken)
  const playbackActiveRef = useRef(playbackActive)
  const embedFastStartRef = useRef(embedFastStart)
  const diagnosticsRef = useRef(diagnostics)
  const providerScanAttemptedRef = useRef(false)

  const altProviderWarmKeyRef = useRef<string>("")
  const providerBootstrapAttemptedRef = useRef(false)
  // False until the shared list has been applied or confirmed missing.
  // The first stream-sources config event is not an admin change, and a
  // scrape started from it used to throw the shared list away.
  const sharedLookupSettledRef = useRef(false)
  const scanFailedRef = useRef<Set<string>>(new Set())
  /** Hard-empty / completed miss — do not clear between scan passes (Auto demotion). */
  const hardFailedRef = useRef<Set<string>>(new Set())
  const fetchGenerationRef = useRef(0)
  const [backgroundPendingCapReached, setBackgroundPendingCapReached] = useState(false)

  useEffect(() => {
    if (!enabled) {
      providerScanAttemptedRef.current = false
      scanFailedRef.current = new Set()
      hardFailedRef.current = new Set()
      setScanFailedProviderIds([])
      setScanningProviderId(undefined)
      setProviderScanStartedAt(undefined)
      setIsScanningProviders(false)
    }
  }, [enabled])

  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])

  useEffect(() => {
    playbackTokenRef.current = playbackToken
  }, [playbackToken])

  useEffect(() => {
    playbackActiveRef.current = playbackActive
  }, [playbackActive])

  // Once a source is selected/playing, stop the discovery walk UI immediately.
  // Failover and manual source picks use requestProvider / refetch, not this scan.
  useEffect(() => {
    if (!playbackActive) return
    setScanningProviderId(undefined)
    setIsScanningProviders(false)
    setProviderScanStartedAt(undefined)
  }, [playbackActive])

  useEffect(() => {
    embedFastStartRef.current = embedFastStart
  }, [embedFastStart])

  useEffect(() => {
    diagnosticsRef.current = diagnostics
  }, [diagnostics])

  const buildSearchParams = useCallback(
    (options?: { retry?: boolean; fresh?: boolean; provider?: string }) => {
      const params = new URLSearchParams({
        type,
        tmdbId: String(id),
        ...(type === "tv" && season !== undefined ? { season: String(season) } : {}),
        ...(type === "tv" && episode !== undefined ? { episode: String(episode) } : {}),
      })

      if (options?.retry) params.set("retry", "1")
      if (options?.fresh) params.set("fresh", "1")
      if (options?.provider) params.set("provider", options.provider)

      return params
    },
    [episode, id, season, type]
  )


function isVaplayerCdnUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (
      /(?:^|\.)(strategicgrowthpartners|influencerstrategygroup|nicheauthorityengine|remoteconsultinggroup|boldvisionstrategy|onlinecoachingacademy|onlinecoursecreator|scalablecontentengine|modernconsultinglab)\.site$/i.test(
        host
      )
    ) {
      return true
    }
    if (/(?:^|\.)stellarconductornexus\.com$/i.test(host)) return true
    if (host.endsWith(".site") && /\/pl\//i.test(url)) return true
  } catch {
    return false
  }
  return false
}

/** Tokenized VA CDN requires Origin: nextgencloudfabric.com (browser cannot set it). */
function vaplayerUrlHasCdnToken(url: string) {
  try {
    const parsed = new URL(url)
    return (
      parsed.searchParams.has("token") || parsed.searchParams.has("cast_token")
    )
  } catch {
    return /[?&](?:token|cast_token)=/i.test(url)
  }
}

/**
 * Untokenized / kite-style VA rows play on the viewer IP.
 * Tokenized /pl/?token= masters must stay on cinepro proxy (server sets
 * nextgen Origin). Unwrapping those made every VA title black at 00:00 on
 * chillflix.* (CDN 403) — Bridget Jones 95610 etc.
 */
function unwrapVaplayerViewerSource(source: MediaSource): MediaSource {
  const providerId = normalizeProviderName(
    source.provider?.id || source.provider?.name || ""
  )
  if (isVaplayerCdnUrl(source.url)) {
    // Raw CDN already — only mark viewer-direct when untokenized.
    if (vaplayerUrlHasCdnToken(source.url)) {
      return source
    }
    return {
      ...source,
      directClientPlayback: true,
      clientPlaybackHeaders:
        source.clientPlaybackHeaders ||
        ({
          Referer: "https://nextgencloudfabric.com/e/",
          Origin: "https://nextgencloudfabric.com",
          Accept: "*/*",
        } as Record<string, string>),
    }
  }
  if (
    providerId !== "vaplayer" &&
    !source.url.includes("/api/cinepro/proxy") &&
    !source.url.includes("/v1/proxy")
  ) {
    return source
  }
  const payload = decodeCineproProxyPayloadFromHref(source.url)
  if (!payload?.url || !isVaplayerCdnUrl(payload.url)) return source
  // Keep tokenized masters proxied — never unwrap to viewer-direct.
  if (vaplayerUrlHasCdnToken(payload.url)) {
    return source
  }
  return {
    ...source,
    url: payload.url,
    directClientPlayback: true,
    clientPlaybackHeaders: {
      Referer:
        payload.headers?.Referer?.trim() || "https://nextgencloudfabric.com/e/",
      Origin:
        payload.headers?.Origin?.trim() || "https://nextgencloudfabric.com",
      Accept: payload.headers?.Accept?.trim() || "*/*",
    },
  }
}

  const applyPayload = useCallback(
    (
      data: {
        sources?: MediaSource[]
        subtitles?: MediaSubtitle[]
        diagnostics?: MediaDiagnostic[]
        playbackToken?: string
      },
      options?: {
        merge?: boolean
        preserveNativeVidlink?: boolean
        provider?: string
        replaceProviderIds?: string[]
        fromSharedCache?: boolean
      }
    ): SourcesPayload => {
      const cacheKey = buildCacheKey({ id, type, season, episode })
      let incomingSources = stripVidrockServerSourcesWhenClientTest(
        filterSourcesForEnabledProviders(
          stripNativePlaybackSources(data.sources ?? [], {
            manual: options?.preserveNativeVidlink,
            provider: options?.provider,
          }).map((source) =>
            unwrapVaplayerViewerSource({
              ...source,
              url: normalizeCinemacityCdnPlaybackUrl(source.url),
            })
          )
        )
      )
      const nextSubtitles = data.subtitles ?? []
      const nextDiagnostics = stripClientProviderServerDiagnostics(data.diagnostics ?? [])
      const nextPlaybackToken =
        data && typeof data === "object" && "playbackToken" in data
          ? String((data as { playbackToken?: string }).playbackToken ?? "")
          : ""
      const existingToken = playbackTokenRef.current
      const mergeToken = options?.merge && existingToken ? existingToken : nextPlaybackToken || undefined

      if (options?.merge && existingToken) {
        incomingSources = incomingSources.map((source) => ({
          ...source,
          url: refreshSourcePlaybackToken(source.url, existingToken),
        }))
      } else if (nextPlaybackToken) {
        setPlaybackToken(nextPlaybackToken)
      }

      let resolvedSources = incomingSources
      let keptPreviousSources = false
      setSources((previous) => {
        if (options?.merge) {
          let base = previous
          if (options.replaceProviderIds?.length) {
            const drop = new Set(
              options.replaceProviderIds.map((id) => normalizeProviderName(id))
            )
            base = previous.filter(
              (source) => !drop.has(normalizeProviderName(source.provider.id))
            )
          }
          resolvedSources = mergeSources(base, incomingSources, mergeToken)
          return resolvedSources
        }

        // Empty bulk responses (scanning / race / cold cache) used to REPLACE a
        // working movie batch → UI flashed "title isn't available" while audio
        // still played briefly. Keep the last good batch until a terminal empty
        // result or an explicit fresh/provider resolve lands.
        const incomingEmpty = incomingSources.length === 0
        const hadPlayable = previous.length > 0
        const terminalEmpty = nextDiagnostics.some((item) =>
          TERMINAL_SOURCE_DIAGNOSTIC_CODES.has(item.code ?? "")
        )
        const backgroundPending = isBackgroundSourcesPending(nextDiagnostics)
        // Never retain another episode/title's streams — that made VSEmbed play
        // S4E7 while the UI/URL already said S4E6 after Back.
        const previousBelongsToCurrentParams =
          !resolvedParamsKey || resolvedParamsKey === cacheKey
        if (
          incomingEmpty &&
          hadPlayable &&
          previousBelongsToCurrentParams &&
          !options?.provider &&
          (backgroundPending || !terminalEmpty)
        ) {
          keptPreviousSources = true
          resolvedSources = previous
          return previous
        }

        resolvedSources = incomingSources
        return resolvedSources
      })
      setSubtitles((previous) => (nextSubtitles.length > 0 ? nextSubtitles : previous))
      setDiagnostics((previous) => {
        const stripBackgroundWhenReady = (
          items: MediaDiagnostic[],
          sourceCount: number
        ) =>
          sourceCount > 0
            ? items.filter((item) => item.code !== "CINEPRO_BACKGROUND")
            : items

        if (!options?.merge) {
          if (keptPreviousSources) {
            // Keep discovery soft while we retain the previous playable batch.
            const mergedSoft = [
              ...previous.filter((item) => item.code === "CINEPRO_BACKGROUND"),
              ...nextDiagnostics,
            ]
            return stripClientProviderServerDiagnostics(
              stripBackgroundWhenReady(mergedSoft, resolvedSources.length)
            )
          }
          return stripClientProviderServerDiagnostics(
            stripBackgroundWhenReady(nextDiagnostics, resolvedSources.length)
          )
        }

        const previousTerminal = previous.some((item) =>
          TERMINAL_SOURCE_DIAGNOSTIC_CODES.has(item.code ?? "")
        )
        const filteredIncoming = previousTerminal
          ? nextDiagnostics.filter((item) => item.code !== "CINEPRO_BACKGROUND")
          : nextDiagnostics

        const seen = new Set(
          filteredIncoming.map((item) => `${item.code}:${item.message}`)
        )
        const merged = [...filteredIncoming]

        for (const item of previous) {
          const key = `${item.code}:${item.message}`
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(item)
        }

        return stripClientProviderServerDiagnostics(
          stripBackgroundWhenReady(merged, resolvedSources.length)
        )
      })

      if (resolvedSources.length > 0) {
        setError(undefined)
      } else if (
        !keptPreviousSources &&
        !isBackgroundSourcesPending(nextDiagnostics) &&
        !shouldHoldEmptyStateForDiscovery(nextDiagnostics, 0)
      ) {
        setError(resolveTitleUnavailableMessage(nextDiagnostics))
      }

      if (resolvedSources.length > 0) {
        setIsLoading(false)
        setIsRefreshing(false)
        setResolvedParamsKey(cacheKey)
        if (!options?.fromSharedCache) {
          try {
            localStorage.setItem(
              cacheKey,
              JSON.stringify({
                sources: resolvedSources,
                subtitles: nextSubtitles,
                diagnostics: nextDiagnostics,
                playbackToken:
                  options?.merge && existingToken
                    ? existingToken
                    : nextPlaybackToken || playbackTokenRef.current,
                // Keep working streams for ~1h so reopen / another tab in this
                // browser can reuse them. Empty results are never written here.
                expiresAt: Date.now() + MEDIA_SOURCES_CACHE_TTL_MS,
              })
            )
          } catch {
            // ignore
          }
          if (sourcesHavePreferredAutoStartProvider(resolvedSources)) {
            publishSharedStreamCache({
              type,
              tmdbId: String(id),
              season: type === "tv" ? String(season ?? "") : undefined,
              episode: type === "tv" ? String(episode ?? "") : undefined,
              sources: resolvedSources,
              subtitles: nextSubtitles,
            })
          }
        }
      }

      // Keep the ref in lockstep so a cache-hit + scan effect in the same tick
      // already sees playable sources (React state alone is one frame late).
      sourcesRef.current = resolvedSources

      return {
        sources: resolvedSources,
        subtitles: nextSubtitles,
        diagnostics: nextDiagnostics,
      }
    },
    [episode, id, season, type]
  )

  const applyEmergencyFallback = useCallback(
    async (reason: string, options?: { merge?: boolean }) => {
      const payload = buildEmergencyVidlinkPayload(
        { id, type, season, episode },
        reason
      )

      try {
        const mintParams = new URLSearchParams({
          type,
          tmdbId: String(id),
        })

        if (type === "tv") {
          mintParams.set("season", String(season ?? ""))
          mintParams.set("episode", String(episode ?? ""))
        }

        const mintResponse = await fetch(`/api/playback/mint?${mintParams}`)
        const mintData = await mintResponse.json()

        if (mintResponse.ok && mintData.playbackToken) {
          const token = String(mintData.playbackToken)
          setPlaybackToken(token)
          payload.sources = payload.sources.map((source) => ({
            ...source,
            url: refreshSourcePlaybackToken(source.url, token),
          }))
        }
      } catch {
        // Fall back to payload without a token if mint fails.
      }

      return applyPayload(payload, options)
    },
    [applyPayload, episode, id, season, type]
  )

  const fetchClientProvider = useCallback(
    async (
      providerId: string,
      playbackToken?: string,
      options?: { waitMs?: number }
    ) => {
      let token = playbackToken

      // Mint and the VAPlayer scrape both wait on the network. Start them
      // together, then stamp the token onto the proxy URLs.
      const tokenPromise: Promise<string | undefined> = token
        ? Promise.resolve(token)
        : (async () => {
            try {
              const mintParams = new URLSearchParams({
                type,
                tmdbId: String(id),
              })

              if (type === "tv") {
                mintParams.set("season", String(season ?? ""))
                mintParams.set("episode", String(episode ?? ""))
              }

              const mintResponse = await fetch(`/api/playback/mint?${mintParams}`)
              const mintData = await mintResponse.json()

              if (mintResponse.ok && mintData.playbackToken) {
                return String(mintData.playbackToken)
              }
            } catch {
              // continue without token; proxy may still work for some paths
            }
            return undefined
          })()

      const result = await resolveClientProviderSources(providerId, {
        type,
        tmdbId: String(id),
        // Movies must not inherit leftover season/episode from prior TV watches.
        season: type === "tv" && season !== undefined ? String(season) : undefined,
        episode: type === "tv" && episode !== undefined ? String(episode) : undefined,
        playbackToken: token,
        waitMs: options?.waitMs,
      })

      const resolvedAt = Date.now()
      result.sources = result.sources.map((source) => ({
        ...source,
        clientResolved: true,
        clientResolvedAt: resolvedAt,
      }))

      const minted = await tokenPromise
      if (minted) {
        token = minted
        setPlaybackToken(minted)
        if (!playbackToken) {
          result.sources = result.sources.map((source) => ({
            ...source,
            url: refreshSourcePlaybackToken(source.url, minted),
          }))
        }
      }

      if (!result.sources.length) {
        const softPending = /rate-limited|unlock-pending|still running|soft-gap|wait a few|session is|retry/i.test(
          String(result.failureReason || "")
        )
        // Soft-wait (VA unlock / Videasy mint gap): keep any prior streams —
        // wiping them left a black player until a manual retap (same class of
        // bug as VAPlayer auto-start empty replace).
        return applyPayload(
          {
            sources: [],
            subtitles: [],
            diagnostics: result.failureReason
              ? [
                  {
                    code: "CLIENT_PROVIDER_UNAVAILABLE",
                    message: result.failureReason,
                    severity: "warning",
                  },
                ]
              : [],
          },
          softPending
            ? { merge: true }
            : { merge: true, replaceProviderIds: [providerId] }
        )
      }

      return applyPayload(
        {
          sources: result.sources,
          subtitles: [],
          diagnostics: [],
        },
        { merge: true, replaceProviderIds: [providerId] }
      )
    },
    [applyPayload, episode, id, season, type]
  )

  const fetchSources = useCallback(
    async (options?: {
      retry?: boolean
      fresh?: boolean
      merge?: boolean
      provider?: string
      preserveNativeVidlink?: boolean
    }) => {
      const searchParams = buildSearchParams({
        retry: options?.retry,
        fresh: options?.fresh,
        provider: options?.provider,
      })
      const dedupeKey = buildSourcesFetchDedupeKey(searchParams, {
        provider: options?.provider,
        fresh: options?.fresh,
      })
      const inflight = sourcesFetchInflight.get(dedupeKey)
      if (inflight) {
        const payload = await inflight
        if (options?.merge) {
          return applyPayload(payload, {
            merge: true,
            preserveNativeVidlink: options?.preserveNativeVidlink,
          })
        }
        return payload
      }

      const task = (async (): Promise<SourcesPayload> => {
      let lastError: Error | undefined

      const fetchTimeoutMs = options?.provider
        ? getProviderFetchTimeoutMs(options.provider, PROVIDER_FETCH_TIMEOUT_MS)
        : options?.retry
          ? FETCH_TIMEOUT_MS
          : INITIAL_SOURCES_FETCH_TIMEOUT_MS
      const maxAttempts = options?.provider ? 1 : SOURCE_FETCH_ATTEMPTS

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), fetchTimeoutMs)

        try {
          const response = await fetch(`/api/cinepro/sources?${searchParams}`, {
              signal: controller.signal,
              cache: "no-store",
            })

          if (!response.ok) {
            if (response.status === 429) {
              throw new Error(
                "Too many source requests. Wait a minute, then tap Retry below."
              )
            }

            const retryable =
              RETRYABLE_HTTP_STATUSES.has(response.status) &&
              attempt < maxAttempts - 1
            if (retryable) {
              await sleep(400 * (attempt + 1))
              continue
            }

            throw new Error(`HTTP ${response.status}`)
          }

          const data = await response.json()
          const payload = applyPayload(data, {
            merge: options?.merge,
            preserveNativeVidlink: options?.preserveNativeVidlink,
            provider: options?.provider,
          })

          if (
            payload.sources.length === 0 &&
            attempt < maxAttempts - 1 &&
            !options?.provider
          ) {
            const backgroundPending = isBackgroundSourcesPending(payload.diagnostics)
            if (backgroundPending) {
              // Do not block the UI for minutes — background poll + bootstrap handle merge.
              return payload
            }

            await sleep(400 * (attempt + 1))
            continue
          }

          return payload
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Failed to load sources")
          const retryable =
            attempt < maxAttempts - 1 &&
            (lastError.name === "AbortError" ||
              lastError.message.startsWith("HTTP 5") ||
              lastError.message.includes("Failed to fetch"))

          if (retryable) {
            await sleep(400 * (attempt + 1))
            continue
          }

          throw lastError
        } finally {
          window.clearTimeout(timeout)
        }
      }

      throw lastError ?? new Error("Failed to load sources")
      })()

      sourcesFetchInflight.set(dedupeKey, task)

      try {
        return await task
      } finally {
        sourcesFetchInflight.delete(dedupeKey)
      }
    },
    [applyPayload, buildSearchParams]
  )

  const fetchSourcesRef = useRef(fetchSources)
  const fetchClientProviderRef = useRef(fetchClientProvider)

  useEffect(() => {
    fetchSourcesRef.current = fetchSources
  }, [fetchSources])

  useEffect(() => {
    fetchClientProviderRef.current = fetchClientProvider
  }, [fetchClientProvider])

  const refetchSourcesAsync = useCallback(async () => {
    try {
      localStorage.removeItem(buildCacheKey({ id, type, season, episode }))
    } catch {
      // ignore
    }

    setIsRefreshing(true)
    setError(undefined)

    try {
      // merge:true keeps Movy/VAPlayer/7Movies client-resolved rows. merge:false
      // previously wiped them on proxy 400 recovery and black-screened the embed.
      return await fetchSources({ retry: true, fresh: true, merge: true })
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Source lookup timed out"
          : err instanceof Error
            ? err.message
            : "Failed to load sources"

      return applyEmergencyFallback(message)
    } finally {
      setIsRefreshing(false)
    }
  }, [applyEmergencyFallback, episode, fetchSources, id, season, type])

  const refetchSources = useCallback(() => {
    void refetchSourcesAsync().catch(() => undefined)
  }, [refetchSourcesAsync])

  const requestProvider = useCallback(
    async (providerId: string) => {
      const providerKey = normalizeProviderName(providerId)
      const isManualVidlink = providerKey === "vidlink"

      if (!isManualVidlink) {
        try {
          localStorage.removeItem(buildCacheKey({ id, type, season, episode }))
        } catch {
          // ignore
        }
        if (sourcesIncludeProvider(sourcesRef.current, providerKey)) {
          forgetSharedStreamCache({
            type,
            tmdbId: String(id),
            season: type === "tv" ? String(season ?? "") : undefined,
            episode: type === "tv" ? String(episode ?? "") : undefined,
          })
        }
      }

      setIsRefreshing(true)
      setError(undefined)

      try {
        if (isClientResolveProvider(providerKey)) {
          console.info("[client-resolve] requestProvider", providerKey)
          return await fetchClientProvider(providerKey, playbackTokenRef.current)
        }

        return await fetchSources(
          isManualVidlink
            ? {
                provider: "vidlink",
                merge: true,
                preserveNativeVidlink: true,
              }
            : {
                provider: providerKey,
                retry: true,
                fresh: true,
                merge: true,
              }
        )
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? "Source lookup timed out"
            : err instanceof Error
              ? err.message
              : "Failed to load sources"

        return applyEmergencyFallback(message, { merge: true })
      } finally {
        setIsRefreshing(false)
      }
    },
    [applyEmergencyFallback, episode, fetchClientProvider, fetchSources, id, season, type]
  )

  useEffect(() => {
    if (!enabled || !id) {
      setIsLoading(false)
      setIsRefreshing(false)
      setIsScanningProviders(false)
      setScanningProviderId(undefined)
      return
    }

    const generation = ++fetchGenerationRef.current
    const cacheKey = buildCacheKey({ id, type, season, episode })
    const isStale = () => fetchGenerationRef.current !== generation

    providerBootstrapAttemptedRef.current = false
    scanFailedRef.current = new Set()
    hardFailedRef.current = new Set()
    setScanFailedProviderIds([])
    setScanningProviderId(undefined)
    setError(undefined)
    setBackgroundPendingCapReached(false)

    let retryTimer: number | undefined
    let loadingCapTimer: number | undefined

    // Sync warm-start: reuse working streams from this browser (~1h TTL) and
    // skip the multi-pass provider scan so reopen does not re-scrape.
    let warmCache: {
      sources: MediaSource[]
      subtitles?: MediaSubtitle[]
      diagnostics?: MediaDiagnostic[]
      playbackToken?: string
    } | null = null
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (
          parsed.expiresAt > Date.now() &&
          Array.isArray(parsed.sources) &&
          parsed.sources.length > 0 &&
          sourcesHavePlaybackTokens(parsed.sources) &&
          !isVidLinkOnlySources(parsed.sources) &&
          // FileSuN-only warm cache used to skip VAPlayer/Videasy entirely.
          sourcesHavePreferredAutoStartProvider(parsed.sources) &&
          // VAPlayer/Videasy/Movy warm hits auto-selected dead URLs until a
          // manual re-click re-scraped — never skip discovery for those.
          !warmCacheHasClientResolveSources(parsed.sources)
        ) {
          warmCache = parsed
        } else if (
          parsed.expiresAt <= Date.now() ||
          !parsed.sources?.length ||
          (Array.isArray(parsed.sources) &&
            parsed.sources.length > 0 &&
            (!sourcesHavePreferredAutoStartProvider(parsed.sources) ||
              warmCacheHasClientResolveSources(parsed.sources)))
        ) {
          localStorage.removeItem(cacheKey)
        }
      }
    } catch {
      warmCache = null
    }

    if (warmCache) {
      sharedLookupSettledRef.current = true
      providerScanAttemptedRef.current = true
      if (
        warmCache.playbackToken &&
        typeof warmCache.playbackToken === "string" &&
        warmCache.playbackToken.length > 0
      ) {
        setPlaybackToken(warmCache.playbackToken)
      }
      applyPayload(warmCache)
      setResolvedParamsKey(cacheKey)
      setIsLoading(false)
      setIsScanningProviders(false)
      setIsRefreshing(false)
      setScanningProviderId(undefined)
      return () => {
        if (retryTimer) window.clearTimeout(retryTimer)
        if (loadingCapTimer) window.clearTimeout(loadingCapTimer)
        setIsRefreshing(false)
        setIsScanningProviders(false)
        setScanningProviderId(undefined)
      }
    }

    // Cold open — wipe, then play a shared copy before any scrape.
    sharedLookupSettledRef.current = false
    providerScanAttemptedRef.current = false
    setIsScanningProviders(false)
    setSources([])
    setSubtitles([])
    setDiagnostics([])
    setPlaybackToken(undefined)
    setResolvedParamsKey("")
    setIsLoading(true)
    setIsRefreshing(false)
    let sharedLookupCancelled = false

    const refreshInBackground = async () => {
      if (isStale()) return
      setIsRefreshing(true)
      setError(undefined)

      try {
        const result = await fetchSources({ merge: true })
        if (isStale()) return

        if (shouldAutoRetry(result.diagnostics)) {
          retryTimer = window.setTimeout(() => {
            if (!isStale()) {
              void fetchSources({ retry: true, fresh: true, merge: true }).catch(() => undefined)
            }
          }, OFFLINE_RETRY_MS)
        }
      } catch {
        // keep cached playback when background refresh fails
      } finally {
        if (!isStale()) {
          setIsRefreshing(false)
        }
      }
    }

    const run = async () => {
      const config = await ensureStreamSourcesConfigReady()
      if (isStale()) return

      loadingCapTimer = window.setTimeout(() => {
        if (!isStale()) {
          setIsLoading(false)
        }
      }, INITIAL_LOADING_CAP_MS)

      try {
        // Unlock the one-by-one provider scan immediately. Waiting on the bulk
        // /sources response before scanning made every cold open feel stuck.
        // Mark scanning now so the player cannot flash the empty-state panel
        // in the gap before the scan effect starts.
        if (!isStale()) {
          setResolvedParamsKey(cacheKey)
          setIsScanningProviders(true)
          setIsRefreshing(true)
        }

        if (!isStale()) {
          const scanIds = withoutManualOnlyProviders(
            getOrderedEnabledProviderIds(config.order, config.enabledIds)
          )
          const primaryId = scanIds[0]
          if (
            primaryId &&
            primaryId !== "vidlink" &&
            !isClientResolveProvider(primaryId)
          ) {
            // Same options as the provider scan so dedupe shares one in-flight
            // primary resolve (retry=1 here used to force a duplicate request).
            void fetchSources({
              provider: primaryId,
              merge: true,
            }).catch(() => undefined)
          }
        }

        // Do NOT fire an unscoped /sources bulk fetch here. That scraped every
        // provider (including MeowTV near the bottom) in parallel while Auto was
        // still testing #1/#2. The sequential provider scan walks admin order
        // one-by-one via tryProvider / fetchSources({ provider }).
        if (!isStale()) {
          // Cap the initial spinner; the sequential scan owns refreshing.
          window.setTimeout(() => {
            if (loadingCapTimer) window.clearTimeout(loadingCapTimer)
            if (!isStale()) {
              setIsLoading(false)
            }
          }, 0)
          // Keep a late emergency only if the sequential walk produced nothing.
          window.setTimeout(() => {
            if (isStale()) return
            if (sourcesRef.current.length > 0) return
            if (playbackActiveRef.current) return
            void applyEmergencyFallback("No sources from sequential scan")
              .then((fallback) => {
                if (isStale()) return
                if (fallback.sources.length === 0) {
                  setError("Failed to load sources")
                }
              })
              .catch(() => undefined)
          }, Math.max(BACKGROUND_MERGE_KICK_MS, 12_000))
        }
      } catch (err) {
        if (isStale()) return
        const message =
          err instanceof Error ? err.message : "Failed to load sources"
        setError(message)
        if (!isStale()) {
          setResolvedParamsKey(cacheKey)
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    void (async () => {
      const shared = await readSharedStreamCache({
        type,
        tmdbId: String(id),
        season: type === "tv" ? String(season ?? "") : undefined,
        episode: type === "tv" ? String(episode ?? "") : undefined,
      })
      if (sharedLookupCancelled || isStale()) return
      if (
        shared &&
        shared.sources.length > 0 &&
        sourcesHavePlaybackTokens(shared.sources as MediaSource[]) &&
        sourcesHavePreferredAutoStartProvider(shared.sources as MediaSource[])
      ) {
        sharedLookupSettledRef.current = true
        providerScanAttemptedRef.current = true
        if (shared.playbackToken) setPlaybackToken(shared.playbackToken)
        applyPayload(
          {
            sources: shared.sources as MediaSource[],
            subtitles: shared.subtitles as MediaSubtitle[],
            diagnostics: [],
            playbackToken: shared.playbackToken,
          },
          { fromSharedCache: true }
        )
        setResolvedParamsKey(cacheKey)
        setIsLoading(false)
        setIsScanningProviders(false)
        setIsRefreshing(false)
        setScanningProviderId(undefined)
        return
      }
      if (sharedLookupCancelled || isStale()) return
      sharedLookupSettledRef.current = true
      void run()
    })()

    return () => {
      sharedLookupCancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (loadingCapTimer) window.clearTimeout(loadingCapTimer)
      setIsRefreshing(false)
      setIsScanningProviders(false)
      setScanningProviderId(undefined)
    }
  }, [applyEmergencyFallback, applyPayload, enabled, episode, fetchSources, id, paramsKey, season, type])

  useEffect(() => {
    setBackgroundPendingCapReached(false)
  }, [paramsKey])

  const backgroundPendingActive =
    enabled &&
    sources.length === 0 &&
    shouldHoldEmptyStateForDiscovery(diagnostics, sources.length)

  useEffect(() => {
    if (!backgroundPendingActive || backgroundPendingCapReached) {
      return
    }

    const timer = window.setTimeout(() => {
      setBackgroundPendingCapReached(true)
    }, BACKGROUND_PENDING_CAP_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [backgroundPendingActive, backgroundPendingCapReached, paramsKey])

  useEffect(() => {
    let cancelled = false

    const syncReady = () => {
      if (!cancelled) {
        setStreamSourcesReady(isStreamSourcesConfigReady())
      }
    }

    syncReady()
    void ensureStreamSourcesConfigReady().finally(syncReady)
    window.addEventListener(STREAM_SOURCES_CONFIG_EVENT, syncReady)

    return () => {
      cancelled = true
      window.removeEventListener(STREAM_SOURCES_CONFIG_EVENT, syncReady)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (!sharedLookupSettledRef.current) return
    if (!isStreamSourcesConfigReady()) return
    if (providerScanAttemptedRef.current) return

    const cacheKey = buildCacheKey({ id, type, season, episode })
    if (!resolvedParamsKey || resolvedParamsKey !== cacheKey) return

    const enabledIds = getEnabledProviderIds()
    if (enabledIds.length === 0) return

    let cancelled = false
    let scanFinished = false

    const runProviderScan = async () => {
      // Find the first playable source, then stop. Do not keep walking every
      // enabled provider in the background while something is already playing —
      // that burns Worker/CinePro quota. User can switch sources manually;
      // stream errors re-resolve via requestProvider / refetch.
      // Warm cache / prior resolve already left preferred URLs — do not force a
      // multi-pass rescan. FileSuN/Huhu-only bulk must NOT skip VAPlayer/Videasy.
      if (
        sourcesRef.current.length > 0 &&
        !isVidLinkOnlySources(sourcesRef.current) &&
        sourcesHavePreferredAutoStartProvider(sourcesRef.current)
      ) {
        providerScanAttemptedRef.current = true
        setIsScanningProviders(false)
        setIsRefreshing(false)
        setScanningProviderId(undefined)
        return
      }

      // Clear stale ready/failed flags from the previous title so this scan
      // actually runs (a leftover hasReadySourceRef would no-op the walk).
      if (hasReadySourceRef) hasReadySourceRef.current = false
      if (healthFailedProviderIdsRef) {
        healthFailedProviderIdsRef.current = []
      }
      const config = await ensureStreamSourcesConfigReady()
      if (cancelled) return

      const scanIds = withoutManualOnlyProviders(
        getOrderedEnabledProviderIds(config.order, config.enabledIds)
      )

      if (scanIds.length === 0) return

      // Sources may have landed while we awaited config (cache / race).
      if (
        sourcesRef.current.length > 0 &&
        !isVidLinkOnlySources(sourcesRef.current) &&
        sourcesHavePreferredAutoStartProvider(sourcesRef.current)
      ) {
        providerScanAttemptedRef.current = true
        setIsScanningProviders(false)
        setIsRefreshing(false)
        setScanningProviderId(undefined)
        return
      }

      providerScanAttemptedRef.current = true
      setIsScanningProviders(true)
      setIsRefreshing(true)
      setProviderScanStartedAt(Date.now())

      if (scanFailedRef.current.size > 0) {
        setScanFailedProviderIds([...scanFailedRef.current])
      }

      const markProviderFailed = (
        providerId: string,
        options?: { hard?: boolean }
      ) => {
        scanFailedRef.current.add(providerId)
        if (options?.hard) {
          hardFailedRef.current.add(providerId)
        }
        setScanFailedProviderIds([...scanFailedRef.current])
      }

      const clearProviderFailed = (providerId: string) => {
        hardFailedRef.current.delete(providerId)
        if (!scanFailedRef.current.delete(providerId)) return
        setScanFailedProviderIds([...scanFailedRef.current])
      }

      const isSoftPendingPayload = (payload: {
        diagnostics?: Array<{ code?: string; message?: string }>
      }) =>
        (payload.diagnostics ?? []).some(
          (item) =>
            item.code === "CLIENT_PROVIDER_UNAVAILABLE" &&
            /rate-limited|unlock-pending|still running|soft-gap|wait a few|session is|retry/i.test(
              String(item.message || "")
            )
        )

      const hasPlayableAutomaticSource = () =>
        sourcesRef.current.length > 0 &&
        !isVidLinkOnlySources(sourcesRef.current)

      // Stop when playback is active, a preferred provider probed ready, or the
      // top server (VAPlayer) already returned streams. Those URLs are the
      // source — do not keep resolving every provider under it. FileSuN/Huhu
      // alone still must not cancel the wait for VAPlayer.
      const topProviderReturnedStreams = () => {
        const primary = scanIds.find(
          (providerId) => !shouldHoldForHigherRankedProviders(providerId)
        )
        if (!primary) return false
        return sourcesIncludeStartedProvider(sourcesRef.current, primary)
      }

      const shouldStopDiscovering = () =>
        cancelled ||
        playbackActiveRef.current ||
        topProviderReturnedStreams() ||
        (Boolean(hasReadySourceRef?.current) &&
          sourcesHavePreferredAutoStartProvider(sourcesRef.current))

      const providerProbeFailed = (providerId: string) => {
        const failed = healthFailedProviderIdsRef?.current
        if (!failed || failed.length === 0) return false
        const key = normalizeProviderName(providerId)
        return failed.some((id) => normalizeProviderName(id) === key)
      }

      // Cap how long we wait for probe/auto-start after a provider returns URLs.
      // Keep settle short so Auto can start the next row / playback quickly.
      const PROVIDER_SETTLE_MS = Math.min(
        Math.max(getHeadStartMs(), 400),
        2_000
      )

      const tryProvider = async (
        providerId: string,
        options: {
          useFetchTimeout: boolean
          markFailedOnMiss: boolean
          /** Match manual provider pick — bypass cache and re-scrape CinePro. */
          forceFresh?: boolean
          /** Cap wait during auto failover (not manual picks). */
          scanTimeoutMs?: number
        }
      ): Promise<boolean> => {
        if (cancelled) {
          return false
        }

        // Playback started — stop spending resolves.
        if (playbackActiveRef.current) {
          if (sourcesIncludeProvider(sourcesRef.current, providerId)) {
            clearProviderFailed(providerId)
            return true
          }
          return false
        }

        // Preferred provider already ready — skip remaining. Hold-scrape
        // (FileSuN) ready alone must not cancel VAPlayer/Videasy client-resolve.
        if (
          hasReadySourceRef?.current &&
          sourcesHavePreferredAutoStartProvider(sourcesRef.current)
        ) {
          if (sourcesIncludeProvider(sourcesRef.current, providerId)) {
            clearProviderFailed(providerId)
            return true
          }
          return false
        }

        if (
          !options.forceFresh &&
          sourcesIncludeStartedProvider(sourcesRef.current, providerId)
        ) {
          clearProviderFailed(providerId)
          return true
        }

        if (
          !options.forceFresh &&
          scanFailedRef.current.has(providerId) &&
          options.markFailedOnMiss
        ) {
          return false
        }

        setScanningProviderId(providerId)

        const runWithOptionalTimeout = async <T,>(
          work: () => Promise<T>
        ): Promise<T> => {
          if (!options.useFetchTimeout) {
            return work()
          }
          const adminTimeout = getProviderFetchTimeoutMs(
            providerId,
            PROVIDER_FETCH_TIMEOUT_MS
          )
          const timeoutMs = Math.min(
            adminTimeout,
            options.scanTimeoutMs ?? adminTimeout
          )
          return Promise.race([
            work(),
            sleep(timeoutMs).then(() => {
              throw new Error("Provider scan timed out")
            }),
          ])
        }

        try {
          if (isClientResolveProvider(providerId)) {
            const payload = await runWithOptionalTimeout(() =>
              fetchClientProviderRef.current(
                providerId,
                playbackTokenRef.current,
                {
                  // Match the Auto row budget so unlock-pending doesn't poll
                  // for 60s while the spinner sits on VAPlayer.
                  waitMs: options.scanTimeoutMs ?? AUTO_PROVIDER_SCAN_TIMEOUT_MS,
                }
              )
            )
            const found =
              sourcesIncludeStartedProvider(payload.sources, providerId) ||
              sourcesIncludeStartedProvider(sourcesRef.current, providerId)
            if (found) {
              clearProviderFailed(providerId)
              setDiagnostics((previous) =>
                previous.filter((item) => item.code !== "CINEPRO_BACKGROUND")
              )
            } else if (isSoftPendingPayload(payload)) {
              // Unlock/mint still running after this attempt's budget — soft-fail
              // so Auto walks to the next Sources row (spinner moves on). Soft
              // marks clear between passes for another try; hard empties stick.
              markProviderFailed(providerId)
            } else {
              // Hard empty (no streams for this title): demote Auto to #2 now.
              markProviderFailed(providerId, { hard: true })
            }
            return found
          }

          const fetchOptions = options.forceFresh
            ? ({
                provider: providerId,
                merge: true,
                retry: true,
                fresh: true,
              } as const)
            : ({
                provider: providerId,
                merge: true,
              } as const)

          await runWithOptionalTimeout(() =>
            fetchSourcesRef.current(fetchOptions)
          )

          const found = sourcesIncludeProvider(sourcesRef.current, providerId)
          if (found) {
            clearProviderFailed(providerId)
            setDiagnostics((previous) =>
              previous.filter((item) => item.code !== "CINEPRO_BACKGROUND")
            )
          } else {
            // Empty completed scrape (not a timeout): mark failed immediately so
            // pickPreferred can promote #2 instead of waiting out sourcesLoadingMore
            // for a dead #1 (e.g. VAPlayer without CAPSOLVER).
            markProviderFailed(providerId, { hard: true })
          }
          return found
        } catch (err) {
          const message = err instanceof Error ? err.message : ""
          if (message.includes("Too many source requests")) {
            setError(message)
            throw err
          }
          // Soft-fail timeouts so sequential Auto can mark X and test the next
          // Sources row instead of freezing the spinner on a hung unlock.
          if (options.markFailedOnMiss || isClientResolveProvider(providerId)) {
            markProviderFailed(providerId)
          }
          return false
        }
      }

      // Multi-pass discovery (3 circles through admin order):
      // - Each pass walks enabled Sources one-by-one (testing spinner + failed X).
      // - Soft-fail timeouts/unlock-pending; hard-fail true empties.
      // - Pass 2–3 force-fresh soft fails. Stop when #1 client-resolve is ready
      //   or playback is active.
      const waitForProbeSettle = async (providerId?: string) => {
        const settleDeadline = Date.now() + PROVIDER_SETTLE_MS
        while (Date.now() < settleDeadline) {
          if (shouldStopDiscovering()) return
          if (providerId && providerProbeFailed(providerId)) return
          if (
            hasPlayableAutomaticSource() &&
            hasReadySourceRef?.current
          ) {
            return
          }
          await sleep(100)
        }
      }

      try {
        if (shouldStopDiscovering()) {
          setScanningProviderId(undefined)
          return
        }

        for (let pass = 0; pass < SCAN_PASS_COUNT; pass += 1) {
          if (shouldStopDiscovering()) break

          const timeoutMs =
            SCAN_PASS_TIMEOUTS_MS[
              Math.min(pass, SCAN_PASS_TIMEOUTS_MS.length - 1)
            ] ?? 20_000
          const passBudgetStartedAt = Date.now()
          const forceFresh = pass > 0

          const pending = scanIds.filter(
            (providerId) =>
              !sourcesIncludeStartedProvider(sourcesRef.current, providerId)
          )

          // Everything already has URLs — wait for a probe-ready pick.
          // If nothing probes healthy, force-fresh the unhealthy set next circle
          // instead of treating "has URL" as "has source".
          if (pending.length === 0) {
            await waitForProbeSettle(scanIds[0])
            if (shouldStopDiscovering()) break
            if (pass < SCAN_PASS_COUNT - 1) {
              for (const providerId of scanIds) {
                if (hardFailedRef.current.has(providerId)) continue
                scanFailedRef.current.delete(providerId)
              }
              setScanFailedProviderIds([...scanFailedRef.current])
              // Circle again: prefer probe-failed providers, else re-scrape the
              // top of admin order so we do not give up on a title that only
              // returned dead/stale links on the first hit.
              const probeFailed = scanIds.filter((providerId) =>
                providerProbeFailed(providerId)
              )
              const retryIds =
                probeFailed.length > 0 ? probeFailed : scanIds.slice(0, 4)
              for (const providerId of retryIds) {
                if (shouldStopDiscovering()) break
                setScanningProviderId(providerId)
                await tryProvider(providerId, {
                  useFetchTimeout: true,
                  markFailedOnMiss: false,
                  forceFresh: true,
                  scanTimeoutMs: timeoutMs,
                })
                if (sourcesIncludeProvider(sourcesRef.current, providerId)) {
                  await waitForProbeSettle(providerId)
                }
                if (shouldStopDiscovering()) break
              }
            }
            continue
          }

          // Walk admin Sources order one-by-one so Auto shows which row is
          // testing (spinner) and which failed (X), then demotes to the next.
          const primaryId = pending[0] ?? scanIds[0]!
          for (let index = 0; index < pending.length; index += 1) {
            if (shouldStopDiscovering()) break

            const providerId = pending[index]!
            const isPrimary = normalizeProviderName(providerId) ===
              normalizeProviderName(scanIds[0] ?? "")
            const providerTimeoutMs = isPrimary
              ? Math.min(
                  timeoutMs + SCAN_PRIMARY_TIMEOUT_BONUS_MS,
                  SCAN_PASS_TIMEOUTS_MS[SCAN_PASS_TIMEOUTS_MS.length - 1]
                )
              : timeoutMs

            setScanningProviderId(providerId)
            const found = await tryProvider(providerId, {
              useFetchTimeout: true,
              markFailedOnMiss: pass === SCAN_PASS_COUNT - 1,
              forceFresh,
              scanTimeoutMs: providerTimeoutMs,
            })

            if (found || sourcesIncludeStartedProvider(sourcesRef.current, providerId)) {
              clearProviderFailed(providerId)
              await waitForProbeSettle(providerId)
            }

            if (shouldStopDiscovering()) break
          }

          if (shouldStopDiscovering()) break

          if (hasPlayableAutomaticSource()) {
            await waitForProbeSettle()
            if (shouldStopDiscovering()) break
          }

          // Soft retries: clear timeout/soft fails so the next circle can
          // force-fresh. Keep hard-empty fails sticky so Auto can demote past
          // a provider that truly has no source (VAPlayer empty → RiveStream).
          if (pass < SCAN_PASS_COUNT - 1 && !shouldStopDiscovering()) {
            for (const providerId of scanIds) {
              if (hardFailedRef.current.has(providerId)) continue
              if (!sourcesIncludeStartedProvider(sourcesRef.current, providerId)) {
                scanFailedRef.current.delete(providerId)
              }
            }
            setScanFailedProviderIds([...scanFailedRef.current])
            await sleep(400)
          }
        }

        if (shouldStopDiscovering()) {
          setScanningProviderId(undefined)
        }
      } catch {
        if (cancelled) return
      }

      if (!cancelled) {
        setScanningProviderId(undefined)
        setIsRefreshing(false)
        // Only declare "no source" after the full race finishes with nothing.
        // Emitting this while a provider is still testing made the empty-state
        // UI appear too early on cold opens (e.g. Interstellar + VAPlayer).
        if (!hasPlayableAutomaticSource()) {
          setDiagnostics((previous) => {
            const withoutBackground = previous.filter(
              (item) => item.code !== "CINEPRO_BACKGROUND"
            )

            const hasAutomaticSource = getEnabledProviderIds()
              .filter((providerId) => providerId !== "vidlink")
              .some((providerId) =>
                sourcesIncludeProvider(sourcesRef.current, providerId)
              )

            if (hasAutomaticSource) {
              return withoutBackground
            }

            return [
              ...withoutBackground,
              {
                code: "ENABLED_PROVIDER_UNAVAILABLE",
                message:
                  "No enabled provider returned a stream for this title.",
                severity: "warning",
              },
            ]
          })
        }
      }
    }

    void runProviderScan()
      .catch(() => undefined)
      .finally(() => {
        scanFinished = true
        if (!cancelled) {
          setIsScanningProviders(false)
          setIsRefreshing(false)
          setScanningProviderId(undefined)
          setProviderScanStartedAt(undefined)
        }
      })

    return () => {
      cancelled = true
      if (!scanFinished) {
        providerScanAttemptedRef.current = false
      }
      setScanningProviderId(undefined)
      setProviderScanStartedAt(undefined)
      setIsScanningProviders(false)
      setIsRefreshing(false)
    }
  }, [enabled, episode, id, resolvedParamsKey, season, type])

  const bootstrapEmptySources = useCallback(async () => {
    if (sourcesRef.current.length > 0) return
    if (providerScanAttemptedRef.current) return

    try {
      const merged = await fetchSources({ merge: true, retry: true })
      if (merged.sources.length > 0 || sourcesRef.current.length > 0) return

      const enabledIds = getEnabledProviderIds().filter(
        (providerId) => providerId !== "vidlink"
      )

      for (const providerId of enabledIds) {
        if (sourcesRef.current.length > 0) return
        await fetchSources({
          provider: providerId,
          merge: true,
          retry: true,
        })
      }
    } catch {
      // bootstrap is best-effort; manual provider pick still works
    }
  }, [fetchSources])

  useEffect(() => {
    if (!enabled || !id) return

    const cacheKey = buildCacheKey({ id, type, season, episode })
    if (resolvedParamsKey !== cacheKey) return
    if (sources.length > 0) return
    if (providerBootstrapAttemptedRef.current) return
    if (!isStreamSourcesConfigReady()) return

    providerBootstrapAttemptedRef.current = true
    let cancelled = false

    const bootstrap = async () => {
      await sleep(PROVIDER_BOOTSTRAP_DELAY_MS)
      if (cancelled) return
      await bootstrapEmptySources()
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [
    bootstrapEmptySources,
    enabled,
    episode,
    id,
    resolvedParamsKey,
    season,
    sources.length,
    type,
  ])

  useEffect(() => {
    if (!enabled || !id) return
    if (sources.length > 0) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled || sourcesRef.current.length > 0) return
      if (providerBootstrapAttemptedRef.current) return
      if (providerScanAttemptedRef.current) return
      providerBootstrapAttemptedRef.current = true
      void bootstrapEmptySources()
    }, INITIAL_LOADING_CAP_MS - 2_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bootstrapEmptySources, enabled, episode, id, paramsKey, season, sources.length, type])

  useEffect(() => {
    if (
      !enabled ||
      playbackActive ||
      // Sequential Auto walk owns scrapes — unscoped polls would hit MeowTV
      // (and every other scraper) while we are still testing #1/#2.
      Boolean(scanningProviderId) ||
      isScanningProviders ||
      !isBackgroundSourcesPending(diagnostics)
    ) {
      return
    }

    let cancelled = false
    let timer: number | undefined
    let firstPollTimer: number | undefined

    let pollAttempt = 0
    const poll = () => {
      if (document.visibilityState === "hidden") return
      pollAttempt += 1
      // Reuse the shared cinepro cache. Never force-fresh on a timer — that
      // wiped working provider caches and burned VPS CPU for every open tab.
      void fetchSources({
        merge: true,
        fresh: false,
      }).catch((err) => {
        if (cancelled) return

        const message =
          err instanceof Error ? err.message : "Failed to load sources"
        if (message.includes("Too many source requests")) {
          cancelled = true
          if (timer) window.clearInterval(timer)
          setError(message)
        }
      })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        poll()
      }
    }

    firstPollTimer = window.setTimeout(poll, BACKGROUND_POLL_FIRST_MS)
    timer = window.setInterval(poll, BACKGROUND_POLL_MS)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      if (firstPollTimer) window.clearTimeout(firstPollTimer)
      if (timer) window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [
    diagnostics,
    enabled,
    fetchSources,
    isScanningProviders,
    playbackActive,
    scanningProviderId,
  ])

  useEffect(() => {
    if (!enabled || !playbackToken || TOKEN_REFRESH_INTERVAL_MS <= 0) {
      return
    }

    const refreshPlaybackToken = async () => {
      try {
        const mintParams = new URLSearchParams({
          type,
          tmdbId: String(id),
        })

        if (type === "tv") {
          mintParams.set("season", String(season ?? ""))
          mintParams.set("episode", String(episode ?? ""))
        }

        const response = await fetch(`/api/playback/mint?${mintParams}`, {
          cache: "no-store",
        })
        const data = await response.json()

        if (!response.ok || !data.playbackToken) {
          return
        }

        const nextToken = String(data.playbackToken)
        setPlaybackToken(nextToken)
        setSources((previous) =>
          previous.map((source) => ({
            ...source,
            url: refreshSourcePlaybackToken(source.url, nextToken),
          }))
        )
      } catch {
        // ignore refresh failures; existing token may still be valid
      }
    }

    const timer = window.setInterval(refreshPlaybackToken, TOKEN_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [enabled, episode, id, playbackToken, season, type])

  useEffect(() => {
    if (!enabled || !id) return

    const refreshForConfigChange = () => {
      setSources((previous) => filterSourcesForEnabledProviders(previous))
      // First arrival of the admin list fires this same event. Scraping then
      // raced the shared cache and replaced a saved title with a full resolve.
      if (!sharedLookupSettledRef.current) return
      if (
        sourcesRef.current.length > 0 &&
        sourcesHavePreferredAutoStartProvider(sourcesRef.current)
      ) {
        return
      }
      try {
        localStorage.removeItem(buildCacheKey({ id, type, season, episode }))
      } catch {
        // ignore
      }
      providerScanAttemptedRef.current = false
      void fetchSources({ fresh: true, merge: false }).catch(() => undefined)
    }

    window.addEventListener(STREAM_SOURCES_CONFIG_EVENT, refreshForConfigChange)
    return () => window.removeEventListener(STREAM_SOURCES_CONFIG_EVENT, refreshForConfigChange)
  }, [enabled, episode, fetchSources, id, season, type])

  // Quietly warm Athena / 7Movies as soon as sources settle so a tap is cache-hot.
  useEffect(() => {
    if (!enabled || !id) return
    if (!sharedLookupSettledRef.current) return
    // Start once we have any primary source or playback has begun.
    if (!playbackActive && sources.length === 0) return

    const warmKey = buildCacheKey({ id, type, season, episode })
    if (altProviderWarmKeyRef.current === warmKey) return
    altProviderWarmKeyRef.current = warmKey

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let enabledIds: string[] = []
        try {
          enabledIds = getEnabledProviderIds()
        } catch {
          return
        }
        const enabledKeys = new Set(enabledIds.map((id) => normalizeProviderName(id)))
        const alts = ["athena", "7movies"].filter((providerId) => {
          const key = normalizeProviderName(providerId)
          if (!enabledKeys.has(key)) return false
          if (!isClientResolveProvider(providerId)) return false
          return !sourcesIncludeStartedProvider(sourcesRef.current, providerId)
        })

        // Athena first (slowest cold path), warm in parallel after kickoff.
        await Promise.all(
          alts.map(async (providerId) => {
            if (cancelled) return
            try {
              await fetchClientProviderRef.current(
                providerId,
                playbackTokenRef.current
              )
            } catch {
              // best-effort warm; manual tap still re-resolves if needed
            }
          })
        )
      })()
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, playbackActive, sources.length, id, type, season, episode])


  return {
    sources,
    subtitles,
    diagnostics,
    playbackToken,
    isLoading: !enabled ? false : isLoading,
    isLoadingMore:
      // Keep "loading more" true for the whole multi-pass scan so the empty
      // state does not flash while Flixhqz is still cold-scraping — and while
      // a soft CinePro timeout races a late source that is about to land.
      isScanningProviders ||
      Boolean(scanningProviderId) ||
      (isRefreshing && sources.length === 0) ||
      (sources.length === 0 &&
        shouldHoldEmptyStateForDiscovery(diagnostics, sources.length) &&
        !backgroundPendingCapReached),
    error,
    refetchSources,
    refetchSourcesAsync,
    requestProvider,
    scanningProviderId,
    scanFailedProviderIds,
    isScanningProviders,
    providerScanStartedAt,
    resolvedParamsKey,
  }
}
