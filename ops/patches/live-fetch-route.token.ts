import { NextResponse } from "next/server"

import {
  binaryResponseFromAsset,
  fetchLiveProxiedAsset,
  manifestResponseFromAsset,
} from "@/lib/iptv/live-play-proxy"
import { resolveLiveFetchToken } from "@/lib/iptv/live-fetch-token"
import { isHttpUrl } from "@/lib/iptv/proxy"
import { assertIpNotBlocked } from "@/lib/request-security"
import { resolveRequestOrigin } from "@/lib/request-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range, Content-Type, Accept",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: Request) {
  const ipDenied = assertIpNotBlocked(request)
  if (ipDenied) return ipDenied

  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("t")
  const rawUrl = requestUrl.searchParams.get("u")

  let targetUrl: string | null = null
  if (token) {
    targetUrl = resolveLiveFetchToken(token)
    if (!targetUrl) {
      return NextResponse.json(
        { error: "Live fetch token invalid or expired." },
        { status: 401, headers: CORS }
      )
    }
  } else if (rawUrl) {
    targetUrl = rawUrl
  }

  if (!targetUrl || !isHttpUrl(targetUrl)) {
    return NextResponse.json(
      { error: "Invalid live fetch target." },
      { status: 400, headers: CORS }
    )
  }

  const requestOrigin = resolveRequestOrigin(request)
  const range = request.headers.get("range") ?? undefined

  try {
    const asset = await fetchLiveProxiedAsset(targetUrl, range)

    if (!asset) {
      return NextResponse.json(
        { error: "Upstream live segment unavailable." },
        { status: 502, headers: CORS }
      )
    }

    if (asset.kind === "manifest") {
      const manifest = manifestResponseFromAsset(asset, requestOrigin)
      return new NextResponse(manifest, {
        status: 200,
        headers: {
          ...CORS,
          "content-type": "application/vnd.apple.mpegurl",
        },
      })
    }

    const result = binaryResponseFromAsset(asset)
    const headers = new Headers(CORS)
    if (result.contentType) headers.set("content-type", result.contentType)
    // Help players with partial content when upstream honored Range.
    if (result.status === 206) {
      const contentRange = (result as { headers?: Headers }).headers?.get?.("content-range")
      if (contentRange) headers.set("content-range", contentRange)
      headers.set("accept-ranges", "bytes")
    }
    return new NextResponse(result.body, { status: result.status, headers })
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch live stream segment." },
      { status: 502, headers: CORS }
    )
  }
}
