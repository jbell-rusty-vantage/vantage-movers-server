# CSI-09 intake — September 19, 2026

Coverage/settings and existing Lead-detail entry. No CSI-14 dialogs, CSI-15/16, live send, flag enablement, or official `migration:csi:indexes`.

| Contract | Executable starting state | Required work |
| --- | --- | --- |
| GET `/coverage` | CSI-04/11 capture subset via `readCaptureCoverage` (`known_through`, gaps, capabilities, `ai_paused`, CSI-11 `recordings`) | Full 04/05 DTO: watermark/gaps, recording/STT/analysis/application stage counts, oldest queued age, failures/retry, mapping hygiene, active flags/models, budget actual/reserved/remaining, current settings. Denied ≠ unavailable ≠ unknown ≠ zero. Reuse stored CSI-11 recording counters. |
| GET/PATCH `/settings` | `resolvePolicy` / `updateCsiPolicy` / `initializeCsiPolicy` exist; unused by Owner HTTP | Versioned policy, CAS, audit. GET never writes. Env bootstraps first persist only; later Owner edits win. `csiFlag` kill switches displayed, not PATCH-able. |
| Scope | Existing Owner guard + `assertCurrentScope` | Keep `scope=production` only. Reject historical/combined. |
| Admin fourth view | `SiView` is attention\|numbers\|reps | Coverage view + settings editor for accepted NY Mon–Sat 08:00–20:00 defaults. Honest empty/unknown/denied. Live invalidation refetch. Hide anything the server does not return. |
| Lead entry | SI can link out via `officialRecordHref`; Lead/Call Lead pages have no SI entry | Existing official-record helper into matching Number/Outreach. No new CRM. |
| Backfill | POST `/backfill` catalogued, not implemented | Display/honesty only: Owner-triggered and not yet available. Not CSI-15 execution. |

Verified remotes `jbell-rusty-vantage`. Work on `main` because it already contains the `sales-intelligence` merge. Isolated preview remains 3107/3108 + replica `127.0.0.1:27189` + DBs `testvantagemovers_csi07preview` + `vantage_admin_csi07_preview`.
