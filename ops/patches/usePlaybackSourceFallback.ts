"use client"

import { useCallback, useEffect, useRef } from "react"

import type { SourceHealthStatus } from "@/hooks/useSourceHealth"
import {
    findNextAutoFallbackSource,
    getHealthFailedProviderIds,
    pickPreferredPlaybackSource,
    normalizeProviderName,
    type mapSourcesToPlaybackOptions,
    type PlaybackPickGate,
    type ProviderOrder,
} from "@/components/player/utils/playback"

export type PlaybackErrorMeta = {
    currentTime: number
    bufferedSeconds: number
}

type PlaybackOption = ReturnType<typeof mapSourcesToPlaybackOptions>[number]

export function canAutoFallbackPlayback(meta: PlaybackErrorMeta) {
    return meta.currentTime < 0.25 && meta.bufferedSeconds < 0.5
}

export function usePlaybackSourceFallback(
    playbackOptions: PlaybackOption[],
    providerOrder?: ProviderOrder,
    pickGate?: PlaybackPickGate & {
        sourceHealth?: Record<string, SourceHealthStatus>
    }
) {
    const attemptedSourceIdsRef = useRef<Set<string>>(new Set())
    const failedProviderIdsRef = useRef<Set<string>>(new Set())
    const manualSelectionRef = useRef(false)
    const selectedProviderKeyRef = useRef("")
    const selectedSourceIdRef = useRef("")
    const playbackOptionsRef = useRef(playbackOptions)

    useEffect(() => {
        playbackOptionsRef.current = playbackOptions
    }, [playbackOptions])

    const resetFallbackState = useCallback(() => {
        attemptedSourceIdsRef.current = new Set()
        failedProviderIdsRef.current = new Set()
        manualSelectionRef.current = false
        selectedProviderKeyRef.current = ""
        selectedSourceIdRef.current = ""
    }, [])

    const syncSelectedSourceId = useCallback((sourceId: string) => {
        selectedSourceIdRef.current = sourceId
        if (sourceId) {
            attemptedSourceIdsRef.current.add(sourceId)
        }
    }, [])

    const markManualSelection = useCallback((sourceId: string, providerId: string) => {
        manualSelectionRef.current = true
        selectedProviderKeyRef.current = providerId
        selectedSourceIdRef.current = sourceId
    }, [])

    /** Lock auto-pick before async provider resolve (e.g. user tapped 4K). */
    const markPendingProviderSelection = useCallback((providerId: string) => {
        manualSelectionRef.current = true
        selectedProviderKeyRef.current = providerId
    }, [])

    const markCurrentProviderFailed = useCallback(() => {
        const current = playbackOptionsRef.current.find(
            (option) => option.id === selectedSourceIdRef.current
        )

        if (current?.providerId) {
            failedProviderIdsRef.current.add(current.providerId)
        }
    }, [])

    const clearFailedProvider = useCallback((providerId: string) => {
        failedProviderIdsRef.current.delete(providerId)
    }, [])

    const buildPickGate = useCallback((): PlaybackPickGate => {
        return {
            sourcesLoadingMore: pickGate?.sourcesLoadingMore,
            unavailableProviderIds: pickGate?.unavailableProviderIds,
            sourceHealth: pickGate?.sourceHealth,
            primaryProviderId: pickGate?.primaryProviderId,
            scanFailedProviderIds: pickGate?.scanFailedProviderIds,
            healthFailedProviderIds: pickGate?.sourceHealth
                ? getHealthFailedProviderIds(playbackOptionsRef.current, pickGate.sourceHealth)
                : pickGate?.healthFailedProviderIds,
        }
    }, [pickGate])

    const pickInitialSource = useCallback(() => {
        return pickPreferredPlaybackSource(
            playbackOptionsRef.current,
            failedProviderIdsRef.current,
            providerOrder,
            buildPickGate()
        )
    }, [buildPickGate, providerOrder])

    const buildFallbackResult = useCallback((next: PlaybackOption) => {
        selectedProviderKeyRef.current = next.providerId
        selectedSourceIdRef.current = next.id
        attemptedSourceIdsRef.current.add(next.id)

        return {
            action: "fallback" as const,
            nextSourceId: next.id,
            statusMessage: `Trying ${next.provider}…`,
        }
    }, [])

    const resolvePlaybackError = useCallback(
        (
            message: string,
            meta: PlaybackErrorMeta = { currentTime: 0, bufferedSeconds: 0 },
            awaitingMoreSources = false
        ):
            | { action: "fallback"; nextSourceId: string; statusMessage: string }
            | { action: "pending"; statusMessage: string }
            | { action: "failed"; errorMessage: string } => {
            const options = playbackOptionsRef.current
            const currentId = selectedSourceIdRef.current

            markCurrentProviderFailed()

            if (currentId) {
                attemptedSourceIdsRef.current.add(currentId)
            }

            const canAutoFallback =
                !manualSelectionRef.current &&
                canAutoFallbackPlayback(meta) &&
                options.length > 0

            if (canAutoFallback) {
                const next = findNextAutoFallbackSource(
                    options,
                    attemptedSourceIdsRef.current,
                    currentId,
                    true,
                    providerOrder,
                    pickGate?.sourceHealth
                )

                if (next) {
                    return buildFallbackResult(next)
                }

                const preferred = pickPreferredPlaybackSource(
                    options,
                    failedProviderIdsRef.current,
                    providerOrder,
                    buildPickGate()
                )

                if (preferred && preferred.id !== currentId) {
                    return buildFallbackResult(preferred)
                }

                if (awaitingMoreSources) {
                    return {
                        action: "pending",
                        statusMessage: "Checking other providers…",
                    }
                }
            }

            return {
                action: "failed",
                errorMessage: `${message}. Open player settings and pick another source if needed.`,
            }
        },
        [buildFallbackResult, buildPickGate, markCurrentProviderFailed, pickGate?.sourceHealth, providerOrder]
    )

    const attemptRecoveryFromOptions = useCallback(
        (options: PlaybackOption[]): {
            action: "fallback"
            nextSourceId: string
            statusMessage: string
        } | null => {
            if (manualSelectionRef.current) return null

            const currentId = selectedSourceIdRef.current
            const current = options.find((option) => option.id === currentId)

            if (!current?.providerId || !failedProviderIdsRef.current.has(current.providerId)) {
                return null
            }

            const next = findNextAutoFallbackSource(
                options,
                attemptedSourceIdsRef.current,
                currentId,
                true,
                providerOrder,
                pickGate?.sourceHealth
            )

            if (!next) return null

            return buildFallbackResult(next)
        },
        [buildFallbackResult, pickGate?.sourceHealth, providerOrder]
    )

    const attemptRecoveryFallback = useCallback(
        () => attemptRecoveryFromOptions(playbackOptionsRef.current),
        [attemptRecoveryFromOptions]
    )

    const hasStablePlayback = useCallback((meta: PlaybackErrorMeta) => {
        return !canAutoFallbackPlayback(meta)
    }, [])

    const isCurrentProviderFailed = useCallback(() => {
        const current = playbackOptionsRef.current.find(
            (option) => option.id === selectedSourceIdRef.current
        )

        return Boolean(
            current?.providerId && failedProviderIdsRef.current.has(current.providerId)
        )
    }, [])

    const applySourceSelection = useCallback((next: PlaybackOption) => {
        selectedProviderKeyRef.current = next.providerId
        selectedSourceIdRef.current = next.id
        attemptedSourceIdsRef.current.add(next.id)

        return {
            nextSourceId: next.id,
            statusMessage: `Trying ${next.provider}…`,
        }
    }, [])

    const pickSourceAfterRefetch = useCallback(
        (
            options: PlaybackOption[],
            opts?: { preferProviderId?: string; sameProviderOnly?: boolean }
        ) => {
            const preferKey = normalizeProviderName(opts?.preferProviderId ?? "")
            if (preferKey) {
                const sameProvider = options.find(
                    (option) =>
                        normalizeProviderName(option.providerId ?? "") === preferKey
                )
                if (sameProvider) {
                    return applySourceSelection(sameProvider)
                }
                // Manual / same-provider recovery must not hop to VAPlayer.
                if (opts?.sameProviderOnly || manualSelectionRef.current) {
                    return null
                }
            }

            // Never cross-provider hop while the user has an explicit pick.
            if (manualSelectionRef.current) {
                return null
            }

            const preferred = pickPreferredPlaybackSource(
                options,
                failedProviderIdsRef.current,
                providerOrder,
                buildPickGate()
            )
            if (!preferred) return null

            return applySourceSelection(preferred)
        },
        [applySourceSelection, buildPickGate, providerOrder]
    )

    return {
        attemptedSourceIdsRef,
        failedProviderIdsRef,
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
        applySourceSelection,
        pickSourceAfterRefetch,
        hasStablePlayback,
        isCurrentProviderFailed,
    }
}
