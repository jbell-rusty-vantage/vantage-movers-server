# Session story-employee-bookings-migration-apply-safety-2026-09-09T0711Z

- Date (UTC): 2026-09-09
- Service / module: `employeeBookings` / `migrationApplySafety.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 30 / 1 / 7
- Recommendations on disk: 261 (through `employee-bookings-migration-preflight.md`)
- Current service / next module (TRAVERSAL): `employeeBookings` (in-progress) / `migrationApplySafety.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/employee-bookings-migration-apply-safety.md`
- operations named: say whether someone asked to write (`--apply` only); refuse a live-database write unless the two live keys and the connected name agree (test lab on `testvantagemovers` may write; incidental `--apply` is not live authorization)
- remaining in this service: none — service visited

## Stock at end

- Visited / in-progress / unvisited: 31 / 0 / 7
- Current service / next module: `domainCommands` (unvisited) / enumerate

## Messages posted

- 2026-09-09T0711Z next

## Ideas parked

- none

## Contradictions

- File lives under `employeeBookings` and has no employee-booking caller; four Registry CLIs import it
- the live-db confirm-token constant is duplicated on this file and the Registry migration / inventory libs
- Granot `--confirm=<name>` is a different flag shape from `--confirm-<live>-db=vantagemovers`
- Sibling `assertMigrationDatabaseAllowed` refuses historical for a look; this file only refuses a live write
- `historicalConsolidation/targetGuard.ts` is a heavier apply story and must stay separate
