# 7Movies “starts then disappears” (2026-11-15)

## Cause
Player preferred **English = Orion Original HLS**, which is **HEVC-only**. Chrome MSE starts the source then fails (0 levels) → health marks failed → Sources row vanishes.

## Fix (live)
- When mapping 7Movies languages, **prefer MP4 rows only** if any exist; keep HEVC HLS only as last resort.
- Among 7Movies rows, sort **mp4/file before** English preference.
- Follow-up: do **not** drop non-MP4 languages from the sheet (that left “only Russian”). Keep all langs; only change **autoselect** to prefer MP4 (see `7movies-russian-only-fix.md`).
- Cache bust `…7mnodissap`.

Hard refresh, then pick 7Movies again (may show a dub language first — that is intentional so it actually plays).
