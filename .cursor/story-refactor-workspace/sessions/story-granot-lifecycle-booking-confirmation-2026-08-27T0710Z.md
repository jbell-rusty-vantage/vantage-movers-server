# Session story-granot-lifecycle-booking-confirmation-2026-08-27T0710Z

- Date (UTC): 2026-08-27T0710Z
- Service / module: `granotLifecycle` / `bookingConfirmation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #62 closed)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 59
- Current service / next module (TRAVERSAL): `granotLifecycle` / `bookingConfirmation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/bookingConfirmation.ts` → [recommendations/granot-lifecycle-booking-confirmation.md](../recommendations/granot-lifecycle-booking-confirmation.md)
- operations named: mint the official Booking the owner confirmed — or recognize it already exists; attach this Job to that Booking; after commit, project the Booking Chain onto sheets
- remaining in this service: `bookingOwnerCommands.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `bookingOwnerCommands.ts`

## Messages posted

- 2026-08-27T0710Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists Owner confirm under the Booking-case Service primary code; this file does not open or refresh a case
- `BookingOwnerCommandResult.outcome` includes update / Referral / No Action; this file only returns `booking_created` or `already_satisfied`
- After-commit remap treats any non-`already_satisfied` resolution as `booking_created`
- Outer 11000 retry wraps an executor that already handles 11000
- Confirm is not on `canonicalDomainCommands`
- `bookingConfirmation.replica.test.ts` also seeds update / No Action from the next module
- This checkout’s `CONTEXT.md` does not define Granot Booking Reconciliation Case
