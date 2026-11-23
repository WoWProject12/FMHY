import http from "node:http"

const PORT = Number(process.env.SEVENMOVIES_ASSIST_PORT || 3027)
const BOOT = (process.env.SEVENMOVIES_BOOT_URL || "http://127.0.0.1:3887").replace(/\/$/, "")
const EMBED = "https://embed.vidrift.net"
const ORION = "https://mb.vidrift.net"

function absUrl(url) {
  if (!url) return ""
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith("/api/orion/") || url.startsWith("/api/")) return `${ORION}${url}`
  if (url.startsWith("/")) return `${EMBED}${url}`
  return url
}

function json(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  })
  res.end(raw)
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "*",
    })
    return res.end()
  }
  if (req.method !== "GET") return json(res, 405, { error: "method" })
  let u
  try {
    u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`)
  } catch {
    return json(res, 400, { streams: [], failureReason: "bad url" })
  }
  if (u.pathname === "/health") return json(res, 200, { ok: true })

  const type = u.searchParams.get("type") === "tv" ? "tv" : "movie"
  const tmdbId = String(u.searchParams.get("tmdbId") || "").trim()
  const season = u.searchParams.get("season") || "1"
  const episode = u.searchParams.get("episode") || "1"
  const title = String(u.searchParams.get("title") || "").trim() || `tmdb-${tmdbId}`
  if (!tmdbId) return json(res, 200, { streams: [], failureReason: "Missing tmdbId" })

  try {
    const q = new URLSearchParams({ tmdbId, type, season, episode, title })
    const r = await fetch(`${BOOT}/boot?${q}`, {
      signal: AbortSignal.timeout(55000),
      headers: { Accept: "application/json" },
    })
    const payload = await r.json()
    if (!payload.ok || !payload.boot) {
      return json(res, 200, {
        streams: [],
        failureReason: payload.error || `boot helper HTTP ${r.status}`,
        resolveMode: "vps-boot-helper",
      })
    }
    const meta = payload.boot.meta || {}
    const streams = (meta.orionStreams || [])
      .map((row) => {
        const url = absUrl(String(row.url || ""))
        if (!url) return null
        return {
          url,
          type:
            String(row.type || "").toLowerCase() === "hls" || /\.m3u8/i.test(url)
              ? "hls"
              : "mp4",
          quality: "Auto",
          label: String(row.name || "Orion").trim(),
          rungs: Array.isArray(row.rungs)
            ? row.rungs.map((x) => Number(x?.height) || 0).filter((h) => h > 0)
            : [],
        }
      })
      .filter(Boolean)

    // BigBang / Evion / selfhost play on plain VPS egress (no Chrome JA3). Prefer first.
    if (meta.evionUrl && /^https?:\/\//i.test(meta.evionUrl)) {
      streams.unshift({
        url: absUrl(meta.evionUrl),
        type: "hls",
        quality: "Auto",
        label: "Evion",
        rungs: [],
      })
    }
    if (meta.bigbangUrl && /^https?:\/\//i.test(String(meta.bigbangUrl))) {
      streams.unshift({
        url: String(meta.bigbangUrl),
        type: "hls",
        quality: "Auto",
        // languageName() maps original/english → English for Sources sheet
        label: "Original",
        rungs: [],
      })
    }
    if (meta.selfhostUrl && /^https?:\/\//i.test(String(meta.selfhostUrl))) {
      const kind = String(meta.selfhostKind || "").toLowerCase()
      streams.unshift({
        url: absUrl(String(meta.selfhostUrl)),
        type: kind === "mp4" ? "mp4" : "hls",
        quality: "Auto",
        label: "Direct",
        rungs: [],
      })
    }
    return json(res, 200, {
      streams,
      referer: `${EMBED}/embed2/play`,
      headers: {
        Referer: `${EMBED}/embed2/play`,
        Origin: EMBED,
        Accept: "*/*",
      },
      failureReason: streams.length ? undefined : "No Orion streams",
      resolveMode: `vps-boot-helper:${payload.via || "ok"}`,
    })
  } catch (e) {
    return json(res, 200, {
      streams: [],
      failureReason: e instanceof Error ? e.message : "assist failed",
      resolveMode: "vps-boot-helper",
    })
  }
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sevenmovies-assist] on 127.0.0.1:${PORT}`)
})
