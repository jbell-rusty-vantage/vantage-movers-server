# Session story-granot-lifecycle-booking-priority-pairing-2026-08-27T0910Z

- Date (UTC): 2026-08-27T0910Z
- Service / module: `granotLifecycle` / `bookingPriorityPairing.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/65

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 61
- Current service / next module (TRAVERSAL): `granotLifecycle` / `bookingPriorityPairing.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/bookingPriorityPairing.ts` → [recommendations/granot-lifecycle-booking-priority-pairing.md](../recommendations/granot-lifecycle-booking-priority-pairing.md)
- operations named: say how Priority 5 sits next to this Booked Observation; put that pairing on the wire; fold that pairing into a list pill
- remaining in this service: `referralBooking.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `referralBooking.ts`

## Messages posted

- 2026-08-27T0910Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists this file on both `booking-reconciliation.md` and `projections.md`; this file neither persists a case nor builds list/detail
- `later_priority_5` is computed here; persist drops it; list recomputes later itself
- `booked_without_priority_5` still names a preceding Priority 5 when one exists
- `projectBookingPriorityPairing` names a DTO fold and the classify
- Pairing is computed twice (creating-observation + case detail)
- `isCanonicalPriorityFive` is exported and unused outside this file
- This checkout’s `CONTEXT.md` does not define Booking Priority Pairing
