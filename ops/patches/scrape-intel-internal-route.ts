import { NextRequest, NextResponse } from "next/server"

import {
    addIpToBlocklist,
    refreshIpBlocklistCache,
} from "@/lib/ip-blocklist"
import { getScrapeIntelSummary } from "@/lib/scrape-intel"
import { getSecuritySettings } from "@/lib/security-settings"

export const dynamic = "force-dynamic"

function authorized(request: NextRequest) {
    const secret = process.env.STREAM_SOURCES_SYNC_SECRET?.trim()
    if (!secret) return false
    const header = request.headers.get("x-stream-sources-sync")?.trim()
    return Boolean(header && header === secret)
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    try {
        const hours = Math.min(
            72,
            Math.max(1, Number(request.nextUrl.searchParams.get("hours") ?? 24))
        )
        const [summary, settings] = await Promise.all([
            Promise.resolve(getScrapeIntelSummary(hours)),
            getSecuritySettings(),
        ])

        return NextResponse.json({
            success: true,
            host: "chillflix.pw",
            summary,
            playbackGuardEnabled: settings.playbackGuardEnabled,
            envGuardDisabled: process.env.PLAYBACK_GUARD_DISABLED === "true",
        })
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "scrape-intel-failed",
            },
            { status: 500 }
        )
    }
}

export async function POST(request: NextRequest) {
    if (!authorized(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    try {
        const body = (await request.json().catch(() => ({}))) as {
            action?: string
            ip?: string
            note?: string
            /** Optional parent/scraper host — also force Chillflix advertise gate. */
            host?: string
        }

        if (body.action !== "blockIp") {
            return NextResponse.json({ error: "unknown action" }, { status: 400 })
        }

        const ip = typeof body.ip === "string" ? body.ip.trim() : ""
        if (!ip) {
            return NextResponse.json({ error: "IP is required" }, { status: 400 })
        }

        const note =
            typeof body.note === "string" && body.note.trim()
                ? body.note.trim()
                : "blocked from chillflix.lol stream-theft admin"

        const blocklist = await addIpToBlocklist(ip, note)
        await refreshIpBlocklistCache()

        // Optional: same click can advertise-gate their site (Watch free on Chillflix).
        let gate: { ok?: boolean; host?: string; error?: string } | null = null
        const scrapeHost = typeof body.host === "string" ? body.host.trim().toLowerCase() : ""
        if (scrapeHost) {
            const key = process.env.EMBED_STATS_KEY?.trim()
            if (key) {
                try {
                    const res = await fetch("http://127.0.0.1:3875/blocklist", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Embed-Stats-Key": key,
                        },
                        body: JSON.stringify({
                            action: "block",
                            host: scrapeHost,
                            reason: "stream_theft",
                            by: note.slice(0, 80),
                        }),
                        signal: AbortSignal.timeout(8_000),
                    })
                    const j = (await res.json().catch(() => ({}))) as {
                        ok?: boolean
                        error?: string
                        host?: string
                    }
                    gate = {
                        ok: Boolean(j.ok ?? res.ok),
                        host: scrapeHost,
                        error: j.error,
                    }
                } catch (error) {
                    gate = {
                        ok: false,
                        host: scrapeHost,
                        error: error instanceof Error ? error.message : "gate-failed",
                    }
                }
            } else {
                gate = { ok: false, host: scrapeHost, error: "EMBED_STATS_KEY missing" }
            }
        }

        return NextResponse.json({
            success: true,
            host: "chillflix.pw",
            blocklist,
            gate,
            advertise: gate?.ok
                ? "Forced Chillflix watch/ads gate on host; IP denied for real streams."
                : "IP denied for real streams.",
        })
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "block-failed",
            },
            { status: 500 }
        )
    }
}
