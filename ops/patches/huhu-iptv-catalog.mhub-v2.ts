import "server-only"

import fs from "fs"
import path from "path"

import { IPTV_HEADERS, type IptvChannel } from "@/lib/iptv/provider"

const HUHU_ORIGIN = "https://huhu.to"
/** mHub Addon Protocol v2 — Live TV addon (replaces legacy mediaurl-catalog.json). */
const HUHU_LIVE_CATALOG_URL = `${HUHU_ORIGIN}/live/catalog/live/channels.json`
const CATALOG_PAGE_SIZE = 300
const DEFAULT_MAX_PAGES = 40
const CACHE_TTL_MS = 10 * 60 * 1000
const VUFLIX_CACHE_CANDIDATES = [
  "/var/www/chillflix-newsite/storage/cache/huhu-live-tv.json",
  path.join(process.cwd(), "../chillflix-newsite/storage/cache/huhu-live-tv.json"),
]

type HuhuCatalogItem = {
  id?: string | number
  type?: string
  ids?: { id?: string | number; tvg?: string }
  url?: string
  name?: string
  group?: string
  tags?: string[]
  logo?: string
  images?: { poster?: string; landscape?: string }
}

type HuhuFilterValue = string | { id?: string; name?: string }

type HuhuCatalogResponse = {
  items?: HuhuCatalogItem[]
  nextCursor?: string | number | null
  features?: {
    filter?: Array<{ id?: string; values?: HuhuFilterValue[] }>
  }
  error?: string
}

let catalogCache: {
  expiresAt: number
  channels: IptvChannel[]
  groups: string[]
} | null = null

function huhuHeaders() {
  return {
    ...IPTV_HEADERS,
    Accept: "application/json",
    Referer: `${HUHU_ORIGIN}/`,
    Origin: HUHU_ORIGIN,
  }
}

function filterValueId(value: HuhuFilterValue): string {
  if (typeof value === "string") return value
  return String(value?.id || value?.name || "").trim()
}

function loadVuflixHuhuCache(): { channels: IptvChannel[]; groups: string[] } | null {
  for (const filePath of VUFLIX_CACHE_CANDIDATES) {
    try {
      if (!fs.existsSync(filePath)) continue
      const ageMs = Date.now() - fs.statSync(filePath).mtimeMs
      if (ageMs > 60 * 60 * 1000) continue

      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        channels?: Array<{
          id?: string
          name?: string
          group?: string
          logo?: string
          playPage?: string
        }>
        categories?: Array<{ name?: string }>
      }

      const channels = (raw.channels ?? [])
        .map((channel) => {
          const id = channel.id ? String(channel.id) : ""
          if (!id) return null
          return {
            id,
            name: channel.name || id,
            country: channel.group || "Unknown",
            p: 0,
            playPageUrl:
              channel.playPage || buildHuhuIptvPlayPageUrl(id),
            logo: channel.logo || undefined,
          } satisfies IptvChannel
        })
        .filter(Boolean) as IptvChannel[]

      if (!channels.length) continue

      const groups =
        raw.categories?.map((category) => String(category.name || "")).filter(Boolean) ??
        [...new Set(channels.map((channel) => channel.country))].sort()

      return { channels, groups }
    } catch {
      continue
    }
  }

  return null
}

async function getHuhuCatalog(args: {
  search?: string
  country?: string
  cursor?: string | number | null
  sort?: "trending" | "name"
}) {
  const params = new URLSearchParams()
  params.set("sort", args.sort ?? "trending")
  if (args.search?.trim()) params.set("search", args.search.trim())
  if (args.country?.trim()) params.set("filter[group]", args.country.trim())
  if (args.cursor != null && args.cursor !== "") {
    params.set("cursor", String(args.cursor))
  }

  const response = await fetch(`${HUHU_LIVE_CATALOG_URL}?${params.toString()}`, {
    method: "GET",
    headers: huhuHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })

  const text = await response.text()
  if (!response.ok || text.trimStart().startsWith("<")) {
    throw new Error(`Huhu catalog failed: HTTP ${response.status}`)
  }

  let payload: HuhuCatalogResponse
  try {
    payload = JSON.parse(text) as HuhuCatalogResponse
  } catch {
    throw new Error("Huhu catalog returned invalid JSON")
  }

  if (payload?.error) {
    throw new Error(payload.error)
  }

  return payload
}

function mapCatalogItem(item: HuhuCatalogItem): IptvChannel | null {
  const id =
    item.id != null
      ? String(item.id)
      : item.ids?.id != null
        ? String(item.ids.id)
        : null
  if (!id) return null

  const country =
    (Array.isArray(item.tags) && item.tags[0]) ||
    item.group ||
    "Unknown"

  const logoRaw =
    item.images?.logo ||
    item.images?.poster ||
    item.images?.landscape ||
    item.logo ||
    undefined
  const logo = logoRaw
    ? logoRaw.startsWith("http")
      ? logoRaw
      : `${HUHU_ORIGIN}${logoRaw.startsWith("/") ? "" : "/"}${logoRaw}`
    : undefined

  const epg = (item.epg ?? [])
    .map((entry) => {
      const title = String(entry.title || "").trim()
      const start = String(entry.start || "").trim()
      const end = String(entry.end || "").trim()
      if (!title || !start || !end) return null
      return { title, start, end }
    })
    .filter(Boolean) as Array<{ title: string; start: string; end: string }>

  const tvgId = item.ids?.tvg ? String(item.ids.tvg).trim() : ""

  return {
    id,
    name: item.name || id,
    country,
    p: 0,
    playPageUrl: item.url || buildHuhuIptvPlayPageUrl(id),
    logo,
    tvgId: tvgId || undefined,
    epg: epg.length ? epg : undefined,
  }
}

export function buildHuhuIptvPlayPageUrl(channelId: string | number) {
  return `${HUHU_ORIGIN}/live/play/${encodeURIComponent(String(channelId))}`
}

function filterCachedChannels(
  channels: IptvChannel[],
  args: { search?: string; country?: string }
) {
  let filtered = channels
  if (args.country) {
    filtered = filtered.filter((channel) => channel.country === args.country)
  }
  if (args.search) {
    const needle = args.search.toLowerCase()
    filtered = filtered.filter(
      (channel) =>
        channel.name.toLowerCase().includes(needle) ||
        channel.country.toLowerCase().includes(needle)
    )
  }
  return filtered
}

export async function fetchHuhuIptvChannels(args: {
  search?: string
  country?: string
  maxPages?: number
  sort?: "trending" | "name"
}) {
  const search = args.search?.trim() ?? ""
  const country = args.country?.trim() ?? ""
  const maxPages = args.maxPages ?? DEFAULT_MAX_PAGES
  const sort = args.sort === "name" ? "name" : "trending"

  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return {
      channels: filterCachedChannels(catalogCache.channels, { search, country }),
      groups: catalogCache.groups,
    }
  }

  const warmed = loadVuflixHuhuCache()
  if (warmed?.channels.length) {
    catalogCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      channels: warmed.channels,
      groups: warmed.groups,
    }
    return {
      channels: filterCachedChannels(warmed.channels, { search, country }),
      groups: warmed.groups,
    }
  }

  const seen = new Set<string>()
  const channels: IptvChannel[] = []
  let groups: string[] = []
  let cursor: string | number | null = null
  let complete = false

  // When searching/filtering, query upstream directly (paginated).
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await getHuhuCatalog({
      search: search || undefined,
      country: country || undefined,
      cursor,
      sort,
    })

    if (!groups.length) {
      const rawValues =
        payload.features?.filter?.find((entry) => entry.id === "group")?.values ?? []
      groups = rawValues.map(filterValueId).filter(Boolean)
    }

    const items = payload.items ?? []
    for (const item of items) {
      const channel = mapCatalogItem(item)
      if (!channel) continue
      const key = String(channel.id)
      if (seen.has(key)) continue
      seen.add(key)
      channels.push(channel)
    }

    if (payload.nextCursor == null || items.length < CATALOG_PAGE_SIZE) {
      complete = true
      break
    }

    cursor = payload.nextCursor
  }

  if (!channels.length) {
    throw new Error("Huhu IPTV catalog empty")
  }

  if (!groups.length) {
    groups = [...new Set(channels.map((channel) => channel.country))].sort()
  }

  // Only cache complete unfiltered pulls.
  if (!search && !country && complete) {
    catalogCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      channels,
      groups,
    }
  }

  return { channels, groups }
}

/** Map legacy numeric kool scrape IDs → huhu live play ids when possible. */
export async function resolveHuhuPlayIdFromLegacyId(channelId: string) {
  const { channels } = await fetchHuhuIptvChannels({ maxPages: DEFAULT_MAX_PAGES })
  const exact = channels.find((channel) => String(channel.id) === channelId)
  if (exact) return String(exact.id)

  const prefixHit = channels.find((channel) =>
    String(channel.id).startsWith(channelId)
  )
  return prefixHit ? String(prefixHit.id) : null
}
