# Chart This Period's Bookings By Day Or Month — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 4 of this service — `revenueTrend.service.ts`
- Remaining in this service: `sourcePerformance.service.ts`, `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/revenueTrend.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`revenue-trend`: booked, period from `report_date` via leftover `trendDateExpression` — `%Y-%m` default, `%Y-%m-%d` when `granularity=day`. Query table: `granularity` is the **revenue-trend** date format. Booking date-range field is leftover `book_date` via `directBookedLeadMatch`. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ items }` by `period` lives in leftover merge, not here). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/revenue-trend` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (all-time + live last week — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (`summary.service.ts` counts four collections into one `{ totals }` bag — **does not** bucket by period). Distinct from leftover booked-prefix / day-or-month format: later `analyticsFilters.ts` (this file **asks** `bookedLeadPrefix` and `trendDateExpression`). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload("revenue-trend")` keyed on `period`; this file never adds collections). Distinct from leftover Receiver-Agent Trend: later `receiverAgentPerformance.service.ts` (`receiver-agent-trend` also **asks** leftover `trendDateExpression`, but on Form / Call Leads + Receiver Agent — historical unsupported). Distinct from leftover booking-cancellation-ratio: later `cancellationAnalytics.service.ts` (booked `is_cancelled` overall / by source — no period buckets). Distinct from leftover source / agent / geographic / SMS reports. Distinct from leftover Agent Sales: later `agentSalesReport.service.ts` (live models, required `from`/`to`, unwind allocations). Distinct from leftover Lead Cost: later `leadCost.service.ts` (overview only). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits `period` / bookings / cancelled_bookings / deposit / binder / cancellation_rate. Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file never nests and never seeds empty months). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a revenue-trend Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "revenue-trend"`). Barrel `analytics/index.ts` does **not** export `getRevenueTrend`. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport("revenue-trend")` — `GET /api/v1/admin/analytics/revenue-trend`; `analyticsQuerySchema`, `granularity` default `month`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/revenue-trend.csv`). Already-recommended Overview / leftover Agent Sales / leftover Summary do **not** import this file. Tests: **no** `revenueTrend.service.test.ts`. `analytics.service.test.ts` names the report string, leftover `granularity: "day"` parse, and leftover `mergeAnalyticsPayload("revenue-trend")` by `period` — **does not call `getRevenueTrend`**.
- Seams callers need: chart-these-buckets (`getRevenueTrend`: one `{ items }` list for already-scoped models + chips + day-or-month) vs run-this-named-report (already-recommended dispatcher **asks** this, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no CSV-column **seam**. There is no Receiver-Agent **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~39-line file is one sitting if you read it as chart this period's matching bookings, deposits, and cancellations by day or month. Do **not** split day vs month into `getDailyTrend.ts` / `getMonthlyTrend.ts`. Do **not** pull leftover filters / merge here so “the chart owns the match.” Do **not** pull leftover Receiver-Agent Trend here so “every trend lives together.” If it later splits: `chartThisPeriodsBookingsByDayOrMonth.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getRevenueTrend` is executor mechanics. The owner question is: *I asked for the Revenue Trend. Take the Bookings that match these chips. Bucket them by month, or by day if I asked. The period comes from Book Date, or timestamp when Book Date is missing. Count bookings and how many of those Bookings already have a Cancellation. Add Deposit and Binder. Cancellation rate is cancelled Bookings over Bookings. A month with no matching Booking does not appear. This file does not pick live versus historical. This file does not add the two collections. This file does not paint the home Overview. This file does not chart Receiver Agents. This file does not flatten a spreadsheet. This file does not reconcile RingCentral call counts.*

Already-recommended dispatcher / Overview / Summary, leftover filters / merge / CSV / Agent Sales / Lead Cost / other named reports, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “chart this period's bookings by day or month” story, not “a revenue-trend CRUD report service,” and not the Receiver-Agent Trend:

1. **Bucket matching Bookings by day or month** — `getRevenueTrend` (bucket half). Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. **Ask** leftover `bookedLeadPrefix` (`book_date` range + employee-snapshot source order + `is_cancelled`). `$set` `report_date` to `$book_date` if present, else `$timestamp`. `$group` on leftover `trendDateExpression(query)` — `$dateToString` of `$report_date` as `%Y-%m` unless leftover `granularity` is `day` (`%Y-%m-%d`). Sum `bookings`, `cancelled_bookings` (`$cond` leftover `is_cancelled`), `total_deposit_amount`, `total_binder_amount` (`$ifNull` 0). This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never counts Form / Call Leads or Cancellation rows, and never calls `concreteScopes` / `getAdminModels`.

2. **Derive cancellation rate and sort the buckets** — still `getRevenueTrend`. Project `period` from the group id. Mongo `$round` deposit and binder to 2. `cancellation_rate` is `cancelled_bookings / bookings`, or `0` when bookings is `0`. `$sort` `period` ascending. Return `{ items }`. Empty months and empty days are omitted — there is no leftover catalog-style zero seed.

There is no third owner operation. Combined add of two `{ items }` lists is leftover merge after the leftover dispatcher calls this twice (`period` key, leftover `localeCompare` sort). Do not export leftover `trendDateExpression` from this file as if this story owned every period chart. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases.

## Organization

Keep one file. This is the screenplay for “chart this period's bookings by day or month.” Chip match, day-or-month format, combined add, home Overview, named-report dispatch, Receiver-Agent Trend, Agent Sales, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `RevenueTrendService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix`. Do not invent a calendar **adapter** beside leftover `trendDateExpression`.

Do not split this by granularity. Day buckets and month buckets are beats of one chart. Do not move this into `admin/` so “the Admin Dashboard folder owns every chart.” Do not add Overview / Agent Sales / Receiver-Agent cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getRevenueTrend` | `chartThisPeriodsBookingsByDayOrMonth` | leftover dispatcher **asks** the same `{ items }` list |

Keep the old name as a one-line alias until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$group` / `bookedLeadPrefix` / `trendDateExpression` as the domain language. Do not export this from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

**No class for the workflow.** The type that *does* earn a name is one period row the Admin Dashboard already paints:

```ts
type ThisPeriodsBookingRevenueBucket = {
  period: string                 // leftover %Y-%m, or %Y-%m-%d when day
  bookings: number
  cancelled_bookings: number     // BookedLead.cancelled set (is_cancelled)
  total_deposit_amount: number   // Mongo $round 2
  total_binder_amount: number    // booking total, not unwound allocation
  cancellation_rate: number      // cancelled_bookings / bookings
}

type ThisPeriodsBookingRevenueChart = { items: ThisPeriodsBookingRevenueBucket[] }
```

That is the handoff from “we bucketed the matching Bookings” to “paint the Revenue Trend.” Combined `items` is leftover merge of two of these lists by `period`, not a third database this file sees. A quiet month is missing, not a zero row.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// revenueTrend.service.ts
// The owner asked for the Revenue Trend.
// Take the Bookings that match these chips.
// Bucket them by month, or by day if they asked.
// The period comes from Book Date, or timestamp when Book Date is missing.
// Count bookings and how many already have a Cancellation.
// Add Deposit and Binder.
// A month with no matching Booking does not appear.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not chart Receiver Agents.

// ── 1. Bucket matching Bookings by day or month ───────────

export async function chartThisPeriodsBookingsByDayOrMonth(models, query)

async function takeTheMatchingBookings(models, query)
  // asks leftover bookedLeadPrefix (book_date + chips + is_cancelled)
function nameThePeriodClockOnEachBooking()
  // report_date = book_date ?? timestamp
function bucketThoseBookingsByDayOrMonth(query)
  // asks leftover trendDateExpression; sums bookings / cancelled_bookings / deposit / binder

// ── 2. Derive cancellation rate and sort the buckets ──────

function rateEachBucketAndSortOldestFirst()
  // cancellation_rate = cancelled_bookings / bookings
  // empty months stay absent
```

Read the chart path out loud: *The owner asked for the Revenue Trend on a database someone else already picked, plus leftover chips, plus day or month. Take matching Bookings on leftover `book_date` prefix. Name each Booking’s period from Book Date, falling back to timestamp. Bucket by leftover month string, or leftover day string if they asked. Count bookings and cancelled Bookings. Add Deposit and Binder. Cancellation rate is cancelled Bookings over Bookings. Sort oldest period first. A quiet month does not appear as zero. Hand `{ items }` back. Live versus historical, adding the two collections, painting the home, charting Receiver Agents, and flattening a spreadsheet live next door.*

That is the operation. `getRevenueTrend` is not a different story. Combined is not a third System of Record this file merges. Receiver-Agent Trend is not this chart.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getRevenueTrend` is an executor name.** The owner asked to chart this period’s Bookings by day or month. The name should say that. Do not teach Wave B `getRevenueTrend` as if this file owned the leftover dispatcher envelope.

2. **The filter clock and the bucket clock can disagree.** Leftover `bookedLeadPrefix` ranges on `book_date`. The group clock is `report_date` (`book_date` else `timestamp`). Knowledge already tables both. Current `BookedLead` requires `book_date`, so live docs usually match. Historical rows that only have `timestamp` can miss the window and still, when they pass, bucket on `timestamp`. Do not silently force leftover `trendDateExpression` onto `book_date` so “one clock owns the chart,” and do not move leftover `from` / `to` onto `report_date` in this rename.

3. **`$dateToString` is UTC.** Leftover `trendDateExpression` does not set a timezone. Already-recommended Overview last week uses server-local midnight. A Booking just after Eastern midnight can land in yesterday’s UTC day bucket. Do not “fix” leftover timezone in this rename, and do not import Overview’s `rollingLast7DaysWindow` so “one clock owns every chart.”

4. **Quiet months are omitted, not zero.** Leftover source-company reports seed catalog zeros. This file only emits periods that have a matching Booking. A January-through-March request with no February Bookings returns two rows. Do not seed empty days / months here so “the chart owns the calendar,” and do not import leftover `nestObservedSourceRows` so “zeros mean the same thing.”

5. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover `mergeAnalyticsPayload("revenue-trend")` after two calls, keyed on `period` (leftover `normalizeDimensionKey` + `localeCompare`). Do not call leftover merge here so “the chart file can add,” and do not teach this file `concreteScopes`.

6. **`cancellation_rate` is cancelled Bookings over Bookings.** The `$cond` uses leftover `is_cancelled` (`BookedLead.cancelled` set). This file never **asks** leftover `cancelledLeadPrefix`. Do not count Cancellation rows per period so “the row count is the rate,” and do not import leftover `getBookingCancellationRatio` so “cancellation means cancellation.”

7. **`granularity` defaults to month in leftover Zod, not here.** Empty / omitted `granularity` is already `month` before this file runs. Day is the exception. Do not default `day` here so “a trend is daily,” and do not read `query.granularity` past leftover `trendDateExpression`.

8. **Receiver-Agent Trend is not this story.** Later `getReceiverAgentTrend` **asks** the same leftover `trendDateExpression` on Form / Call Leads plus Receiver Agent. Historical returns the leftover unsupported card. Do not import it here so “every trend lives together,” and do not teach this file `receiver_agent`.

9. **Binder is the Booking total, not an unwound allocation.** Leftover Agent Performance / Agent Sales credit allocation `binder_amount` and can double Deposit. This file sums `$total_binder_amount` / `$deposit_amount` once per Booking. Do not unwind `agent_allocations` here so “Revenue Trend matches Agent Sales.”

10. **Mongo `$round` is not leftover `roundMoney`.** Already-recommended Summary **asks** leftover `roundMoney`. This file rounds in the aggregation. Combined leftover merge then leftover-`roundMoney`s the sums. Do not switch this file to leftover `roundMoney` in this rename just to match Summary, and do not “fix” leftover merge rounding here.

11. **CSV sibling asks the leftover dispatcher, then lists the six columns.** Leftover `CSV_COLUMNS["revenue-trend"]` is `period`, `bookings`, `cancelled_bookings`, `total_deposit_amount`, `total_binder_amount`, `cancellation_rate`. Do not flatten columns here so “the chart file owns download,” and do not add a `granularity` column in this rename.

12. **Overview does not ask this.** Already-recommended `paintTheAdminDashboardHomeOverview` **asks** leftover Summary / Lead Cost / top agents / last-week nest. It never imports this file. Do not paint `last_7_days` buckets here so “Revenue Trend owns the home,” and do not point Wave B `GET .../analytics/overview` at this file.

13. **Tests never call this export.** There is no `revenueTrend.service.test.ts`. Leftover `analytics.service.test.ts` parses the report name and leftover-merges two `{ period: "2026-01" }` bags — it never **asks** `getRevenueTrend`. The bucket list is unproven at the **interface**. Do not treat leftover merge-by-period as proof this file asked leftover `bookedLeadPrefix`.

14. **Leave sibling modules alone.** `bookedLeadPrefix` / `trendDateExpression` stay in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Receiver-Agent Trend, Agent Sales, Lead Cost, CSV flatten, and other named reports stay in their files. This file orchestrates prefix → name the clock → bucket → rate → sort.

15. **Do not treat leftover booking-cancellation-ratio as this story.** Later `getBookingCancellationRatio` is booked `is_cancelled` overall / by source, not by period.

16. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ items }` period buckets.

## Testing

The **interface** is the test surface: `chartThisPeriodsBookingsByDayOrMonth` (`getRevenueTrend`). The `{ items }` list is part of that **interface**.

Today no test calls `getRevenueTrend`. Fill the gap the story names make obvious:

**Bucket matching Bookings by day or month**
- **Asks** leftover `bookedLeadPrefix(query)` on the handed booked model, then aggregates — does **not** query form / call / cancelled collections.
- `$set`s `report_date` to `book_date` when present, else `timestamp`.
- **Asks** leftover `trendDateExpression(query)`. Omitted leftover `granularity` buckets as `%Y-%m`. `granularity: "day"` buckets as `%Y-%m-%d`.
- Two Bookings in the same leftover month become one row. Two Bookings on different leftover days stay two rows when `day`.
- A month (or day) with no matching Booking is absent from `items`, not a zero row.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Derive cancellation rate and sort the buckets**
- `cancelled_bookings` counts leftover `is_cancelled`, not leftover cancelled-leads rows.
- `cancellation_rate` is `cancelled_bookings / bookings`. Zero bookings in a bucket (if one ever appeared) rates `0`, not `NaN`.
- Deposit and binder are Mongo-rounded to 2. Binder is `$total_binder_amount` once per Booking.
- `items` sort by `period` ascending (`2026-01` before `2026-02`; `2026-01-02` before `2026-01-10`).
- Leftover `lead_type: FormLead` still prefixes bookings with `lead_model` — this file does not skip the leftover prefix.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of two `{ period: "2026-01" }` bags — that is a later sitting (`analyticsMerge.ts`). The existing leftover test already covers that add.
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover `$dateToString` timezone — that is leftover `trendDateExpression`.
- Do **not** assert CSV headers — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert Overview `last_7_days: null` on historical — that is already-recommended `overview.service.ts`.
- Do **not** assert Receiver-Agent Trend historical unsupported — that is a later sitting (`receiverAgentPerformance.service.ts`).
- Do **not** assert Agent Sales live-only models — that is a later sitting (`agentSalesReport.service.ts`).
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`takeTheMatchingBookings`, `nameThePeriodClockOnEachBooking`, `rateEachBucketAndSortOldestFirst`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, or RingCentral reconcile here.

## What I would not do

- A `RevenueTrendService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$group`.
- Moving this into a CRUD folder, or into `admin/` “because the Admin Dashboard paints the chart.”
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten / Receiver-Agent Trend into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/overview` at this file, or pointing `GET /api/v1/admin/analytics/revenue-trend` past the leftover dispatcher.
- Splitting day vs month into two files or two HTTP reports.
- Seeding empty months / days so the chart looks like leftover catalog zeros.
- Forcing leftover `from` / `to` onto `report_date`, or leftover buckets onto `book_date` only, in this rename.
- “Fixing” leftover `$dateToString` UTC vs Overview local midnight in this rename.
- Unwinding `agent_allocations` so Revenue Trend matches Agent Sales.
- Counting Cancellation rows per period, or pointing `cancellation_rate` at leftover `cancellations`.
- Treating leftover booking-cancellation-ratio, leftover Receiver-Agent Trend, leftover Lead Cost, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
