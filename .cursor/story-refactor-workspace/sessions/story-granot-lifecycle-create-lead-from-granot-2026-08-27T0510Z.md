# Session story-granot-lifecycle-create-lead-from-granot-2026-08-27T0510Z

- Date (UTC): 2026-08-27T0510Z
- Service / module: `granotLifecycle` / `createLeadFromGranot.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/61

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 57
- Current service / next module (TRAVERSAL): `granotLifecycle` / `createLeadFromGranot.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/createLeadFromGranot.ts` → [recommendations/granot-lifecycle-create-lead-from-granot.md](../recommendations/granot-lifecycle-create-lead-from-granot.md)
- operations named: mint this Granot customer as a Vantage Lead; attach this Job to the new Lead (establish only); after commit, project sheets and maybe text the customer
- remaining in this service: `bookingReconciliation.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `bookingReconciliation.ts`

## Messages posted

- 2026-08-27T0510Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists this file under processor primary code; this file does not orchestrate Booking/Release cases or `$set` a matched Lead
- `CreateLeadFromGranotRaceError("route")` is minimum-creation-data, not a RingCentral route; `"route_assignment"` is the inbound-route refuse
- Origin is stamped twice (trusted schema + provenance bag); provenance wins if they diverge
