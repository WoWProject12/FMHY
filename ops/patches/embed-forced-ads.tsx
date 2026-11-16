"use client"

import { useEffect, useMemo, useRef } from "react"

import { useAuth } from "@/hooks/use-auth"
import { installEmbedPopupDelegate } from "@/lib/embed-ad-delegate"
import {
    injectEmbedAdScripts,
    teardownEmbedAdScripts,
    type EmbedAdScriptBundle,
} from "@/lib/embed-ads-inject"

type ViewerPolicy = {
    adminBypassEnabled: boolean
    adminBypassHosts: string[]
} | null

type EmbedForcedAdsProps = {
    showAds: boolean
    scripts: EmbedAdScriptBundle | null
    embedHost: string | null
    viewerPolicy?: ViewerPolicy
}

function normalizeHost(host: string | null | undefined): string | null {
    if (!host?.trim()) return null
    return host.trim().toLowerCase().replace(/^www\./, "")
}

function resolveClientEmbedHost(serverHost: string | null): string | null {
    if (serverHost) return normalizeHost(serverHost)
    try {
        if (typeof document !== "undefined" && document.referrer) {
            const host = new URL(document.referrer).hostname
            if (host && host !== window.location.hostname) {
                return normalizeHost(host)
            }
        }
    } catch {
        // ignore
    }
    return null
}

function clientBypassesAds(
    role: string | null | undefined,
    embedHost: string | null,
    policy: ViewerPolicy
): boolean {
    if (!policy?.adminBypassEnabled) return false
    const roleNorm = String(role || "").toLowerCase()
    if (roleNorm !== "owner" && roleNorm !== "admin") return false

    const host = normalizeHost(embedHost)
    if (!host || host === "chillflix.pw") return true

    return (policy.adminBypassHosts || []).some(
        (entry) => normalizeHost(entry) === host
    )
}

/** Loads Adcash / Monetag popunder inside the embed player when admin rules allow. */
export function EmbedForcedAds({
    showAds,
    scripts,
    embedHost,
    viewerPolicy = null,
}: EmbedForcedAdsProps) {
    const { user } = useAuth()
    const armedRef = useRef(false)
    const host = useMemo(() => resolveClientEmbedHost(embedHost), [embedHost])
    const bypass = clientBypassesAds(user?.role, host, viewerPolicy)

    useEffect(() => {
        const urlNoAds = (() => {
            try {
                return new URLSearchParams(window.location.search).get("noads") === "1"
            } catch {
                return false
            }
        })()

        // Only arm popup delegation when ads are actually enabled for this viewer.
        // Installing it while showAds=false still opened /embed/ads-park on first click
        // (Adcash never armed → empty "popup" with no creative).
        if (showAds && !(bypass || urlNoAds || window.__cfNoAds)) {
            installEmbedPopupDelegate()
        }

        const onParent = (event: MessageEvent) => {
            try {
                const d = event.data
                if (!d || d.type !== "CHILLFLIX_EMBED_PARENT_COMMAND") return
                if (d.data?.action !== "ads") return
                if (d.data?.on === false) {
                    teardownEmbedAdScripts()
                    armedRef.current = false
                    try {
                        document.getElementById("cf-xlib")?.remove()
                        document.getElementById("cf-xboot")?.remove()
                    } catch {
                        // ignore
                    }
                    window.__cfNoAds = 1
                    try {
                        navigator.serviceWorker?.getRegistrations?.().then((rs) => {
                            rs.forEach((r) => {
                                try {
                                    void r.unregister()
                                } catch {
                                    // ignore
                                }
                            })
                        })
                    } catch {
                        // ignore
                    }
                }
            } catch {
                // ignore
            }
        }
        window.addEventListener("message", onParent)

        if (bypass || urlNoAds || window.__cfNoAds) {
            if (armedRef.current || urlNoAds) {
                teardownEmbedAdScripts()
                armedRef.current = false
            }
            try {
                document.getElementById("cf-xlib")?.remove()
                document.getElementById("cf-xboot")?.remove()
            } catch {
                // ignore
            }
            try {
                navigator.serviceWorker?.getRegistrations?.().then((rs) => {
                    rs.forEach((r) => {
                        try {
                            void r.unregister()
                        } catch {
                            // ignore
                        }
                    })
                })
            } catch {
                // ignore
            }
            return () => window.removeEventListener("message", onParent)
        }

        if (showAds && scripts && !armedRef.current) {
            injectEmbedAdScripts(scripts)
            armedRef.current = true
        }
        return () => window.removeEventListener("message", onParent)
    }, [showAds, scripts, bypass])

    return null
}
