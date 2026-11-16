"use client"

import { Check, Loader2, Minus, X } from "lucide-react"

import type { ProviderProbeRow } from "@/hooks/useSourceLoadingProgress"
import { useTranslations } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

interface SourceProbeFlowProps {
    rows: ProviderProbeRow[]
    currentTestingProvider?: ProviderProbeRow
    sourcesLoadingMore?: boolean
    className?: string
}

function RowStatusIcon({ status }: { status: ProviderProbeRow["status"] }) {
    if (status === "found") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15"
                aria-hidden
            >
                <Check className="size-2.5 text-emerald-400" />
            </span>
        )
    }
    if (status === "failed") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]"
                aria-hidden
            >
                <X className="size-2.5 text-white/40" />
            </span>
        )
    }
    if (status === "testing") {
        return (
            <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/10"
                aria-hidden
            >
                <Loader2 className="size-2.5 animate-spin text-white" />
            </span>
        )
    }
    return (
        <span
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-white/15"
            aria-hidden
        >
            <Minus className="size-2.5 text-white/30" />
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
    const centerTesting =
        currentTestingProvider ?? rows.find((row) => row.status === "testing")

    return (
        <div className={cn("flex w-full max-w-sm flex-col items-center gap-2", className)}>
            <div className="w-full space-y-1 rounded-lg border border-white/10 bg-black/70 p-1.5 backdrop-blur-md">
                {rows.map((row) => {
                    const testing = row.status === "testing"
                    return (
                        <div
                            key={row.id}
                            className={cn(
                                "flex min-h-9 items-center justify-between rounded-md px-2 py-2 transition-colors",
                                testing && "bg-white/10 text-white",
                                row.status === "found" && "text-emerald-300/90",
                                row.status === "failed" && "text-white/35",
                                row.status === "pending" && "text-white/45"
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
                                    "inline-flex shrink-0 items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45",
                                    testing && "border-white/25 text-white/75",
                                    row.status === "found" &&
                                        "border-emerald-500/30 text-emerald-300/80",
                                    row.status === "failed" && "text-white/30"
                                )}
                            >
                                {testing ? (
                                    <>
                                        <Loader2 className="mr-1 size-3 animate-spin" />
                                        {t("player.testingLabel")}
                                    </>
                                ) : row.status === "found" ? (
                                    <Check className="size-3 text-emerald-400" />
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
