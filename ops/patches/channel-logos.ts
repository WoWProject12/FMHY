import { readFileSync, existsSync } from "fs"
import path from "path"

type LogoMap = { tvg: Record<string, string>; brand: Record<string, string> }

let cached: LogoMap | null = null

function loadMap(): LogoMap {
  if (cached) return cached
  const candidates = [
    "/var/www/chillflix-lol-toflix/public/new/assets/data/iptv-tvg-logos.json",
    path.join(process.cwd(), "public/iptv-tvg-logos.json"),
  ]
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue
      cached = JSON.parse(readFileSync(p, "utf8")) as LogoMap
      return cached
    } catch {
      /* try next */
    }
  }
  cached = { tvg: {}, brand: {} }
  return cached
}

function norm(s: string) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function resolveChannelLogo(input: {
  name?: string
  tvgId?: string
  logo?: string
  country?: string
}): string {
  const map = loadMap()
  const tvg = String(input.tvgId || "").trim()
  if (tvg && map.tvg[tvg]) return map.tvg[tvg]
  if (tvg) {
    const lower = tvg.toLowerCase()
    for (const [k, v] of Object.entries(map.tvg)) {
      if (k.toLowerCase() === lower) return v
    }
  }
  const name = String(input.name || "").toLowerCase()
  const brandRules: Array<[RegExp, string]> = [
    [/^canal\s*\+|^canal\s*plus|^canal\s*sport|^canal\s*action|^canal\s*ligue|^canal\s*360|canal\s*\+/, "canal+"],
    [/^a\s*\+\s*ivoire/, "a+ ivoire"],
    [/^a\s*\+/, "a+"],
    [/^a\s*la\s*carte/, "a la carte"],
    [/^infosport/, "infosport"],
    [/^nollywood/, "nollywood"],
    [/^13\s*eme\s*rue|^13ème/, "13eme rue"],
    [/^action\b/, "action"],
    [/^bein\s*sports?|^beinsports/, "bein sports"],
    [/^cinedome/, "cinedome"],
    [/^tf1\b/, "tf1"],
    [/^france\s*24/, "france 24"],
    [/^rtl\s*2|^rtl2/, "rtl2"],
    [/^rtl\b/, "rtl"],
    [/^mangas\b/, "mangas"],
    [/^cine\s*\+|^cineplus/, "cine+"],
    [/^dazn\b/, "dazn"],
    [/amazon|prime\s*video/, "amazon prime"],
    [/^blue\s*tv|^bluetv|^blutv/, "bluetv"],
  ]
  const cleaned = name
    .replace(/\s*[(\[]\s*#?\d+\s*[)\]]\s*$/u, "")
    .replace(/\b(HD|FHD|HEVC|SD|4K|UHD|H265)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  for (const [re, key] of brandRules) {
    if (re.test(cleaned) && map.brand[key]) return map.brand[key]
  }
  const huhu = String(input.logo || "").trim()
  if (/^https?:\/\//i.test(huhu) && !/huhu\.to\/live2\/logo/i.test(huhu)) return huhu
  return ""
}

export function withResolvedLogos<T extends { name?: string; tvgId?: string; logo?: string; country?: string }>(
  channels: T[]
): T[] {
  return channels.map((ch) => {
    const logo = resolveChannelLogo(ch) || ch.logo || ""
    return logo && logo !== ch.logo ? { ...ch, logo } : { ...ch, logo: logo || ch.logo }
  })
}
