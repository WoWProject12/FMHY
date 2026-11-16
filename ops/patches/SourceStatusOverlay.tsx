"use client"

import { useMemo } from "react"

import { useSourceLoadingProgress } from "@/hooks/useSourceLoadingProgress"
import type { SourceHealthStatus } from "@/hooks/useSourceHealth"
import { useShowRealProviderNames } from "@/hooks/use-show-real-provider-names"
import { useStreamSourcesConfig } from "@/hooks/useStreamSourcesConfig"
import { useTranslations } from "@/lib/i18n/client"
import { normalizeProviderName } from "@/lib/stream-sources-defaults"
import { getOrderedEnabledProviderIds } from "@/components/player/utils/playback"
import { cn } from "@/lib/utils"

import { SourceProbeFlow } from "./SourceProbeFlow"

interface SourceStatusOverlayProps {
    sources: Array<{
        id: string
        label: string
        provider?: string
        providerId?: string
        quality?: string
    }>
    currentSourceId: string
    sourcesLoadingMore?: boolean
    sourceHealth?: Record<string, SourceHealthStatus>
    activeTestingProviderId?: string
    scanFailedProviderIds?: string[]
    unavailableProviders?: string[]
    isLoading?: boolean
    isPlaying?: boolean
    /** True when the video element has duration or playback progress (not just play() called). */
    hasPlaybackProgress?: boolean
    /** Extra left inset (e.g. cinema back button on mobile). */
    statusInsetLeft?: string
    /** When false, show Alpha/Beta/etc. instead of scraper names. */
    showRealProviderNames?: boolean
    /** Native video fullscreen — scan UI stays centered. Windowed phone player shifts lower. */
    isFullscreen?: boolean
}

export function SourceStatusOverlay({
    sources,
    currentSourceId,
    sourcesLoadingMore = false,
    sourceHealth,
    activeTestingProviderId,
    scanFailedProviderIds = [],
    unavailableProviders = [],
    isLoading = false,
    hasPlaybackProgress = false,
    showRealProviderNames: showRealProviderNamesProp,
    isFullscreen = false,
}: SourceStatusOverlayProps) {
    const { t } = useTranslations()
    const { config, order: providerOrder, enabledIds } = useStreamSourcesConfig()
    const orderedEnabledProviderIds = getOrderedEnabledProviderIds(providerOrder, enabledIds)
    const hookShowRealProviderNames = useShowRealProviderNames()
    const showRealProviderNames = showRealProviderNamesProp ?? hookShowRealProviderNames

    const currentSource = sources.find((item) => item.id === currentSourceId)
    const isProbing = useMemo(
        () =>
            Boolean(activeTestingProviderId) ||
            Object.values(sourceHealth ?? {}).some((status) => status === "checking"),
        [activeTestingProviderId, sourceHealth]
    )

    const hasStartedPlayback = hasPlaybackProgress

    const isScanning = sourcesLoadingMore || isProbing || isLoading
    const awaitingPlayback = Boolean(currentSource) && !hasPlaybackProgress
    const showScanPanel = (isScanning || awaitingPlayback) && !hasStartedPlayback

    const probeSources = useMemo(
        () =>
            sources.map((item) => ({
                provider: {
                    id: item.providerId ?? item.provider,
                    name: item.label.split(" (")[0],
                },
                quality: item.quality,
            })),
        [sources]
    )

    const unavailableDiagnostics = useMemo(
        () =>
            unavailableProviders.map((name) => ({
                code: "UNAVAILABLE",
                message: name,
            })),
        [unavailableProviders]
    )

    const playbackOptions = useMemo(
        () =>
            sources.map((item) => ({
                id: item.id,
                providerId: item.providerId
                    ? normalizeProviderName(item.providerId)
                    : normalizeProviderName(item.provider ?? item.label.split(" (")[0] ?? ""),
                quality: item.quality,
            })),
        [sources]
    )

    const { rows, currentTestingProvider, foundCount } = useSourceLoadingProgress({
        active: showScanPanel,
        sources: probeSources,
        diagnostics: unavailableDiagnostics,
        configuredSources: config.sources,
        activeTestingProviderId,
        sourceHealth,
        playbackOptions,
        sourcesLoadingMore,
        sourcesFetching: isLoading,
        playbackStarted: hasStartedPlayback,
        showAllProvidersWhileActive: true,
        showRealProviderNames,
        providerOrder: orderedEnabledProviderIds,
        scanFailedProviderIds,
    })

    const healthReadyCount = useMemo(
        () => Object.values(sourceHealth ?? {}).filter((status) => status === "ready").length,
        [sourceHealth]
    )

    const readyCount = Math.max(foundCount, healthReadyCount)

    if (!currentSource && !showScanPanel) {
        return null
    }

    if (hasStartedPlayback && !showScanPanel) {
        return null
    }

    if (!showScanPanel) {
        return null
    }

    // rows can be empty briefly while providers flip — still show “finding” chrome
    // so the player never sits as a bare grey video with no explanation.
    return (
        <div
            className={cn(
                "pointer-events-none absolute inset-0 z-20 flex flex-col items-center bg-black/35 px-4",
                isFullscreen
                    ? "justify-center py-6"
                    : "justify-center py-6 max-md:justify-start max-md:pt-[48%] max-md:pb-24 md:justify-center md:py-6"
            )}
        >
            <div className="relative mb-2.5 flex shrink-0 items-center justify-center">
                <div className="h-6 w-6 rounded-full border border-white/10 bg-white/[0.03]" />
                <div className="absolute h-6 w-6 animate-spin rounded-full border border-white/15 border-t-white/75" />
            </div>

            {rows.length > 0 ? (
                <SourceProbeFlow
                    rows={rows}
                    currentTestingProvider={currentTestingProvider}
                    sourcesLoadingMore={sourcesLoadingMore || isLoading}
                />
            ) : (
                <p className="max-w-[14rem] text-center text-[11px] font-medium text-white/75">
                    {t("player.status.findingStream")}
                </p>
            )}

            <p className="mt-2 text-center text-[9px] tabular-nums tracking-wide text-white/35">
                {t("player.ready", { count: readyCount })}
                {sources.length > 0 ? ` · ${t("player.loaded", { count: sources.length })}` : ""}
            </p>
        </div>
    )
}
