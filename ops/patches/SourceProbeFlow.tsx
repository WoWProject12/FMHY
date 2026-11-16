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
                "flex shrink-0 items-center gap-1.5 rounded-full border border-white/8",
                "bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-500",
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
        return <Check className="size-3 shrink-0 text-emerald-400" />
    }
    if (status === "failed") {
        return <X className="size-3 shrink-0 text-white/35" />
    }
    if (status === "testing") {
        return <Loader2 className="size-3 shrink-0 animate-spin text-white" />
    }
    return <Minus className="size-3 shrink-0 text-white/25" />
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
    const centerTesting = currentTestingProvider ?? rows.find((row) => row.status === "testing")

    const nextPending = useMemo(() => {
        if (!centerTesting) {
            return rows.find((row) => row.status === "pending")
        }

        const testingIndex = rows.findIndex((row) => row.id === centerTesting.id)
        return rows.slice(testingIndex + 1).find((row) => row.status === "pending")
    }, [rows, centerTesting])

    return (
        <div className={cn("flex w-full max-w-3xl flex-col items-center gap-5", className)}>
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-2 sm:gap-5">
                {/* Left: next provider sliding toward center */}
                <div className="flex min-h-[44px] items-center justify-end gap-2 overflow-hidden">
                    {nextPending ? (
                        <div
                            className={cn(
                                "flex items-center gap-1.5 text-xs text-white/40",
                                "animate-in fade-in slide-in-from-left-6 duration-700"
                            )}
                        >
                            <span className="truncate font-medium">{nextPending.displayName}</span>
                            <ChevronRight className="size-3.5 shrink-0 animate-pulse text-white/30" />
                        </div>
                    ) : sourcesLoadingMore && !centerTesting ? (
                        <span className="text-xs text-white/30 animate-pulse">{t("player.probe.resolving")}</span>
                    ) : null}
                </div>

                {/* Center: active probe */}
                <div className="flex min-h-[52px] shrink-0 items-center justify-center px-1">
                    {centerTesting ? (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-white/25",
                                "bg-white/[0.08] px-5 py-2.5 shadow-[0_0_32px_rgba(255,255,255,0.08)]",
                                "animate-in zoom-in-95 fade-in duration-300"
                            )}
                        >
                            <Loader2 className="size-4 shrink-0 animate-spin text-white" />
                            <span className="text-sm font-semibold tracking-tight text-white">
                                {centerTesting.displayName}
                            </span>
                        </div>
                    ) : foundRows.length > 0 ? (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-emerald-400/35",
                                "bg-emerald-500/15 px-5 py-2.5 shadow-[0_0_28px_rgba(52,211,153,0.15)]",
                                "animate-in zoom-in-95 fade-in duration-300"
                            )}
                        >
                            <Check className="size-4 shrink-0 text-emerald-400" />
                            <span className="text-sm font-semibold text-emerald-100">
                                {foundRows[foundRows.length - 1]?.displayName}
                            </span>
                        </div>
                    ) : (
                        <div
                            className={cn(
                                "flex items-center gap-2.5 rounded-full border border-white/15",
                                "bg-white/[0.05] px-5 py-2.5"
                            )}
                        >
                            <Loader2 className="size-4 shrink-0 animate-spin text-white/70" />
                            <span className="text-sm font-medium text-white/70">{t("player.probe.startingScan")}</span>
                        </div>
                    )}
                </div>

                {/* Right: failed providers exited from center */}
                <div className="flex min-h-[44px] items-center justify-start gap-2 overflow-x-auto overflow-y-hidden">
                    {failedRows.map((row) => (
                        <FailedPill key={row.id} name={row.displayName} />
                    ))}
                </div>
            </div>

            {/* Real source names while testing */}
            <ul className="w-full max-w-sm space-y-1.5 rounded-lg border border-white/10 bg-black/35 px-3 py-2.5">
                {rows.map((row) => (
                    <li
                        key={row.id}
                        className={cn(
                            "flex items-center gap-2 text-[11px]",
                            row.status === "testing" && "text-white",
                            row.status === "found" && "text-emerald-300",
                            row.status === "failed" && "text-white/40",
                            row.status === "pending" && "text-white/45"
                        )}
                    >
                        <RowStatusIcon status={row.status} />
                        <span className="min-w-0 flex-1 truncate font-medium">{row.displayName}</span>
                        {row.detail ? (
                            <span className="shrink-0 text-[10px] text-white/40">{row.detail}</span>
                        ) : null}
                    </li>
                ))}
            </ul>

            <p className="text-center text-xs text-white/45">
                {centerTesting
                    ? t("player.probe.checking", { name: centerTesting.displayName })
                    : sourcesLoadingMore
                      ? t("player.loading.findingFastest")
                      : t("player.probe.preparingPlayback")}
            </p>
        </div>
    )
}
