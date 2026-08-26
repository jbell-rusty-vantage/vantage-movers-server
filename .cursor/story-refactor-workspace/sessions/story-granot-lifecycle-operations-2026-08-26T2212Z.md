# Session story-granot-lifecycle-operations-2026-08-26T2212Z

- Date (UTC): 2026-08-26T2212Z
- Service / module: `granotLifecycle` / `operations.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #53 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 50
- Current service / next module (TRAVERSAL): `granotLifecycle` / `operations.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/operations.ts` → [recommendations/granot-lifecycle-operations.md](../recommendations/granot-lifecycle-operations.md)
- operations named: start the write-once Granot lifecycle clock; put this dead-lettered receipt back on the due list
- remaining in this service: `projections.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `projections.ts`

## Messages posted

- 2026-08-26T2212Z next

## Ideas parked

- none

## Contradictions

- Knowledge `drainer.md` lists `operations.ts` as primary requeue code
- `operations.replica.test.ts` tests health projections, not this file
- Activation does not flip effect flags
