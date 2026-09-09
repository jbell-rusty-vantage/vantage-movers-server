# Session story-employee-bookings-reconciliation-policy-2026-09-09T0411Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `reconciliationPolicy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 258 (through `employee-bookings-booking-lead-attachment.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `reconciliationPolicy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-reconciliation-policy.md`
- operations named: say who is speaking as this employee-Job Owner; refuse unless the Owner named every overrideable warning exactly; refuse unless this case status allows this act; refuse unless this live Booking allows this act
- remaining in this service: `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `reconciliationRematch.service.ts`

## Messages posted

- 2026-09-09T0411Z next

## Ideas parked

- none

## Contradictions

- Case status and live Booking are two axes; both can refuse an act the other allows
- Correct-pending skips the case-status assert; refresh never asks this file
- Mint never asks for warning overrides; command attach cannot send them
- Hard-block codes stay known and are not overrideable; unknown strings drop
- Extension Owner stamps `owner:<userId>`; header Owner stamps `owner:<email>`
- This gate is not Registry HMAC; Sheet Contains reuses the same speaker
- `applyCursorFilter` is unused at runtime; browse pages in Mongo
