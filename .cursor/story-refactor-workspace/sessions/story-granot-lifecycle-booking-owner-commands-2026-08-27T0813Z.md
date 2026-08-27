# Session story-granot-lifecycle-booking-owner-commands-2026-08-27T0813Z

- Date (UTC): 2026-08-27T0813Z
- Service / module: `granotLifecycle` / `bookingOwnerCommands.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/64

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 60
- Current service / next module (TRAVERSAL): `granotLifecycle` / `bookingOwnerCommands.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/bookingOwnerCommands.ts` → [recommendations/granot-lifecycle-booking-owner-commands.md](../recommendations/granot-lifecycle-booking-owner-commands.md)
- operations named: replace official fields on the Booking this case already named — or recognize they already match; close the case without writing a Booking; after commit, project sheets only when official fields actually changed
- remaining in this service: `bookingPriorityPairing.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `bookingPriorityPairing.ts`

## Messages posted

- 2026-08-27T0813Z next

## Ideas parked

- none

## Contradictions

- Same persisted command name `updateBooking` as `domainCommands/bookings.ts`; this file is the case-owned Owner review, not the registry primitive
- Knowledge’s first No Action sentence omits `create_referral_booking`; the later Referral paragraph and the code accept it
- Knowledge lists this file under the Booking-case Service primary code; this file does not open or refresh a case
- `BookingOwnerCommandResult` still lives on `bookingConfirmation.ts`
- `reloadResult` remaps any leftover resolution to `no_action`
- `noAction` export name is shared with Release and discrepancy modules; persisted names already differ
- A Lead-only threshold repair still `$set`s the Booking
- Leadless non-Referral Booking is `IDENTITY_CONFLICT`; a later intake spec wants that refuse dropped
- Replica proof lives in `bookingConfirmation.replica.test.ts` and `referralBooking.replica.test.ts`
- This checkout’s `CONTEXT.md` does not define Update Existing Booking / No Action
