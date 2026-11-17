/**
 * VAPlayer client resolver.
 * Calls the server-side resolve endpoint which has the correct headers.
 *
 * Cold unlock can take 20-60s under load. The API soft-times-out (~18s) with
 * retryAfterMs so Sources can fall through; we keep polling here until streams
 * appear, unlock finishes hard-fail, or the deadline elapses -- so every title
 * behaves the same without per-title cache warming.
 */
export async function resolveVaplayerClient(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
  /** Max time to wait out unlock-pending (ms). Default 60s; Auto scan may pass ~4s. */
  waitMs?: number
}): Promise<{ streams: string[]; error?: string; failureReason?: string; fileName?: string }> {
  const { type, tmdbId, season, episode } = params
  if (!tmdbId) return { streams: [], error: "Missing TMDB id" }

  // Floor 3s so Auto's ~4s row budget can actually win the race; manual taps
  // still default to a long unlock poll.
  const waitMs = Math.max(3_000, Math.min(90_000, params.waitMs ?? 60_000))
  const url = new URL("/api/playback/vaplayer-resolve", window.location.origin)
  url.searchParams.set("type", type)
  url.searchParams.set("tmdbId", tmdbId)
  if (type === "tv" && season) url.searchParams.set("season", season)
  if (type === "tv" && episode) url.searchParams.set("episode", episode)

  async function once(): Promise<{
    streams: string[]
    error?: string
    failureReason?: string
    fileName?: string
    retryAfterMs?: number
  }> {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) return { streams: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const streams = Array.isArray(data?.streams)
      ? data.streams.filter((s: unknown) => typeof s === "string" && s.startsWith("http"))
      : []
    return {
      streams,
      fileName: typeof data?.fileName === "string" ? data.fileName : undefined,
      failureReason: streams.length
        ? undefined
        : typeof data?.error === "string"
          ? data.error
          : undefined,
      retryAfterMs:
        typeof data?.retryAfterMs === "number" ? data.retryAfterMs : undefined,
      error: typeof data?.error === "string" ? data.error : undefined,
    }
  }

  try {
    const deadline = Date.now() + waitMs
    let data = await once()
    while (
      !data.streams.length &&
      data.retryAfterMs &&
      Date.now() + 500 < deadline
    ) {
      const delay = Math.min(
        6_000,
        Math.max(1_500, data.retryAfterMs || 3_000),
        Math.max(500, deadline - Date.now())
      )
      await new Promise((r) => setTimeout(r, delay))
      data = await once()
    }
    return {
      streams: data.streams,
      fileName: data.fileName,
      failureReason: data.failureReason,
      error: data.error,
    }
  } catch (err) {
    return { streams: [], error: err instanceof Error ? err.message : "fetch failed" }
  }
}
