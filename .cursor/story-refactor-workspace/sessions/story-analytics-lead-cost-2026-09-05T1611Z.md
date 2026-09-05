# Session story-analytics-lead-cost-2026-09-05T1611Z

- Date (UTC): 2026-09-05T16:11Z
- Service / module: `analytics` / `leadCost.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/184

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 179
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `leadCost.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-d7e8` with a stale seed (NOW pointed at `agentSalesReport.service.ts` / 178 recs / PR #182). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-agent-sales-report.md`, lock none, `analytics` in-progress, next `leadCost.service.ts`, PR #183 already merged.

Stayed on `analytics`. Next unchecked module: `leadCost.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `leadCost.service.ts` → [recommendations/analytics-lead-cost.md](../recommendations/analytics-lead-cost.md)
- operations named: price these matching Form and Call Leads by stored CPL, grouped by Source Company (billable Form `duplicate != true`, billable Call `created_on_unmatched != true`, null `$cpl` unresolved + 0, leftover nest seeds catalog zeros on leftover live, historical company-only). This file does not pick live versus historical, does not add the two collections, does not flatten a spreadsheet, is not a named Analytics report, does not reprice from the schedule.
- remaining in this service: `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `analyticsExport.service.ts`

## Messages posted

- 2026-09-05T1611Z next-run

## Ideas parked

- none

## Contradictions

- Unresolved is null `$cpl`, not `cpl_resolution_status`; leftover `missing_rate` compatibility zero looks priced
- Billable Call is unmatched-only — leftover `duplicate_zero` Call Leads still enter when `created_on_unmatched` is false
- `total` / `unresolved_count` sum leftover nest parents, not pre-nest leaves
- Sort is leftover-cost desc then `source_company` slug, not owner label
- Barrel does not export `getLeadCost`; Wave B asks leftover Overview; no `"lead-cost"` on leftover `analyticsReportSchema`
- Combined never prices — leftover Overview sets `lead_cost` null instead of leftover merge
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
