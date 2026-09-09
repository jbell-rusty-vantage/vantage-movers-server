# Session story-domain-commands-bookings-2026-09-09T1411Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `bookings.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 268 (through `domain-commands-existing-writes.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `bookings.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-bookings.md`
- operations named: replace this official Booking by exact revision; attach this Leadless Booking to the named Lead
- remaining in this service: none (`domainCommands` visited)

## Stock at end

- Visited / in-progress / unvisited: 32 / 0 / 6
- Current service / next module: `durableWork` (unvisited — enumerate first)

## Messages posted

- 2026-09-09T1411Z next

## Ideas parked

- none

## Contradictions

- File comment claims Owner review composes this primitive; it reimplements
- Registry `updateBooking` has no live HTTP caller
- `officialFieldsMoved` lives outside the operation
- Raw `Error` strings vs typed `DomainRevisionConflictError`
- Exact replace does not mirror Lead deposit flags
