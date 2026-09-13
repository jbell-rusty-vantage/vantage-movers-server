# Session story-models-granot-release-reconciliation-case-2026-09-13T1718Z

- Date (UTC): 2026-09-13T1718Z
- Service / module: `models` / `GranotReleaseReconciliationCase.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 364
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotReleaseReconciliationCase.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-release-reconciliation-case.md](../recommendations/models-granot-release-reconciliation-case.md)
- operations named: hold one append-only historical Owner Release work case (not a Cancellation); allow only open refresh through guarded `$push` and resolve through open plus `case_revision` (refuse rewrite, replace, reopen; no delete hook); bind the selected Mongo database and declare the five named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence. Required `deterministic_booking_id` + `booking_revision_at_open`. No persisted `mode`. Live processor no longer opens this collection.
- remaining in this service: `GranotBookingDiscrepancy.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotBookingDiscrepancy.ts`

## Messages posted

- 2026-09-13T1718Z next

## Ideas parked

- none

## Contradictions

- Five named indexes; Booking case has six (includes `evidence.observation_id`)
- Required Booking id + `booking_revision_at_open`; Booking case optional Booking id
- No persisted `mode`; projections invent `mode: "release"`
- No mongoose delete hook; Decision / activation clock refuse delete
- `resolution.entity_ref.id` is a string; suggestion id is ObjectId
- Unique is exact Job while open; Job Timeline hops prefix-equivalent Jobs as `cancellation_intake`
- Wave A persist rec still describes processor invoke; live processor must not call `reconcileRelease`
- schema-and-crud names the Booking case and omits this collection
- Leftover next GranotBookingDiscrepancy.ts is a different row — do not copy this Release-case catalog onto it without reading it
