# Session story-granot-http-collector-source-catalog-2026-08-27T2114Z

- Date (UTC): 2026-08-27T2114Z
- Service / module: `granotHttpCollector` / `sourceCatalog.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/77

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 1 / 25
- Recommendations on disk: 73
- Current service / next module (TRAVERSAL): `granotHttpCollector` (in-progress) / `sourceCatalog.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotHttpCollector/sourceCatalog.ts` → [recommendations/granot-http-collector-source-catalog.md](../recommendations/granot-http-collector-source-catalog.md)
- operations named: show the owner the exact Granot labels they can pick; add an exact Granot label the owner declared; plant the nine known Granot labels; fail closed unless these IDs may be applied, then split them by Registry route
- remaining in this service: `formWorkflow.ts`, `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`

## Stock at end

- Visited / in-progress / unvisited: 12 / 1 / 25
- Current service / next module: `granotHttpCollector` (in-progress) / `formWorkflow.ts`

## Messages posted

- 2026-08-27T2114Z next

## Ideas parked

- none

## Contradictions

- Folder `HANDOFF.md` still says the catalog does not record Lead workflows; code persists `supported_operations`
- Leftover `partitionGranotAutomationSources` still filters on catalog `supported_operations`; resolve uses Registry routes
- Knowledge already says `createGranotRun` with `source_labels` only does not call resolve
- The 200-label cap counts inactive documents; list returns active only
- Create without a Registry pointer always starts `missing_reference`
- This checkout’s `CONTEXT.md` does not define Granot Automation Source / Granot CRM Source / Granot Observation Receipt
