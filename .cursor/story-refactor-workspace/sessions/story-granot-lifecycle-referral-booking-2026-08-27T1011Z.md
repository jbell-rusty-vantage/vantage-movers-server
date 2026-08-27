# Session story-granot-lifecycle-referral-booking-2026-08-27T1011Z

- Date (UTC): 2026-08-27T1011Z
- Service / module: `granotLifecycle` / `referralBooking.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #65 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 62
- Current service / next module (TRAVERSAL): `granotLifecycle` / `referralBooking.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/referralBooking.ts` → [recommendations/granot-lifecycle-referral-booking.md](../recommendations/granot-lifecycle-referral-booking.md)
- operations named: mint the no-Lead Referral the owner authorized; attach this Job to that Referral Booking; after commit, project the Master Booked sheet
- remaining in this service: `releaseReconciliation.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `releaseReconciliation.ts`

## Messages posted

- 2026-08-27T1011Z next

## Ideas parked

- none

## Contradictions

- Same English name as public `createReferralBooking` / `createExistingReferralBooking`
- Registry adapter never finalizes sheets; admin mint does
- Knowledge lists this file as primary code on `booking-reconciliation.md`; this file does not persist a case
- `is_leadless_booking` is false with no Lead
- `BookingOwnerCommandResult` still lives on `bookingConfirmation.ts`
- This checkout’s `CONTEXT.md` does not define Referral Booking
