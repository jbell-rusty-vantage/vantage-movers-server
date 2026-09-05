# Session story-analytics-receiver-agent-performance-2026-09-05T1313Z

- Date (UTC): 2026-09-05T13:13Z
- Service / module: `analytics` / `receiverAgentPerformance.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (opens after #180 closed)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 176
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `receiverAgentPerformance.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-01dc` with a stale seed (NOW pointed at `geographicAnalytics.service.ts` / 175 recs / PR #179). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-geographic-analytics.md`, lock none, `analytics` in-progress, next `receiverAgentPerformance.service.ts`, PR #180 already closed.

Stayed on `analytics`. Next unchecked module: `receiverAgentPerformance.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `receiverAgentPerformance.service.ts` → [recommendations/analytics-receiver-agent-performance.md](../recommendations/analytics-receiver-agent-performance.md)
- operations named: rank these Receiver Agents by received Leads (Form + Call on `timestamp`, blank → Unassigned, billable stored CPL, Booking/Cancellation lookups, no cut); chart the same ranking across leftover `$report_date` periods; break the same ranking down by Source Granularity and lead type (catalog labels, no nest); hand back the empty historical card. This file does not pick live versus historical, does not add the two collections, does not unwind Booking allocations, does not nest Source Companies, does not paint the home Overview, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `smsConversion.service.ts`

## Messages posted

- 2026-09-05T1313Z next-run

## Ideas parked

- none

## Contradictions

- Receiver ranking counts Leads on `timestamp`; already-recommended Agent ranking counts Booking allocation rows on `book_date`
- `booked_leads` / `cancelled_leads` here include Booking / Cancellation lookups, not only Lead refs
- leftover `trendDateExpression` reads `$report_date`; Form / Call Leads have no such field, so trend periods collapse
- `average_cpl` and `cost_per_received_lead` are the same formula
- `receiver_attribution_rate` is 0 or 1 from group, not a computed rate
- leftover combined merge keys id + name (not group) and lowercases; this file keeps raw spelling
- no fifty-cut, unlike Agent ranking / lanes / cancellation reasons
- existing test only proves `$cpl` vs `cpl_resolution_status` on the ranking export
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
