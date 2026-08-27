# Session story-granot-http-collector-form-workflow-2026-08-27T2217Z

- Date (UTC): 2026-08-27T2217Z
- Service / module: `granotHttpCollector` / `formWorkflow.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/78

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 1 / 25
- Recommendations on disk: 74
- Current service / next module (TRAVERSAL): `granotHttpCollector` (in-progress) / `formWorkflow.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotHttpCollector/formWorkflow.ts` → [recommendations/granot-http-collector-form-workflow.md](../recommendations/granot-http-collector-form-workflow.md)
- operations named: plan which Form Leads these collected rows would correct; propose the missing fields this row would fill on that Form Lead
- remaining in this service: `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`

## Stock at end

- Visited / in-progress / unvisited: 12 / 1 / 25
- Current service / next module: `granotHttpCollector` (in-progress) / `granotFormLeadMatcher.ts`

## Messages posted

- 2026-08-27T2217Z next

## Ideas parked

- none

## Contradictions

- HANDOFF calls this file “form parser, strict identity resolution”; parse is `index.ts`, identity is the matcher
- HANDOFF Safety forbids `_id`; `[AC-03]` and the matcher allow Mongo id after exact `ref_no` miss
- `invalid` counter slot and leftover `conflict()` are unused
- `granotFormIdentityFields` / `selectGranotFormFallback` tests import from this file; identity lives on the matcher
- `formWorkflow.test.ts` locks `granotApplyEnabled` from `runWorkflow.ts`
- This checkout’s `CONTEXT.md` does not define Form Lead / Granot HTTP collector / Observation Receipt
