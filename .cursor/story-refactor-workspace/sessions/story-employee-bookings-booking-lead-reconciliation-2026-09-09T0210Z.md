# Session story-employee-bookings-booking-lead-reconciliation-2026-09-09T0210Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `bookingLeadReconciliation.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 256 (through `employee-bookings-lead-match-evaluator.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `bookingLeadReconciliation.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-booking-lead-reconciliation.md`
- operations named: browse the Owner cases; search any known contact; refresh the cards without claiming; correct the pending Job; work the Owner case (dismiss / attach / mint / reassign); reopen for inspection
- remaining in this service: `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `bookingLeadAttachment.service.ts`

## Messages posted

- 2026-09-09T0210Z next

## Ideas parked

- none

## Contradictions

- Refresh / correct-pending / reopen record a `linked` matcher decision and do not claim
- Refresh never overwrites `reason`; correct-pending and reopen overwrite only when still `pending`
- Owner any-known-contact search includes Granot / ingested paths; auto-match finder does not
- `persist*` and `InTransaction` are the same begin function; HTTP resolve is the after-commit adapter
- Canonical `attachBookingToLead` cannot send warning overrides or `source_resolution`
- Reopen clears the rematch lease so a cancelled Booking cannot re-enter the cron
- Correct-pending stores the attempt trigger as `owner_refresh`
- List origin filter can be import; missing stored origin still displays `employee_booking`
