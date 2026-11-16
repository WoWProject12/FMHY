"use client"

import { cfResilientFetch } from "@/lib/cf-resilient-fetch"

import { getEnabledProviderIds, providerAdvertises4k } from "@/hooks/useStreamSourcesConfig"
import { normalizeProviderName } from "@/lib/stream-sources-defaults"
// 2026-10-24c: dynamic-import Videasy bridge warm so chunk 9484 actually loads
// (static import was tree-split; sync r(3921) ran before async chunk → warm never mounted).

import { useEffect, useMemo, useState } from "react"

import {
  countryCodeToFlagEmoji,
  subtitleLanguageLabel,
} from "@/components/player/utils/subtitle-display"
import { labelToLanguageCode } from "@/lib/external-subtitles/language"

type SeasonSummary = {
  id: number
  season_number: number
  episode_count: number
  name?: string
}
type EpisodeSummary = {
  id: number
  episode_number: number
  name: string
  still_path?: string | null
  runtime?: number | null
  overview?: string
}

type Quality = { index: number; height: number; label: string }
type Source = {
  id: string
  label: string
  provider?: string
  providerId?: string
  quality?: string
  /** True when this server offers a 4K/2160p stream (for city-decoy labels). */
  has4k?: boolean
}
type Subtitle = { id: string; label?: string; language?: string; src?: string; source?: string }
type AudioTrack = { id: string; label: string }

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const FAV_KEY = "vuflix_movy_fav_servers"
const QUALITY_PRESETS = [
  { title: "4K", sub: "Ultra HD", minH: 2160 },
  { title: "1080p", sub: "Full HD", minH: 1080 },
  { title: "720p", sub: "HD", minH: 720 },
  { title: "480p", sub: "", minH: 480 },
  { title: "360p", sub: "", minH: 0 },
] as const


const REAL_SOURCE_NAMES: Record<string, string> = {
  vsembed: "VSEmbed",
  cineplay: "Cineplay",
  cinesu: "CineSu",
  onlyflix: "OnlyFlix",
  soapy: "SoaPy",
  telennovelas: "Telennovelas",
  cinemacity: "Cinemacity",
  movies123: "123Movies",
  vaplayer: "VAPlayer",
  athena: "Athena",
  cine4k: "Cine4K",
  vidapi: "VidAPI",
  vidnest: "VidNest",
  peachify: "Peachify",
  vixsrc: "VixSrc",
  icefy: "Icefy",
  fsharetv: "FshareTV",
  vidlink: "VidLink",
  flixhq: "FlixHQ",
  huhu: "Huhu",
  flixhqz: "Flixhqz",
  notorrent: "NoTorrent",
  vidrock: "VidRock",
  vidsrc: "Vidsrc.to",
  vidsrcsh: "VidSrc.sh",
  upcloud: "UpCloud",
  vidmoly: "Vidmoly",
  hollymoviehd: "HollyMovieHD",
  moviesonlinehd: "MoviesOnlineHD",
  moviebox: "MovieBox",
  vidapiru: "vidapi.ru",
  vidify: "Vidify",
  mafiaembed: "MafiaEmbed",
  streammafia: "StreamMafia",
  videasy: "Videasy",
  "4khdhub": "4K",
  cinejoy: "4K",
  "7movies": "7Movies",
  novahd: "NovaHD",
  anyembed: "AnyEmbed",
  bingr: "Bingr",
  filesun: "FileSuN",
  movy: "Movy",
  fmovies4u: "Fmovies4U",
  ridomovies: "RidoMovies",
  tulnex: "Tulnex",
  vidzee: "VidZee",
  popr: "Popr",
  "02moviedownloader": "02MovieDownloader",
}

const LANG_COUNTRY: Record<string, string> = {
  ar: "SA",
  de: "DE",
  en: "US",
  es: "ES",
  fr: "FR",
  hi: "IN",
  it: "IT",
  ja: "JP",
  ko: "KR",
  nl: "NL",
  pl: "PL",
  pt: "PT",
  ru: "RU",
  uk: "UA",
  tr: "TR",
  zh: "CN",
}

/** True when source.quality is a ladder/resolution tag, not an audio language. */
function isResolutionQualityTag(tag: string) {
  const t = tag.trim().toLowerCase()
  if (!t) return true
  if (/^(auto|original|default|source|hls|dash|mp4)$/.test(t)) return true
  if (/\b\d{3,4}\s*p\b/.test(t)) return true
  if (/^(4\s*k|uhd|fhd|qhd|hd|sd)\b/.test(t)) return true
  if (/^\d{3,4}$/.test(t)) return true
  return false
}

function languageFlagForLabel(label: string) {
  const code = labelToLanguageCode(label)
  const country = (code && LANG_COUNTRY[code]) || ""
  return country ? countryCodeToFlagEmoji(country) : ""
}

const KNOWN_LANGUAGE_LABELS = new Set([
  "english", "german", "french", "spanish", "italian", "portuguese", "russian",
  "turkish", "polish", "dutch", "japanese", "korean", "chinese", "hindi", "arabic",
  "thai", "vietnamese", "indonesian", "malay", "swedish", "norwegian", "danish",
  "finnish", "greek", "hebrew", "czech", "romanian", "hungarian", "bulgarian",
  "croatian", "serbian", "slovak", "slovenian", "persian", "urdu", "bengali",
  "tamil", "telugu", "malayalam", "kannada", "marathi",
  "latin american spanish", "brazilian portuguese",
  "ukrainian", "filipino",
])

function isLanguageAudioLabel(label: string) {
  const value = label.trim().toLowerCase()
  if (!value || isResolutionQualityTag(value)) return false
  if (KNOWN_LANGUAGE_LABELS.has(value)) return true
  // "English (Original)", "German Dub", etc.
  for (const name of KNOWN_LANGUAGE_LABELS) {
    if (value === name || value.startsWith(name + " ") || value.startsWith(name + "-") || value.startsWith(name + "(")) {
      return true
    }
  }
  return false
}

function sourceOffers4k(source?: Source, providerId?: string): boolean {
  const key = normalizeProviderName(
    source?.providerId || source?.provider || providerId || ""
  )
  if (!key) return false
  if (key === "athena") return false
  // Admin / default badge — title-agnostic (shows even before streams resolve).
  if (providerAdvertises4k(key)) return true
  if (source?.has4k) return true
  const q = String(source?.quality || "").toLowerCase()
  if (q.includes("2160") || q.includes("4k") || q.includes("uhd")) return true
  return false
}

function sourceSlotLabel(
  providerId: string,
  index: number,
  showReal?: boolean,
  source?: Source
) {
  const key = normalizeProviderName(providerId)
  const real = REAL_SOURCE_NAMES[key] || REAL_SOURCE_NAMES[providerId] || providerId
  const city = key === "videasy" ? "Miami" : SERVER_CITIES[index] || `Server ${index + 1}`
  const win = typeof window !== "undefined" ? (window as Window & { __toflixRealNames?: boolean }) : undefined
  // Public always sees city decoys (incl. Holly / Cine4K / Athena).
  // Real scraper names only for admin/owner / debug force flag.
  const forceReal = process.env.NEXT_PUBLIC_FORCE_REAL_PROVIDER_NAMES === "true"
  const wantReal = Boolean(forceReal || showReal || win?.__toflixRealNames)
  // Public: city decoys only. Real scraper names only for admin/owner.
  let name = wantReal ? real : city
  // Public city labels hide resolution — append · 4K when that server offers it.
  if (!wantReal && sourceOffers4k(source) && !/4\s*k|2160/i.test(name)) {
    name = `${name} · 4K`
  }
  return name
}

const SERVER_CITIES = [
  "Miami",
  "Boise",
  "Atlanta",
  "Seattle",
  "Denver",
  "Phoenix",
  "Portland",
  "Austin",
  "Dallas",
  "Tampa",
  "Orlando",
  "Chicago",
  "Boston",
  "New York",
  "Los Angeles",
  "Houston",
  "Nashville",
  "Detroit",
  "Minneapolis",
]

const SHEET_BG = "rgba(16,12,9,.96)"
const PILL_BG = "rgba(230,201,138,.18)"

function clock(seconds: number) {
  const sec = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":")
}

function runtimeLabel(mins?: number, mediaType?: string, season?: number, episode?: number) {
  const bits: string[] = []
  if (mediaType === "tv" && season && episode) {
    bits.push(`S${String(season).padStart(2, "0")} · E${String(episode).padStart(2, "0")}`)
  }
  if (mins && mins > 0) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    bits.push(h > 0 ? `${h}h ${m}m` : `${m}m`)
  }
  return bits.join("  ")
}

function heightInBand(height: number, minH: number, nextMin?: number) {
  if (nextMin) return height >= minH && height < nextMin
  return height >= minH
}

/** True when the current source ladder actually has a level in this preset band. */
function presetAvailable(qualities: Quality[], minH: number, nextMin?: number) {
  if (!qualities.length) return false
  return qualities.some((q) => heightInBand(q.height || 0, minH, nextMin))
}

/**
 * Pick the best level in-band. Returns null when the band is missing so the
 * click is a no-op (never fall back to a different tier — that felt like "nothing happened").
 */
function pickLevel(qualities: Quality[], minH: number, nextMin?: number): number | null {
  if (!qualities.length) return null
  const inBand = qualities.filter((q) => heightInBand(q.height || 0, minH, nextMin))
  if (!inBand.length) return null
  return inBand.reduce((best, q) => (q.height > (best.height || 0) ? q : best)).index
}

function isDummyAudio(track: AudioTrack) {
  const label = (track.label || "").toLowerCase()
  return (
    track.id === "default" ||
    label.includes("embedded") ||
    label === "default" ||
    label.includes("default audio") ||
    label === "default (embedded)"
  )
}

function normId(id?: string) {
  return (id || "").trim().toLowerCase()
}

function subtitleLine(sub: Subtitle) {
  return subtitleLanguageLabel({
    id: sub.id,
    label: sub.label,
    language: sub.language,
  })
}

const CC_ISO3: Record<string, string> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  por: "pt",
  rus: "ru",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
  ara: "ar",
  pol: "pl",
  tur: "tr",
  nld: "nl",
  dut: "nl",
  swe: "sv",
  hin: "hi",
  vie: "vi",
  tha: "th",
  ukr: "uk",
  ron: "ro",
  rum: "ro",
  ces: "cs",
  cze: "cs",
  ell: "el",
  gre: "el",
  heb: "he",
  ind: "id",
  fas: "fa",
  per: "fa",
}

function ccLanguageCode(sub: Subtitle): string {
  const lang = (sub.language || "").trim().toLowerCase()
  const locale = lang.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/)
  if (locale) return locale[1]
  if (CC_ISO3[lang]) return CC_ISO3[lang]
  return labelToLanguageCode(`${sub.language || ""} ${sub.label || ""}`.trim()) || ""
}

const OPENSUBS_LANG_FLAG: Record<string, string> = {
  ar: "SA",
  bg: "BG",
  cs: "CZ",
  da: "DK",
  de: "DE",
  el: "GR",
  en: "GB",
  es: "ES",
  fi: "FI",
  fr: "FR",
  he: "IL",
  hi: "IN",
  hr: "HR",
  hu: "HU",
  id: "ID",
  it: "IT",
  ja: "JP",
  ko: "KR",
  nl: "NL",
  no: "NO",
  pl: "PL",
  pt: "PT",
  ro: "RO",
  ru: "RU",
  sk: "SK",
  sr: "RS",
  sv: "SE",
  th: "TH",
  tr: "TR",
  uk: "UA",
  vi: "VN",
  zh: "CN",
}

function isOpenSubtitlesTrack(sub: Subtitle) {
  const blob = `${sub.label || ""} ${sub.id || ""} ${sub.source || ""}`.toLowerCase()
  return /opensub|opensubs|opensubtitles/.test(blob)
}

function openSubsDisplayName(sub: Subtitle) {
  // Strip source badge then resolve to a language name (never the movie file).
  const cleaned = (sub.label || "")
    .replace(/\s*[·•]\s*(OpenSubs(?:titles)?|Wyzie(?:·OS)?|Granite)\s*$/i, "")
    .trim()
  return subtitleLanguageLabel({
    id: sub.id,
    label: cleaned || sub.label,
    language: sub.language,
  })
}

function openSubsFlag(sub: Subtitle) {
  const lang = (sub.language || "").trim().toLowerCase().slice(0, 2)
  const country = OPENSUBS_LANG_FLAG[lang] || (lang.length === 2 ? lang.toUpperCase() : "UN")
  return countryCodeToFlagEmoji(country) || "🏳️"
}

function stillUrl(path?: string | null) {
  if (!path) return ""
  const file = path.startsWith("/") ? path : `/${path}`
  return `https://image.tmdb.org/t/p/w300${file}`
}

function epsMins(mins?: number | null) {
  if (!mins || mins < 1) return ""
  return `${mins}m`
}

export function MovyPlayerSkin(props: {
  show: boolean
  isPlaying: boolean
  isLoading?: boolean
  /** Hide center play / ±10 while Auto Sources loading sits over the stage. */
  hideTransportControls?: boolean
  currentTime: number
  duration: number
  isFullscreen: boolean
  mediaTitle?: string
  mediaId?: string | number
  mediaType?: string
  runtimeMinutes?: number
  season?: number
  episode?: number
  playbackRate: number
  qualities: Quality[]
  currentQuality: number
  sources?: Source[]
  currentSourceId?: string
  /** Provider the user tapped / is resolving (highlight while currentSourceId is empty). */
  activeTestingProviderId?: string
  enabledProviderIds?: string[]
  hiddenProviderIds?: string[]
  subtitles?: Subtitle[]
  currentSubtitleId?: string
  audioTracks?: AudioTrack[]
  currentAudioTrackId?: string
  subtitleFontScale?: number
  subtitleBackgroundOpacity?: number
  onTogglePlay: () => void
  onSeek: (time: number[]) => void
  onToggleFullscreen: () => void
  onPlaybackRateChange: (rate: number) => void
  onQualityChange: (level: number) => void
  onSelectSource?: (id: string) => void | Promise<void>
  onRequestProvider?: (id: string) => void | Promise<void>
  onSelectSubtitle?: (id?: string) => void
  onSelectAudioTrack?: (id: string) => void
  onSubtitleFontScaleChange?: (scale: number) => void
  onSubtitleBackgroundOpacityChange?: (opacity: number) => void
  onBack?: () => void
  /** Parent page already draws the back control (chillflix.lol watch). */
  parentHostedEmbed?: boolean
  /** Third-party player iframe (Atlantic Athena, VAPlayer, …). Our transport
   *  cannot drive cross-origin media — pass clicks through and hide seek/play. */
  iframeEmbed?: boolean
  onDoubleClick: () => void
  ratingCert?: string
  ratingAdvisories?: string[]
  tvNavigation?: {
    showId: string | number
    showTitle?: string
    currentSeason: number
    currentEpisode: number
    onEpisodeSelect: (season: number, episode: number) => void
  }
  autoNextEnabled?: boolean
  onAutoNextChange?: (enabled: boolean) => void
  onEpisodesOpenChange?: (open: boolean) => void
  showRealProviderNames?: boolean
  externalSubtitlesLoading?: boolean
}) {
  const [realNamesTick, setRealNamesTick] = useState(0)

  // Owner real names: honor prop + ?show_real=1 immediately (don't wait on postMessage).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fromQuery =
        params.get("show_real") === "1" ||
        params.get("show_real") === "true" ||
        params.get("toflixReal") === "1" ||
        params.get("toflixReal") === "true"
      if (props.showRealProviderNames || fromQuery) {
        ;(window as Window & { __toflixRealNames?: boolean }).__toflixRealNames = true
        setRealNamesTick((n) => n + 1)
      }
    } catch {
      // ignore
    }
  }, [props.showRealProviderNames])

  useEffect(() => {
    const onFlag = () => setRealNamesTick((n) => n + 1)
    window.addEventListener("chillflix-real-names", onFlag)
    // Late handoff: poll briefly in case flag flips before listener mounts.
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      if ((window as Window & { __toflixRealNames?: boolean }).__toflixRealNames) {
        setRealNamesTick((n) => n + 1)
        window.clearInterval(timer)
      } else if (Date.now() - t0 > 15000) {
        window.clearInterval(timer)
      }
    }, 400)
    return () => {
      window.removeEventListener("chillflix-real-names", onFlag)
      window.clearInterval(timer)
    }
  }, [])

  const [sheet, setSheet] = useState<null | "quality" | "cc">(null)

  // Warm Videasy bridge + resolve into cache on embed load so Sources tap is instant.
  const prefetchTmdbId = String(props.mediaId ?? props.tvNavigation?.showId ?? "").trim()
  const prefetchMedia = useMemo(() => {
    if (!/^\d+$/.test(prefetchTmdbId)) return null
    const isTv = props.mediaType === "tv"
    return {
      type: (isTv ? "tv" : "movie") as "movie" | "tv",
      tmdbId: prefetchTmdbId,
      ...(isTv
        ? {
            season: Math.max(
              1,
              Number(props.season || props.tvNavigation?.currentSeason) || 1
            ),
            episode: Math.max(
              1,
              Number(props.episode || props.tvNavigation?.currentEpisode) || 1
            ),
          }
        : {}),
    }
  }, [
    prefetchTmdbId,
    props.mediaType,
    props.season,
    props.episode,
    props.tvNavigation?.currentSeason,
    props.tvNavigation?.currentEpisode,
  ])
  useEffect(() => {
    if (!prefetchMedia) return
    let cancelled = false
    void import("@/lib/providers/videasy-client-resolver")
      .then((mod) => {
        if (cancelled) return
        mod.warmVideasyOriginBridge?.()
        // Warm miami blob as soon as the player mounts (server singleflight).
        mod.prefetchVideasyResolve?.(prefetchMedia)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [prefetchMedia])
  useEffect(() => {
    if (sheet !== "quality") return
    if (!prefetchMedia) return
    void import("@/lib/providers/videasy-client-resolver")
      .then((mod) => {
        mod.warmVideasyOriginBridge?.()
        // Background miami BFF resolve into blob/stream cache so Videasy tap is fast.
        mod.prefetchVideasyResolve?.(prefetchMedia)
      })
      .catch(() => {})
  }, [sheet, prefetchMedia])
  const [favs, setFavs] = useState<string[]>([])
  const [seeking, setSeeking] = useState(false)
  const [seekVal, setSeekVal] = useState(0)
  const [styleOpen, setStyleOpen] = useState(false)
  const [openSubsOpen, setOpenSubsOpen] = useState(false)
  const [openSubsLoading, setOpenSubsLoading] = useState(false)
  const [openSubsError, setOpenSubsError] = useState("")
  const [openSubsFetched, setOpenSubsFetched] = useState<Subtitle[]>([])
  const [ratingOn, setRatingOn] = useState(false)
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const [seasons, setSeasons] = useState<SeasonSummary[]>([])
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([])
  const [selectedSeason, setSelectedSeason] = useState(Number(props.tvNavigation?.currentSeason || 1))
  const [seasonsLoading, setSeasonsLoading] = useState(false)
  const [episodesLoading, setEpisodesLoading] = useState(false)
  const [expandedEp, setExpandedEp] = useState<number | null>(null)
  const [episodeName, setEpisodeName] = useState("")
  const tvNav = props.tvNavigation
  const isTv = props.mediaType === "tv" && !!tvNav

  const openSubsFromProps = useMemo(
    () => (props.subtitles || []).filter(isOpenSubtitlesTrack),
    [props.subtitles]
  )
  const openSubsList = openSubsFetched.length ? openSubsFetched : openSubsFromProps

  useEffect(() => {
    if (!openSubsOpen) return
    if (openSubsFromProps.length) {
      setOpenSubsFetched([])
      setOpenSubsError("")
      setOpenSubsLoading(false)
      return
    }
    const mediaId = props.mediaId ?? props.tvNavigation?.showId
    const mediaType = (props.mediaType === "tv" ? "tv" : "movie") as "movie" | "tv"
    if (!mediaId) {
      setOpenSubsError("Missing media id")
      setOpenSubsLoading(false)
      return
    }
    let dead = false
    setOpenSubsLoading(true)
    setOpenSubsError("")
    const params = new URLSearchParams({
      type: mediaType,
      tmdbId: String(mediaId),
    })
    if (mediaType === "tv") {
      const season = props.season || props.tvNavigation?.currentSeason
      const episode = props.episode || props.tvNavigation?.currentEpisode
      if (season) params.set("season", String(season))
      if (episode) params.set("episode", String(episode))
    }
    void fetch(`/api/external-subtitles?${params.toString()}&lang=en`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`captions HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (dead) return
        const rows = Array.isArray(data?.subtitles) ? data.subtitles : []
        const mapRow = (row: Subtitle & { source?: string; src?: string; default?: boolean }) => ({
          id: String(row.id),
          label: String(row.label || ""),
          language: row.language,
          src: String(row.src || ""),
          source: row.source,
          default: Boolean(row.default),
        })
        const filtered = rows
          .filter((row: Subtitle & { source?: string }) => isOpenSubtitlesTrack(row))
          .map(mapRow)
        const fallback = rows
          .filter((row: { source?: string }) =>
            /opensub|opensubs/i.test(String(row.source || ""))
          )
          .map(mapRow)
        setOpenSubsFetched(filtered.length ? filtered : fallback)
      })
      .catch(() => {
        if (!dead) {
          setOpenSubsFetched([])
          setOpenSubsError("Could not load captions")
        }
      })
      .finally(() => {
        if (!dead) setOpenSubsLoading(false)
      })
    return () => {
      dead = true
    }
  }, [
    openSubsOpen,
    openSubsFromProps.length,
    props.mediaId,
    props.mediaType,
    props.season,
    props.episode,
    props.tvNavigation?.showId,
    props.tvNavigation?.currentSeason,
    props.tvNavigation?.currentEpisode,
  ])


  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]")
      if (Array.isArray(raw)) setFavs(raw.map(String))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    props.onEpisodesOpenChange?.(episodesOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodesOpen])

  useEffect(() => {
    if (!tvNav) return
    setSelectedSeason(Number(tvNav.currentSeason || 1))
    setExpandedEp(null)
  }, [tvNav?.showId, tvNav?.currentSeason, tvNav?.currentEpisode])

  useEffect(() => {
    if (!tvNav) return
    let dead = false
    const seasonNum = tvNav.currentSeason || 1
    void cfResilientFetch(`/api/tv/${tvNav.showId}/season/${seasonNum}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (dead) return
        const list = Array.isArray(data?.episodes) ? (data.episodes as EpisodeSummary[]) : []
        const hit = list.find((ep) => ep.episode_number === (tvNav.currentEpisode || 1))
        if (hit && hit.name) setEpisodeName(hit.name)
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [tvNav?.showId, tvNav?.currentSeason, tvNav?.currentEpisode])

  useEffect(() => {
    if (!episodesOpen || !tvNav) return
    let dead = false
    setSeasonsLoading(true)
    void cfResilientFetch(`/api/tv/${tvNav.showId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (dead || !data || !Array.isArray(data.seasons)) return
        setSeasons(
          (data.seasons as SeasonSummary[]).filter((s) => s.season_number > 0)
        )
      })
      .catch(() => {})
      .finally(() => {
        if (!dead) setSeasonsLoading(false)
      })
    return () => {
      dead = true
    }
  }, [episodesOpen, tvNav?.showId])

  useEffect(() => {
    if (!episodesOpen || !tvNav) return
    let dead = false
    setEpisodesLoading(true)
    void cfResilientFetch(`/api/tv/${tvNav.showId}/season/${selectedSeason}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (dead) return
        const list = Array.isArray(data?.episodes) ? (data.episodes as EpisodeSummary[]) : []
        setEpisodes(list)
        if (selectedSeason === (tvNav.currentSeason || 1)) {
          const hit = list.find((ep) => ep.episode_number === (tvNav.currentEpisode || 1))
          if (hit && hit.name) setEpisodeName(hit.name)
        }
      })
      .catch(() => {
        if (!dead) setEpisodes([])
      })
      .finally(() => {
        if (!dead) setEpisodesLoading(false)
      })
    return () => {
      dead = true
    }
  }, [episodesOpen, tvNav?.showId, selectedSeason, tvNav?.currentSeason, tvNav?.currentEpisode])

  const ratingTitle = (props.ratingCert || "").trim()
    ? /^rated\s+/i.test(props.ratingCert || "")
      ? (props.ratingCert || "").trim().toUpperCase()
      : `RATED ${(props.ratingCert || "").trim().toUpperCase()}`
    : ""
  const ratingBits = (props.ratingAdvisories || [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3)
  const ratingLine = ratingBits.join(", ")

  useEffect(() => {
    if (!ratingTitle) {
      setRatingOn(false)
      return
    }
    setRatingOn(false)
    const show = window.setTimeout(() => setRatingOn(true), 4800)
    const hide = window.setTimeout(() => setRatingOn(false), 12000)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(hide)
    }
  }, [ratingTitle, ratingLine, props.mediaTitle, props.season, props.episode])

  // Never coerce unknown duration to 1s — that made Continue Watching show
  // 00:39:01 / 00:00:01 with a full bar on broken/cold FileSuN streams.
  const rawDuration = Number(props.duration) || 0
  const fallbackDuration = Number(props.expectedDurationSec) || 0
  const duration =
    rawDuration >= 45
      ? rawDuration
      : fallbackDuration >= 45
        ? fallbackDuration
        : 0
  const progress = seeking
    ? seekVal
    : duration > 0
      ? Math.min(1, Math.max(0, props.currentTime / duration))
      : 0
  const meta = isTv
    ? [`S${props.season || tvNav?.currentSeason || 1}`, `E${props.episode || tvNav?.currentEpisode || 1}`, episodeName]
        .filter(Boolean)
        .join(" ")
    : runtimeLabel(props.runtimeMinutes, props.mediaType, props.season, props.episode)
  const sources = props.sources || []
  const serverRows = useMemo(() => {
    const hidden = new Set((props.hiddenProviderIds || []).map(normId))
    // Prefer the admin-enabled list from props, then the module cache from
    // /api/stream-sources. Falling back to only *resolved* playback sources
    // made the sheet show a lone FileSuN while VAPlayer/Videasy/Movy were
    // still enabled (common on TV when bulk only returned FileSuN).
    const fromProps = (props.enabledProviderIds || [])
      .map(normId)
      .filter((id) => id && !hidden.has(id))
    const fromCache = getEnabledProviderIds()
      .map(normId)
      .filter((id) => id && !hidden.has(id))
    let ids = fromProps.length ? fromProps : fromCache
    if (!ids.length) {
      ids = sources
        .map((s) => normId(s.providerId) || "")
        .filter((id) => id && !hidden.has(id))
    }
    const currentPid = normId(
      sources.find((s) => s.id === props.currentSourceId)?.providerId
    )
    const pendingPid = normId(props.activeTestingProviderId)
    const highlightPid =
      currentPid ||
      (!props.currentSourceId && pendingPid ? pendingPid : "")
    if (currentPid && !ids.includes(currentPid)) {
      ids = [currentPid, ...ids]
    }
    if (pendingPid && !ids.includes(pendingPid)) {
      ids = [pendingPid, ...ids]
    }
    const seen = new Set<string>()
    const unique: string[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      unique.push(id)
    }
    return unique.slice(0, SERVER_CITIES.length).map((providerId, index) => {
      const source = sources.find(
        (s) => normId(s.providerId) === providerId || s.id === providerId
      )
      // Prefer a 4K sibling for this provider when labeling city decoys.
      const fourKSibling =
        sourceOffers4k(source, providerId)
          ? source
          : sources.find(
              (s) =>
                normId(s.providerId) === providerId && sourceOffers4k(s, providerId)
            )
      // Synthetic source so ·4K still applies when streams have not resolved yet.
      const labelSource =
        fourKSibling ||
        source ||
        (providerAdvertises4k(providerId)
          ? ({ providerId, has4k: true } as Source)
          : undefined)
      return {
        providerId,
        sourceId: source?.id,
        name: sourceSlotLabel(
          providerId,
          index,
          props.showRealProviderNames,
          labelSource
        ),
        on: Boolean(
          (source && source.id === props.currentSourceId) ||
            (!!highlightPid && highlightPid === providerId)
        ),
      }
    })
  }, [
    props.activeTestingProviderId,
    props.enabledProviderIds,
    props.hiddenProviderIds,
    props.currentSourceId,
    props.showRealProviderNames,
    realNamesTick,
    sources,
  ])
  const languageRows = useMemo(() => {
    type LangRow = {
      id: string
      label: string
      flag: string
      on: boolean
      kind: "source" | "audio" | "pending"
      providerId?: string
    }
    const rows: LangRow[] = []
    const seen = new Set<string>()

    // Languages belong to the ACTIVE server only. Listing every provider's
    // "English" made a 7Movies tap jump to Athena (same label, different id).
    const active = sources.find((s) => s.id === props.currentSourceId)
    const activeProvider =
      normId(active?.providerId) || normId(active?.provider) || ""

    for (const s of sources) {
      const providerId = normId(s.providerId) || normId(s.provider) || ""
      if (activeProvider && providerId && providerId !== activeProvider) continue
      const label = String(s.quality || "").trim()
      if (!label || !isLanguageAudioLabel(label)) continue
      const key = `${providerId}:${label.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        id: s.id,
        label,
        flag: languageFlagForLabel(label),
        on: s.id === props.currentSourceId,
        kind: "source",
        providerId: providerId || undefined,
      })
    }

    if (rows.length === 0) {
      for (const t of props.audioTracks || []) {
        if (isDummyAudio(t)) continue
        const label = String(t.label || "").trim()
        if (!label || !isLanguageAudioLabel(label)) continue
        const key = label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          id: t.id,
          label,
          flag: languageFlagForLabel(label),
          on: t.id === props.currentAudioTrackId,
          kind: "audio",
        })
      }
    }

    rows.sort((a, b) => {
      if (a.label.toLowerCase() === "english") return -1
      if (b.label.toLowerCase() === "english") return 1
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    })
    return rows
  }, [props.audioTracks, props.currentAudioTrackId, props.currentSourceId, sources])

  // Only show Languages when we actually have language rows — an empty
  // "Loading…" stub on Videasy/Movy made the left column look broken.
  const showLanguagesPanel = languageRows.length > 0

  const selectedQuality = props.qualities.find((q) => q.index === props.currentQuality)
  // Auto (-1): prefer Full HD for the badge/sheet — NEVER surface max height
  // (4K) just because the ladder includes it. That made Movy/Videasy look
  // like they "defaulted to 4K" / "went back to 4K" while on Auto.
  const currentH = (() => {
    if (selectedQuality && (selectedQuality.height || 0) > 0) {
      return selectedQuality.height || 0
    }
    if (props.currentQuality < 0) {
      const heights = (props.qualities || [])
        .map((q) => q.height || 0)
        .filter((h) => h >= 360)
      if (heights.includes(1080)) return 1080
      const under = heights.filter((h) => h <= 1080).sort((a, b) => b - a)
      if (under[0]) return under[0]
      return 0
    }
    return 0
  })()
  const currentQLabel =
    props.currentQuality < 0 && currentH <= 0
      ? props.qualities.length
        ? "Auto"
        : "—"
      : currentH >= 2160
        ? "4K"
        : currentH >= 1080
          ? "1080p"
          : currentH >= 720
            ? "720p"
            : currentH >= 480
              ? "480p"
              : currentH > 0
                ? "360p"
              : props.qualities.length
                ? "Auto"
                : "—"

  const availablePresets = useMemo(() => {
    const rows = QUALITY_PRESETS.map((row, i) => ({
      ...row,
      nextMin: QUALITY_PRESETS[i - 1]?.minH as number | undefined,
    }))
    const current = props.sources?.find((s) => s.id === props.currentSourceId)
    const tag = String(current?.quality || "").toLowerCase()
    const providerKey = String(
      current?.providerId ||
        (typeof current?.provider === "string" ? current.provider : "") ||
        ""
    )
      .trim()
      .toLowerCase()
    const labelLooksAthena = /athena|atlantic/i.test(
      String(current?.label || current?.provider || "")
    )
    const label = String(current?.label || "").toLowerCase()
    // Discrete URL-per-quality ladders (Videasy etc.) — never collapse to 4K-only.
    const discreteHeights = new Set(
      (props.qualities || [])
        .map((q) => q.height || 0)
        .filter((h) => h >= 360)
    )
    const hasDiscreteLadder = discreteHeights.size > 1
    // Cinejoy / 4khdhub are branded "4K" in the server list even when the
    // quality field is "Auto" and mobile Chrome stripped the HEVC rung.
    const abrHlsProvider =
      providerKey === "rivestream" ||
      providerKey === "vaplayer" ||
      providerKey === "novahd" ||
      providerKey === "vidmoly"
    const sourceIs4k =
      !hasDiscreteLadder &&
      providerKey !== "athena" &&
      !abrHlsProvider &&
      (providerKey === "cinejoy" ||
        providerKey === "4khdhub" ||
        /4\s*k|2160|uhd/.test(tag) ||
        /(?:^|[\s·.•_-])4\s*k(?:$|[\s·.•_-])/.test(label) ||
        /2160|uhd/.test(label))
    const fromLadder = rows.filter((row) =>
      presetAvailable(props.qualities, row.minH, row.nextMin)
    )
    // Athena/Atlantic: HD-only sheet. Never invent 4K Ultra HD from tag/ladder.
    const isAthenaUi = providerKey === "athena" || labelLooksAthena
    let available = isAthenaUi
      ? fromLadder.filter((row) => row.title !== "4K")
      : fromLadder
    if (isAthenaUi) {
      if (available.length) return available
      // Remap any 4K/2160 tag or lone 2160 level to 1080p Full HD.
      if (
        /2160|4\s*k|uhd|1080|fhd/.test(tag) ||
        (props.qualities || []).some((q) => (q.height || 0) >= 1080)
      ) {
        return rows.filter((r) => r.title === "1080p")
      }
      if (/720/.test(tag) || tag === "hd" || (props.qualities || []).some((q) => (q.height || 0) >= 720)) {
        return rows.filter((r) => r.title === "720p")
      }
      return rows.filter((r) => r.title === "1080p")
    }
    // Do not invent a dead 4K row for cinejoy — its 4K rung is often HEVC-only
    // and already missing from props.qualities after MSE filtering.
    if (
      sourceIs4k &&
      providerKey !== "cinejoy" &&
      !available.some((r) => r.title === "4K")
    ) {
      const fourK = rows.find((r) => r.title === "4K")
      if (fourK) available = [fourK, ...available]
    }
    if (available.length) return available
    // Rive (and similar ABR HLS): never collapse to a lone synthetic 4K row.
    // Brand New Day was tagged 2160p while the sheet stayed empty / 4K-only.
    if (
      providerKey === "rivestream" ||
      providerKey === "vaplayer" ||
      providerKey === "novahd" ||
      providerKey === "vidmoly"
    ) {
      const ladder = rows.filter((r) =>
        ["4K", "1080p", "720p", "480p"].includes(r.title)
      )
      if (/2160|4\s*k|uhd/.test(tag)) return ladder
      if (/1080|fhd/.test(tag)) {
        return rows.filter((r) =>
          r.title === "1080p" || r.title === "720p" || r.title === "480p"
        )
      }
      if (/720/.test(tag) || tag === "hd") {
        return rows.filter((r) => r.title === "720p" || r.title === "480p")
      }
      return rows.filter((r) =>
        r.title === "1080p" || r.title === "720p" || r.title === "480p"
      )
    }
    if (sourceIs4k && providerKey !== "cinejoy") {
      return rows.filter((r) => r.title === "4K")
    }
    // Single progressive file (HollyMovieHD / Pixeldrain MP4): use the source tag
    // even when HLS levels never populate props.qualities.
    if (/2160|4\s*k|uhd/.test(tag)) return rows.filter((r) => r.title === "4K")
    if (/1080|fhd/.test(tag)) return rows.filter((r) => r.title === "1080p")
    if (/720/.test(tag) || tag === "hd") return rows.filter((r) => r.title === "720p")
    if (/480|360|sd/.test(tag)) return rows.filter((r) => r.title === "480p")
    // Manual single-file hosts sometimes still send a host label (e.g. old "Pixeldrain").
    if (providerKey === "hollymoviehd" || providerKey === "moviesonlinehd") {
      return rows.filter((r) => r.title === "720p")
    }
    // One synthetic rung already in props.qualities.
    if ((props.qualities || []).length === 1) {
      const h = props.qualities![0].height || 0
      if (h >= 2160) return rows.filter((r) => r.title === "4K")
      if (h >= 1080) return rows.filter((r) => r.title === "1080p")
      if (h >= 720) return rows.filter((r) => r.title === "720p")
      if (h >= 480) return rows.filter((r) => r.title === "480p")
      if (h > 0) return rows.filter((r) => r.title === "360p")
    }
    // HLS still loading / proxy cold start: never show an empty Quality sheet.
    // Rive/VAPlayer/NovaHD often open settings before MANIFEST_PARSED fills levels.
    if (
      providerKey === "rivestream" ||
      providerKey === "vaplayer" ||
      providerKey === "novahd" ||
      providerKey === "vidmoly"
    ) {
      // Rivestream masters are often 2160-tagged; include 4K so we don't
      // default-highlight a flaky 1080p rung before MANIFEST_PARSED.
      if (providerKey === "rivestream") {
        return rows.filter((r) =>
          r.title === "4K" ||
          r.title === "1080p" ||
          r.title === "720p" ||
          r.title === "480p"
        )
      }
      return rows.filter((r) =>
        r.title === "1080p" || r.title === "720p" || r.title === "480p"
      )
    }
    if (fromLadder.length) return fromLadder
    return rows.filter((r) => r.title === "1080p" || r.title === "720p")
  }, [props.qualities, props.sources, props.currentSourceId])

  const activePreset = useMemo(() => {
    if (currentH >= 2160) return "4K"
    if (currentH >= 1080) return "1080p"
    if (currentH >= 720) return "720p"
    if (currentH >= 480) return "480p"
    if (currentH > 0) return "360p"
    const curSrc = props.sources?.find((s) => s.id === props.currentSourceId)
    const pKey = String(
      curSrc?.providerId ||
        (typeof curSrc?.provider === "string" ? curSrc.provider : "") ||
        ""
    )
      .trim()
      .toLowerCase()
    // Rivestream: 1080p often stalls; highlight 4K when the sheet offers it.
    if (
      pKey === "rivestream" &&
      availablePresets.some((r) => r.title === "4K")
    ) {
      return "4K"
    }
    // Auto / unknown: prefer Full HD row, never the first preset (often 4K).
    if (availablePresets.some((r) => r.title === "1080p")) return "1080p"
    return (
      availablePresets.find((r) => r.title !== "4K")?.title ||
      availablePresets[0]?.title ||
      ""
    )
  }, [currentH, availablePresets, props.sources, props.currentSourceId])

  const audioTracks = (props.audioTracks || []).filter((t) => !isDummyAudio(t))
  const subtitles = props.subtitles || []
  const activeCcCode = (() => {
    const id = props.currentSubtitleId
    if (!id) return ""
    const sub = subtitles.find((item) => item.id === id)
    return sub ? ccLanguageCode(sub) : ""
  })()

  const toggleFav = (id: string) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const visible = (props.show || !!sheet) && !episodesOpen // clickfix-20261110

  const iframeEmbed = Boolean(props.iframeEmbed)

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[80]"
      onDoubleClick={iframeEmbed ? undefined : props.onDoubleClick}
      data-movy-skin="1"
      data-iframe-embed={iframeEmbed ? "1" : undefined}
    >
      <style>{`
        .movy-embed-host video{object-fit:contain!important;background:#000}
        .movy-embed-host video::-webkit-media-controls,
        .movy-embed-host video::-webkit-media-controls-enclosure,
        .movy-embed-host video::-webkit-media-controls-panel,
        .movy-embed-host video::-webkit-media-controls-overlay-enclosure,
        .movy-embed-host video::-internal-media-controls-overlay-cast-button{display:none!important;opacity:0!important}
        .movy-embed-host iframe[src*="youtube"],
        .movy-embed-host iframe[src*="youtu.be"],
        .movy-embed-host iframe[src*="doubleclick"],
        .movy-embed-host iframe[src*="googlesyndication"],
        .movy-embed-host iframe[src*="googletag"],
        .movy-embed-host [id^="google_ads"],
        .movy-embed-host [class*="ytp-miniplayer"],
        .movy-embed-host [class*="ytp-pause-overlay"]{display:none!important}
        .movy-range{-webkit-appearance:none!important;appearance:none!important;width:100%;height:22px;margin:0;cursor:pointer;background:transparent!important;background-color:transparent!important;border:0;outline:0;box-shadow:none;color:transparent}
        .movy-range::-webkit-slider-container{background:transparent!important}
        .movy-range::-webkit-slider-runnable-track{height:2px;background:transparent!important;border:0;color:transparent}
        .movy-range::-webkit-slider-thumb{-webkit-appearance:none!important;appearance:none!important;width:12px;height:12px;margin-top:-5px;border-radius:999px;background:#e6c98a;border:0;box-shadow:0 0 0 4px rgba(16,12,9,.55)}
        .movy-range::-moz-range-track{height:2px;background:transparent;border:0}
        .movy-range::-moz-range-progress{height:2px;background:transparent;border:0}
        .movy-range::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:999px;background:#e6c98a}
        [data-iframe-embed="1"] .movy-range::-webkit-slider-thumb{opacity:0;width:0;height:0;margin:0;box-shadow:none}
        [data-iframe-embed="1"] .movy-range::-moz-range-thumb{opacity:0;width:0;height:0}
        .movy-rated{overflow:hidden;will-change:clip-path,transform,opacity}
        .movy-eps-scroll{scrollbar-width:none;-ms-overflow-style:none}
        .movy-eps-scroll::-webkit-scrollbar{display:none;width:0;height:0}
      `}</style>

      {ratingTitle && !sheet && !episodesOpen ? (
        <div
          className="movy-rated pointer-events-none absolute left-5 z-[15] flex items-stretch gap-[10px]"
          style={{
            top: "max(86px, calc(env(safe-area-inset-top) + 72px))",
            opacity: ratingOn ? 1 : 0,
            transform: ratingOn ? "translateX(0)" : "translateX(-22px)",
            clipPath: ratingOn ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
            transition: ratingOn
              ? "opacity .5s ease, transform 1.15s cubic-bezier(.22,.7,.28,1), clip-path 1.25s cubic-bezier(.22,.7,.28,1)"
              : "opacity .4s ease, transform .4s ease, clip-path .4s ease",
          }}
        >
          <div className="min-w-0 border-l border-[#e6c98a] pl-3">
            <p
              className="text-[12px] font-medium uppercase leading-none tracking-[0.22em] text-[#e6c98a]"
              style={{ fontFamily: "Georgia, Palatino, 'Times New Roman', serif" }}
            >
              {ratingTitle}
            </p>
            {ratingLine ? (
              <p className="mt-[7px] text-[13px] font-normal leading-none text-[#f6f1e8]/60">
                {ratingLine}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={
          visible
            ? "pointer-events-none absolute inset-0 opacity-100"
            : "pointer-events-none absolute inset-0 opacity-0"
        }
        style={{ transition: "opacity .2s ease" }}
      >
        <div className={`${iframeEmbed ? "pointer-events-none" : "pointer-events-auto"} absolute inset-x-5 top-0 z-10 flex items-start pt-[max(16px,env(safe-area-inset-top))] md:inset-x-8`}>
          {props.parentHostedEmbed ||
          (typeof window !== "undefined" && window.self !== window.top) ? (
            // Parent watch page already mounts #watchPersistBack — hide this twin.
            <div className="mt-0.5 h-11 w-11 shrink-0" aria-hidden="true" />
          ) : (
            <button
              type="button"
              aria-label="Back"
              className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center text-white"
              onClick={(e) => {
                e.stopPropagation()
                props.onBack?.()
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 19-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-[10px] font-medium uppercase leading-none tracking-[0.32em] text-[#e6c98a]">
              Now showing
            </p>
            <h1
              className="mt-1.5 truncate text-[22px] font-medium leading-none text-[#f6f1e8]"
              style={{ fontFamily: "Georgia, Palatino, 'Times New Roman', serif" }}
            >
              {props.mediaTitle || ""}
            </h1>
            {meta ? (
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[#f6f1e8]/55">{meta}</p>
            ) : null}
          </div>
        </div>

        {!props.hideTransportControls ? (
        <div
          className={`${iframeEmbed ? "pointer-events-none" : "pointer-events-auto"} absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2 items-center gap-7`}
          style={{ opacity: sheet ? 0.55 : 1 }}
        >
          <button
            type="button"
            aria-label="Back 10 seconds"
            className="text-[15px] tracking-[0.12em] text-[#f6f1e8]/75 active:scale-95"
            onClick={(e) => {
              e.stopPropagation()
              if (sheet) return
              props.onSeek([Math.max(0, props.currentTime - 10)])
            }}
          >
            −10
          </button>
          <button
            type="button"
            aria-label={props.isPlaying ? "Pause" : "Play"}
            className="grid h-16 w-16 place-items-center text-[#f6f1e8] active:scale-95"
            onClick={(e) => {
              e.stopPropagation()
              if (sheet) return
              props.onTogglePlay()
            }}
          >
            {props.isPlaying ? (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5.8" y="3.8" width="4.1" height="16.4" rx="1" />
                <rect x="14.1" y="3.8" width="4.1" height="16.4" rx="1" />
              </svg>
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.2v13.6L19 12 8 5.2Z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label="Forward 10 seconds"
            className="text-[15px] tracking-[0.12em] text-[#f6f1e8]/75 active:scale-95"
            onClick={(e) => {
              e.stopPropagation()
              if (sheet) return
              props.onSeek([Math.min(duration, props.currentTime + 10)])
            }}
          >
            +10
          </button>
        </div>
        ) : null}
      </div>

      <div
        className={
          episodesOpen
            ? "pointer-events-none absolute inset-x-0 bottom-0 z-10 opacity-0"
            : iframeEmbed
              ? "pointer-events-none absolute inset-x-0 bottom-0 z-10"
            : "pointer-events-auto absolute inset-x-0 bottom-0 z-10"
        }
      >
          <div
            className={`px-5 pb-[max(6px,env(safe-area-inset-bottom))] pt-2 md:px-8${
              iframeEmbed
                ? " bg-gradient-to-t from-[#100c09] via-[#100c09]/92 to-transparent"
                : ""
            }`}
          >
          <div className={`relative h-[22px]${iframeEmbed ? " pointer-events-none opacity-90" : ""}`}>
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#f6f1e8]/35" />
            {!iframeEmbed ? (
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[#f3ddb0]"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
            ) : null}
            <input
              className="movy-range absolute inset-0"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={iframeEmbed ? 0 : Math.round(progress * 1000)}
              disabled={iframeEmbed}
              aria-label="Seek"
              onPointerDown={() => setSeeking(true)}
              onPointerUp={() => setSeeking(false)}
              onChange={(e) => {
                const next = Number(e.target.value) / 1000
                setSeekVal(next)
                props.onSeek([next * duration])
              }}
            />
          </div>
          <div
            className="overflow-hidden"
            style={{
              maxHeight: visible ? 44 : 0,
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition:
                "max-height .38s cubic-bezier(.22,1,.36,1), opacity .28s ease, transform .38s cubic-bezier(.22,1,.36,1)",
              pointerEvents: visible ? (iframeEmbed ? "none" : "auto") : "none",
            }}
          >
          <div className={`mt-1 flex items-center gap-1${iframeEmbed ? " pointer-events-auto" : ""}`}>
            <span className="min-w-[92px] shrink-0 text-[12px] font-medium tabular-nums tracking-wide">
              {iframeEmbed ? (
                <span className="text-[#f6f1e8]/45">Streaming</span>
              ) : (
                <>
                  <span className="text-[#f7f4ee]">{clock(seeking ? seekVal * (duration || 0) : props.currentTime)}</span>
                  <span className="text-[#f3ddb0]">{" / "}{duration > 0 ? clock(duration) : "--:--:--"}</span>
                </>
              )}
            </span>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              <button
                type="button"
                aria-label="Quality"
                className="inline-flex h-9 items-center px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#f6f1e8]/80"
                onClick={(e) => {
                  e.stopPropagation()
                  if (prefetchMedia) {
                    /* no popup */ void 0
                    void import("@/lib/providers/videasy-client-resolver")
                      .then((m) => {
                        m.warmVideasyOriginBridge?.()
                        m.prefetchVideasyResolve?.(prefetchMedia)
                        try {
                          ;(
                            window as unknown as { __videasyPrime?: () => void }
                          ).__videasyPrime = m.primeVideasyBridgeGesture
                        } catch {
                          /* ignore */
                        }
                                              })
                      .catch(() => {})
                  }
                  setSheet((s) => (s === "quality" ? null : "quality"))
                  setStyleOpen(false)
                }}
              >
                {currentQLabel}
              </button>
              {!iframeEmbed ? (
              <button
                type="button"
                aria-label={activeCcCode ? `Subtitles, ${activeCcCode}` : "Audio and subtitles"}
                className={
                  props.currentSubtitleId
                    ? "inline-flex h-9 flex-col items-center justify-center px-2 leading-none text-[#f6f1e8]"
                    : "inline-flex h-9 items-center px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#f6f1e8]/80"
                }
                onClick={(e) => {
                  e.stopPropagation()
                  setSheet((s) => (s === "cc" ? null : "cc"))
                  setStyleOpen(false)
                  setOpenSubsOpen(false)
                }}
              >
                {props.currentSubtitleId ? (
                  <>
                    <span className="border-b border-[#f3ddb0] pb-px text-[11px] font-medium uppercase leading-none tracking-[0.18em]">
                      CC
                    </span>
                    {activeCcCode ? (
                      <span className="mt-[3px] text-[9px] font-semibold lowercase leading-none tracking-normal text-[#f6f1e8]">
                        {activeCcCode}
                      </span>
                    ) : null}
                  </>
                ) : (
                  "CC"
                )}
              </button>
              ) : null}
              {isTv ? (
                <button
                  type="button"
                  aria-label="Episodes"
                  className="inline-flex h-9 items-center gap-1 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#f6f1e8]/80"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSheet(null)
                    setStyleOpen(false)
                    setSelectedSeason(tvNav?.currentSeason || 1)
                    setEpisodesOpen(true)
                  }}
                >
                  Episodes
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 15 6-6 6 6" />
                  </svg>
                </button>
              ) : null}
            </div>
            <div className="flex min-w-[40px] justify-end">
              <button
                type="button"
                aria-label="Fullscreen"
                className="grid h-9 w-9 place-items-center text-[#f6f1e8]/80"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onToggleFullscreen()
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
                </svg>
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>

      {episodesOpen && isTv && tvNav ? (
        <div
          className="pointer-events-auto absolute inset-0 z-30 flex flex-col"
          style={{
            background:
              "linear-gradient(180deg, rgba(28,18,12,.9) 0%, rgba(16,12,9,.96) 24%, #100c09 48%)",
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex shrink-0 items-start gap-3 px-5"
            style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}
          >
            <div className="min-w-0 flex-1 pt-1">
              <h2
                className="text-[28px] font-medium leading-none text-[#f6f1e8]"
                style={{ fontFamily: "Georgia, Palatino, 'Times New Roman', serif" }}
              >
                Episodes
              </h2>
              <p className="mt-[8px] truncate text-[14px] font-normal leading-none text-white/45">
                {tvNav.showTitle || props.mediaTitle || ""}
              </p>
            </div>
            <div
              className="mt-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-full pl-2.5 pr-1.5"
              style={{ background: "rgba(255,255,255,.08)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-white/80">
                <path d="M5 5.2v13.6l8.8-6.8L5 5.2Z" />
                <rect x="16.2" y="5.4" width="2.4" height="13.2" rx="0.6" />
              </svg>
              <span className="text-[13px] font-medium text-white">Auto next</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!props.autoNextEnabled}
                aria-label="Auto next"
                className="relative h-[22px] w-[38px] shrink-0 rounded-full"
                style={{ background: props.autoNextEnabled ? "#e6c98a" : "#3a3228" }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onAutoNextChange?.(!props.autoNextEnabled)
                }}
              >
                <span
                  className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-[#100c09]"
                  style={{
                    left: props.autoNextEnabled ? 18 : 2,
                    transition: "left .18s ease",
                  }}
                />
              </button>
            </div>
            <button
              type="button"
              aria-label="Close episodes"
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center text-white"
              onClick={(e) => {
                e.stopPropagation()
                setEpisodesOpen(false)
                setExpandedEp(null)
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="mt-4 flex min-h-0 flex-1">
            <div className="movy-eps-scroll w-[38%] shrink-0 overflow-y-auto overscroll-contain px-3 pb-6">
              {seasonsLoading ? (
                <p className="px-3 py-8 text-center text-[13px] text-white/40">Loading…</p>
              ) : (
                seasons.map((season) => {
                  const on = season.season_number === selectedSeason
                  const rowStyle = on ? { background: "rgba(255,255,255,.08)" } : undefined
                  return (
                    <button
                      key={season.id || season.season_number}
                      type="button"
                      onClick={() => {
                        setSelectedSeason(season.season_number)
                        setExpandedEp(null)
                      }}
                      className="mb-1 flex w-full items-center justify-between rounded-[14px] px-3 py-[10px] text-left"
                      style={rowStyle}
                    >
                      <span className={on ? "text-[15px] font-semibold text-white" : "text-[15px] font-medium text-white/55"}>
                        Season {season.season_number}
                      </span>
                      <span className={on ? "text-[12px] text-white/45" : "text-[12px] text-white/30"}>
                        {season.episode_count} Eps
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="movy-eps-scroll min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6 pr-4">
              {episodesLoading ? (
                <p className="px-3 py-8 text-center text-[13px] text-white/40">Loading…</p>
              ) : episodes.length ? (
                episodes.map((ep) => {
                  const curS = Number(tvNav.currentSeason || 1)
                  const curE = Number(tvNav.currentEpisode || 1)
                  const watching =
                    Number(selectedSeason) === curS && Number(ep.episode_number) === curE
                  const thumb = stillUrl(ep.still_path)
                  const open = expandedEp === ep.episode_number
                  const mins = epsMins(ep.runtime)
                  const thumbStyle = thumb
                    ? {
                        backgroundImage: "url(" + thumb + ")",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                  return (
                    <div
                      key={ep.id || ep.episode_number}
                      className="mb-2 overflow-hidden rounded-[16px]"
                      style={{ background: "rgba(255,255,255,.06)" }}
                    >
                      <div className="flex items-center gap-2.5 p-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          onClick={() => {
                            tvNav.onEpisodeSelect(selectedSeason, ep.episode_number)
                            if (ep.name) setEpisodeName(ep.name)
                            setEpisodesOpen(false)
                            setExpandedEp(null)
                          }}
                        >
                          <span
                            className="relative h-[52px] w-[92px] shrink-0 overflow-hidden rounded-[10px] bg-white/10"
                            style={thumbStyle}
                          >
                            {watching ? (
                              <span
                                className="absolute left-1 top-1 rounded-full px-[6px] py-[2px] text-[9px] font-semibold leading-none text-white"
                                style={{ background: "rgba(20,20,20,.72)" }}
                              >
                                Watching
                              </span>
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold leading-tight text-white">
                              {ep.name || `Episode ${ep.episode_number}`}
                            </span>
                            <span className="mt-[3px] block text-[12px] leading-none text-white/40">
                              {`S${selectedSeason} E${ep.episode_number}${mins ? ` · ${mins}` : ""}`}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={open ? "Hide episode details" : "Show episode details"}
                          className="grid h-9 w-9 shrink-0 place-items-center text-white/55"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedEp(open ? null : ep.episode_number)
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ transform: open ? "rotate(180deg)" : undefined }}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                      {open && ep.overview ? (
                        <p className="px-3 pb-3 text-[12px] leading-snug text-white/50">
                          {ep.overview}
                        </p>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <p className="px-3 py-8 text-center text-[13px] text-white/40">No episodes</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="absolute inset-0 z-[90] flex items-center justify-center px-5"
        aria-hidden={sheet ? undefined : true}
        style={{
          // Keep mounted — remounting this overlay over <video> blanks a frame
          // on Android Chrome. visibility avoids that compositor hit.
          visibility: sheet ? "visible" : "hidden",
          pointerEvents: sheet ? "auto" : "none",
        }}
        onClick={() => {
          setSheet(null)
          setStyleOpen(false)
        }}
      >
          <div
            className="flex max-h-[min(70dvh,640px)] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[18px] border-0"
            style={{ background: SHEET_BG }}
            onClick={(e) => e.stopPropagation()}
          >
            {(!sheet || sheet === "quality") ? (
              <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3.5 pt-3.5">
                <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.35fr] gap-2">
                  <div className="flex min-h-0 flex-col overflow-auto">
                    <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      Quality
                    </p>
                    {availablePresets.length ? (
                      availablePresets.map((row) => {
                        const on = activePreset === row.title
                        return (
                          <button
                            key={row.title}
                            type="button"
                            onClick={() => {
                              let level = pickLevel(props.qualities, row.minH, row.nextMin)
                              if (level === null && row.title === "4K") {
                                const synth = props.qualities.find(
                                  (q) => q.index === -2160 || (q.height || 0) >= 2160
                                )
                                if (synth) level = synth.index
                                else level = -2160
                              }
                              if (level === null) return
                              props.onQualityChange(level)
                            }}
                            className="flex w-full flex-col items-start rounded-none px-3 py-[9px] text-left"
                            style={on ? { boxShadow: "inset 2px 0 0 #e6c98a" } : undefined}
                          >
                            <strong className="text-[15px] font-semibold text-white">{row.title}</strong>
                            {row.sub ? (
                              <span className="text-[12px] text-white/40">{row.sub}</span>
                            ) : null}
                          </button>
                        )
                      })
                    ) : (
                      <p className="px-2 text-[12px] text-white/40">No quality options for this server</p>
                    )}

                                        {showLanguagesPanel ? (
                      <>
                        <p className="mb-2 mt-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                          Languages
                        </p>
                        <div className="max-h-[40%] overflow-auto">
                          {languageRows.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    if (row.kind === "audio") {
                                      props.onSelectAudioTrack?.(row.id)
                                    } else if (row.kind === "source") {
                                      await props.onSelectSource?.(row.id)
                                    } else {
                                      await props.onRequestProvider?.("huhu")
                                    }
                                  } finally {
                                    setSheet(null)
                                  }
                                })()
                              }}
                              className="flex w-full items-center gap-2 rounded-none px-3 py-[9px] text-left"
                              style={row.on ? { boxShadow: "inset 2px 0 0 #e6c98a" } : undefined}
                            >
                              {row.flag ? (
                                <span className="w-[18px] shrink-0 text-[13px] leading-none" aria-hidden>
                                  {row.flag}
                                </span>
                              ) : null}
                              <strong className="truncate text-[15px] font-semibold text-white">
                                {row.label}
                              </strong>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}

                  </div>
                  <div className="flex min-h-0 flex-col">
                    <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      Sources
                    </p>
                    <div className="flex min-h-0 flex-col overflow-auto">
                      {serverRows.length ? (
                        serverRows.map((row) => {
                          return (
                            <div
                              key={row.providerId}
                              className="flex items-center gap-1.5 rounded-none py-[6px] pl-2 pr-1"
                              style={row.on ? { boxShadow: "inset 2px 0 0 #e6c98a" } : undefined}
                            >
                              <button
                                type="button"
                                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 touch-manipulation text-left"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setStyleOpen(false)
                                  // Sync user-gesture prime for Videasy bridge popup
                                  // (mobile nested iframes are often frozen).
                                  // providerId is often the city ("boise"); name has "Videasy".
                                  {
                                    const isVideasyRow =
                                      /videasy/i.test(String(row.providerId || "")) ||
                                      /videasy/i.test(String(row.name || "")) ||
                                      /^(miami|boise|seattle|orlando|portland|dallas|atlanta|denver|phoenix|houston)$/i.test(
                                        String(row.providerId || "")
                                      )
                                    if (isVideasyRow) {
                                      void import("@/lib/providers/videasy-client-resolver")
                                        .then((m) => {
                                          try {
                                            ;(
                                              window as unknown as {
                                                __videasyPrime?: () => void
                                              }
                                            ).__videasyPrime = undefined
                                          } catch {
                                            /* ignore */
                                          }
                                                                                    m.warmVideasyOriginBridge?.()
                                        })
                                        .catch(() => {})
                                    }
                                  }
                                  // Fire resolve FIRST so "Starting Videasy…" is set
                                  // before the sheet unmounts (mobile looked like a no-op).
                                  if (props.onRequestProvider) {
                                    console.info("[sources] requestProvider", row.providerId, row.name)
                                    void Promise.resolve(props.onRequestProvider(row.providerId)).catch(
                                      (err) => console.warn("[sources] requestProvider failed", err)
                                    )
                                  } else if (row.sourceId) {
                                    void Promise.resolve(props.onSelectSource?.(row.sourceId)).catch(
                                      () => undefined
                                    )
                                  }
                                  setSheet(null)
                                }}
                              >
                                <span className="w-[18px] shrink-0 text-[13px] leading-none" aria-hidden>
                                  🇺🇸
                                </span>
                                <span className="truncate whitespace-nowrap text-[14.5px] font-medium text-white">
                                  {row.name}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Favorite"
                                className="grid h-7 w-7 place-items-center text-white/35"
                                onClick={() => toggleFav(row.sourceId || row.providerId)}
                              >
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 24 24"
                                  fill={
                                    favs.includes(row.sourceId || row.providerId)
                                      ? "currentColor"
                                      : "none"
                                  }
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  className={
                                    favs.includes(row.sourceId || row.providerId)
                                      ? "text-white"
                                      : ""
                                  }
                                >
                                  <path d="M12 21s-7-4.4-9.5-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.5 12C19 16.6 12 21 12 21z" />
                                </svg>
                              </button>
                            </div>
                          )
                        })
                      ) : (
                        <p className="px-2 py-6 text-[13px] text-white/35">No sources yet</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between px-1 pt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                    Speed
                  </span>
                  <div className="flex items-center gap-[18px]">
                    {SPEEDS.map((n) => {
                      const on = Math.abs(props.playbackRate - n) < 0.01
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => props.onPlaybackRateChange(n)}
                          className={
                            on
                              ? "text-[13px] font-semibold text-[#e6c98a] underline decoration-[#e6c98a] underline-offset-[5px]"
                              : "text-[13px] font-medium text-white/55"
                          }
                        >
                          {n === 1 ? "1x" : `${n}x`}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-1 overflow-hidden px-3.5 pt-3.5">
                  <div className="flex min-h-0 flex-col">
                    <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      Audio
                    </p>
                    {audioTracks.length ? (
                      <div className="min-h-0 overflow-auto">
                        {audioTracks.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => props.onSelectAudioTrack?.(t.id)}
                            className="mb-1 w-full truncate whitespace-nowrap rounded-none px-3 py-2.5 text-left text-[14px] font-medium text-white"
                            style={
                              props.currentAudioTrackId === t.id
                                ? { boxShadow: "inset 2px 0 0 #e6c98a" }
                                : undefined
                            }
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 py-12 text-center text-[13px] leading-5 text-white/35">
                        No audio tracks
                        <br />
                        available
                      </p>
                    )}
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      Subtitles
                    </p>
                    <button
                      type="button"
                      onClick={() => props.onSelectSubtitle?.(undefined)}
                      className="mb-2 w-full rounded-none px-3 py-[11px] text-left text-[14.5px] font-medium text-white"
                      style={!props.currentSubtitleId ? { boxShadow: "inset 2px 0 0 #e6c98a" } : undefined}
                    >
                      Off
                    </button>
                    {subtitles.length ? (
                      <div className="min-h-0 overflow-auto">
                        {subtitles.slice(0, 8).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => props.onSelectSubtitle?.(s.id)}
                            className="mb-1 w-full truncate whitespace-nowrap rounded-none px-3 py-2.5 text-left text-[13.5px] font-medium text-white"
                            style={
                              props.currentSubtitleId === s.id
                                ? { boxShadow: "inset 2px 0 0 #e6c98a" }
                                : undefined
                            }
                          >
                            {subtitleLine(s)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 pb-4 pt-2 text-center text-[13px] leading-5 text-white/35">
                        No subtitles
                        <br />
                        available
                      </p>
                    )}
                    <label
                      className="mt-1 flex min-w-0 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-[12px] px-3 py-[11px] text-[14px] font-medium text-white"
                      style={{ background: PILL_BG }}
                    >
                      <input
                        type="file"
                        accept=".srt,.vtt,.ass"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const url = URL.createObjectURL(file)
                          window.dispatchEvent(
                            new CustomEvent("chillflix-local-subtitle", {
                              detail: { url, name: file.name },
                            })
                          )
                        }}
                      />
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0">
                        <path d="M12 16V5" />
                        <path d="m8 8 4-4 4 4" />
                        <path d="M5 19h14" />
                      </svg>
                      <span className="truncate">Upload subtitles</span>
                    </label>
                  </div>
                </div>
                <div className="shrink-0 px-3.5 pb-2 pt-1">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-1 py-[11px] text-[14.5px] font-medium text-white"
                    onClick={() => {
                      setStyleOpen(false)
                      setOpenSubsOpen((v) => !v)
                    }}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3-3" />
                      </svg>
                      <span className="truncate">Search OpenSubtitles</span>
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className={`text-white/80 transition-transform ${openSubsOpen ? "rotate-90" : ""}`}
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  {openSubsOpen ? (
                    <div className="mb-2 overflow-hidden rounded-[12px] border-0 bg-black/25">
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-[13px] font-semibold text-white">OpenSubtitles</span>
                        <button
                          type="button"
                          aria-label="Close OpenSubtitles"
                          className="grid h-6 w-6 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                          onClick={() => setOpenSubsOpen(false)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </div>
                      <div className="max-h-[min(32vh,220px)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                        {openSubsLoading || props.externalSubtitlesLoading ? (
                          <p className="px-3 py-5 text-center text-[12.5px] text-white/45">Searching…</p>
                        ) : openSubsError ? (
                          <p className="px-3 py-5 text-center text-[12.5px] text-white/45">{openSubsError}</p>
                        ) : openSubsList.length === 0 ? (
                          <p className="px-3 py-5 text-center text-[12.5px] text-white/45">
                            No OpenSubtitles results
                          </p>
                        ) : (
                          openSubsList.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                const known = (props.subtitles || []).some((t) => t.id === s.id)
                                if (!known && s.src) {
                                  window.dispatchEvent(
                                    new CustomEvent("chillflix-external-subtitle", {
                                      detail: {
                                        id: s.id,
                                        label: openSubsDisplayName(s),
                                        language: s.language,
                                        src: s.src,
                                        kind: "subtitles",
                                      },
                                    })
                                  )
                                }
                                props.onSelectSubtitle?.(s.id)
                                setOpenSubsOpen(false)
                                setSheet(null)
                              }}
                              className="flex w-full items-center gap-2.5 border-b border-white/5 px-3 py-2.5 text-left last:border-b-0 hover:bg-white/8"
                              style={
                                props.currentSubtitleId === s.id
                                  ? { background: "rgba(255,255,255,0.1)" }
                                  : undefined
                              }
                            >
                              <span className="shrink-0 text-[15px] leading-none" aria-hidden>
                                {openSubsFlag(s)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white/92">
                                {openSubsDisplayName(s)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-1 py-[11px] text-[14.5px] font-medium text-white"
                    onClick={() => setStyleOpen((v) => !v)}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M4 7h9" />
                        <circle cx="16" cy="7" r="2.1" />
                        <path d="M20 7h0.01" />
                        <path d="M4 17h3" />
                        <circle cx="10" cy="17" r="2.1" />
                        <path d="M14 17h6" />
                      </svg>
                      Customize appearance
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-white/80">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  {styleOpen ? (
                    <div className="space-y-3 px-1 pb-2 text-[13px] text-white/70">
                      <label className="block">
                        Size
                        <input
                          type="range"
                          min={75}
                          max={175}
                          value={Math.round((props.subtitleFontScale || 1) * 100)}
                          className="mt-1 w-full"
                          onChange={(e) =>
                            props.onSubtitleFontScaleChange?.(Number(e.target.value) / 100)
                          }
                        />
                      </label>
                      <label className="block">
                        Background
                        <input
                          type="range"
                          min={0}
                          max={90}
                          value={Math.round((props.subtitleBackgroundOpacity ?? 0.7) * 100)}
                          className="mt-1 w-full"
                          onChange={(e) =>
                            props.onSubtitleBackgroundOpacityChange?.(
                              Number(e.target.value) / 100
                            )
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
    </div>
  )
}
