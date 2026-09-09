# Session story-employee-bookings-reconciliation-rematch-2026-09-09T0511Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `reconciliationRematch.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 259 (through `employee-bookings-reconciliation-policy.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `reconciliationRematch.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-reconciliation-rematch.md`
- operations named: hold the one rematch drain; retry each due pending case (operational matcher again, auto-attach without rewriting Source, or schedule the next delay / stop); project attached rows after commit
- remaining in this service: `migrationPreflight.ts`, `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `migrationPreflight.ts`

## Messages posted

- 2026-09-09T0511Z next

## Ideas parked

- none

## Contradictions

- Route and service both refuse when rematch is off
- Default rematch list is only `matching_unavailable`; a later `no_match` stops the clock
- Delay index is `attempt_count` after increment (submit used `delays[0]`)
- Already-attached or cancelled Booking clears retry and does not resolve the case
- Finish event key says `resolved`; summary is drain completed
- `preparedFromCase` / hash copies live on the desk; rematch bag has empty local and allocations
