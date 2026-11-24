"use client"

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import Hls from "hls.js"

import { getClientUser } from "@/lib/auth-client"
import {
  buildCineproProxyHref,
  decodeCineproProxyPayloadFromHref,
  resolveProxiedMediaRequestUrl,
} from "@/lib/cinepro/proxy"
import { fetchVaCdnViaNullBridge } from "@/lib/providers/vaplayer-null-bridge"
import { isLikelyHlsSegmentUrl } from "@/lib/hls-manifest-utils"
import { getEmbedAuthParentOrigins } from "@/lib/embed-auth-handoff"
import { postEmbedMessage } from "@/lib/embed-player"
import {
  EMBED_MESSAGE_FULLSCREEN_STATE,
  EMBED_MESSAGE_TOGGLE_FULLSCREEN,
  EMBED_MESSAGE_WAKE_CHROME,
  type EmbedFullscreenStatePayload,
} from "@/lib/embed-ui-sync"
import { isIosSafariLike,
  addDocumentFullscreenChangeListener,
  addIosVideoFullscreenListeners,
  exitPlayerFullscreen,
  isElementFullscreen,
  isFullscreenActive,
  enterConsoleVideoFullscreen,
  isPlayStationBrowser,
  requestPlayerFullscreen,
} from "@/lib/fullscreen"
import { useTranslations } from "@/lib/i18n/client"
import {
  isProxyRefetchHttpStatus,
  isTransientProxyHttpStatus,
} from "@/lib/playback-error-recovery"
import {
  attemptAutoplayUnmute,
  CHILLFLIX_AUTO_UNMUTE_DELAYS_MS,
  notePlaybackUserGesture,
  primeAutoplaySoundUnlock,
  scheduleAutoplayUnmuteAttempts,
  unlockVideoElementForAutoplay,
} from "@/lib/playback-gesture"
import { resolveClientPlaybackProxyOrigin } from "@/lib/playback-proxy-origin"
import {
  extractPlaybackToken,
  requiresPlaybackTokenUrl,
} from "@/lib/playback-token"
import {
  tryLockLandscapeOrientation,
  unlockScreenOrientation,
} from "@/lib/player-orientation"
import {
  findSubtitleForLanguage,
  getSubtitlePreferences,
} from "@/lib/player-subtitle-prefs"
import { readSafeAreaInsets, type SafeAreaInsets } from "@/lib/safe-area-insets"
import {
  SOURCE_METADATA_TIMEOUT_MS,
  STARTUP_PLAYBACK_FAIL_MS,
} from "@/lib/source-probe-constants"
import { normalizeProviderName } from "@/lib/stream-sources-defaults"
import {
  getFirstPlayTimeoutMs,
  getMetadataTimeoutMs,
  getProviderFirstPlayTimeoutMs,
  getProviderMetadataTimeoutMs,
} from "@/hooks/useStreamSourcesConfig"
import {
  isTransientPlaybackStatusMessage,
  shouldShowPlaybackRetryButton,
} from "@/lib/playback-user-messages"
import type { TvEpisodeRef } from "@/lib/tv-auto-next"
import type { WatchProgressMeta } from "@/lib/watch-progress"
import { useAuth } from "@/hooks/use-auth"
import { useEmbedPlayerBridge } from "@/hooks/use-embed-player-bridge"
import { useIntroSkip } from "@/hooks/use-intro-skip"
import { usePlayerAnalytics } from "@/hooks/use-player-analytics"
import { useWatchPartyGuestVideoSync } from "@/hooks/use-watch-party-guest-video-sync"
import { useWatchProgressSaver } from "@/hooks/use-watch-progress-saver"
import { useClientSearchParams } from "@/hooks/useClientSearchParams"
import { canAutoFallbackPlayback } from "@/hooks/usePlaybackSourceFallback"
import type { SourceHealthStatus } from "@/hooks/useSourceHealth"

import { CustomSubtitles } from "./CustomSubtitles"
import {
  readSubtitleStylePrefs,
  writeSubtitleStylePrefs,
  type SubtitleStylePrefs,
} from "@/lib/subtitle-style-prefs"
import { PlayerControls } from "./PlayerControls"
import type { TvEpisodeNavigationProps } from "./PlayerEpisodes"
import { PlaybackSourceRetryPanel } from "./PlaybackSourceRetryPanel"
import { SourceStatusOverlay } from "./SourceStatusOverlay"
import {
  fourKHlsStartupTimeoutMs,
  isFourKHlsPlaybackUrl,
  isFourKHlsTranscodeUrl,
  normalizeCinemacityCdnPlaybackUrl,
  playbackUrlWithoutToken,
  qualityHeight,
} from "./utils/playback"

function isAthenaViewerOnlyHost(url: string) {
  // Raw Atlantic CDN hosts: browser Origin chillflix.* gets CORS 403 (ACAO
  // atlantic.st only). Playlists must come from /api/cinepro/proxy (plain VPS,
  // never WARP — Warp egress triggers the interstitial video). Keep this
  // guard so directClientPlayback xhr does not rewrite those hosts into a
  // second tunnel path.
  return /zstream-proxy\.bluevelvet\.space|transcode\.cfd|totallyacdn\.|cdn\.hls\.lol|stream\.hls\.lol/i.test(
    url
  )
}

function isVideasyKiteViewerHost(url: string) {
  // Goldenkite CF blocks DC/WARP. Playlists+segments must stay on the VIEWER
  // browser IP (CORS ACAO:*). Tunneling .ts via cinepro/VPS → 403.
  return /(?:^|\.)(goldenkite|silverkite|bronzekite)\.top$/i.test(
    (() => {
      try {
        return new URL(url).hostname
      } catch {
        return ""
      }
    })()
  )
}

function isVaplayerViewerCdnHost(url: string) {
  // VA CDN fronts 401 from VPS/Worker (DC IP / CF 1010). Tokenized /pl/ masters
  // and segments play on the VIEWER browser IP — same path as colleague sites.
  // Never tunnel these through cinepro; browser cannot use our blocked egress.
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has("token") || parsed.searchParams.has("cast_token")) {
      return false
    }
    const host = parsed.hostname.toLowerCase()
    if (
      /(?:^|\.)(strategicgrowthpartners|influencerstrategygroup|nicheauthorityengine|remoteconsultinggroup|boldvisionstrategy|onlinecoachingacademy|onlinecoursecreator|scalablecontentengine)\.site$/i.test(
        host
      )
    ) {
      return true
    }
    if (/(?:^|\.)stellarconductornexus\.com$/i.test(host)) return true
    // Future VA fronts: tokenized playlist hosts under *.site
    if (host.endsWith(".site") && /\/pl\//i.test(url)) return true
  } catch {
    return false
  }
  return false
}

function isBrowserIpDirectHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host.includes("1x2.space") ||
      host.includes("premilkyway.com") ||
      host.includes("vidrift.net")
    )
  } catch {
    return false
  }
}

function shouldTunnelDirectClientSegment(url: string) {
  if (isAthenaViewerOnlyHost(url)) return false
  if (isVideasyKiteViewerHost(url)) return false
  if (isVaplayerViewerCdnHost(url)) return false
  if (isBrowserIpDirectHost(url)) return false
  if (isLikelyHlsSegmentUrl(url)) return true
  const lower = url.toLowerCase()
  const path = lower.split("?")[0]?.split("#")[0] ?? lower
  if (path.includes(".m3u8") || path.endsWith(".m3u")) return false
  // VAPlayer CDN: media under /content/ (page-N.html or extensionless chunks)
  if (
    lower.includes("strategicgrowthpartners.site/") &&
    lower.includes("/content/")
  ) {
    return true
  }
  return false
}

const EMPTY_AUDIO_TRACKS: Array<{ id: string; label: string }> = []
/** Ignore bogus HLS fragment durations; real episodes are always longer. */
const MIN_TRUSTED_DURATION_SEC = 45
const MIN_PLAYBACK_BEFORE_END_CHECK_SEC = 15

function parseChillflixSourceDurationTag(manifest: string) {
  const match = manifest.match(/#EXT-X-CHILLFLIX-SOURCE-DURATION:([0-9.]+)/)
  if (!match) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

function parseTmdbIdFromFourKUrl(url: string) {
  try {
    const parsed = new URL(url, "https://chillflix.invalid")
    if (!parsed.pathname.includes("/api/4k/hls/")) return undefined
    const tmdbId = Number(parsed.searchParams.get("tmdbId"))
    return Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : undefined
  } catch {
    return undefined
  }
}

function resolvePlayerDuration(args: {
  expectedSec: number
  streamSec: number
  videoSec: number
  currentTime: number
  progressiveHls: boolean
}) {
  const trusted = [args.streamSec, args.videoSec].filter(
    (value) => Number.isFinite(value) && value >= MIN_TRUSTED_DURATION_SEC
  )
  const trustedMax = trusted.length > 0 ? Math.max(...trusted) : 0

  if (args.expectedSec >= MIN_TRUSTED_DURATION_SEC) {
    let total = Math.max(trustedMax, args.expectedSec)
    if (args.currentTime > 0 && total < args.currentTime) {
      total = args.currentTime + 1
    }
    return total
  }

  if (args.progressiveHls) {
    return trustedMax > 0 ? trustedMax : 0
  }

  const partialMax = Math.max(
    Number.isFinite(args.streamSec) && args.streamSec > 0 ? args.streamSec : 0,
    Number.isFinite(args.videoSec) && args.videoSec > 0 ? args.videoSec : 0
  )
  let total = Math.max(trustedMax, partialMax)

  if (args.currentTime > 0 && total > 0 && total < args.currentTime) {
    total = args.currentTime + 1
  }

  return total
}
const VIDEO_ZOOM_MIN = 1
const VIDEO_ZOOM_MAX = 5
const VIDEO_PAN_THRESHOLD_PX = 8
const VIDEO_DOUBLE_TAP_MS = 300
const VIDEO_DOUBLE_TAP_DISTANCE_PX = 40

function clampVideoScale(scale: number) {
  return Math.max(VIDEO_ZOOM_MIN, Math.min(VIDEO_ZOOM_MAX, scale))
}

function getTouchDistance(touchA: Touch, touchB: Touch) {
  const dx = touchA.clientX - touchB.clientX
  const dy = touchA.clientY - touchB.clientY
  return Math.hypot(dx, dy)
}

/** Minimum pan bleed when the browser reports zero insets (common on some Android builds). */
const MOBILE_FALLBACK_SAFE_AREA: SafeAreaInsets = {
  top: 52,
  right: 28,
  bottom: 28,
  left: 28,
}

function resolvePanSafeAreaInsets(insets: SafeAreaInsets): SafeAreaInsets {
  if (insets.top + insets.right + insets.bottom + insets.left > 0) {
    return insets
  }

  if (typeof window === "undefined" || !("ontouchstart" in window)) {
    return insets
  }

  return MOBILE_FALLBACK_SAFE_AREA
}

function clampVideoTranslate(
  x: number,
  y: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
  safe: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }
) {
  if (scale <= VIDEO_ZOOM_MIN) {
    return { x: 0, y: 0 }
  }

  // Extra pan range into status bar / camera cutout / gesture areas (viewport-fit=cover).
  const bleedX = safe.left + safe.right
  const bleedY = safe.top + safe.bottom
  const maxX = (containerWidth * (scale - 1)) / 2 + bleedX
  const maxY = (containerHeight * (scale - 1)) / 2 + bleedY

  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  }
}

function isEnglishAudioLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  return (
    normalized === "en" ||
    normalized.startsWith("en-") ||
    normalized === "eng" ||
    normalized.includes("english")
  )
}

function pickPreferredAudioTrackFromList(
  tracks: Array<{ id: string; label: string }>
) {
  const english = tracks.find((track) => isEnglishAudioLabel(track.label))
  return english?.id ?? tracks[0]?.id
}

function pickPreferredHlsAudioTrackId(
  hlsInstance: Hls,
  safeTracks: Array<{ id: string; label: string }>
) {
  const hlsTracks = hlsInstance.audioTracks
  for (let i = 0; i < hlsTracks.length; i++) {
    const lang = (hlsTracks[i].lang || "").toLowerCase()
    const name = (hlsTracks[i].name || "").toLowerCase()
    if (isEnglishAudioLabel(lang) || isEnglishAudioLabel(name)) {
      return String(i)
    }
  }

  const fromLabels = pickPreferredAudioTrackFromList(safeTracks)
  if (
    fromLabels &&
    isEnglishAudioLabel(
      safeTracks.find((t) => t.id === fromLabels)?.label ?? ""
    )
  ) {
    return fromLabels
  }

  if (hlsInstance.audioTrack >= 0) {
    return String(hlsInstance.audioTrack)
  }

  return fromLabels
}

export interface MediaPlayerSource {
  id: string
  url: string
  type: "hls" | "file" | "embed"
  cinemacityPageUrl?: string
  directClientPlayback?: boolean
  clientPlaybackHeaders?: Record<string, string>
  /** Third-party player iframe (e.g. vaplayer.ru embed) — viewer browser loads it. */
  iframeEmbed?: boolean
  videasyPlayerSurface?: boolean
  /** Discrete provider qualities (Cineplay etc.) — shown in Quality tab, not Source. */
  qualities?: Array<{
    index: number
    label: string
    height: number
    url: string
    sourceType?: "hls" | "file"
  }>
}

interface MediaPlayerProps {
  source: MediaPlayerSource
  sources?: Array<{
    id: string
    label: string
    provider?: string
    providerId?: string
    quality?: string
  }>
  onSelectSource?: (id: string) => void | Promise<void>
  onRequestProvider?: (providerId: string) => void | Promise<void>
  subtitles?: Array<{
    id: string
    label: string
    src: string
    language?: string
    kind?: string
    source?: string
  }>
  audioTracks?: Array<{
    id: string
    label: string
    url?: string
  }>
  onPlaybackError?: (
    message: string,
    meta?: { currentTime: number; bufferedSeconds: number }
  ) => void
  onPlaybackReady?: (meta: {
    currentTime: number
    bufferedSeconds: number
  }) => void
  onPlaybackTime?: (currentTime: number) => void
  onPlaybackEnded?: () => void
  sourcesLoadingMore?: boolean
  sourceStatusMessage?: string
  onRefetchSources?: () => void
  /** Called when playback waits too long after starting — parent should retest/refetch and resume. */
  onBufferStall?: () => void
  unavailableProviders?: string[]
  sourceHealth?: Record<string, SourceHealthStatus>
  activeTestingProviderId?: string
  selectedProviderId?: string
  /** Provider IDs soft/hard-failed during Auto Sources walk (Sources sheet circles). */
  scanFailedProviderIds?: string[]
  watchMeta?: WatchProgressMeta
  nextTvEpisodeOnComplete?: TvEpisodeRef | null
  resumeTime?: number
  playbackToken?: string
  onPlaybackSync?: (state: { currentTime: number; isPlaying: boolean }) => void
  syncPlayback?: {
    currentTime: number
    isPlaying: boolean
    updatedAt?: number
    anchorTime?: number
  } | null
  watchPartyGuest?: boolean
  externalSubtitlesLoading?: boolean
  tvNavigation?: TvEpisodeNavigationProps
  autoNextEnabled?: boolean
  onAutoNextChange?: (enabled: boolean) => void
  showAutoNext?: boolean
  /** When true, posts watch progress + player events to parent iframe via postMessage. */
  embedReportingEnabled?: boolean
  embedMediaType?: "movie" | "tv"
  embedSeason?: number
  embedEpisode?: number
  /** Embed query param: start playback automatically. */
  forceAutoplay?: boolean
  /** Left inset for source status badge (cinema header clearance). */
  statusInsetLeft?: string
  /** Fullscreen the cinema shell (header + player) instead of only the video box. */
  fullscreenRootRef?: RefObject<HTMLElement | null>
  /** Parent page hosts Back / Watch Party; fullscreen + popovers are coordinated via postMessage. */
  parentHostedEmbed?: boolean
  onControlsOverlayVisibleChange?: (visible: boolean) => void
  onFullscreenChange?: (isFullscreen: boolean) => void
  /** Parent cinema chrome can call this ref to wake in-player controls (e.g. header hover). */
  controlsWakeRef?: React.MutableRefObject<(() => void) | null>
  /** When false, show Alpha/Beta/etc. instead of scraper names. */
  showRealProviderNames?: boolean
  hiddenProviderIds?: string[]
  enabledProviderIds?: string[]
  /** Clearance below a parent cinema header (Back / Watch Party) on mobile. */
  mobileControlsTopInset?: string
}


function heightFromHlsLevelName(name: string | undefined): number {
  if (!name) return 0
  const cleaned = name.trim().toLowerCase()
  if (/(?:^|[^0-9])4\s*k(?:$|[^0-9])|uhd|2160/.test(cleaned)) return 2160
  const match = cleaned.match(/(\d{3,4})\s*p/)
  if (match) return Number(match[1]) || 0
  return 0
}

/** Map WIDTH to a 16:9 quality band. Movy often ships cinematic crops
 *  (e.g. 1920x804) that would otherwise look like "720p" in the picker. */
function nominalHeightFromWidth(width: number | undefined): number {
  const w = Number(width) || 0
  if (w >= 3800) return 2160
  if (w >= 1900) return 1080
  if (w >= 1280) return 720
  if (w >= 850) return 480
  if (w >= 600) return 360
  return 0
}

function effectiveHlsLevelHeight(level: {
  height?: number
  width?: number
  name?: string
}): number {
  return Math.max(
    Number(level.height) || 0,
    heightFromHlsLevelName(level.name),
    nominalHeightFromWidth(level.width)
  )
}


/** CNO is hard-capped at 720p for MSE (CDN WxH in path). Prefer path/tag over bitrate fakes. */
function cnoEffectiveHeight(
  level: { height?: number; width?: number; name?: string; bitrate?: number },
  playbackUrl = "",
  qualityTag = ""
): number {
  const fromUrl = /\/(\d+)x(\d+)\//i.exec(playbackUrl || "")
  if (fromUrl) {
    const h = Number(fromUrl[2]) || 0
    if (h > 0) return Math.min(h, 720)
  }
  const tagH = qualityHeight(String(qualityTag || ""))
  if (tagH > 0) return Math.min(tagH, 720)
  const h = effectiveHlsLevelHeight(level)
  if (h > 0 && h <= 1080) return Math.min(h, 720)
  // Bitrate-as-height fallbacks in describeHlsQualityLevel are not real pixels.
  return 720
}

function isHevcHlsLevel(level: { codecs?: string; attrs?: { CODECS?: string } }): boolean {
  const codecs = `${level.codecs || ""} ${level.attrs?.CODECS || ""}`.toLowerCase()
  return /hvc1|hev1|hevc|h265/.test(codecs)
}

function resolveSourceProviderKey(source?: {
  providerId?: string
  provider?: string | { id?: string; name?: string } | null
}): string {
  if (!source) return ""
  const fromId = String(source.providerId || "").trim()
  if (fromId) return fromId.toLowerCase()
  const p = source.provider
  if (typeof p === "string") return p.trim().toLowerCase()
  if (p && typeof p === "object") {
    return String(p.id || p.name || "").trim().toLowerCase()
  }
  return ""
}


function markCachedProviderDead(providerKey: string, meta?: {
  type?: string
  tmdbId?: string
  season?: string | number
  episode?: string | number
}) {
  try {
    const key = String(providerKey || "").trim().toLowerCase()
    if (key !== "vaplayer" && key !== "7movies") return
    const mediaType = String(meta?.type || "movie").toLowerCase() === "tv" ? "tv" : "movie"
    let tmdbId = String(meta?.tmdbId || "").trim()
    if (!tmdbId && typeof window !== "undefined") {
      const m = window.location.pathname.match(/\/(movie|tv)\/(\d+)/i)
      if (m) tmdbId = m[2]
      if (!tmdbId) {
        const q = new URLSearchParams(window.location.search)
        tmdbId = String(q.get("tmdbId") || q.get("tmdb") || "").trim()
      }
    }
    if (!tmdbId) return
    const suffix =
      mediaType === "tv"
        ? `:${meta?.season || 1}:${meta?.episode || 1}`
        : ""
    const flag =
      key === "vaplayer"
        ? `va-dead:${mediaType}:${tmdbId}${suffix}`
        : `7m-dead:${mediaType}:${tmdbId}${suffix}`
    sessionStorage.setItem(flag, "1")
  } catch {
    /* ignore */
  }
}

function shouldCapAthenaHdOnly(providerKey: string, playbackUrl = ""): boolean {
  if (providerKey === "athena") return true
  // Cover missing providerId — Athena streams are zstream / transcode Light.
  if (/zstream-proxy\.bluevelvet\.space|transcode\.cfd/i.test(playbackUrl)) return true
  return false
}

function capAthenaQualities<T extends { height?: number; index?: number }>(
  levels: T[],
  providerKey: string,
  playbackUrl = ""
): T[] {
  if (!shouldCapAthenaHdOnly(providerKey, playbackUrl)) return levels
  // Atlantic/Athena is HD-only in Chillflix UI — never surface 4K Ultra HD.
  return levels.filter((level) => (level.height || 0) < 2160 && level.index !== -2160)
}

function describeHlsQualityLevel(
  level: { height?: number; width?: number; bitrate?: number; name?: string },
  index: number
): { index: number; height: number; label: string } | null {
  const height = effectiveHlsLevelHeight(level)
  if (height > 0) {
    return {
      index,
      height,
      label: height >= 2160 ? "4K" : `${height}p`,
    }
  }
  // Movy majorplay often ships NAME="720p" without RESOLUTION. Still expose the rung.
  if (level.name?.trim()) {
    const label = level.name.trim()
    return {
      index,
      height: Math.max(1, Math.round((level.bitrate || 0) / 1000)),
      label,
    }
  }
  if (level.bitrate && level.bitrate > 0) {
    const mbps = Math.max(1, Math.round(level.bitrate / 100_000) / 10)
    return { index, height: Math.max(1, Math.round(level.bitrate / 1000)), label: `${mbps} Mbps` }
  }
  return null
}

export function MediaPlayer({
  source,
  sources,
  onSelectSource,
  onRequestProvider,
  subtitles = [],
  audioTracks,
  onPlaybackError,
  onPlaybackReady,
  onPlaybackTime,
  onPlaybackEnded,
  sourcesLoadingMore = false,
  sourceStatusMessage,
  onRefetchSources,
  onBufferStall,
  unavailableProviders = [],
  sourceHealth,
  activeTestingProviderId,
  selectedProviderId,
  scanFailedProviderIds = [],
  watchMeta,
  nextTvEpisodeOnComplete,
  resumeTime,
  playbackToken,
  onPlaybackSync,
  syncPlayback,
  watchPartyGuest = false,
  externalSubtitlesLoading = false,
  tvNavigation,
  autoNextEnabled,
  onAutoNextChange,
  showAutoNext = false,
  embedReportingEnabled = false,
  embedMediaType,
  embedSeason,
  embedEpisode,
  forceAutoplay = false,
  statusInsetLeft,
  fullscreenRootRef,
  parentHostedEmbed = false,
  onControlsOverlayVisibleChange,
  onFullscreenChange,
  controlsWakeRef,
  showRealProviderNames,
  hiddenProviderIds = [],
  enabledProviderIds = [],
  mobileControlsTopInset,
}: MediaPlayerProps) {
  const { t } = useTranslations()
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStylePrefs>(() =>
    readSubtitleStylePrefs()
  )

  const updateSubtitleStyle = useCallback((patch: Partial<SubtitleStylePrefs>) => {
    setSubtitleStyle((prev) => {
      const next = { ...prev, ...patch }
      writeSubtitleStylePrefs(next)
      return next
    })
  }, [])

  const { user, updateProfile } = useAuth()
  const defaultAudioTrack = useMemo(
    () => ({ id: "default", label: t("player.defaultAudio") }),
    [t]
  )
  const ensureAudioTracks = useCallback(
    (tracks: Array<{ id: string; label: string; url?: string }>) =>
      tracks.length > 0 ? tracks : [defaultAudioTrack],
    [defaultAudioTrack]
  )
  const trackLabel = useCallback(
    (index: number, name?: string, lang?: string) =>
      name || lang || t("player.trackN", { n: index + 1 }),
    [t]
  )

  const searchParams = useClientSearchParams()
  const isIframeEmbed =
    source.type === "embed" ||
    Boolean(source.iframeEmbed) ||
    /vaplayer\.ru\/embed\//i.test(source.url) ||
    /vidsrc\.sh\/embed\//i.test(source.url)

  useEffect(() => {
    if (!source.videasyPlayerSurface) return
    const onMessage = (event: MessageEvent) => {
      try {
        if (event.origin !== "https://www.vidy.st" && event.origin !== "https://vidy.st") return
        const raw = event.data
        const msg =
          typeof raw === "string"
            ? (JSON.parse(raw) as { type?: string; data?: { event?: string; currentTime?: number; duration?: number } })
            : (raw as { type?: string; data?: { event?: string; currentTime?: number; duration?: number } })
        if (msg?.type !== "PLAYER_EVENT" || msg.data?.event !== "timeupdate") return
        const currentTime = Number(msg.data?.currentTime) || 0
        const duration = Number(msg.data?.duration) || 0
        if (duration > 0) setDuration(duration)
        setCurrentTime(currentTime)
        setIsPlaying(true)
        setIsLoading(false)
        playbackReadyRef.current?.({ currentTime, bufferedSeconds: Math.max(1, currentTime + 1) })
      } catch { /* ignore */ }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [source.videasyPlayerSurface, source.id])




  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoTransformRef = useRef<HTMLDivElement>(null)
  const [videoScale, setVideoScale] = useState(VIDEO_ZOOM_MIN)
  const [videoTranslate, setVideoTranslate] = useState({ x: 0, y: 0 })
  const [zoomGestureActive, setZoomGestureActive] = useState(false)
  const videoScaleRef = useRef(VIDEO_ZOOM_MIN)
  const videoTranslateRef = useRef({ x: 0, y: 0 })
  const zoomGestureRef = useRef({
    mode: "idle" as "idle" | "pinch" | "pan",
    startDistance: 0,
    startScale: VIDEO_ZOOM_MIN,
    startTranslateX: 0,
    startTranslateY: 0,
    lastPanX: 0,
    lastPanY: 0,
    moved: false,
  })
  const suppressVideoTapRef = useRef(false)
  const suppressDoubleClickRef = useRef(false)
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 })
  const safeAreaInsetsRef = useRef<SafeAreaInsets>({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })
  const hlsRef = useRef<Hls | null>(null)
  const controlsTimeoutRef = useRef<number | null>(null)
  const sourceTimeoutRef = useRef<number | null>(null)
  const startupProgressTimeoutRef = useRef<number | null>(null)

  const playbackErrorRef = useRef(onPlaybackError)
  const playbackReadyRef = useRef(onPlaybackReady)
  const onPlaybackTimeRef = useRef(onPlaybackTime)
  const playbackEndedRef = useRef(onPlaybackEnded)
  const playbackSyncRef = useRef(onPlaybackSync)
  const hasNotifiedPlaybackStartedRef = useRef(false)
  const hasNotifiedPlaybackEndedRef = useRef(false)
  const streamDurationRef = useRef(0)
  const expectedDurationRef = useRef(0)
  const notifyPlaybackEndedRef = useRef<() => void>(() => undefined)
  const watchPartyGuestRef = useRef(watchPartyGuest)

  useEffect(() => {
    playbackEndedRef.current = onPlaybackEnded
  }, [onPlaybackEnded])

  useEffect(() => {
    playbackSyncRef.current = onPlaybackSync
  }, [onPlaybackSync])

  useEffect(() => {
    watchPartyGuestRef.current = watchPartyGuest
  }, [watchPartyGuest])

  const applyExpectedDuration = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < MIN_TRUSTED_DURATION_SEC) return
    expectedDurationRef.current = Math.max(expectedDurationRef.current, seconds)
    setDuration((current) => Math.max(current, expectedDurationRef.current))
  }, [])

  useEffect(() => {
    const runtimeMinutes = watchMeta?.runtimeMinutes
    if (typeof runtimeMinutes === "number" && runtimeMinutes > 0) {
      applyExpectedDuration(runtimeMinutes * 60)
    }
  }, [watchMeta?.runtimeMinutes, applyExpectedDuration])

  useEffect(() => {
    if (expectedDurationRef.current >= MIN_TRUSTED_DURATION_SEC) return
    if (!watchMeta?.id || watchMeta.type !== "movie") return

    let cancelled = false
    void fetch(`/api/movie/${watchMeta.id}`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((detail) => {
        if (cancelled) return
        const runtime = Number(detail?.runtime)
        if (Number.isFinite(runtime) && runtime > 0) {
          applyExpectedDuration(runtime * 60)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [watchMeta?.id, watchMeta?.type, applyExpectedDuration])

  const applyResolvedDuration = useCallback(
    (
      streamSec: number,
      videoSec: number,
      currentTime: number,
      progressiveHls: boolean
    ) => {
      const next = resolvePlayerDuration({
        expectedSec: expectedDurationRef.current,
        streamSec,
        videoSec,
        currentTime,
        progressiveHls,
      })

      if (!Number.isFinite(next) || next <= 0) return

      streamDurationRef.current = Math.max(streamDurationRef.current, next)
      setDuration((current) => (next > current ? next : current))
    },
    []
  )

  const reportPlaybackSync = useCallback(() => {
    if (watchPartyGuest) return
    const video = videoRef.current
    if (!video) return

    playbackSyncRef.current?.({
      currentTime: video.currentTime,
      isPlaying: !video.paused && !video.ended,
    })
  }, [watchPartyGuest])

  const getPlaybackMeta = (video: HTMLVideoElement) => {
    let bufferedSeconds = 0

    if (video.buffered.length > 0) {
      bufferedSeconds = video.buffered.end(video.buffered.length - 1)
    }

    return {
      currentTime: video.currentTime,
      bufferedSeconds,
    }
  }

  const reportPlaybackError = (message: string) => {
    const video = videoRef.current
    playbackErrorRef.current?.(
      message,
      video ? getPlaybackMeta(video) : { currentTime: 0, bufferedSeconds: 0 }
    )
  }
  const activeSourceKeyRef = useRef<string | null>(null)
  const activeStreamBaseRef = useRef<string>("")
  const sourcePropsRef = useRef(source)
  sourcePropsRef.current = source
  const playbackTokenRef = useRef(playbackToken)
  const proxyHeadersRef = useRef<Record<string, string>>({
    Referer: "https://peachify.top/",
    Origin: "https://peachify.top",
  })
  const audioTracksRef = useRef(audioTracks)
  const userPickedAudioTrackRef = useRef(false)
  const audioTracksReadyForSourceRef = useRef(false)

  useEffect(() => {
    playbackTokenRef.current = playbackToken
  }, [playbackToken])
  const [isPlaying, setIsPlaying] = useState(false)
  const notifyPlaybackEnded = useCallback(() => {
    if (hasNotifiedPlaybackEndedRef.current) return
    hasNotifiedPlaybackEndedRef.current = true
    setIsPlaying(false)
    playbackEndedRef.current?.()
  }, [])
  notifyPlaybackEndedRef.current = notifyPlaybackEnded
  const [isLoading, setIsLoading] = useState(true)
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false)
  const hasPlayedOnceRef = useRef(false)
  hasPlayedOnceRef.current = hasPlayedOnce
  // BUFFERING_OVERLAY_DELAY: don't flash "Buffering…" on every timeline click.
  // Only show the label after the player has been waiting this long.
  const [showBufferingLabel, setShowBufferingLabel] = useState(false)
  const bufferingLabelTimerRef = useRef<number | null>(null)

  const clearBufferingLabelTimer = useCallback(() => {
    if (bufferingLabelTimerRef.current != null) {
      window.clearTimeout(bufferingLabelTimerRef.current)
      bufferingLabelTimerRef.current = null
    }
  }, [])

  const scheduleBufferingLabel = useCallback(() => {
    if (bufferingLabelTimerRef.current != null) return
    bufferingLabelTimerRef.current = window.setTimeout(() => {
      bufferingLabelTimerRef.current = null
      setShowBufferingLabel(true)
    }, 900)
  }, [])

  const hideBufferingLabel = useCallback(() => {
    clearBufferingLabelTimer()
    setShowBufferingLabel(false)
  }, [clearBufferingLabelTimer])

  // After a long stall, nudge users to try another source near Settings.
  const [showChangeSourceHint, setShowChangeSourceHint] = useState(false)
  const changeSourceHintTimerRef = useRef<number | null>(null)

  const clearChangeSourceHintTimer = useCallback(() => {
    if (changeSourceHintTimerRef.current != null) {
      window.clearTimeout(changeSourceHintTimerRef.current)
      changeSourceHintTimerRef.current = null
    }
  }, [])

  const hideChangeSourceHint = useCallback(() => {
    clearChangeSourceHintTimer()
    setShowChangeSourceHint(false)
  }, [clearChangeSourceHintTimer])

  const scheduleChangeSourceHint = useCallback(() => {
    if (changeSourceHintTimerRef.current != null) return
    changeSourceHintTimerRef.current = window.setTimeout(() => {
      changeSourceHintTimerRef.current = null
      setShowChangeSourceHint(true)
    }, 8000)
  }, [])

  const openSourceSettings = useCallback(() => {
    hideChangeSourceHint()
    window.dispatchEvent(
      new CustomEvent("chillflix:open-player-settings", {
        detail: { tab: "source" },
      })
    )
  }, [hideChangeSourceHint])

  useEffect(() => {
    hideChangeSourceHint()
  }, [source.id, hideChangeSourceHint])

  // Cold start / black screen: waiting may never fire if autoplay never starts.
  // Arm the same 8s nudge whenever we are stuck loading this source.
  useEffect(() => {
    if (isLoading) {
      scheduleChangeSourceHint()
    }
  }, [isLoading, source.id, scheduleChangeSourceHint])

  const clearLoadingWhenPlaybackFlowing = useCallback((media: HTMLVideoElement) => {
    // VAPlayer/HLS can decode audio before HAVE_FUTURE_DATA / while seeking.
    // Treat real timeline motion or current-data as "flowing" so overlays drop.
    const hasBuffer =
      media.buffered.length > 0 &&
      media.buffered.end(media.buffered.length - 1) > Math.max(0, media.currentTime - 0.25)
    const flowing =
      (!media.paused &&
        !media.seeking &&
        (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
          media.currentTime > 0.15 ||
          hasBuffer)) ||
      media.currentTime > 0.35
    if (flowing) {
      setIsLoading(false)
      hideBufferingLabel()
      hideChangeSourceHint()
      if (media.currentTime > 0.05 || hasBuffer) {
        setHasPlayedOnce(true)
      }
    }
  }, [hideBufferingLabel, hideChangeSourceHint])

  // RESUME_TIME_INIT_CLOCK: avoid 00:00 flash while resume seek applies after remount.
  const [currentTime, setCurrentTime] = useState(() =>
    typeof resumeTime === "number" && resumeTime > 0.5 ? resumeTime : 0
  )
  const skipPlaybackTimeRef = useRef(
    typeof resumeTime === "number" && resumeTime > 0.5 ? resumeTime : 0
  )
  const needsPlaybackTimeUiRef = useRef(true)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const volumeRef = useRef(volume)
  // chillflix.lol / vuflix cf-prefer-sound: start UNMUTED and autoplay with
  // audio. Browsers with Media Engagement (or a Watch gesture) allow it.
  // forceAutoplay only means "attempt autoplay" — never "start muted".
  // If unmuted play is blocked, tryAutoplay falls back to muted + tap-for-sound.
  const [isMuted, setIsMuted] = useState(false)
  const [pendingAutoplayUnmute, setPendingAutoplayUnmute] = useState(false)
  const pendingAutoplayUnmuteRef = useRef(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [inlinePlayback, setInlinePlayback] = useState(true)
  const [consoleControls, setConsoleControls] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [qualities, setQualities] = useState<
    Array<{ index: number; height: number; label: string; url?: string }>
  >([])
  const [currentQuality, setCurrentQuality] = useState(-1)
  const currentQualityRef = useRef(-1)
  /** When set, overrides source.url for provider quality switching. */
  const [qualityOverrideUrl, setQualityOverrideUrl] = useState<string | null>(null)
  const qualityOverrideUrlRef = useRef<string | null>(null)
  const providerQualitiesRef = useRef(source.qualities)
  const providerQualitiesKeyRef = useRef("")
  const [qualityReloadNonce, setQualityReloadNonce] = useState(0)
  /** null = follow ABR, -1 = viewer chose Auto, >=0 = locked rendition. */
  const manualQualityRef = useRef<number | null>(null)
  const qualityResumeRef = useRef<{ time: number; playing: boolean } | null>(null)
  /** Discrete ladder soft-fallback attempts (1080→720→480) on cold stall. */
  const qualityStepDownRef = useRef(0)
  /** True once the Quality tab is the live HLS ladder (Toflix-style), not separate files. */
  const hlsLadderMenuRef = useRef(false)
  const handleQualityChangeRef = useRef<(level: number) => void>(() => {})

  useEffect(() => {
    qualityOverrideUrlRef.current = qualityOverrideUrl
  }, [qualityOverrideUrl])

  useEffect(() => {
    currentQualityRef.current = currentQuality
  }, [currentQuality])

  // Only reset quality selection when the Source (provider) changes — not when
  // parent remints playback tokens / rebuilds the qualities array reference.
  useEffect(() => {
    setQualityOverrideUrl(null)
    qualityOverrideUrlRef.current = null
    manualQualityRef.current = null
    qualityResumeRef.current = null
    hlsLadderMenuRef.current = false
    qualityStepDownRef.current = 0
    setQualityReloadNonce(0)
    providerQualitiesKeyRef.current = ""
    providerQualitiesRef.current = source.qualities
    if (source.qualities && source.qualities.length > 1) {
      const mapped = source.qualities.map((item) => ({
        index: item.index,
        height: item.height,
        label: item.label,
        url: item.url,
      }))
      setQualities(mapped)
      providerQualitiesKeyRef.current = source.qualities
        .map(
          (item) =>
            `${item.label}:${item.height}:${playbackUrlWithoutToken(item.url)}`
        )
        .join("|")
      // Discrete ladders (Videasy): start Full HD, not Auto/4K.
      const fullHd =
        mapped.find((item) => item.height === 1080) ||
        mapped
          .filter((item) => (item.height || 0) > 0 && (item.height || 0) <= 1080)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
      if (fullHd) {
        manualQualityRef.current = fullHd.index
        setCurrentQuality(fullHd.index)
        if (fullHd.url) {
          setQualityOverrideUrl(fullHd.url)
          qualityOverrideUrlRef.current = fullHd.url
        }
      } else {
        setCurrentQuality(-1)
      }
    } else {
      // Seed provisional rungs so Quality is never empty before MANIFEST_PARSED.
      // A lone 2160 seed collapsed Rive (Brand New Day) to 4K-only / empty sheet.
      const tagH = qualityHeight(String(source.quality || ""))
      const providerKey = resolveSourceProviderKey(source).trim().toLowerCase()
      const abrHls =
        providerKey === "rivestream" ||
        providerKey === "vaplayer" ||
        providerKey === "novahd" ||
        providerKey === "vidmoly" ||
        providerKey === "cno"
      if (abrHls) {
        const maxH = tagH > 0 ? tagH : 1080
        const heights = [2160, 1080, 720, 480].filter((h) => h <= maxH)
        const seeded = (heights.length ? heights : [1080, 720, 480]).map((h, index) => ({
          index,
          height: h,
          label: h >= 2160 ? "4K" : `${h}p`,
        }))
        setQualities(seeded)
        const prefer =
          seeded.find((q) => q.height === 1080) ||
          seeded.find((q) => q.height === maxH) ||
          seeded[0]
        setCurrentQuality(prefer?.index ?? 0)
      } else if (tagH > 0) {
        setQualities([
          {
            index: 0,
            height: tagH,
            label: tagH >= 2160 ? "4K" : `${tagH}p`,
          },
        ])
        setCurrentQuality(0)
      } else {
        setQualities([])
        setCurrentQuality(-1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-init on Source change
  }, [source.id])

  useEffect(() => {
    const list = source.qualities
    providerQualitiesRef.current = list

    if (!list || list.length <= 1) {
      providerQualitiesKeyRef.current = ""
      return
    }

    const key = list
      .map(
        (item) =>
          `${item.label}:${item.height}:${playbackUrlWithoutToken(item.url)}`
      )
      .join("|")

    const selected = currentQualityRef.current

    // Same ladder (token-only URL churn): keep the user's pick, refresh override URL.
    if (key === providerQualitiesKeyRef.current) {
      if (selected >= 0) {
        const picked = list.find((item) => item.index === selected)
        if (
          picked &&
          qualityOverrideUrlRef.current &&
          playbackUrlWithoutToken(qualityOverrideUrlRef.current) ===
            playbackUrlWithoutToken(picked.url) &&
          qualityOverrideUrlRef.current !== picked.url
        ) {
          setQualityOverrideUrl(picked.url)
          qualityOverrideUrlRef.current = picked.url
        }
      }
      return
    }

    // A live HLS ladder owns the Quality tab. Don't put separate file URLs back on top of it.
    if (hlsLadderMenuRef.current && (hlsRef.current?.levels.length ?? 0) > 1) {
      providerQualitiesKeyRef.current = key
      return
    }

    providerQualitiesKeyRef.current = key
    setQualities(
      list.map((item) => ({
        index: item.index,
        height: item.height,
        label: item.label,
        url: item.url,
      }))
    )

    // New ladder content: keep index if still valid, else Auto.
    if (selected >= 0) {
      const picked = list.find((item) => item.index === selected)
      if (!picked) {
        setQualityOverrideUrl(null)
        qualityOverrideUrlRef.current = null
        setCurrentQuality(-1)
      } else {
        setQualityOverrideUrl(picked.url)
        qualityOverrideUrlRef.current = picked.url
      }
    }
  }, [source.qualities])
  const [autoplayEnabled, setAutoplayEnabled] = useState(
    () =>
      forceAutoplay ||
      (embedReportingEnabled
        ? false
        : (getClientUser()?.autoplayEnabled ?? true))
  )
  const forceAutoplayRef = useRef(forceAutoplay)
  const autoplayEnabledRef = useRef(autoplayEnabled)
  const tryAutoplayRef = useRef<(() => Promise<void>) | null>(null)
  const tryAutoplayInFlightRef = useRef(false)
  const autoplayUnmuteCleanupRef = useRef<(() => void) | null>(null)

  const clearAutoplayUnmuteSchedule = useCallback(() => {
    autoplayUnmuteCleanupRef.current?.()
    autoplayUnmuteCleanupRef.current = null
  }, [])

  const teardownPlayback = useCallback(() => {
    clearAutoplayUnmuteSchedule()

    if (sourceTimeoutRef.current) {
      window.clearTimeout(sourceTimeoutRef.current)
      sourceTimeoutRef.current = null
    }

    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current)
      controlsTimeoutRef.current = null
    }

    if (hlsRef.current) {
      const hls = hlsRef.current
      hlsRef.current = null
      try {
        hls.stopLoad()
        hls.detachMedia()
        hls.destroy()
      } catch {
        // ignore teardown races during unmount
      }
    }

    const video = videoRef.current
    if (video) {
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => undefined)
      }

      video.pause()
      video.removeAttribute("src")
      video.load()
    }

    activeSourceKeyRef.current = null
    activeStreamBaseRef.current = ""
  }, [clearAutoplayUnmuteSchedule])

  useEffect(() => () => teardownPlayback(), [teardownPlayback])

  useEffect(() => {
    const stopPlayback = () => teardownPlayback()
    window.addEventListener("pagehide", stopPlayback)
    return () => window.removeEventListener("pagehide", stopPlayback)
  }, [teardownPlayback])

  const applyAutoplayUnmute = useCallback(() => {
    const video = videoRef.current
    const targetVolume = volumeRef.current > 0 ? volumeRef.current : 1

    if (video) {
      video.muted = false
      video.volume = targetVolume
    }

    setIsMuted(false)
    setPendingAutoplayUnmute(false)
    clearAutoplayUnmuteSchedule()
  }, [clearAutoplayUnmuteSchedule])

  const queueAutoplayUnmute = useCallback(
    (video: HTMLVideoElement) => {
      clearAutoplayUnmuteSchedule()
      const targetVolume = volumeRef.current > 0 ? volumeRef.current : 1
      // Same delays as chillflix.lol player.js after successful unmuted play.
      autoplayUnmuteCleanupRef.current = scheduleAutoplayUnmuteAttempts(
        video,
        applyAutoplayUnmute,
        CHILLFLIX_AUTO_UNMUTE_DELAYS_MS,
        targetVolume
      )
    },
    [applyAutoplayUnmute, clearAutoplayUnmuteSchedule]
  )

  useEffect(
    () => () => clearAutoplayUnmuteSchedule(),
    [clearAutoplayUnmuteSchedule]
  )

  useEffect(() => {
    forceAutoplayRef.current = forceAutoplay
  }, [forceAutoplay])

  // Expose Watch-click primer for same-origin parents (player-api docs).
  useEffect(() => {
    const w = window as unknown as {
      __cfPrimeAutoplaySound?: () => void
      __cfNotePlaybackGesture?: () => void
    }
    w.__cfPrimeAutoplaySound = primeAutoplaySoundUnlock
    w.__cfNotePlaybackGesture = notePlaybackUserGesture
    return () => {
      if (w.__cfPrimeAutoplaySound === primeAutoplaySoundUnlock) {
        delete w.__cfPrimeAutoplaySound
      }
      if (w.__cfNotePlaybackGesture === notePlaybackUserGesture) {
        delete w.__cfNotePlaybackGesture
      }
    }
  }, [])

  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled
  }, [autoplayEnabled])

  useEffect(() => {
    pendingAutoplayUnmuteRef.current = pendingAutoplayUnmute
  }, [pendingAutoplayUnmute])

  const tryAutoplay = useCallback(async () => {
    if (watchPartyGuestRef.current) return
    const video = videoRef.current
    if (!video || !video.paused) return
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return
    if (tryAutoplayInFlightRef.current) return

    const warmOnly =
      embedReportingEnabled && !forceAutoplayRef.current

    if (!warmOnly && !forceAutoplayRef.current && !autoplayEnabledRef.current) {
      return
    }

    // One in-flight attempt — canplay / loadedmetadata / MANIFEST_PARSED / effect
    // otherwise stack play↔pause and HLS nudges currentTime forward (fake 2x).
    tryAutoplayInFlightRef.current = true
    try {
      setAutoplayBlocked(false)
      clearAutoplayUnmuteSchedule()

      try {
        video.playbackRate = 1
      } catch {
        // ignore
      }

      // Parent preload (autoplay=false): attach + buffer muted. Never unmute.
      if (warmOnly) {
        try {
          video.muted = true
          video.volume = 0
          try {
            video.setAttribute("muted", "")
          } catch {
            // ignore
          }
          setIsMuted(true)
          setPendingAutoplayUnmute(false)
          await video.play()
        } catch {
          // ignore — source is still attached for the later Play command
        }
        return
      }

      // chillflix.lol player.js tryPlay: always prefer sound (cf-prefer-sound).
      const forceSound = () => {
        try {
          video.muted = false
          if (!(video.volume > 0)) {
            video.volume = volumeRef.current > 0 ? volumeRef.current : 1
          }
        } catch {
          // ignore
        }
        setIsMuted(false)
        setPendingAutoplayUnmute(false)
      }

      forceSound()
      try {
        // No-op on a loaded stream (see unlockVideoElementForAutoplay); primer
        // from Watch / tap already stamped the unlock flag when allowed.
        await unlockVideoElementForAutoplay(video)
      } catch {
        // ignore
      }
      forceSound()

      try {
        await video.play()
        forceSound()
        // Chrome may resolve play() then immediately pause without a gesture.
        await new Promise((resolve) => window.setTimeout(resolve, 60))
        if (video.paused) {
          throw new Error("autoplay-paused")
        }
        try {
          video.playbackRate = 1
        } catch {
          // ignore
        }
        // Unmuted autoplay stuck — fight silent re-mute like chillflix.
        queueAutoplayUnmute(video)
        return
      } catch {
        // Browser blocked unmuted autoplay. Start muted so Autoplay still works.
        // Do NOT auto-unmute here: muted→unmuted without a gesture pauses, remutes,
        // and replays in a loop — HLS nudges time forward (looks like hold-to-2x).
        try {
          video.muted = true
          try {
            video.setAttribute("muted", "")
          } catch {
            // ignore
          }
          setIsMuted(true)
          setPendingAutoplayUnmute(true)
          await video.play()
          try {
            video.playbackRate = 1
          } catch {
            // ignore
          }
        } catch {
          try {
            forceSound()
            await video.play()
          } catch {
            setAutoplayBlocked(true)
            setPendingAutoplayUnmute(false)
          }
        }
      }
    } finally {
      tryAutoplayInFlightRef.current = false
    }
  }, [clearAutoplayUnmuteSchedule, embedReportingEnabled, queueAutoplayUnmute])

  useEffect(() => {
    tryAutoplayRef.current = tryAutoplay
  }, [tryAutoplay])

  const handleAutoplayChange = useCallback(
    (enabled: boolean) => {
      setAutoplayEnabled(enabled)
      if (user) {
        void updateProfile({ autoplayEnabled: enabled }).then((error) => {
          if (error) setAutoplayEnabled(!enabled)
        })
      }
    },
    [updateProfile, user]
  )

  useEffect(() => {
    if (forceAutoplay) {
      setAutoplayEnabled(true)
      return
    }
    if (embedReportingEnabled) {
      setAutoplayEnabled(false)
      return
    }
    if (user) {
      setAutoplayEnabled(user.autoplayEnabled)
    }
  }, [user?.id, user?.autoplayEnabled, forceAutoplay, embedReportingEnabled])

  useEffect(() => {
    setAutoplayBlocked(false)
    tryAutoplayInFlightRef.current = false
  }, [source.id])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const menuOpenRef = useRef(false)
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<
    string | undefined
  >(undefined)
  const [extraSubtitleTracks, setExtraSubtitleTracks] = useState<
    Array<{ id: string; label: string; src: string; language?: string; kind?: string }>
  >([])

  useEffect(() => {
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string; name?: string }>).detail
      if (!detail?.url) return
      const id = `local:${detail.url}`
      setExtraSubtitleTracks((prev) => {
        if (prev.some((t) => t.id === id)) return prev
        return [
          ...prev,
          {
            id,
            label: detail.name || "Uploaded",
            src: detail.url,
            language: "unknown",
            kind: "subtitles",
          },
        ]
      })
      setSelectedSubtitleId(id)
    }
    const onExternal = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          id?: string
          label?: string
          src?: string
          language?: string
          kind?: string
        }>
      ).detail
      if (!detail?.id || !detail?.src) return
      setExtraSubtitleTracks((prev) => {
        if (prev.some((t) => t.id === detail.id)) return prev
        return [
          ...prev,
          {
            id: detail.id!,
            label: detail.label || "OpenSubtitles",
            src: detail.src!,
            language: detail.language,
            kind: detail.kind || "subtitles",
          },
        ]
      })
      setSelectedSubtitleId(detail.id)
    }
    window.addEventListener("chillflix-local-subtitle", onLocal as EventListener)
    window.addEventListener("chillflix-external-subtitle", onExternal as EventListener)
    return () => {
      window.removeEventListener("chillflix-local-subtitle", onLocal as EventListener)
      window.removeEventListener("chillflix-external-subtitle", onExternal as EventListener)
    }
  }, [])

  const initialAudioTracks = ensureAudioTracks(
    audioTracks ?? EMPTY_AUDIO_TRACKS
  )
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<
    string | undefined
  >(
    () =>
      pickPreferredAudioTrackFromList(initialAudioTracks) ??
      initialAudioTracks[0]?.id
  )
  const [availableAudioTracks, setAvailableAudioTracks] =
    useState<Array<{ id: string; label: string; url?: string }>>(
      initialAudioTracks
    )

  const handleSelectAudioTrack = useCallback(
    (trackId: string) => {
      userPickedAudioTrackRef.current = true
      setSelectedAudioTrackId(trackId)

      const track = (
        audioTracksRef.current ??
        availableAudioTracks ??
        EMPTY_AUDIO_TRACKS
      ).find((item) => item.id === trackId)

      if (track?.url?.trim()) {
        const nextUrl = track.url.trim()
        const current =
          qualityOverrideUrlRef.current?.trim() || source.url
        if (playbackUrlWithoutToken(current) !== playbackUrlWithoutToken(nextUrl)) {
          qualityOverrideUrlRef.current = nextUrl
          setQualityOverrideUrl(nextUrl)
          setQualityReloadNonce((value) => value + 1)
        }
      }
    },
    [availableAudioTracks, source.url]
  )

  const hasAppliedContinueRef = useRef(false)
  /** Opening resume/URL continue may only apply once per media+episode; remounts use live position. */
  const continueAppliedSessionKeyRef = useRef("")
  const onRefetchSourcesRef = useRef(onRefetchSources)
  const onBufferStallRef = useRef(onBufferStall)
  // STALL_AUTO_RECOVERY
  const stallRecoveryAtRef = useRef(0)
  const stallRecoveryTimerRef = useRef<number | null>(null)
  const proxyRecoveryAtRef = useRef(0)
  const [proxyRecoveryResumeTime, setProxyRecoveryResumeTime] = useState<
    number | undefined
  >()

  useEffect(() => {
    onRefetchSourcesRef.current = onRefetchSources
  }, [onRefetchSources])

  useEffect(() => {
    onBufferStallRef.current = onBufferStall
  }, [onBufferStall])

  useEffect(() => {
    // RESUME_TIME_PROP_SYNC
    if (resumeTime === 0) {
      skipPlaybackTimeRef.current = 0
      setCurrentTime(0)
      return
    }
    if (typeof resumeTime === "number" && resumeTime > 0.5) {
      if (skipPlaybackTimeRef.current < 0.5 || Math.abs(skipPlaybackTimeRef.current - resumeTime) > 1) {
        skipPlaybackTimeRef.current = resumeTime
        setCurrentTime(resumeTime)
      }
    }
  }, [resumeTime])

  const continueSessionKey = useMemo(() => {
    if (!watchMeta?.id) return ""
    if (watchMeta.type === "tv") {
      return `tv:${watchMeta.id}:${watchMeta.season ?? 0}:${
        watchMeta.episode ?? 0
      }`
    }
    return `movie:${watchMeta.id}`
  }, [watchMeta?.id, watchMeta?.type, watchMeta?.season, watchMeta?.episode])

  const continueTime = useMemo(() => {
    if (
      typeof proxyRecoveryResumeTime === "number" &&
      proxyRecoveryResumeTime > 0
    ) {
      return proxyRecoveryResumeTime
    }

    if (watchPartyGuest) {
      const anchor = syncPlayback?.anchorTime ?? syncPlayback?.currentTime ?? 0
      if (anchor > 0) {
        return anchor
      }
      if (typeof resumeTime === "number" && resumeTime > 0) {
        return resumeTime
      }
      return 0
    }

    // Explicit fresh start (manual client-resolve remount).
    if (resumeTime === 0) {
      return 0
    }

    // Opening resume already applied for this episode — remounts must not seek back to it.
    if (
      continueSessionKey &&
      continueAppliedSessionKeyRef.current === continueSessionKey
    ) {
      const preserved = skipPlaybackTimeRef.current
      return preserved > 0.5 ? preserved : 0
    }

    if (typeof resumeTime === "number" && resumeTime > 0) {
      return resumeTime
    }

    const urlContinue = Number(
      searchParams.get("startAt") ?? searchParams.get("continue") ?? "0"
    )
    if (Number.isFinite(urlContinue) && urlContinue > 0) {
      return urlContinue
    }
    return 0
  }, [
    watchPartyGuest,
    syncPlayback?.anchorTime,
    syncPlayback?.currentTime,
    resumeTime,
    searchParams,
    proxyRecoveryResumeTime,
    continueSessionKey,
  ])

  useWatchPartyGuestVideoSync({
    videoRef,
    enabled: watchPartyGuest && Boolean(syncPlayback),
    syncPlayback,
    onCurrentTime: setCurrentTime,
    onIsPlaying: setIsPlaying,
  })

  const playbackProxyOrigin = useMemo(
    () => resolveClientPlaybackProxyOrigin(),
    []
  )

  const effectiveSubtitles = useMemo(() => {
    const seen = new Set<string>()
    const out: typeof subtitles = []
    for (const track of [...subtitles, ...extraSubtitleTracks]) {
      if (seen.has(track.id)) continue
      seen.add(track.id)
      out.push(track)
    }
    return out
  }, [subtitles, extraSubtitleTracks])

  const selectedSubtitle = useMemo(
    () => effectiveSubtitles.find((subtitle) => subtitle.id === selectedSubtitleId),
    [selectedSubtitleId, effectiveSubtitles]
  )

  const handleSubtitleLoadError = useCallback(
    (failedUrl: string) => {
      const currentIndex = subtitles.findIndex(
        (subtitle) => subtitle.src === failedUrl
      )
      const fallback = subtitles.find((_, idx) => idx > currentIndex)
      if (fallback) {
        setSelectedSubtitleId(fallback.id)
      } else {
        setSelectedSubtitleId(undefined)
      }
    },
    [subtitles]
  )

  useEffect(() => {
    menuOpenRef.current = settingsOpen || episodesOpen
    if (settingsOpen || episodesOpen) {
      setShowControls(true)
      if (controlsTimeoutRef.current) {
        window.clearTimeout(controlsTimeoutRef.current)
        controlsTimeoutRef.current = null
      }
    }
  }, [settingsOpen, episodesOpen])

  useEffect(() => {
    playbackErrorRef.current = onPlaybackError
  }, [onPlaybackError])

  useEffect(() => {
    playbackReadyRef.current = onPlaybackReady
  }, [onPlaybackReady])

  useEffect(() => {
    onPlaybackTimeRef.current = onPlaybackTime
  }, [onPlaybackTime])

  useEffect(() => {
    audioTracksRef.current = audioTracks
  }, [audioTracks])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const incomingSourceKey = `${source.id}|${source.type}`
    if (
      activeSourceKeyRef.current &&
      activeSourceKeyRef.current !== incomingSourceKey
    ) {
      qualityOverrideUrlRef.current = null
    }

    const effectiveSourceUrl =
      qualityOverrideUrlRef.current?.trim() || source.url
    const playbackUrlForGate = normalizeCinemacityCdnPlaybackUrl(effectiveSourceUrl)
    const needsPlaybackToken = requiresPlaybackTokenUrl(playbackUrlForGate)

    const resolveRequestToken = (href: string) => {
      if (playbackTokenRef.current) {
        return playbackTokenRef.current
      }

      try {
        return (
          extractPlaybackToken(new URL(href, window.location.origin)) ??
          undefined
        )
      } catch {
        return undefined
      }
    }

    const initialPlaybackToken = resolveRequestToken(playbackUrlForGate)

    if (
      needsPlaybackToken &&
      !initialPlaybackToken &&
      !source.directClientPlayback
    ) {
      return
    }

    const sourceKey = `${source.id}|${source.type}`
    const streamBase = playbackUrlWithoutToken(playbackUrlForGate)
    const isSameStream =
      activeSourceKeyRef.current === sourceKey &&
      activeStreamBaseRef.current === streamBase
    // Same logical source with a live HLS pipeline: ignore URL / sources /
    // token churn from parent re-renders. Comparing streamBase alone used to
    // remount on every CF-proxy rewrite and flash "Starting playback…".
    const keepLivePipeline =
      activeSourceKeyRef.current === sourceKey &&
      Boolean(hlsRef.current) &&
      !qualityResumeRef.current &&
      // Do not keep a dead pipeline that never painted — that left Movy stuck
      // on "No quality options" after a CF-blip cold start.
      (hasPlayedOnceRef.current ||
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.buffered.length > 0)

    if (
      (isSameStream || keepLivePipeline) &&
      (hlsRef.current || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
    ) {
      if (playbackToken) {
        playbackTokenRef.current = playbackToken
      }
      activeStreamBaseRef.current = streamBase
      return
    }

    const sourceChanged = activeSourceKeyRef.current !== sourceKey
    if (sourceChanged) {
      userPickedAudioTrackRef.current = false
      audioTracksReadyForSourceRef.current = false
    }

    const bootstrapTracks = ensureAudioTracks(
      audioTracksRef.current ?? EMPTY_AUDIO_TRACKS
    )
    setAvailableAudioTracks(bootstrapTracks)
    if (!userPickedAudioTrackRef.current) {
      const preferredAudioId =
        pickPreferredAudioTrackFromList(bootstrapTracks) ??
        bootstrapTracks[0]?.id
      setSelectedAudioTrackId(preferredAudioId)
      const preferredAudio = bootstrapTracks.find(
        (track) => track.id === preferredAudioId
      )
      if (preferredAudio?.url?.trim()) {
        const nextUrl = preferredAudio.url.trim()
        if (
          playbackUrlWithoutToken(nextUrl) !==
          playbackUrlWithoutToken(source.url)
        ) {
          qualityOverrideUrlRef.current = nextUrl
          setQualityOverrideUrl(nextUrl)
        }
      }
    }

    activeSourceKeyRef.current = sourceKey
    activeStreamBaseRef.current = streamBase
    hasAppliedContinueRef.current = false
    hasNotifiedPlaybackStartedRef.current = false
    hasNotifiedPlaybackEndedRef.current = false
    if (!qualityResumeRef.current) {
      streamDurationRef.current = 0
      if (!(watchMeta?.runtimeMinutes && watchMeta.runtimeMinutes > 0)) {
        expectedDurationRef.current = 0
      }
    }

    if (sourceTimeoutRef.current) {
      window.clearTimeout(sourceTimeoutRef.current)
      sourceTimeoutRef.current = null
    }
    if (startupProgressTimeoutRef.current) {
      window.clearTimeout(startupProgressTimeoutRef.current)
      startupProgressTimeoutRef.current = null
    }

    const qualityResume = qualityResumeRef.current
    if (resumeTime === 0 && !qualityResume) {
      skipPlaybackTimeRef.current = 0
    }
    const liveTime =
      resumeTime === 0 && !qualityResume
        ? 0
        : Math.max(
            qualityResume?.time || 0,
            video.currentTime || 0,
            skipPlaybackTimeRef.current || 0
          )
    if (liveTime > 0.5) {
      skipPlaybackTimeRef.current = liveTime
    }

    // A quality change used to call video.load() while the previous hls.js
    // instance was still attached. That throws and the page error boundary
    // replaces the movie. Drop the old instance first, and keep the element
    // when we are only switching rendition.
    if (hlsRef.current) {
      const previousHls = hlsRef.current
      hlsRef.current = null
      try {
        previousHls.stopLoad()
        previousHls.detachMedia()
        previousHls.destroy()
      } catch {
        // ignore teardown races during a quality change
      }
    }

    const switchingQuality = Boolean(qualityResumeRef.current)
    if (!switchingQuality) {
      try {
        video.pause()
        video.removeAttribute("src")
        video.load()
      } catch {
        // ignore
      }
    }

    const preservedTime = Math.max(
      skipPlaybackTimeRef.current,
      liveTime
    )

    setIsLoading(true)
    setIsPlaying(false)
    setCurrentTime((previous) =>
      preservedTime > 0.5 ? preservedTime : previous > 0.5 ? previous : 0
    )
    skipPlaybackTimeRef.current =
      preservedTime > 0.5 ? preservedTime : skipPlaybackTimeRef.current > 0.5
        ? skipPlaybackTimeRef.current
        : 0
    if (expectedDurationRef.current >= MIN_TRUSTED_DURATION_SEC) {
      setDuration(expectedDurationRef.current)
    } else {
      setDuration(0)
    }
    clearAutoplayUnmuteSchedule()
    setPendingAutoplayUnmute(false)

    if (isIframeEmbed) {
      // Cross-origin embed (VAPlayer): do not run HLS / <video> pipeline.
      setIsLoading(false)
      setIsPlaying(true)
      playbackReadyRef.current?.({
        currentTime: 0,
        bufferedSeconds: 1,
      })
      return
    }

    const playbackUrlRaw = normalizeCinemacityCdnPlaybackUrl(effectiveSourceUrl)
    const decodedProxyEarly = decodeCineproProxyPayloadFromHref(playbackUrlRaw)
    // Legacy/cached VA rows were createProxyUrl'd — VPS/Worker get CDN 401.
    // Unwrap onto the viewer IP before HLS starts (same as kite/Athena pattern).
    const vaFromProxy =
      !source.directClientPlayback &&
      decodedProxyEarly?.url &&
      isVaplayerViewerCdnHost(decodedProxyEarly.url)
        ? decodedProxyEarly
        : null
    const playbackUrl = normalizeCinemacityCdnPlaybackUrl(
      vaFromProxy?.url || playbackUrlRaw
    )
    const isDirectClientPlayback =
      Boolean(source.directClientPlayback) ||
      Boolean(vaFromProxy) ||
      isVaplayerViewerCdnHost(playbackUrl)
    const directHeaders =
      source.clientPlaybackHeaders ??
      (vaFromProxy?.headers as Record<string, string> | undefined) ??
      {}
    const decodedProxy = isDirectClientPlayback
      ? null
      : decodedProxyEarly
    if (isDirectClientPlayback) {
      // Always replace — empty headers must clear a prior atlantic.st Referer
      // left over from another provider, or zstream shows their Warp card.
      proxyHeadersRef.current = directHeaders
    } else if (decodedProxy?.headers) {
      proxyHeadersRef.current = decodedProxy.headers
    }
    const isVidLinkSource = playbackUrl.includes("/api/vidlink/")
    const isCinemacityCdn = playbackUrl.includes("cccdn.net")
    const cinemacityReferer =
      source.cinemacityPageUrl?.trim() || "https://cinemacity.cc/"
    const isFourKHls = playbackUrl.includes("/api/4k/hls/")
    const isFourKHlsTranscode = isFourKHlsTranscodeUrl(playbackUrl)
    const fourKStartupTimeoutMs = fourKHlsStartupTimeoutMs(playbackUrl)
    const sourceMeta = sources?.find((entry) => entry.id === source.id)
    const providerKey =
      sourceMeta?.providerId?.trim() ||
      sourceMeta?.provider?.trim() ||
      ""
    const defaultMetadataTimeoutMs = isFourKHls
      ? fourKStartupTimeoutMs
      : isVidLinkSource
      ? 20_000
      : getMetadataTimeoutMs() || SOURCE_METADATA_TIMEOUT_MS
    const defaultStartupFailMs = isVidLinkSource
      ? 20_000
      : getFirstPlayTimeoutMs() || STARTUP_PLAYBACK_FAIL_MS
    // Admin per-provider first-play override when set; else global Player timing.
    const sourceLoadTimeoutMs = providerKey
      ? getProviderMetadataTimeoutMs(providerKey, defaultMetadataTimeoutMs)
      : defaultMetadataTimeoutMs
    const startupFailMs = providerKey
      ? getProviderFirstPlayTimeoutMs(providerKey, defaultStartupFailMs)
      : defaultStartupFailMs

    // HollyMovieHD (and similar) serves large progressive MP4s with moov-at-end
    // through /api/cinepro/proxy. Chillflix's default 12s/15s kill switch fires
    // before the browser finishes Range-seeking metadata — Vuflix has no such
    // watchdog, which is why the same stream "works there but not here".
    const isProgressiveProxyMp4 =
      source.type === "file" &&
      (playbackUrl.includes("/api/cinepro/proxy") ||
        playbackUrl.includes("tripplestream") ||
        playbackUrl.includes("pixeldrain"))
    const providerNorm = normalizeProviderName(providerKey)
    const isHollyProvider = providerNorm === "hollymoviehd"
    const isMovieboxProvider = providerNorm === "moviebox"
    // VSEmbed CDN JWTs are VPS IP-bound and always go through /api/cinepro/proxy.
    // Cold proxy + first HLS segment often exceeds the global 12s/15s kill switch
    // on slower titles — same class of false-fail as Holly/MovieBox.
    const isVsembedProvider = providerNorm === "vsembed"
    const isMovyProvider = providerNorm === "movy"
    const isSevenMoviesProvider = providerNorm === "7movies"
    const isAthenaProvider = providerNorm === "athena"
    const isProxiedHls =
      (playbackUrl.includes("/api/cinepro/proxy") ||
        playbackUrl.includes("/v1/proxy")) &&
      (source.type === "hls" || /m3u8/i.test(playbackUrl))
    const needsLongStartup =
      isHollyProvider ||
      isMovieboxProvider ||
      isVsembedProvider ||
      isMovyProvider ||
      isSevenMoviesProvider ||
      isAthenaProvider ||
      isDirectClientPlayback ||
      isProgressiveProxyMp4 ||
      isProxiedHls
    const effectiveSourceLoadTimeoutMs = switchingQuality
      ? Math.max(sourceLoadTimeoutMs, 45_000)
      : needsLongStartup
      ? Math.max(sourceLoadTimeoutMs, isVsembedProvider || isProxiedHls ? 30_000 : 45_000)
      : sourceLoadTimeoutMs
    const effectiveStartupFailMs = needsLongStartup
      ? Math.max(startupFailMs, isVsembedProvider || isProxiedHls ? 45_000 : 60_000)
      : startupFailMs

    sourceTimeoutRef.current = window.setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return
      }

      reportPlaybackError(
        isFourKHlsTranscode
          ? t("player.errors.fourKTranscodeTimedOut")
          : t("player.errors.sourceTimedOut")
      )
    }, effectiveSourceLoadTimeoutMs)

    // Separate from metadata probe: a dead HLS manifest can clear the probe
    // above while the first segment never starts. Give proxied CDNs (VAPlayer)
    // enough time for 429 backoff + first fragment before auto-fallback.
    // Also run on resume/startAt — seek bumps currentTime before any buffer,
    // which previously skipped this watchdog and left a black hanging player.
    if (!isFourKHls) {
      const failColdStartIfStuck = (allowGrace: boolean) => {
        const videoEl = videoRef.current
        if (!videoEl) return
        // Autoplays often fail on mobile — paused waiting for a gesture is NOT
        // a dead source. Rotating here makes every provider look broken.
        if (videoEl.paused) {
          // Mid-resume remount can sit paused at a high currentTime with an
          // empty buffer (No quality options). That is a dead load, not a gesture.
          const neverStarted =
            !hasPlayedOnceRef.current &&
            videoEl.buffered.length === 0 &&
            videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
          if (!neverStarted) return
        }
        // Success = real buffered media near the playhead while playing.
        // Do NOT treat resume seek (currentTime already high, buffer empty) as OK.
        const hasBufferNearPlayhead =
          videoEl.buffered.length > 0 &&
          videoEl.buffered.end(videoEl.buffered.length - 1) >
            Math.max(0, videoEl.currentTime - 1)
        if (
          hasBufferNearPlayhead &&
          videoEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
          !videoEl.paused
        ) {
          return
        }
        // Still downloading / already buffered some media — one grace window.
        if (
          allowGrace &&
          (videoEl.buffered.length > 0 ||
            videoEl.networkState === HTMLMediaElement.NETWORK_LOADING)
        ) {
          startupProgressTimeoutRef.current = window.setTimeout(() => {
            failColdStartIfStuck(false)
          }, 6_000)
          return
        }

        // Videasy/Movy discrete ladders: 1080p can sit at currentTime=0 while the
        // CDN is cold. Step down once (1080→720→480) before failing the provider.
        const ladder = providerQualitiesRef.current
        if (ladder && ladder.length > 1 && qualityStepDownRef.current < 3) {
          const currentUrl = playbackUrlWithoutToken(
            qualityOverrideUrlRef.current || sourcePropsRef.current.url || ""
          )
          const current =
            ladder.find(
              (item) => playbackUrlWithoutToken(item.url) === currentUrl
            ) ||
            ladder.find((item) => item.index === manualQualityRef.current)
          const currentH = current?.height || 1080
          const next = ladder
            .filter((item) => (item.height || 0) > 0 && (item.height || 0) < currentH)
            .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
          if (next?.url) {
            qualityStepDownRef.current += 1
            manualQualityRef.current = next.index
            setCurrentQuality(next.index)
            setQualityOverrideUrl(next.url)
            qualityOverrideUrlRef.current = next.url
            setIsLoading(true)
            setQualityReloadNonce((n) => n + 1)
            startupProgressTimeoutRef.current = window.setTimeout(() => {
              failColdStartIfStuck(true)
            }, 12_000)
            return
          }
        }

        reportPlaybackError(t("player.errors.sourceTimedOut"))
      }

      const discreteLadder =
        (providerQualitiesRef.current?.length ?? 0) > 1 &&
        ["videasy", "movy"].includes(
          normalizeProviderName(
            sources?.find((entry) => entry.id === source.id)?.providerId ||
              sources?.find((entry) => entry.id === source.id)?.provider ||
              ""
          )
        )
      startupProgressTimeoutRef.current = window.setTimeout(() => {
        failColdStartIfStuck(true)
      }, discreteLadder ? Math.min(effectiveStartupFailMs, 12_000) : effectiveStartupFailMs)
    }

    let directFileCancelled = false

    const applyFourKSourceDuration = (seconds: number | undefined) => {
      if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return
      applyExpectedDuration(seconds)
      applyResolvedDuration(
        streamDurationRef.current,
        video.duration,
        video.currentTime,
        true
      )
    }

    if (isFourKHls) {
      const tmdbId = parseTmdbIdFromFourKUrl(playbackUrl)
      if (tmdbId && expectedDurationRef.current < MIN_TRUSTED_DURATION_SEC) {
        void fetch(`/api/movie/${tmdbId}`, { cache: "force-cache" })
          .then((response) => (response.ok ? response.json() : null))
          .then((detail) => {
            const runtime = Number(detail?.runtime)
            if (Number.isFinite(runtime) && runtime > 0) {
              applyFourKSourceDuration(runtime * 60)
            }
          })
          .catch(() => undefined)
      }

      void (async () => {
        try {
          const requestToken =
            resolveRequestToken(playbackUrl) ||
            resolveRequestToken(playbackTokenRef.current ?? "")
          const manifestUrl = resolveProxiedMediaRequestUrl(
            playbackUrl,
            requestToken,
            proxyHeadersRef.current,
            playbackProxyOrigin
          )
          const response = await fetch(manifestUrl, {
            credentials: "omit",
            headers: {
              Referer: window.location.href,
            },
          })
          if (!response.ok) return

          const headerDuration = Number(
            response.headers.get("X-Chillflix-Source-Duration")
          )
          if (Number.isFinite(headerDuration) && headerDuration > 0) {
            applyFourKSourceDuration(headerDuration)
            return
          }

          const manifest = await response.text()
          applyFourKSourceDuration(parseChillflixSourceDurationTag(manifest))
        } catch {
          // ignore — LEVEL_LOADED / metadata will still grow duration
        }
      })()
    }

    // PS5 WebKit will not fullscreen a MediaSource video. Play HLS natively.
    const playstationNativeHls = isPlayStationBrowser() && !isDirectClientPlayback
    if (source.type === "hls" && Hls.isSupported() && !playstationNativeHls) {
      let fatalNetworkRetries = 0
      let manifestLoadRetries = 0
      let fatalMediaRetries = 0
      const DefaultLoader = Hls.DefaultConfig.loader
      const VaNullBridgeLoader =
        isDirectClientPlayback && isVaplayerViewerCdnHost(playbackUrl)
          ? class extends DefaultLoader {
              load(context: any, config: any, callbacks: any) {
                const requestUrl = String(context?.url || "")
                if (!isVaplayerViewerCdnHost(requestUrl)) {
                  return super.load(context, config, callbacks)
                }
                const responseType =
                  context?.responseType === "arraybuffer" ? "arraybuffer" : "text"
                const started = Date.now()
                fetch("/api/debug/va-log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"fetch",url:requestUrl.slice(0,80)})}).catch(()=>{}); fetchVaCdnViaNullBridge(requestUrl, responseType)
                  .then((hit) => { fetch("/api/debug/va-log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"result",ok:hit.ok,status:hit.status,error:hit.error})}).catch(()=>{});
                    if (!hit.ok) {
                      // Bridge miss (CORS/IP): fall back to normal loader so
                      // residential viewers that can hit CDN directly still play.
                      return super.load(context, config, callbacks)
                    }
                    const data =
                      responseType === "text" ? hit.text || "" : hit.data || new ArrayBuffer(0)
                    callbacks.onSuccess(
                      { url: requestUrl, data },
                      { trequest: started, tfirst: started, tload: Date.now() },
                      context,
                      null
                    )
                  })
                  .catch(() => {
                    try {
                      super.load(context, config, callbacks)
                    } catch (err) {
                      callbacks.onError(
                        { code: 0, text: err instanceof Error ? err.message : String(err) },
                        context,
                        null,
                        null
                      )
                    }
                  })
              }
            }
          : DefaultLoader

      const hls = new Hls({
        // Workers break custom fetchSetup/xhrSetup (VAPlayer segment tunnel).
        enableWorker: !isFourKHls && !isDirectClientPlayback,
        loader: VaNullBridgeLoader,
        lowLatencyMode: false,
        startPosition:
          qualityResumeRef.current && qualityResumeRef.current.time > 1
            ? qualityResumeRef.current.time
            : -1,
        ...(isFourKHls ? {} : { audioPreference: { lang: "en" } }),
        // Toflix: only VidLink is capped to the player box. Capping every
        // provider made phones stick at ~720p even when 1080p was in the ladder.
        capLevelToPlayerSize: isVidLinkSource,
        startFragPrefetch: isVidLinkSource,
        manifestLoadingTimeOut: isFourKHls
          ? fourKStartupTimeoutMs
          : isVidLinkSource
          ? 45_000
          : 30_000,
        manifestLoadingMaxRetry: isFourKHls ? 1 : isVidLinkSource ? 0 : 3,
        levelLoadingTimeOut: isFourKHls
          ? fourKStartupTimeoutMs
          : isVidLinkSource
          ? 45_000
          : 30_000,
        levelLoadingMaxRetry: isFourKHls ? 2 : 3,
        fragLoadingTimeOut: isFourKHls
          ? fourKStartupTimeoutMs
          : isVidLinkSource
          ? 45_000
          : 30_000,
        fragLoadingMaxRetry: isFourKHls ? 3 : 3,
        fetchSetup: (context, initParams) => {
          const requestUrl = normalizeCinemacityCdnPlaybackUrl(context.url)

          if (isDirectClientPlayback) {
            // VAPlayer/etc: playlists OK on viewer Origin; segments often 403.
            // Browsers cannot spoof Referer/Origin — tunnel segments via proxy.
            if (shouldTunnelDirectClientSegment(requestUrl)) {
              const requestToken =
                resolveRequestToken(requestUrl) ||
                resolveRequestToken(playbackUrl) ||
                resolveRequestToken(playbackTokenRef.current ?? "")
              const proxied = buildCineproProxyHref(
                playbackProxyOrigin,
                requestUrl,
                directHeaders,
                requestToken
              )
              return { ...initParams, url: proxied }
            }
            // VA CDN: keep the request "simple" (no custom headers) so CORS
            // preflight is skipped. Viewer IP + tokenized URL is the auth.
            // Drop hls.js Accept (application/vnd.apple.mpegurl) — that alone
            // triggers OPTIONS and kills playback on chillflix origins.
            if (isVaplayerViewerCdnHost(requestUrl)) {
              return { ...initParams, url: requestUrl, headers: new Headers() }
            }
            const headers = new Headers(initParams.headers)
            for (const [key, value] of Object.entries(directHeaders)) {
              const lower = key.toLowerCase()
              if (lower === "cookie") continue
              // Forbidden request headers — setting them is a no-op / throws.
              if (
                lower === "referer" ||
                lower === "origin" ||
                lower === "user-agent"
              ) {
                continue
              }
              headers.set(key, value)
            }
            const directSetup = {
              ...initParams,
              url: requestUrl,
              headers,
            }
            if (requestUrl.includes("cccdn.net")) {
              return {
                ...directSetup,
                referrer: cinemacityReferer,
                referrerPolicy: "unsafe-url" as ReferrerPolicy,
              }
            }
            return directSetup
          }

          const requestToken =
            resolveRequestToken(requestUrl) || resolveRequestToken(playbackUrl)
          const resolvedUrl = resolveProxiedMediaRequestUrl(
            requestUrl,
            requestToken,
            proxyHeadersRef.current,
            playbackProxyOrigin
          )

          if (requestUrl.includes("cccdn.net")) {
            return {
              ...initParams,
              url: resolvedUrl,
              referrer: cinemacityReferer,
              referrerPolicy: "unsafe-url",
            }
          }

          if (resolvedUrl !== context.url) {
            return { ...initParams, url: resolvedUrl }
          }

          return initParams
        },
        xhrSetup: (xhr, url) => {
          const requestUrl = normalizeCinemacityCdnPlaybackUrl(url)

          if (isDirectClientPlayback) {
            if (shouldTunnelDirectClientSegment(requestUrl)) {
              const requestToken =
                resolveRequestToken(requestUrl) ||
                resolveRequestToken(playbackUrl) ||
                resolveRequestToken(playbackTokenRef.current ?? "")
              const proxied = buildCineproProxyHref(
                playbackProxyOrigin,
                requestUrl,
                directHeaders,
                requestToken
              )
              xhr.open("GET", proxied, true)
              return
            }
            xhr.open("GET", requestUrl, true)
            if (isVaplayerViewerCdnHost(requestUrl)) {
              return
            }
            for (const [key, value] of Object.entries(directHeaders)) {
              const lower = key.toLowerCase()
              if (
                lower === "referer" ||
                lower === "origin" ||
                lower === "cookie" ||
                lower === "user-agent"
              ) {
                continue
              }
              try {
                xhr.setRequestHeader(key, value)
              } catch {
                /* forbidden header */
              }
            }
            return
          }

          const requestToken =
            resolveRequestToken(requestUrl) || resolveRequestToken(playbackUrl)
          const resolvedUrl = resolveProxiedMediaRequestUrl(
            requestUrl,
            requestToken,
            proxyHeadersRef.current,
            playbackProxyOrigin
          )

          if (resolvedUrl !== url) {
            xhr.open("GET", resolvedUrl, true)
            return
          }

          if (requestUrl.includes("cccdn.net")) {
            return
          }
        },
      })

      const manifestToken =
        resolveRequestToken(playbackUrl) ||
        resolveRequestToken(playbackTokenRef.current ?? "")
      const manifestPlaybackUrl = isDirectClientPlayback
        ? playbackUrl
        : resolveProxiedMediaRequestUrl(
            playbackUrl,
            manifestToken,
            proxyHeadersRef.current,
            playbackProxyOrigin
          )
      hls.loadSource(manifestPlaybackUrl)
      hls.attachMedia(video)
      hlsRef.current = hls

      const acceptStreamDuration = (seconds: number) =>
        Number.isFinite(seconds) &&
        seconds >= MIN_TRUSTED_DURATION_SEC &&
        seconds !== Infinity

      hls.on(Hls.Events.MEDIA_ENDED, () => {
        if (video.currentTime >= MIN_PLAYBACK_BEFORE_END_CHECK_SEC) {
          notifyPlaybackEndedRef.current()
        }
      })

      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        if (manifestLoadRetries > 0) manifestLoadRetries = Math.max(0, manifestLoadRetries - 2)
        const total = data.details?.totalduration ?? 0
        if (typeof total === "number" && acceptStreamDuration(total)) {
          streamDurationRef.current = total
        }

        applyResolvedDuration(
          typeof total === "number" ? total : streamDurationRef.current,
          video.duration,
          video.currentTime,
          isFourKHls
        )

        // Movy/Videasy: if we are still on a 4K rung without an explicit user
        // 4K pick, snap down to Full HD once heights are known.
        try {
          const meta = sources?.find((entry) => entry.id === source.id)
          const pKey = resolveSourceProviderKey(meta)
            .trim()
            .toLowerCase()
          const hasRealFourKLevel = hls.levels.some(
            (level) => effectiveHlsLevelHeight(level || {}) >= 2160
          )
          // Rive ABR: 1080p rung is often flaky while 2160 plays; don't snap down.
          const wantFourK =
            isFourKHls ||
            pKey === "cinejoy" ||
            pKey === "4khdhub" ||
            (pKey === "rivestream" && hasRealFourKLevel)
          if (!wantFourK && hls.levels.length > 1) {
            const manual = manualQualityRef.current
            const cur = typeof hls.currentLevel === "number" ? hls.currentLevel : -1
            const curH =
              cur >= 0 ? effectiveHlsLevelHeight(hls.levels[cur] || {}) : 0
            const manualIsExplicitFourK =
              manual !== null &&
              manual >= 0 &&
              effectiveHlsLevelHeight(hls.levels[manual] || {}) >= 2160
            if (curH >= 2160 && !manualIsExplicitFourK) {
              const playable = hls.levels
                .map((level, index) => ({ level, index }))
                .filter(({ level }) => !isHevcHlsLevel(level))
              const pool =
                playable.length > 0
                  ? playable
                  : hls.levels.map((level, index) => ({ level, index }))
              const fullHd =
                pool.find(({ level }) => effectiveHlsLevelHeight(level) === 1080) ||
                pool
                  .filter(({ level }) => {
                    const h = effectiveHlsLevelHeight(level)
                    return h > 0 && h <= 1080
                  })
                  .sort(
                    (a, b) =>
                      effectiveHlsLevelHeight(b.level) -
                      effectiveHlsLevelHeight(a.level)
                  )[0]
              if (fullHd) {
                hls.currentLevel = fullHd.index
                hls.nextLevel = fullHd.index
                hls.loadLevel = fullHd.index
                manualQualityRef.current = fullHd.index
                setCurrentQuality(fullHd.index)
              }
            }
          }
        } catch {
          // ignore
        }
      })

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (sourceTimeoutRef.current) {
          window.clearTimeout(sourceTimeoutRef.current)
          sourceTimeoutRef.current = null
        }

        // Mobile Chrome MSE often strips every HEVC (hvc1) rung — levels end up
        // empty while the manifest "succeeded". Fail fast so recovery can move
        // to an MP4 / H.264 source instead of hanging on a black player.
        if (hls.levels.length === 0) {
          reportPlaybackError(
            "No playable video formats in this stream (often HEVC-only on mobile)."
          )
          return
        }

        // Default start: Full HD for Movy/Videasy (and most providers). Only
        // explicit 4K providers (cinejoy / 4khdhub) start on 2160 when playable.
        {
          const meta = sources?.find((entry) => entry.id === source.id)
          const pKey = resolveSourceProviderKey(meta)
            .trim()
            .toLowerCase()
          const hasRealFourKLevel = hls.levels.some(
            (level) => effectiveHlsLevelHeight(level || {}) >= 2160
          )
          // Rive ABR: 1080p often stalls while 2160 plays — keep 4K when present.
          const wantFourK =
            isFourKHls ||
            pKey === "cinejoy" ||
            pKey === "4khdhub" ||
            (pKey === "rivestream" && hasRealFourKLevel)
          // Cap Movy/Videasy (and everyone else) at 1080 unless wantFourK.
          const preferFullHd = !wantFourK
          if (hls.levels.length > 1) {
            let bestIndex = -1
            let bestHeight = -1
            let bestBandwidth = -1
            // Prefer playable rungs. Cinejoy 4K is often HEVC/HDR (hvc1) which
            // mobile Chrome MSE strips — forcing it caused 4K↔Auto flicker.
            const playable = hls.levels
              .map((level, index) => ({ level, index }))
              .filter(({ level }) => !isHevcHlsLevel(level))
            const pool = playable.length > 0 ? playable : hls.levels.map((level, index) => ({ level, index }))
            const cappedPool = preferFullHd
              ? pool.filter(({ level }) => {
                  const h = effectiveHlsLevelHeight(level)
                  return h > 0 && h <= 1080
                })
              : pool
            // When heights are unknown, do NOT fall back to the full pool —
            // max bandwidth is almost always the 4K rung on Movy masters.
            const pickPool = cappedPool.length > 0 ? cappedPool : preferFullHd ? [] : pool
            pickPool.forEach(({ level, index }) => {
              const height = effectiveHlsLevelHeight(level)
              const bandwidth = level.bitrate || 0
              if (height > bestHeight || (height === bestHeight && bandwidth > bestBandwidth)) {
                bestHeight = height
                bestBandwidth = bandwidth
                bestIndex = index
              }
            })
            // Heights unknown (Movy NAME-only): pick a mid/lower rung by bandwidth,
            // never the top (4K) tier.
            if (bestIndex < 0 || bestHeight <= 0) {
              const byBw = [...pool].sort(
                (a, b) => (a.level.bitrate || 0) - (b.level.bitrate || 0)
              )
              if (preferFullHd && byBw.length >= 2) {
                const idx = Math.min(
                  byBw.length - 2,
                  Math.max(0, Math.floor(byBw.length * 0.55))
                )
                bestIndex = byBw[idx]!.index
                bestBandwidth = byBw[idx]!.level.bitrate || 0
              } else {
                pickPool.forEach(({ level, index }) => {
                  const bandwidth = level.bitrate || 0
                  if (bandwidth > bestBandwidth) {
                    bestBandwidth = bandwidth
                    bestIndex = index
                  }
                })
              }
            }
            if (wantFourK) {
              // Only lock onto 4K when it is actually playable (non-HEVC) in MSE.
              const fourKLevel = pool.find(
                ({ level }) => effectiveHlsLevelHeight(level) >= 2160
              )?.index
              if (typeof fourKLevel === "number" && fourKLevel >= 0) {
                bestIndex = fourKLevel
              }
            } else if (preferFullHd) {
              // Prefer exact 1080 when present.
              const fullHd = pickPool.find(
                ({ level }) => effectiveHlsLevelHeight(level) === 1080
              )?.index
              if (typeof fullHd === "number" && fullHd >= 0) {
                bestIndex = fullHd
              }
              // VAPlayer ultrawide ladders (e.g. 640x266 / 1280x534 / 1920x800)
              // never hit height===1080. Prefer the mid rung so mobile MSE can
              // paint video (top rung often audio-only black until quality drop).
              const heights = pickPool.map(({ level }) => effectiveHlsLevelHeight(level))
              const maxH = Math.max(0, ...heights)
              if (maxH > 0 && maxH < 1000 && pickPool.length >= 2) {
                const sorted = [...pickPool].sort(
                  (a, b) =>
                    effectiveHlsLevelHeight(a.level) - effectiveHlsLevelHeight(b.level)
                )
                const mid = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 2))]
                if (mid) bestIndex = mid.index
              }
            }
            if (bestIndex >= 0) {
              hls.startLevel = bestIndex
              hls.currentLevel = bestIndex
              try {
                hls.nextLevel = bestIndex
                hls.loadLevel = bestIndex
              } catch {
                // ignore
              }
              // Lock badge to the start rung so LEVEL_SWITCHED / ABR cannot
              // climb back to 4K and flip the Quality sheet.
              if (manualQualityRef.current === null) {
                manualQualityRef.current = bestIndex
                setCurrentQuality(bestIndex)
              }
            }
          }
        }

        const providerLadder = providerQualitiesRef.current
        // Ignore Auto/Mirror placeholders (height 0) — those must not own the
        // Quality tab over a real HLS adaptive ladder (VAPlayer).
        const keepProviderLadder = Boolean(
          providerLadder &&
            providerLadder.filter((item) => (item.height || 0) > 0).length > 1
        )

        // Adaptive masters own the Quality tab unless discrete provider
        // variants (Videasy URL-per-rung) already populate it.
        if (hls.levels.length > 1 && !keepProviderLadder) {
          hlsLadderMenuRef.current = true
          const metaForLadder = sources?.find((entry) => entry.id === source.id)
          const providerKeyForLadder = resolveSourceProviderKey(metaForLadder)
          let levels = capAthenaQualities(
            hls.levels.flatMap((level, index) => {
              const row = describeHlsQualityLevel(level, index)
              if (!row) return []
              if (providerKeyForLadder === "cno") {
                const h = cnoEffectiveHeight(level, playbackUrl, String(metaForLadder?.quality || ""))
                return [{ ...row, height: h, label: h >= 2160 ? "4K" : `${h}p` }]
              }
              return [row]
            }),
            providerKeyForLadder,
            playbackUrl
          )
          // If Athena ABR still has a 4K rung in the live hls.js ladder, pin below it.
          if (shouldCapAthenaHdOnly(providerKeyForLadder, playbackUrl) && hls.levels.some((l) => (l.height || 0) >= 2160)) {
            try {
              const hd = hls.levels
                .map((l, i) => ({ h: l.height || 0, i }))
                .filter((x) => x.h > 0 && x.h < 2160)
                .sort((a, b) => b.h - a.h)[0]
              if (hd) {
                hls.autoLevelEnabled = false
                hls.currentLevel = hd.i
                hls.nextLevel = hd.i
                manualQualityRef.current = hd.i
              }
            } catch {
              // ignore
            }
          }
          const manual = manualQualityRef.current
          if (manual !== null && manual >= 0 && levels.some((level) => level.index === manual)) {
            try {
              hls.nextLevel = manual
            } catch {
              // ignore
            }
            setQualities(levels)
            setCurrentQuality(manual)
          } else if (manual !== null && manual < 0) {
            try {
              hls.nextLevel = -1
            } catch {
              // ignore
            }
            setQualities(levels)
            setCurrentQuality(-1)
          } else {
            setQualities(levels)
            {
              const fourK = levels.find((l) => (l.height || 0) >= 2160 && l.index >= 0)
              const fullHd = levels.find((l) => (l.height || 0) === 1080 && l.index >= 0)
              const underHd = levels
                .filter((l) => (l.height || 0) > 0 && (l.height || 0) <= 1080 && l.index >= 0)
                .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
              const highest = levels.reduce<(typeof levels)[number] | null>((best, row) => {
                if (!best || (row.height || 0) > (best.height || 0)) return row
                return best
              }, null)
              const preferRiveFourK =
                providerKeyForLadder === "rivestream" && !!fourK
              const pick =
                (isFourKHls || preferRiveFourK) && fourK
                  ? fourK.index
                  : fullHd
                    ? fullHd.index
                    : underHd
                      ? underHd.index
                      : highest
                        ? highest.index
                        : hls.currentLevel
              manualQualityRef.current = typeof pick === "number" ? pick : null
              setCurrentQuality(pick)
            }
          }
        } else if (keepProviderLadder) {
          hlsLadderMenuRef.current = false
          setQualities(
            providerLadder!.map((item) => ({
              index: item.index,
              height: item.height,
              label: item.label,
              url: item.url,
            }))
          )
          if (manualQualityRef.current === null) {
            const metaQ = sources?.find((entry) => entry.id === source.id)
            const pKey = resolveSourceProviderKey(metaQ)
              .trim()
              .toLowerCase()
            const preferredHeight = qualityHeight(String(metaQ?.quality || ""))
            // Movy/Videasy (and non-4K providers): always start Full HD, not 4K.
            const forceFullHd =
              pKey === "movy" ||
              pKey === "videasy" ||
              (preferredHeight >= 2160 && pKey !== "cinejoy" && pKey !== "4khdhub")
            const match =
              (forceFullHd
                ? providerLadder!.find((item) => item.height === 1080)
                : null) ||
              (!forceFullHd
                ? providerLadder!.find((item) => item.height === preferredHeight)
                : null) ||
              providerLadder!.find((item) => item.height === 1080) ||
              providerLadder!.filter((item) => (item.height || 0) > 0 && (item.height || 0) <= 1080).sort(
                (a, b) => (b.height || 0) - (a.height || 0)
              )[0] ||
              providerLadder![0]
            if (match) {
              manualQualityRef.current = match.index
              setCurrentQuality(match.index)
              if (match.url) {
                setQualityOverrideUrl(match.url)
                qualityOverrideUrlRef.current = match.url
              }
            }
          }
        } else if (!providerQualitiesRef.current || providerQualitiesRef.current.length <= 1) {
          hlsLadderMenuRef.current = false
          let levels = hls.levels.flatMap((level, index) => {
            const row = describeHlsQualityLevel(level, index)
            return row ? [row] : []
          })

          // If the source is a 4K provider / tagged 4K but MSE stripped the HEVC
          // rung, still expose a 4K row so the quality sheet matches the server.
          const sourceMetaForQuality = sources?.find((entry) => entry.id === source.id)
          const providerKeyForQuality = resolveSourceProviderKey(sourceMetaForQuality)
          if (providerKeyForQuality === "cno") {
            levels = levels.map((row, index) => {
              const h = cnoEffectiveHeight(
                hls.levels[index] || {},
                playbackUrl,
                String(sourceMetaForQuality?.quality || "")
              )
              return { ...row, height: h, label: h >= 2160 ? "4K" : `${h}p` }
            })
          }
          const qualityTag = String(sourceMetaForQuality?.quality || "").toLowerCase()
          // Only invent a synthetic 4K row for remux/transcode 4K HLS — not for
          // cinejoy masters where MSE dropped an HEVC 4K rung (would flicker).
          const isFourKProvider =
            isFourKHls ||
            providerKeyForQuality === "4khdhub" ||
            /4\s*k|2160|uhd/.test(qualityTag)
          levels = capAthenaQualities(levels, providerKeyForQuality, playbackUrl)
          if (
            !shouldCapAthenaHdOnly(providerKeyForQuality, playbackUrl) &&
            isFourKProvider &&
            providerKeyForQuality !== "cinejoy" &&
            !levels.some((level) => (level.height || 0) >= 2160)
          ) {
            levels.unshift({ index: -2160, height: 2160, label: "4K" })
          }

          setQualities(levels)
          setCurrentQuality(
            isFourKHls && levels.some((l) => (l.height || 0) >= 2160 && l.index >= 0)
              ? levels.find((l) => (l.height || 0) >= 2160 && l.index >= 0)?.index ??
                (hls.autoLevelEnabled ? -1 : hls.currentLevel)
              : hls.autoLevelEnabled
                ? -1
                : hls.currentLevel
          )
        } else {
          hlsLadderMenuRef.current = false
        }

        const providerAudio = audioTracksRef.current ?? EMPTY_AUDIO_TRACKS
        const hasUrlAudioTracks = providerAudio.some((track) =>
          Boolean(track.url?.trim())
        )
        if (hasUrlAudioTracks) {
          const safeTracks = ensureAudioTracks(providerAudio)
          setAvailableAudioTracks(safeTracks)
          if (!userPickedAudioTrackRef.current) {
            setSelectedAudioTrackId(
              pickPreferredAudioTrackFromList(safeTracks) ?? safeTracks[0]?.id
            )
          }
        } else {
          const tracks = hls.audioTracks.map((track, index) => ({
            id: String(index),
            label: trackLabel(index, track.name, track.lang),
          }))
          const safeTracks = ensureAudioTracks(tracks)
          setAvailableAudioTracks(safeTracks)
          if (hls.audioTrack >= 0) {
            setSelectedAudioTrackId(String(hls.audioTrack))
          }
        }

        setIsLoading(false)
        const qualityResume = qualityResumeRef.current
        if (qualityResume?.playing && video.paused) {
          void video.play().catch(() => {
            void tryAutoplayRef.current?.()
          })
        } else {
          void tryAutoplayRef.current?.()
        }
      })

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        const providerAudio = audioTracksRef.current ?? EMPTY_AUDIO_TRACKS
        const hasUrlAudioTracks = providerAudio.some((track) =>
          Boolean(track.url?.trim())
        )
        if (hasUrlAudioTracks) {
          const safeTracks = ensureAudioTracks(providerAudio)
          setAvailableAudioTracks(safeTracks)
          if (!audioTracksReadyForSourceRef.current) {
            audioTracksReadyForSourceRef.current = true
            if (!userPickedAudioTrackRef.current) {
              setSelectedAudioTrackId(
                pickPreferredAudioTrackFromList(safeTracks) ??
                  safeTracks[0]?.id
              )
            }
          }
          return
        }

        const tracks = (data.audioTracks ?? []).map((track, index) => ({
          id: String(index),
          label: trackLabel(index, track.name, track.lang),
        }))
        const safeTracks = ensureAudioTracks(tracks)
        setAvailableAudioTracks(safeTracks)

        if (userPickedAudioTrackRef.current) {
          setSelectedAudioTrackId((current) => {
            if (current && safeTracks.some((track) => track.id === current)) {
              return current
            }
            return pickPreferredHlsAudioTrackId(hls, safeTracks)
          })
          return
        }

        if (!audioTracksReadyForSourceRef.current) {
          audioTracksReadyForSourceRef.current = true
          const preferred = pickPreferredHlsAudioTrackId(hls, safeTracks)
          setSelectedAudioTrackId(preferred)
          const preferredIndex = Number(preferred)
          if (
            Number.isFinite(preferredIndex) &&
            preferredIndex >= 0 &&
            hls.audioTrack !== preferredIndex
          ) {
            hls.audioTrack = preferredIndex
          }
          return
        }

        setSelectedAudioTrackId((current) => {
          if (current && safeTracks.some((track) => track.id === current)) {
            return current
          }
          return pickPreferredHlsAudioTrackId(hls, safeTracks)
        })
      })

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (typeof data.id === "number") {
          setSelectedAudioTrackId(String(data.id))
        }
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        // Separate video files own the Quality tab. The in-stream ladder does not.
        if (
          !hlsLadderMenuRef.current &&
          providerQualitiesRef.current &&
          providerQualitiesRef.current.length > 1
        ) {
          return
        }
        const manual = manualQualityRef.current
        if (manual === null) {
          setCurrentQuality(data.level)
          return
        }
        if (manual < 0) {
          setCurrentQuality(-1)
          return
        }
        setCurrentQuality(manual)
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        const httpCode = data.response?.code
        const isProxyPlaybackUrl =
          playbackUrl.includes("/api/cinepro/proxy") ||
          playbackUrl.includes("/api/flixhq/proxy")
        const isSegmentLoadError =
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR

        const needsProxyRefetch =
          isProxyRefetchHttpStatus(httpCode) &&
          isProxyPlaybackUrl &&
          isSegmentLoadError

        if (needsProxyRefetch && onRefetchSourcesRef.current) {
          const now = Date.now()
          if (now - proxyRecoveryAtRef.current > 45_000) {
            proxyRecoveryAtRef.current = now
            activeStreamBaseRef.current = ""
            setProxyRecoveryResumeTime(
              Math.max(
                0,
                video.currentTime || 0,
                skipPlaybackTimeRef.current || 0
              )
            )
            try {
              const pk = resolveSourceProviderKey(source).trim().toLowerCase()
              markCachedProviderDead(pk, {
                type: sourceMeta?.type,
                tmdbId: sourceMeta?.tmdbId,
                season: sourceMeta?.season,
                episode: sourceMeta?.episode,
              })
            } catch {}
            onRefetchSourcesRef.current()
            return
          }
        }

        const isTransientProxyError =
          isTransientProxyHttpStatus(httpCode) &&
          isProxyPlaybackUrl &&
          isSegmentLoadError

        if (isTransientProxyError) {
          if (
            video.paused ||
            video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
          ) {
            setIsLoading(true)
          }
          const resumeAt = Math.max(
            video.currentTime || 0,
            skipPlaybackTimeRef.current || 0
          )
          if (resumeAt > 0.5) {
            setCurrentTime(resumeAt)
          }
          if (fatalNetworkRetries < 8) {
            fatalNetworkRetries += 1
            window.setTimeout(() => {
              hls.startLoad(resumeAt > 0.5 ? resumeAt : -1)
            }, Math.min(4000, 400 * fatalNetworkRetries))
            return
          }
        }

        const isUnavailableResponse =
          typeof httpCode === "number" &&
          httpCode >= 400 &&
          (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR)

        // Cloudflare often returns empty 400 (and sometimes 427) on the SAME
        // Movy/VAPlayer URL that succeeds on the next hit. Soft-retry first —
        // including FRAG_LOAD_ERROR — before removeLevel / fatal remount.
        const isCfTransientProxyBlip =
          isUnavailableResponse &&
          isProxyPlaybackUrl &&
          (httpCode === 400 || httpCode === 427 || httpCode === 502) &&
          (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR)
        if (isCfTransientProxyBlip) {
          manifestLoadRetries += 1
          // Mid-play CF blips: keep the picture up — only spin the cold-start UI
          // before the first frame. setIsLoading(true) here was flashing
          // "Starting playback…" for every empty 400.
          if (!hasPlayedOnceRef.current && (video.currentTime || 0) < 0.5) {
            setIsLoading(true)
          }
          const resumeAt = Math.max(
            video.currentTime || 0,
            skipPlaybackTimeRef.current || 0
          )
          // Soft-retry CF empty-400/427 a bounded number of times. Unbounded
          // startLoad left a black player (No quality options) until the user
          // manually re-clicked the source to remount. Cap then escalate to a
          // recoverable parent remount — do NOT removeLevel (that deleted
          // VAPlayer 1080p/720p rungs on Brand New Day).
          // Mid-play: keep soft-retrying in place. Escalating to parent remount
          // every ~10 CF blips reloaded the whole player ("Starting playback…").
          const CF_SOFT_RETRY_CAP = 40
          if (manifestLoadRetries > CF_SOFT_RETRY_CAP) {
            // Only escalate when we never painted — mid-play keep trying quietly.
            if (!hasPlayedOnceRef.current && (video.currentTime || 0) < 0.5) {
              reportPlaybackError("Stream unavailable. Reconnecting…")
              return
            }
            manifestLoadRetries = Math.max(0, CF_SOFT_RETRY_CAP - 8)
          }
          window.setTimeout(() => {
            try {
              hls.startLoad(resumeAt > 0.5 ? resumeAt : -1)
            } catch {
              /* ignore */
            }
          }, Math.min(2500, 150 * Math.min(manifestLoadRetries, 10)))
          return
        }

        // After retries, drop a persistently-bad ladder rung and keep playing.
        // Do NOT drop on CF empty 400/427 — those often succeed on the next hit.
        // Dropping them left VAPlayer (Brand New Day) stuck on a lone 360p rung
        // while 1080p/720p were still in the master.
        const canDropBadLevel =
          isUnavailableResponse &&
          hls.levels.length > 1 &&
          (data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR) &&
          (httpCode === 403 || httpCode === 404 || httpCode === 502) &&
          !(isProxyPlaybackUrl && (httpCode === 400 || httpCode === 427))
        if (canDropBadLevel) {
          try {
            const failed =
              typeof data.level === "number" && data.level >= 0
                ? data.level
                : hls.currentLevel >= 0
                  ? hls.currentLevel
                  : hls.loadLevel
            if (typeof failed === "number" && failed >= 0 && failed < hls.levels.length) {
              hls.removeLevel(failed)
              const next = Math.min(failed, Math.max(0, hls.levels.length - 1))
              if (hls.levels.length > 0) {
                hls.currentLevel = next
                hls.loadLevel = next
                hls.startLoad()
                if (!hasPlayedOnceRef.current && (video.currentTime || 0) < 0.5) {
                  setIsLoading(true)
                }
                return
              }
            }
          } catch {
            /* fall through to hard error */
          }
        }

        if (isUnavailableResponse) {
          // CF empty 400/427 mid-play: soft-retry briefly, then escalate so the
          // parent remounts/refetches instead of staying black forever.
          if (
            isProxyPlaybackUrl &&
            (httpCode === 400 || httpCode === 427) &&
            (hasPlayedOnceRef.current || (video.currentTime || 0) > 0.5)
          ) {
            // Keep soft-retrying mid-play — remount here caused "Starting playback…".
            manifestLoadRetries += 1
            if (manifestLoadRetries > 40) {
              manifestLoadRetries = 20
            }
            const resumeAt = Math.max(
              video.currentTime || 0,
              skipPlaybackTimeRef.current || 0
            )
            window.setTimeout(() => {
              try {
                hls.startLoad(resumeAt > 0.5 ? resumeAt : -1)
              } catch {
                /* ignore */
              }
            }, Math.min(2000, 200 * Math.min(manifestLoadRetries, 8)))
            return
          }
          const fourKHint =
            isFourKHls && httpCode === 503
              ? isFourKHlsTranscode
                ? " 2160p needs server transcode (disabled or busy). Try 1080p or wait a minute."
                : " 4K remux is disabled on the server."
              : isFourKHls && httpCode === 502
              ? " 4K transcode failed to start — try 1080p or retry."
              : ""
          // Never label CF empty-400 as "stream relay expired" — that matched
          // isProxyTokenPlaybackError and remount-looped Movy/VAPlayer.
          const cinemacityHint =
            isCinemacityCdn && httpCode === 403
              ? " Cinemacity CDN blocked the server relay — set CINEMACITY_CCCDN_PROXY on the VPS (residential HTTP proxy), then refresh sources."
              : playbackUrl.includes("/api/cinepro/proxy") && httpCode === 403
              ? " Playback proxy was denied — refresh sources or check CINEMACITY_CCCDN_PROXY on the server."
              : playbackUrl.includes("/api/cinepro/proxy") && httpCode === 404
              ? " Stream relay expired — refreshing sources."
              : playbackUrl.includes("/api/flixhq/proxy") && httpCode === 404
              ? " Stream relay expired — refreshing sources."
              : ""
          reportPlaybackError(
            `Stream unavailable (${httpCode}).${fourKHint}${cinemacityHint}`
          )
          return
        }

        if (!data.fatal) return

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (fatalNetworkRetries < 5) {
            fatalNetworkRetries += 1
            setIsLoading(true)
            const resumeAt = Math.max(video.currentTime, skipPlaybackTimeRef.current)
            if (resumeAt > 0.5) {
              hls.startLoad(resumeAt)
            } else {
              hls.startLoad()
            }
            return
          }

          reportPlaybackError(t("player.errors.hlsNetwork"))
          return
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (fatalMediaRetries < 4) {
            fatalMediaRetries += 1
            setIsLoading(true)
            hls.recoverMediaError()
            return
          }

          reportPlaybackError(t("player.errors.hlsMedia"))
          return
        }

        reportPlaybackError(`HLS fatal error: ${data.type}`)
      })
    } else {
      const fileAudioTracks = ensureAudioTracks(
        audioTracksRef.current ?? EMPTY_AUDIO_TRACKS
      )
      if (!providerQualitiesRef.current || providerQualitiesRef.current.length <= 1) {
        setQualities([])
        setCurrentQuality(-1)
      }
      setAvailableAudioTracks(fileAudioTracks)
      setSelectedAudioTrackId(
        pickPreferredAudioTrackFromList(fileAudioTracks) ??
          fileAudioTracks[0]?.id
      )

      const requestToken =
        resolveRequestToken(playbackUrl) ||
        resolveRequestToken(playbackTokenRef.current ?? "")
      const filePlaybackUrl = isDirectClientPlayback
        ? playbackUrl
        : resolveProxiedMediaRequestUrl(
            playbackUrl,
            requestToken,
            proxyHeadersRef.current,
            playbackProxyOrigin
          )

      if (isDirectClientPlayback) {
        video.src = filePlaybackUrl

        const onDirectError = () => {
          if (directFileCancelled) return

          void (async () => {
            try {
              const response = await fetch(filePlaybackUrl, {
                headers: directHeaders,
                credentials: "omit",
              })
              if (!response.ok) {
                reportPlaybackError(`Stream unavailable (${response.status}).`)
                return
              }

              const blob = await response.blob()
              if (directFileCancelled) return
              video.src = URL.createObjectURL(blob)
            } catch {
              if (!directFileCancelled) {
                reportPlaybackError(t("player.errors.sourceTimedOut"))
              }
            }
          })()
        }

        video.addEventListener("error", onDirectError, { once: true })
      } else {
        // Must stamp pt= — native <video src> cannot send playback-token headers.
        video.src = filePlaybackUrl
      }
    }

    return () => {
      directFileCancelled = true

      if (sourceTimeoutRef.current) {
        window.clearTimeout(sourceTimeoutRef.current)
        sourceTimeoutRef.current = null
      }
      if (startupProgressTimeoutRef.current) {
        window.clearTimeout(startupProgressTimeoutRef.current)
        startupProgressTimeoutRef.current = null
      }

      const next = sourcePropsRef.current
      const nextKey = `${next.id}|${next.type}`
      // Keep the pipeline across parent re-renders / token refreshes / URL
      // rewrite churn for the same source.id. Effect body tears down HLS when
      // it intentionally remounts (qualityResume / real source change).
      if (nextKey === sourceKey) {
        return
      }

      if (hlsRef.current) {
        const hls = hlsRef.current
        hlsRef.current = null
        try {
          hls.stopLoad()
          hls.detachMedia()
          hls.destroy()
        } catch {
          // ignore teardown races during source swap
        }
      }

      if (activeSourceKeyRef.current === sourceKey) {
        activeSourceKeyRef.current = null
        activeStreamBaseRef.current = ""
      }
    }
  }, [
    clearAutoplayUnmuteSchedule,
    ensureAudioTracks,
    source.clientPlaybackHeaders,
    source.directClientPlayback,
    source.id,
    source.type,
    source.url,
    sources,
    playbackToken,
    qualityReloadNonce,
    t,
    trackLabel,
    applyResolvedDuration,
    applyExpectedDuration,
    watchMeta?.runtimeMinutes,
  ])

  useWatchProgressSaver(
    watchMeta,
    videoRef,
    `${source.id}:s${watchMeta?.season ?? 0}:e${watchMeta?.episode ?? 0}`,
    nextTvEpisodeOnComplete
  )

  useEmbedPlayerBridge({
    enabled: embedReportingEnabled,
    watchMeta,
    mediaType: embedMediaType ?? watchMeta?.type ?? "movie",
    season: embedSeason ?? watchMeta?.season,
    episode: embedEpisode ?? watchMeta?.episode,
    videoRef,
  })

  usePlayerAnalytics({
    enabled: Boolean(watchMeta?.id),
    embedMode: embedReportingEnabled,
    mediaType: embedMediaType ?? watchMeta?.type ?? "movie",
    mediaId: watchMeta?.id ?? 0,
    season: embedSeason ?? watchMeta?.season,
    episode: embedEpisode ?? watchMeta?.episode,
    videoRef,
  })

  useEffect(() => {
    if (watchPartyGuest) return
    if (!forceAutoplay && !autoplayEnabled && !embedReportingEnabled) return
    void tryAutoplay()
  }, [autoplayEnabled, embedReportingEnabled, forceAutoplay, watchPartyGuest, tryAutoplay])

  useEffect(() => {
    if (selectedAudioTrackId === undefined) return

    const selected = availableAudioTracks.find(
      (track) => track.id === selectedAudioTrackId
    )
    if (selected?.url?.trim()) {
      const nextUrl = selected.url.trim()
      const current =
        qualityOverrideUrlRef.current?.trim() || source.url
      if (playbackUrlWithoutToken(current) !== playbackUrlWithoutToken(nextUrl)) {
        qualityOverrideUrlRef.current = nextUrl
        setQualityOverrideUrl(nextUrl)
        setQualityReloadNonce((value) => value + 1)
      }
      return
    }

    const hls = hlsRef.current
    if (!hls) return

    const nextTrack = Number(selectedAudioTrackId)
    if (!Number.isFinite(nextTrack) || nextTrack < 0) return
    if (hls.audioTracks.length === 0 || nextTrack >= hls.audioTracks.length)
      return
    if (hls.audioTrack !== nextTrack) {
      hls.audioTrack = nextTrack
    }
  }, [availableAudioTracks, selectedAudioTrackId, source.url])

  useEffect(() => {
    if (!selectedSubtitleId) return
    if (effectiveSubtitles.length === 0) return
    if (!effectiveSubtitles.some((subtitle) => subtitle.id === selectedSubtitleId)) {
      setSelectedSubtitleId(undefined)
    }
  }, [selectedSubtitleId, effectiveSubtitles])

  const appliedSubtitlePrefRef = useRef(false)
  const subtitlesKeyRef = useRef("")

  useEffect(() => {
    const subtitlesKey = effectiveSubtitles.map((subtitle) => subtitle.id).join("|")
    if (subtitlesKey !== subtitlesKeyRef.current) {
      subtitlesKeyRef.current = subtitlesKey
      appliedSubtitlePrefRef.current = false
    }

    if (appliedSubtitlePrefRef.current || effectiveSubtitles.length === 0) return

    const { enabled, language } = getSubtitlePreferences()
    if (!enabled) return

    const match = findSubtitleForLanguage(effectiveSubtitles, language)

    if (match) {
      appliedSubtitlePrefRef.current = true
      setSelectedSubtitleId(match.id)
    }
  }, [effectiveSubtitles])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.muted = isMuted
    videoRef.current.volume = volume
  }, [isMuted, volume])

  useEffect(() => {
    hasAppliedContinueRef.current = false
    if (
      continueSessionKey &&
      continueAppliedSessionKeyRef.current &&
      continueAppliedSessionKeyRef.current !== continueSessionKey
    ) {
      continueAppliedSessionKeyRef.current = ""
      skipPlaybackTimeRef.current = 0
    }
  }, [source.id, continueSessionKey])

  useEffect(() => {
    hasNotifiedPlaybackEndedRef.current = false
  }, [watchMeta?.id, watchMeta?.season, watchMeta?.episode, source.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const applyContinueTime = () => {
      if (watchPartyGuestRef.current) return

      if (hasAppliedContinueRef.current) return
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return

      if (resumeTime === 0) {
        skipPlaybackTimeRef.current = 0
        hasAppliedContinueRef.current = true
        if (continueSessionKey) {
          continueAppliedSessionKeyRef.current = continueSessionKey
        }
        return
      }

      const qualityResume = qualityResumeRef.current
      if (qualityResume) {
        qualityResumeRef.current = null
        const targetTime = qualityResume.time
        if (targetTime > 0.5) {
          const maxSeek = Number.isFinite(video.duration)
            ? Math.max(0, video.duration - 1)
            : targetTime
          const applied = Math.min(targetTime, maxSeek)
          video.currentTime = applied
          skipPlaybackTimeRef.current = applied
          setCurrentTime(applied)
        }
        hasAppliedContinueRef.current = true
        if (qualityResume.playing && video.paused) {
          void video.play().catch(() => undefined)
        }
        return
      }

      const isProxyRecovery =
        typeof proxyRecoveryResumeTime === "number" &&
        proxyRecoveryResumeTime > 0
      const alreadyAppliedOpening =
        Boolean(continueSessionKey) &&
        continueAppliedSessionKeyRef.current === continueSessionKey

      let target = 0
      if (isProxyRecovery) {
        target = proxyRecoveryResumeTime
      } else if (alreadyAppliedOpening) {
        // Remount mid-episode: keep live position; fall back to resumeTime if ref reset.
        target =
          skipPlaybackTimeRef.current > 0.5
            ? skipPlaybackTimeRef.current
            : Number.isFinite(continueTime) && continueTime > 0
              ? continueTime
              : 0
      } else if (Number.isFinite(continueTime) && continueTime > 0) {
        target = continueTime
      }

      if (target <= 0) {
        hasAppliedContinueRef.current = true
        if (continueSessionKey) {
          continueAppliedSessionKeyRef.current = continueSessionKey
        }
        return
      }

      // High continue seeks on a fresh CDN black-stall if we jump before
      // frames exist. Wait for current data / a little buffer, then seek once.
      if (target > 0.5) {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
        let buffered = 0
        try {
          if (video.buffered.length > 0) {
            buffered = video.buffered.end(0) - video.buffered.start(0)
          }
        } catch {
          /* ignore */
        }
        if (
          buffered < 0.35 &&
          video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          return
        }
      }

      const maxSeek = Number.isFinite(video.duration)
        ? video.duration - 1
        : target
      const appliedTime = Math.min(target, Math.max(0, maxSeek))
      video.currentTime = appliedTime
      skipPlaybackTimeRef.current = appliedTime
      hasAppliedContinueRef.current = true
      if (continueSessionKey) {
        continueAppliedSessionKeyRef.current = continueSessionKey
      }
      setProxyRecoveryResumeTime(undefined)
      // Source switches remount while the user was watching — keep playing.
      if (appliedTime > 0.5 && video.paused) {
        void video.play().catch(() => undefined)
      }
    }

    const handleLoadedMetadata = () => {
      if (sourceTimeoutRef.current) {
        window.clearTimeout(sourceTimeoutRef.current)
        sourceTimeoutRef.current = null
      }

      applyContinueTime()
      applyResolvedDuration(
        streamDurationRef.current,
        video.duration,
        video.currentTime,
        sourcePropsRef.current.url.includes("/api/4k/hls/")
      )
      setIsLoading(false)
      void tryAutoplayRef.current?.()
    }

    const handleContinueReady = () => {
      applyContinueTime()
    }

    const handleDurationChange = () => {
      applyResolvedDuration(
        streamDurationRef.current,
        video.duration,
        video.currentTime,
        sourcePropsRef.current.url.includes("/api/4k/hls/")
      )
    }

    const getEffectiveDuration = (media: HTMLVideoElement) => {
      if (expectedDurationRef.current >= MIN_TRUSTED_DURATION_SEC) {
        return expectedDurationRef.current
      }

      const videoDuration = media.duration
      if (
        Number.isFinite(videoDuration) &&
        videoDuration >= MIN_TRUSTED_DURATION_SEC &&
        videoDuration !== Infinity
      ) {
        return videoDuration
      }

      const streamDuration = streamDurationRef.current
      if (streamDuration >= MIN_TRUSTED_DURATION_SEC) {
        return streamDuration
      }

      return NaN
    }

    const isNearPlaybackEnd = (media: HTMLVideoElement) => {
      if (media.ended) {
        return media.currentTime >= MIN_PLAYBACK_BEFORE_END_CHECK_SEC
      }

      if (media.currentTime < MIN_PLAYBACK_BEFORE_END_CHECK_SEC) {
        return false
      }

      const effectiveDuration = getEffectiveDuration(media)
      if (!Number.isFinite(effectiveDuration)) {
        return false
      }

      return media.currentTime >= effectiveDuration - 4
    }

    const notifyPlaybackEnded = () => {
      notifyPlaybackEndedRef.current()
    }

    const handleTimeUpdate = () => {
      // Guard against accidental rate changes during muted autoplay startup.
      if (
        pendingAutoplayUnmuteRef.current &&
        video.playbackRate !== 1
      ) {
        try {
          video.playbackRate = 1
        } catch {
          // ignore
        }
      }

      const nextTime = video.currentTime
      skipPlaybackTimeRef.current = nextTime
      onPlaybackTimeRef.current?.(nextTime)

      // Resume startAt seeks jump currentTime before frames — require buffer.
      if (
        nextTime > 0.5 &&
        !video.paused &&
        (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
          (video.buffered.length > 0 &&
            video.buffered.end(video.buffered.length - 1) >
              Math.max(0, nextTime - 1)))
      ) {
        setHasPlayedOnce(true)
        try {
          ;(window as Window & { __chillflixEmbedPainted?: boolean }).__chillflixEmbedPainted =
            true
          window.dispatchEvent(new Event("chillflix:embed-painted"))
        } catch {
          /* ignore */
        }
      }

      clearLoadingWhenPlaybackFlowing(video)

      const displayTime = Math.max(nextTime, skipPlaybackTimeRef.current)
      if (displayTime > 0 || needsPlaybackTimeUiRef.current) {
        setCurrentTime(displayTime)
      }

      applyResolvedDuration(
        streamDurationRef.current,
        video.duration,
        video.currentTime,
        sourcePropsRef.current.url.includes("/api/4k/hls/")
      )

      const meta = getPlaybackMeta(video)
      if (
        !hasNotifiedPlaybackStartedRef.current &&
        !canAutoFallbackPlayback(meta)
      ) {
        hasNotifiedPlaybackStartedRef.current = true
        playbackReadyRef.current?.(meta)
      }

      if (isNearPlaybackEnd(video)) {
        notifyPlaybackEnded()
      }
    }
    const handleEnded = () => {
      setIsPlaying(false)
      reportPlaybackSync()
      notifyPlaybackEnded()
    }
    const handlePlay = () => {
      setIsPlaying(true)
      reportPlaybackSync()
    }
    const handlePause = () => {
      setIsPlaying(false)
      reportPlaybackSync()
      if (isNearPlaybackEnd(video)) {
        notifyPlaybackEnded()
      }
    }
    const handleSeeked = () => {
      const nextTime = video.currentTime
      skipPlaybackTimeRef.current = nextTime
      onPlaybackTimeRef.current?.(nextTime)
      setCurrentTime(nextTime)
      reportPlaybackSync()
      clearLoadingWhenPlaybackFlowing(video)
    }
    const clearStallRecoveryTimer = () => {
      if (stallRecoveryTimerRef.current != null) {
        window.clearTimeout(stallRecoveryTimerRef.current)
        stallRecoveryTimerRef.current = null
      }
    }

    const scheduleStallRecovery = () => {
      const isColdStart = skipPlaybackTimeRef.current < 0.5
      // Cold-start kill belongs to startupProgressTimeout (effectiveStartupFailMs),
      // which gives proxied HLS / VAPlayer (Miami) ~45s. The short global
      // first-play budget used to race that and skip a working #1 for Denver.
      if (isColdStart) return
      if (stallRecoveryTimerRef.current != null) return
      // Wait longer before acting — brief `waiting` events are normal CDN blips.
      // The old 2.2s + 18s parent remount loop flashed "Starting playback…" mid-watch.
      const delayMs = 8_000
      stallRecoveryTimerRef.current = window.setTimeout(() => {
        stallRecoveryTimerRef.current = null
        const videoEl = videoRef.current
        if (!videoEl) return
        // Playback flowing again — do nothing.
        if (
          videoEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
          !videoEl.paused &&
          videoEl.currentTime >= 0.25
        ) {
          return
        }
        if (skipPlaybackTimeRef.current < 0.5) {
          return
        }
        const resumeAt = Math.max(
          videoEl.currentTime || 0,
          skipPlaybackTimeRef.current || 0
        )
        // 1) Soft in-place HLS reload — keeps the picture, no remount flash.
        const hls = hlsRef.current
        if (hls) {
          try {
            hls.startLoad(resumeAt > 0.5 ? resumeAt : -1)
            void videoEl.play().catch(() => undefined)
          } catch {
            /* fall through */
          }
        }
        // 2) Parent remount only as a rare last resort (was ~18s → every stall).
        if (!onBufferStallRef.current) return
        // After first paint, parent remount/re-unlock is worse than a soft stall.
        if (hasPlayedOnceRef.current || skipPlaybackTimeRef.current >= 0.5) return
        const now = Date.now()
        if (now - stallRecoveryAtRef.current < 60_000) return
        stallRecoveryAtRef.current = now
        onBufferStallRef.current?.()
      }, delayMs)
    }

    const handleWaiting = () => {
      // After the timeline has moved, keep the picture — don't flash the
      // full-screen "Finding a stream…" blackout over audible VAPlayer audio.
      const alreadyStarted =
        hasPlayedOnceRef.current ||
        video.currentTime > 0.35 ||
        skipPlaybackTimeRef.current > 0.5
      // Never flip the full-screen source probe list back on after playback
      // has already painted — that is the mid-play "loading list" flicker.
      if (!alreadyStarted) {
        setIsLoading(true)
      }
      scheduleBufferingLabel()
      scheduleChangeSourceHint()
      // Cold-start + paused: autoplay blocked — stall recovery would false-fail
      // the source and rotate forever. Only recover while actually trying to play.
      if (!(skipPlaybackTimeRef.current < 0.5 && video.paused)) {
        scheduleStallRecovery()
      }
      if (skipPlaybackTimeRef.current > 0.5) {
        setCurrentTime(skipPlaybackTimeRef.current)
      }
    }
    const handlePlaying = () => {
      setIsPlaying(true)
      setIsLoading(false)
      hideBufferingLabel()
      // VAPlayer often has audible frames before currentTime crosses 0.5 —
      // mark painted early so "Starting VAPlayer…" / Finding overlays dismiss.
      if (
        video.currentTime > 0.05 ||
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
        (video.buffered.length > 0 &&
          video.buffered.end(video.buffered.length - 1) > 0.25)
      ) {
        setHasPlayedOnce(true)
      }
      // Signal parent watch page only once we have real media (not mount / seek).
      try {
        const hasBuffer =
          video.buffered.length > 0 &&
          video.buffered.end(video.buffered.length - 1) >
            Math.max(0, video.currentTime - 1)
        // HAVE_CURRENT_DATA is enough — startAt seeks often sit at rs=2 for a while.
        if (
          !video.paused &&
          (hasBuffer || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        ) {
          ;(window as Window & { __chillflixEmbedPainted?: boolean }).__chillflixEmbedPainted =
            true
          window.dispatchEvent(new Event("chillflix:embed-painted"))
          const meta = getPlaybackMeta(video)
          if (!hasNotifiedPlaybackStartedRef.current && !canAutoFallbackPlayback(meta)) {
            hasNotifiedPlaybackStartedRef.current = true
            playbackReadyRef.current?.(meta)
          }
        }
      } catch {
        /* ignore */
      }
      // Only clear the nudge once real playback is flowing (not a 0s blip).
      if (
        video.currentTime > 0.5 ||
        video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        hideChangeSourceHint()
      }
      clearStallRecoveryTimer()
      if (startupProgressTimeoutRef.current) {
        window.clearTimeout(startupProgressTimeoutRef.current)
        startupProgressTimeoutRef.current = null
      }
      // After real playback resumes, allow a future stall to recover again.
      if (stallRecoveryAtRef.current > 0) {
        stallRecoveryAtRef.current = Date.now() - 12_000
      }
      // Do not force-unmute on "playing" — that pauses muted autoplay and
      // thrash-replays until HLS nudges the timeline forward. Sound unlock
      // only on a real gesture (pointerdown / mute btn), like chillflix player.js.
      if (pendingAutoplayUnmuteRef.current) {
        try {
          video.playbackRate = 1
        } catch {
          // ignore
        }
      }
    }
    const handleCanPlay = () => {
      if (sourceTimeoutRef.current) {
        window.clearTimeout(sourceTimeoutRef.current)
        sourceTimeoutRef.current = null
      }
      clearLoadingWhenPlaybackFlowing(video)
      applyContinueTime()
      void tryAutoplayRef.current?.()
    }
    const handleEnterPiP = () => setIsPiP(true)
    const handleLeavePiP = () => setIsPiP(false)
    const handleError = () =>
      reportPlaybackError(t("player.errors.sourceFailed"))

    video.addEventListener("loadedmetadata", handleLoadedMetadata)
    video.addEventListener("loadeddata", handleContinueReady)
    video.addEventListener("canplay", handleContinueReady)
    video.addEventListener("durationchange", handleDurationChange)
    video.addEventListener("timeupdate", handleTimeUpdate)
    video.addEventListener("ended", handleEnded)
    video.addEventListener("play", handlePlay)
    video.addEventListener("pause", handlePause)
    video.addEventListener("seeked", handleSeeked)
    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("playing", handlePlaying)
    video.addEventListener("canplay", handleCanPlay)
    video.addEventListener("enterpictureinpicture", handleEnterPiP)
    video.addEventListener("leavepictureinpicture", handleLeavePiP)
    video.addEventListener("error", handleError)

    const endCheckInterval = window.setInterval(() => {
      if (isNearPlaybackEnd(video)) {
        notifyPlaybackEnded()
      }
    }, 1000)

    return () => {
      window.clearInterval(endCheckInterval)
      video.removeEventListener("loadedmetadata", handleLoadedMetadata)
      video.removeEventListener("loadeddata", handleContinueReady)
      video.removeEventListener("canplay", handleContinueReady)
      video.removeEventListener("durationchange", handleDurationChange)
      video.removeEventListener("timeupdate", handleTimeUpdate)
      video.removeEventListener("ended", handleEnded)
      video.removeEventListener("play", handlePlay)
      video.removeEventListener("pause", handlePause)
      video.removeEventListener("seeked", handleSeeked)
      clearStallRecoveryTimer()
      clearChangeSourceHintTimer()
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("playing", handlePlaying)
      video.removeEventListener("canplay", handleCanPlay)
      video.removeEventListener("enterpictureinpicture", handleEnterPiP)
      video.removeEventListener("leavepictureinpicture", handleLeavePiP)
      video.removeEventListener("error", handleError)
    }
  }, [applyResolvedDuration, clearLoadingWhenPlaybackFlowing, hideBufferingLabel, hideChangeSourceHint, reportPlaybackSync, scheduleBufferingLabel, scheduleChangeSourceHint, source.id, t, watchPartyGuest])

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current)
    }
    if (!menuOpenRef.current) {
      controlsTimeoutRef.current = window.setTimeout(
        () => setShowControls(false),
        3000
      )
    }
  }, [])

  useEffect(() => {
    if (!controlsWakeRef) return

    controlsWakeRef.current = handleMouseMove
    return () => {
      controlsWakeRef.current = null
    }
  }, [controlsWakeRef, handleMouseMove])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (watchPartyGuest) return

    const video = videoRef.current
    if (!video) return

    // Same as chillflix.lol Watch click: prime unlock in this gesture, then sound.
    primeAutoplaySoundUnlock()

    if (autoplayBlocked && video.paused) {
      setAutoplayBlocked(false)
      video.muted = false
      setIsMuted(false)
      void video
        .play()
        .catch(() =>
          playbackErrorRef.current?.(t("player.errors.sourceFailed"))
        )
      return
    }

    // Control chrome (fullscreen, settings, seek, …): prime only — do NOT
    // blind-unmute here. Blind muted→unmuted during fullscreen/PiP pauses
    // playback in Chrome. Unmute runs via the safe path below / doc listener
    // after the control action, or on a plain player tap.
    const fromChrome = Boolean(
      (event.target as Element | null)?.closest?.(
        "button, [role='button'], input, textarea, select, a, [data-player-chrome]"
      )
    )
    if (fromChrome) return

    if (pendingAutoplayUnmute || (isMuted && !video.paused)) {
      const wasPlaying = !video.paused
      void attemptAutoplayUnmute(video, {
        allowWithoutGesture: true,
        volume: volumeRef.current > 0 ? volumeRef.current : 1,
      }).then((unmuted) => {
        if (unmuted) {
          applyAutoplayUnmute()
          return
        }
        // Unmute blocked — keep muted playback going (never leave paused).
        if (wasPlaying && video.paused) {
          void video.play().catch(() => undefined)
        }
      })
    }
  }

  // chillflix.lol shell unmuteIfNeeded — any non-chrome click while
  // muted-autoplaying unlocks sound (Movie/TV tab, page UI, player surface).
  useEffect(() => {
    if (!pendingAutoplayUnmute || !isMuted) return
    if (watchPartyGuest) return

    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      // Never fight fullscreen / control buttons — those must not pause.
      if (
        target?.closest?.(
          "button, [role='button'], input, textarea, select, a, [data-player-chrome]"
        )
      ) {
        return
      }

      primeAutoplaySoundUnlock()
      const video = videoRef.current
      if (!video || video.paused) return

      const wasPlaying = !video.paused
      void attemptAutoplayUnmute(video, {
        allowWithoutGesture: true,
        volume: volumeRef.current > 0 ? volumeRef.current : 1,
      }).then((unmuted) => {
        if (unmuted) {
          applyAutoplayUnmute()
          return
        }
        if (wasPlaying && video.paused) {
          void video.play().catch(() => undefined)
        }
      })
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true)
    }
  }, [applyAutoplayUnmute, isMuted, pendingAutoplayUnmute, watchPartyGuest])

  const togglePlay = () => {
    if (watchPartyGuest) return

    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      setAutoplayBlocked(false)
      setPendingAutoplayUnmute(false)
      void video
        .play()
        .catch(() =>
          playbackErrorRef.current?.(t("player.errors.sourceFailed"))
        )
    } else {
      video.pause()
    }
  }

  const applyVideoSeek = useCallback(
    (timeSec: number) => {
      if (watchPartyGuest || !videoRef.current) return

      const video = videoRef.current
      const clamped = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0)
      const maxSeek = duration > 1 ? Math.max(0, duration - 0.5) : clamped
      const target = Math.min(clamped, maxSeek)
      const wasPlaying = !video.paused && !video.ended

      // SEEK_FIX_NO_STARTLOAD: HLS.js loads the right segment from video.currentTime.
      // Do not call hls.startLoad() here — it resets the loader and floods the proxy on scrub.
      // Also do not force isLoading here — short seeks would flash Buffering on every click.
      video.currentTime = target
      skipPlaybackTimeRef.current = target
      onPlaybackTimeRef.current?.(target)
      setCurrentTime(target)
      reportPlaybackSync()

      if (wasPlaying) {
        void video.play().catch(() => undefined)
      }
    },
    [duration, reportPlaybackSync, watchPartyGuest]
  )

  const handleSeek = (val: number[]) => {
    applyVideoSeek(val[0])
  }

  const seekToTime = applyVideoSeek

  const getSkipPlaybackTime = useCallback(() => skipPlaybackTimeRef.current, [])

  const introSkipMediaType = embedMediaType ?? watchMeta?.type
  const introSkipTmdbId = watchMeta?.id
  const introSkipSeason = embedSeason ?? watchMeta?.season
  const introSkipEpisode = embedEpisode ?? watchMeta?.episode
  const introSkipSessionKey =
    introSkipMediaType === "tv"
      ? `tv:${introSkipTmdbId ?? 0}:${introSkipSeason ?? 0}:${
          introSkipEpisode ?? 0
        }`
      : `movie:${introSkipTmdbId ?? 0}`

  const { activeSegment: activeSkipSegment, skip: skipActiveSegment } =
    useIntroSkip({
      enabled: Boolean(
        introSkipTmdbId && introSkipMediaType && !watchPartyGuest
      ),
      mediaType: introSkipMediaType,
      tmdbId: introSkipTmdbId,
      season: introSkipSeason,
      episode: introSkipEpisode,
      getPlaybackTime: getSkipPlaybackTime,
      videoRef,
      duration,
      onSeek: seekToTime,
      playbackSessionKey: `${source.id}:${introSkipSessionKey}`,
    })

  const toggleMute = () => setIsMuted(!isMuted)

  const handleVolumeChange = (val: number[]) => {
    setVolume(val[0])
    if (val[0] === 0) {
      setIsMuted(true)
    } else if (isMuted) {
      setIsMuted(false)
    }
  }

  // Keep chrome (esp. settings) reachable during reconnect / cold load — do not
  // auto-hide controls while a status message is up or startup is still pending.
  const keepChromeVisible =
    Boolean(sourceStatusMessage) ||
    settingsOpen ||
    episodesOpen ||
    (isLoading && !hasPlayedOnce)

  const controlsOverlayVisible =
    showControls || !isPlaying || keepChromeVisible

  useEffect(() => {
    needsPlaybackTimeUiRef.current = controlsOverlayVisible
    if (controlsOverlayVisible && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [controlsOverlayVisible])

  useEffect(() => {
    onControlsOverlayVisibleChange?.(controlsOverlayVisible)
  }, [controlsOverlayVisible, onControlsOverlayVisibleChange])

  useLayoutEffect(() => {
    if (!isPlayStationBrowser()) return
    setInlinePlayback(false)
    const video = videoRef.current
    if (!video) return
    video.playsInline = false
    video.removeAttribute("playsinline")
    video.removeAttribute("webkit-playsinline")
  }, [])

  const getFullscreenTarget = () => {
    if (parentHostedEmbed) return null
    return fullscreenRootRef?.current ?? containerRef.current
  }

  useEffect(() => {
    if (!parentHostedEmbed) return

    const allowedParentOrigins = getEmbedAuthParentOrigins()

    const onMessage = (event: MessageEvent) => {
      if (!allowedParentOrigins.includes(event.origin)) return

      const type = event.data?.type
      if (type === EMBED_MESSAGE_WAKE_CHROME) {
        handleMouseMove()
        return
      }
      if (type === "CHILLFLIX_EMBED_PARENT_COMMAND") {
        const video = videoRef.current
        const data = (event.data?.data || {}) as Record<string, unknown>
        const action = String(data.action || "")
        if (action === "play") {
          if (video) {
            video.muted = false
            if (!(video.volume > 0)) video.volume = volumeRef.current > 0 ? volumeRef.current : 1
            setIsMuted(false)
            void video.play()
          }
        } else if (action === "pause") video?.pause()
        else if (action === "mute" && video) {
          video.muted = true
          video.volume = 0
          setIsMuted(true)
        } else if (action === "unmute" && video) {
          video.muted = false
          if (!(video.volume > 0)) video.volume = volumeRef.current > 0 ? volumeRef.current : 1
          setIsMuted(false)
        }
        else if (action === "toggle" && video) {
          if (video.paused) void video.play()
          else video.pause()
        } else if (action === "seek" && typeof data.time === "number" && video) {
          video.currentTime = Math.max(0, data.time)
        } else if (action === "delta" && typeof data.dt === "number" && video) {
          video.currentTime = Math.max(0, video.currentTime + data.dt)
        } else if (action === "rate" && typeof data.rate === "number") {
          if (video) video.playbackRate = data.rate
          setPlaybackRate(data.rate)
        } else if (action === "source" && data.id) {
          void onSelectSource?.(String(data.id))
        } else if (action === "provider" && data.id) {
          void onRequestProvider?.(String(data.id))
        } else if (action === "quality" && Number.isFinite(Number(data.level))) {
          handleQualityChangeRef.current(Number(data.level))
        } else if (action === "subtitle") {
          const id = data.id == null || data.id === "" ? undefined : String(data.id)
          setSelectedSubtitleId(id)
        } else if (action === "labels") {
          try {
            ;(window as Window & { __toflixRealNames?: boolean }).__toflixRealNames =
              data.real === true || data.on === true
          } catch {}
          handleMouseMove()
        } else if (action === "close-overlays" || action === "close-settings") {
          setSettingsOpen(false)
          setEpisodesOpen(false)
          handleMouseMove()
        } else if (action === "sync") {
          postEmbedMessage("CHILLFLIX_EMBED_SKIN_STATE", {
            sources: (sources || []).map((s) => {
              return {
                id: s.id,
                label: s.label,
                quality: s.quality,
                provider: s.provider,
                providerId: s.providerId,
              }
            }),
            currentSourceId: source.id,
            playbackRate: video?.playbackRate || 1,
            qualities: (qualities || []).map((q) => ({
              index: q.index,
              label: q.label,
              height: q.height,
            })),
            currentQuality,
            subtitles: (effectiveSubtitles || []).map((s) => ({
              id: s.id,
              label: s.label,
              language: s.language,
            })),
            currentSubtitleId: selectedSubtitleId,
            enabledProviderIds,
            hiddenProviderIds,
            activeTestingProviderId,
            scanFailedProviderIds,
            sourcesLoadingMore,
            sourceHealth,
          })
        }
        return
      }
      if (type !== EMBED_MESSAGE_FULLSCREEN_STATE) return

      const payload = event.data?.data as
        | EmbedFullscreenStatePayload
        | undefined
      const active = Boolean(payload?.active)
      setIsFullscreen(active)
      onFullscreenChange?.(active)
      if (!active) {
        unlockScreenOrientation()
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [handleMouseMove, parentHostedEmbed, onFullscreenChange, onSelectSource, onRequestProvider, sources, source.id, qualities, currentQuality, subtitles, selectedSubtitleId, enabledProviderIds, hiddenProviderIds, activeTestingProviderId, scanFailedProviderIds, sourcesLoadingMore, sourceHealth])

  useEffect(() => {
    if (parentHostedEmbed) return

    const handleFullscreenChange = () => {
      const target = fullscreenRootRef?.current ?? containerRef.current
      const active =
        isFullscreenActive() ||
        isElementFullscreen(target) ||
        isElementFullscreen(containerRef.current)
      setIsFullscreen(active)
      onFullscreenChange?.(active)
      if (!active) {
        unlockScreenOrientation()
      }
    }

    const removeDocumentListener = addDocumentFullscreenChangeListener(
      handleFullscreenChange
    )

    const video = videoRef.current
    const removeVideoListeners = video
      ? addIosVideoFullscreenListeners(
          video,
          () => {
            setIsFullscreen(true)
            onFullscreenChange?.(true)
            void tryLockLandscapeOrientation()
          },
          () => {
            setIsFullscreen(false)
            setConsoleControls(false)
            onFullscreenChange?.(false)
            unlockScreenOrientation()
          }
        )
      : undefined

    return () => {
      removeDocumentListener()
      removeVideoListeners?.()
    }
  }, [fullscreenRootRef, onFullscreenChange, parentHostedEmbed, source.id])

  const toggleFullscreen = () => {
    const consoleVideo = videoRef.current
    // Only force native <video> controls on PlayStation / iOS WebKit.
    // On Android Chrome inside a partner iframe, fullscreenEnabled is often
    // false — flipping console controls made the FS button feel dead.
    if (
      consoleVideo &&
      (isPlayStationBrowser() ||
        (isIosSafariLike() && document.fullscreenEnabled === false))
    ) {
      setConsoleControls(true)
      setInlinePlayback(false)
      enterConsoleVideoFullscreen(consoleVideo)
    }

    if (parentHostedEmbed) {
      // Toflix puts this player in an iframe and the parent page cannot
      // fullscreen a video on PS5. Call WebKit from this click instead.
      const localTarget = containerRef.current
      const localVideo = videoRef.current
      if (isPlayStationBrowser() && localTarget && localVideo) {
        void (async () => {
          if (!isFullscreenActive()) {
            const success = await requestPlayerFullscreen(localTarget, localVideo)
            if (success) {
              setIsFullscreen(true)
              onFullscreenChange?.(true)
              void tryLockLandscapeOrientation()
              return
            }
          } else {
            const success = await exitPlayerFullscreen()
            if (success) {
              setIsFullscreen(false)
              setConsoleControls(false)
              onFullscreenChange?.(false)
              unlockScreenOrientation()
              return
            }
          }
          postEmbedMessage(EMBED_MESSAGE_TOGGLE_FULLSCREEN, {})
        })()
        return
      }
      postEmbedMessage(EMBED_MESSAGE_TOGGLE_FULLSCREEN, {})
      return
    }

    const target = getFullscreenTarget()
    if (!target) return

    void (async () => {
      const video = videoRef.current
      const wasPlaying = Boolean(video && !video.paused && !video.ended)

      if (!isFullscreenActive()) {
        const success = await requestPlayerFullscreen(target, videoRef.current)
        if (success) {
          setIsFullscreen(true)
          onFullscreenChange?.(true)
          void tryLockLandscapeOrientation()
          // Chrome/Safari often pause when entering fullscreen if a concurrent
          // unmute ran on the same pointerdown — resume if we were playing.
          if (wasPlaying && video && video.paused) {
            try {
              await video.play()
            } catch {
              // ignore
            }
          }
        } else {
          playbackErrorRef.current?.(t("player.errors.fullscreenFailed"))
        }
        return
      }

      const success = await exitPlayerFullscreen()
      if (success) {
        setIsFullscreen(false)
        setConsoleControls(false)
        onFullscreenChange?.(false)
        unlockScreenOrientation()
        if (wasPlaying && video && video.paused) {
          try {
            await video.play()
          } catch {
            // ignore
          }
        }
      } else {
        console.warn("[MediaPlayer] failed to exit fullscreen")
      }
    })()
  }

  const togglePictureInPicture = async () => {
    const video = videoRef.current
    if (!video) return

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setIsPiP(false)
      } else {
        await video.requestPictureInPicture()
        setIsPiP(true)
      }
    } catch {
      playbackErrorRef.current?.(t("player.errors.pipFailed"))
    }
  }

  const rememberQualityResume = () => {
    const video = videoRef.current
    const time = Math.max(video?.currentTime || 0, skipPlaybackTimeRef.current || 0)
    if (time > 0.5) skipPlaybackTimeRef.current = time
    qualityResumeRef.current = {
      time,
      playing: Boolean(video && !video.paused && !video.ended),
    }
  }

  const applyInStreamQuality = (level: number) => {
    const hls = hlsRef.current
    if (!hls || hls.levels.length <= 1) return false
    // Discrete URL-per-rung ladders (Videasy etc.) switch by replacing the
    // media URL. Never map their Quality indexes onto the current HLS ladder —
    // index 0 is often 2160p in the provider list but only 1080p in-stream.
    if (
      !hlsLadderMenuRef.current &&
      providerQualitiesRef.current &&
      providerQualitiesRef.current.filter((item) => (item.height || 0) > 0)
        .length > 1
    ) {
      return false
    }
    const video = videoRef.current
    const wasPlaying = Boolean(video && !video.paused && !video.ended)
    const lock = (index: number) => {
      manualQualityRef.current = index
      try {
        if (!hls.autoLevelEnabled && hls.currentLevel === index) {
          setCurrentQuality(index)
          return
        }
        // nextLevel switches inside the current stream. currentLevel flushes
        // the buffer and is what knocked the page into the error screen.
        hls.nextLevel = index
      } catch {
        // keep the menu selection even if this rendition cannot lock yet
      }
      setCurrentQuality(index)
      if (wasPlaying && video?.paused) void video.play().catch(() => undefined)
    }

    if (level === -2160) {
      const fourK = hls.levels.findIndex((item) => (item.height || 0) >= 2160)
      if (fourK >= 0) {
        lock(fourK)
        return true
      }
      manualQualityRef.current = -2160
      setCurrentQuality(-2160)
      return true
    }
    if (level < 0) {
      manualQualityRef.current = -1
      try {
        hls.nextLevel = -1
      } catch {
        // ignore
      }
      setCurrentQuality(-1)
      return true
    }

    // Quality tab rows are HLS level indexes once the ladder is showing.
    if (hlsLadderMenuRef.current && level >= 0 && level < hls.levels.length) {
      lock(level)
      return true
    }

    // Same height bands as Toflix: pick the tallest rendition in the band.
    const providerQualities = providerQualitiesRef.current
    const picked = providerQualities?.find((item) => item.index === level)
    const height = picked?.height || hls.levels[level]?.height || 0
    const minH = height >= 2160 ? 2160 : height >= 1080 ? 1080 : height >= 720 ? 720 : 0
    const nextMin = minH >= 2160 ? undefined : minH >= 1080 ? 2160 : minH >= 720 ? 1080 : 720
    let best = -1
    let bestH = -1
    hls.levels.forEach((item, index) => {
      const itemHeight = item.height || 0
      const inBand = nextMin ? itemHeight >= minH && itemHeight < nextMin : itemHeight >= minH
      if (inBand && itemHeight >= bestH) {
        best = index
        bestH = itemHeight
      }
    })
    if (best >= 0) {
      lock(best)
      return true
    }
    if (level >= 0 && level < hls.levels.length) {
      lock(level)
      return true
    }
    return false
  }

  const handleQualityChange = (level: number) => {
    if (applyInStreamQuality(level)) return

    const providerQualities = providerQualitiesRef.current
    if (providerQualities && providerQualities.length > 1) {
      const currentPlaying = playbackUrlWithoutToken(
        qualityOverrideUrlRef.current || source.url
      )

      // Synthetic 4K row from the skin → real discrete 2160p URL when present.
      if (level === -2160) {
        const fourK =
          providerQualities.find((item) => (item.height || 0) >= 2160) ||
          providerQualities.find((item) => /2160|4k|uhd/i.test(item.label || ""))
        if (fourK) {
          level = fourK.index
        } else {
          return
        }
      }

      if (level < 0) {
        // Auto → the stream already chosen (any available quality)
        const preferred = playbackUrlWithoutToken(source.url)
        manualQualityRef.current = -1
        setCurrentQuality(-1)
        if (currentPlaying === preferred && !qualityOverrideUrlRef.current) {
          return
        }
        rememberQualityResume()
        setQualityOverrideUrl(null)
        qualityOverrideUrlRef.current = null
        setQualityReloadNonce((n) => n + 1)
        return
      }

      const picked = providerQualities.find((item) => item.index === level)
      if (!picked) return
      const nextUrl = playbackUrlWithoutToken(picked.url)
      manualQualityRef.current = level
      setCurrentQuality(level)
      if (currentPlaying === nextUrl) {
        // Already on this quality — just sync the menu highlight.
        setQualityOverrideUrl(picked.url)
        qualityOverrideUrlRef.current = picked.url
        return
      }
      rememberQualityResume()
      setQualityOverrideUrl(picked.url)
      qualityOverrideUrlRef.current = picked.url
      setQualityReloadNonce((n) => n + 1)
      return
    }

    const hls = hlsRef.current
    if (!hls) return
    const video = videoRef.current
    const wasPlaying = Boolean(video && !video.paused && !video.ended)
    // Synthetic 4K row when HEVC/2160 was stripped from the MSE ladder.
    const lockLevel = (index: number) => {
      manualQualityRef.current = index
      try {
        if (index < 0) hls.nextLevel = -1
        else if (!hls.autoLevelEnabled && hls.currentLevel === index) return
        else hls.nextLevel = index
      } catch {
        // a bad rendition lock must not take down the page
      }
      setCurrentQuality(index)
      if (wasPlaying && video?.paused) void video.play().catch(() => undefined)
    }
    if (level === -2160) {
      const fourK = hls.levels.findIndex((item) => (item.height || 0) >= 2160)
      if (fourK >= 0) {
        lockLevel(fourK)
        return
      }
      manualQualityRef.current = -2160
      setCurrentQuality(-2160)
      return
    }
    lockLevel(level < 0 ? -1 : level)
  }

  handleQualityChangeRef.current = handleQualityChange

  const resetVideoTransform = useCallback(() => {
    setVideoScale(VIDEO_ZOOM_MIN)
    setVideoTranslate({ x: 0, y: 0 })
    zoomGestureRef.current.mode = "idle"
    zoomGestureRef.current.moved = false
    setZoomGestureActive(false)
  }, [])

  useEffect(() => {
    videoScaleRef.current = videoScale
  }, [videoScale])

  useEffect(() => {
    videoTranslateRef.current = videoTranslate
  }, [videoTranslate])

  useEffect(() => {
    resetVideoTransform()
  }, [source.id, resetVideoTransform])

  const refreshSafeAreaInsets = useCallback(() => {
    safeAreaInsetsRef.current = resolvePanSafeAreaInsets(readSafeAreaInsets())
  }, [])

  useLayoutEffect(() => {
    refreshSafeAreaInsets()

    const handleViewportChange = () => {
      refreshSafeAreaInsets()
      applyVideoTransformRef.current(
        videoScaleRef.current,
        videoTranslateRef.current.x,
        videoTranslateRef.current.y
      )
    }

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("orientationchange", handleViewportChange)
    return () => {
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("orientationchange", handleViewportChange)
    }
  }, [refreshSafeAreaInsets])

  const applyVideoTransformRef = useRef<
    (scale: number, x: number, y: number) => void
  >(() => undefined)

  const applyVideoTransform = useCallback(
    (scale: number, x: number, y: number) => {
      const container = containerRef.current
      const bounds = container?.getBoundingClientRect()
      const nextScale = clampVideoScale(scale)

      if (nextScale <= VIDEO_ZOOM_MIN) {
        setVideoScale(VIDEO_ZOOM_MIN)
        setVideoTranslate({ x: 0, y: 0 })
        return
      }

      const clamped = bounds
        ? clampVideoTranslate(
            x,
            y,
            nextScale,
            bounds.width,
            bounds.height,
            safeAreaInsetsRef.current
          )
        : { x, y }

      setVideoScale(nextScale)
      setVideoTranslate(clamped)
    },
    []
  )

  useEffect(() => {
    applyVideoTransformRef.current = applyVideoTransform
  }, [applyVideoTransform])

  useEffect(() => {
    const el = videoTransformRef.current
    if (!el || watchPartyGuest) return

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const distance = getTouchDistance(event.touches[0], event.touches[1])
        if (distance <= 0) return

        zoomGestureRef.current = {
          mode: "pinch",
          startDistance: distance,
          startScale: videoScaleRef.current,
          startTranslateX: videoTranslateRef.current.x,
          startTranslateY: videoTranslateRef.current.y,
          lastPanX: 0,
          lastPanY: 0,
          moved: false,
        }
        setZoomGestureActive(true)
        return
      }

      if (
        event.touches.length === 1 &&
        videoScaleRef.current > VIDEO_ZOOM_MIN
      ) {
        const touch = event.touches[0]
        zoomGestureRef.current = {
          mode: "pan",
          startDistance: 0,
          startScale: videoScaleRef.current,
          startTranslateX: videoTranslateRef.current.x,
          startTranslateY: videoTranslateRef.current.y,
          lastPanX: touch.clientX,
          lastPanY: touch.clientY,
          moved: false,
        }
        setZoomGestureActive(true)
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = zoomGestureRef.current
      if (gesture.mode === "idle") return

      event.preventDefault()

      if (gesture.mode === "pinch" && event.touches.length >= 2) {
        const distance = getTouchDistance(event.touches[0], event.touches[1])
        if (gesture.startDistance <= 0) return

        const ratio = distance / gesture.startDistance
        const nextScale = clampVideoScale(gesture.startScale * ratio)
        gesture.moved = gesture.moved || Math.abs(ratio - 1) > 0.02

        applyVideoTransform(
          nextScale,
          gesture.startTranslateX,
          gesture.startTranslateY
        )
        return
      }

      if (gesture.mode === "pan" && event.touches.length === 1) {
        const touch = event.touches[0]
        const dx = touch.clientX - gesture.lastPanX
        const dy = touch.clientY - gesture.lastPanY

        if (
          !gesture.moved &&
          (Math.abs(dx) > VIDEO_PAN_THRESHOLD_PX ||
            Math.abs(dy) > VIDEO_PAN_THRESHOLD_PX)
        ) {
          gesture.moved = true
        }

        gesture.lastPanX = touch.clientX
        gesture.lastPanY = touch.clientY

        applyVideoTransform(
          videoScaleRef.current,
          videoTranslateRef.current.x + dx,
          videoTranslateRef.current.y + dy
        )
      }
    }

    const finishGesture = () => {
      const gesture = zoomGestureRef.current
      if (gesture.mode === "idle") return

      if (gesture.moved) {
        suppressVideoTapRef.current = true
      }

      gesture.mode = "idle"
      gesture.moved = false
      setZoomGestureActive(false)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = zoomGestureRef.current

      if (gesture.mode === "pinch" && event.touches.length >= 2) {
        return
      }

      if (gesture.mode === "pan" && event.touches.length >= 1) {
        return
      }

      const wasMoved = gesture.moved

      if (gesture.mode !== "idle") {
        finishGesture()
      }

      if (event.touches.length > 0 || wasMoved) {
        return
      }

      const touch = event.changedTouches[0]
      if (!touch) return

      const now = Date.now()
      const lastTap = lastTapRef.current

      if (videoScaleRef.current > VIDEO_ZOOM_MIN) {
        const dt = now - lastTap.time
        const distance = Math.hypot(
          touch.clientX - lastTap.x,
          touch.clientY - lastTap.y
        )

        if (
          dt < VIDEO_DOUBLE_TAP_MS &&
          distance < VIDEO_DOUBLE_TAP_DISTANCE_PX
        ) {
          resetVideoTransform()
          suppressVideoTapRef.current = true
          suppressDoubleClickRef.current = true
          window.setTimeout(() => {
            suppressDoubleClickRef.current = false
          }, 400)
          lastTapRef.current = { time: 0, x: 0, y: 0 }
          return
        }
      }

      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
    }

    const handleTouchCancel = () => {
      finishGesture()
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true })
    el.addEventListener("touchmove", handleTouchMove, { passive: false })
    el.addEventListener("touchend", handleTouchEnd, { passive: true })
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true })

    return () => {
      el.removeEventListener("touchstart", handleTouchStart)
      el.removeEventListener("touchmove", handleTouchMove)
      el.removeEventListener("touchend", handleTouchEnd)
      el.removeEventListener("touchcancel", handleTouchCancel)
    }
  }, [applyVideoTransform, resetVideoTransform, watchPartyGuest])

  const handleVideoClick = () => {
    if (watchPartyGuest) return
    if (suppressVideoTapRef.current) {
      suppressVideoTapRef.current = false
      return
    }
    handleMouseMove()
    // Single tap/click must toggle — chrome wake alone felt like "nothing happens".
    togglePlay()
  }

  const handleContainerDoubleClick = () => {
    if (watchPartyGuest) return
    if (suppressDoubleClickRef.current) return
    toggleFullscreen()
  }

  return (
    <div
      ref={containerRef}
      className={`group relative size-full overflow-hidden bg-black${parentHostedEmbed ? " movy-embed-host" : ""}`}
      onPointerDown={watchPartyGuest ? undefined : handlePointerDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={(event) => {
        if (menuOpenRef.current) return

        const related = event.relatedTarget
        const shell = fullscreenRootRef?.current
        if (related instanceof Node && shell?.contains(related)) {
          return
        }

        setShowControls(false)
      }}
      onDoubleClick={watchPartyGuest ? undefined : handleContainerDoubleClick}
    >
      <div
        ref={videoTransformRef}
        className="absolute origin-center will-change-transform"
        style={{
          top: "calc(-1 * env(safe-area-inset-top, 0px))",
          right: "calc(-1 * env(safe-area-inset-right, 0px))",
          bottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
          left: "calc(-1 * env(safe-area-inset-left, 0px))",
          transform: `translate(${videoTranslate.x}px, ${videoTranslate.y}px) scale(${videoScale})`,
          touchAction: zoomGestureActive ? "none" : "manipulation",
        }}
      >
        {isIframeEmbed ? (
          <div className="relative h-full w-full overflow-hidden bg-black">
            <iframe
              key={source.id}
              title="Playback"
              src={source.url}
              className={
                source.videasyPlayerSurface
                  ? "absolute border-0 bg-black pointer-events-none"
                  : "h-full w-full border-0 bg-black"
              }
              style={
                source.videasyPlayerSurface
                  ? {
                      // Crop partner chrome (top bar + bottom controls + corner marks).
                      // Scale so the video plane fills Chillflix MediaPlayer.
                      top: "-8%",
                      left: "-2%",
                      width: "104%",
                      height: "116%",
                      transform: "scale(1.04)",
                      transformOrigin: "center center",
                    }
                  : undefined
              }
              allowFullScreen
              referrerPolicy="origin"
              allow="accelerometer; autoplay *; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen *"
              onLoad={() => {
                setIsLoading(false)
                setIsPlaying(true)
                playbackReadyRef.current?.({
                  currentTime: 0,
                  bufferedSeconds: 1,
                })
              }}
            />
          </div>
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full"
            onClick={watchPartyGuest ? undefined : handleVideoClick}
            playsInline={inlinePlayback}
            muted={isMuted}
            preload="auto"
            controls={consoleControls}
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
          />
        )}

        {selectedSubtitle && !isIframeEmbed ? (
          <CustomSubtitles
            url={selectedSubtitle.src}
            videoRef={videoRef}
            delaySec={subtitleStyle.delaySec}
            fontScale={subtitleStyle.fontScale}
            backgroundOpacity={subtitleStyle.backgroundOpacity}
            onLoadError={handleSubtitleLoadError}
          />
        ) : null}
      </div>

      {/*
        Blank <video> looks like a grey screen while we resolve/switch providers.
        Old condition hid this spinner whenever any sources existed — exactly when
        failover / “finding a server” happens. Always show chrome until first frames.
      */}
      {/* Resume remounts (stall/CF recovery) keep continueTime high — never flash
          "Starting playback…" over a mid-watch reconnect; that felt like a restart. */}
      {isLoading &&
      !isPlaying &&
      currentTime < 0.15 &&
      !hasPlayedOnce &&
      !(continueTime > 0.5 || skipPlaybackTimeRef.current > 0.5) ? (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/60">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative flex size-11 items-center justify-center">
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            </div>
          </div>
          <p className="absolute inset-x-0 top-[calc(50%+2.75rem)] px-4 text-center text-xs text-white/85 sm:text-sm">
            {sourcesLoadingMore || activeTestingProviderId
              ? t("player.status.findingStream")
              : t("player.loading.startingPlayback")}
          </p>
        </div>
      ) : null}

      {!parentHostedEmbed && showBufferingLabel &&
      isLoading &&
      hasPlayedOnce &&
      isPlaying &&
      sources &&
      sources.length > 0 &&
      !showChangeSourceHint ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center px-4">
          <span className="rounded-full bg-black/70 px-4 py-2 text-xs text-white/90">
            Buffering…
          </span>
        </div>
      ) : null}

      {!parentHostedEmbed && showChangeSourceHint &&
      sources &&
      sources.length > 1 &&
      !settingsOpen &&
      (isLoading || !isPlaying || currentTime < 1) ? (
        <div className="pointer-events-none absolute right-3 top-14 z-[10050] flex max-w-[min(16rem,calc(100%-1.5rem))] flex-col items-end gap-1.5 sm:right-5 sm:top-16 md:bottom-28 md:top-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openSourceSettings()
            }}
            className="pointer-events-auto rounded-2xl border border-white/15 bg-black/80 px-3 py-2 text-left shadow-lg backdrop-blur-sm transition hover:bg-black/90"
          >
            <span className="block text-[11px] leading-snug text-white/70">
              Not working?
            </span>
            <span className="mt-0.5 block text-xs font-medium leading-snug text-white">
              Change source in Settings
            </span>
          </button>
        </div>
      ) : null}

      {autoplayBlocked && !isPlaying && !isLoading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="rounded-full bg-black/60 px-4 py-2 text-sm text-white">
            {t("player.tapToPlay")}
          </span>
        </div>
      ) : null}

      {!parentHostedEmbed && pendingAutoplayUnmute && isPlaying && isMuted && !isLoading ? (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
          {t("player.tapForSound")}
        </div>
      ) : null}

      {!parentHostedEmbed && isFourKHlsPlaybackUrl(source.url) && isLoading && !isPlaying ? (
        <div className="pointer-events-none absolute bottom-24 left-0 right-0 z-30 px-4 text-center">
          <p className="mx-auto max-w-md rounded-full bg-black/60 px-4 py-2 text-xs text-white/85 sm:text-sm">
            {isFourKHlsTranscodeUrl(source.url)
              ? t("player.fourKTranscodeStarting")
              : t("player.fourKStarting")}
          </p>
        </div>
      ) : null}

      {/* Show probe even for parent-hosted cinema shells — .lol ?play=true only
          draws a back chevron, so hiding this left a pure black iframe. */}
      {sources && sources.length > 0 ? (
        <SourceStatusOverlay
          sources={sources}
          currentSourceId={source.id}
          sourcesLoadingMore={sourcesLoadingMore}
          sourceHealth={sourceHealth}
          activeTestingProviderId={activeTestingProviderId}
          selectedProviderId={selectedProviderId}
          scanFailedProviderIds={scanFailedProviderIds}
          unavailableProviders={unavailableProviders}
          isLoading={isLoading}
          isPlaying={isPlaying}
          hasPlaybackProgress={
            hasPlayedOnce || duration > 0.05 || currentTime > 0.5 || isPlaying
          }
          statusInsetLeft={statusInsetLeft}
          showRealProviderNames={showRealProviderNames}
          isFullscreen={isFullscreen}
        />
      ) : null}

      {sourceStatusMessage &&
      !sourcesLoadingMore &&
      // Always show Starting/No-stream while switching sources. Hiding
      // "Starting Videasy…" because VAPlayer was already playing made mobile
      // Sources taps look like a total no-op (sheet closed, no feedback).
      (
        (/^(No stream from|Could not load|Starting )/i.test(sourceStatusMessage) ||
          /tap .+ again/i.test(sourceStatusMessage) ||
          /Videasy session is rate-limited|Videasy is busy|Videasy returned no streams|Could not get Videasy/i.test(
            sourceStatusMessage
          ) ||
          (!(duration > 0.05 || currentTime > 0.5 || isPlaying || hasPlayedOnce) &&
            !/^(Starting |No stream from|Could not load)/i.test(sourceStatusMessage) &&
            !/tap .+ again/i.test(sourceStatusMessage)))
      ) ? (
        isTransientPlaybackStatusMessage(sourceStatusMessage) ||
        !shouldShowPlaybackRetryButton(sourceStatusMessage) ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <span className="rounded-full bg-black/70 px-4 py-2 text-xs text-white/90">
              {sourceStatusMessage}
            </span>
          </div>
        ) : onRefetchSources ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <div className="pointer-events-auto max-w-lg rounded-lg border border-amber-500/25 bg-black/80 px-3 py-2.5 shadow-lg backdrop-blur-sm">
              <PlaybackSourceRetryPanel
                message={sourceStatusMessage}
                onRetry={onRefetchSources}
                align="start"
                messageClassName="text-amber-100/90"
                showRetryButton={shouldShowPlaybackRetryButton(sourceStatusMessage)}
              />
            </div>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <span className="rounded-full bg-black/70 px-4 py-2 text-xs text-white/90">
              {sourceStatusMessage}
            </span>
          </div>
        )
      ) : null}

      <PlayerControls
        isPlaying={
          watchPartyGuest ? Boolean(syncPlayback?.isPlaying) : isPlaying
        }
        isLoading={isLoading}
        hideTransportControls={
          Boolean(sources?.length) &&
          !(duration > 0.05 || currentTime > 0.5) &&
          (Boolean(sourcesLoadingMore) ||
            Boolean(activeTestingProviderId) ||
            isLoading)
        }
        watchPartyGuest={watchPartyGuest}
        onDoubleClick={toggleFullscreen}
        onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
          const delta = -e.deltaY * 0.001
          const nextVolume = Math.max(0, Math.min(1, volume + delta))
          setVolume(nextVolume)
          if (nextVolume === 0) {
            setIsMuted(true)
          } else if (isMuted) {
            setIsMuted(false)
          }
        }}
        currentTime={currentTime}
        duration={duration}
        expectedDurationSec={
          expectedDurationRef.current >= 45
            ? expectedDurationRef.current
            : watchMeta?.runtimeMinutes && watchMeta.runtimeMinutes > 0
              ? watchMeta.runtimeMinutes * 60
              : undefined
        }
        volume={volume}
        isMuted={isMuted}
        isFullscreen={isFullscreen}
        onTogglePlay={togglePlay}
        onSeek={handleSeek}
        onToggleMute={toggleMute}
        onVolumeChange={handleVolumeChange}
        onToggleFullscreen={toggleFullscreen}
        show={controlsOverlayVisible}
        onSettingsOpenChange={setSettingsOpen}
        onEpisodesOpenChange={setEpisodesOpen}
        isPiP={isPiP}
        onTogglePiP={togglePictureInPicture}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        qualities={qualities}
        currentQuality={currentQuality}
        onQualityChange={handleQualityChange}
        sources={sources}
        currentSourceId={source.id}
        onSelectSource={onSelectSource}
        onRequestProvider={onRequestProvider}
        sourcesLoadingMore={sourcesLoadingMore}
        sourceStatusMessage={sourceStatusMessage}
        onRefetchSources={onRefetchSources}
        unavailableProviders={unavailableProviders}
        sourceHealth={sourceHealth}
        activeTestingProviderId={activeTestingProviderId}
          selectedProviderId={selectedProviderId}
        scanFailedProviderIds={scanFailedProviderIds}
        subtitles={effectiveSubtitles}
        currentSubtitleId={selectedSubtitleId}
        onSelectSubtitle={setSelectedSubtitleId}
        audioTracks={availableAudioTracks}
        currentAudioTrackId={selectedAudioTrackId}
        onSelectAudioTrack={handleSelectAudioTrack}
        autoplayEnabled={autoplayEnabled}
        onAutoplayChange={watchPartyGuest ? undefined : handleAutoplayChange}
        autoNextEnabled={autoNextEnabled}
        onAutoNextChange={onAutoNextChange}
        subtitleDelaySec={subtitleStyle.delaySec}
        onSubtitleDelayChange={(delaySec) => updateSubtitleStyle({ delaySec })}
        subtitleFontScale={subtitleStyle.fontScale}
        onSubtitleFontScaleChange={(fontScale) => updateSubtitleStyle({ fontScale })}
        subtitleBackgroundOpacity={subtitleStyle.backgroundOpacity}
        onSubtitleBackgroundOpacityChange={(backgroundOpacity) =>
          updateSubtitleStyle({ backgroundOpacity })
        }
        showAutoNext={showAutoNext && !watchPartyGuest}
        tvNavigation={
          watchPartyGuest || watchMeta?.type !== "tv" || !tvNavigation
            ? undefined
            : tvNavigation
        }
        externalSubtitlesLoading={externalSubtitlesLoading}
        showRealProviderNames={showRealProviderNames}
        hiddenProviderIds={hiddenProviderIds}
        enabledProviderIds={enabledProviderIds}
        mobileControlsTopInset={mobileControlsTopInset}
        parentHostedEmbed={parentHostedEmbed}
        iframeEmbed={isIframeEmbed}
        mediaTitle={watchMeta?.title}
        mediaId={watchMeta?.id}
        mediaType={watchMeta?.type}
        runtimeMinutes={watchMeta?.runtimeMinutes}
        season={watchMeta?.season}
        episode={watchMeta?.episode}
        ratingCert={watchMeta?.contentRating}
        ratingAdvisories={watchMeta?.contentAdvisories}
        onBack={
          parentHostedEmbed
            ? () => postEmbedMessage("CHILLFLIX_EMBED_PARENT_BACK", {})
            : undefined
        }
        onOpenParty={
          parentHostedEmbed
            ? () => postEmbedMessage("CHILLFLIX_EMBED_OPEN_PARTY", {})
            : undefined
        }
        skipSegment={
          activeSkipSegment && !watchPartyGuest
            ? {
                kind: activeSkipSegment.kind,
                onSkip: skipActiveSegment,
              }
            : null
        }
      />
    </div>
  )
}
