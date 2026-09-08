# Session story-employee-bookings-submit-employee-booking-2026-09-08T2312Z

- Date (UTC): 2026-09-08
- Service / module: `employeeBookings` / `submitEmployeeBooking.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 0 / 8
- Recommendations on disk: 253 (through `best-relocation-sheet-ingest-dry-run-reports.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (unvisited) / enumerate

## This pass

- opened new service?: yes — listed 13 folder modules; skipped `types.ts` (type-only), `index.ts` (barrel), `getEmployeeBookingOptions.service.ts` (options catalog), `employeeBookingPreparation.ts` (prepare helper)
- path or skip: recommended → `recommendations/employee-bookings-submit-employee-booking.md`
- operations named: throttle the public form; hand back the same confirmation; refuse when that Job is already booked; book the employee Job (linked claim + Booking Chain, or leadless Owner case + Master Booked)
- remaining in this service: `leadCandidateQueries.ts`, `leadMatchEvaluator.ts`, `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `leadCandidateQueries.ts`

## Messages posted

- 2026-09-08T2312Z next

## Ideas parked

- none

## Contradictions

- Zero tests import `submitEmployeeBooking`; route test only asserts the path
- Linked ending mutates `matchOutcome` and falls through into the pending write
- Submission and Job uniqueness each checked three times (preflight, in-tx, 11000)
- Catch path `.select("_id")` then `.select("_id is_leadless_booking")`
- Call `created_on_unmatched` at claim time stores reason `no_match`
- This file never calls `createLeadlessBooking` / `createBookedLead` / a Domain Command
- Sheet resource is `booking_chain` when linked and `booked_lead` when pending
- Case `origin` is the model default; this file never writes it
- Throttle config lives on `bookingReconciliation.ts` next to rematch
