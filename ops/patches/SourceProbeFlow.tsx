"use client"

import { Check, Loader2, Minus, X } from "lucide-react"
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

function RowStatusIcon({ status }: { status: ProviderProbeRow["status"] }) {
    if (status === "found") {
        return (
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-500/10">
                <Check className="size-2 text-emerald-400" strokeWidth={2.5} />
            </span>
        )
    }
    if (status === "failed") {
        return (
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.03]">
                <X className="size-2 text-white/35" strokeWidth={2.5} />
            </span>
        )
    }
    if (status === "testing") {
        return (
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/[0.06]">
                <Loader2 className="size-2 animate-spin text-white" strokeWidth={2.5} />
            </span>
        )
    }
    return (
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-white/10">
            <Minus className="size-2 text-white/25" strokeWidth={2.5} />
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
    const foundCount = useMemo(
        () => rows.filter((row) => row.status === "found").length,
        [rows]
    )
    const failedCount = useMemo(
        () => rows.filter((row) => row.status === "failed").length,
        [rows]
    )

    return (
        <div
            className={cn(
                "flex w-full max-w-[15.5rem] flex-col items-stretch gap-2.5",
                className
            )}
        >
            <div className="flex items-center justify-between gap-2 px-0.5">
                <p className="truncate text-[11px] font-medium tracking-wide text-white/70">
                    {centerTesting
                        ? t("player.probe.checking", { name: centerTesting.displayName })
                        : sourcesLoadingMore
                          ? t("player.loading.findingFastest")
                          : t("player.probe.preparingPlayback")}
                </p>
                {(foundCount > 0 || failedCount > 0) && (
                    <p className="shrink-0 text-[10px] tabular-nums text-white/35">
                        {foundCount > 0 ? `${foundCount} ready` : null}
                        {foundCount > 0 && failedCount > 0 ? " · " : null}
                        {failedCount > 0 ? `${failedCount} miss` : null}
                    </p>
                )}
            </div>

            <ul
                className={cn(
                    "max-h-[11.5rem] space-y-0.5 overflow-y-auto overscroll-contain",
                    "rounded-md border border-white/[0.08] bg-black/40 px-1.5 py-1.5",
                    "shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-sm"
                )}
            >
                {rows.map((row) => {
                    const testing = row.status === "testing"
                    return (
                        <li
                            key={row.id}
                            className={cn(
                                "flex items-center gap-2 rounded px-1.5 py-1 text-[11px] transition-colors duration-200",
                                testing && "bg-white/[0.06] text-white",
                                row.status === "found" && "text-emerald-300/90",
                                row.status === "failed" && "text-white/35",
                                row.status === "pending" && "text-white/40"
                            )}
                        >
                            <RowStatusIcon status={row.status} />
                            <span
                                className={cn(
                                    "min-w-0 flex-1 truncate tracking-tight",
                                    testing ? "font-medium" : "font-normal"
                                )}
                            >
                                {row.displayName}
                            </span>
                            {row.detail ? (
                                <span className="max-w-[42%] shrink-0 truncate text-[9px] text-white/35">
                                    {row.detail}
                                </span>
                            ) : testing ? (
                                <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-white/40">
                                    {t("player.testingLabel")}
                                </span>
                            ) : null}
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}
