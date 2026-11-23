/**
 * Disk-backed VAPlayer unlock queue.
 * Resolve enqueues cold/busy titles; vaplayer-unlock-rotator drains them so
 * titles are not abandoned when the in-process slot wait times out.
 */
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const QUEUE_DIR =
  process.env.VAPLAYER_UNLOCK_QUEUE_DIR ||
  path.join(process.cwd(), "data", "vaplayer-unlock-queue")

function jobKey(job) {
  const type = job.type === "tv" ? "tv" : "movie"
  const tmdb = String(job.tmdbId || "").trim()
  if (type === "tv") {
    return `tv:${tmdb}:${Number(job.season) || 1}:${Number(job.episode) || 1}`
  }
  return `movie:${tmdb}`
}

function jobId(job) {
  return crypto.createHash("sha1").update(jobKey(job)).digest("hex")
}

function ensureQueueDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true })
}

/**
 * @param {{ type: string, tmdbId: string, season?: number, episode?: number, force?: boolean, reason?: string }} job
 */
function enqueueUnlockJob(job) {
  const tmdbId = String(job?.tmdbId || "").trim()
  if (!/^\d+$/.test(tmdbId)) return null
  const type = job.type === "tv" ? "tv" : "movie"
  const payload = {
    type,
    tmdbId,
    season: type === "tv" ? Math.max(1, Number(job.season) || 1) : undefined,
    episode: type === "tv" ? Math.max(1, Number(job.episode) || 1) : undefined,
    force: Boolean(job.force),
    reason: String(job.reason || "resolve").slice(0, 80),
    enqueuedAt: Date.now(),
  }
  ensureQueueDir()
  const id = jobId(payload)
  const file = path.join(QUEUE_DIR, `${id}.json`)
  // Do NOT rewrite an existing job — that bumps mtime and sends viewer demand
  // to the back of the FIFO while expiry refreshes keep cutting the line.
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, "utf8"))
      // Promote to force if a later caller needs remint.
      if (payload.force && !existing.force) {
        existing.force = true
        existing.reason = payload.reason || existing.reason
        fs.writeFileSync(file, JSON.stringify(existing), "utf8")
        // Preserve original mtime for FIFO order.
        const st = fs.statSync(file)
        fs.utimesSync(file, st.atime, st.mtime)
      }
    } catch {
      /* keep existing file */
    }
    return id
  }
  fs.writeFileSync(file, JSON.stringify(payload), "utf8")
  return id
}

function listUnlockJobs(limit = 50) {
  ensureQueueDir()
  const files = fs
    .readdirSync(QUEUE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const full = path.join(QUEUE_DIR, name)
      try {
        const st = fs.statSync(full)
        return { full, name, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime)
  const out = []
  for (const entry of files.slice(0, Math.max(1, limit))) {
    try {
      const job = JSON.parse(fs.readFileSync(entry.full, "utf8"))
      out.push({ ...job, _file: entry.full, _id: entry.name.replace(/\.json$/, "") })
    } catch {
      try {
        fs.unlinkSync(entry.full)
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

function completeUnlockJob(fileOrId) {
  if (!fileOrId) return
  const file =
    String(fileOrId).includes("/") || String(fileOrId).endsWith(".json")
      ? String(fileOrId)
      : path.join(QUEUE_DIR, `${fileOrId}.json`)
  try {
    fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
}

module.exports = {
  QUEUE_DIR,
  enqueueUnlockJob,
  listUnlockJobs,
  completeUnlockJob,
  jobKey,
  jobId,
}
