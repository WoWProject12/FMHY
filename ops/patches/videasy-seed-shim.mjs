import http from "node:http"

const RELAY = process.env.VIDEASY_SEED_RELAY || "http://127.0.0.1:3847"
const PORT = Number(process.env.PORT || 3872)

/** @type {Map<string, Promise<{status:number,text:string,json:any}>>} */
const inflight = new Map()
/** Shared cool: do not stampede mint while soft-gapped. */
let coolUntil = 0
let coolError = "mint_backpressure"

const COOL_MAX_MS = 4_000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchRelaySeed(qs) {
  const upstream = await fetch(`${RELAY}/seed?${qs.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
  })
  const text = await upstream.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: upstream.status, text, json }
}

function markCool(result) {
  const ms = Math.min(
    COOL_MAX_MS,
    Math.max(400, Number(result?.json?.retryAfterMs) || 1_200)
  )
  coolUntil = Math.max(coolUntil, Date.now() + ms)
  if (result?.json?.error) coolError = String(result.json.error)
  else coolError = "mint_backpressure"
}

function okSeed(result) {
  return result.status === 200 && result.json && typeof result.json.seed === "string"
}

/**
 * One-shot seeds: do NOT keep a multi-second seed cache.
 * A 45s non-consuming cache handed burned seeds → STREAMCRYPTO_SEED_INVALID
 * on every second Sources tap / parallel viewer for the same title.
 * Inflight coalesce alone covers stampede retries of the same request wave.
 */
async function seedOnce(qs) {
  const key = qs.toString()
  const existing = inflight.get(key)
  if (existing) return existing

  const job = (async () => {
    let result = await fetchRelaySeed(qs)
    if (okSeed(result)) {
      coolUntil = 0
      return result
    }

    const now = Date.now()
    if (now < coolUntil) {
      const wait = Math.min(COOL_MAX_MS, coolUntil - now)
      await sleep(wait)
      result = await fetchRelaySeed(qs)
      if (okSeed(result)) {
        coolUntil = 0
        return result
      }
      markCool(result)
      const retryAfterMs = Math.max(0, coolUntil - Date.now())
      return {
        status: 503,
        text: JSON.stringify({
          error: coolError || "mint_backpressure",
          retryAfterMs,
          retry: true,
        }),
        json: {
          error: coolError || "mint_backpressure",
          retryAfterMs,
          retry: true,
        },
      }
    }

    const soft =
      result.status === 503 ||
      result.status === 429 ||
      (result.json &&
        typeof result.json.error === "string" &&
        /soft_gap|cooling|rate|backpressure/i.test(result.json.error))

    if (soft) {
      markCool(result)
      const wait = Math.min(
        COOL_MAX_MS,
        Math.max(400, Number(result.json?.retryAfterMs) || 800)
      )
      await sleep(wait)
      result = await fetchRelaySeed(qs)
      if (okSeed(result)) {
        coolUntil = 0
      } else {
        markCool(result)
      }
    }
    return result
  })()

  inflight.set(key, job)
  try {
    return await job
  } finally {
    inflight.delete(key)
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1")
    if (
      u.pathname !== "/api/videasy/seed" &&
      u.pathname !== "/seed" &&
      u.pathname !== "/"
    ) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "not found" }))
      return
    }
    if (u.pathname === "/" && !u.search) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          shim: "videasy-seed-shim",
          relay: RELAY,
          coolMs: Math.max(0, coolUntil - Date.now()),
          inflight: inflight.size,
          cacheSize: 0,
          oneShot: true,
        })
      )
      return
    }

    const tmdbId =
      u.searchParams.get("tmdbId") ||
      u.searchParams.get("mediaId") ||
      u.searchParams.get("id") ||
      ""
    const type =
      u.searchParams.get("type") || u.searchParams.get("mediaType") || "movie"
    const season = u.searchParams.get("season") || ""
    const episode = u.searchParams.get("episode") || ""
    if (!/^\d+$/.test(tmdbId)) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "Missing or invalid tmdbId." }))
      return
    }

    const qs = new URLSearchParams({
      mediaId: tmdbId,
      mediaType: type === "tv" ? "tv" : "movie",
    })
    if (type === "tv") {
      if (season) qs.set("season", season)
      if (episode) qs.set("episode", episode)
    }
    // Remint after STREAMCRYPTO_SEED_INVALID — client/BFF may pass fresh=1.
    if (
      u.searchParams.get("fresh") === "1" ||
      u.searchParams.get("fresh") === "true"
    ) {
      qs.set("fresh", "1")
    }

    const result = await seedOnce(qs)

    let body = result.text
    try {
      const j = result.json || JSON.parse(result.text)
      if (j && typeof j.seed === "string") {
        body = JSON.stringify({ seed: j.seed, ttlMs: j.ttlMs || 30_000 })
      } else if (j && j.error) {
        body = JSON.stringify({
          error: j.error,
          retryAfterMs: j.retryAfterMs,
          retry: j.retry ?? true,
        })
      }
    } catch {
      /* keep raw */
    }

    res.writeHead(result.status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    })
    res.end(body)
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "seed shim failed",
      })
    )
  }
})

server.listen(PORT, "127.0.0.1", () =>
  console.log(`videasy-seed-shim on 127.0.0.1:${PORT} -> ${RELAY} (one-shot)`)
)
