# VAPlayer missing for 1423191 (Resident Evil 2026)

## What happened
Cold unlock for this title took ~66s (captcha lane busy / 429 contention). The Sources UI gives up sooner, so VAPlayer looked like it “didn’t return.”

A bad helper also forced `?refresh=1` via `sessionStorage` (`va-dead:…`), which skipped cache and reminted every time → same timeout.

## Fix
- Ensured disk cache is populated (3 streams, title ok).
- Removed `va-dead` → forced refresh from the live client chunk.
- Removed unlock empty→force-retry loop that piled remints under load.
- Cache hits now ~5–15ms for `1423191`.

## User
Hard-refresh embed (`pcv=…vafix`) and open Sources again — VAPlayer should appear instantly from cache.
