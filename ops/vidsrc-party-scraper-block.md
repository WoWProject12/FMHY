# to.vidsrc.party scraper block (2026-11-16)

## What they were doing
IP **`88.218.196.122`** hit chillflix.pw APIs at high volume
(`/api/cinepro/sources`, `/api/playback/vaplayer-resolve`, …) while **forging**
`Referer` / `parent_origin` as chillflix.pw / chillflix.lol so playback-guard
passed.

That is API stream theft, not a normal embed — Embedders → Block alone would not
stop them.

## Live actions taken
1. **IP block** `88.218.196.122` → playback APIs return **403 Access denied**
   (even with forged chillflix Origin/Referer).
2. **Host advertise gate** `to.vidsrc.party` / `vidsrc.party` (+ www) →
   `gate-check` returns `gate:true` → embed-beacon shows **Watch free on Chillflix**
   (CTA → `https://www.chillflix.lol`) and kills iframe playback.
3. Widened MySQL `site_settings.setting_value` to **MEDIUMTEXT** (IP blocklist had
   hit the old TEXT 64KB ceiling).

## How Block works now (admin)
| Where | Click | Effect |
|---|---|---|
| **Embedders → Block** | Host | Chillflix ads/watch gate on that host. Prompt asks for scraper IP → also denies streams. |
| **Stream theft → Hot IPs → Block** | IP | Denies real streams. Prompt asks for site host → also force-gates Chillflix ads. |

Combined API: `POST /api/internal/scrape-intel` `{ action: "blockIp", ip, host? }`.

## Notes
- Advertise only reaches *viewers* if their site still loads our `/embed` (or
  similar). Pure server-side scrapers just get empty/403 APIs after IP block.
- Hard-refresh admin (`admin.js?v=vidsrcblock1`) to get the new prompts.
