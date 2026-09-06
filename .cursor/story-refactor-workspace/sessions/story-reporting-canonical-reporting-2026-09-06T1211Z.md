# Session story-reporting-canonical-reporting-2026-09-06T1211Z

- Date (UTC): 2026-09-06
- Service / module: `reporting` / `query/canonicalReporting.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / pending (PR #200 already merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 1 / 10
- Recommendations on disk: 198 (through `reporting-destination-repository.md`)
- Current service / next module (TRAVERSAL): `reporting` / `query/canonicalReporting.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/reporting/query/canonicalReporting.ts` → `recommendations/reporting-canonical-reporting.md`
- operations named: estimate how many rows this window would write; hand leftover preview fifty representative samples; paint the three report shapes; page the painted rows for leftover worker; freeze a candidate manifest of the records we used; prove those records did not move after source-read-through
- remaining in this service: `query/pagination.ts`, leftover worker, leftover google adapters, leftover live harness

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` / `query/pagination.ts`

## Messages posted

- 2026-09-06T1211Z next-run

## Ideas parked

- none

## Contradictions

- none
