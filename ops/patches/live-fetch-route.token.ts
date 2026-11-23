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
  const targetUrl = token ? resolveLiveFetchToken(token) : rawUrl

  if (!targetUrl || !isHttpUrl(targetUrl)) {
    return NextResponse.json({ error: "Invalid live fetch target." }, { status: 400 })
  }

  const requestOrigin = resolveRequestOrigin(request)
  const range = request.headers.get("range") ?? undefined

  try {
    const asset = await fetchLiveProxiedAsset(targetUrl, range)

    if (!asset) {
      return NextResponse.json({ error: "Invalid live fetch target." }, { status: 400 })
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
    return new NextResponse(result.body, { status: result.status, headers })
  } catch {
    return NextResponse.json({ error: "Failed to fetch live stream segment." }, { status: 502 })
  }
}
