# Session story-granot-http-collector-automation-2026-08-27T2010Z

- Date (UTC): 2026-08-27T2010Z
- Service / module: `granotHttpCollector` / `automation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/76

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 1 / 25
- Recommendations on disk: 72
- Current service / next module (TRAVERSAL): `granotHttpCollector` (in-progress) / `automation.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotHttpCollector/automation.ts` → [recommendations/granot-http-collector-automation.md](../recommendations/granot-http-collector-automation.md)
- operations named: collect the requested tables and count what came back; optionally preview what those Follow Up and Booked Jobs rows would do (no run document)
- remaining in this service: `sourceCatalog.ts`, `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`

## Stock at end

- Visited / in-progress / unvisited: 12 / 1 / 25
- Current service / next module: `granotHttpCollector` (in-progress) / `sourceCatalog.ts`

## Messages posted

- 2026-08-27T2010Z next

## Ideas parked

- none

## Contradictions

- Knowledge `granot-http-collector.md` names `runGranotAutomation` as the standalone helper but omits `automation.ts` from `applies_to`
- HANDOFF.md says this file is retained for compatibility and focused collector tests; no test file imports it
- Zero runtime callers; `pnpm granot:collect` copies the collection summary instead of calling this file
- `mode: "collect"` still maps payloads via `buildGranotOperationPayloads` then drops them unless `includeRows`
- Preview batches of 100 match public Zod max; admin `planCallWorkflow` walks one row plus a target binding
- This file never plans Form Leads and never writes a `GranotAutomationRun`
- This checkout’s `CONTEXT.md` does not define Granot HTTP collector / Call Lead Enrichment / Observation Receipt
