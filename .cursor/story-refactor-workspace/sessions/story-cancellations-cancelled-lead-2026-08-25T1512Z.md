# Session story-cancellations-cancelled-lead-2026-08-25T1512Z

- Date (UTC): 2026-08-25T15:12Z
- Service / module: `cancellations` / `cancelledLead.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/23

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 2 / 0 / 36
- Recommendations on disk: 19 (`form-lead.md`, twelve `leads-*.md`, seven `bookings-*.md`)
- Current service / next module (TRAVERSAL): `bookings` (visited) / next service `cancellations` (unvisited — enumerate on first open)

## This pass

- opened new service?: yes — `cancelledLead.service.ts`, `cancellationResolver.ts`, `cancellationMirror.service.ts`, `index.ts` (skip — barrel)
- path or skip: recommended → `recommendations/cancellations-cancelled-lead.md`
- operations named: Cancel this Booking / Cancel a verified Booking / Correct this Cancellation / List recent Cancellations / Remove this Cancellation
- remaining in this service: `cancellationResolver.ts`, `cancellationMirror.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 2 / 1 / 35
- Current service / next module: `cancellations` (in-progress) / `cancellationResolver.ts`

## Messages posted

- 2026-08-25T1512Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge HTTP table names leftover CRUD; routes use command adapters. Leftover `cancellation.created` vs command sheets-only. Split public 409 copy. Body `ingestion_source` vs command provenance for `allowLeadless`. See CONTRADICTIONS.md.
