# Session story-models-granot-booking-reconciliation-case-2026-09-13T1608Z

- Date (UTC): 2026-09-13T1608Z
- Service / module: `models` / `GranotBookingReconciliationCase.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 363
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotBookingReconciliationCase.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-booking-reconciliation-case.md](../recommendations/models-granot-booking-reconciliation-case.md)
- operations named: hold one append-only Owner Booking work case (not a Booking); allow only open refresh through guarded `$push` and resolve through open plus `case_revision` (refuse rewrite, replace, reopen; no delete hook); bind the selected Mongo database and declare the six named indexes with partial unique open `{ normalized_job_no, action_kind }` plus unique sequence
- remaining in this service: `GranotReleaseReconciliationCase.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotReleaseReconciliationCase.ts`

## Messages posted

- 2026-09-13T1608Z next

## Ideas parked

- none

## Contradictions

- Knowledge says three additional read indexes; disk has four (includes `evidence.observation_id`)
- `resolution.entity_ref.id` is a string; `suggested_lead.lead_ref.id` is an ObjectId
- No mongoose delete hook; Decision / activation clock refuse delete
- Unique is exact Job while open; Job Timeline hops prefix-equivalent Jobs
- Leftover next GranotReleaseReconciliationCase.ts is a different row — do not copy this Booking-case catalog onto it without reading it
