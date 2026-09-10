# Session story-legacy-root-enumerate-2026-09-10T1916Z

- Date (UTC): 2026-09-10
- Service / module: `legacy-root` / enumerate (thin leftover-root skip)
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 37 / 0 / 1
- Recommendations on disk: 296 (through `moving-carriers-granot-carrier-code-seed.md`)
- Current service / next module (TRAVERSAL): `legacy-root` (unvisited) / enumerate first

## This pass

- opened new service?: yes — leftover files on `src/services/` itself enumerated: `v1.service.ts` (skip — facade), `v1ServiceError.ts` (skip — leftover error), `formLeadSearch.service.ts` (skip — facade), `callLeadSearch.service.ts` (skip — facade), `crm.service.ts` (skip — facade), `googleSheets.service.ts` (skip — facade), `callLeadEnrichment.service.ts` (skip — facade), `bookedCallLeadReconciliation.service.ts` (skip — facade). Tests `v1.service.test.ts` / `v1ServiceError.test.ts` are evidence, not checklist rows.
- path or skip: thin leftover-root skip — no recommendation file
- operations named: none. The v1 barrel re-exports already-visited leads / bookings / cancellations / customers / sheet-sync plus leftover `V1ServiceError` (status → `ERROR_CODES`). The other six files re-export already-visited search / CRM / sheets / enrichment / reconciliation. That is not ingest / correct / post / sync / book / cancel / reconcile / drain / claim.
- remaining in this service: none (`legacy-root` visited)

## Stock at end

- Visited / in-progress / unvisited: 38 / 0 / 4
- Current service / next module: `conversations` (unvisited — enumerate first)

## Messages posted

- 2026-09-10T1916Z next

## Ideas parked

- Listed Wave A rows 1–38 are `visited`. Rows 39–42 (`conversations`, `extensionUsers`, `jobNumberTimeline`, `tariff`) were added as unvisited so Stock matches disk. Enumerate them before Wave B. Do not jump an in-progress checklist.

## Contradictions

- `v1.service.test.ts` still proves `refreshAttachedBookingFromLead` through the leftover facade; the write lives in already-recommended booking-mirror
- Knowledge `customer.md` says `customer.service.ts` must import `deleteBookedLead` through `v1.service` to break bookings ↔ customers; do not delete the leftover barrel
- `pickCodeForStatus` is a one-line pass-through to `codeFromStatus` (401 / 404 / 409 / ≥500 / else BAD_REQUEST)
- Routes (`v1.routes.ts`, extension apply test) and some services still import the leftover search / enrichment / reconciliation / sheets facades; new code in those folders already **asks** the dedicated barrels
- This checkout’s `CONTEXT.md` does not define leftover-root; `docs/adr/` is absent
