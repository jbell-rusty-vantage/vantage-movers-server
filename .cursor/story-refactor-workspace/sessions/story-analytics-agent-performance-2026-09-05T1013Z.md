# Session story-analytics-agent-performance-2026-09-05T1013Z

- Date (UTC): 2026-09-05T10:13Z
- Service / module: `analytics` / `agentPerformance.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/178

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 173
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `agentPerformance.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-08c3` with a stale seed (NOW pointed at `sourcePerformance.service.ts` / 172 recs / PR #176). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-source-performance.md`, lock none, `analytics` in-progress, next `agentPerformance.service.ts`, PR #177 already closed.

Stayed on `analytics`. Next unchecked module: `agentPerformance.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `agentPerformance.service.ts` → [recommendations/analytics-agent-performance.md](../recommendations/analytics-agent-performance.md)
- operations named: rank each Agent by Deposit on their shares of matching Bookings (unwind allocations, raw snapshot name, hard top 50; Binder is this share; Deposit rides each allocation row); name the top five of that same ranking for the home Overview. This file does not pick live versus historical, does not add the two collections, does not pin the Agents desk (desk now distinct-Booking + `$first` deposit), does not print Agent Sales, does not score Receiver Agents on Leads, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `cancellationAnalytics.service.ts`

## Messages posted

- 2026-09-05T1013Z next-run

## Ideas parked

- none

## Contradictions

- desk credits recommendation still describes one-stage unwind; current `agentBrowseMetrics.service.ts` is two-stage distinct Booking + `$first` deposit
- this report still credits every allocation row and doubles Deposit; knowledge names that
- three casing rules: raw snapshot here, folded desk, leftover-lowercased combined merge
- `$limit 50` then leftover combined merge does not re-slice; Agent 51st on both databases never appears
- leftover merge does not recompute averages
- `over_2000_bookings` / `over_4000_bookings` are JSON-only
- `$match agent_name != ""` is dead after unknown fill
- no `agentPerformance.service.test.ts`; leftover dispatcher tests never call these two exports
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
