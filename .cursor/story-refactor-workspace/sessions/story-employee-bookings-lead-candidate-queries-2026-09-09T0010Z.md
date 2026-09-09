# Session story-employee-bookings-lead-candidate-queries-2026-09-09T0010Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `leadCandidateQueries.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 254 (through `employee-bookings-submit-employee-booking.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `leadCandidateQueries.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-lead-candidate-queries.md`
- operations named: assemble the auto-match candidate set; copy the Lead contact the owner should see
- remaining in this service: `leadMatchEvaluator.ts`, `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `leadMatchEvaluator.ts`

## Messages posted

- 2026-09-09T0010Z next

## Ideas parked

- none

## Contradictions

- Any lookup overflow (`hasOverflow`) blocks every auto-match rule, including unique LID
- Name lookup is gated on email; name-method drop only applies to a first insert via name
- Call Job find is exact `normalized_job_no`, not the Granot prefix-aware filter
- Email find is raw `email`; phone uses normalized plus digit-fuzzy regex
- This finder does not search Granot / ingested snapshot paths; Owner search does
- Confidence is stored on the card; the matcher reads methods / eligibility / source fit / overflow
- `toPublicLeadContactSnapshot` has no external caller
