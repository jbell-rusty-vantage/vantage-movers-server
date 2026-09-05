# Paint The Admin Dashboard Home Overview — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 2 of this service — `overview.service.ts`
- Remaining in this service: `summary.service.ts`, `revenueTrend.service.ts`, `sourcePerformance.service.ts`, `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/overview.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Overview section: all-time `getSummary` + top 5 agents by deposit; `lead_cost` only when requested scope **and** concrete scope are live; last 7 days live-only — rolling midnight-7-days-ago → now, summary + by-source bookings + lead cost + top agents; historical and combined set `last_7_days: null`; combined all-time merges totals and top agents and sets `lead_cost` `null`; Overview HTTP stays unfiltered — `overviewQuerySchema`: scope only. Role line on that Service is the leftover dispatcher, not this file). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/:report`; **does not** import this file; this file **does not** import it). Distinct from leftover totals math: later `summary.service.ts` (this file **asks** `getSummary`). Distinct from leftover Lead Cost: later `leadCost.service.ts` (knowledge: **overview only**, live all-time / last-7-days; this file **asks** it). Distinct from leftover top-agents unwind: later `agentPerformance.service.ts` (`getTopAgentsByDeposit` slices 5 after the leftover 50-limit table). Distinct from leftover Agent Sales: later `agentSalesReport.service.ts` (`GET /api/v1/admin/reports/agent-sales` — hard-coded live models, requires `from`/`to`). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, not this file. Distinct from leftover Filter Catalog match / booked prefix: later `analyticsFilters.ts` (this file **asks** `bookedLeadPrefix` only on last-week by-source). Distinct from leftover combined add: later `analyticsMerge.ts` (this file **asks** `mergeAnalyticsPayload("summary")` and `mergeRows` on `agent_name`). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file **asks** `nestObservedSourceRows` only on last-week by-source). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). Distinct from later unvisited Observability overview (`GET /api/v1/admin/observability/overview`) and already-recommended Registry overview (`GET /api/v1/admin/operations-registry/overview`). Distinct from the planned Owner Daily `ownerDaily/overview.service.ts` in `docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md` — that file is not this sitting and is not in `src/` yet. This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an overview Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleOverviewReport` — `GET /api/v1/admin/analytics/overview`; `overviewQuerySchema`: scope only). Barrel: `analytics/index.ts` (`getOverviewReport`, `OverviewResponse`). Already-recommended dispatcher / leftover CSV / leftover Agent Sales do **not** import this file. Tests: `overview.service.test.ts` (schema default, `rollingLast7DaysWindow` span, `mergeOverviewAllTime` combined add + live-only lead cost) — **does not call `getOverviewReport`**.
- Seams callers need: paint-the-home-overview (`getOverviewReport`: all-time cards + live-only last week) vs run-this-named-report (already-recommended dispatcher) vs print-agent-sales (leftover sibling) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no filter **seam** — Overview HTTP is scope only. There is no CSV-column **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~197-line file is one sitting if you read it as paint the Admin Dashboard home Overview — all-time cards against live, historical, or both databases; when live, also paint last week’s cards. Do **not** split all-time vs last-week into `getAllTime.ts` / `getLast7Days.ts`. Do **not** pull leftover Summary / Lead Cost / Agent Performance / nest here so “the home page owns the math.” Do **not** route this through already-recommended `runThisAdminDashboardAnalyticsReport` so “every chart goes through the switch.” If it later splits: `paintTheAdminDashboardHomeOverview.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getOverviewReport` / `buildAllTimeSection` / `buildLast7DaysSection` / `mergeOverviewAllTime` are executor mechanics. The owner question is: *I opened the Admin Dashboard home. Show me all-time totals and the top five Agents by Deposit. On the live database, also show last week’s cards, last week’s bookings by Source Company (including catalog zeros), and Lead Cost. Historical and combined hide last week. Combined adds the two all-time collections — it does not join the same Job Number — and never shows Lead Cost. This is not a named Analytics report. This is not Agent Sales. This is not flattening a spreadsheet. This is not reconciling RingCentral call counts.*

Already-recommended named-report dispatcher, leftover totals / Lead Cost / top-agents / nest / merge / filters, leftover Agent Sales / CSV flatten, leftover scope pick, already-recommended Admin Dashboard desk, already-recommended RingCentral reconcile, later Observability overview, already-recommended Registry overview, and the planned Owner Daily Overview already live in other **modules** (or a spec that is not this file). Do not pull those in.

## What this file actually does

Two operations of one “paint the Admin Dashboard home Overview” story, not “an overview CRUD report service,” and not a named Analytics report:

1. **Paint all-time home cards against live, historical, or both databases** — `getOverviewReport` (all-time half). Wave B home. Expand `concreteScopes(query.database_scope)` (live, historical, or both). Per scope, in parallel: pick `getAdminModels(scope)`, parse an empty leftover `analyticsQuerySchema` with that concrete scope (no `from` / `to` / source chips), **ask** leftover `getSummary` and leftover `getTopAgentsByDeposit(..., 5)`. **Ask** leftover `getLeadCost` only when the requested scope **and** the concrete scope are live; otherwise `lead_cost` is `null` (combined never even prices the live collection). Combined: `mergeOverviewAllTime` **asks** leftover `mergeAnalyticsPayload("summary")` for totals and leftover `mergeRows(..., ["agent_name"])` for the two top-five lists, then slices five. Combined `lead_cost` is `null`. One concrete scope: keep that payload; still force `lead_cost` `null` unless the requested scope is live. Stamp `{ database_scope, generated_at, all_time, last_7_days }`. This file never mutates Mongo, never enqueues Sheet Sync, and never reads Reporting Sheets.

2. **When live, also paint last week’s cards** — still `getOverviewReport`. Live only: `rollingLast7DaysWindow` is midnight seven days ago (server-local `setHours(0, 0, 0, 0)`) through `now`. Parse leftover `analyticsQuerySchema` with live scope + that `from` / `to`. **Ask** leftover `getSummary`, leftover `getLeadCost`, leftover `getTopAgentsByDeposit(..., 5)`, and a local by-source booking nest (`bookedLeadPrefix` → `$group` company + granularity → leftover `nestObservedSourceRows` with catalog zeros, deposit rounded, sort deposit then bookings then company). Historical and combined set `last_7_days: null` — they do not paint live last week either.

There is no third owner operation. `mergeOverviewAllTime` / `rollingLast7DaysWindow` / `getSalesBySourceCompany` are beats, not public **seams**. Do not export leftover `getSummary` from this file as if this story owned the totals card. Do not export the last-week nest as if this story owned source-company performance.

## Organization

Keep one file. This is the screenplay for “paint the Admin Dashboard home Overview.” Totals math, Lead Cost, the fifty-row Agent table, catalog nest, combined add, booked prefix, named-report dispatch, Agent Sales, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent an `OverviewService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** — Overview HTTP is scope only.

Do not split this by card. All-time totals and last-week by-source are beats of one home page. Do not move this into `admin/` so “the Admin Dashboard folder owns every chart.” Do not add `overview` to the leftover dispatcher switch.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getOverviewReport` | `paintTheAdminDashboardHomeOverview` | Wave B home; scope only |
| `OverviewResponse` | `AdminDashboardHomeOverview` | `database_scope` + `generated_at` + `all_time` + `last_7_days` |

Keep `OverviewAllTime` / `OverviewLast7Days` / `OverviewPeriod` as the two card bags the home already paints. `mergeOverviewAllTime` and `rollingLast7DaysWindow` stay as one-line aliases if tests still import them; they are not a second **seam**.

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `analytics/index.ts`, and `overview.service.test.ts` migrate. Do not make callers learn `buildAllTimeSection` / `buildLast7DaysSection` / `getSalesBySourceCompany` / `Promise.all` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the envelope the Admin Dashboard home already paints:

```ts
type AdminDashboardHomeOverview = {
  database_scope: "live" | "historical" | "combined"
  generated_at: string // wall clock after all-time (and live last-week) finish
  all_time: {
    totals: OverviewTotals
    lead_cost: LeadCostResult | null // live requested + live concrete only
    top_agents: AnalyticsRow[]       // leftover top 5 by deposit
  }
  last_7_days: {
    period: { from: string; to: string } // midnight-7-days-ago → now
    totals: OverviewTotals
    by_source_company: AnalyticsRow[]    // leftover nest, zeros remain
    lead_cost: LeadCostResult
    top_agents: AnalyticsRow[]
  } | null // historical and combined: null
}
```

That is the handoff from “we painted the home cards” to “the Admin Dashboard home.” Combined `all_time` is summed collections, not a third database. Combined `last_7_days` is hidden, not a live last-week tucked under both.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// overview.service.ts
// The owner opened the Admin Dashboard home.
// Paint all-time totals and the top five Agents by Deposit.
// On the live database, also paint last week's cards.
// Historical and combined hide last week.
// Combined adds the two all-time collections. It does not join the same Job Number.
// Combined never shows Lead Cost.
// This file does not run a named Analytics report.
// This file does not print Agent Sales.
// This file does not flatten a spreadsheet.

// ── 1. Paint all-time home cards ──────────────────────────

export async function paintTheAdminDashboardHomeOverview(query)

async function paintAllTimeCardsForOneDatabase(models, scope, requestedScope)
function pickTheLiveOrHistoricalModels(scope)           // asks leftover adminScope
function priceLeadsOnlyOnTheLiveDatabase(requested, scope) // asks leftover getLeadCost
function addTheTwoAllTimeCollectionsTogether(payloads, requestedScope)
  // asks leftover mergeAnalyticsPayload("summary") + mergeRows on agent_name
  // then slice 5; lead_cost is null

// ── 2. When live, also paint last week's cards ────────────

function lastWeekStartsAtMidnightSevenDaysAgo()         // server-local midnight → now
async function paintLastWeeksCards(models, query, window)
async function nestLastWeeksBookingsBySourceCompany(models, query)
  // asks leftover bookedLeadPrefix + leftover nestObservedSourceRows
```

Read the home path out loud: *The owner opened the Admin Dashboard home and named a database scope — nothing else. Expand live, historical, or both. For each database, pick that model set, run leftover totals and leftover top five Agents with no date chip, and price leads only when both the request and this database are live. If the owner asked for both databases, add the two all-time collections by leftover summary merge and leftover Agent-name rows, keep five Agents, and drop Lead Cost — do not join the same Job Number. On live only, paint last week from server-local midnight seven days ago through now: leftover totals, leftover Lead Cost, leftover top five, and a by-source booking nest that still lists catalog zeros. Historical and combined leave last week null. Stamp which scope and when we finished. Hand the envelope to the home. A named report and a spreadsheet download live next door.*

That is the operation. `getOverviewReport` is not a different story. Combined is not a third System of Record. Last week is not a named `revenue-trend`.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getOverviewReport` / `buildAllTimeSection` / `buildLast7DaysSection` are executor names.** The owner opened the home. The names should say paint all-time cards, then (when live) paint last week. Do not teach Wave B `buildAllTime`.

2. **Last week is live-only; historical and combined hide it.** Knowledge: “Historical and combined set `last_7_days: null`.” Combined does not tuck live last week under both databases. Do not silently compute last week on historical, and do not “fix” combined to show live last week so “the home always has a week card.”

3. **Lead Cost is live requested and live concrete.** Combined never **asks** leftover `getLeadCost`, even for the live collection. Historical never prices. `mergeOverviewAllTime` then forces `lead_cost` `null` unless the requested scope is live. Do not merge the two Lead Cost bags so “combined has a cost,” and do not price historical CPL.

4. **Combined all-time adds collections; it does not join by business id.** Knowledge: “`combined` sums collections; it does not join by business id.” Totals **ask** leftover summary merge. Top Agents **ask** leftover `mergeRows` on `agent_name` (lowercased leftover key). Do not silently `$unionWith` on `normalized_job_no`, and do not teach the home to dedupe Lead ids.

5. **Combined top five only rematches the two top-five lists.** Leftover `getTopAgentsByDeposit` slices 5 after a leftover 50-limit aggregate. Combined then merges those two short lists and slices 5 again. An Agent who is sixth on both databases never appears, even if the added Deposit would have been top five. Do not silently re-run leftover `getAgentPerformance` (the fifty-row table) so “combined top five is honest,” and do not drop the leftover 50-limit here.

6. **Overview bypasses the leftover dispatcher.** Already-recommended `runThisAdminDashboardAnalyticsReport` never sees `overview`. Do not route `GET .../analytics/overview` through that switch so “every chart goes through the dispatcher,” and do not add an `overview` case next door.

7. **Overview HTTP is unfiltered.** `overviewQuerySchema` is scope only. All-time leftover queries carry no `from` / `to` / source chips. Do not parse leftover `analyticsQuerySchema` on the route so “the home can take the same chips as Summary,” and do not thread Wave B date chips into `paintTheAdminDashboardHomeOverview`.

8. **Last week starts at server-local midnight, not Eastern.** `rollingLast7DaysWindow` does `setDate(-7)` then `setHours(0, 0, 0, 0)` on the process clock; `to` is `now`, not end-of-day. CPL / Owner dates are `America/New_York`. Do not silently move this window to Eastern in this rename, and do not reuse leftover `revenue-trend` `report_date` buckets as last week.

9. **Last-week by-source is a local nest, not leftover source-company performance.** `getSalesBySourceCompany` **asks** leftover `bookedLeadPrefix` + leftover `nestObservedSourceRows` (zeros remain). It is not leftover `getSourceCompanyPerformance`. Do not replace it with that sibling so “one source table owns the home,” and do not add `by_source_company` to all-time so “the home matches last week.”

10. **Tests never call this export.** `overview.service.test.ts` names the window helper and `mergeOverviewAllTime`. The home envelope is unproven at the **interface**. Do not treat leftover merge tests as proof this file asked leftover `getSummary`.

11. **`generated_at` is wall clock after the cards finish.** One ISO string on the envelope, not per-scope, not last-week `to`. Do not stamp each leftover payload, and do not reuse the rolling `to` as `generated_at`.

12. **Leave sibling modules alone.** `concreteScopes` / `getAdminModels` stay in leftover `adminScope.service.ts`. Totals stay in later `summary.service.ts`. Lead Cost stays in later `leadCost.service.ts`. Top five stays in later `agentPerformance.service.ts`. Booked prefix stays in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Catalog nest / zero seed stay in later `sourceHierarchy.ts`. Named-report dispatch, Agent Sales, and CSV flatten stay in their files. This file orchestrates scope → all-time cards → optional last week.

13. **Do not treat other “overview” routes as this story.** Later Observability overview and already-recommended Registry overview are different desks. The planned Owner Daily `ownerDaily/overview.service.ts` is a spec, not this file. Do not import them here so “overview means overview.”

14. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `last_7_days`.

## Testing

The **interface** is the test surface: `paintTheAdminDashboardHomeOverview` (`getOverviewReport`). The envelope (`database_scope` + `generated_at` + `all_time` + `last_7_days`) is part of that **interface**.

Today’s `overview.service.test.ts` never calls `getOverviewReport`. Fill the gap the story names make obvious:

**Paint all-time home cards**
- Live returns `{ database_scope: live, generated_at, all_time, last_7_days }` and **asks** leftover `getSummary` + leftover `getTopAgentsByDeposit(..., 5)` + leftover `getLeadCost` with a live model set and no date chip.
- Historical **asks** leftover `getSummary` + leftover top five with historical models, `lead_cost` is `null`, and does **not** **ask** leftover `getLeadCost`.
- Combined **asks** leftover summary merge with two concrete all-time payloads (live first, then historical), `lead_cost` is `null`, and does **not** **ask** leftover `getLeadCost` even on the live collection.
- Combined does **not** join by Job Number / Lead id. Prove today’s sum-by-text-key. Do not “fix” it into a business-id join.
- Combined top five rematches the two top-five lists, then slices 5. Prove today’s short-list merge. Do not “fix” it into a leftover fifty-row rematch.
- One-scope (live or historical) does **not** call leftover `mergeAnalyticsPayload`.
- `generated_at` is an ISO string from after the card work, not last-week `to`.

**When live, also paint last week’s cards**
- Live `last_7_days` is present: `period.from` is midnight seven days ago, `period.to` is `now`, and the leftover queries carry that range.
- Live last week **asks** leftover `getSummary` / leftover `getLeadCost` / leftover top five **and** leftover `nestObservedSourceRows` (catalog zeros remain).
- Historical `last_7_days` is `null` and does **not** run the rolling window.
- Combined `last_7_days` is `null` and does **not** paint live last week.

**Not this file**
- Do **not** assert named-report envelopes here — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover Summary `booking_rate` math — that is a later sitting (`summary.service.ts`).
- Do **not** assert leftover Lead Cost duplicate / unmatched filters — that is a later sitting (`leadCost.service.ts`).
- Do **not** assert Agent Sales live-only models — that is a later sitting (`agentSalesReport.service.ts`).
- Do **not** assert CSV headers here — that is a later sitting (`analyticsExport.service.ts`).

Do **not** add a test per helper (`paintAllTimeCardsForOneDatabase`, `priceLeadsOnlyOnTheLiveDatabase`, `nestLastWeeksBookingsBySourceCompany`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. `mergeOverviewAllTime` / `rollingLast7DaysWindow` tests may stay as aliases of the parent until the parent is covered; they are not the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” or RingCentral reconcile here.

## What I would not do

- An `OverviewService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `getSummary`.
- Moving this into a CRUD folder, or into `admin/` “because the Admin Dashboard paints the home.”
- Pulling leftover Summary / Lead Cost / Agent Performance / nest / merge / filters into this file.
- Routing Wave B `GET /api/v1/admin/analytics/overview` through already-recommended `runThisAdminDashboardAnalyticsReport`, or adding `overview` to that switch.
- Pointing Wave B `GET /api/v1/admin/analytics/summary` at this file.
- Painting last week on historical, or tucking live last week under combined.
- Merging Lead Cost on combined, or pricing historical CPL.
- “Fixing” combined top five to rematch the leftover fifty-row table in this rename.
- “Fixing” the last-week clock to Eastern in this rename.
- Teaching Overview HTTP leftover `analyticsQuerySchema` chips so the home can filter.
- Treating later Observability overview, already-recommended Registry overview, or the planned Owner Daily Overview as this story.
- Treating already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
