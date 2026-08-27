# Session story-granot-lifecycle-discrepancy-projections-2026-08-27T1511Z

- Date (UTC): 2026-08-27T1511Z
- Service / module: `granotLifecycle` / `discrepancyProjections.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new after #70 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 67
- Current service / next module (TRAVERSAL): `granotLifecycle` / `discrepancyProjections.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/discrepancyProjections.ts` → [recommendations/granot-lifecycle-discrepancy-projections.md](../recommendations/granot-lifecycle-discrepancy-projections.md)
- operations named: show the jobs where Granot and Vantage fight; open one fight so the owner can see evidence versus current facts
- remaining in this service: `observability.ts`, `metrics.ts`, `alerts.ts`

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `observability.ts`

## Messages posted

- 2026-08-27T1511Z next

## Ideas parked

- none

## Contradictions

- Knowledge `projections.md` lists the discrepancy GET routes and omits this file from Primary code
- `projections.ts` comments that `maskContactLabel` serves this queue; this file uses the literal `"Contact masked"`
- Discrepancy list does not default to `state=open`; case list does
- `canCorrect` here is not the same matcher as Owner-review `isLinkConflict`
- Candidate **adapter** opens a transaction on a GET; candidates are identity-only and may be empty while `correct_record_link` stays true
- This checkout’s `CONTEXT.md` does not define discrepancy / Record Link
