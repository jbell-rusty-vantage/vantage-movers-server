# Session story-domain-commands-existing-writes-2026-09-09T1312Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `existingWrites.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 267 (through `domain-commands-existing-write-context.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `existingWrites.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-existing-writes.md`
- operations named: ingest this public Lead (Form / Call); correct this source-owned Lead; book (this Lead / from source / without a Lead / public Referral); cancel this public Booking; correct this public Booking or Cancellation; remove this public record
- remaining in this service: `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `bookings.ts`

## Messages posted

- 2026-09-09T1312Z next

## Ideas parked

- none

## Contradictions

- Shared persisted `createBookingFromLead` for direct and from-source
- Replay HTTP `data` can be undefined / null
- Form `expected` unused by current v1 PATCH
