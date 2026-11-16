"use client"

import { useMemo } from "react"

import {
    getConfiguredProviders,
    parseUnavailableProviders,
} from "@/components/player/utils/playback"
import type { SourceHealthStatus } from "@/hooks/useSourceHealth"
import { useTranslations } from "@/lib/i18n/client"
import { resolveProviderUserLabel } from "@/lib/provider-display"
import { normalizeProviderName, type StreamSourceEntry } from "@/lib/stream-sources-defaults"

export type ProviderProbeStatus = "found" | "failed" | "testing" | "pending"

export interface ProviderProbeRow {
    id: string
    displayName: string
    status: ProviderProbeStatus
    /** Real source lines for testing UI, e.g. "1080p · hls". */
    detail?: string
}

interface MediaSourceLike {
    provider: { id?: string; name?: string }
    quality?: string
    type?: string
}

interface DiagnosticLike {
    code?: string
    message?: string
}

interface PlaybackOptionLike {
    id: string
    providerId?: string
    quality?: string
    type?: string
}

interface UseSourceLoadingProgressArgs {
    active: boolean
    sources: MediaSourceLike[]
    diagnostics: DiagnosticLike[]
    configuredSources: StreamSourceEntry[]
    cineproOnly?: boolean
    activeTestingProviderId?: string
    sourceHealth?: Record<string, SourceHealthStatus>
    playbackOptions?: PlaybackOptionLike[]
    /** CinePro or background source fetch still in progress. */
    sourcesLoadingMore?: boolean
    /** Initial sources API request still in progress. */
    sourcesFetching?: boolean
    /** Provider IDs already timed out or returned empty during client scan. */
    scanFailedProviderIds?: string[]
    /** Stop scan animation once playback has started. */
    playbackStarted?: boolean
    /** When true, only show automatic probe providers with real names. */
    automaticOnly?: boolean
    /** Show every configured provider in the scan list while active. */
    showAllProvidersWhileActive?: boolean
    showRealProviderNames?: boolean
    providerOrder?: readonly string[]
}

function deriveProviderStatusFromHealth(
    providerId: string,
    playbackOptions: PlaybackOptionLike[],
    sourceHealth: Record<string, SourceHealthStatus>
): ProviderProbeStatus {
    const options = playbackOptions.filter((option) => option.providerId === providerId)
    if (options.length === 0) return "pending"

    const statuses = options.map((option) => sourceHealth[option.id] ?? "idle")

    if (statuses.some((status) => status === "ready")) return "found"
    if (statuses.some((status) => status === "checking")) return "testing"
    if (statuses.every((status) => status === "failed")) return "failed"

    return "pending"
}

export function useSourceLoadingProgress({
    active,
    sources,
    diagnostics,
    configuredSources,
    cineproOnly = false,
    activeTestingProviderId,
    sourceHealth,
    playbackOptions,
    sourcesLoadingMore = false,
    sourcesFetching = false,
    playbackStarted = false,
    automaticOnly = true,
    showAllProvidersWhileActive = true,
    showRealProviderNames = false,
    providerOrder,
    scanFailedProviderIds = [],
}: UseSourceLoadingProgressArgs) {
    const { t } = useTranslations()
    const scanActive = active && !playbackStarted

    const providers = useMemo(() => {
        const configured = getConfiguredProviders(configuredSources)
        const byId = new Map(configured.map((provider) => [provider.id, provider]))

        const enabledIdSet = new Set(configured.map((provider) => provider.id))

        const orderIds = providerOrder?.length
            ? providerOrder
                  .map((id) => normalizeProviderName(id))
                  .filter((id) => enabledIdSet.has(id))
            : automaticOnly
              ? configured
                    .filter((provider) => provider.id !== "vidlink")
                    .map((provider) => provider.id)
              : configured.map((provider) => provider.id)

        const seen = new Set<string>()
        const list: Array<{ id: string; name: string }> = []

        for (const id of orderIds) {
            const provider = byId.get(id)
            if (!provider || seen.has(provider.id)) continue
            seen.add(provider.id)
            list.push(provider)
        }

        if (!providerOrder?.length) {
            for (const provider of configured) {
                if (seen.has(provider.id)) continue
                seen.add(provider.id)
                list.push(provider)
            }
        }

        if (cineproOnly) {
            return list.filter((provider) => provider.id !== "vidlink")
        }

        return list
    }, [automaticOnly, configuredSources, cineproOnly, providerOrder])

    const useHealthStatus = Boolean(sourceHealth && playbackOptions?.length)

    const foundProviderIds = useMemo(() => {
        if (useHealthStatus && sourceHealth && playbackOptions) {
            return new Set(
                providers
                    .filter(
                        (provider) =>
                            deriveProviderStatusFromHealth(
                                provider.id,
                                playbackOptions,
                                sourceHealth
                            ) === "found"
                    )
                    .map((provider) => provider.id)
            )
        }

        if (scanActive) {
            return new Set<string>()
        }

        return new Set(
            sources
                .map((source) =>
                    normalizeProviderName(source.provider?.id ?? source.provider?.name ?? "")
                )
                .filter(Boolean)
        )
    }, [playbackOptions, providers, scanActive, sourceHealth, sources, useHealthStatus])

    const failedProviderIds = useMemo(() => {
        const activeNames = sources
            .map((source) => source.provider?.name ?? "")
            .filter(Boolean)
        const fromDiagnostics = parseUnavailableProviders(diagnostics, activeNames).map((name) =>
            normalizeProviderName(name)
        )

        if (useHealthStatus && sourceHealth && playbackOptions) {
            const fromHealth = providers
                .filter(
                    (provider) =>
                        deriveProviderStatusFromHealth(
                            provider.id,
                            playbackOptions,
                            sourceHealth
                        ) === "failed"
                )
                .map((provider) => provider.id)

            return new Set([...fromDiagnostics, ...fromHealth, ...scanFailedProviderIds])
        }

        return new Set([...fromDiagnostics, ...scanFailedProviderIds])
    }, [diagnostics, playbackOptions, providers, scanFailedProviderIds, sourceHealth, sources, useHealthStatus])

    const activeProbeProviderId = useMemo(() => {
        if (activeTestingProviderId) {
            return activeTestingProviderId
        }

        if (sourcesFetching && providers.length > 0) {
            return providers[0]?.id
        }

        if (useHealthStatus && sourceHealth && playbackOptions) {
            const probing = providers.find(
                (provider) =>
                    deriveProviderStatusFromHealth(
                        provider.id,
                        playbackOptions,
                        sourceHealth
                    ) === "testing"
            )
            if (probing) return probing.id
        }

        if (scanActive && (sourcesLoadingMore || sourcesFetching)) {
            for (const provider of providers) {
                if (foundProviderIds.has(provider.id)) continue
                if (failedProviderIds.has(provider.id)) continue
                return provider.id
            }
        }

        return undefined
    }, [
        activeTestingProviderId,
        failedProviderIds,
        foundProviderIds,
        playbackOptions,
        providers,
        scanActive,
        sourceHealth,
        sourcesFetching,
        useHealthStatus,
        sourcesLoadingMore,
    ])

    const labelOrder = providerOrder ?? providers.map((provider) => provider.id)

    const rows: ProviderProbeRow[] = useMemo(() => {
        return providers.map((provider) => {
            let status: ProviderProbeStatus = "pending"

            if (useHealthStatus && sourceHealth && playbackOptions) {
                status = deriveProviderStatusFromHealth(
                    provider.id,
                    playbackOptions,
                    sourceHealth
                )
            } else if (foundProviderIds.has(provider.id)) {
                status = "found"
            } else if (failedProviderIds.has(provider.id)) {
                status = "failed"
            }

            if (
                status === "pending" &&
                activeProbeProviderId === provider.id &&
                (scanActive || Boolean(activeTestingProviderId) || sourcesFetching)
            ) {
                status = "testing"
            }

            const matchingSources = sources.filter((source) => {
                const id = normalizeProviderName(
                    source.provider?.id ?? source.provider?.name ?? ""
                )
                return id === provider.id
            })
            const matchingOptions = (playbackOptions ?? []).filter(
                (option) =>
                    normalizeProviderName(option.providerId ?? "") === provider.id
            )

            let detail: string | undefined
            if (status === "found") {
                const qualities = [
                    ...matchingSources.map((s) => s.quality).filter(Boolean),
                    ...matchingOptions.map((o) => o.quality).filter(Boolean),
                ] as string[]
                const types = [
                    ...matchingSources.map((s) => s.type).filter(Boolean),
                    ...matchingOptions.map((o) => o.type).filter(Boolean),
                ] as string[]
                const quality = qualities.find(Boolean)
                const streamType = types.find(Boolean)
                if (quality && streamType) detail = `${quality} · ${streamType}`
                else if (quality) detail = quality
                else if (streamType) detail = streamType
                else detail = "stream ready"
            } else if (status === "failed") {
                detail = "no stream"
            } else if (status === "testing") {
                detail = "checking…"
            }

            return {
                id: provider.id,
                displayName: resolveProviderUserLabel(
                    provider.id,
                    provider.name,
                    labelOrder,
                    showRealProviderNames
                ),
                status,
                detail,
            }
        })
    }, [
        providers,
        foundProviderIds,
        failedProviderIds,
        scanActive,
        activeProbeProviderId,
        activeTestingProviderId,
        sourcesFetching,
        useHealthStatus,
        sourceHealth,
        playbackOptions,
        labelOrder,
        showRealProviderNames,
        sources,
    ])

    const currentTestingProvider = rows.find((row) => row.status === "testing")

    const visibleRows = useMemo(() => {
        if (scanActive && showAllProvidersWhileActive) {
            return rows
        }

        return rows.filter((row) => {
            if (row.status === "found" || row.status === "failed" || row.status === "testing") {
                return true
            }

            return false
        })
    }, [rows, scanActive, showAllProvidersWhileActive])

    const foundCount = rows.filter((row) => row.status === "found").length
    const failedCount = rows.filter((row) => row.status === "failed").length

    const waitingForSources =
        sources.length === 0 && !sourcesFetching && !sourcesLoadingMore && scanActive

    const headline = playbackStarted
        ? t("player.loading.startingPlayback")
        : waitingForSources
          ? t("player.probe.stillSearching")
          : currentTestingProvider
            ? t("player.testing", { name: currentTestingProvider.displayName })
            : scanActive && sourcesLoadingMore
              ? t("player.loading.pleaseWait")
              : scanActive
                ? t("player.loading.pleaseWait")
                : t("player.probe.findingStream")

    const subtitle = playbackStarted
        ? t("player.loading.streamReady")
        : waitingForSources
          ? t("player.loading.findingFastest")
          : scanActive
            ? currentTestingProvider
                ? t("player.probe.checking", { name: currentTestingProvider.displayName })
                : sourcesLoadingMore
                  ? t("player.resolvingProviders")
                  : t("player.loading.findingFastest")
            : t("player.probe.preparingPlayback")

    return {
        rows,
        visibleRows,
        currentTestingProvider,
        headline,
        subtitle,
        foundCount,
        failedCount,
    }
}
