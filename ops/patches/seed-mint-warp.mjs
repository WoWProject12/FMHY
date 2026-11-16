#!/usr/bin/env node
import http from "node:http"
import { request as httpsRequest } from "node:https"
import { URL } from "node:url"
import { SocksProxyAgent } from "socks-proxy-agent"

const PORT = Number(process.env.SEED_MINT_PORT || 3871)
const BIND = process.env.SEED_MINT_BIND || "127.0.0.1"
const UPSTREAM = "https://api.wecollege.net"
const SITE = "https://www.movy.sx"
const WARP_SOCKS = process.env.WARP_SOCKS || "socks5h://127.0.0.1:40000"
const SECRET = process.env.SEED_MINT_SECRET || ""
const agent = new SocksProxyAgent(WARP_SOCKS)

const SEED_GAP_MS = 3_500
const SEED_SOFT_GAP_MS = 8_000
// Short coalesce only — long cache handed burned one-shot seeds to every phone.
const SEED_CACHE_MS = 2_500
const CITY_SOFT_GAP_MS = 8_000
// Waiter timeout — without this a hung WARP/socks mint bricks Videasy forever
// (seedBusy=true, waiters queue never drains; /seed hangs with 0 bytes).
const SEED_SLOT_MAX_WAIT_MS = 8_000
const UPSTREAM_HARD_MS = 14_000

let seedSoftUntil = 0 // no boot soft-gap — 120s blackout made Videasy empty after every restart
let citySoftUntil = 0
let lastSeedAt = 0
let seedBusy = false
let seedBusySince = 0
/** @type {Array<{ resolve: (ok: boolean) => void, timer: NodeJS.Timeout }>} */
const seedWaiters = []
/** @type {Map<string, { body: Buffer, status: number, ctype: string, expiresAt: number }>} */
const seedCache = new Map()

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: SITE,
  Referer: `${SITE}/`,
}

function authorized(req, url) {
  if (!SECRET) return true
  const key = url.searchParams.get("key") || req.headers["x-seed-mint-key"] || ""
  return key === SECRET
}

function upstreamGet(pathWithQuery) {
  const endpoint = new URL(pathWithQuery, `${UPSTREAM}/`)
  const once = new Promise((resolve) => {
    const req = httpsRequest(
      endpoint,
      { method: "GET", agent, headers: DEFAULT_HEADERS, timeout: 12_000 },
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          resolve({
            status: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        })
      }
    )
    req.on("timeout", () => {
      req.destroy()
      resolve({
        status: 504,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "upstream_timeout" })),
      })
    })
    req.on("error", (err) => {
      resolve({
        status: 502,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            error: "upstream_error",
            message: String(err.message || err),
          })
        ),
      })
    })
    req.end()
  })
  // SocksProxyAgent can hang without firing req timeout — hard-cap the await.
  const hard = new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        status: 504,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "upstream_hard_timeout" })),
      })
    }, UPSTREAM_HARD_MS)
  })
  return Promise.race([once, hard])
}

function acquireSeed(maxWaitMs = SEED_SLOT_MAX_WAIT_MS) {
  if (!seedBusy) {
    seedBusy = true
    seedBusySince = Date.now()
    return Promise.resolve(true)
  }
  // Stale holder (socks hang that never released) — force clear.
  if (seedBusySince && Date.now() - seedBusySince > UPSTREAM_HARD_MS + SEED_GAP_MS + 2_000) {
    console.warn(
      "[seed-mint-warp] force-clear stale seedBusy after",
      Date.now() - seedBusySince,
      "ms; waiters=",
      seedWaiters.length
    )
    while (seedWaiters.length) {
      const stale = seedWaiters.shift()
      try {
        clearTimeout(stale.timer)
      } catch {
        /* ignore */
      }
    }
    seedBusy = true
    seedBusySince = Date.now()
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const entry = {
      resolve: (ok) => resolve(ok),
      timer: setTimeout(() => {
        const idx = seedWaiters.indexOf(entry)
        if (idx >= 0) seedWaiters.splice(idx, 1)
        resolve(false)
      }, maxWaitMs),
    }
    seedWaiters.push(entry)
  })
}
function releaseSeed() {
  const next = seedWaiters.shift()
  if (next) {
    try {
      clearTimeout(next.timer)
    } catch {
      /* ignore */
    }
    seedBusySince = Date.now()
    next.resolve(true)
  } else {
    seedBusy = false
    seedBusySince = 0
  }
}

async function handleSeed(url) {
  const mediaId = url.searchParams.get("mediaId") || ""
  const fresh = url.searchParams.get("fresh") === "1"
  const cacheKey = `seed:${mediaId}`
  const now = Date.now()
  if (!fresh) {
    const hit = seedCache.get(cacheKey)
    if (hit && hit.expiresAt > now) {
      // One-shot: do not hand the same seed to the next title/viewer.
      seedCache.delete(cacheKey)
      return { status: hit.status, ctype: hit.ctype, body: hit.body, via: "cache" }
    }
  }
  // Soft-gap: still serve a warm cached seed so phones can start during CF 429.
  if (now < seedSoftUntil) {
    const hit = seedCache.get(cacheKey)
    if (hit) {
      seedCache.delete(cacheKey)
      return { status: hit.status, ctype: hit.ctype, body: hit.body, via: "cache-soft" }
    }
    const retryAfterMs = seedSoftUntil - now
    return {
      status: 503,
      ctype: "application/json",
      body: Buffer.from(JSON.stringify({ error: "mint_soft_gap", retryAfterMs, retry: true })),
      via: "soft",
    }
  }
  const got = await acquireSeed()
  if (!got) {
    return {
      status: 503,
      ctype: "application/json",
      body: Buffer.from(
        JSON.stringify({
          error: "mint_soft_gap",
          retryAfterMs: 2_500,
          retry: true,
          reason: "slot_wait",
        })
      ),
      via: "slot-wait",
    }
  }
  try {
    const gap = SEED_GAP_MS - (Date.now() - lastSeedAt)
    if (gap > 0) await new Promise((r) => setTimeout(r, gap))
    // re-check cache after wait
    if (!fresh) {
      const hit = seedCache.get(cacheKey)
      if (hit && hit.expiresAt > Date.now()) {
        seedCache.delete(cacheKey)
        return { status: hit.status, ctype: hit.ctype, body: hit.body, via: "cache-wait" }
      }
    }
    const path = `/seed?mediaId=${encodeURIComponent(mediaId)}${fresh ? `&fresh=1&_=${Date.now().toString(36)}` : ""}`
    const out = await upstreamGet(path)
    lastSeedAt = Date.now()
    const ctype = out.headers["content-type"] || "application/json"
    const head = out.body.toString("utf8", 0, Math.min(out.body.length, 200))
    const looksHtml = /<!DOCTYPE|<html|Attention Required|Just a moment/i.test(head)
    if (out.status === 429) {
      seedSoftUntil = Date.now() + SEED_SOFT_GAP_MS
      const hit = seedCache.get(cacheKey)
      if (hit) {
        seedCache.delete(cacheKey)
        return { status: hit.status, ctype: hit.ctype, body: hit.body, via: "cache-soft-429" }
      }
      return { status: 429, ctype, body: out.body, via: "upstream-429" }
    }
    if (looksHtml || out.status === 403) {
      // Short cool-off only — long soft-gap kills mobile Starting.
      seedSoftUntil = Date.now() + 4_000
      const hit = seedCache.get(cacheKey)
      if (hit) {
        seedCache.delete(cacheKey)
        return { status: hit.status, ctype: hit.ctype, body: hit.body, via: "cache-soft-cf" }
      }
      return {
        status: 503,
        ctype: "application/json",
        body: Buffer.from(JSON.stringify({ error: "mint_soft_gap", retryAfterMs: 4000, retry: true, reason: "cf" })),
        via: "upstream-cf",
      }
    }
    if (out.status === 200 && /"seed"\s*:/.test(head)) {
      seedCache.set(cacheKey, {
        status: 200,
        ctype,
        body: out.body,
        expiresAt: Date.now() + SEED_CACHE_MS,
      })
      seedSoftUntil = 0
    }
    return { status: out.status, ctype, body: out.body, via: "upstream" }
  } finally {
    releaseSeed()
  }
}

async function handleCity(pathname, search) {
  // Only pause cities on CITY soft-gap. Seed soft-gap used to brick
  // /api/videasy/fetch after a valid cached seed (relay already has the seed;
  // city traffic must still be allowed to try / fall through to yoru).
  if (Date.now() < citySoftUntil) {
    const retryAfterMs = citySoftUntil - Date.now()
    return {
      status: 503,
      ctype: "application/json",
      body: Buffer.from(JSON.stringify({ error: "mint_soft_gap", retryAfterMs, retry: true })),
      via: "soft-city",
    }
  }
  const out = await upstreamGet(`${pathname}${search}`)
  const ctype = out.headers["content-type"] || "application/octet-stream"
  if (out.status === 429) {
    citySoftUntil = Date.now() + CITY_SOFT_GAP_MS
    // Do NOT brick seed mint for 45s on a city 429 — that made second
    // Sources taps fail right after a successful first play.
    seedSoftUntil = Math.max(seedSoftUntil, Date.now() + 2_500)
  }
  return { status: out.status, ctype, body: out.body, via: "upstream" }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${BIND}:${PORT}`)
    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          via: "warp-socks",
          warp: WARP_SOCKS,
          seedSoftMs: Math.max(0, seedSoftUntil - Date.now()),
          citySoftMs: Math.max(0, citySoftUntil - Date.now()),
          seedCacheSize: seedCache.size,
          seedBusy,
          seedWaiters: seedWaiters.length,
          seedBusyMs: seedBusySince ? Math.max(0, Date.now() - seedBusySince) : 0,
        })
      )
      return
    }
    if (!authorized(req, url)) {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "unauthorized" }))
      return
    }
    // strip mint key from upstream query
    url.searchParams.delete("key")
    const search = url.searchParams.toString()
    const q = search ? `?${search}` : ""

    let out
    if (url.pathname === "/seed") out = await handleSeed(url)
    else out = await handleCity(url.pathname, q)

    res.writeHead(out.status, {
      "content-type": out.ctype,
      "x-mint-via": `warp:${out.via}`,
    })
    res.end(out.body)
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "mint_crash", message: String(err && err.message ? err.message : err) }))
  }
})

server.listen(PORT, BIND, () => {
  console.log(`[seed-mint-warp] listening on ${BIND}:${PORT} via ${WARP_SOCKS}`)
})
