# Session story-analytics-analytics-export-2026-09-05T1708Z

- Date (UTC): 2026-09-05T17:08Z
- Service / module: `analytics` / `analyticsExport.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/184

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 180
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `analyticsExport.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-65fb` with a stale seed (NOW pointed at `agentSalesReport.service.ts` / 178 recs / PR #182). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-lead-cost.md`, lock none, `analytics` in-progress, next `analyticsExport.service.ts`, PR #184 still the open story-refactor PR.

Stayed on `analytics`. Next unchecked module: `analyticsExport.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `analyticsExport.service.ts` → [recommendations/analytics-analytics-export.md](../recommendations/analytics-analytics-export.md)
- operations named: flatten this named Analytics report to a spreadsheet (leftover dispatcher then leftover `toCsv`); choose the rows Excel can open for this report shape (Summary totals, leftover overall + leaf-or-childless, form-then-call lanes, leftover `items` fallthrough). Leaves or a childless company, never both. Combined funnel does not also emit the parent total. This file does not pick live versus historical, does not add the two collections, does not nest Source Companies, does not flatten Agent Sales / Overview / Lead Cost / the Admin Dashboard desk.
- remaining in this service: `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `analyticsFilters.ts`

## Messages posted

- 2026-09-05T1708Z next-run

## Ideas parked

- none

## Contradictions

- Combined funnel parent `total_leads` is larger than leftover children; leftover flatten sums children only
- Summary leftover columns drop `active_bookings`; ratio leftover columns drop `booked_to_cancelled_ratio`
- Historical Receiver-Agent / SMS leftover empty cards become header-only spreadsheets — leftover warning metadata is not a column
- Missing leftover bags become empty rows, not thrown errors
- Barrel exports leftover `exportAnalyticsReportCsv` only — leftover `rowsForCsv` stays a test flatten seam
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
