# Session story-reconciliation-booked-call-lead-2026-08-26T0712Z

- Date (UTC): 2026-08-26T07:12Z
- Service / module: `reconciliation` / `bookedCallLeadReconciliation.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after this commit)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 10 / 0 / 28
- Recommendations on disk: 35 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`, three `cancellations-*.md`, two `customers-*.md`, two `agents-*.md`, `lead-source-companies-lead-source-company.md`, `cpl-cpl-rate.md`, `catalog-catalog.md`, four `search-*.md`, two `enrichment-*.md`)
- Current service / next module (TRAVERSAL): `reconciliation` (unvisited) / enumerate `src/services/reconciliation/`

## This pass

- opened new service?: yes — modules enumerated (`bookedCallLeadReconciliation.service.ts`, `bookedCallLeadRows.ts`, `index.ts` barrel)
- path or skip: recommended → `recommendations/reconciliation-booked-call-lead.md`
- operations named: Show what this Booked Jobs row would refresh on a Call Lead and Booking; Refresh the Call Lead and Booking from this Booked Jobs row
- remaining in this service: `bookedCallLeadRows.ts`

## Stock at end

- Visited / in-progress / unvisited: 10 / 1 / 27
- Current service / next module: `reconciliation` (in-progress) / `bookedCallLeadRows.ts`

## Messages posted

- 2026-08-26T0712Z next-run

## Ideas parked

- none

## Contradictions

- `/booked-reconciliation/sync` is Owner receipt apply, not `syncBookedCallLeadReconciliation`. CSV is the remaining write helper. Identity/receiver drift options have no current caller. Sheet Sync is after-commit `schedule*`, not persist-intent. CPL runs on every lead patch. `booking_missing` is unused. See CONTRADICTIONS.md.
