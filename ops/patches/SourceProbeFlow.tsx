"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import type { ProviderProbeRow } from "@/hooks/useSourceLoadingProgress"
import { useTranslations } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

interface SourceProbeFlowProps {
    rows: ProviderProbeRow[]
    currentTestingProvider?: ProviderProbeRow
    sourcesLoadingMore?: boolean
    className?: string
}

type VisibleRow = ProviderProbeRow & { exiting?: boolean }

const EXIT_MS = 420

export function SourceProbeFlow({
    rows,
    currentTestingProvider,
    sourcesLoadingMore = false,
    className,
}: SourceProbeFlowProps) {
    const { t } = useTranslations()
    const [exitingIds, setExitingIds] = useState<string[]>([])
    const [goneIds, setGoneIds] = useState<string[]>([])
    const exitingRef = useRef<Set<string>>(new Set())
    const goneRef = useRef<Set<string>>(new Set())

    const failedIds = useMemo(
        () => rows.filter((row) => row.status === "failed").map((row) => row.id),
        [rows]
    )

    // Failed sources: brief explode-out, then gone for good.
    useEffect(() => {
        const freshFails = failedIds.filter(
            (id) => !exitingRef.current.has(id) && !goneRef.current.has(id)
        )
        if (freshFails.length === 0) return

        for (const id of freshFails) exitingRef.current.add(id)
        setExitingIds(Array.from(exitingRef.current))

        const timers = freshFails.map((id) =>
            window.setTimeout(() => {
                exitingRef.current.delete(id)
                goneRef.current.add(id)
                setExitingIds(Array.from(exitingRef.current))
                setGoneIds(Array.from(goneRef.current))
            }, EXIT_MS)
        )
        return () => timers.forEach((timer) => window.clearTimeout(timer))
    }, [failedIds])

    const visibleRows: VisibleRow[] = useMemo(() => {
        return rows
            .filter((row) => !goneIds.includes(row.id))
            .filter((row) => row.status !== "failed" || exitingIds.includes(row.id))
            .map((row) => ({
                ...row,
                exiting: exitingIds.includes(row.id) || row.status === "failed",
            }))
    }, [rows, goneIds, exitingIds])

    const centerTesting =
        currentTestingProvider ??
        visibleRows.find((row) => row.status === "testing" && !row.exiting)

    const tested = rows.filter((row) => row.status !== "pending").length
    const total = Math.max(rows.length, 1)
    const progress = Math.min(1, tested / total)

    return (
        <div className={cn("flex w-full max-w-[15.5rem] flex-col items-center gap-4", className)}>
            <div className="flex w-full flex-col items-center gap-3">
                <p className="text-center text-[13px] font-medium tracking-wide text-[#f6f1e8]/85">
                    {t("player.loading.findingFastest")}
                </p>

                <div
                    className="relative h-[2px] w-full overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    aria-label={t("player.loading.findingFastest")}
                >
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-[#e6c98a]/90 transition-[width] duration-500 ease-out"
                        style={{ width: `${Math.max(8, progress * 100)}%` }}
                    />
                    <div
                        className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                        style={{
                            animation: "cfProbeShimmer 1.35s ease-in-out infinite",
                        }}
                    />
                </div>

                <p className="min-h-[1rem] text-center text-[11px] text-white/45">
                    {centerTesting
                        ? t("player.probe.checking", { name: centerTesting.displayName })
                        : sourcesLoadingMore
                          ? t("player.probe.stillSearching")
                          : t("player.probe.preparingPlayback")}
                </p>
            </div>

            {visibleRows.length > 0 ? (
                <ul className="flex w-full flex-col gap-1.5">
                    {visibleRows.map((row) => {
                        const testing = row.status === "testing" && !row.exiting
                        return (
                            <li
                                key={row.id}
                                className={cn(
                                    "flex items-center justify-between gap-2 px-1 py-1 text-[12px] transition-all duration-[420ms] ease-out",
                                    row.exiting &&
                                        "pointer-events-none scale-125 opacity-0 blur-[3px] saturate-0",
                                    !row.exiting && "opacity-100",
                                    testing && "text-[#f6f1e8]",
                                    row.status === "found" && "text-emerald-300/90",
                                    row.status === "pending" && "text-white/40"
                                )}
                            >
                                <span className="truncate font-medium tracking-wide">
                                    {row.displayName}
                                </span>
                                {testing ? (
                                    <Loader2
                                        className="size-3 shrink-0 animate-spin text-[#e6c98a]/90"
                                        aria-hidden
                                    />
                                ) : row.status === "found" ? (
                                    <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/90" />
                                ) : (
                                    <span className="size-1.5 shrink-0 rounded-full bg-white/20" />
                                )}
                            </li>
                        )
                    })}
                </ul>
            ) : null}

            <style>{`
                @keyframes cfProbeShimmer {
                    0% { transform: translateX(-120%); }
                    100% { transform: translateX(320%); }
                }
            `}</style>
        </div>
    )
}
