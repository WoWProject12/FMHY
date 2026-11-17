#!/usr/bin/env node
/**
 * VAPlayer unlock rotator.
 * 1) Drain disk queue (cold titles that hit unlock-busy).
 * 2) Remint cache entries whose CDN JWT expires within REFRESH_WITHIN_SEC.
 *
 * One unlock at a time — captcha flock is global. Keeps the site following
 * token rotation so resolves keep returning streams.
 */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.VAPLAYER_ROOT || path.resolve(__dirname, "..")
const UNLOCK_PY =
  process.env.VAPLAYER_UNLOCK_PY || path.join(ROOT, "scripts", "vaplayer-unlock.py")
const CACHE_DIR =
  process.env.VAPLAYER_UNLOCK_CACHE ||
  path.join(ROOT, "data", "vaplayer-unlock-cache")
const QUEUE_MODULE =
  process.env.VAPLAYER_UNLOCK_QUEUE_MODULE ||
  path.join(ROOT, "scripts", "vaplayer-unlock-queue.cjs")

const {
  enqueueUnlockJob,
  listUnlockJobs,
  completeUnlockJob,
} = require(QUEUE_MODULE)

const REFRESH_WITHIN_SEC = Math.max(
  300,
  Number(process.env.VAPLAYER_ROTATE_WITHIN_SEC || 25 * 60)
)
const SCAN_EVERY_MS = Math.max(
  30_000,
  Number(process.env.VAPLAYER_ROTATE_SCAN_MS || 120_000)
)
const IDLE_SLEEP_MS = Math.max(
  1_000,
  Number(process.env.VAPLAYER_ROTATE_IDLE_MS || 4_000)
)
const UNLOCK_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.VAPLAYER_ROTATE_UNLOCK_MS || 120_000)
)
const MAX_REFRESH_PER_SCAN = Math.max(
  1,
  Number(process.env.VAPLAYER_ROTATE_MAX_REFRESH || 40)
)

function log(...args) {
  console.log(new Date().toISOString(), "[va-rotator]", ...args)
}

function tokenExpLeft(streams) {
  const now = Date.now() / 1000
  let best = null
  for (const u of streams || []) {
    const m = String(u || "").match(/[?&]token=([^&]+)/)
    if (!m) continue
    try {
      const tok = decodeURIComponent(m[1])
      const parts = tok.split(".")
      if (parts.length < 2) continue
      const pad = "=".repeat((4 - (parts[1].length % 4)) % 4)
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString(
          "utf8"
        )
      )
      const exp = Number(payload.exp || 0)
      if (!exp) continue
      const left = exp - now
      if (best == null || left < best) best = left
    } catch {
      /* ignore */
    }
  }
  return best
}

function mediaFromCache(data) {
  const tmdbId = String(data?.tmdbId || "").trim()
  const mediaType = String(data?.mediaType || "").toLowerCase()
  if (/^\d+$/.test(tmdbId) && (mediaType === "movie" || mediaType === "tv")) {
    return {
      type: mediaType,
      tmdbId,
      season: mediaType === "tv" ? Math.max(1, Number(data.season) || 1) : undefined,
      episode: mediaType === "tv" ? Math.max(1, Number(data.episode) || 1) : undefined,
    }
  }
  const m = String(data?.matchedAs || "").match(/^tmdb:(movie|tv):(\d+)/i)
  if (!m) return null
  // Legacy cache rows: movies only (TV needs season/episode).
  if (m[1].toLowerCase() === "tv") return null
  return { type: "movie", tmdbId: m[2] }
}

function scanCacheForRefresh() {
  let files
  try {
    files = fs.readdirSync(CACHE_DIR).filter((n) => n.endsWith(".json"))
  } catch {
    return []
  }
  const due = []
  for (const name of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), "utf8"))
      if (!data?.ok || !Array.isArray(data.streams) || !data.streams.length) continue
      const left = tokenExpLeft(data.streams)
      if (left == null) continue
      if (left > REFRESH_WITHIN_SEC) continue
      const meta = mediaFromCache(data)
      if (!meta) continue
      due.push({
        ...meta,
        force: true,
        reason: `expire-in-${Math.floor(left)}s`,
        left,
      })
    } catch {
      /* ignore */
    }
  }
  due.sort((a, b) => a.left - b.left)
  return due.slice(0, MAX_REFRESH_PER_SCAN)
}

function runUnlock(job) {
  return new Promise((resolve) => {
    const args = [UNLOCK_PY, "--type", job.type, "--tmdb", String(job.tmdbId)]
    if (job.type === "tv") {
      args.push("--season", String(job.season || 1), "--episode", String(job.episode || 1))
    }
    if (job.force) args.push("--force")
    const child = spawn("python3", args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), UNLOCK_TIMEOUT_MS)
    child.stdout.on("data", (c) => {
      stdout += String(c)
      if (stdout.length > 4 * 1024 * 1024) child.kill("SIGKILL")
    })
    child.stderr.on("data", (c) => {
      stderr += String(c)
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message })
    })
    child.on("close", () => {
      clearTimeout(timer)
      const raw = stdout.trim()
      if (!raw) {
        resolve({ ok: false, error: (stderr || "no output").slice(0, 200) })
        return
      }
      const line = raw.split("\n").filter(Boolean).at(-1) || raw
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: `bad json: ${line.slice(0, 120)}` })
      }
    })
  })
}

let lastScanAt = 0

function demandScore(job) {
  const reason = String(job.reason || "")
  // Viewer-facing demand first; expiry rotation last.
  if (/soft-timeout|unlock-busy|empty-result|resolve/i.test(reason)) return 0
  if (/retry-busy/i.test(reason)) return 1
  if (/expire-in/i.test(reason)) return 5
  return 3
}

async function tick() {
  // Prefer viewer-demand queue jobs over proactive expiry refresh.
  const jobs = listUnlockJobs(80).sort((a, b) => {
    const ds = demandScore(a) - demandScore(b)
    if (ds !== 0) return ds
    return Number(a.enqueuedAt || 0) - Number(b.enqueuedAt || 0)
  })
  if (jobs.length) {
    const job = jobs[0]
    log(
      "drain",
      job.type,
      job.tmdbId,
      job.reason || "",
      "force=",
      Boolean(job.force),
      "q=",
      jobs.length
    )
    const result = await runUnlock(job)
    const streams = Array.isArray(result?.streams) ? result.streams.length : 0
    log(
      "drain-result",
      job.tmdbId,
      "ok=",
      Boolean(result?.ok),
      "streams=",
      streams,
      result?.error || result?.via || ""
    )
    const err = String(result?.error || "")
    if (result?.ok && streams > 0) {
      completeUnlockJob(job._file)
    } else if (/busy|lock timeout|slot wait/i.test(err)) {
      // Keep original file (FIFO); do not rewrite.
      log("drain-busy-keep", job.tmdbId)
    } else {
      completeUnlockJob(job._file)
    }
    return
  }

  const now = Date.now()
  if (now - lastScanAt >= SCAN_EVERY_MS) {
    lastScanAt = now
    // Only schedule expiry remints when the demand queue is idle.
    const due = scanCacheForRefresh()
    if (due.length) {
      log("refresh-enqueue", due.length, "within", REFRESH_WITHIN_SEC, "s")
      for (const job of due) enqueueUnlockJob(job)
      return
    }
  }

  await new Promise((r) => setTimeout(r, IDLE_SLEEP_MS))
}

async function main() {
  log("start", { ROOT, UNLOCK_PY, CACHE_DIR, REFRESH_WITHIN_SEC })
  for (;;) {
    try {
      await tick()
    } catch (err) {
      log("tick-error", err instanceof Error ? err.message : err)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

main()
