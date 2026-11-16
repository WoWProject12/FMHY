import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source
} from '@omss/framework';
import { fetchTextViaRelay } from '../../utils/worker-http.js';

/**
 * Rivestream scrapper (scrapper.rivestream.app) — same class as VAPlayer:
 * TMDB → JSON → HLS. Fetches via Cloudflare worker relay (browser/edge IP)
 * when workers are configured, else direct VPS.
 */

const SCRAPPER = 'https://scrapper.rivestream.app';
const SITE = 'https://www.rivestream.app';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

/** Prefer providers that usually return HLS for Hollywood titles. */
const PREFERRED = [
    'citadel',
    'pulse',
    'apogee',
    'electra',
    'rift',
    'fortress',
    'primevids',
    'apollo',
    'asiacloud',
    'kismet',
    'mirage',
    'prometheus',
    'lumen',
    'valiant',
    'sentinel',
    'vanguard',
    'oberon'
];

const RESULT_TTL_MS = 8 * 60 * 1000;
const resultCache = new Map<string, { expiresAt: number; result: ProviderResult }>();

type ScrapeSource = {
    url?: string;
    quality?: string;
    source?: string;
    format?: string;
};

type ProbedMaster = {
    quality: string;
    heights: number[];
    ok: boolean;
    reason?: string;
    /** When set, play this URL instead of the ABR master (tiles-only / demux-dead). */
    playUrl?: string;
};

const HEADERS: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    Origin: SITE,
    Referer: `${SITE}/`,
    'Accept-Language': 'en-US,en;q=0.9'
};

function cacheKey(media: ProviderMediaObject): string {
    if (media.type === 'tv') {
        return `tv:${media.tmdbId}:${media.s ?? 1}:${media.e ?? 1}`;
    }
    return `movie:${media.tmdbId}`;
}

function unwrapStreamProxy(rawUrl: string): { url: string; headers: Record<string, string> } {
    try {
        const u = new URL(rawUrl);
        // cors.corsflix.net/m3u8?url=<inner> (and similar) — probe/resolve against the
        // real CDN master or relative tiles.m3u8 resolves to corsflix and lies.
        const nested =
            u.searchParams.get('url') ||
            u.searchParams.get('u') ||
            u.searchParams.get('destination');
        if (
            nested &&
            /^https?:\/\//i.test(nested) &&
            (/corsflix\.net$/i.test(u.hostname) ||
                /\/m3u8\/?$/i.test(u.pathname) ||
                /proxy\.valhallastream\.com$/i.test(u.hostname))
        ) {
            let headers: Record<string, string> = {
                'User-Agent': UA,
                Accept: '*/*',
                Referer: SITE,
                Origin: SITE
            };
            const hdrRaw = u.searchParams.get('headers');
            if (hdrRaw) {
                try {
                    const parsed = JSON.parse(hdrRaw) as Record<string, unknown>;
                    for (const [k, v] of Object.entries(parsed)) {
                        if (typeof v === 'string' && v) headers[k] = v;
                    }
                } catch {
                    /* keep defaults */
                }
            }
            headers.Accept = '*/*';
            return unwrapStreamProxy(nested); // unwrap nested proxies
        }
        if (!/proxy\.valhallastream\.com$/i.test(u.hostname)) {
            return { url: rawUrl, headers: { ...HEADERS, Accept: '*/*', Referer: SITE, Origin: SITE } };
        }
        const inner = u.searchParams.get('url');
        if (!inner) return { url: rawUrl, headers: { ...HEADERS } };
        let headers: Record<string, string> = {
            'User-Agent': UA,
            Accept: '*/*',
            Referer: SITE,
            Origin: SITE
        };
        const hdrRaw = u.searchParams.get('headers');
        if (hdrRaw) {
            try {
                const parsed = JSON.parse(hdrRaw) as Record<string, unknown>;
                for (const [k, v] of Object.entries(parsed)) {
                    if (typeof v === 'string' && v) headers[k] = v;
                }
            } catch {
                /* keep defaults */
            }
        }
        return { url: inner, headers };
    } catch {
        return { url: rawUrl, headers: { ...HEADERS } };
    }
}

function parseHeightQuality(blob: string): string | null {
    const b = blob.toLowerCase();
    if (/2160|4k|uhd/.test(b)) return '2160p';
    if (/1080/.test(b)) return '1080p';
    if (/720/.test(b)) return '720p';
    if (/480/.test(b)) return '480p';
    if (/360/.test(b)) return '360p';
    return null;
}

function heightToLabel(h: number): string {
    if (h >= 2000) return '2160p';
    if (h >= 1000) return '1080p';
    if (h >= 700) return '720p';
    if (h >= 400) return '480p';
    if (h > 0) return `${h}p`;
    return 'Auto';
}

/** PrimeVids uses CDN slot names (tcloud/dcloud) — not display qualities. */
function isCdnSlotLabel(label: string): boolean {
    return /^(tcloud|dcloud|ipcloud|cloud|auto|hd|sd|fhd|default|hls)$/i.test(label.trim());
}


/** Pull dub label from Citadel-style "720p | Hindi" / "720p · Hindi" claims. */
function languageFromClaim(label: string): { label: string; language: string } | null {
    const raw = String(label || '').trim();
    if (!raw) return null;
    const m =
        raw.match(/[|·]\s*([A-Za-z][A-Za-z .'-]{1,32})\s*$/) ||
        raw.match(/\b(English|Hindi|Tamil|Telugu|Spanish|French|German|Italian|Portuguese|Korean|Japanese|Chinese|Arabic|Turkish|Russian)\b/i);
    if (!m) return null;
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (!name || /^auto$/i.test(name)) return null;
    return { label: name, language: name };
}


function inferQuality(label: string, url: string): string {
    const fromLabel = parseHeightQuality(label);
    if (fromLabel) {
        // Keep language suffix when present: "720p | Hindi"
        if (/\|/i.test(label) && /hindi|tamil|telugu|english|spanish/i.test(label)) {
            const lang = label.split('|').slice(1).join('|').trim();
            return lang ? `${fromLabel} · ${lang}` : fromLabel;
        }
        return fromLabel;
    }
    const fromUrl = parseHeightQuality(url);
    if (fromUrl) return fromUrl;
    if (isCdnSlotLabel(label) || !label.trim()) return 'Auto';
    if (/hindi|tamil|telugu|english/i.test(label)) return label.trim();
    return 'Auto';
}

/** Upstream identity for dedupe — never the /v1/proxy wrapper (all share one path). */
function upstreamDedupeKey(streamUrl: string): string {
    try {
        const u = new URL(streamUrl);
        u.searchParams.delete('api_key');
        u.searchParams.delete('token');
        u.searchParams.delete('Expires');
        u.searchParams.delete('Signature');
        u.hash = '';
        return u.toString().replace(/\?$/, '');
    } catch {
        return streamUrl.split('?')[0];
    }
}

function resolveAgainst(baseUrl: string, target: string): string {
    try {
        return new URL(target, baseUrl).toString();
    } catch {
        return target;
    }
}

function isTilesUri(uri: string): boolean {
    const path = String(uri || '').split('?')[0].toLowerCase();
    const base = path.split('/').pop() || '';
    return base === 'tiles.m3u8' || /(?:^|\/)tiles\.m3u8$/i.test(path);
}

/** HEAD/GET first bytes of a segment — 2xx means the CDN actually has media. */
async function segmentLooksLive(
    segmentUrl: string,
    headers: Record<string, string>
): Promise<boolean> {
    try {
        const res = await fetch(segmentUrl, {
            method: 'GET',
            headers: {
                ...headers,
                Accept: '*/*',
                Range: 'bytes=0-15'
            },
            signal: AbortSignal.timeout(4500)
        });
        if (!(res.ok || res.status === 206)) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
            return false; // real PNG sprite
        }
        if (buf.length > 0 && buf[0] === 0x47) return true; // MPEG-TS
        // fMP4 / ISO BMFF
        if (buf.length >= 8) {
            const box = buf.slice(4, 8).toString('ascii');
            if (box === 'ftyp' || box === 'styp' || box === 'moof' || box === 'sidx') return true;
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        return /mp2t|video\/|octet-stream|mp4/i.test(ct);
    } catch {
        return false;
    }
}

async function mediaPlaylistProbe(
    playlistUrl: string,
    headers: Record<string, string>
): Promise<{ live: boolean; durationSec: number }> {
    try {
        const via = await fetchTextViaRelay(playlistUrl, {
            method: 'GET',
            headers: {
                ...headers,
                Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*'
            },
            preferWorker: true,
            maxWorkers: 1
        });
        if (!via.body || !/#EXTM3U/i.test(via.body) || !/#EXTINF/i.test(via.body)) {
            return { live: false, durationSec: 0 };
        }
        if (/#EXT-X-IMAGES-ONLY/i.test(via.body)) return { live: false, durationSec: 0 };
        let durationSec = 0;
        for (const line of via.body.split(/\r?\n/)) {
            const m = line.match(/#EXTINF:\s*([\d.]+)/i);
            if (m) durationSec += Number(m[1]) || 0;
        }
        const seg = via.body
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith('#'));
        if (!seg) return { live: false, durationSec: 0 };
        // Also require init map live when present (fMP4).
        const mapLine = via.body.split(/\r?\n/).find((l) => /#EXT-X-MAP:/i.test(l));
        if (mapLine) {
            const mapUri = /URI\s*=\s*["']([^"']+)["']/i.exec(mapLine)?.[1];
            if (mapUri) {
                const mapLive = await segmentLooksLive(resolveAgainst(playlistUrl, mapUri), headers);
                if (!mapLive) return { live: false, durationSec };
            }
        }
        const live = await segmentLooksLive(resolveAgainst(playlistUrl, seg), headers);
        return { live, durationSec };
    } catch {
        return { live: false, durationSec: 0 };
    }
}

async function mediaPlaylistFirstSegmentLive(
    playlistUrl: string,
    headers: Record<string, string>
): Promise<boolean> {
    const probed = await mediaPlaylistProbe(playlistUrl, headers);
    return probed.live;
}

/**
 * Probe master/media playlist: reject JPG "slideshow HLS", collect RESOLUTION heights.
 * Rivestream sometimes ships tiles.m3u8 as the only live rung (TS disguised as .png)
 * while video_720p/480p + demuxed audio 404 — ABR masters hang on "Starting playback…".
 */
async function probeHlsMaster(
    streamUrl: string,
    headers: Record<string, string>
): Promise<ProbedMaster> {
    try {
        const via = await fetchTextViaRelay(streamUrl, {
            method: 'GET',
            headers: {
                ...headers,
                Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*'
            },
            preferWorker: true,
            maxWorkers: 1
        });
        if (!via.body || !/#EXTM3U/i.test(via.body)) {
            return { quality: 'Auto', heights: [], ok: false, reason: 'not-m3u8' };
        }
        const body = via.body;

        // Mobile Chrome MSE cannot play HEVC-only ladders (flash → black).
        // Electra/hakunaymatata often ship h265 with no CODECS attr — catch path too.
        if (
            /h265|hevc|hvc1|hev1/i.test(streamUrl) ||
            /CODECS="[^"]*(?:hvc1|hev1|hevc|h265)/i.test(body) ||
            /_h265_|\/h265\//i.test(body)
        ) {
            return { quality: 'Auto', heights: [], ok: false, reason: 'hevc-only' };
        }

        // TikTok / short-form CDNs and smut-named fillers are interstitial decoys
        // (proxy would 502 DECOY_HLS_MANIFEST). Reject here so we keep racing.
        const lowerBody = body.toLowerCase();
        if (
            lowerBody.includes('tiktokcdn.com') ||
            lowerBody.includes('tiktok.com/') ||
            lowerBody.includes('musical.ly') ||
            lowerBody.includes('byteicdn.com') ||
            lowerBody.includes('ibytedance.com') ||
            lowerBody.includes('/api/decoy/') ||
            /bigtits\.m3u8/i.test(streamUrl)
        ) {
            return { quality: 'Auto', heights: [], ok: false, reason: 'decoy-cdn' };
        }
        // Fortress/Citadel/hscow often name real MPEG-TS segments *.jpg (CDN disguise).
        // Only reject when the URI looks like JPEG *and* the bytes are a real image.
        const segmentLines = body
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        const jpgSegs = segmentLines.filter((l) => /\.(jpe?g)(\?|$)/i.test(l.split('?')[0]));
        if (segmentLines.length > 0 && jpgSegs.length >= Math.max(2, segmentLines.length - 1)) {
            const firstJpg = resolveAgainst(streamUrl, jpgSegs[0]);
            const liveTs = await segmentLooksLive(firstJpg, headers);
            if (!liveTs) {
                return { quality: 'Auto', heights: [], ok: false, reason: 'jpeg-slideshow' };
            }
            // TS-as-.jpg media playlist — treat as a normal single-variant stream.
            const claimed = parseHeightQuality(streamUrl);
            return {
                quality: claimed || 'Auto',
                heights: claimed ? [parseInt(claimed, 10) || 0].filter(Boolean) : [],
                ok: true
            };
        }

        const lines = body.split(/\r?\n/);
        const variants: Array<{ uri: string; height: number; tiles: boolean }> = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] || '';
            if (!line.trim().startsWith('#EXT-X-STREAM-INF')) continue;
            const uri = (lines[i + 1] || '').trim();
            if (!uri || uri.startsWith('#')) continue;
            const m = line.match(/RESOLUTION=\s*(\d+)x(\d+)/i);
            const w = m ? Number(m[1]) || 0 : 0;
            const h = m ? Number(m[2]) || 0 : 0;
            const fromW = w >= 3800 ? 2160 : w >= 1900 ? 1080 : w >= 1280 ? 720 : w >= 850 ? 480 : w >= 600 ? 360 : 0;
            const bucket = Math.max(h, fromW);
            variants.push({ uri, height: bucket, tiles: isTilesUri(uri) });
        }

        if (variants.length) {
            // Probe each video rung's first segment (cap 4) + default audio.
            const live: Array<{ uri: string; height: number; tiles: boolean; abs: string }> = [];
            for (const v of variants.slice(0, 4)) {
                const abs = resolveAgainst(streamUrl, v.uri);
                if (await mediaPlaylistFirstSegmentLive(abs, headers)) {
                    live.push({ ...v, abs });
                }
            }

            let audioLive = true;
            const audioLine = lines.find(
                (l) =>
                    /#EXT-X-MEDIA:/i.test(l) &&
                    /TYPE=AUDIO/i.test(l) &&
                    /DEFAULT=YES/i.test(l)
            );
            const audioUri = audioLine
                ? /URI\s*=\s*["']([^"']+)["']/i.exec(audioLine)?.[1]
                : undefined;
            if (audioUri) {
                audioLive = await mediaPlaylistFirstSegmentLive(
                    resolveAgainst(streamUrl, audioUri),
                    headers
                );
            }

            if (!live.length) {
                return { quality: 'Auto', heights: [], ok: false, reason: 'dead-segments' };
            }

            const tilesLive = live.find((v) => v.tiles);
            const nonTilesLive = live.filter((v) => !v.tiles);

            // Brand New Day-style: only tiles (muxed TS-as-.png) is live; demuxed
            // 720/480 + audio 404. Hand HLS.js the tiles media playlist directly
            // so it never waits on a broken AUDIO group / dead ABR rungs.
            // BUT: some CDNs ship a ~2min tiles stub (looks like "mock data") —
            // reject short tiles-only ladders so we fall through to another source.
            if (tilesLive && (!nonTilesLive.length || !audioLive)) {
                const tilesProbe = await mediaPlaylistProbe(tilesLive.abs, headers);
                const MIN_MOVIE_SEC = 15 * 60; // 15 minutes
                if (!tilesProbe.live || tilesProbe.durationSec < MIN_MOVIE_SEC) {
                    return {
                        quality: 'Auto',
                        heights: [],
                        ok: false,
                        reason: tilesProbe.durationSec
                            ? `tiles-stub-${Math.round(tilesProbe.durationSec)}s`
                            : 'tiles-dead'
                    };
                }
                return {
                    quality: heightToLabel(tilesLive.height || 1080),
                    heights: [tilesLive.height || 1080],
                    ok: true,
                    playUrl: tilesLive.abs
                };
            }

            const heights = [...new Set(live.map((v) => v.height).filter((h) => h > 0))].sort(
                (a, b) => b - a
            );
            return {
                quality: heightToLabel(heights[0] || live[0].height || 0) || 'Auto',
                heights,
                ok: true
            };
        }

        // Single-variant media playlist with real segments
        if (/#EXTINF/i.test(body) && segmentLines.some((l) => !/\.(jpe?g)(\?|$)/i.test(l))) {
            const claimed = parseHeightQuality(streamUrl);
            const live = await mediaPlaylistFirstSegmentLive(streamUrl, headers);
            if (!live) {
                return { quality: 'Auto', heights: [], ok: false, reason: 'dead-segments' };
            }
            return {
                quality: claimed || 'Auto',
                heights: claimed ? [parseInt(claimed, 10) || 0].filter(Boolean) : [],
                ok: true
            };
        }
        return { quality: 'Auto', heights: [], ok: false, reason: 'no-video' };
    } catch {
        return { quality: 'Auto', heights: [], ok: false, reason: 'probe-error' };
    }
}

export class RivestreamProvider extends BaseProvider {
    readonly id = 'rivestream';
    readonly name = 'Rive';
    readonly enabled = true;
    readonly BASE_URL = SCRAPPER;
    readonly HEADERS = HEADERS;
    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    private async getSources(media: ProviderMediaObject): Promise<ProviderResult> {
        if (!media.tmdbId) {
            return this.empty('Missing tmdbId');
        }
        const key = cacheKey(media);
        const hit = resultCache.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.result;

        try {
            const providers = await this.listProviders();
            const ordered = [
                ...PREFERRED.filter((p) => providers.includes(p)),
                ...providers.filter((p) => !PREFERRED.includes(p))
            ].slice(0, 10);

            const errors: string[] = [];

            // Race subproviders: first provider with playable HLS wins, but we
            // keep *all* of its langs/qualities (Citadel ships EN/HI/TA/TE × 720/480).
            const winnerBatch = await new Promise<
                Array<Source & { _dedupe?: string; _heights?: number[] }> | null
            >((resolve) => {
                let pending = ordered.length;
                let done = false;
                if (!pending) {
                    resolve(null);
                    return;
                }
                ordered.forEach((providerId, idx) => {
                    this.fetchProvider(providerId, media)
                        .then((part) => {
                            if (part.error) errors.push(part.error);
                            if (done) return;
                            if (part.sources.length) {
                                done = true;
                                resolve(part.sources);
                                return;
                            }
                            pending -= 1;
                            if (pending <= 0) resolve(null);
                        })
                        .catch((err) => {
                            errors.push(
                                `${providerId}: ${err instanceof Error ? err.message : 'failed'}`
                            );
                            if (done) return;
                            pending -= 1;
                            if (pending <= 0) resolve(null);
                        });
                    void idx;
                });
            });

            if (!winnerBatch?.length) {
                return this.empty(
                    errors.slice(0, 3).join(' · ') || 'No Rivestream HLS for this title'
                );
            }

            const cleaned = winnerBatch.map((item) => {
                const { _dedupe, _heights, ...clean } = item;
                void _dedupe;
                void _heights;
                return clean;
            });

            const result: ProviderResult = {
                sources: cleaned,
                subtitles: [],
                diagnostics: []
            };
            resultCache.set(key, { expiresAt: Date.now() + RESULT_TTL_MS, result });
            return result;
        } catch (error) {
            return this.empty(error instanceof Error ? error.message : 'Rivestream failed');
        }
    }

    private async listProviders(): Promise<string[]> {
        const via = await fetchTextViaRelay(`${SCRAPPER}/api/providers`, {
            method: 'GET',
            headers: HEADERS,
            preferWorker: true,
            maxWorkers: 3
        });
        if (!via.body) throw new Error(via.error || `providers HTTP ${via.status}`);
        const json = JSON.parse(via.body) as { data?: string[] };
        const list = Array.isArray(json.data) ? json.data.map(String) : [];
        if (!list.length) throw new Error('Empty Rivestream provider list');
        return list.map((p) => p.toLowerCase());
    }

    private async fetchProvider(
        providerId: string,
        media: ProviderMediaObject
    ): Promise<{ sources: Array<Source & { _dedupe?: string; _heights?: number[] }>; error?: string }> {
        const params = new URLSearchParams({
            provider: providerId,
            id: String(media.tmdbId)
        });
        if (media.type === 'tv') {
            params.set('season', String(media.s ?? 1));
            params.set('episode', String(media.e ?? 1));
        }
        const url = `${SCRAPPER}/api/provider?${params}`;
        const via = await fetchTextViaRelay(url, {
            method: 'GET',
            headers: HEADERS,
            preferWorker: true,
            maxWorkers: 2
        });
        if (!via.body) {
            return { sources: [], error: `${providerId}: ${via.error || `HTTP ${via.status}`}` };
        }
        let json: { data?: { sources?: ScrapeSource[] }; sources?: ScrapeSource[]; error?: string };
        try {
            json = JSON.parse(via.body);
        } catch {
            return { sources: [], error: `${providerId}: non-JSON` };
        }
        if (json.error) return { sources: [], error: `${providerId}: ${json.error}` };
        const raw = json.data?.sources || json.sources || [];
        const sources: Array<Source & { _dedupe?: string; _heights?: number[] }> = [];
        const seen = new Set<string>();

        // Probe every row — Citadel returns each language × height as its own URL.
        for (const item of raw.slice(0, 16)) {
            const rawUrl = String(item.url || '').trim();
            if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) continue;
            const unwrapped = unwrapStreamProxy(rawUrl);
            if (/bigtits|tiktokcdn\.com|tiktok\.com\/|musical\.ly|byteicdn\.com|\/api\/decoy\//i.test(unwrapped.url)) continue;
            const claimRaw = String(item.quality || item.source || '');
            const claimed = inferQuality(claimRaw, unwrapped.url);
            const probed = await probeHlsMaster(unwrapped.url, unwrapped.headers);
            if (!probed.ok) continue;

            let quality = probed.quality;
            if (quality === 'Auto') {
                if (claimed !== 'Auto' && !isCdnSlotLabel(String(item.quality || ''))) {
                    quality = claimed;
                } else if (isCdnSlotLabel(String(item.quality || ''))) {
                    quality = 'Auto';
                } else {
                    quality = claimed;
                }
            } else if (/[|·]/.test(claimRaw) || /·/.test(claimed)) {
                // Prefer claim so "720p | Hindi" stays language-tagged for the Languages panel.
                const height = parseHeightQuality(quality) || parseHeightQuality(claimed);
                const lang = languageFromClaim(claimRaw) || languageFromClaim(claimed);
                quality = height && lang ? `${height} · ${lang.label}` : claimed !== 'Auto' ? claimed : quality;
            }

            const playUrl = probed.playUrl || unwrapped.url;
            const dedupe = upstreamDedupeKey(playUrl);
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);

            const lang =
                languageFromClaim(claimRaw) ||
                languageFromClaim(claimed) ||
                languageFromClaim(quality);
            sources.push({
                url: this.createProxyUrl(playUrl, unwrapped.headers),
                type: 'hls',
                quality,
                audioTracks: lang
                    ? [{ label: lang.label, language: lang.language }]
                    : [{ label: 'Original', language: 'Original' }],
                provider: { id: this.id, name: this.name },
                _dedupe: dedupe,
                _heights: probed.heights
            });
        }

        // Highest height first; English before other dubs at the same height.
        sources.sort((a, b) => {
            const ha = Math.max(0, ...(a._heights || []), parseInt(String(a.quality), 10) || 0);
            const hb = Math.max(0, ...(b._heights || []), parseInt(String(b.quality), 10) || 0);
            if (hb !== ha) return hb - ha;
            const la = String(a.audioTracks?.[0]?.language || '');
            const lb = String(b.audioTracks?.[0]?.language || '');
            const eng = (x: string) => (/^english$/i.test(x) ? 0 : 1);
            return eng(la) - eng(lb) || la.localeCompare(lb);
        });
        return { sources }
    }

    private empty(message: string): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: `${this.name}: ${message}`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }
}
