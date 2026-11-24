/**
 * VAPlayer client resolver.
 * Calls the server-side resolve endpoint which has the correct headers.
 *
 * Cold unlock can take 20-60s under load. The API soft-times-out with
 * retryAfterMs so Sources can fall through; we keep polling here until streams
 * appear, unlock finishes hard-fail, the deadline elapses, or signal aborts.
 */
export async function resolveVaplayerClient(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
  /** Max time to wait out unlock-pending (ms). Default 60s; Auto scan may pass ~4s. */
  waitMs?: number
  /** Abort when Auto moves to the next Sources row. */
  signal?: AbortSignal
}): Promise<{ streams: string[]; error?: string; failureReason?: string; fileName?: string }> {
  const { type, tmdbId, season, episode, signal } = params
  if (!tmdbId) return { streams: [], error: "Missing TMDB id" }

  const waitMs = Math.max(2_000, Math.min(90_000, params.waitMs ?? 60_000))
  const url = new URL("/api/playback/vaplayer-resolve", window.location.origin)
  url.searchParams.set("type", type)
  url.searchParams.set("tmdbId", tmdbId)
  // Server soft-timeout follows this so Auto's 4s row is not stuck on 18s unlock.
  url.searchParams.set("budgetMs", String(waitMs))
  if (type === "tv" && season) url.searchParams.set("season", season)
  if (type === "tv" && episode) url.searchParams.set("episode", episode)

  // HTTP 429 from nginx limit_req is soft — unlock may still be running.
  // 403/404/410/422/451 stay hard.
  const hardFailStatus = (status: number) =>
    status === 403 ||
    status === 404 ||
    status === 410 ||
    status === 422 ||
    status === 451

  async function once(): Promise<{
    streams: string[]
    error?: string
    failureReason?: string
    fileName?: string
    retryAfterMs?: number
    hard?: boolean
  }> {
    if (signal?.aborted) {
      return { streams: [], error: "aborted", failureReason: "aborted", hard: true }
    }
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    })
    if (!res.ok) {
      const soft429 = res.status === 429
      return {
        streams: [],
        error: soft429 ? "VAPlayer rate limited — retry" : `HTTP ${res.status}`,
        failureReason: soft429 ? "VAPlayer rate limited — retry" : `HTTP ${res.status}`,
        retryAfterMs: soft429 ? 4_000 : undefined,
        hard: hardFailStatus(res.status),
      }
    }
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
      hard: false,
    }
  }

  try {
    const deadline = Date.now() + waitMs
    let data = await once()
    if (data.hard) {
      return {
        streams: [],
        fileName: data.fileName,
        failureReason: data.failureReason,
        error: data.error,
      }
    }
    while (
      !data.streams.length &&
      data.retryAfterMs &&
      !signal?.aborted &&
      Date.now() + 500 < deadline
    ) {
      const delay = Math.min(
        6_000,
        Math.max(1_500, data.retryAfterMs || 3_000),
        Math.max(500, deadline - Date.now())
      )
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve()
          return
        }
        const timer = setTimeout(resolve, delay)
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        signal?.addEventListener("abort", onAbort, { once: true })
      })
      if (signal?.aborted) break
      data = await once()
      if (data.hard) break
    }
    if (signal?.aborted) {
      return { streams: [], error: "aborted", failureReason: "aborted" }
    }
    return {
      streams: data.streams,
      fileName: data.fileName,
      failureReason: data.failureReason,
      error: data.error,
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { streams: [], error: "aborted", failureReason: "aborted" }
    }
    return { streams: [], error: err instanceof Error ? err.message : "fetch failed" }
  }
}

/**
 * Kick unlock as soon as the player opens (play=true / embed).
 * Short wait: server soft-timeout still keeps unlock running in singleflight.
 */
export function prewarmVaplayerUnlock(params: {
  type: "movie" | "tv"
  tmdbId: string
  season?: string
  episode?: string
}): void {
  if (typeof window === "undefined" || !params.tmdbId) return
  void resolveVaplayerClient({
    ...params,
    waitMs: 2_500,
  }).catch(() => undefined)
}
