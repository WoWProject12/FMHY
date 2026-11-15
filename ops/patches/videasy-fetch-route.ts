import { NextResponse } from "next/server"

import { assertSitePlaybackClient } from "@/lib/playback-guard"
import { normalizeImdbId } from "@/lib/videasy-api"
import { fetchVideasyEncryptedBlob, fetchVideasySeed } from "@/lib/videasy-fetch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CITY_FALLBACKS: Record<string, string[]> = {
  miami: ["boise"],
  boise: ["miami"],
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

  const server = String(body.server ?? "").trim().toLowerCase()
  const tmdbId = String(body.tmdbId ?? "").trim()
  const title = String(body.title ?? "").trim()
  const mediaType = body.mediaType === "tv" ? "tv" : "movie"

  if (!server || !/^\d+$/.test(tmdbId) || !title) {
    return NextResponse.json(
      { error: "Missing server, TMDB id, or title." },
      { status: 400 }
    )
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
  ): Promise<{ blob?: string; blocked?: boolean; error?: string; seedInvalid?: boolean }> {
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

    // One-shot seed burned / invalid → remint once for this city.
    if (!result.blob && result.seedInvalid) {
      const remint = await fetchVideasySeed(tmdbId, { fresh: true })
      if (remint.seed) {
        seed = remint.seed
        seedResult = remint
        result = await tryServer(city, seed)
      }
    }

    if (result.blob) {
      return NextResponse.json({ blob: result.blob, server: city })
    }
    if (result.blocked) {
      blocked = true
      lastError = result.error ?? lastError
      continue
    }
    lastError = result.error ?? lastError
    // Upstream "no streams" — try next city before giving up.
    if (/HTTP 500|no streams|empty/i.test(lastError) && ci + 1 < cities.length) {
      // Fresh seed for the next city (previous seed may still be valid but
      // cities are one-shot; remint to be safe).
      const remint = await fetchVideasySeed(tmdbId, { fresh: true })
      if (remint.seed) seedResult = remint
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
