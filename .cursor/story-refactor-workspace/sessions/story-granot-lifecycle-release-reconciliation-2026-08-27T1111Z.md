# Session story-granot-lifecycle-release-reconciliation-2026-08-27T1111Z

- Date (UTC): 2026-08-27T1111Z
- Service / module: `granotLifecycle` / `releaseReconciliation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/67

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 63
- Current service / next module (TRAVERSAL): `granotLifecycle` / `releaseReconciliation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/releaseReconciliation.ts` → [recommendations/granot-lifecycle-release-reconciliation.md](../recommendations/granot-lifecycle-release-reconciliation.md)
- operations named: decide whether this Release Observation needs Owner work; open or refresh the one open Release case; after the owner fixes a discrepancy, persist the same case inside their transaction
- remaining in this service: `releaseOwnerCommands.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `releaseOwnerCommands.ts`

## Messages posted

- 2026-08-27T1111Z next

## Ideas parked

- none

## Contradictions

- Knowledge lists processor + projections as primary code; this file neither orchestrates nor projects
- Knowledge lists `releaseOwnerCommands.ts` beside this file; this file only re-exports
- Already-cancelled is `already_current` here; Booking persist uses a discrepancy
- Replay skips Decision insert
- `has_lead` unused; `suggested_lead` on the model is never written
- No open-case gauge (Booking persist has one)
- This checkout’s `CONTEXT.md` does not define Granot Release Reconciliation Case
