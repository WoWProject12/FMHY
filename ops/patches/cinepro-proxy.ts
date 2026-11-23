import {
    extractPlaybackToken,
    PLAYBACK_TOKEN_PARAM,
    withPlaybackToken,
} from "@/lib/playback-token"
import { resolvePlaybackProxyOrigin, withPlaybackProxyProcessNs } from "@/lib/playback-proxy-origin"
import {
    decodeCineproProxyPayload,
    decodeSignedCineproProxyPx,
    encodeSignedCineproProxyPx,
    type CineproProxyPayload,
} from "@/lib/cinepro/proxy-payload"

export type { CineproProxyPayload } from "@/lib/cinepro/proxy-payload"

const PEACHIFY_UPSTREAM_HOST_RE =
    /(?:^|\.)(eat-peach\.sbs|freecdn\d*\.top|nm-cdn\d+\.top|net52\.cc)$/i

function finalizeCineproProxyHref(href: string) {
    return withPlaybackProxyProcessNs(href)
}

export function encodeCineproProxyData(url: string, headers?: Record<string, string>) {
    return encodeURIComponent(JSON.stringify({ url, headers: headers ?? {} }))
}

function isServerRuntime() {
    return typeof window === "undefined"
}

/** Replace long ?data= / legacy ?pid= proxy URLs with signed ?px=. */
export function compactCineproProxyHref(
    href: string,
    requestOrigin: string,
    playbackToken?: string
): string | null {
    if (!isServerRuntime()) {
        return null
    }

    try {
        const origin = resolvePlaybackProxyOrigin(requestOrigin)
        const url = new URL(href, origin)

        if (!url.pathname.includes("/api/cinepro/proxy")) {
            return null
        }

        const token = extractPlaybackToken(url) ?? playbackToken
        url.searchParams.delete(PLAYBACK_TOKEN_PARAM)

        if (url.searchParams.get("px")) {
            const compact = url.toString()
            const tagged = finalizeCineproProxyHref(compact)
            return token ? withPlaybackToken(tagged, token) : tagged
        }

        const payload = decodeCineproProxyPayload(url)
        if (!payload) {
            return null
        }

        const compact = finalizeCineproProxyHref(
            `${origin}/api/cinepro/proxy?px=${encodeSignedCineproProxyPx(payload)}`
        )
        return token ? withPlaybackToken(compact, token) : compact
    } catch {
        return null
    }
}

export function buildCineproProxyHref(
    requestOrigin: string,
    targetUrl: string,
    headers?: Record<string, string>,
    playbackToken?: string
) {
    const origin = resolvePlaybackProxyOrigin(requestOrigin)
    const base = `${origin}/api/cinepro/proxy`

    if (isServerRuntime()) {
        const href = finalizeCineproProxyHref(
            `${base}?px=${encodeSignedCineproProxyPx({ url: targetUrl, headers })}`
        )
        return playbackToken ? withPlaybackToken(href, playbackToken) : href
    }

    const href = finalizeCineproProxyHref(`${base}?data=${encodeCineproProxyData(targetUrl, headers)}`)
    return playbackToken ? withPlaybackToken(href, playbackToken) : href
}

export function decodeCineproProxyPayloadFromHref(
    href: string,
    baseOrigin?: string
): CineproProxyPayload | undefined {
    try {
        const origin =
            baseOrigin ??
            (typeof window !== "undefined" ? window.location.origin : "https://chillflix.lol")
        const url = new URL(href, origin)

        if (!url.pathname.includes("/api/cinepro/proxy")) {
            return undefined
        }

        if (isServerRuntime()) {
            return decodeCineproProxyPayload(url)
        }

        const data = url.searchParams.get("data")
        if (data) {
            const payload = JSON.parse(decodeURIComponent(data)) as {
                url?: unknown
                headers?: unknown
            }

            if (typeof payload.url !== "string" || !payload.url) {
                return undefined
            }

            const headers: Record<string, string> | undefined =
                payload.headers &&
                typeof payload.headers === "object" &&
                !Array.isArray(payload.headers)
                    ? (Object.fromEntries(
                          Object.entries(payload.headers as Record<string, unknown>).filter(
                              ([, value]) => typeof value === "string"
                          )
                      ) as Record<string, string>)
                    : undefined

            return { url: payload.url, headers }
        }

        // Signed ?px= needs AUTH_SECRET — ask segproxy (same nginx route).
        const px = url.searchParams.get("px")
        if (!px || typeof XMLHttpRequest === "undefined") {
            return undefined
        }
        try {
            const xhr = new XMLHttpRequest()
            xhr.open(
                "GET",
                `/api/cinepro/proxy?unwrap=1&px=${encodeURIComponent(px)}`,
                false
            )
            xhr.send(null)
            if (xhr.status !== 200) return undefined
            const body = JSON.parse(xhr.responseText) as {
                ok?: boolean
                url?: unknown
                headers?: unknown
            }
            if (!body?.ok || typeof body.url !== "string" || !body.url) return undefined
            const headers: Record<string, string> | undefined =
                body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
                    ? (Object.fromEntries(
                          Object.entries(body.headers as Record<string, unknown>).filter(
                              ([, value]) => typeof value === "string"
                          )
                      ) as Record<string, string>)
                    : undefined
            return { url: body.url, headers }
        } catch {
            return undefined
        }
    } catch {
        return undefined
    }
}

/** Peachify segment/CDN hosts block browser requests — relay via our proxy (hostname only). */
export function shouldTunnelDirectPeachifyUpstreamUrl(url: string, baseOrigin?: string) {
    try {
        const origin =
            baseOrigin ??
            (typeof window !== "undefined" ? window.location.origin : "https://chillflix.lol")
        const parsed = new URL(url, origin)

        if (
            parsed.pathname.includes("/api/cinepro/proxy") ||
            parsed.pathname.includes("/api/vidlink/proxy") ||
            parsed.pathname.includes("/api/vidlink/stream")
        ) {
            return false
        }

        if (parsed.hostname.includes("cccdn.net")) {
            return false
        }

        return (
            PEACHIFY_UPSTREAM_HOST_RE.test(parsed.hostname) ||
            parsed.pathname.includes("ts-segment")
        )
    } catch {
        return false
    }
}

export function resolveProxiedMediaRequestUrl(
    requestUrl: string,
    playbackToken: string | undefined,
    proxyHeaders: Record<string, string> | undefined,
    requestOrigin: string
) {
    let resolved = requestUrl

    if (
        playbackToken &&
        (resolved.includes("/api/cinepro/proxy") ||
            resolved.includes("/api/vidlink/proxy") ||
            resolved.includes("/api/vidlink/stream") ||
            resolved.includes("/api/flixhq/proxy") ||
            resolved.includes("/api/flixhq/stream"))
    ) {
        resolved = withPlaybackToken(resolved, playbackToken)
    }

    if (
        playbackToken &&
        shouldTunnelDirectPeachifyUpstreamUrl(resolved, requestOrigin)
    ) {
        const headers = proxyHeaders ?? {
            Referer: "https://peachify.top/",
            Origin: "https://peachify.top",
        }
        resolved = buildCineproProxyHref(requestOrigin, resolved, headers, playbackToken)
    }

    return resolved
}

function flattenCineproProxyHref(
    href: string,
    requestOrigin: string,
    playbackToken?: string
) {
    const origin = resolvePlaybackProxyOrigin(requestOrigin)

    try {
        if (href.startsWith("/v1/proxy") || href.startsWith("/proxy?")) {
            const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : ""
            const proxied = `${origin}/api/cinepro/proxy${query ? `?${query}` : ""}`
            return (
                compactCineproProxyHref(proxied, requestOrigin, playbackToken) ??
                (playbackToken
                    ? withPlaybackToken(finalizeCineproProxyHref(proxied), playbackToken)
                    : finalizeCineproProxyHref(proxied))
            )
        }

        const parsed = new URL(href, origin)
        const isCineproProxyPath =
            parsed.pathname.endsWith("/v1/proxy") || parsed.pathname.endsWith("/proxy")
        const isAppProxyPath = parsed.pathname.includes("/api/cinepro/proxy")

        if (isCineproProxyPath) {
            const data = parsed.searchParams.get("data")
            if (!data) return null

            const flat = new URL(`${origin}/api/cinepro/proxy`)
            flat.searchParams.set("data", data)
            const proxied = flat.toString()
            return (
                compactCineproProxyHref(proxied, requestOrigin, playbackToken) ??
                (playbackToken
                    ? withPlaybackToken(finalizeCineproProxyHref(proxied), playbackToken)
                    : finalizeCineproProxyHref(proxied))
            )
        }

        if (isAppProxyPath) {
            const proxied = parsed.toString()
            return (
                compactCineproProxyHref(proxied, requestOrigin, playbackToken) ??
                (playbackToken
                    ? withPlaybackToken(finalizeCineproProxyHref(proxied), playbackToken)
                    : finalizeCineproProxyHref(proxied))
            )
        }
    } catch {
        return null
    }

    return null
}

function rewriteExistingProxyLine(
    line: string,
    cineproBaseUrl: string | undefined,
    requestOrigin: string,
    playbackToken?: string
) {
    const origin = resolvePlaybackProxyOrigin(requestOrigin)
    let rewritten = line

    if (cineproBaseUrl) {
        const normalizedBaseUrl = cineproBaseUrl.replace(/\/$/, "")
        rewritten = rewritten
            .replaceAll(`${normalizedBaseUrl}/v1/proxy`, `${origin}/api/cinepro/proxy`)
            .replaceAll(`${normalizedBaseUrl}/proxy`, `${origin}/api/cinepro/proxy`)
    }

    rewritten = rewritten
        .replaceAll(/(^|[\r\n]+)\/v1\/proxy(?=\?)/g, "$1/api/cinepro/proxy")
        .replaceAll(/(^|[\r\n]+)\/proxy(?=\?)/g, "$1/api/cinepro/proxy")
        .replaceAll(/([=",])\/v1\/proxy(?=\?)/g, "$1/api/cinepro/proxy")
        .replaceAll(/([=",])\/proxy(?=\?)/g, "$1/api/cinepro/proxy")

    return rewritten.replace(/(\/api\/cinepro\/proxy\?[^\s"'<>]+)/g, (match) => {
        const compacted = compactCineproProxyHref(match, requestOrigin, playbackToken)
        if (compacted) return compacted
        const tagged = finalizeCineproProxyHref(match)
        return playbackToken ? withPlaybackToken(tagged, playbackToken) : tagged
    })
}

const STREAM_PATH_PREFIX = "/api/cinepro/proxy/s/"
const SAFE_MEDIA_FILE =
    /^(?:page-\d+\.html|chunk-\d+\.js|[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.(?:ts|m4s|mp4|m4a|aac|vtt))$/

export function parseCineproStreamPath(pathname: string) {
    const index = pathname.indexOf(STREAM_PATH_PREFIX)
    if (index === -1) return null
    const raw = pathname.slice(index + STREAM_PATH_PREFIX.length).split("/")
    if (raw.length < 3) return null

    let parts: string[]
    try {
        parts = raw.map((part) => decodeURIComponent(part))
    } catch {
        return null
    }

    const px = parts[0] ?? ""
    const pt = parts[1] ?? ""
    if (!px || !pt) return null
    if (parts[2] === "b") {
        const rel = parts.slice(3).join("/")
        if (!isSafeMediaPath(rel)) return null
        return { px, pt, file: rel, media: true as const }
    }
    if (parts.length !== 3) return null
    const file = parts[2] ?? ""
    if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) return null
    return { px, pt, file, media: false as const }
}

function isSafeMediaPath(rel: string) {
    if (!rel || rel.includes("..") || rel.includes("\\")) return false
    const parts = rel.split("/")
    if (parts.length < 1 || parts.length > 8) return false
    if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._~-]{1,400}$/.test(part))) {
        return false
    }
    return SAFE_MEDIA_FILE.test(parts[parts.length - 1] ?? "")
}

/** VAPlayer (and similar) mint JWT `token=` / `cast_token=` on the master URL.
 * Absolute-path children drop that query under `new URL(child, master)`, and
 * sibling `/s/` rewrites used to wipe `search` entirely — both yield CDN 403. */
const UPSTREAM_AUTH_QUERY_KEYS = ["token", "cast_token"] as const

function inheritUpstreamAuthQuery(target: URL, from: URL) {
    for (const key of UPSTREAM_AUTH_QUERY_KEYS) {
        const value = from.searchParams.get(key)
        if (value && !target.searchParams.has(key)) {
            target.searchParams.set(key, value)
        }
    }
}

function keepUpstreamAuthQuery(url: URL) {
    const kept = new URLSearchParams()
    for (const key of UPSTREAM_AUTH_QUERY_KEYS) {
        const value = url.searchParams.get(key)
        if (value) kept.set(key, value)
    }
    url.search = kept.toString()
    url.hash = ""
}

function resolveManifestMediaUrls(ref: string, master: URL): { plain: string; authenticated: string } {
    const plainUrl = new URL(ref, master)
    const authUrl = new URL(plainUrl.toString())
    inheritUpstreamAuthQuery(authUrl, master)
    return { plain: plainUrl.toString(), authenticated: authUrl.toString() }
}

function applyStreamFile(
    payload: CineproProxyPayload,
    file: string,
    media = false
): CineproProxyPayload | undefined {
    let signed: URL
    try {
        signed = new URL(payload.url)
    } catch {
        return undefined
    }

    if (!media) {
        const signedName = signed.pathname.split("/").pop() || ""
        if (file === signedName) return payload
        if (!SAFE_MEDIA_FILE.test(file)) return undefined
        const slash = signed.pathname.lastIndexOf("/")
        signed.pathname = `${signed.pathname.slice(0, slash + 1)}${file}`
        keepUpstreamAuthQuery(signed)
        return { url: signed.toString(), headers: payload.headers }
    }

    if (!isSafeMediaPath(file)) return undefined
    const folder = signed.pathname.split("/").filter(Boolean).slice(-2, -1)[0] || ""
    const pieces = file.split("/")
    if (pieces.length === 1) {
        const slash = signed.pathname.lastIndexOf("/")
        signed.pathname = `${signed.pathname.slice(0, slash + 1)}${file}`
    } else if (folder && pieces.includes(folder)) {
        signed.pathname = `/${pieces.join("/")}`
    } else {
        return undefined
    }
    keepUpstreamAuthQuery(signed)
    return { url: signed.toString(), headers: payload.headers }
}

/** Path-form playlist request: one signature covers every sibling video piece. */
export function resolveCineproProxyRequest(requestUrl: URL):
    | { payload: CineproProxyPayload; playbackToken?: string; relativeMedia: boolean }
    | undefined {
    const streamed = parseCineproStreamPath(requestUrl.pathname)
    const queryToken = extractPlaybackToken(requestUrl) ?? undefined

    if (streamed) {
        const signed = decodeSignedCineproProxyPx(streamed.px)
        if (!signed) return undefined
        const payload = applyStreamFile(signed, streamed.file, streamed.media)
        if (!payload) return undefined
        let signedName = ""
        try {
            signedName = new URL(signed.url).pathname.split("/").pop() || ""
        } catch {
            return undefined
        }
        return {
            payload,
            playbackToken: queryToken || streamed.pt || undefined,
            relativeMedia: streamed.file === signedName,
        }
    }

    const payload = decodeCineproProxyPayload(requestUrl)
    if (!payload) return undefined
    return { payload, playbackToken: queryToken, relativeMedia: false }
}

function sameDirectoryMediaName(master: URL, absolute: string) {
    let target: URL
    try {
        target = new URL(absolute)
    } catch {
        return null
    }
    if (target.origin !== master.origin || target.search || target.hash) return null
    const masterDir = master.pathname.slice(0, master.pathname.lastIndexOf("/") + 1)
    const targetDir = target.pathname.slice(0, target.pathname.lastIndexOf("/") + 1)
    if (masterDir !== targetDir) return null
    const name = target.pathname.slice(targetDir.length)
    if (!SAFE_MEDIA_FILE.test(name)) return null
    return name
}

function rootFolderMediaPath(master: URL, absolute: string) {
    let target: URL
    try {
        target = new URL(absolute)
    } catch {
        return null
    }
    if (target.origin !== master.origin || target.search || target.hash) return null
    const folder = master.pathname.split("/").filter(Boolean).slice(-2, -1)[0] || ""
    const pieces = target.pathname.split("/").filter(Boolean)
    if (!folder || !pieces.includes(folder) || pieces.length > 8) return null
    if (!SAFE_MEDIA_FILE.test(pieces[pieces.length - 1] || "")) return null
    if (pieces.some((part) => !/^[A-Za-z0-9._~-]{1,400}$/.test(part))) return null
    return `b/${pieces.join("/")}`
}

function playlistBasename(absolute: string) {
    let target: URL
    try {
        target = new URL(absolute)
    } catch {
        return null
    }
    const name = target.pathname.split("/").pop() || ""
    if (!/\.m3u8?$/i.test(name) || name.includes("..")) return null
    return name
}

function buildStreamPathHref(
    requestOrigin: string,
    targetUrl: string,
    headers: Record<string, string> | undefined,
    playbackToken: string,
    fileName: string
) {
    const origin = resolvePlaybackProxyOrigin(requestOrigin)
    const px = encodeURIComponent(encodeSignedCineproProxyPx({ url: targetUrl, headers: headers ?? {} }))
    const token = encodeURIComponent(playbackToken)
    const file = encodeURIComponent(fileName)
    return finalizeCineproProxyHref(`${origin}/api/cinepro/proxy/s/${px}/${token}/${file}`)
}

function rewriteUriAttribute(
    line: string,
    masterUrl: URL,
    requestOrigin: string,
    proxyHeaders: Record<string, string> | undefined,
    playbackToken?: string,
    relativeMedia?: boolean
) {
    return line.replace(/URI="([^"]+)"/, (_, uri) => {
        try {
            const { plain: absolutePlain, authenticated: absolute } = resolveManifestMediaUrls(
                uri,
                masterUrl
            )
            if (absolutePlain.includes("/api/cinepro/proxy") || absolute.includes("/api/cinepro/proxy")) {
                const compacted =
                    compactCineproProxyHref(absolutePlain, requestOrigin, playbackToken) ??
                    finalizeCineproProxyHref(absolutePlain)
                const tagged = playbackToken ? withPlaybackToken(compacted, playbackToken) : compacted
                return `URI="${tagged}"`
            }

            if (playbackToken) {
                if (relativeMedia) {
                    const mediaName =
                        sameDirectoryMediaName(masterUrl, absolutePlain) ||
                        rootFolderMediaPath(masterUrl, absolutePlain)
                    if (mediaName) return `URI="${mediaName}"`
                }
                const playlistName = playlistBasename(absolutePlain)
                if (playlistName) {
                    return `URI="${buildStreamPathHref(requestOrigin, absolute, proxyHeaders, playbackToken, playlistName)}"`
                }
            }

            return `URI="${buildCineproProxyHref(requestOrigin, absolute, proxyHeaders, playbackToken)}"`
        } catch {
            return line
        }
    })
}


/** Movy majorplay masters often ship NAME="1080p" without RESOLUTION.
 *  HLS.js then reports height=0 and the player hides every quality row.
 *  Infer a RESOLUTION from NAME so the ladder is selectable. */
function enrichStreamInfResolution(infLine: string): string {
    if (/RESOLUTION=/i.test(infLine)) return infLine
    const name = /NAME="([^"]+)"/i.exec(infLine)?.[1]?.trim().toLowerCase() ?? ""
    let height = 0
    if (/(?:^|[^0-9])4\s*k(?:$|[^0-9])|uhd|2160/.test(name)) height = 2160
    else {
        const match = name.match(/(\d{3,4})\s*p/)
        if (match) height = Number(match[1]) || 0
    }
    if (height <= 0) return infLine
    const width =
        height >= 2160 ? 3840 : height >= 1080 ? 1920 : height >= 720 ? 1280 : height >= 480 ? 854 : 640
    const trimmed = infLine.trimEnd()
    if (trimmed.endsWith(",")) {
        return `${trimmed}RESOLUTION=${width}x${height}`
    }
    return `${trimmed},RESOLUTION=${width}x${height}`
}

function padBase64Gaia(value: string) {
    const trimmed = value.trim().replace(/-/g, "+").replace(/_/g, "/")
    const pad = (4 - (trimmed.length % 4)) % 4
    return trimmed + "=".repeat(pad)
}

function isTilesVariantUri(uri: string) {
    const raw = String(uri || "").trim()
    if (!raw) return false
    const path = raw.split("?")[0]
    const base = path.split("/").pop()?.toLowerCase() || ""
    if (base === "tiles.m3u8" || /(?:^|\/)tiles\.m3u8$/i.test(path)) return true
    // Gaia wraps upstream URIs: /api/gaiaflix-hls?id=<base64>
    try {
        const u = new URL(raw, "https://gaiaflix.xyz")
        if (!u.pathname.includes("/api/gaiaflix-hls")) return false
        const id = u.searchParams.get("id")
        if (!id) return false
        const decoded = Buffer.from(padBase64Gaia(id), "base64").toString("utf8").trim()
        const decPath = decoded.split("?")[0]
        const decBase = decPath.split("/").pop()?.toLowerCase() || ""
        return decBase === "tiles.m3u8" || /(?:^|\/)tiles\.m3u8$/i.test(decPath)
    } catch {
        return false
    }
}

/** Gaia masters ship many audio/subtitle tracks. Keep DEFAULT only so
 * HLS.js does not wait on extra rendition playlists before first paint. */
function slimGaiaAlternateRenditions(manifest: string) {
    if (!manifest.includes("#EXT-X-MEDIA:") || !/gaiaflix-hls|tiles\.m3u8|rousav\.tech/i.test(manifest)) {
        return manifest
    }
    const lines = manifest.split("\n")
    const out: string[] = []
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("#EXT-X-MEDIA:")) {
            out.push(line)
            continue
        }
        const isDefault = /DEFAULT=YES/i.test(trimmed)
        const type = /TYPE=([A-Z-]+)/i.exec(trimmed)?.[1]?.toUpperCase() || ""
        if ((type === "AUDIO" || type === "SUBTITLES") && !isDefault) continue
        out.push(line)
    }
    return out.join("\n")
}

/** Drop thumbnail-sprite ladders (GaiaFlix tiles.m3u8) before HLS.js picks a rung. */
function stripTilesMultivariantVariants(manifest: string) {
    // Do not gate on a literal tiles.m3u8 substring — Gaia base64-encodes it
    // inside /api/gaiaflix-hls?id=… so the plaintext never appears.
    if (!manifest.includes("#EXT-X-STREAM-INF")) {
        return manifest
    }
    const lines = manifest.split("\n")
    const out: string[] = []
    let i = 0
    while (i < lines.length) {
        const line = lines[i] ?? ""
        const trimmed = line.trim()
        if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
            const uriLine = lines[i + 1] ?? ""
            const uri = uriLine.trim()
            if (uri && !uri.startsWith("#") && isTilesVariantUri(uri)) {
                i += 2
                continue
            }
        }
        out.push(line)
        i += 1
    }
    return out.join("\n")
}

/** Put highest BANDWIDTH / RESOLUTION variants first so HLS.js does not start
 *  on a low rung that Cloudflare sometimes 400s (Movy majorplay ladders). */
function reorderMultivariantHighestFirst(manifest: string) {
    if (!manifest.includes("#EXT-X-STREAM-INF")) {
        return manifest
    }

    const lines = manifest.split("\n")
    const pre: string[] = []
    const variants: Array<{ inf: string; uri: string; score: number }> = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i] ?? ""
        const trimmed = line.trim()
        if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
            const uriLine = lines[i + 1] ?? ""
            const uri = uriLine.trim()
            if (!uri || uri.startsWith("#")) {
                pre.push(line)
                i += 1
                continue
            }
            const bw = Number(/BANDWIDTH=(\d+)/i.exec(trimmed)?.[1] ?? 0)
            const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(trimmed)?.[1] ?? 0)
            const enrichedInf = enrichStreamInfResolution(line)
            const enrichedHeight =
                Number(/RESOLUTION=\d+x(\d+)/i.exec(enrichedInf.trim())?.[1] ?? height) || height
            variants.push({
                inf: enrichedInf,
                uri: uriLine,
                score: enrichedHeight * 1_000_000 + bw,
            })
            i += 2
            continue
        }
        if (variants.length === 0) {
            pre.push(line)
        }
        i += 1
    }

    if (variants.length < 2) {
        return manifest
            .split("\n")
            .map((line) =>
                line.trim().startsWith("#EXT-X-STREAM-INF")
                    ? enrichStreamInfResolution(line)
                    : line
            )
            .join("\n")
    }

    variants.sort((a, b) => b.score - a.score)
    // Drop duplicate NAME/BANDWIDTH rungs (Movy often lists 1080p twice; CF may
    // 400 only the first px). Keep the first after highest-first sort.
    const seen = new Set<string>()
    const unique: typeof variants = []
    for (const variant of variants) {
        const trimmed = variant.inf.trim()
        const name = /NAME="([^"]+)"/i.exec(trimmed)?.[1] ?? ""
        const bw = /BANDWIDTH=(\d+)/i.exec(trimmed)?.[1] ?? String(variant.score)
        const key = name ? `name:${name}` : `bw:${bw}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(variant)
    }
    const out = [...pre]
    for (const variant of unique) {
        out.push(variant.inf)
        out.push(variant.uri)
    }
    return out.join("\n")
}

/** Prefer DEFAULT / lowest RESOLUTION first (GaiaFlix fast start). */
function reorderMultivariantLowestFirst(manifest: string) {
    if (!manifest.includes("#EXT-X-STREAM-INF")) {
        return manifest
    }

    const lines = manifest.split("\n")
    const pre: string[] = []
    const variants: Array<{ inf: string; uri: string; score: number; isDefault: boolean }> = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i] ?? ""
        const trimmed = line.trim()
        if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
            const uriLine = lines[i + 1] ?? ""
            const uri = uriLine.trim()
            if (!uri || uri.startsWith("#")) {
                pre.push(line)
                i += 1
                continue
            }
            const bw = Number(/BANDWIDTH=(\d+)/i.exec(trimmed)?.[1] ?? 0)
            const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(trimmed)?.[1] ?? 0)
            const enrichedInf = enrichStreamInfResolution(line)
            const enrichedHeight =
                Number(/RESOLUTION=\d+x(\d+)/i.exec(enrichedInf.trim())?.[1] ?? height) || height
            variants.push({
                inf: enrichedInf,
                uri: uriLine,
                score: enrichedHeight * 1_000_000 + bw,
                isDefault: /DEFAULT=YES/i.test(trimmed),
            })
            i += 2
            continue
        }
        if (variants.length === 0) {
            pre.push(line)
        }
        i += 1
    }

    if (variants.length < 2) {
        return reorderMultivariantHighestFirst(manifest)
    }

    variants.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return a.score - b.score
    })
    const out = [...pre]
    for (const variant of variants) {
        out.push(variant.inf)
        out.push(variant.uri)
    }
    return out.join("\n")
}

/** VAPlayer/YouTube-style masters inject YT-EXT-* tags that confuse HLS.js. */
function sanitizeVaPlayerManifestLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return line
    if (/^#YT-EXT/i.test(trimmed)) return ""
    if (!trimmed.startsWith("#")) return line
    if (/YT-EXT-/i.test(trimmed)) {
        return line
            .replace(/,?YT-EXT-[A-Z0-9-]+=[^,]*/gi, "")
            .replace(/,,+/g, ",")
            .replace(/:,/g, ":")
    }
    return line
}

export function rewriteCineproManifestUrls(
    manifest: string,
    masterUrl: string,
    requestOrigin: string,
    proxyHeaders: Record<string, string> | undefined,
    cineproBaseUrl?: string,
    playbackToken?: string,
    options?: { relativeMedia?: boolean }
) {
    const master = new URL(masterUrl)
    const relativeMedia = Boolean(options?.relativeMedia && playbackToken)

    // Slim Gaia alternates + strip tiles before rewriting (px= hides tiles.m3u8).
    const sourceManifest = stripTilesMultivariantVariants(
        slimGaiaAlternateRenditions(manifest)
    )

    const rewritten = sourceManifest
        .split("\n")
        .map((line) => {
            line = sanitizeVaPlayerManifestLine(line)
            if (!line.trim()) {
                return ""
            }
            const trimmed = line.trim()

            if (!trimmed) {
                return line
            }

            if (
                trimmed.startsWith("#EXT-X-KEY") ||
                trimmed.startsWith("#EXT-X-MAP") ||
                trimmed.includes('URI="')
            ) {
                return rewriteUriAttribute(
                    rewriteExistingProxyLine(line, cineproBaseUrl, requestOrigin, playbackToken),
                    master,
                    requestOrigin,
                    proxyHeaders,
                    playbackToken,
                    relativeMedia
                )
            }

            if (trimmed.startsWith("#")) {
                return rewriteExistingProxyLine(line, cineproBaseUrl, requestOrigin, playbackToken)
            }

            const flattenedProxy = flattenCineproProxyHref(trimmed, requestOrigin, playbackToken)
            if (flattenedProxy) {
                return line.replace(trimmed, flattenedProxy)
            }

            try {
                const { plain: absolutePlain, authenticated: absolute } = resolveManifestMediaUrls(
                    trimmed,
                    master
                )
                const flattenedAbsolute = flattenCineproProxyHref(
                    absolutePlain,
                    requestOrigin,
                    playbackToken
                )

                if (flattenedAbsolute) {
                    return line.replace(trimmed, flattenedAbsolute)
                }

                if (playbackToken) {
                    if (relativeMedia) {
                        const mediaName =
                            sameDirectoryMediaName(master, absolutePlain) ||
                            rootFolderMediaPath(master, absolutePlain)
                        if (mediaName) return line.replace(trimmed, mediaName)
                    }
                    const playlistName = playlistBasename(absolutePlain)
                    if (playlistName) {
                        return line.replace(
                            trimmed,
                            buildStreamPathHref(
                                requestOrigin,
                                absolute,
                                proxyHeaders,
                                playbackToken,
                                playlistName
                            )
                        )
                    }
                }

                const proxied = buildCineproProxyHref(
                    requestOrigin,
                    absolute,
                    proxyHeaders,
                    playbackToken
                )
                return line.replace(trimmed, proxied)
            } catch {
                return rewriteExistingProxyLine(line, cineproBaseUrl, requestOrigin, playbackToken)
            }
        })
        .join("\n")

    return /gaiaflix-hls|rousav\.tech/i.test(masterUrl)
        ? reorderMultivariantLowestFirst(rewritten)
        : /totallyacdn\.cc|cdn\.hls\.lol/i.test(masterUrl)
          ? // Athena: start at 1080p, not 4K (4K decode can yield audio-only / black video).
            reorderMultivariantLowestFirst(rewritten)
          : reorderMultivariantHighestFirst(rewritten)
}
