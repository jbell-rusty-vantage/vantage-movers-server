# Session story-granot-lifecycle-synchronize-lead-from-granot-2026-08-27T0412Z

- Date (UTC): 2026-08-27T0412Z
- Service / module: `granotLifecycle` / `synchronizeLeadFromGranot.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/60

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 56
- Current service / next module (TRAVERSAL): `granotLifecycle` / `synchronizeLeadFromGranot.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` → [recommendations/granot-lifecycle-synchronize-lead-from-granot.md](../recommendations/granot-lifecycle-synchronize-lead-from-granot.md)
- operations named: write what Granot may change onto this matched Lead; attach this Job to this Lead; mark this Job’s link disputed when it already belongs elsewhere
- remaining in this service: `createLeadFromGranot.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `createLeadFromGranot.ts`

## Messages posted

- 2026-08-27T0412Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists this file under processor primary code; this file does not orchestrate Booking/Release cases or mint a Lead
- `execution.loadLead` is typed and never called; `findActiveLink` is the live injection
- `applyLeadMutation` zero-row is `DomainRevisionConflictError` even when the temporal filter lost
