# Session story-granot-http-collector-index-2026-08-27T1913Z

- Date (UTC): 2026-08-27T1913Z
- Service / module: `granotHttpCollector` / `index.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR after #74 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 0 / 26
- Recommendations on disk: 71
- Current service / next module (TRAVERSAL): `granotHttpCollector` (unvisited) / enumerate `src/services/granotHttpCollector/`

## This pass

- opened new service?: yes — modules enumerated: `index.ts` (collector, not a barrel), `automation.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`, `errors.ts` (skip — error class)
- path or skip: recommended `src/services/granotHttpCollector/index.ts` → [recommendations/granot-http-collector-index.md](../recommendations/granot-http-collector-index.md)
- operations named: log into Granot and collect the requested source tables; turn collected tables into the rows the company already uses for Follow Up and Booked Jobs
- remaining in this service: `automation.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`

## Stock at end

- Visited / in-progress / unvisited: 12 / 1 / 25
- Current service / next module: `granotHttpCollector` (in-progress) / `automation.ts`

## Messages posted

- 2026-08-27T1913Z next

## Ideas parked

- none

## Contradictions

- Knowledge `granot-http-collector.md` lists `index.ts` plus `runWorkflow.ts`, `sourceCatalog.ts`, `formWorkflow.ts`, `lifecycleStatement.ts`, admin/cron routers, and the queue consumer as Primary code; `automation.ts` and `granotFormLeadMatcher.ts` exist on disk and are not in that `applies_to` list
- `index.ts` is the session collector, not an empty barrel
- `getGranotDateWindowProblem` is exported and unused outside this file
- `buildGranotOperationPayloads` never copies `ref_no` onto Call-shaped rows even when the HTML column is present
- A failed source page fails the whole collect; `notObservedSourceLabels` is only “Granot did not list that label”
- `invalid_session` retries the whole walk once; `schema_drift` / `provider_error` / `response_too_large` do not
- This checkout’s `CONTEXT.md` does not define Granot HTTP collector / Call Lead Enrichment / Observation Receipt
