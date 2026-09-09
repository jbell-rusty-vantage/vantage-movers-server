# Session story-employee-bookings-migration-preflight-2026-09-09T0609Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `migrationPreflight.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 260 (through `employee-bookings-reconciliation-rematch.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `migrationPreflight.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-migration-preflight.md`
- operations named: inspect already-loaded identities (Job stamp on every Booking, trimmed submission id on employee Jobs, Lead / channel inventory); refuse the lock when a Booking identity collision exists
- remaining in this service: `migrationApplySafety.ts`

## Stock at end

- Visited / in-progress / unvisited: 30 / 1 / 7
- Current service / next module: `employeeBookings` (in-progress) / `migrationApplySafety.ts`

## Messages posted

- 2026-09-09T0609Z next

## Ideas parked

- none

## Contradictions

- Report and gate have no runtime caller; inventory only borrows the grouper
- Job collisions use live `normalizeJobNo(job_no)`, not stored `normalized_job_no`
- Job collisions are every Booking; submission collisions are employee origin only
- Prefix twins are the same Job for Granot identity and not a collision here
- Call / Form / channel lists never refuse
- `invalidSourceChannels` is likely dead on typed `LeadSourceCompanyItem` (unknown folds to form); options now drop Registry non-form/call
