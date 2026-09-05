# Session story-analytics-analytics-merge-2026-09-05T1912Z

- Date (UTC): 2026-09-05T19:12Z
- Service / module: `analytics` / `analyticsMerge.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/185

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 182
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `analyticsMerge.ts`

This checkout booted on `cursor/vantage-server-story-refactor-5241` with a stale seed (NOW pointed at `analyticsFilters.ts` / 181 recs / PR #184). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-analytics-filters.md`, lock none, `analytics` in-progress, next `analyticsMerge.ts`. PR #185 was already open.

Stayed on `analytics`. Next unchecked module: `analyticsMerge.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `analyticsMerge.ts` → [recommendations/analytics-analytics-merge.md](../recommendations/analytics-analytics-merge.md)
- operations named: add these two named-report cards for combined Analytics (`mergeAnalyticsPayload`: Summary totals, cancellation-ratio overall + by company, geographic lanes as two lists, Receiver-Agent / SMS live rows + stamped historical-unsupported warning, else items by report key); add these scored rows by these stable keys (`mergeRows`: Overview top Agents). Counts add; rates recompute; Source Company aliases fold; company-only historical row becomes an extra leaf under live children (order-dependent). Does not join by Job Number. Does not rematch chips. Does not nest. Does not flatten.
- remaining in this service: `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `sourceHierarchy.ts`

## Messages posted

- 2026-09-05T1912Z next-run

## Ideas parked

- none

## Contradictions

- Company-only extras as leaves are order-dependent: fabricate only when incoming granularities empty AND existing already has children. Reverse arrays drop company-only first parent totals.
- Receiver-Agent / SMS metadata is stamped, not copied from `unsupported*Report()`.
- `mergeAnalyticsPayload("summary")` / `"booking-cancellation-ratio"` / `"geographic-lanes"` untested at this interface.
- `deriveRates` on the ratio card already parked (drops `booked_to_cancelled_ratio`).
- Does not re-slice Agent ranking top 50.
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
