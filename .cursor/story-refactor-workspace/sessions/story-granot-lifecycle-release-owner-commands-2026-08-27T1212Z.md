# Session story-granot-lifecycle-release-owner-commands-2026-08-27T1212Z

- Date (UTC): 2026-08-27T1212Z
- Service / module: `granotLifecycle` / `releaseOwnerCommands.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/68

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 64
- Current service / next module (TRAVERSAL): `granotLifecycle` / `releaseOwnerCommands.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/releaseOwnerCommands.ts` → [recommendations/granot-lifecycle-release-owner-commands.md](../recommendations/granot-lifecycle-release-owner-commands.md)
- operations named: cancel the Booking this Release case already named (or recognize already cancelled); replace official fields on that Booking (or recognize they already match); close the case with no official write; after commit, project sheets only when something official changed
- remaining in this service: `discrepancies.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `discrepancies.ts`

## Messages posted

- 2026-08-27T1212Z next

## Ideas parked

- none

## Contradictions

- This `createCancellation` is not the public / registry adapter
- This `updateBooking` is the third `updateBooking` (registry + Booking-case review)
- Public cancel 409s Referral; this file cancels it with no Lead
- Knowledge lists this beside `releaseReconciliation.ts`; this file only reviews
- Cancel `already_satisfied` ignores the typed refund
- This checkout’s `CONTEXT.md` does not define Granot Release Reconciliation Case
