import { NextResponse } from "next/server"

import { assertSitePlaybackClient } from "@/lib/playback-guard"
import { normalizeImdbId } from "@/lib/videasy-api"
import { fetchVideasyEncryptedBlob, fetchVideasySeed } from "@/lib/videasy-fetch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Miami-only policy — never fan out to boise/other cities. */
const CITY_FALLBACKS: Record<string, string[]> = {}

type BlobHit = { blob: string; seed: string; server: string; expiresAt: number }
const blobCache = new Map<string, BlobHit>()
const BLOB_CACHE_TTL_MS = 180_000
const BLOB_CACHE_MAX = 800

function blobKey(
  mediaType: string,
  tmdbId: string,
  seasonId: string | undefined,
  episodeId: string | undefined
) {
  const s = mediaType === "tv" ? String(seasonId ?? "1") : "0"
  const e = mediaType === "tv" ? String(episodeId ?? "1") : "0"
  return `${mediaType}:${tmdbId}:${s}:${e}`
}

function takeBlob(key: string): BlobHit | null {
  const hit = blobCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now() || !hit.blob || !hit.seed) {
    blobCache.delete(key)
    return null
  }
  return hit
}

function putBlob(key: string, blob: string, seed: string, server: string) {
  if (blobCache.size >= BLOB_CACHE_MAX) {
    const first = blobCache.keys().next().value
    if (first) blobCache.delete(first)
  }
  blobCache.set(key, {
    blob,
    seed,
    server,
    expiresAt: Date.now() + BLOB_CACHE_TTL_MS,
  })
}

export async function POST(request: Request) {
  const denied = assertSitePlaybackClient(request)
  if (denied) return denied

  let body: {
    server?: string
    mediaType?: string
    tmdbId?: string
    title?: string
    year?: string
    imdbId?: string
    seasonId?: string
    episodeId?: string
    seed?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  // Product policy: Videasy is Miami-only on chillflix.
  const server = "miami"
  const tmdbId = String(body.tmdbId ?? "").trim()
  const title = String(body.title ?? "").trim()
  const mediaType = body.mediaType === "tv" ? "tv" : "movie"

  if (!server || !/^\d+$/.test(tmdbId) || !title) {
    return NextResponse.json(
      { error: "Missing server, TMDB id, or title." },
      { status: 400 }
    )
  }

  const cacheKey = blobKey(mediaType, tmdbId, body.seasonId, body.episodeId)
  const cached = takeBlob(cacheKey)
  // Second tap: serve blob+seed without reminting (mint soft-gap / 429).
  if (cached?.blob && cached.seed) {
    return NextResponse.json({
      blob: cached.blob,
      seed: cached.seed,
      server: cached.server,
      cached: true,
    })
  }

  const meta = {
    title,
    year: String(body.year ?? "").trim(),
    imdbId: normalizeImdbId(body.imdbId),
  }
  const media = {
    type: mediaType as "movie" | "tv",
    tmdbId,
    season: body.seasonId,
    episode: body.episodeId,
  }

  async function tryServer(
    city: string,
    seed: string
  ): Promise<{
    blob?: string
    blocked?: boolean
    error?: string
    seedInvalid?: boolean
  }> {
    const result = await fetchVideasyEncryptedBlob(city, meta, media, seed)
    if (result.blob) return result
    const err = result.error ?? ""
    if (/HTTP 401|SEED_INVALID|seed expired/i.test(err)) {
      return { ...result, seedInvalid: true }
    }
    return result
  }

  const seedFromBody = body.seed?.trim()
  let seedResult = seedFromBody
    ? { seed: seedFromBody }
    : await fetchVideasySeed(tmdbId)
  if (!seedResult.seed) {
    return NextResponse.json(
      { error: seedResult.error ?? "Videasy seed fetch failed." },
      { status: 502 }
    )
  }

  const cities = [server, ...(CITY_FALLBACKS[server] || [])]
  let lastError = "Videasy fetch failed."
  let blocked = false

  for (let ci = 0; ci < cities.length; ci++) {
    const city = cities[ci]!
    let seed = seedResult.seed!
    let result = await tryServer(city, seed)

    if (!result.blob && result.seedInvalid) {
      const remint = await fetchVideasySeed(tmdbId, { fresh: true })
      if (remint.seed) {
        seed = remint.seed
        seedResult = remint
        result = await tryServer(city, seed)
      }
    }

    if (result.blob) {
      putBlob(cacheKey, result.blob, seed, city)
      return NextResponse.json({
        blob: result.blob,
        seed,
        server: city,
      })
    }
    if (result.blocked) {
      blocked = true
      lastError = result.error ?? lastError
      continue
    }
    lastError = result.error ?? lastError
    if (/HTTP 500|no streams|empty/i.test(lastError) && ci + 1 < cities.length) {
      if (!seedFromBody) {
        const remint = await fetchVideasySeed(tmdbId, { fresh: true })
        if (remint.seed) seedResult = remint
      }
      continue
    }
  }

  if (blocked) {
    return NextResponse.json(
      { error: lastError || "Videasy blocked this request.", blocked: true },
      { status: 502 }
    )
  }

  return NextResponse.json(
    { error: lastError || "Videasy fetch failed." },
    { status: 502 }
  )
}
