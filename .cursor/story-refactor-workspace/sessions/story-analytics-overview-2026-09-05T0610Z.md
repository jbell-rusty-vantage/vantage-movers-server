# Session story-analytics-overview-2026-09-05T0610Z

- Date (UTC): 2026-09-05T06:10Z
- Service / module: `analytics` / `overview.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #173 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 169
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `overview.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-ed13` with a stale seed (NOW pointed at `analytics` unvisited / enumerate / 168 recs / PR #172). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-analytics.md`, lock none, `analytics` in-progress, next `overview.service.ts`, PR #173 already merged.

Stayed on `analytics`. Next unchecked module: `overview.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `overview.service.ts` → [recommendations/analytics-overview.md](../recommendations/analytics-overview.md)
- operations named: paint all-time home cards against live, historical, or both databases; when live, also paint last week's cards. Combined adds the two all-time collections and does not join by Job Number. Combined never shows Lead Cost. Historical and combined hide last week. Does not run leftover named reports, does not print leftover Agent Sales, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `summary.service.ts`, `revenueTrend.service.ts`, `sourcePerformance.service.ts`, `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `summary.service.ts`

## Messages posted

- 2026-09-05T0610Z next-run

## Ideas parked

- none

## Contradictions

- `overview.service.test.ts` never calls `getOverviewReport` (window helper / `mergeOverviewAllTime` only)
- combined top five rematches the two leftover top-five lists, not the leftover fifty-row Agent table
- last-week clock is server-local midnight, not Eastern
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
