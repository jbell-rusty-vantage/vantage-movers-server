# Score These Live Agents By Binder On Bookings In This Date Range — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 11 of this service — `agentSalesReport.service.ts`
- Remaining in this service: `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/agentSalesReport.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Agent Sales: hard-coded leftover `getAdminModels` on the live Admin model set. Requires `from`/`to`. Optional `agents[]` exact `/i` on allocation snapshot. Unwind allocations; `leads` = `booked_deals` — no standalone Lead attribution. Separate CSV route. Role line on that Service is the leftover dispatcher, not this file — this file **bypasses** that dispatcher). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — **does not** import this file; there is no `"agent-sales"` case on leftover `analyticsReportSchema`). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (all-time + live last week — **asks** leftover Agent ranking’s top five, **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** unwind). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets, Booking-total Binder — **does not** unwind). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children — **does not** unwind). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (`GET /api/v1/admin/analytics/agent-performance` — leftover `bookedLeadPrefix` chips, Deposit sort, hard top 50, handed models, **does not** own CSV). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (booked `is_cancelled` — **does not** unwind). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (Form + Call on `timestamp` — **does not** unwind allocations). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md). Distinct from leftover booked-prefix / rate helpers: later `analyticsFilters.ts` (this file **asks** leftover `numberValue` / leftover `roundMoney` only — **does not** ask leftover `bookedLeadPrefix`). Distinct from leftover combined add: later `analyticsMerge.ts` (this file never **asks** it — there is no historical half). Distinct from leftover named-report CSV flatten: later `analyticsExport.service.ts` (**does not** flatten this card; this file **owns** its CSV). Distinct from leftover Lead Cost: later `leadCost.service.ts` (Overview only, stored CPL). Distinct from already-recommended Agents desk credits: [`admin-agent-browse-metrics.md`](admin-agent-browse-metrics.md) / current `agentBrowseMetrics.service.ts` (page-name `$in`, folded key, two-stage group: distinct Booking then Agent — **does not** import this file). Distinct from already-recommended who-shares-the-Binder writes: [`agents-agent-allocation.md`](agents-agent-allocation.md). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Agent / Binder / Agent Allocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an agent-sales Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAgentSalesReport` → `GET /api/v1/admin/reports/agent-sales`; `handleAgentSalesReportExport` → `GET /api/v1/admin/exports/reports/agent-sales.csv`; leftover `agentSalesReportQuerySchema` — required `from`/`to`, optional `agents[]`). Barrel `analytics/index.ts` **does** export `getAgentSalesReport`, `exportAgentSalesReportCsv`, and leftover `AgentSalesReportResult` — Wave B **asks** this file, not the leftover dispatcher. Already-recommended dispatcher / Overview / leftover named-report CSV / leftover Agent ranking / already-recommended desk credits do **not** import this file. Tests: **no** `agentSalesReport.service.test.ts`. `analytics.service.test.ts` leftover-parses named-report strings — **does not** mention `agent-sales`. `overview.service.test.ts` leftover-merges `top_agents` — **does not** call these two exports.
- Seams callers need: score-these-live-agents (`getAgentSalesReport`: one `{ items, totals }` card for leftover live Bookings + required dates + optional names) vs flatten-this-scorecard (`exportAgentSalesReportCsv`: the same card, then leftover `toCsv` plus a `TOTAL` row). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — this file hard-codes leftover live models. There is no combined-add **seam**. There is no leftover-chip **seam**. There is no dispatcher **seam**. There is no named-report-CSV **seam**. There is no desk **seam**. There is no Agent-ranking **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~145-line file is one sitting if you read it as score these live Agents by Binder on Bookings in this date range, then flatten that same card with a TOTAL row. Do **not** split `getAgentSalesReport` and `exportAgentSalesReportCsv` into `get.ts` / `export.ts` on this pass — they are one scorecard, not a CRUD folder. Do **not** pull leftover Agent ranking here so “every Agent unwind lives together.” Do **not** pull leftover named-report CSV here so “one flatten owns every spreadsheet.” If it later splits: `scoreTheseLiveAgentsByBinderOnBookingsInThisDateRange.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `export.ts`

`getAgentSalesReport` / `exportAgentSalesReportCsv` / `computeTotals` / `exactRegex` are executor mechanics. The owner questions are: *I asked how each Agent sold on the live Bookings between these two dates. Take only the live Bookings. If I named Agents, keep those names only — exact, ignore case. Unwind who shares each Booking. Binder is this Agent’s share. Deposit rides each allocation row. Leads here means booked deals — live Form and Call Leads have no Agent link. Rank by Binder. Print every Agent who sold, not a top fifty. Then I can download the same table with a TOTAL row. This file does not pick historical. This file does not add two collections. This file does not take leftover chips. This file does not rank by Deposit. This file does not pin the Agents desk. This file does not go through the leftover named-report dispatcher.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking / Receiver-Agent ranking / texted-Lead booking rate, leftover filters / merge / named-report CSV / Lead Cost, leftover scope pick, already-recommended Agents desk credits, already-recommended who-shares-the-Binder writes, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two exports of one “score these live Agents by Binder on Bookings in this date range” story, not “an agent-sales CRUD report service,” and not the leftover Agent ranking:

1. **Score these live Agents by Binder on Bookings in this date range** — `getAgentSalesReport`. Hard-code leftover `getAdminModels` to the live Admin model set (the leftover `database_scope` that is not historical). Required leftover `from`/`to` become `$match book_date`. Optional leftover `agents[]` becomes leftover `exactRegex` (`^…$` `/i` after trim + escape) on `agent_allocations.agent_name_snapshot` before unwind, then again on filled `agent_name` after unwind. `$set is_cancelled` from leftover `cancelled != null`. `$unwind` `agent_allocations`. Treat a null/empty snapshot as `"unknown"`. When no names were handed, leftover `$match agent_name != ""` (dead after the unknown fill). `$group` `_id` is the raw snapshot string. Sum `booked_deals` (`$sum: 1` after unwind), `cancelled_bookings` (`$cond` leftover `is_cancelled`), allocation `binder_amount`, Booking `deposit_amount` on each unwound row. Project `leads` as a copy of `booked_deals`, `active_bookings` as `$subtract` (no `max`), Mongo `$round` money to 2. `$sort` Binder desc, `booked_deals` desc, `agent_name` asc. **No `$limit`.** Stamp leftover live `database_scope`, ISO `from`/`to`, the handed `agents` list, `generated_at`, `{ items }`, and leftover `computeTotals`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never opens form / call / cancelled / agents models, and never calls leftover `concreteScopes` / leftover `bookedLeadPrefix` / leftover `mergeAnalyticsPayload`.

2. **Flatten that same scorecard to a spreadsheet with a TOTAL row** — `exportAgentSalesReportCsv`. **Ask** the same scoring. Append `{ agent_name: "TOTAL", ...totals }`. Leftover `toCsv` on leftover `CSV_COLUMNS` (`agent_name`, `leads`, `booked_deals`, `active_bookings`, `cancelled_bookings`, `total_binder_amount`, `total_deposit_amount`). Filename is `agent-sales-{from}_{to}.csv` from the ISO date slices. Wave B **asks** this on the dedicated export route — leftover named-report CSV never sees this card.

There is no third owner operation. `computeTotals` sums leftover `NUMERIC_FIELDS` in process and leftover-`roundMoney`s Binder / Deposit. `exactRegex` is the name fence, not a public **seam**. Combined add does not exist here. Do not export leftover `bookedLeadPrefix` from this file as if this story owned every Booking chip. Do not export leftover `exportAnalyticsReportCsv` from this file as if this story owned every spreadsheet.

## Organization

Keep one file. This is the screenplay for “score these live Agents by Binder on Bookings in this date range, then flatten that same card.” Leftover Agent ranking, leftover booked prefix, leftover combined add, leftover named-report dispatch, leftover named-report CSV, Agents desk credits, who-shares-the-Binder writes, and home Overview already live in deeper **modules**. Do not pull those in. Do not invent an `AgentSalesReportService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix`. Do not invent a CSV **adapter** beside leftover `toCsv`. Do not invent a desk **adapter** beside already-recommended `tallyThisAgentsBookingsForTheDesk`.

Do not split this by HTTP vs download. The spreadsheet is the same scoring with a TOTAL row. Do not move this into `admin/` so “the Admin Dashboard folder owns every Agent table.” Do not add leftover Agent ranking / desk / Receiver-Agent cases here. Do not add an `"agent-sales"` case to leftover `analyticsReportSchema` so “one report enum owns the dashboard.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getAgentSalesReport` | `scoreTheseLiveAgentsByBinderOnBookingsInThisDateRange` | Wave B **asks** the `{ items, totals }` card |
| `exportAgentSalesReportCsv` | `flattenThisLiveAgentSalesScorecard` | Wave B **asks** the same card as leftover `toCsv` + TOTAL |

Keep the old names as one-line aliases until Wave B `v1.routes.ts` migrates. Do not make callers learn `$unwind` / `computeTotals` / `exactRegex` as the domain language. Keep the barrel export — Wave B already **asks** this file. Do not hide these behind leftover `getAnalyticsReport` so “every chart goes through the switch.”

`flattenThisLiveAgentSalesScorecard` should keep calling the same scoring. Do not keep a second copy of the pipeline.

**No class for the workflow.** The types that *do* earn a name are the card the Admin Dashboard already paints:

```ts
type ThisAgentsLiveSalesScore = {
  agent_name: string             // raw snapshot; "" / null became "unknown"
  leads: number                  // copy of booked_deals — not Form / Call Leads
  booked_deals: number           // allocation rows after unwind, not distinct Bookings
  cancelled_bookings: number     // those rows whose Booking has a Cancellation ref
  active_bookings: number        // booked_deals - cancelled_bookings (no max)
  total_binder_amount: number    // this Agent’s allocation shares, Mongo $round 2
  total_deposit_amount: number   // Booking deposit on each unwound row, Mongo $round 2
}

type TheseLiveAgentSales = {
  database_scope: string         // leftover live Admin scope, hard-coded
  from: string                   // query.from.toISOString()
  to: string                     // query.to.toISOString()
  agents: string[]               // handed names, or []
  generated_at: string
  items: ThisAgentsLiveSalesScore[]
  totals: Omit<ThisAgentsLiveSalesScore, "agent_name">  // sum of items, leftover-roundMoney on money
}
```

That is the handoff from “we scored the matching live allocation rows” to “paint Agent Sales, or download it.” A quiet Agent is omitted, not a zero row. There is no historical half and no leftover combined merge.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// agentSalesReport.service.ts
// The owner asked how each Agent sold
// on the live Bookings between these two dates.
// Take only the live Bookings.
// If they named Agents, keep those names only —
// exact, ignore case.
// Unwind who shares each Booking.
// Binder is this Agent’s share.
// Deposit rides each allocation row.
// Leads here means booked deals —
// live Form and Call Leads have no Agent link.
// Rank by Binder.
// Print every Agent who sold, not a top fifty.
// Then they can download the same table
// with a TOTAL row.
// This file does not pick historical.
// This file does not add two collections.
// This file does not take leftover chips.
// This file does not rank by Deposit.
// This file does not pin the Agents desk.

// ── 1. Score these live Agents by Binder on Bookings in this date range ─

export async function scoreTheseLiveAgentsByBinderOnBookingsInThisDateRange(query)

async function takeTheLiveBookingsInThisDateRange(query)
  // leftover getAdminModels(live); book_date $gte/$lte
function keepOnlyTheNamedAgents(names)              // exact /^…$/i on snapshot, then again after unwind
function unwindWhoSharesEachBooking()
function treatABlankSnapshotAsUnknown(allocation)   // null / "" → "unknown"
function groupByTheRawSnapshotName()                // not $toLower
function creditBinderAsThisShareAndDepositOnEveryRow()
function copyBookedDealsOntoLeads()                 // leads = booked_deals
function rankByBinderWithNoCut()
function sumTheAgentRows(items)                     // leftover computeTotals

// ── 2. Flatten that same scorecard to a spreadsheet with a TOTAL row ─

export async function flattenThisLiveAgentSalesScorecard(query)
  // same scoring, then leftover toCsv + TOTAL
```

Read the scoring path out loud: *The owner asked for Agent Sales on the live Bookings between these two dates, and maybe a short list of names. Open the live booked model. Match `book_date`. If they named Agents, keep Bookings that already carry one of those snapshots, then unwind, then keep only those names. A blank snapshot is “unknown.” Count each remaining allocation row as a booked deal. Copy that count onto leads — live Form and Call Leads have no Agent. Binder is that row’s share. Deposit is the Booking’s Deposit on that row. Cancelled means the Booking already has a Cancellation ref. Group by the snapshot spelling as stored. Rank by Binder. Do not cut fifty. Hand `{ items, totals }` back. The download is that same card plus a TOTAL row. Historical, leftover chips, ranking by Deposit, pinning the Agents desk, and the leftover named-report dispatcher live next door.*

That is the operation. `getAgentSalesReport` is not a different story. `exportAgentSalesReportCsv` is not a second unwind. Live-only is not a leftover `database_scope` chip this file reads from the request.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` / `export*` are executor names.** The owner asked to score these live Agents by Binder on Bookings in this date range, or to flatten that same card. The names should say that. Do not teach Wave B `getAgentSalesReport` as if this file owned leftover `getAnalyticsReport`.

2. **`leads` is a copy of `booked_deals`, and `booked_deals` is allocation rows.** After `$unwind`, `$sum: 1`. Two allocations for the same Agent on one Booking count two. The file comment says one booked deal == one booked lead because live Form / Call Leads have no Agent link. That is why this file never opens those collections — it is not why `$sum: 1` after unwind is a distinct Booking. Do not silently two-stage-group here so “leads means distinct Bookings,” and do not `$lookup` form / call so “leads means Leads.”

3. **Deposit rides each unwound allocation row.** `total_deposit_amount` sums `$deposit_amount` after unwind. Two Agents on one Booking each receive the full Deposit. The same Agent twice on one Booking doubles it. Already-recommended Agent ranking does the same. Already-recommended desk credits now `$first` deposit per Booking. Do not silently `$first` here so “once means once,” and do not split Deposit the way Binder is split so “both money fields feel the same.”

4. **Binder is this Agent’s share, not the Booking total.** `$sum` of `agent_allocations.binder_amount`. Already-recommended Source Company / Revenue Trend / Summary sum `$total_binder_amount` once per Booking. Do not switch to the Booking total here so “Agent Sales matches Source Company,” and do not unwind those other reports so “every table shares allocations.”

5. **This file groups by the raw snapshot; the name fence is `/i`; the desk folds.** `Alice Agent` and `alice agent` stay two rows. Leftover `exactRegex` would keep both when the owner typed either spelling. Already-recommended desk credits `$toLower` + trim. Do not silently `$toLower` this `$group` so “the report matches the desk,” and do not fold the optional `agents[]` fence so “the filter matches the group key.”

6. **There is no `$limit` 50.** Already-recommended Agent ranking always cuts fifty and sorts Deposit. This file sorts Binder and prints everyone who sold. Do not add a `$limit 50` so “Agent Sales matches Agent Performance,” and do not point Wave B `GET /api/v1/admin/reports/agent-sales` at leftover `getAgentPerformance`.

7. **This file never asks leftover `bookedLeadPrefix`.** Date is leftover `book_date` only. There is no source / merchant / local / lead-type / leftover `agent` chip. Optional names are leftover `agents[]`, not leftover `query.agent`. Do not import leftover prefix here so “every Booking table shares chips,” and do not teach leftover `analyticsQuerySchema` to this route.

8. **Live models are hard-coded.** Leftover `getAdminModels` is called with the leftover live Admin scope. The request has no `database_scope`. Historical never runs. Combined never runs. Do not teach this file leftover `concreteScopes` so “Agent Sales can add,” and do not add `database_scope` to leftover `agentSalesReportQuerySchema` so “every report shares the chip.”

9. **`$match agent_name != ""` is dead when no names were handed.** The previous `$set` already turned null / `""` into `"unknown"`. Do not add a second blank skip so “unknown disappears,” and do not drop the `"unknown"` bucket so “empty snapshots vanish.” A catalog Agent actually named `unknown` inherits those rows.

10. **Selecting `unknown` cannot see the filled bucket.** The pre-unwind `$match` looks at leftover `agent_allocations.agent_name_snapshot`. Blank snapshots are null / `""`, not `"unknown"`. A handed `agents=["unknown"]` therefore drops those Bookings before unwind. Do not move the unknown fill before the first `$match` so “the name fence can pick blanks,” and do not drop the pre-unwind `$match` so “every Booking unwinds first” without proving the current two-step fence.

11. **The pre-unwind name fence keeps the whole Booking, then rematch drops the other shares.** A Booking with Alice and Bob, filtered to Alice, still `$unwind`s Bob, then drops Bob. Alice’s Deposit is still the full Booking Deposit. Do not `$filter` the array before unwind so “we never see Bob,” unless a later sitting proves that changes counts.

12. **`active_bookings` is `$subtract` without `max`.** Already-recommended Summary uses `max`. Leftover Agent ranking uses `$subtract` too. Do not wrap this `$subtract` in `max` so “every report matches Summary.”

13. **CSV TOTAL is the sum of Agent rows, not distinct Bookings.** Two Agents on one Booking add two `booked_deals` and two Deposits into TOTAL. Do not `$group` the download so “TOTAL is distinct Bookings,” and do not hide TOTAL so “JSON owns the only sum.”

14. **This file owns its CSV.** Leftover `analyticsExport.service.ts` never sees `"agent-sales"`. Wave B has a dedicated `GET /api/v1/admin/exports/reports/agent-sales.csv`. Do not route that path through leftover `exportAnalyticsReportCsv` so “one flatten owns every spreadsheet,” and do not add Agent Sales columns to leftover named-report CSV.

15. **The barrel exports these two.** Already-recommended named reports stay hidden behind leftover `getAnalyticsReport`. Wave B **asks** this file. Do not remove the barrel export so “Wave B must learn the dispatcher,” and do not add `"agent-sales"` to leftover `analyticsReportSchema` so “the switch owns Agent Sales.”

16. **Already-recommended Agent ranking is not this story.** Leftover `getAgentPerformance` takes handed models + leftover chips, sorts Deposit, cuts fifty, and does not flatten. Do not import it here so “every Agent unwind lives together,” and do not point Wave B `GET /api/v1/admin/analytics/agent-performance` at this file.

17. **Already-recommended desk credits are not this story.** Current `agentBrowseMetrics.service.ts` matches the page’s folded names, then groups `{ agent_key, booking_id }` before the Agent. Do not copy that two-stage group here, and do not point Wave B `GET /api/v1/admin/reports/agent-sales` at the desk Map.

18. **Tests never call these two exports.** There is no `agentSalesReport.service.test.ts`. Leftover `analytics.service.test.ts` never mentions `agent-sales`. Live-only models, `leads` = `booked_deals`, Binder sort, no 50-cut, and deposit-per-row are unproven at this **interface**.

19. **Leave sibling modules alone.** Leftover `numberValue` / leftover `roundMoney` stay in later `analyticsFilters.ts`. Leftover `toCsv` stays in leftover `utils/csv`. Scope pick stays in leftover `adminScope.service.ts`. Named-report dispatch, Agent ranking, desk credits, named-report CSV flatten, and other named reports stay in their files. This file orchestrates leftover live models → date match → optional name fence → unwind → raw-name group → Binder rank → optional TOTAL flatten.

20. **Do not treat leftover Lead Cost as this story.** Later `getLeadCost` sums stored CPL for Overview. Do not import it here, and do not teach that file allocation snapshots.

21. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ items }` by Agent.

## Testing

The **interface** is the test surface: `scoreTheseLiveAgentsByBinderOnBookingsInThisDateRange` (`getAgentSalesReport`) and `flattenThisLiveAgentSalesScorecard` (`exportAgentSalesReportCsv`). The `{ items, totals }` card and the `{ filename, csv }` pair are part of that **interface**.

Today there is no `agentSalesReport.service.test.ts`. Fill the gap the story names make obvious:

**Score these live Agents by Binder on Bookings in this date range**
- **Asks** leftover `getAdminModels` once, on the leftover live Admin scope, then aggregates leftover `models["booked-leads"]` — does **not** query form / call / cancelled / agents collections.
- Pipeline `$match`es leftover `book_date` `$gte`/`$lte` from required `from`/`to`. Does **not** mention leftover `bookedLeadPrefix` fields (`source_company`, `merchant`, `local`, `lead_model`, leftover `agent`).
- Handed `agents: ["Alice Agent"]` puts leftover `/^Alice Agent$/i` on `agent_allocations.agent_name_snapshot` and again on filled `agent_name`.
- Blank / null snapshot becomes `"unknown"`. `$match agent_name != ""` does not drop that bucket when no names were handed.
- `$group` `_id` is the raw snapshot string, not `$toLower`. `Alice Agent` and `alice agent` stay two rows.
- `booked_deals` is leftover `$sum: 1` after unwind. `leads` equals `booked_deals`. Two allocations for the same Agent on one Booking: prove today’s count of two and doubled Deposit. Do not “fix” it into distinct Booking ids or Form / Call Leads.
- Binder is `$agent_allocations.binder_amount`. Deposit is `$deposit_amount` on each unwound row.
- `active_bookings` is `$subtract` without `max`.
- Sort is Binder desc, `booked_deals` desc, `agent_name` asc. Pipeline does **not** `$limit` 50.
- Stamps leftover live `database_scope`, ISO `from`/`to`, handed `agents`, `generated_at`, `{ items }`, and totals that leftover-`roundMoney` Binder / Deposit.
- Empty items → numeric totals at 0.
- Does **not** call leftover `concreteScopes` / leftover `mergeAnalyticsPayload` / leftover `getAnalyticsReport`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Flatten that same scorecard to a spreadsheet with a TOTAL row**
- **Asks** the same scoring, then leftover `toCsv` on leftover `CSV_COLUMNS`.
- Last row is `agent_name: "TOTAL"` plus the same totals.
- Filename is `agent-sales-{YYYY-MM-DD}_{YYYY-MM-DD}.csv` from the ISO date slices.
- Does **not** call leftover `exportAnalyticsReportCsv`.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of two Agent-ranking lists — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover named-report CSV columns — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert leftover Agent ranking `$limit` 50 / Deposit sort / leftover chips — that is already-recommended `agentPerformance.service.ts`.
- Do **not** assert already-recommended desk two-stage distinct Booking + `$first` deposit — that is `agentBrowseMetrics.service.ts`.
- Do **not** assert leftover Lead Cost stored-CPL seed — that is a later sitting (`leadCost.service.ts`).
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.
- Do **not** assert leftover Overview `top_agents` — that is already-recommended `overview.service.ts`.

Do **not** add a test per helper (`takeTheLiveBookingsInThisDateRange`, `keepOnlyTheNamedAgents`, `copyBookedDealsOntoLeads`, `sumTheAgentRows`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover Agent ranking 50-cut, leftover desk page `$in`, leftover Summary rates, leftover named-report CSV flatten, or RingCentral reconcile here.

## What I would not do

- An `AgentSalesReportService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$unwind`.
- Moving this into a CRUD folder, or into `admin/` / `agents/` “because those also unwind allocations.”
- Splitting `getAgentSalesReport` and `exportAgentSalesReportCsv` into two files or two aggregations.
- Pulling leftover filters / merge / Overview / dispatcher / named-report CSV / Agent ranking / desk credits into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Adding `"agent-sales"` to leftover `analyticsReportSchema`, or pointing Wave B `GET /api/v1/admin/analytics/agent-performance` at this file.
- Pointing Wave B `GET /api/v1/admin/reports/agent-sales` at leftover `getAgentPerformance` or leftover `getAnalyticsReport`.
- Routing the dedicated CSV through leftover `exportAnalyticsReportCsv` so “one flatten owns every spreadsheet.”
- Copying the desk’s two-stage distinct-Booking + `$first` deposit here so “the report matches the desk.”
- Folding snapshot names with `$toLower` so “the report matches the desk.”
- Adding a `$limit 50` or Deposit sort so “Agent Sales matches Agent Performance.”
- Switching Binder to `BookedLead.total_binder_amount` so “Agent Sales matches Source Company.”
- `$lookup`ing form / call so “leads means Leads.”
- Importing leftover `bookedLeadPrefix` so “every Booking table shares chips.”
- Treating leftover Agent ranking, leftover Receiver-Agent ranking, already-recommended desk credits, leftover Lead Cost, leftover Overview last-week by-source, leftover named-report CSV, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
