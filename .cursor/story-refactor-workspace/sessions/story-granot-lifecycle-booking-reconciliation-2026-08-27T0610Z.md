# Session story-granot-lifecycle-booking-reconciliation-2026-08-27T0610Z

- Date (UTC): 2026-08-27T0610Z
- Service / module: `granotLifecycle` / `bookingReconciliation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #61 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 58
- Current service / next module (TRAVERSAL): `granotLifecycle` / `bookingReconciliation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/bookingReconciliation.ts` → [recommendations/granot-lifecycle-booking-reconciliation.md](../recommendations/granot-lifecycle-booking-reconciliation.md)
- operations named: decide whether this Booked Observation needs Owner work; open or refresh the one open Booking case for this Job; after the owner fixes a discrepancy, open or refresh the same case inside their transaction; show the owner which Leads this case may attach
- remaining in this service: `bookingConfirmation.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `bookingConfirmation.ts`

## Messages posted

- 2026-08-27T0610Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists Owner confirm / update / Referral mint as this file’s primary code; this file only re-exports them
- Knowledge lists this file under processor primary code; this file does not `$set` a Lead or write `BookedLead`
- `priority_5_existing_booking` is dead after the early `not_booking_evidence` return; `priority_5_ineligible_target` is unused
- Local unused `maskLifecycleId`; observability remaps `booking_case_opened` → `booking_case.opened`
- `src/config/domain/bookingReconciliation.ts` is employee rematch, not this module
- This checkout’s `CONTEXT.md` does not define Granot Booking Reconciliation Case
