import { NextResponse } from "next/server"

import { getCountryCounts } from "@/lib/iptv/counts"
import {
  fetchFreeTvChannels,
  filterFreeTvChannels,
} from "@/lib/iptv/free-tv"
import { fetchHuhuIptvChannels } from "@/lib/iptv/huhu-iptv-catalog"
import {
  buildMediahubPlayPageUrl,
  fetchMediahubChannels,
} from "@/lib/iptv/mediahub-catalog"
import {
  IPTV_BASE_URL,
  filterIptvChannels,
  loadLocalIptvChannels,
  type IptvChannel,
} from "@/lib/iptv/provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function withPlayPageUrls(channels: IptvChannel[]) {
  return channels.map((channel) => ({
    ...channel,
    playPageUrl:
      channel.playPageUrl || buildMediahubPlayPageUrl(String(channel.id)),
  }))
}

function livePayload(
  channels: IptvChannel[],
  groups: string[],
  args: { search?: string; source: string; totalAll?: number }
) {
  const forCountryCounts = args.search
    ? filterIptvChannels(channels, { search: args.search })
    : channels

  return {
    success: true as const,
    sourceType: "live" as const,
    provider: "Live TV",
    channels,
    countryCounts:
      groups.length > 0
        ? groups.map((countryName) => ({
            country: countryName,
            count: channels.filter((item) => item.country === countryName).length,
          }))
        : getCountryCounts(forCountryCounts),
    total: channels.length,
    totalAll: args.totalAll ?? channels.length,
    source: args.source,
  }
}

async function tryHuhu(args: {
  search?: string
  country?: string
  limit?: number
  offset?: number
  sort?: "trending" | "name"
}) {
  const offset = Math.max(0, args.offset ?? 0)
  const limit = Math.max(1, Math.min(args.limit ?? 300, 1000))
  // Pull just enough upstream pages for this window (300/page) — avoid 10k DOM cold starts.
  const maxPages = Math.max(1, Math.ceil((offset + limit) / 300) + (offset > 0 ? 1 : 0))

  const { channels, groups } = await fetchHuhuIptvChannels({
    search: args.search,
    country: args.country,
    maxPages,
    sort: args.sort,
  })

  if (!channels.length) return null

  const page = channels.slice(offset, offset + limit)
  const totalAll =
    channels.length > offset + page.length
      ? channels.length
      : Math.max(channels.length, offset + page.length + (page.length === limit ? limit : 0))

  return livePayload(page, groups, {
    search: args.search,
    totalAll,
    source: "https://huhu.to/live/catalog/live/channels.json",
  })
}

async function tryMediahub(args: { search?: string; country?: string }) {
  const { channels, groups } = await fetchMediahubChannels({
    search: args.search,
    country: args.country,
    maxPages: args.search || args.country ? 8 : 4,
  })

  if (!channels.length) return null

  return livePayload(channels, groups, {
    search: args.search,
    source: `${IPTV_BASE_URL}/mediahubmx-catalog.json`,
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search") ?? undefined
  const country = searchParams.get("country") ?? undefined
  const source = searchParams.get("source") ?? "live"
  const limit = Number(searchParams.get("limit") || 300)
  const offset = Number(searchParams.get("offset") || 0)
  const sortParam = searchParams.get("sort")
  const sort = sortParam === "name" ? "name" as const : "trending" as const

  try {
    if (source === "free-tv") {
      const channels = await fetchFreeTvChannels()
      const forCountryCounts = filterFreeTvChannels(channels, { search })
      const filtered = filterFreeTvChannels(channels, { search, country })

      return NextResponse.json({
        success: true,
        sourceType: "free-tv",
        provider: "Free-TV",
        channels: filtered,
        countryCounts: getCountryCounts(forCountryCounts),
        total: filtered.length,
        totalAll: channels.length,
        source:
          "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
      })
    }

    // Prefer huhu.to Live TV (mHub v2) — same catalog as https://huhu.to/#/channels
    if (source === "huhu" || source === "live" || source === "all") {
      try {
        const payload = await tryHuhu({ search, country, limit, offset, sort })
        if (payload) return NextResponse.json(payload)
      } catch {
        // Fall through.
      }
    }

    if (source === "kool" || source === "live" || source === "all") {
      try {
        const payload = await tryMediahub({ search, country })
        if (payload) return NextResponse.json(payload)
      } catch {
        // kool.to mediahub is often Cloudflare-blocked from this VPS.
      }
    }

    if (source === "huhu") {
      return NextResponse.json(
        { success: false, error: "Huhu Live TV catalog unavailable." },
        { status: 502 }
      )
    }

    const local = withPlayPageUrls(loadLocalIptvChannels())
    const forCountryCounts = filterIptvChannels(local, { search })
    const filtered = filterIptvChannels(local, { search, country })

    return NextResponse.json({
      success: true,
      sourceType: "live",
      provider: "Live TV",
      channels: filtered,
      countryCounts: getCountryCounts(forCountryCounts),
      total: filtered.length,
      totalAll: local.length,
      source: "local-kool-catalog",
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load IPTV channels"

    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
}
