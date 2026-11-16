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

function StatusDot({ status }: { status: ProviderProbeRow["status"] }) {
    if (status === "found") {
        return (
            <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40">
                <Check className="size-1.5 text-emerald-300" strokeWidth={3} />
            </span>
        )
    }
    if (status === "failed") {
        return (
            <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/15">
                <X className="size-1.5 text-white/40" strokeWidth={3} />
            </span>
        )
    }
    if (status === "testing") {
        return (
            <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/35">
                <Loader2 className="size-1.5 animate-spin text-white" strokeWidth={3} />
            </span>
        )
    }
    return (
        <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-full ring-1 ring-white/12">
            <Minus className="size-1.5 text-white/25" strokeWidth={3} />
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

    return (
        <div className={cn("w-full max-w-[13.5rem]", className)}>
            <div
                className={cn(
                    "overflow-hidden rounded-xl border border-white/[0.09]",
                    "bg-gradient-to-b from-white/[0.07] to-black/50",
                    "shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
                )}
            >
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                    <Loader2 className="size-3 shrink-0 animate-spin text-white/70" />
                    <p className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight text-white/85">
                        {centerTesting
                            ? centerTesting.displayName
                            : sourcesLoadingMore
                              ? t("player.loading.findingFastest")
                              : t("player.probe.preparingPlayback")}
                    </p>
                    {foundCount > 0 ? (
                        <span className="shrink-0 text-[9px] tabular-nums text-emerald-300/80">
                            {foundCount}
                        </span>
                    ) : null}
                </div>

                <ul className="px-1.5 py-1.5">
                    {rows.map((row) => {
                        const testing = row.status === "testing"
                        return (
                            <li
                                key={row.id}
                                className={cn(
                                    "flex items-center gap-2 rounded-md px-1.5 py-[5px] text-[10px] leading-none",
                                    testing && "bg-white/[0.07] text-white",
                                    row.status === "found" && "text-emerald-300/90",
                                    row.status === "failed" && "text-white/30",
                                    row.status === "pending" && "text-white/38"
                                )}
                            >
                                <StatusDot status={row.status} />
                                <span className="min-w-0 flex-1 truncate tracking-tight">
                                    {row.displayName}
                                </span>
                                {row.detail ? (
                                    <span className="max-w-[40%] shrink-0 truncate text-[9px] text-white/30">
                                        {row.detail}
                                    </span>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
            </div>
        </div>
    )
}
