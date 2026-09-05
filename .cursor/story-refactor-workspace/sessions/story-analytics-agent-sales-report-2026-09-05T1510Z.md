# Session story-analytics-agent-sales-report-2026-09-05T1510Z

- Date (UTC): 2026-09-05T15:10Z
- Service / module: `analytics` / `agentSalesReport.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/183

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 178
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `agentSalesReport.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-f83f` with a stale seed (NOW pointed at `smsConversion.service.ts` / 177 recs / PR #181). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-sms-conversion.md`, lock none, `analytics` in-progress, next `agentSalesReport.service.ts`, PR #182 already merged.

Stayed on `analytics`. Next unchecked module: `agentSalesReport.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `agentSalesReport.service.ts` → [recommendations/analytics-agent-sales-report.md](../recommendations/analytics-agent-sales-report.md)
- operations named: score these live Agents by Binder on Bookings in this date range (hard-coded leftover live models, required `from`/`to`, optional exact `/i` names, unwind allocations, `leads` = `booked_deals`, Binder sort, no 50-cut); flatten that same scorecard to a spreadsheet with a TOTAL row. This file does not pick historical, does not add two collections, does not take leftover chips, does not rank by Deposit, does not pin the Agents desk, does not go through the leftover named-report dispatcher.
- remaining in this service: `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `leadCost.service.ts`

## Messages posted

- 2026-09-05T1510Z next-run

## Ideas parked

- none

## Contradictions

- `leads` is a copy of `booked_deals` after unwind (allocation rows), not Form / Call Leads and not distinct Bookings; the file comment says one booked deal == one booked lead because live Form / Call have no Agent link
- Deposit rides each unwound allocation row — same as already-recommended Agent ranking; already-recommended desk credits now `$first` per Booking
- Binder is this Agent’s share; Source Company / Revenue Trend / Summary use Booking-total Binder
- Groups by raw snapshot; name fence is `/i`; desk folds
- No `$limit` 50; leftover Agent ranking always cuts fifty and sorts Deposit
- Never asks leftover `bookedLeadPrefix` — date only, optional `agents[]` not leftover `query.agent`
- Live models hard-coded; no historical / combined / leftover `database_scope` chip
- Selecting `unknown` cannot see the filled blank-snapshot bucket because the pre-unwind match looks at the raw snapshot
- CSV TOTAL sums Agent rows (shared Bookings double-count); this file owns CSV, leftover named-report flatten never sees `agent-sales`
- Barrel exports these two; Wave B asks this file, not leftover `getAnalyticsReport`
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
