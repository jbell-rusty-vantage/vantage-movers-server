# Session story-granot-http-collector-lifecycle-statement-2026-08-28T0018Z

- Date (UTC): 2026-08-28T0018Z
- Service / module: `granotHttpCollector` / `lifecycleStatement.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/80

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 1 / 25
- Recommendations on disk: 76
- Current service / next module (TRAVERSAL): `granotHttpCollector` (in-progress) / `lifecycleStatement.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotHttpCollector/lifecycleStatement.ts` → [recommendations/granot-http-collector-lifecycle-statement.md](../recommendations/granot-http-collector-lifecycle-statement.md)
- operations named: write the collected Granot row as a lifecycle statement; seal the collected plan as schema-v2 lifecycle evidence; tell whether this approved run is still applying
- remaining in this service: `runWorkflow.ts`

## Stock at end

- Visited / in-progress / unvisited: 12 / 1 / 25
- Current service / next module: `granotHttpCollector` (in-progress) / `runWorkflow.ts`

## Messages posted

- 2026-08-28T0018Z next

## Ideas parked

- none

## Contradictions

- HANDOFF omits this file and still describes the old Form write
- Knowledge `automation-apply.md` Primary code lists this file beside capture
- Collector Call-row map collapses `user`/`rep`; statement keeps both and deletes `granot_crm_username`
- Form find vs Call mapped-row find
- Sealed-id check splits on the first colon
- This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel
