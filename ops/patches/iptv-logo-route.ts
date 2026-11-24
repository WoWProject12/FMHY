import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_DIR = "/var/www/chillflix/data/iptv-logo-cache"
const ALLOW_HOST = /(imgur\.com|wikimedia\.org|wikipedia\.org|icon\.horse|google\.com|gstatic\.com|duckduckgo\.com|tmsimg\.com|wp\.com|yandex\.net|nocookie\.net|github\.io|githubusercontent\.com|bein\.com|cloudfront\.net|akamaized\.net)$/i

function safeHost(u: URL) {
  const host = u.hostname.toLowerCase()
  if (ALLOW_HOST.test(host)) return true
  // allow subdomain match
  return ALLOW_HOST.test(host.split(".").slice(-2).join(".")) || ALLOW_HOST.test(host.split(".").slice(-3).join("."))
}

export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get("src") || ""
  if (!/^https?:\/\//i.test(src)) {
    return new NextResponse("bad src", { status: 400 })
  }
  let remote: URL
  try {
    remote = new URL(src)
  } catch {
    return new NextResponse("bad url", { status: 400 })
  }
  if (!safeHost(remote)) {
    return new NextResponse("host not allowed", { status: 400 })
  }

  try {
    mkdirSync(CACHE_DIR, { recursive: true })
  } catch {}

  const key = createHash("sha1").update(src).digest("hex")
  const metaPath = path.join(CACHE_DIR, key + ".json")
  const binPath = path.join(CACHE_DIR, key + ".bin")

  if (existsSync(metaPath) && existsSync(binPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { type?: string; at?: number }
      const age = Date.now() - Number(meta.at || 0)
      if (age < 1000 * 60 * 60 * 24 * 14) {
        const buf = readFileSync(binPath)
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": meta.type || "image/png",
            "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
          },
        })
      }
    } catch {}
  }

  try {
    const res = await fetch(src, {
      headers: {
        "User-Agent": "Mozilla/5.0 ChillflixLogoProxy/1.0",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://www.chillflix.lol/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      return new NextResponse("upstream " + res.status, { status: 502 })
    }
    const type = (res.headers.get("content-type") || "image/png").split(";")[0].trim()
    if (!type.startsWith("image/")) {
      return new NextResponse("not image", { status: 502 })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 64 || buf.length > 2_500_000) {
      return new NextResponse("bad size", { status: 502 })
    }
    try {
      writeFileSync(binPath, buf)
      writeFileSync(metaPath, JSON.stringify({ type, at: Date.now(), src }))
    } catch {}
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      },
    })
  } catch (e) {
    return new NextResponse("fetch failed", { status: 502 })
  }
}
