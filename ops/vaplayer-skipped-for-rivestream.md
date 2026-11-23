# VAPlayer skipped in auto for RiveStream — 2026-11-16

## Why it looked wrong
Sources order is `vaplayer → 7movies → rivestream → …` and manual VAPlayer
plays. Auto still jumped to RiveStream.

## Cause
1. **RiveStream is a fast CinePro/server scrape**, not client-resolve.
2. `shouldHoldForHigherRankedProviders` only held Huhu/Flix/etc. Automatic
   server scrapes (RiveStream) were free to auto-start.
3. `sourcesHavePreferredAutoStartProvider` treated any non-hold row as
   preferred — so a RiveStream URL counted as “good enough” and discovery
   stopped waiting on VAPlayer #1.
4. VAPlayer needs `clientResolved` (unlock ~seconds). While it was still
   pending, auto mounted RiveStream.

Manual tap runs `requestProvider(vaplayer)` and plays — order was never the bug.

## Fix
- Hold **all** non-client-resolve scrapes behind higher client-resolve.
- Preferred auto-start only counts **resolved** client-resolve rows.

Hard-refresh after `pcv=20261116014146vahold` (embed + player restart).
