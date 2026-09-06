# Session story-reporting-promotion-reservation-2026-09-06T2311Z

- Date (UTC): 2026-09-06T23:11:00Z
- Service / module: `reporting` / `promotionReservation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/203

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 1 / 10
- Recommendations on disk: 208 (`form-lead.md` through `reporting-promotion.md`)
- Current service / next module (TRAVERSAL): `reporting` / `promotionReservation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/reporting/promotionReservation.ts` → `recommendations/reporting-promotion-reservation.md`
- operations named: say whether we reserve fresh, adopt a swap Google already did, reuse our own reservation, or take over a dead owner; write the reservation onto the run while the lease still holds; mark applied after Google swapped; point the destination at the new sheet and complete the run in one transaction; say whether a transaction error may retry
- remaining in this service: `snapshotAdapter.ts` first, then leftover observability / leftover cleanup / leftover ownership / leftover registry filters / leftover `google/*` adapters / leftover `live/*` harness

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` / `snapshotAdapter.ts`

## Messages posted

- 2026-09-06T2311Z next-run

## Ideas parked

- none

## Contradictions

- none
