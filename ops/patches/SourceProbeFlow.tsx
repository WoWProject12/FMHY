"use client"

import { Check, ChevronRight, Loader2, Minus, X } from "lucide-react"
import { useMemo } from "react"

import type { ProviderProbeRow } from "@/hooks/useSourceLoadingProgress"
import { useTranslations } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

interface SourceProbeFlowProps {
    rows: ProviderProbeRow[]
    currentTestingProvider?: ProviderProbeRow
    sourcesLoadingMore?: boolean
    className?: string
}

function FailedPill({ name }: { name: string }) {
    return (
        <div
            className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border border-[#e6c98a]/15",
                "bg-[#100c09]/70 px-3 py-1.5 text-[11px] text-[#e6c98a]/45",
                "animate-in fade-in slide-in-from-left-4 duration-500"
            )}
        >
            <X className="size-3 shrink-0" />
            <span className="font-medium">{name}</span>
        </div>
    )
}

function RowStatusIcon({ status }: { status: ProviderProbeRow["status"] }) {
    if (status === "found") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[#e6c98a]/45 bg-[#e6c98a]/15"
                aria-hidden
            >
                <Check className="size-2.5 text-[#e6c98a]" />
            </span>
        )
    }
    if (status === "failed") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.03]"
                aria-hidden
            >
                <X className="size-2.5 text-white/40" />
            </span>
        )
    }
    if (status === "testing") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[#e6c98a]/50 bg-[#e6c98a]/12"
                aria-hidden
            >
                <Loader2 className="size-2.5 animate-spin text-[#e6c98a]" />
            </span>
        )
    }
    return (
        <span
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[#e6c98a]/18"
            aria-hidden
        >
            <Minus className="size-2.5 text-[#e6c98a]/35" />
        </span>
    )
}

export function SourceProbeFlow({
    rows,
    currentTestingProvider,
    sourcesLoadingMore = false,
    className,
}: SourceProbeFlowProps) {
    const { t } = useTranslations()
    const failedRows = useMemo(
        () => rows.filter((row) => row.status === "failed"),
        [rows]
    )
    const foundRows = useMemo(
        () => rows.filter((row) => row.status === "found"),
        [rows]
    )
    const centerTesting =
        currentTestingProvider ?? rows.find((row) => row.status === "testing")

    const nextPending = useMemo(() => {
        if (!centerTesting) {
            return rows.find((row) => row.status === "pending")
        }

        const testingIndex = rows.findIndex((row) => row.id === centerTesting.id)
        return rows.slice(testingIndex + 1).find((row) => row.status === "pending")
    }, [rows, centerTesting])

    return (
        <div className={cn("flex w-full max-w-lg flex-col items-center gap-4", className)}>
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-1 sm:gap-4">
                <div className="flex min-h-[44px] items-center justify-end gap-2 overflow-hidden">
                    {nextPending ? (
                        <div
                            className={cn(
                                "flex items-center gap-1.5 text-xs text-[#e6c98a]/45",
                                "animate-in fade-in slide-in-from-left-6 duration-700"
                            )}
                        >
                            <span className="truncate font-medium">{nextPending.displayName}</span>
                            <ChevronRight className="size-3.5 shrink-0 animate-pulse text-[#e6c98a]/35" />
                        </div>
                    ) : sourcesLoadingMore && !centerTesting ? (
                        <span className="animate-pulse text-xs text-[#e6c98a]/35">
                            {t("player.probe.resolving")}
                        </span>
                    ) : null}
                </div>

                <div className="flex min-h-[52px] shrink-0 items-center justify-center px-1">
                    {centerTesting ? (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-[#e6c98a]/40",
                                "bg-[#e6c98a]/12 px-5 py-2.5 shadow-[0_0_32px_rgba(230,201,138,0.18)]",
                                "animate-in zoom-in-95 fade-in duration-300"
                            )}
                        >
                            <Loader2 className="size-4 shrink-0 animate-spin text-[#e6c98a]" />
                            <span className="text-sm font-semibold tracking-tight text-[#f6f1e8]">
                                {centerTesting.displayName}
                            </span>
                        </div>
                    ) : foundRows.length > 0 ? (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-[#e6c98a]/45",
                                "bg-[#e6c98a]/15 px-5 py-2.5 shadow-[0_0_28px_rgba(230,201,138,0.2)]",
                                "animate-in zoom-in-95 fade-in duration-300"
                            )}
                        >
                            <Check className="size-4 shrink-0 text-[#e6c98a]" />
                            <span className="text-sm font-semibold text-[#f6f1e8]">
                                {foundRows[foundRows.length - 1]?.displayName}
                            </span>
                        </div>
                    ) : (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-[#e6c98a]/25",
                                "bg-[#e6c98a]/08 px-5 py-2.5"
                            )}
                        >
                            <Loader2 className="size-4 shrink-0 animate-spin text-[#e6c98a]/80" />
                            <span className="text-sm font-medium text-[#f6f1e8]/80">
                                {t("player.probe.startingScan")}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex min-h-[44px] items-center justify-start gap-2 overflow-hidden">
                    {failedRows.slice(-2).map((row) => (
                        <FailedPill key={row.id} name={row.displayName} />
                    ))}
                </div>
            </div>

            <div
                className={cn(
                    "w-full max-w-sm space-y-1 rounded-xl border border-[#e6c98a]/18",
                    "bg-gradient-to-b from-[#1a1510]/95 to-[#100c09]/95 p-1.5",
                    "shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
                )}
            >
                {rows.map((row) => {
                    const testing = row.status === "testing"
                    return (
                        <div
                            key={row.id}
                            className={cn(
                                "flex min-h-9 items-center justify-between rounded-lg px-2.5 py-2 transition-colors",
                                testing && "bg-[#e6c98a]/12 text-[#f6f1e8]",
                                row.status === "found" && "text-[#e6c98a]",
                                row.status === "failed" && "text-[#f6f1e8]/35",
                                row.status === "pending" && "text-[#f6f1e8]/55"
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <RowStatusIcon status={row.status} />
                                <span className="truncate text-sm font-medium">
                                    {row.displayName}
                                </span>
                            </span>
                            <span
                                className={cn(
                                    "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px]",
                                    "border-[#e6c98a]/20 text-[#e6c98a]/55",
                                    testing && "border-[#e6c98a]/40 text-[#e6c98a]",
                                    row.status === "found" && "border-[#e6c98a]/35 text-[#e6c98a]",
                                    row.status === "failed" && "border-white/10 text-[#f6f1e8]/35"
                                )}
                            >
                                {testing ? (
                                    <>
                                        <Loader2 className="mr-1 size-3 animate-spin" />
                                        {t("player.testingLabel")}
                                    </>
                                ) : row.status === "found" ? (
                                    <Check className="size-3 text-[#e6c98a]" />
                                ) : row.status === "failed" ? (
                                    "Failed"
                                ) : (
                                    t("player.queued")
                                )}
                            </span>
                        </div>
                    )
                })}
            </div>

            <p className="text-center text-xs text-[#e6c98a]/55">
                {centerTesting
                    ? t("player.probe.checking", { name: centerTesting.displayName })
                    : sourcesLoadingMore
                      ? t("player.loading.findingFastest")
                      : t("player.probe.preparingPlayback")}
            </p>
        </div>
    )
}
