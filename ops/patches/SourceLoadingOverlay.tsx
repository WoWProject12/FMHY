"use client"

import { useEffect, useState } from "react"

import { useSourceLoadingProgress } from "@/hooks/useSourceLoadingProgress"
import type { SourceHealthStatus } from "@/hooks/useSourceHealth"
import { useShowRealProviderNames } from "@/hooks/use-show-real-provider-names"
import { useStreamSourcesConfig } from "@/hooks/useStreamSourcesConfig"
import { useTranslations } from "@/lib/i18n/client"
import { getOrderedEnabledProviderIds } from "@/components/player/utils/playback"
import {
    findInfrastructurePlaybackMessage,
    isTransientPlaybackStatusMessage,
    shouldShowPlaybackRetryButton,
} from "@/lib/playback-user-messages"
import { cn } from "@/lib/utils"

import { PlaybackSourceRetryPanel } from "./PlaybackSourceRetryPanel"
import { PlayerControls } from "./PlayerControls"
import { SourceProbeFlow } from "./SourceProbeFlow"

interface SourceLoadingOverlayProps {
    active: boolean
    sources: Array<{ provider: { id?: string; name?: string }; quality?: string; type?: string }>
    diagnostics: Array<{ code?: string; message?: string }>
    cineproOnly?: boolean
    activeTestingProviderId?: string
    sourceHealth?: Record<string, SourceHealthStatus>
    playbackOptions?: Array<{
        id: string
        label?: string
        provider?: string
        providerId?: string
        quality?: string
    }>
    sourcesLoadingMore?: boolean
    sourcesFetching?: boolean
    playbackStarted?: boolean
    scanFailedProviderIds?: string[]
    className?: string
    /** When false, show Alpha/Beta/etc. instead of scraper names. */
    showRealProviderNames?: boolean
    onRefetchSources?: () => void
    sourceStatusMessage?: string
    currentSourceId?: string
    onSelectSource?: (id: string) => void | Promise<void>
    onRequestProvider?: (providerId: string) => void | Promise<void>
    unavailableProviders?: string[]
    hiddenProviderIds?: string[]
    enabledProviderIds?: string[]
    parentHostedEmbed?: boolean
    mediaTitle?: string
    mediaId?: string | number
    mediaType?: string
}

export function SourceLoadingOverlay({
    active,
    sources,
    diagnostics,
    cineproOnly = false,
    activeTestingProviderId,
    sourceHealth,
    playbackOptions,
    sourcesLoadingMore = false,
    sourcesFetching = false,
    playbackStarted = false,
    scanFailedProviderIds = [],
    className,
    showRealProviderNames: showRealProviderNamesProp,
    onRefetchSources,
    sourceStatusMessage,
    currentSourceId,
    onSelectSource,
    onRequestProvider,
    unavailableProviders = [],
    hiddenProviderIds = [],
    enabledProviderIds,
    parentHostedEmbed = false,
    mediaTitle,
    mediaId,
    mediaType,
}: SourceLoadingOverlayProps) {
    const { t } = useTranslations()
    const { config, order: providerOrder, enabledIds, loading: streamSourcesLoading } =
        useStreamSourcesConfig()
    const orderedEnabledProviderIds = getOrderedEnabledProviderIds(
        providerOrder,
        enabledProviderIds?.length ? enabledProviderIds : enabledIds
    )
    const hookShowRealProviderNames = useShowRealProviderNames()
    const showRealProviderNames = showRealProviderNamesProp ?? hookShowRealProviderNames
    const [controlsVisible, setControlsVisible] = useState(true)

    const soapyOnlyFailure = diagnostics.find(
        (item) =>
            item.code === "PROVIDER_ERROR" &&
            typeof item.message === "string" &&
            item.message.toLowerCase().includes("soapy") &&
            item.message.toLowerCase().includes("no custom player links")
    )

    const { rows, currentTestingProvider } = useSourceLoadingProgress({
        active,
        sources,
        diagnostics,
        configuredSources: config.sources,
        cineproOnly,
        activeTestingProviderId,
        sourceHealth,
        playbackOptions,
        sourcesLoadingMore,
        sourcesFetching,
        playbackStarted,
        showAllProvidersWhileActive: true,
        showRealProviderNames,
        providerOrder: orderedEnabledProviderIds,
        scanFailedProviderIds,
    })

    const showProbeFlow =
        active && !playbackStarted && !soapyOnlyFailure && !streamSourcesLoading && rows.length > 0

    const infrastructureMessage =
        sourceStatusMessage ?? findInfrastructurePlaybackMessage(diagnostics)
    const showRetryPanel =
        Boolean(infrastructureMessage) &&
        !sourcesLoadingMore &&
        !sourcesFetching &&
        !streamSourcesLoading &&
        shouldShowPlaybackRetryButton(infrastructureMessage) &&
        !isTransientPlaybackStatusMessage(infrastructureMessage)

    const settingsSources =
        playbackOptions?.map((option) => ({
            id: option.id,
            label: option.label ?? option.provider ?? option.id,
            provider: option.provider,
            providerId: option.providerId,
            quality: option.quality,
        })) ?? []

    // Open the real player Settings → Sources sheet while Auto walks the list.
    useEffect(() => {
        if (playbackStarted || !active) return
        const timer = window.setTimeout(() => {
            window.dispatchEvent(
                new CustomEvent("chillflix:open-player-settings", {
                    detail: { tab: "source" },
                })
            )
        }, 120)
        return () => window.clearTimeout(timer)
    }, [active, playbackStarted])

    useEffect(() => {
        if (playbackStarted) return
        setControlsVisible(true)
        const hideTimer = window.setTimeout(() => setControlsVisible(true), 0)
        return () => window.clearTimeout(hideTimer)
    }, [playbackStarted, activeTestingProviderId, sourcesLoadingMore])

    if (playbackStarted) {
        return null
    }

    return (
        <div
            className={cn(
                "group relative flex h-full min-h-0 overflow-hidden bg-black text-white/80",
                className
            )}
            onPointerMove={() => setControlsVisible(true)}
            onClick={() => setControlsVisible(true)}
        >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05),transparent_55%)]" />

            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 pb-24 pt-10">
                {soapyOnlyFailure ? (
                    <div className="max-w-sm text-center">
                        <p className="text-sm font-medium text-white">
                            {t("player.soapyNoStream")}
                        </p>
                        <p className="mt-2 text-xs text-white/55">{soapyOnlyFailure.message}</p>
                    </div>
                ) : showProbeFlow ? (
                    <SourceProbeFlow
                        rows={rows}
                        currentTestingProvider={currentTestingProvider}
                        sourcesLoadingMore={sourcesLoadingMore || sourcesFetching}
                    />
                ) : showRetryPanel ? (
                    <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 text-center">
                        <PlaybackSourceRetryPanel
                            message={infrastructureMessage}
                            onRetry={onRefetchSources}
                            messageClassName="text-white/70"
                            showRetryButton
                        />
                        <p className="text-[11px] text-white/45">
                            {t("player.status.couldNotLoad")}
                        </p>
                    </div>
                ) : isTransientPlaybackStatusMessage(infrastructureMessage) ? (
                    <div className="max-w-sm text-center">
                        <p className="text-sm font-medium text-white">{infrastructureMessage}</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <div className="relative flex size-6 items-center justify-center">
                            <div className="absolute inset-0 animate-spin rounded-full border border-white/15 border-t-white/70" />
                        </div>
                        <p className="text-[11px] text-white/55">{t("player.loading.findingFastest")}</p>
                    </div>
                )}
            </div>

            <PlayerControls
                isPlaying={false}
                isLoading
                currentTime={0}
                duration={0}
                volume={1}
                isMuted={false}
                isFullscreen={false}
                onTogglePlay={() => undefined}
                onSeek={() => undefined}
                onToggleMute={() => undefined}
                onVolumeChange={() => undefined}
                onToggleFullscreen={() => undefined}
                onDoubleClick={() => undefined}
                onWheel={() => undefined}
                show={controlsVisible}
                isPiP={false}
                onTogglePiP={() => undefined}
                playbackRate={1}
                onPlaybackRateChange={() => undefined}
                qualities={[]}
                currentQuality={-1}
                onQualityChange={() => undefined}
                sources={settingsSources}
                currentSourceId={currentSourceId}
                onSelectSource={onSelectSource}
                onRequestProvider={onRequestProvider}
                sourcesLoadingMore={sourcesLoadingMore || sourcesFetching}
                sourceStatusMessage={sourceStatusMessage}
                onRefetchSources={onRefetchSources}
                unavailableProviders={unavailableProviders}
                sourceHealth={sourceHealth}
                activeTestingProviderId={activeTestingProviderId}
                scanFailedProviderIds={scanFailedProviderIds}
                showRealProviderNames={showRealProviderNames}
                hiddenProviderIds={hiddenProviderIds}
                enabledProviderIds={orderedEnabledProviderIds}
                parentHostedEmbed={parentHostedEmbed}
                mediaTitle={mediaTitle}
                mediaId={mediaId}
                mediaType={mediaType}
                onSettingsOpenChange={(open) => {
                    if (open) setControlsVisible(true)
                }}
            />
        </div>
    )
}
