import {
  buildVideasyRequestUrl,
  buildVideasySeedUrl,
  VIDEASY_FETCH_HEADERS,
  type VideasyMedia,
  type VideasyTitleMeta,
} from "@/lib/videasy-api"
import { fetchVideasyUpstream } from "@/lib/videasy/upstream-fetch"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function fetchVideasySeed(
  tmdbId: string,
  opts?: { fresh?: boolean }
): Promise<{ seed?: string; ttlMs?: number; error?: string }> {
  const base = buildVideasySeedUrl(tmdbId)
  // fresh=1 only when explicitly requested (401 remint) or on retry attempts.
  const wantFresh = Boolean(opts?.fresh)
  let lastError = "Videasy seed fetch failed."

  // Relay already retries mint 429; this covers BFF↔relay blips and short
  // tunnel flaps without cool-locking the provider for all viewers.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt)

    let response: Response
    try {
      // Retry / explicit remint use fresh=1 so we never re-hand a burned seed.
      const attemptUrl =
        wantFresh || attempt > 0
          ? `${base}${base.includes("?") ? "&" : "?"}fresh=1`
          : base
      response = await fetchVideasyUpstream(attemptUrl, {
        headers: VIDEASY_FETCH_HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      lastError = "Videasy seed fetch failed."
      continue
    }

    if (response.status === 429 || response.status === 502 || response.status === 503) {
      lastError = `Videasy seed returned HTTP ${response.status}.`
      let wait = 500 * (attempt + 1)
      try {
        const j = (await response.clone().json()) as { retryAfterMs?: number }
        if (Number.isFinite(j.retryAfterMs) && (j.retryAfterMs as number) > 0) {
          wait = Math.min(5_000, Math.max(250, Number(j.retryAfterMs) + 100))
        }
      } catch { /* ignore */ }
      await sleep(wait)
      continue
    }

    if (!response.ok) {
      return { error: `Videasy seed returned HTTP ${response.status}.` }
    }

    try {
      const data = (await response.json()) as { seed?: string; ttlMs?: number }
      if (!data.seed?.trim()) {
        lastError = "Videasy seed response was empty."
        continue
      }
      const ttlRaw = Number(data.ttlMs)
      const ttlMs =
        Number.isFinite(ttlRaw) && ttlRaw > 0
          ? Math.min(55_000, Math.max(8_000, ttlRaw))
          : 30_000
      return { seed: data.seed.trim(), ttlMs }
    } catch {
      lastError = "Videasy seed response was invalid JSON."
      continue
    }
  }

  return { error: lastError }
}

export async function fetchVideasyEncryptedBlob(
  server: string,
  meta: VideasyTitleMeta,
  media: VideasyMedia,
  seed: string
): Promise<{ blob?: string; blocked?: boolean; error?: string }> {
  const url = buildVideasyRequestUrl(server, meta, media, seed)

  let response: Response
  try {
    response = await fetchVideasyUpstream(url, {
      headers: VIDEASY_FETCH_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Videasy fetch timed out."
        : "Videasy fetch failed."
    return { error: message }
  }

  if (response.status === 403) {
    return { blocked: true, error: "Videasy blocked this request (HTTP 403)." }
  }

  if (!response.ok) {
    return { error: `Videasy returned HTTP ${response.status}.` }
  }

  const blob = (await response.text()).trim()
  if (!blob || blob.length < 10) {
    return { error: "Videasy returned an empty payload." }
  }

  if (blob.startsWith("<!DOCTYPE") || blob.startsWith("<html")) {
    return { error: "Videasy returned HTML instead of an encrypted payload." }
  }

  return { blob }
}
