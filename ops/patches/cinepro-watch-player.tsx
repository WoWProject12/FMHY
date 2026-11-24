"use client"

import { useCallback, useEffect, useMemo, useRef, useState, Suspense, type ReactNode } from "react"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ExternalPlayerPanel } from "@/components/external-player-panel"
import { FullscreenPortalContext } from "@/components/player/fullscreen-portal-context"
import { MediaPlayer } from "@/components/player/MediaPlayer"
import { Button } from "@/components/ui/button"
import { useWatchPartyState } from "@/components/watch-party-context"
import { WatchPartyDropdown } from "@/components/watch-party-dropdown"
import { PlaybackSourceRetryPanel } from "@/components/player/PlaybackSourceRetryPanel"
import { SourceLoadingOverlay } from "@/components/player/SourceLoadingOverlay"
import {
    buildPlaybackPickGate,
    getHealthFailedProviderIds,
    filterPlaybackOptionsByScanGate,
    hasPendingSourceHealthProbe,
    pickAutomaticProbeSources,
    pickAutoStartPlaybackSource,
    pickForceStartPlaybackSource,
    shouldSkipPlaybackHealthProbe,
    getProviderDisplayName,
    isVidLinkOnlySources,
    mapSourcesToPlaybackOptions,
    normalizeProviderName,
    parseStableSourceId,
    parseUnavailableProviders,
    pickPreferredPlaybackSource,
    shouldPreferSourceUpgrade,
    shouldHoldForHigherRankedProviders,
    shouldUpgradeToHigherRankedSource,
    canImmediatelyStartProviderOption,
    isTrustedPlaybackSourceUrl,
    isFourKHlsPlaybackUrl,
    isProviderRequiringHealthProbe,
    isBackgroundSourcesPending,
    shouldHoldEmptyStateForDiscovery,
    shouldMarkAutoPickSourceReady,
    getOrderedEnabledProviderIds,
} from "@/components/player/utils/playback"
import {
    type PlaybackErrorMeta,
    usePlaybackSourceFallback,
} from "@/hooks/usePlaybackSourceFallback"
import { useExternalSubtitles } from "@/hooks/useExternalSubtitles"
import { prefetchMediaSources, useMediaSources } from "@/hooks/useMediaSources"
import { useSourceHealth } from "@/hooks/useSourceHealth"
import { useClientSearchParams } from "@/hooks/useClientSearchParams"
import { usePreferredExternalPlayer } from "@/hooks/usePreferredExternalPlayer"
import { useStreamSourcesConfig,
    getHeadStartMs} from "@/hooks/useStreamSourcesConfig"
import { useWatchPartyPlayback } from "@/hooks/use-watch-party-playback"
import { useAuth } from "@/hooks/use-auth"
import { usePlaybackAmbientPause } from "@/hooks/use-playback-ambient-pause"
import { useShowRealProviderNames } from "@/hooks/use-show-real-provider-names"
import { pickBestFourKPlaybackOption, pickExplicitUserProviderPlaybackOption, pickHighestFourKPlaybackOption } from "@/lib/4khdhub/codec"
import {
    readPlaybackProviderPref,
    writePlaybackProviderPref,
} from "@/lib/prefetch-media-sources"
import { resolveProviderUserLabel } from "@/lib/provider-display"
import { PRIMARY_PROVIDER_HEAD_START_MS } from "@/lib/source-probe-constants"
import { isClientResolveProvider } from "@/lib/client-resolve-providers"
import {
    getTitleUnavailableMessage,
    pickUserFacingPlaybackWarning,
    sanitizePublicPlaybackStatusWithT,
} from "@/lib/playback-user-messages"
import { useTranslations } from "@/lib/i18n/client"
import { resolveResumeTime, type WatchProgressMeta } from "@/lib/watch-progress"
import {
    createPlaybackRecoveryLimiter,
    isProxyTokenPlaybackError,
    isRecoverableStreamError,
    playbackPositionForRecovery,
} from "@/lib/playback-error-recovery"
import { getClientUser } from "@/lib/auth-client"
import { readSessionAutoNext, writeSessionAutoNext } from "@/lib/auto-next-preference"
import { watchPartyPlayerUrl } from "@/lib/watch-party-session"
import type { WatchPartyRoom } from "@/lib/watch-party-types"
import { postEmbedMessage } from "@/lib/embed-player"
import { EMBED_MESSAGE_CONTROLS_VISIBLE } from "@/lib/embed-ui-sync"
import { cn } from "@/lib/utils"

type MediaType = "movie" | "tv"

type SourceType = "hls" | "file"

type PlaybackOption = ReturnType<typeof mapSourcesToPlaybackOptions>[number]

interface CineProWatchPlayerProps {
    mediaType: MediaType
    mediaId: string | number
    season?: string | number
    episode?: string | number
    watchMeta?: WatchProgressMeta
    showToolbar?: boolean
    onPlaybackEnded?: () => void
    onTvEpisodeChange?: (season: number, episode: number) => void
    embedMode?: boolean
    embedOptions?: {
        autoplay?: boolean
        autoNext?: boolean
        startAt?: number
        showTitle?: boolean
        showWatchParty?: boolean
        hostedOnParent?: boolean
        prefer4k?: boolean
    }
}

export function CineProWatchPlayer({
    mediaType,
    mediaId,
    season,
    episode,
    watchMeta,
    showToolbar = true,
    onPlaybackEnded,
    onTvEpisodeChange,
    embedMode = false,
    embedOptions,
}: CineProWatchPlayerProps) {
    usePlaybackAmbientPause(true)
    const { t } = useTranslations()
    const isMobile = useMediaQuery("(max-width: 768px)")
    const searchParams = useClientSearchParams()
    const prefer4k =
        searchParams.get("prefer4k") === "1" || Boolean(embedOptions?.prefer4k)
    const [has4kCatalog, setHas4kCatalog] = useState(false)
    const prefer4kAttemptedRef = useRef(false)
    // Playback matches the Toflix embed. embedMode only changes embed chrome.
    const toflixPlayback = true
    const { user, updateProfile } = useAuth()
    const [autoNext, setAutoNext] = useState(() => {
        if (embedMode && embedOptions?.autoNext) return true
        const clientUser = getClientUser()
        if (clientUser) return clientUser.autoNextEnabled
        return readSessionAutoNext()
    })
    const autoNextRef = useRef(autoNext)
    const embedShellRef = useRef<HTMLDivElement>(null)
    const [embedFullscreenPortal, setEmbedFullscreenPortal] = useState<HTMLElement | null>(null)
    const setEmbedShellRef = useCallback((node: HTMLDivElement | null) => {
        embedShellRef.current = node
        setEmbedFullscreenPortal(node)
    }, [])
    const onPlaybackEndedRef = useRef(onPlaybackEnded)
    const [watchPartyOpen, setWatchPartyOpen] = useState(false)
    const { room: watchPartyRoom, setRoom: setWatchPartyRoom } = useWatchPartyState()
    const {
        isHost: isWatchPartyHost,
        isGuest: isWatchPartyGuest,
        guestPlayback,
        awaitingPartyRoom,
        inParty: inWatchParty,
        handlePlaybackSync,
        syncPlayback,
        guestResumeTime,
    } = useWatchPartyPlayback()
    const mediaTitle = watchMeta?.title ?? "Playback"
    const numericSeason = season !== undefined ? Number(season) : undefined
    const numericEpisode = episode !== undefined ? Number(episode) : undefined

    autoNextRef.current = autoNext
    onPlaybackEndedRef.current = onPlaybackEnded

    useEffect(() => {
        if (user) {
            setAutoNext(user.autoNextEnabled)
        } else {
            setAutoNext(readSessionAutoNext())
        }
    }, [user?.id, user?.autoNextEnabled])

    const handleAutoNextChange = useCallback(
        (enabled: boolean) => {
            setAutoNext(enabled)
            if (user) {
                void updateProfile({ autoNextEnabled: enabled }).then((error) => {
                    if (error) setAutoNext(!enabled)
                })
            } else {
                writeSessionAutoNext(enabled)
            }
        },
        [updateProfile, user]
    )

    const handlePlaybackEnded = useCallback(() => {
        if (inWatchParty) return
        if (!autoNextRef.current) return
        onPlaybackEndedRef.current?.()
    }, [inWatchParty])

    useEffect(() => {
        if (watchPartyRoom && searchParams.get("party")) {
            setWatchPartyOpen(true)
        }
    }, [searchParams, watchPartyRoom])

    const handleJoinHostMedia = useCallback((room: WatchPartyRoom) => {
        if (embedMode) {
            const params = new URLSearchParams(window.location.search)
            params.set("party", room.id)
            window.location.search = params.toString()
            return
        }

        const path = watchPartyPlayerUrl(room)
        window.location.href = path
    }, [embedMode])
    const openingPlaybackRef = useRef({
        mediaKey: "",
        episode: null as { season: number; episode: number } | null,
        startAt: undefined as number | undefined,
    })

    const mediaKey = `${mediaType}:${mediaId}`
    const playbackPrefParams = {
        id: mediaId,
        type: mediaType,
        ...(mediaType === "tv" && season !== undefined ? { season, episode } : {}),
    } as const
    if (openingPlaybackRef.current.mediaKey !== mediaKey) {
        const rawStart =
            embedOptions?.startAt ??
            searchParams.get("startAt") ??
            searchParams.get("continue")
        const parsedStart = rawStart != null ? Number(rawStart) : NaN

        openingPlaybackRef.current = {
            mediaKey,
            episode:
                mediaType === "tv" && numericSeason != null && numericEpisode != null
                    ? { season: numericSeason, episode: numericEpisode }
                    : null,
            startAt:
                Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : undefined,
        }
    }

    const stableWatchMeta = useMemo((): WatchProgressMeta | undefined => {
        const runtimeMinutes =
            embedOptions?.runtimeMinutes && embedOptions.runtimeMinutes > 0
                ? embedOptions.runtimeMinutes
                : watchMeta?.runtimeMinutes

        if (!watchMeta) {
            return undefined
        }

        return {
            ...watchMeta,
            ...(runtimeMinutes && runtimeMinutes > 0 ? { runtimeMinutes } : {}),
        }
    }, [
        embedOptions?.runtimeMinutes,
        watchMeta,
        watchMeta?.id,
        watchMeta?.type,
        watchMeta?.title,
        watchMeta?.poster,
        watchMeta?.season,
        watchMeta?.episode,
        watchMeta?.runtimeMinutes,
    ])
    const effectiveShowToolbar = showToolbar && !embedMode
    const embedShowToolbar =
        // Title lives in MovyPlayerSkin. This overlay is watch-party only.
        embedMode &&
        embedOptions?.showWatchParty !== false

    const livePlaybackTimeRef = useRef(0)
    const [upgradeResumeTime, setUpgradeResumeTime] = useState<number | undefined>()

    const resumeTime = useMemo(() => {
        // Explicit 0 = manual VAPlayer/Videasy/Movy remount — do not fall
        // through to Continue Watching / iframe ?startAt=.
        if (upgradeResumeTime === 0) {
            return 0
        }
        if (typeof upgradeResumeTime === "number" && upgradeResumeTime > 0) {
            return upgradeResumeTime
        }

        return resolveResumeTime(stableWatchMeta, {
            openingEpisode: openingPlaybackRef.current.episode ?? undefined,
            openingResumeTime: openingPlaybackRef.current.startAt,
        })
    }, [stableWatchMeta, numericSeason, numericEpisode, upgradeResumeTime])

    useEffect(() => {
        setUpgradeResumeTime(undefined)
        livePlaybackTimeRef.current = 0
    }, [mediaId, mediaType, season, episode])

    const handlePlaybackTime = useCallback((timeSec: number) => {
        // Ignore cold-start 0/near-0 ticks while a remount is seeking back
        // to the previous position (manual source switches).
        if (
            Number.isFinite(timeSec) &&
            timeSec < 0.5 &&
            livePlaybackTimeRef.current >= 0.5
        ) {
            return
        }
        if (Number.isFinite(timeSec) && timeSec >= 0) {
            livePlaybackTimeRef.current = timeSec
            // Lock the session once real playback is underway so a late
            // higher-ranked provider (e.g. VAPlayer after VSEmbed) cannot
            // remount mid-watch and flash the source probe list.
            if (timeSec >= 2 && !playbackStableRef.current) {
                playbackStableRef.current = true
                setPlaybackStable(true)
                setPlaybackActive(true)
            }
        }
    }, [])
    const [playbackActive, setPlaybackActive] = useState(false)
    const hasReadySourceRef = useRef(false)
    const healthFailedProviderIdsRef = useRef<string[]>([])
    const {
        sources,
        subtitles,
        diagnostics,
        playbackToken,
        isLoading,
        isLoadingMore: sourcesLoadingMore,
        error,
        refetchSources,
        refetchSourcesAsync,
        requestProvider,
        scanningProviderId,
        scanFailedProviderIds,
        isScanningProviders,
        providerScanStartedAt,
    } = useMediaSources({
        id: mediaId,
        type: mediaType,
        season,
        episode,
        playbackActive,
        hasReadySourceRef,
        healthFailedProviderIdsRef,
        embedFastStart: true,
    })

    useEffect(() => {
        let cancelled = false

        void fetch(
            `/api/4k/check?tmdbId=${encodeURIComponent(String(mediaId))}&type=${encodeURIComponent(mediaType)}`,
            { cache: "no-store" }
        )
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
                if (!cancelled) {
                    setHas4kCatalog(Boolean(payload?.has4k))
                }
            })
            .catch(() => {
                if (!cancelled) setHas4kCatalog(false)
            })

        return () => {
            cancelled = true
            prefer4kAttemptedRef.current = false
            setHas4kCatalog(false)
        }
    }, [mediaId, mediaType, season, episode])

    const hiddenProviderIds = useMemo(
        () => (has4kCatalog ? [] : ["4khdhub"]),
        [has4kCatalog]
    )

    const [selectedSourceId, setSelectedSourceId] = useState("")
    const [runtimeError, setRuntimeError] = useState<string>()
    const providerResolveAttemptedRef = useRef(false)
    const playbackStableRef = useRef(false)
    const [playbackStable, setPlaybackStable] = useState(false)
    const lockedPlaybackUrlRef = useRef<string | null>(null)
    const sourceLoadingWatchdogRef = useRef(false)
    const forcePickWatchdogRef = useRef(false)
    const startupSourceLockedRef = useRef(false)
    const sourceUpgradeAttemptedRef = useRef(false)
    const playbackRecoveryLimiterRef = useRef(createPlaybackRecoveryLimiter())
    const [hasStartedPlaybackAttempt, setHasStartedPlaybackAttempt] = useState(false)
    const [sourceSwitchNonce, setSourceSwitchNonce] = useState(0)
    const {
        order: providerOrder,
        enabledIds,
        enabledPlayers,
        loading: streamSourcesLoading,
    } = useStreamSourcesConfig()
    const adminCanSeeRealProviderNames = useShowRealProviderNames()
    const showRealFromEmbed = Boolean(embedOptions?.showRealProviderNames)
    const showRealProviderNames = adminCanSeeRealProviderNames || showRealFromEmbed
    const [activePlayerId, setActivePlayerId] = usePreferredExternalPlayer(
        enabledPlayers,
        streamSourcesLoading
    )
    const effectiveActivePlayerId = inWatchParty ? null : activePlayerId

    const orderedEnabledProviderIds = useMemo(
        () => getOrderedEnabledProviderIds(providerOrder, enabledIds),
        [enabledIds, providerOrder]
    )

    useEffect(() => {
        if (!prefer4k || !has4kCatalog || prefer4kAttemptedRef.current) {
            return
        }

        if (streamSourcesLoading || isLoading) {
            return
        }

        prefer4kAttemptedRef.current = true
        void requestProvider("4khdhub").catch(() => undefined)
    }, [
        has4kCatalog,
        isLoading,
        prefer4k,
        requestProvider,
        streamSourcesLoading,
    ])

    const playbackOptions: PlaybackOption[] = useMemo(
        () =>
            mapSourcesToPlaybackOptions(sources, {
                providerOrder: orderedEnabledProviderIds,
                showRealProviderNames,
            }),
        [orderedEnabledProviderIds, showRealProviderNames, sources]
    )

    const primaryProviderResolved = useMemo(() => {
        const primaryId = orderedEnabledProviderIds[0]
        if (!primaryId) return false
        return sources.some(
            (source) => normalizeProviderName(source.provider.id) === primaryId
        )
    }, [orderedEnabledProviderIds, sources])

    const providerScanGate = useMemo(
        () => ({
            isScanningProviders,
            scanningProviderId,
            scanFailedProviderIds,
            scanStartedAt: providerScanStartedAt,
            primaryProviderResolved,
        }),
        [
            isScanningProviders,
            primaryProviderResolved,
            providerScanStartedAt,
            scanFailedProviderIds,
            scanningProviderId,
        ]
    )

    const gatedPlaybackOptions = useMemo(
        () =>
            filterPlaybackOptionsByScanGate(
                playbackOptions,
                orderedEnabledProviderIds,
                providerScanGate
            ),
        [orderedEnabledProviderIds, playbackOptions, providerScanGate]
    )

    const hasPlayableBatch = sources.length > 0
    const optionsForPlayback = hasPlayableBatch ? playbackOptions : gatedPlaybackOptions

    const probeSources = useMemo(() => {
        const automatic = pickAutomaticProbeSources(
            playbackOptions,
            providerOrder,
            orderedEnabledProviderIds
        )
        // Don't health-probe FileSuN/Huhu while VAPlayer/Videasy/Movy have URLs —
        // stopOnFirstReady was marking FileSuN ready and aborting preferred probes.
        const preferred = automatic.filter(
            (option) => !shouldHoldForHigherRankedProviders(option.providerId)
        )
        const toProbe = preferred.length > 0 ? preferred : automatic
        return toProbe.map((option) => ({
            id: option.id,
            url: option.src,
            type: option.sourceType,
        }))
    }, [orderedEnabledProviderIds, playbackOptions, providerOrder])

    const primaryProbeSourceIds = useMemo(() => {
        const primaryId = orderedEnabledProviderIds[0]
        if (!primaryId) return [] as string[]
        return probeSources
            .filter((source) => {
                const option = playbackOptions.find((item) => item.id === source.id)
                return option?.providerId === primaryId
            })
            .map((source) => source.id)
    }, [orderedEnabledProviderIds, playbackOptions, probeSources])

    const skipHealthProbe = useMemo(
        () =>
            shouldSkipPlaybackHealthProbe({
                diagnostics,
                sources,
                sourcesLoadingMore,
                // Toflix starts as soon as the batch does not need a hard probe.
                embedFastStart: toflixPlayback,
                isScanningProviders,
                scanningProviderId,
            }),
        [
            diagnostics,
            embedMode,
            isScanningProviders,
            scanningProviderId,
            sources,
            sourcesLoadingMore,
        ]
    )

    const trustedProbeSourceIds = useMemo(() => {
        const options = hasPlayableBatch ? playbackOptions : gatedPlaybackOptions

        // Embed fast-start may trust the first batch. On the watch page we probe
        // every source in admin order — pre-trusting MovieBox/proxy URLs used to
        // mark them ready and abort Flixhqz/Huhu probing.
        if (!skipHealthProbe) {
            return [] as string[]
        }

        return options
            .filter(
                (option) =>
                    !isProviderRequiringHealthProbe(option.providerId, option.src)
            )
            .map((option) => option.id)
    }, [gatedPlaybackOptions, hasPlayableBatch, playbackOptions, skipHealthProbe])

    const playbackProbeContext = useMemo(
        () => ({
            type: mediaType,
            tmdbId: String(mediaId),
            ...(mediaType === "tv"
                ? {
                      season: String(season ?? ""),
                      episode: String(episode ?? ""),
                  }
                : {}),
        }),
        [episode, mediaId, mediaType, season]
    )

    const {
        health: sourceHealth,
        ensureProbed,
        activeProbeId,
        hasReadySource,
        isProbing,
        firstReadySourceId,
        markSourceReady,
        markSourceFailed,
    } = useSourceHealth(probeSources, {
        enabled: !streamSourcesLoading && playbackOptions.length > 0 && !playbackStable,
        sequential: true,
        stopOnFirstReady: true,
        skipProbe: skipHealthProbe,
        trustedSourceIds: trustedProbeSourceIds,
        playbackContext: playbackProbeContext,
        headStartMs: Math.max(getHeadStartMs(), PRIMARY_PROVIDER_HEAD_START_MS),
        primarySourceIds: primaryProbeSourceIds,
    })

    useEffect(() => {
        hasReadySourceRef.current = hasReadySource
    }, [hasReadySource])

    useEffect(() => {
        healthFailedProviderIdsRef.current = Array.from(
            getHealthFailedProviderIds(playbackOptions, sourceHealth)
        )
    }, [playbackOptions, sourceHealth])


    const activeTestingProviderId = useMemo(() => {
        if (scanningProviderId) return scanningProviderId

        if (!activeProbeId) return undefined
        return playbackOptions.find((option) => option.id === activeProbeId)?.providerId
    }, [activeProbeId, playbackOptions, scanningProviderId])

    const unavailableProviders = useMemo(
        () =>
            parseUnavailableProviders(
                diagnostics,
                playbackOptions.map((option) => option.provider)
            ),
        [diagnostics, playbackOptions]
    )

    const playbackPickGate = useMemo(
        () =>
            buildPlaybackPickGate({
                sourcesLoadingMore:
                    sourcesLoadingMore ||
                    isScanningProviders ||
                    Boolean(scanningProviderId),
                unavailableProviderIds: new Set(
                    unavailableProviders.map((name) => normalizeProviderName(name))
                ),
                sourceHealth,
                playbackOptions: gatedPlaybackOptions,
                primaryProviderId: orderedEnabledProviderIds[0],
                scanFailedProviderIds: new Set(
                    scanFailedProviderIds.map((id) => normalizeProviderName(id))
                ),
            }),
        [
            gatedPlaybackOptions,
            isScanningProviders,
            orderedEnabledProviderIds,
            scanFailedProviderIds,
            scanningProviderId,
            sourceHealth,
            sourcesLoadingMore,
            unavailableProviders,
        ]
    )

    const {
        manualSelectionRef,
        selectedProviderKeyRef,
        selectedSourceIdRef,
        resetFallbackState,
        syncSelectedSourceId,
        markManualSelection,
        markPendingProviderSelection,
        clearFailedProvider,
        pickInitialSource,
        resolvePlaybackError,
        attemptRecoveryFallback,
        attemptRecoveryFromOptions,
        pickSourceAfterRefetch,
        hasStablePlayback,
        isCurrentProviderFailed,
    } = usePlaybackSourceFallback(
        optionsForPlayback,
        orderedEnabledProviderIds,
        playbackPickGate,
        playbackStableRef
    )

    useEffect(() => {
        resetFallbackState()
        providerResolveAttemptedRef.current = false
        playbackStableRef.current = false
        setPlaybackStable(false)
        lockedPlaybackUrlRef.current = null
        startupSourceLockedRef.current = false
        sourceUpgradeAttemptedRef.current = false
        playbackRecoveryLimiterRef.current.reset()
        setHasStartedPlaybackAttempt(false)
        setPlaybackActive(false)
        // Must clear these or the next title's provider scan exits immediately
        // (stale hasReadySourceRef makes shouldStopDiscovering() true).
        hasReadySourceRef.current = false
        healthFailedProviderIdsRef.current = []
        setRuntimeError(undefined)
        setSelectedSourceId("")
        setSourceSwitchNonce(0)
        sourceLoadingWatchdogRef.current = false
        forcePickWatchdogRef.current = false
    }, [mediaId, mediaType, season, episode, resetFallbackState])

    const lockStartupSource = useCallback(() => {
        startupSourceLockedRef.current = true
    }, [])

    const bumpSourceSwitch = useCallback(() => {
        if (!playbackRecoveryLimiterRef.current.canSwitch()) {
            return false
        }
        lockedPlaybackUrlRef.current = null
        setSourceSwitchNonce((nonce) => nonce + 1)
        return true
    }, [])

    useEffect(() => {
        if (mediaType !== "tv" || season === undefined || episode === undefined) return

        const nextEpisode = Number(episode) + 1
        if (!Number.isFinite(nextEpisode)) return

        void prefetchMediaSources({
            id: mediaId,
            type: "tv",
            season,
            episode: nextEpisode,
        })
    }, [episode, mediaId, mediaType, season])

    useEffect(() => {
        // Wait for admin Stream Sources order before auto-picking — otherwise
        // pickPreferred falls back to DEFAULT_PROVIDER_ORDER (wrong play order).
        if (streamSourcesLoading || orderedEnabledProviderIds.length === 0) return
        if (isLoading && playbackOptions.length === 0) return
        if (isScanningProviders && !hasPlayableBatch && !manualSelectionRef.current) return

        if (!playbackOptions.length) {
            if (prefer4k && has4kCatalog && !prefer4kAttemptedRef.current) {
                prefer4kAttemptedRef.current = true
                void requestProvider("4khdhub")
                    .then((payload) => {
                        const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                            providerOrder: orderedEnabledProviderIds,
                            showRealProviderNames,
                        })
                        const fourK = pickBestFourKPlaybackOption(refreshed)
                        if (!fourK) return
                        syncSelectedSourceId(fourK.id)
                        setSelectedSourceId(fourK.id)
                        markSourceReady(fourK.id)
                        setSourceSwitchNonce((nonce) => nonce + 1)
                    })
                    .catch(() => undefined)
            } else {
                // Keep any existing selection across empty races — clearing
                // remounts MediaPlayer and looks like a constant refresh.
            }
            return
        }

        if (!selectedSourceId) {
            if (manualSelectionRef.current) {
                const providerKey = selectedProviderKeyRef.current
                if (providerKey) {
                    const pending = pickExplicitUserProviderPlaybackOption(
                        playbackOptions,
                        providerKey
                    )
                    if (pending) {
                        lockStartupSource()
                        syncSelectedSourceId(pending.id)
                        setSelectedSourceId(pending.id)
                        if (shouldMarkAutoPickSourceReady(pending, sourceHealth)) {
                            markSourceReady(pending.id)
                        }
                    }
                }
                return
            }

            // Same-browser reopen: stick to last provider only when it is not a
            // low-ranked scrape (FileSuN/Huhu). Those prefs often come from a
            // cold-start demotion and would skip VAPlayer/Videasy/Movy on
            // Continue Watching.
            const rememberedProvider = readPlaybackProviderPref(playbackPrefParams)
            if (
                rememberedProvider &&
                !shouldHoldForHigherRankedProviders(rememberedProvider)
            ) {
                const remembered = pickExplicitUserProviderPlaybackOption(
                    playbackOptions,
                    rememberedProvider
                )
                if (remembered) {
                    // Prefer last-watched provider, but do not lock manual mode —
                    // if those cached URLs are dead, normal failover can still run.
                    selectedProviderKeyRef.current = remembered.providerId
                    lockStartupSource()
                    syncSelectedSourceId(remembered.id)
                    setSelectedSourceId(remembered.id)
                    if (shouldMarkAutoPickSourceReady(remembered, sourceHealth)) {
                        markSourceReady(remembered.id)
                    }
                    return
                }
            } else if (
                rememberedProvider &&
                shouldHoldForHigherRankedProviders(rememberedProvider)
            ) {
                try {
                    writePlaybackProviderPref(playbackPrefParams, null)
                } catch (_) {}
            }

            if (prefer4k && has4kCatalog) {
                const fourKOption = pickBestFourKPlaybackOption(playbackOptions)

                if (
                    fourKOption &&
                    (skipHealthProbe ||
                        sourceHealth[fourKOption.id] === "ready" ||
                        isTrustedPlaybackSourceUrl(fourKOption.src))
                ) {
                    lockStartupSource()
                    syncSelectedSourceId(fourKOption.id)
                    setSelectedSourceId(fourKOption.id)
                    if (shouldMarkAutoPickSourceReady(fourKOption, sourceHealth)) {
                        markSourceReady(fourKOption.id)
                    }
                    return
                }

                if (!prefer4kAttemptedRef.current) {
                    prefer4kAttemptedRef.current = true
                    void requestProvider("4khdhub")
                        .then((payload) => {
                            const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                                providerOrder: orderedEnabledProviderIds,
                                showRealProviderNames,
                            })
                            const fourK = pickBestFourKPlaybackOption(refreshed)
                            if (!fourK) return
                            syncSelectedSourceId(fourK.id)
                            setSelectedSourceId(fourK.id)
                            markSourceReady(fourK.id)
                            setSourceSwitchNonce((nonce) => nonce + 1)
                        })
                        .catch(() => undefined)
                    return
                }
            }

            const preferred = pickAutoStartPlaybackSource(playbackOptions, {
                skipHealthProbe,
                sourceHealth,
                firstReadySourceId,
                providerOrder: orderedEnabledProviderIds,
                pickGate: playbackPickGate,
            })
            if (!preferred) return
            lockStartupSource()
            syncSelectedSourceId(preferred.id)
            setSelectedSourceId(preferred.id)
            if (shouldMarkAutoPickSourceReady(preferred, sourceHealth)) {
                markSourceReady(preferred.id)
            }
            return
        }

        const current = playbackOptions.find((option) => option.id === selectedSourceId)
        if (current) {
            if (
                !manualSelectionRef.current &&
                !playbackStableRef.current &&
                isCurrentProviderFailed()
            ) {
                const recovery = attemptRecoveryFallback()
                if (recovery) {
                    if (recovery.nextSourceId === selectedSourceId) return
                    if (!bumpSourceSwitch()) return
                    setRuntimeError(recovery.statusMessage)
                    setSelectedSourceId(recovery.nextSourceId)
                    return
                }
            }

            syncSelectedSourceId(selectedSourceId)
            return
        }

        if (playbackStableRef.current && selectedSourceId) {
            const parsed = parseStableSourceId(selectedSourceId)
            const stableMatch = parsed
                ? playbackOptions.find((option) => {
                      const optionParsed = parseStableSourceId(option.id)
                      return (
                          optionParsed &&
                          optionParsed.providerId === parsed.providerId &&
                          optionParsed.quality === parsed.quality &&
                          optionParsed.type === parsed.type
                      )
                  })
                : undefined

            if (stableMatch) {
                syncSelectedSourceId(stableMatch.id)
                setSelectedSourceId(stableMatch.id)
                return
            }

            // Exact id vanished after a refresh — rematch by provider so we do
            // not drop into "Starting scan…" while the stream was already live.
            const providerKey =
                parsed?.providerId ||
                selectedProviderKeyRef.current ||
                normalizeProviderName(
                    playbackOptions.find((option) => option.id === selectedSourceId)
                        ?.providerId ?? ""
                )
            if (providerKey) {
                const byProvider = playbackOptions.find(
                    (option) =>
                        normalizeProviderName(option.providerId ?? "") === providerKey
                )
                if (byProvider) {
                    syncSelectedSourceId(byProvider.id)
                    setSelectedSourceId(byProvider.id)
                    return
                }
            }

            return
        }

        const matched = selectedProviderKeyRef.current
            ? pickExplicitUserProviderPlaybackOption(
                  playbackOptions,
                  selectedProviderKeyRef.current
              )
            : undefined

        if (matched && !playbackStableRef.current) {
            syncSelectedSourceId(matched.id)
            setSelectedSourceId(matched.id)
            return
        }

        if (playbackStableRef.current) {
            return
        }

        if (!manualSelectionRef.current && !playbackStableRef.current) {
                if (startupSourceLockedRef.current && selectedSourceId) {
                const stillExists = playbackOptions.some(
                    (option) => option.id === selectedSourceId
                )
                if (stillExists && !isCurrentProviderFailed()) return
            }

            const preferred = pickAutoStartPlaybackSource(playbackOptions, {
                skipHealthProbe,
                sourceHealth,
                firstReadySourceId,
                providerOrder: orderedEnabledProviderIds,
                pickGate: playbackPickGate,
            })
            if (!preferred) return
            lockStartupSource()
            syncSelectedSourceId(preferred.id)
            setSelectedSourceId(preferred.id)
            if (shouldMarkAutoPickSourceReady(preferred, sourceHealth)) {
                markSourceReady(preferred.id)
            }
        }
    }, [
        attemptRecoveryFallback,
        firstReadySourceId,
        has4kCatalog,
        hasPlayableBatch,
        hasStartedPlaybackAttempt,
        isCurrentProviderFailed,
        manualSelectionRef,
        markSourceReady,
        orderedEnabledProviderIds,
        playbackActive,
        playbackPickGate,
        playbackOptions,
        prefer4k,
        providerOrder,
        requestProvider,
        selectedProviderKeyRef,
        selectedSourceId,
        showRealProviderNames,
        skipHealthProbe,
        isLoading,
        sourceHealth,
        sources,
        sourcesLoadingMore,
        orderedEnabledProviderIds,
        streamSourcesLoading,
        syncSelectedSourceId,
        isScanningProviders,
    ])

    useEffect(() => {
        if (!selectedSourceId || manualSelectionRef.current || playbackStableRef.current) return
        if (!runtimeError && !isCurrentProviderFailed()) return

        const current = playbackOptions.find((option) => option.id === selectedSourceId)
        const preferred = pickInitialSource()
        if (!current || !preferred || preferred.id === selectedSourceId) return

        if (
            shouldPreferSourceUpgrade({
                current: {
                    url: current.src,
                    provider: { name: current.provider },
                },
                preferred: {
                    url: preferred.src,
                    provider: { name: preferred.provider },
                },
                manualSelection: false,
                hasRuntimeError: Boolean(runtimeError),
            })
        ) {
            syncSelectedSourceId(preferred.id)
            setSelectedSourceId(preferred.id)
            setRuntimeError(undefined)
        }
    }, [
        isCurrentProviderFailed,
        manualSelectionRef,
        pickInitialSource,
        playbackOptions,
        runtimeError,
        selectedSourceId,
        syncSelectedSourceId,
    ])

    useEffect(() => {
        if (!isCurrentProviderFailed() || playbackStableRef.current || playbackActive) return

        const recovery = attemptRecoveryFallback()
        if (!recovery) return
        // Already moved onto the recovery target — do not remount again on every
        // sourcesLoadingMore / playbackOptions tick (constant player refresh).
        if (recovery.nextSourceId === selectedSourceId) return
        if (!bumpSourceSwitch()) return

        setRuntimeError(recovery.statusMessage)
        setSelectedSourceId(recovery.nextSourceId)
    }, [attemptRecoveryFallback, bumpSourceSwitch, isCurrentProviderFailed, playbackActive, playbackOptions, selectedSourceId, sourcesLoadingMore])

    const isResolvingMoreProviders =
        runtimeError === t("player.status.checkingOther") ||
        runtimeError === t("player.status.findingStream") ||
        runtimeError === "Checking other providers…" ||
        runtimeError === "Resolving CinePro providers…" ||
        (isCurrentProviderFailed() &&
            isVidLinkOnlySources(sources) &&
            (isLoading || sourcesLoadingMore))

    const probeSourceIds = useMemo(() => probeSources.map((source) => source.id), [probeSources])

    const hasPendingProbe = useMemo(
        () => hasPendingSourceHealthProbe(probeSourceIds, sourceHealth),
        [probeSourceIds, sourceHealth]
    )

    const resolvedSourceId = useMemo(() => {
        if (selectedSourceId) return selectedSourceId
        if (manualSelectionRef.current) return ""
        if (isScanningProviders && !hasPlayableBatch) return ""

        const primaryId = orderedEnabledProviderIds[0]
        if (primaryId && isClientResolveProvider(primaryId)) {
            const hasPrimary = playbackOptions.some(
                (option) => option.providerId === primaryId
            )
            const primaryFailed = scanFailedProviderIds.some(
                (id) => normalizeProviderName(id) === normalizeProviderName(primaryId)
            )
            // Block auto-start only when the only thing available would be a
            // native bulk fallback (Huhu). Videasy/Movy may start while VAPlayer
            // is still scraping — otherwise the dark watch cover never lifts.
            const hasPeerClientResolve = playbackOptions.some((option) => {
                const id = normalizeProviderName(option.providerId || "")
                return (
                    id &&
                    id !== normalizeProviderName(primaryId) &&
                    id !== "huhu" &&
                    id !== "flixhq" &&
                    id !== "vidlink" &&
                    isClientResolveProvider(id)
                )
            })
            if (
                !hasPrimary &&
                !primaryFailed &&
                !hasPeerClientResolve &&
                (sourcesLoadingMore || isScanningProviders || Boolean(scanningProviderId))
            ) {
                return ""
            }
        }

        const autoStart = pickAutoStartPlaybackSource(playbackOptions, {
            skipHealthProbe,
            sourceHealth,
            firstReadySourceId,
            providerOrder: orderedEnabledProviderIds,
            pickGate: playbackPickGate,
        })
        return autoStart?.id ?? ""
    }, [
        firstReadySourceId,
        hasPlayableBatch,
        isScanningProviders,
        playbackOptions,
        playbackPickGate,
        orderedEnabledProviderIds,
        scanFailedProviderIds,
        scanningProviderId,
        selectedSourceId,
        skipHealthProbe,
        sourceHealth,
        sourcesLoadingMore,
    ])

    useEffect(() => {
        if (!resolvedSourceId) return
        // Mark that we tried to start — but do NOT set playbackActive yet.
        // playbackActive stops the provider scan; only real playback-ready
        // should do that (handlePlaybackReady). A dead first pick must not
        // freeze discovery while other sources could still return.
        setHasStartedPlaybackAttempt(true)
    }, [resolvedSourceId])

    useEffect(() => {
        if (playbackOptions.length === 0 || resolvedSourceId) return
        if (forcePickWatchdogRef.current || manualSelectionRef.current) return

        const primaryId = orderedEnabledProviderIds[0]
        const primaryIsClientResolve = Boolean(
            primaryId && isClientResolveProvider(primaryId)
        )
        const hasPeerClientResolve = playbackOptions.some((option) => {
            const id = normalizeProviderName(option.providerId || "")
            return (
                id &&
                id !== normalizeProviderName(primaryId || "") &&
                id !== "huhu" &&
                id !== "flixhq" &&
                id !== "vidlink" &&
                isClientResolveProvider(id)
            )
        })
        const primaryStillPending =
            primaryIsClientResolve &&
            !hasPeerClientResolve &&
            (sourcesLoadingMore || isScanningProviders || Boolean(scanningProviderId)) &&
            !playbackOptions.some((option) => option.providerId === primaryId) &&
            !scanFailedProviderIds.some(
                (id) => normalizeProviderName(id) === normalizeProviderName(primaryId!)
            )

        // Client-resolve #1 absent — don't force-start Huhu/native while #1 scrapes.
        // Peer client-resolve (Videasy/Movy) may force-start so the cover can lift.
        if (primaryStillPending) {
            return
        }

        const forceDelayMs = Math.max(getHeadStartMs(), PRIMARY_PROVIDER_HEAD_START_MS)

        const timer = window.setTimeout(() => {
            if (forcePickWatchdogRef.current || manualSelectionRef.current || resolvedSourceId) {
                return
            }

            const candidate = pickForceStartPlaybackSource(playbackOptions, {
                sourceHealth,
                firstReadySourceId,
                providerOrder: orderedEnabledProviderIds,
                pickGate: playbackPickGate,
            })
            if (!candidate) return
            forcePickWatchdogRef.current = true
            if (shouldMarkAutoPickSourceReady(candidate, sourceHealth)) {
                markSourceReady(candidate.id)
            }
            lockStartupSource()
            syncSelectedSourceId(candidate.id)
            setSelectedSourceId(candidate.id)
        }, forceDelayMs)

        return () => window.clearTimeout(timer)
    }, [
        toflixPlayback,
        firstReadySourceId,
        isScanningProviders,
        manualSelectionRef,
        markSourceReady,
        orderedEnabledProviderIds,
        playbackOptions,
        playbackPickGate,
        scanFailedProviderIds,
        scanningProviderId,
        sourceHealth,
        sourcesLoadingMore,
        mediaId,
        mediaType,
        playbackOptions.length,
        resolvedSourceId,
        season,
        episode,
        syncSelectedSourceId,
    ])

    useEffect(() => {
        if (manualSelectionRef.current || (isScanningProviders && !hasPlayableBatch)) return
        if (!selectedSourceId) return

        const preferred = pickAutoStartPlaybackSource(playbackOptions, {
            skipHealthProbe,
            sourceHealth,
            providerOrder: orderedEnabledProviderIds,
            pickGate: playbackPickGate,
        })
        if (!preferred || preferred.id === selectedSourceId) return

        const current = playbackOptions.find((option) => option.id === selectedSourceId)
        const stuckOnScrape =
            shouldHoldForHigherRankedProviders(current?.providerId) &&
            preferred &&
            !shouldHoldForHigherRankedProviders(preferred.providerId)

        // Real watch progress (≥2s) means the stream is delivering — never
        // remount for a late higher-ranked provider. Only escape "black FileSuN
        // false stable" when we have almost no progress yet.
        const hasRealProgress = livePlaybackTimeRef.current >= 2
        if (playbackStableRef.current && (hasRealProgress || !stuckOnScrape)) return
        if (hasRealProgress) return

        const upgradeToPrimary =
            (stuckOnScrape && !hasRealProgress) ||
            shouldUpgradeToHigherRankedSource({
                current,
                preferred,
                providerOrder: orderedEnabledProviderIds,
                sourceHealth,
                manualSelection: manualSelectionRef.current,
                currentPlaybackTime: livePlaybackTimeRef.current,
                playbackStable: playbackStableRef.current,
            })

        if (!upgradeToPrimary) return

        sourceUpgradeAttemptedRef.current = true

        if (preferred.providerId) {
            clearFailedProvider(preferred.providerId)
        }

        setRuntimeError(undefined)
        syncSelectedSourceId(preferred.id)
        setSelectedSourceId(preferred.id)
        if (livePlaybackTimeRef.current >= 0.5) {
            setUpgradeResumeTime(livePlaybackTimeRef.current)
        }
        bumpSourceSwitch()
    }, [
        clearFailedProvider,
        hasPlayableBatch,
        manualSelectionRef,
        orderedEnabledProviderIds,
        playbackOptions,
        playbackPickGate,
        selectedSourceId,
        skipHealthProbe,
        sourceHealth,
        syncSelectedSourceId,
        isScanningProviders,
        bumpSourceSwitch,
    ])

    const selectedPlayback = playbackOptions.find((option) => option.id === resolvedSourceId)

    // Latch the in-use stream URL once settled so background refetches that
    // return a new CDN path for the same provider do not reload the player.
    if (
        playbackStable &&
        selectedPlayback?.src &&
        !lockedPlaybackUrlRef.current
    ) {
        lockedPlaybackUrlRef.current = selectedPlayback.src
    }
    if (!playbackStable) {
        // Allow intentional source switches (nonce bumps clear stable first).
        if (!selectedPlayback || selectedSourceIdRef.current !== selectedPlayback.id) {
            lockedPlaybackUrlRef.current = null
        }
    }

    const playerSource = useMemo(
        () =>
            selectedPlayback
                ? {
                      id: selectedPlayback.id,
                      url:
                          (playbackStable && lockedPlaybackUrlRef.current) ||
                          selectedPlayback.src,
                      type: selectedPlayback.sourceType,
                      cinemacityPageUrl: selectedPlayback.cinemacityPageUrl,
                      directClientPlayback: selectedPlayback.directClientPlayback,
                      clientPlaybackHeaders: selectedPlayback.clientPlaybackHeaders,
                      iframeEmbed: Boolean(
                        (selectedPlayback as { iframeEmbed?: boolean }).iframeEmbed
                      ) || selectedPlayback.sourceType === "embed",
                      // Discrete URL-per-quality ladders (Videasy etc.) — without
                      // this the Quality sheet only sees the single start URL.
                      qualities: selectedPlayback.qualities,
                  }
                : null,
        [
            selectedPlayback?.id,
            selectedPlayback?.sourceType,
            selectedPlayback?.src,
            selectedPlayback?.cinemacityPageUrl,
            selectedPlayback?.directClientPlayback,
            selectedPlayback?.clientPlaybackHeaders,
            selectedPlayback?.iframeEmbed,
            selectedPlayback?.qualities,
            playbackStable,
        ]
    )

    const { externalSubtitles, loadingExternalSubtitles } = useExternalSubtitles({
        enabled: Boolean(playerSource),
        type: mediaType,
        tmdbId: mediaId,
        season,
        episode,
    })

    const mergedSubtitles = useMemo(() => {
        const seen = new Set<string>()
        const merged: Array<{
            id: string
            label: string
            src: string
            language?: string
            kind?: string
            source?: string
        }> = []

        for (const subtitle of subtitles) {
            if (seen.has(subtitle.id)) continue
            seen.add(subtitle.id)
            merged.push({
                id: subtitle.id,
                label: subtitle.label,
                src: subtitle.src,
                language: subtitle.language,
                kind: subtitle.kind,
                source: (subtitle as { source?: string }).source,
            })
        }

        for (const subtitle of externalSubtitles) {
            if (seen.has(subtitle.id)) continue
            seen.add(subtitle.id)
            merged.push({
                id: subtitle.id,
                label: subtitle.label,
                src: subtitle.src,
                language: subtitle.language,
                kind: subtitle.kind,
                source: (subtitle as { source?: string }).source,
            })
        }

        return merged
    }, [externalSubtitles, subtitles])

    const isAwaitingInitialPick =
        playbackOptions.length > 0 &&
        !resolvedSourceId &&
        !manualSelectionRef.current &&
        ((isScanningProviders && !hasPlayableBatch) ||
            (!hasPlayableBatch &&
                (isProbing ||
                    (!hasReadySource && (sourcesLoadingMore || hasPendingProbe)))))

    const holdEmptyForDiscovery = shouldHoldEmptyStateForDiscovery(
        diagnostics,
        sources.length
    )

    // Once playback is stable/active, never tear MediaPlayer down for a
    // background rescan — that flashes "Starting scan…" after the movie
    // already played (common on player-api when a refresh orphans the pick).
    const showSourceLoading =
        !playerSource &&
        !playbackStable &&
        !playbackActive &&
        (isScanningProviders ||
            isAwaitingInitialPick ||
            isLoading ||
            sourcesLoadingMore ||
            holdEmptyForDiscovery ||
            (playbackOptions.length === 0 &&
                (isLoading ||
                    sourcesLoadingMore ||
                    isScanningProviders ||
                    holdEmptyForDiscovery ||
                    hasStartedPlaybackAttempt)))

    useEffect(() => {
        if (!showSourceLoading) return

        const timer = window.setTimeout(() => {
            if (sourceLoadingWatchdogRef.current) return
            sourceLoadingWatchdogRef.current = true
            void refetchSources()
            const bootstrapProviders = orderedEnabledProviderIds.filter(
                (providerId) => normalizeProviderName(providerId) !== "vidlink"
            )
            for (let index = 0; index < Math.min(2, bootstrapProviders.length); index += 1) {
                const providerId = bootstrapProviders[index]
                if (providerId) {
                    void requestProvider(providerId)
                }
            }
        }, PRIMARY_PROVIDER_HEAD_START_MS)

        return () => window.clearTimeout(timer)
    }, [
        diagnostics,
        mediaId,
        mediaType,
        season,
        episode,
        providerOrder,
        refetchSources,
        requestProvider,
        showSourceLoading,
        sources.length,
    ])

    const handleSelectSource = (id: string, optionOverride?: PlaybackOption) => {
        setRuntimeError(undefined)
        playbackStableRef.current = false
        setPlaybackStable(false)
        lockedPlaybackUrlRef.current = null

        const option =
            optionOverride ?? playbackOptions.find((item) => item.id === id)
        const optionIsClientResolve = Boolean(
            option && isClientResolveProvider(option.providerId ?? "")
        )
        // VAPlayer/Videasy/Movy CDN remounts that inherit mid-title seek stall
        // with empty Quality. Force start@0 for those; keep hold for others.
        const resumeAt = playbackPositionForRecovery(livePlaybackTimeRef.current)
        if (optionIsClientResolve) {
            setUpgradeResumeTime(0)
            livePlaybackTimeRef.current = 0
        } else if (resumeAt !== undefined) {
            setUpgradeResumeTime(resumeAt)
            livePlaybackTimeRef.current = resumeAt
        }

        if (option) {
            markManualSelection(id, option.providerId)
            writePlaybackProviderPref(playbackPrefParams, option.providerId)
        }

        markSourceReady(id)
        // Always remount onto the picked source. Skipping this in embedMode
        // left MediaPlayer on the previous stream so Quality → Server taps
        // looked dead. Do not clear selectedSourceId first — that unmounts
        // into an empty black frame.
        setSourceSwitchNonce((nonce) => nonce + 1)
        setSelectedSourceId(id)
        void ensureProbed(id, true)
    }

    const handleRequestProvider = async (providerId: string) => {
        const providerKey = normalizeProviderName(providerId)
        const isExplicitFourK = providerKey === "4khdhub"
        const isClientResolve = isClientResolveProvider(providerKey)

        const currentPlayingId = selectedSourceIdRef.current || selectedSourceId
        const currentPlayingProvider = normalizeProviderName(
            playbackOptions.find((option) => option.id === currentPlayingId)
                ?.providerId ??
                selectedProviderKeyRef.current ??
                ""
        )
        // Re-tapping VAPlayer while already on it used to re-scrape + remount
        // + mid-seek and kill a working stream.
        if (
            isClientResolve &&
            currentPlayingProvider === providerKey &&
            Boolean(currentPlayingId)
        ) {
            setRuntimeError(undefined)
            return
        }

        markPendingProviderSelection(providerKey)
        // Keep current video up while the next client-resolve provider scrapes.
        if (!isClientResolve) {
            playbackStableRef.current = false
            setPlaybackStable(false)
        }
        setRuntimeError(undefined)

        // Client-resolve CDN remounts must start@0 (not Continue Watching clock).
        const holdAt = playbackPositionForRecovery(livePlaybackTimeRef.current)
        if (holdAt !== undefined && !isClientResolve) {
            setUpgradeResumeTime(holdAt)
            livePlaybackTimeRef.current = holdAt
        } else if (isClientResolve) {
            setUpgradeResumeTime(0)
            livePlaybackTimeRef.current = 0
        }

        // Keep the current stream mounted while the next provider resolves.
        // Clearing selectedSourceId here unmounted MediaPlayer into a black
        // "NOW PLAYING" frame — and if the new source then failed its first
        // proxy hit, the embed never recovered (VAPlayer/Movy switches).

        const pickForRequest = (options: PlaybackOption[]) =>
            isExplicitFourK
                ? pickHighestFourKPlaybackOption(options)
                : options.find(
                      (option) =>
                          normalizeProviderName(option.providerId ?? "") ===
                          providerKey
                  )

        const existing = pickForRequest(playbackOptions)
        // Embed fast-start often never marks health "ready". Still switch
        // immediately when that provider already has a stream — except for
        // client-resolve providers (VAPlayer/Movy/Videasy/…). Their URLs expire
        // and reusing a cached option remounted a dead stream (black until the
        // user tapped the same source again). Always re-scrape those.
        //
        // VSEmbed (and other on-demand TV scrapes) must also re-fetch: after
        // episode changes, a leftover "ready" VSEmbed row can still point at
        // the previous episode (S4E7 playing while UI says S4E6).
        const mustRefetchProvider =
            isClientResolveProvider(providerKey) ||
            providerKey === "vsembed" ||
            (mediaType === "tv" &&
                (providerKey === "hollymoviehd" ||
                    providerKey === "moviesonlinehd" ||
                    providerKey === "cinejoy" ||
                    providerKey === "vidapiru"))
        if (
            existing &&
            !mustRefetchProvider &&
            (toflixPlayback ||
                canImmediatelyStartProviderOption(existing, sourceHealth))
        ) {
            handleSelectSource(existing.id, existing)
            return
        }

        try {
            if (isExplicitFourK) {
                setRuntimeError(t("player.fourKStarting"))
            } else if (providerKey === "vsembed") {
                setRuntimeError("Starting VSEmbed…")
            } else if (providerKey === "videasy") {
                setRuntimeError("Starting Videasy…")
            } else if (providerKey === "movy" || providerKey === "vaplayer" || providerKey === "7movies") {
                setRuntimeError(`Starting ${providerKey === "7movies" ? "7Movies" : providerKey === "vaplayer" ? "VAPlayer" : "Movy"}…`)
            }

            const payload = await requestProvider(providerId)
            const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                providerOrder: orderedEnabledProviderIds,
                showRealProviderNames,
            })
            const matching = pickForRequest(refreshed)

            if (matching) {
                setRuntimeError(undefined)
                handleSelectSource(matching.id, matching)
                return
            }

            const diagnosticMessage =
                payload.diagnostics.find((item) =>
                    ["VIDLINK_UNAVAILABLE", "VIDLINK_DISABLED", "PROVIDER_ERROR", "CLIENT_PROVIDER_UNAVAILABLE", "VIDVAULT_EMPTY", "VIDVAULT_DISABLED"].includes(
                        item.code ?? ""
                    )
                )?.message

            const label = resolveProviderUserLabel(
                providerId,
                getProviderDisplayName(providerId),
                providerOrder,
                showRealProviderNames
            )
            setRuntimeError(
                diagnosticMessage ??
                    `No stream from ${label} right now. Tap ${label} again.`
            )
        } catch (err) {
            const msg =
                err instanceof Error && err.message
                    ? err.message
                    : "Could not load that source. Tap it again."
            setRuntimeError(msg)
        }
    }

    const sourceStatusMessage = useMemo(() => {
        if (runtimeError) {
            return sanitizePublicPlaybackStatusWithT(t, runtimeError, showRealProviderNames)
        }
        if (sourcesLoadingMore) return undefined

        const hasPlayable = Boolean(playerSource) || hasReadySource
        const infra =
            diagnostics.find((item) => item.code === "CINEPRO_OFFLINE")?.message ??
            (hasPlayable
                ? undefined
                : diagnostics.find((item) => item.code === "CINEPRO_UNAVAILABLE")
                      ?.message) ??
            diagnostics.find((item) => item.code === "CINEPRO_NOT_CONFIGURED")?.message ??
            diagnostics.find((item) => item.code === "CINEPRO_SELF_REFERENCE")?.message

        return infra
            ? sanitizePublicPlaybackStatusWithT(t, infra, showRealProviderNames)
            : undefined
    }, [
        diagnostics,
        hasReadySource,
        playerSource,
        runtimeError,
        showRealProviderNames,
        sourcesLoadingMore,
        t,
    ])

    const warningMessage = useMemo(
        () => {
            if (showSourceLoading || embedMode) return undefined

            return pickUserFacingPlaybackWarning({
                runtimeError,
                fetchError: error,
                diagnostics,
                hasPlayableSource: Boolean(playerSource) || hasReadySource,
                sourcesLoading: isLoading,
                sourcesLoadingMore: sourcesLoadingMore || isScanningProviders,
                providerOrder: orderedEnabledProviderIds,
                showRealProviderNames,
            })
        },
        [
            diagnostics,
            embedMode,
            error,
            hasReadySource,
            isLoading,
            isScanningProviders,
            playerSource,
            providerOrder,
            runtimeError,
            showRealProviderNames,
            showSourceLoading,
            sourcesLoadingMore,
        ]
    )

    const handlePlaybackReady = (meta: PlaybackErrorMeta) => {
        // Any buffered media means the chosen source started — drop "Starting VAPlayer…".
        if ((meta.bufferedSeconds ?? 0) >= 0.25 || (meta.currentTime ?? 0) > 0.2) {
            setRuntimeError(undefined)
        }
        if (hasStablePlayback(meta)) {
            playbackStableRef.current = true
            setPlaybackStable(true)
            setPlaybackActive(true)
            setRuntimeError(undefined)
            quietStallAttemptRef.current = 0
            if (resolvedSourceId) {
                markSourceReady(resolvedSourceId)
            }
            const playing = playbackOptions.find((option) => option.id === resolvedSourceId)
            // Never sticky-save low-ranked scrapes from auto-start — Continue
            // Watching would reopen on FileSuN instead of VAPlayer/Videasy.
            if (
                playing?.providerId &&
                !shouldHoldForHigherRankedProviders(playing.providerId)
            ) {
                writePlaybackProviderPref(playbackPrefParams, playing.providerId)
            }
        }
    }


const quietStallAttemptRef = useRef(0)

    const quietBackgroundStallCheck = useCallback(async () => {
        // Settled watch: MediaPlayer already did an in-place HLS startLoad.
        // Refetching/remounting here is what kills a working VSEmbed mid-play
        // (black flash → "finds source" → resumes) especially on flaky CDNs
        // for one title while others on the same provider play fine.
        if (playbackStableRef.current || playbackActive) {
            return false
        }

        const resumeAt = playbackPositionForRecovery(livePlaybackTimeRef.current)
        if (resumeAt === undefined) return false

        setUpgradeResumeTime(resumeAt)
        livePlaybackTimeRef.current = resumeAt

        const preferProviderId =
            selectedProviderKeyRef.current ||
            playbackOptions.find((option) => option.id === selectedSourceIdRef.current)
                ?.providerId
        const currentId = selectedSourceIdRef.current
        const attempt = quietStallAttemptRef.current
        if (attempt >= 3) return false // stop endless source walking

        try {
            // Client-resolve providers are not in bulk /sources — re-scrape them
            // first so a black VAPlayer/Movy stall can recover without a manual tap.
            if (
                preferProviderId &&
                isClientResolveProvider(preferProviderId) &&
                attempt === 0
            ) {
                const payload = await requestProvider(preferProviderId)
                const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                    providerOrder: orderedEnabledProviderIds,
                    showRealProviderNames,
                })
                const matching = refreshed.find(
                    (option) =>
                        normalizeProviderName(option.providerId ?? "") ===
                        normalizeProviderName(preferProviderId)
                )
                if (matching) {
                    quietStallAttemptRef.current = attempt + 1
                    setRuntimeError(undefined)
                    setUpgradeResumeTime(resumeAt)
                    // Same provider+quality can still carry a freshly resolved URL.
                    // Remount like a manual same-source tap so it cannot stay black.
                    if (!bumpSourceSwitch()) return false
                    syncSelectedSourceId(matching.id)
                    setSelectedSourceId(matching.id)
                    return true
                }
            }

            const payload = await refetchSourcesAsync()
            const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                providerOrder: orderedEnabledProviderIds,
                showRealProviderNames,
            })

            let nextId: string | undefined

            if (attempt === 0) {
                const picked = pickSourceAfterRefetch(refreshed, {
                    preferProviderId,
                    sameProviderOnly: false,
                })
                nextId = picked?.nextSourceId
            } else {
                if (preferProviderId) {
                    markSourceFailed(currentId)
                }
                const picked = pickSourceAfterRefetch(refreshed, {
                    preferProviderId,
                    sameProviderOnly: false,
                })
                nextId = picked?.nextSourceId
                if (nextId === currentId) {
                    const alternate = refreshed.find((option) => option.id !== currentId)
                    nextId = alternate?.id ?? nextId
                }
            }

            if (!nextId) return false

            quietStallAttemptRef.current = attempt + 1
            setRuntimeError(undefined)
            setUpgradeResumeTime(resumeAt)
            if (nextId === selectedSourceIdRef.current) {
                return true
            }
            if (!bumpSourceSwitch()) return false
            syncSelectedSourceId(nextId)
            setSelectedSourceId(nextId)
            return true
        } catch {
            return false
        }
    }, [
        bumpSourceSwitch,
        markSourceFailed,
        orderedEnabledProviderIds,
        pickSourceAfterRefetch,
        playbackActive,
        playbackOptions,
        refetchSourcesAsync,
        requestProvider,
        showRealProviderNames,
        syncSelectedSourceId,
    ])

    const refetchAndResumeSource = useCallback(
        async (sameProviderOnly: boolean) => {
            const resumeAt = playbackPositionForRecovery(livePlaybackTimeRef.current)
            if (resumeAt !== undefined) {
                setUpgradeResumeTime(resumeAt)
                livePlaybackTimeRef.current = resumeAt
            }
            if (!bumpSourceSwitch()) {
                return false
            }

            const preferProviderId =
                selectedProviderKeyRef.current ||
                playbackOptions.find((option) => option.id === selectedSourceIdRef.current)
                    ?.providerId

            try {
                // Bulk refetch cannot refresh VAPlayer/Movy/Videasy — re-scrape
                // those in the browser so auto-reconnect matches a manual re-tap.
                if (
                    preferProviderId &&
                    isClientResolveProvider(preferProviderId) &&
                    sameProviderOnly
                ) {
                    const clientPayload = await requestProvider(preferProviderId)
                    const clientRefreshed = mapSourcesToPlaybackOptions(
                        clientPayload.sources,
                        {
                            providerOrder: orderedEnabledProviderIds,
                            showRealProviderNames,
                        }
                    )
                    const matching = clientRefreshed.find(
                        (option) =>
                            normalizeProviderName(option.providerId ?? "") ===
                            normalizeProviderName(preferProviderId)
                    )
                    if (matching) {
                        setRuntimeError(undefined)
                        setUpgradeResumeTime(
                            playbackPositionForRecovery(livePlaybackTimeRef.current) ??
                                resumeAt
                        )
                        syncSelectedSourceId(matching.id)
                        setSelectedSourceId(matching.id)
                        return true
                    }
                }

                const payload = await refetchSourcesAsync()
                const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                    providerOrder: orderedEnabledProviderIds,
                    showRealProviderNames,
                })
                const picked = pickSourceAfterRefetch(refreshed, {
                    preferProviderId,
                    sameProviderOnly,
                })

                if (!picked) {
                    setRuntimeError(
                        "Could not reconnect this stream. Open player settings and pick another source."
                    )
                    return false
                }

                setRuntimeError(undefined)
                setUpgradeResumeTime(
                    playbackPositionForRecovery(livePlaybackTimeRef.current) ??
                        resumeAt
                )
                syncSelectedSourceId(picked.nextSourceId)
                setSelectedSourceId(picked.nextSourceId)
                return true
            } catch {
                setRuntimeError(
                    "Could not refresh stream links. Open player settings and pick another source."
                )
                return false
            }
        },
        [
            bumpSourceSwitch,
            orderedEnabledProviderIds,
            pickSourceAfterRefetch,
            playbackOptions,
            refetchSourcesAsync,
            requestProvider,
            showRealProviderNames,
            syncSelectedSourceId,
        ]
    )

    const resolveMoreProviders = async () => {
        if (providerResolveAttemptedRef.current) return
        providerResolveAttemptedRef.current = true
        setRuntimeError(t("player.status.findingStream"))

        try {
            const payload = await refetchSourcesAsync()
            const refreshed = mapSourcesToPlaybackOptions(payload.sources, {
                providerOrder: orderedEnabledProviderIds,
                showRealProviderNames,
            })
            const preferred = pickSourceAfterRefetch(refreshed)

            if (preferred) {
                // Don't sticky-show "Trying …" over the player once a source is picked —
                // VAPlayer can take a few seconds to paint and the pill looked broken.
                setRuntimeError(undefined)
                setSelectedSourceId(preferred.nextSourceId)
                return
            }

            const recovery = attemptRecoveryFromOptions(refreshed)
            if (recovery) {
                setRuntimeError(undefined)
                setSelectedSourceId(recovery.nextSourceId)
                return
            }

            setRuntimeError(
                sourceStatusMessage ??
                    diagnostics.find((item) => item.code === "CINEPRO_OFFLINE")?.message ??
                    "No other providers returned a stream. Start CinePro Core on port 3001, then tap Retry below."
            )
        } catch {
            setRuntimeError(
                "Could not reach CinePro Core. Start it on port 3001, then tap Retry below."
            )
        }
    }

    const handlePlaybackError = (message: string, meta?: PlaybackErrorMeta) => {
        const metaResolved = meta ?? { currentTime: 0, bufferedSeconds: 0 }
        const isStable =
            playbackStableRef.current || hasStablePlayback(metaResolved)

        if (isStable) {
            if (isRecoverableStreamError(message)) {
                void refetchAndResumeSource(true)
                return
            }

            setRuntimeError(
                `${message}. Open player settings and pick another source if playback does not resume.`
            )
            return
        }

        if (resolvedSourceId) {
            markSourceFailed(resolvedSourceId)
        }

        if (isProxyTokenPlaybackError(message) && !sourcesLoadingMore) {
            void refetchAndResumeSource(false)
            return
        }

        const awaitingMoreSources =
            (isLoading || sourcesLoadingMore) && isVidLinkOnlySources(sources)
        const result = resolvePlaybackError(message, metaResolved, awaitingMoreSources)

        if (result.action === "fallback") {
            if (!bumpSourceSwitch()) {
                setRuntimeError(
                    "Buffering… reconnecting"
                )
                return
            }

            const resumeAt = playbackPositionForRecovery(livePlaybackTimeRef.current)
            if (resumeAt !== undefined) {
                setUpgradeResumeTime(resumeAt)
            }
            setRuntimeError(result.statusMessage)
            syncSelectedSourceId(result.nextSourceId)
            setSelectedSourceId(result.nextSourceId)
            return
        }

        if (result.action === "pending") {
            void resolveMoreProviders()
            return
        }

        if (
            isVidLinkOnlySources(sources) &&
            !isLoading &&
            !sourcesLoadingMore &&
            !manualSelectionRef.current
        ) {
            void resolveMoreProviders()
            return
        }

        setRuntimeError(result.errorMessage)
    }

    useEffect(() => {
        if (!isCurrentProviderFailed() || !isVidLinkOnlySources(sources)) return
        if (isLoading || sourcesLoadingMore || providerResolveAttemptedRef.current) return

        void resolveMoreProviders()
    }, [isCurrentProviderFailed, isLoading, sources, sourcesLoadingMore])

    const hostedOnParent = Boolean(embedOptions?.hostedOnParent)
    // Embed iframes: parent cinema covers the scan. Do not mount the heavy
    // source overlay here — that made Toflix Play feel slow.
    const quietScanUi = Boolean(embedMode)

    const handleEmbedControlsVisible = useCallback((visible: boolean) => {
        postEmbedMessage(EMBED_MESSAGE_CONTROLS_VISIBLE, { visible })
    }, [])

    const showHardUnavailable =
        !playerSource &&
        !showSourceLoading &&
        !playbackStable &&
        !playbackActive &&
        !isLoading &&
        !sourcesLoadingMore &&
        !isScanningProviders &&
        !holdEmptyForDiscovery &&
        !hasStartedPlaybackAttempt

    let builtinPlayer: ReactNode
    if (playerSource) {
        builtinPlayer = (
        <Suspense
            fallback={<div className="h-full min-h-0 w-full bg-black" aria-hidden="true" />}
        >
            <MediaPlayer
            key={(() => {
                const parsed = parseStableSourceId(playerSource.id)
                // Provider+type only — including quality remounted MediaPlayer on
                // every ladder/row swap and flashed "Starting playback…".
                const stable =
                    parsed
                        ? `${parsed.providerId}:${parsed.type}`
                        : playerSource.id
                // Once playback is settled, ignore URL fingerprint changes from
                // background source refreshes — those remounts black-flash a
                // working stream (title-specific flaky CDNs look "broken").
                const urlFp = playbackStable
                    ? "locked"
                    : String(playerSource.url || "")
                        .replace(/[?#].*$/, "")
                        .slice(-48)
                return embedMode
                    ? `embed:${mediaType}:${mediaId}:s${season ?? ""}:e${episode ?? ""}:${stable}:u${urlFp}:n${sourceSwitchNonce}`
                    : `${stable}:u${urlFp}:n${sourceSwitchNonce}`
            })()}
            source={playerSource}
            sources={playbackOptions.map((option) => ({
                id: option.id,
                label: option.label,
                provider: option.provider,
                providerId: option.providerId,
                quality: option.quality,
            }))}
            subtitles={mergedSubtitles}
            externalSubtitlesLoading={loadingExternalSubtitles}
            audioTracks={selectedPlayback?.audioTracks ?? []}
            onSelectSource={handleSelectSource}
            onRequestProvider={handleRequestProvider}
            onPlaybackError={handlePlaybackError}
            onPlaybackReady={handlePlaybackReady}
            onPlaybackTime={handlePlaybackTime}
            sourcesLoadingMore={sourcesLoadingMore}
            sourceStatusMessage={sourceStatusMessage}
            onRefetchSources={refetchSources}
            onBufferStall={() => {
                void quietBackgroundStallCheck()
            }}
            unavailableProviders={unavailableProviders}
            sourceHealth={sourceHealth}
            activeTestingProviderId={activeTestingProviderId}
            playbackToken={playbackToken}
            watchMeta={stableWatchMeta}
            resumeTime={
                isWatchPartyGuest && guestResumeTime
                    ? guestResumeTime
                    : awaitingPartyRoom
                      ? 0
                      : resumeTime
            }
            onPlaybackSync={isWatchPartyHost ? handlePlaybackSync : undefined}
            syncPlayback={isWatchPartyGuest ? syncPlayback : null}
            watchPartyGuest={guestPlayback}
            onPlaybackEnded={inWatchParty ? undefined : handlePlaybackEnded}
            tvNavigation={
                mediaType === "tv" && onTvEpisodeChange && !inWatchParty
                    ? {
                          showId: mediaId,
                          showTitle: mediaTitle,
                          currentSeason: numericSeason ?? 1,
                          currentEpisode: numericEpisode ?? 1,
                          onEpisodeSelect: onTvEpisodeChange,
                      }
                    : undefined
            }
            autoNextEnabled={autoNext}
            onAutoNextChange={handleAutoNextChange}
            showAutoNext={mediaType === "tv" && !inWatchParty}
            embedReportingEnabled={embedMode}
            embedMediaType={mediaType}
            embedSeason={numericSeason}
            embedEpisode={numericEpisode}
            forceAutoplay={Boolean(embedOptions?.autoplay)}
            showRealProviderNames={showRealProviderNames}
            parentHostedEmbed={embedMode && hostedOnParent}
            fullscreenRootRef={
                embedMode && !hostedOnParent ? embedShellRef : undefined
            }
            onControlsOverlayVisibleChange={
                embedMode && hostedOnParent ? handleEmbedControlsVisible : undefined
            }
            hiddenProviderIds={hiddenProviderIds}
            enabledProviderIds={orderedEnabledProviderIds}
        />
        </Suspense>
        )
    } else if (playbackStable || playbackActive) {
        // Source list briefly orphaned the pick after play — hold the stage.
        // Rematch runs above. Do not flash "Starting scan…".
        builtinPlayer = quietScanUi ? (
            <div className="h-full min-h-0 w-full bg-black" aria-hidden="true" />
        ) : (
            <div className="flex h-full min-h-0 items-center justify-center bg-black text-sm text-white/55">
                Reconnecting…
            </div>
        )
    } else if (showSourceLoading || !showHardUnavailable) {
        // Toflix / parent embeds: no Please wait, spinner, Alpha, or fake player chrome.
        builtinPlayer = quietScanUi ? (
            <div className="h-full min-h-0 w-full bg-black" aria-hidden="true" />
        ) : (
        <SourceLoadingOverlay
            active={true}
            sources={sources}
            diagnostics={diagnostics}
            cineproOnly={isVidLinkOnlySources(sources)}
            activeTestingProviderId={activeTestingProviderId}
            sourceHealth={sourceHealth}
            playbackOptions={playbackOptions}
            sourcesLoadingMore={sourcesLoadingMore}
            sourcesFetching={isLoading || (isScanningProviders && sources.length === 0)}
            scanFailedProviderIds={scanFailedProviderIds}
            playbackStarted={Boolean(playerSource)}
            showRealProviderNames={showRealProviderNames}
            onRefetchSources={refetchSources}
            sourceStatusMessage={sourceStatusMessage}
        />
        )
    } else {
        builtinPlayer = (
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-white/10 bg-black/70 px-6 py-8 text-center text-sm text-white/70">
            {embedMode ? (
                <p>{getTitleUnavailableMessage(t)}</p>
            ) : (
                <>
                    <p>{getTitleUnavailableMessage(t)}</p>
                    <PlaybackSourceRetryPanel
                        message={warningMessage ?? sourceStatusMessage}
                        onRetry={refetchSources}
                        messageClassName="text-white/50"
                    />
                </>
            )}
        </div>
        )
    }

    const playerLayout = (
        <div className={cn("relative flex h-full min-h-0 flex-col space-y-0 overflow-hidden", !embedMode && "min-h-[50vh] md:min-h-[70vh]")}>
            {effectiveShowToolbar ? (
                <div className="space-y-3 px-3 pt-3 md:px-4">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground md:text-base">
                            {mediaTitle}
                        </p>
                        <div className="flex items-center gap-2">
                            <WatchPartyDropdown
                            open={watchPartyOpen}
                            onOpenChange={setWatchPartyOpen}
                            mediaType={mediaType}
                            mediaId={mediaId}
                            mediaTitle={mediaTitle}
                            season={numericSeason}
                            episode={numericEpisode}
                            room={watchPartyRoom}
                            onRoomChange={setWatchPartyRoom}
                            onJoinHostMedia={handleJoinHostMedia}
                            triggerClassName="border-border/60 bg-background/80 text-foreground hover:bg-muted"
                        />
                        </div>
                    </div>

                    {/* VidFast forced: no Chillflix/engine choice UI */}
                    {null}
                </div>
            ) : embedShowToolbar ? (
                // Movy chrome already owns the title (back + name + runtime).
                // Do not stack a second "Now Playing" / title overlay on top.
                <div
                    className={cn(
                        "pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[2.4rem_minmax(0,1fr)_auto] items-start gap-1.5",
                        "px-[0.7rem] pb-5 pt-[max(0.65rem,env(safe-area-inset-top))]"
                    )}
                >
                    <span className="size-[2.2rem] shrink-0" aria-hidden="true" />
                    <span />
                    {embedOptions?.showWatchParty !== false && !embedOptions?.hostedOnParent ? (
                        <div className="pointer-events-auto flex shrink-0 justify-end pt-[0.15rem]">
                            <WatchPartyDropdown
                            open={watchPartyOpen}
                            onOpenChange={setWatchPartyOpen}
                            mediaType={mediaType}
                            mediaId={mediaId}
                            mediaTitle={mediaTitle}
                            season={numericSeason}
                            episode={numericEpisode}
                            room={watchPartyRoom}
                            onRoomChange={setWatchPartyRoom}
                            onJoinHostMedia={handleJoinHostMedia}
                            triggerClassName="border-white/10 bg-white/[0.05] text-white hover:bg-white/10"
                        />
                        </div>
                    ) : (
                        <span className="size-[2.2rem] shrink-0" aria-hidden="true" />
                    )}
                </div>
            ) : null}

            <ExternalPlayerPanel
                mediaType={mediaType}
                mediaId={mediaId}
                season={season}
                episode={episode}
                activePlayerId={inWatchParty ? null : effectiveActivePlayerId}
                onSelectPlayer={setActivePlayerId}
                builtinPlayer={
                    awaitingPartyRoom ? (
                        <div className="flex h-full min-h-[240px] items-center justify-center rounded-md border border-white/10 bg-black/70 px-6 text-sm text-white/70">
                            {t("watchParty.joining")}
                        </div>
                    ) : (
                        builtinPlayer
                    )
                }
                hidePlayerPicker={true}
                playerLayout="fill"
            />
        </div>
    )

    if (embedMode && !hostedOnParent) {
        return (
            <FullscreenPortalContext.Provider value={embedFullscreenPortal}>
                <div ref={setEmbedShellRef} className="relative flex h-full min-h-0 flex-col overflow-hidden">
                    {playerLayout}
                </div>
            </FullscreenPortalContext.Provider>
        )
    }

    return playerLayout
}
