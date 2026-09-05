# Score Each Source Company On Matching Bookings, And Walk Matching Leads Through To Bookings — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 5 of this service — `sourcePerformance.service.ts`
- Remaining in this service: `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/sourcePerformance.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`source-company-performance`: booked; `source-company-funnel`: form + call + booked; `lead-source-performance`: booked (`source_granularity_key`) — “groups by `source_granularity_key` and catalog `owner_label`, same hierarchy as source-company performance. Does not group by `booked_leads.source`.” Source company performance / funnel: leftover `nestObservedSourceRows` seeds every Filter Catalog Source Granularity in scope (zeros remain), then overlays observed metrics. Funnel also includes lead-level `sheet_*` counts from form/call refs plus **reconciled** booking aggregates. Parent totals = sum of children. Combined source-company merge keeps child `granularities`; company-only incoming rows become extra leaves; parent totals recompute from children. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ items }` by `source_company` lives in leftover merge, not here). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/{source-company-performance,source-company-funnel,lead-source-performance}` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (last-week by-source **asks** leftover nest on its own booked group — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** nest). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets — **does not** nest, omits quiet months). Distinct from leftover booked-prefix / lead match / rate helpers: later `analyticsFilters.ts` (this file **asks** `bookedLeadPrefix`, `leadMatchForQuery`, `numberValue`, `rate`, `roundMoney`). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file **asks** `nestObservedSourceRows`, `sourceCompanyFromRow`, `sourceGranularityFromRow`). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` keyed on `source_company` for all three report strings). Distinct from leftover booking-cancellation-ratio: later `cancellationAnalytics.service.ts` (booked `is_cancelled` overall / by source — **asks** leftover nest, not this file). Distinct from leftover Agent Performance: later `agentPerformance.service.ts` (unwind allocations, top 50). Distinct from leftover Agent Sales: later `agentSalesReport.service.ts` (live models, required `from`/`to`). Distinct from leftover Lead Cost: later `leadCost.service.ts` (overview only — **asks** leftover nest, not this file). Distinct from leftover Receiver-Agent source breakdown: later `receiverAgentPerformance.service.ts` (Form / Call Leads + Receiver Agent — historical unsupported). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits **leaves (including zeros) or a childless company, never both**. Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a source-performance Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "source-company-performance"` / `"source-company-funnel"` / `"lead-source-performance"`). Barrel `analytics/index.ts` does **not** export these three. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for those three strings — `GET /api/v1/admin/analytics/{source-company-performance,source-company-funnel,lead-source-performance}`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/{source-company-performance,source-company-funnel,lead-source-performance}.csv`). Already-recommended Overview / leftover Agent Sales / leftover Summary / leftover Lead Cost do **not** import this file. Tests: `sourcePerformance.service.test.ts` (historical company-only group id + company rates + empty `granularities` for performance and funnel — **does not call `getLeadSourcePerformance`**). `analytics.service.test.ts` leftover-merges `"source-company-performance"` / `"source-company-funnel"` and leftover-flattens those CSV trees — **does not call these three exports**.
- Seams callers need: score-these-source-companies (`getSourceCompanyPerformance`: one nested `{ items }` list for already-scoped booked models + chips) vs walk-matching-leads-through-bookings (`getSourceCompanyFunnel`: same nest after joining form / call / booked leaves) vs score-these-lead-sources (`getLeadSourcePerformance`: **the same booked scorecard** under a second HTTP name) vs run-this-named-report (already-recommended dispatcher **asks** one of the three, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam** — leftover `nestObservedSourceRows` already owns catalog zeros / company-only historical. There is no CSV-column **seam**. There is no Receiver-Agent **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~219-line file is one sitting if you read it as score each Source Company on matching Bookings, then walk matching Leads through to Bookings. Do **not** split the two booked scorecards into `getSourceCompanyPerformance.ts` / `getLeadSourcePerformance.ts` — they are the same aggregation. Do **not** pull leftover nest / filters / merge here so “the scorecard owns the catalog.” Do **not** pull leftover Overview last-week by-source here so “every source table lives together.” If it later splits: `scoreEachSourceCompanyOnMatchingBookings.ts` and `walkMatchingLeadsThroughToBookings.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getSourceCompanyPerformance` / `getSourceCompanyFunnel` / `getLeadSourcePerformance` are executor mechanics. The owner questions are: *I asked how each Source Company is doing. Take the Bookings that match these chips. Group them by Source Company, and by Source Granularity when this database has keys. Seed every catalog Source Granularity so a quiet child still appears as zero. Cancellation rate is cancelled Bookings over Bookings. Booking rate stays empty — this scorecard never counted Leads. I also asked for the funnel. Count matching Form Leads and Call Leads, including how many already have a booked or cancelled ref on the Lead. Overlay matching Bookings as reconciled counts, Deposit, and Binder. Booking rate is reconciled Bookings over Leads. The Lead-booked count and the Booking count can disagree. Historical stays company-only. This file does not pick live versus historical. This file does not add the two collections. This file does not paint the home Overview. This file does not flatten a spreadsheet. Lead Source Performance is the same booked scorecard under a second HTTP name.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend, leftover filters / nest / merge / CSV / Agent Sales / Lead Cost / other named reports, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Three exports of two “score each Source Company” stories, not “a source-performance CRUD report service,” and not three different aggregations:

1. **Score each Source Company on matching Bookings** — `getSourceCompanyPerformance` (and `getLeadSourcePerformance`, the same function). Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. Historical sets `supportsSourceGranularity` false; live / leftover combined-concrete keep it true. **Ask** leftover `bookedLeadPrefix` then `$group`: live `_id` is `{ derived_source_company, derived_source_granularity_key ?? "unknown" }`; historical `_id` is `$derived_source_company` only. Sum `bookings`, `cancelled_bookings` (`$cond` leftover `is_cancelled`), `total_deposit_amount`, `total_binder_amount` (`$ifNull` 0). **Ask** leftover `nestObservedSourceRows` with those four additive fields and `derivePerformanceRow`. Return `{ items }`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never counts Form / Call Leads or Cancellation rows, and never calls `concreteScopes` / `getAdminModels`.

2. **Walk matching Leads through to Bookings** — `getSourceCompanyFunnel`. In parallel: leftover `leadMatchForQuery("FormLead")` / `"CallLead"` grouped to `total_leads`, `booked_leads` (Lead `booked` ref set), `cancelled_leads` (Lead `cancelled` ref set), `over_2000_leads`, `over_4000_leads`; plus the same booked group as operation 1. Fold form + call into one map keyed `source|granularity` (`sourceCompanyFromRow` / `sourceGranularityFromRow`; historical granularity is `""`). Overlay booked rows as `reconciled_bookings` / `reconciled_cancelled_bookings` / deposit / binder. **Ask** leftover nest with those ten additive fields and `deriveFunnelRow`. Then sort companies by deposit descending. Return `{ items }`.

There is no third owner operation. `getLeadSourcePerformance` is not a third group-by. Knowledge’s “groups by `source_granularity_key`” is the same leftover nest both booked exports already **ask**. Combined add of two `{ items }` trees is leftover merge after the leftover dispatcher calls this twice (`source_company` key; children re-merged by `source_granularity_key`). Do not export leftover `nestObservedSourceRows` from this file as if this story owned the catalog. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases.

## Organization

Keep one file. This is the screenplay for “score each Source Company on matching Bookings, and walk matching Leads through to Bookings.” Chip match, catalog nest, combined add, home Overview, named-report dispatch, Agent Sales, Lead Cost, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `SourcePerformanceService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix` / `leadMatchForQuery`.

Do not split this by HTTP report string. The two booked scorecards are one aggregation with two leftover dispatcher names. Funnel is the second story in the same file because it overlays the same booked leaves. Do not move this into `admin/` so “the Admin Dashboard folder owns every source table.” Do not add Overview last-week / Lead Cost / cancellation-ratio cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getSourceCompanyPerformance` | `scoreEachSourceCompanyOnMatchingBookings` | leftover dispatcher **asks** the nested booked `{ items }` list |
| `getSourceCompanyFunnel` | `walkMatchingLeadsThroughToBookings` | leftover dispatcher **asks** the nested funnel `{ items }` list |
| `getLeadSourcePerformance` | `scoreEachLeadSourceOnMatchingBookings` | leftover dispatcher **asks** the **same** booked list under a second report string |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$group` / `bookedBySource` / `nestObservedSourceRows` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

`scoreEachLeadSourceOnMatchingBookings` should be a one-line alias of `scoreEachSourceCompanyOnMatchingBookings` until the leftover dispatcher drops one of the two HTTP names. Do not keep two copies of the booked pipeline.

**No class for the workflow.** The types that *do* earn a name are the two `{ items }` trees the Admin Dashboard already paints:

```ts
type ThisSourceCompanysBookingScore = {
  source_company: string
  source_company_label: string
  bookings: number
  cancelled_bookings: number     // BookedLead.cancelled set (is_cancelled)
  active_bookings: number        // max(bookings - cancelled_bookings, 0)
  total_deposit_amount: number   // leftover roundMoney
  total_binder_amount: number    // booking total, not unwound allocation
  booking_rate: null             // this scorecard never counted Leads
  cancellation_rate: number      // cancelled_bookings / bookings
  granularities: Array<{         // leftover nest children; historical []
    source_granularity_key: string
    source_granularity_label: string
    channel?: string | null
    // same additive + derived fields as the parent
  }>
}

type ThisSourceCompanysLeadToBookingWalk = {
  source_company: string
  source_company_label: string
  total_leads: number            // form + call
  form_leads: number
  call_leads: number
  sheet_booked_leads: number     // Lead.booked ref set
  sheet_cancelled_leads: number  // Lead.cancelled ref set
  over_2000_leads: number
  over_4000_leads: number
  reconciled_bookings: number    // BookedLead rows
  reconciled_cancelled_bookings: number
  total_deposit_amount: number
  total_binder_amount: number
  booking_rate: number           // reconciled_bookings / total_leads
  cancellation_rate: number      // reconciled_cancelled_bookings / reconciled_bookings
  granularities: Array<{ /* leftover nest children; historical [] */ }>
}
```

That is the handoff from “we grouped the matching rows” to “paint the Source Company table.” Combined `items` is leftover merge of two of these trees by `source_company`, not a third database this file sees. A quiet catalog child is a zero row on live; historical has no children.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourcePerformance.service.ts
// The owner asked how each Source Company is doing.
// Take the Bookings that match these chips.
// Group them by Source Company, and by Source Granularity
// when this database has keys.
// Seed every catalog child so a quiet Source Granularity
// still appears as zero.
// Cancellation rate is cancelled Bookings over Bookings.
// Booking rate stays empty — this scorecard never counted Leads.
// The funnel then walks matching Form Leads and Call Leads
// through to those Bookings.
// The Lead-booked count and the Booking count can disagree.
// Historical stays company-only.
// Lead Source Performance is the same booked scorecard
// under a second HTTP name.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not paint the home Overview.

// ── 1. Score each Source Company on matching Bookings ─────

export async function scoreEachSourceCompanyOnMatchingBookings(models, query)
export const scoreEachLeadSourceOnMatchingBookings =
  scoreEachSourceCompanyOnMatchingBookings

async function takeTheMatchingBookingsBySource(models, query)
  // asks leftover bookedLeadPrefix
  // live: group company + granularity (unknown if missing)
  // historical: group company only
function scoreEachBookingRow(row)
  // active_bookings = max(bookings - cancelled_bookings, 0)
  // booking_rate = null
  // cancellation_rate = cancelled_bookings / bookings
async function nestThoseScoresUnderTheCatalog(leaves, query)
  // asks leftover nestObservedSourceRows

// ── 2. Walk matching Leads through to Bookings ────────────

export async function walkMatchingLeadsThroughToBookings(models, query)

async function countMatchingFormAndCallLeadsBySource(models, query)
  // asks leftover leadMatchForQuery; Lead.booked / Lead.cancelled refs
async function joinThoseLeadCountsToTheMatchingBookings(leadLeaves, bookedLeaves)
  // key source|granularity; overlay reconciled_* / deposit / binder
function rateTheWalk(row)
  // booking_rate = reconciled_bookings / total_leads
  // cancellation_rate = reconciled_cancelled_bookings / reconciled_bookings
async function nestThoseWalksUnderTheCatalog(leaves, query)
  // asks leftover nestObservedSourceRows
function sortCompaniesByDeposit(items)
```

Read the scorecard path out loud: *The owner asked for Source Company Performance on a database someone else already picked, plus leftover chips. Take matching Bookings on leftover `book_date` prefix. Group by Source Company, and by Source Granularity when this is not historical. Nest under leftover catalog labels. Seed quiet children as zero on live. Cancellation rate is cancelled Bookings over Bookings. Booking rate is empty. Hand `{ items }` back. Lead Source Performance is the same list. The funnel then counts matching Form Leads and Call Leads, overlays those Bookings as reconciled, and rates Bookings over Leads. Live versus historical, adding the two collections, painting the home, and flattening a spreadsheet live next door.*

That is the operation. `getSourceCompanyPerformance` is not a different story. `getLeadSourcePerformance` is not a third group-by. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getSourceCompanyPerformance` and `getLeadSourcePerformance` are the same function.** Two leftover dispatcher names, one booked pipeline, one leftover nest, one `derivePerformanceRow`. Knowledge’s “groups by `source_granularity_key`” is leftover nest, not a second `$group`. Keep one implementation and a one-line alias. Do not invent a third aggregation so “Lead Source owns granularity.”

2. **`get*` is an executor name.** The owner asked to score each Source Company on matching Bookings, or to walk matching Leads through to Bookings. The names should say that. Do not teach Wave B `getSourceCompanyPerformance` as if this file owned the leftover dispatcher envelope.

3. **`booking_rate` on the booked scorecard is always `null`.** `derivePerformanceRow` hard-codes it. Leftover CSV for `source-company-performance` still emits the column. Leftover `lead-source-performance` CSV omits `booking_rate` and `active_bookings` even though the JSON still has both. Do not compute bookings-over-leads here so “every scorecard has a booking rate,” and do not drop `active_bookings` from the JSON so “Lead Source matches its CSV.”

4. **Sheet booked and reconciled Bookings can disagree.** Funnel `sheet_booked_leads` counts Form / Call Lead `booked` refs. `reconciled_bookings` counts leftover-prefixed BookedLead rows. A Lead can look booked without a matching Booking in the window, and a Booking can exist without the Lead ref. Funnel `booking_rate` uses reconciled over leads, not `sheet_booked_leads` over leads. Do not point `booking_rate` at `sheet_booked_leads` so “the Lead flag is the booking,” and do not drop `sheet_*` so “one booking number owns the funnel.”

5. **Historical is fenced twice.** This file sets `supportsSourceGranularity = query.database_scope !== "historical"` before `$group`. Leftover nest then company-onlys again when historical and no leftover granularity keys. Do not drop this file’s flag so “nest owns historical,” and do not teach leftover nest `database_scope` from here.

6. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover `mergeAnalyticsPayload` after two calls, keyed on `source_company` (leftover `normalizeSourceDimension`). Children re-merge by `source_granularity_key`; a company-only incoming row becomes an extra leaf; parent totals recompute from children. Do not call leftover merge here so “the scorecard file can add,” and do not teach this file `concreteScopes`.

7. **Quiet catalog children are zeros on live, omitted on historical.** Leftover nest `seedZeros` is false when historical. Already-recommended Revenue Trend omits empty months. Do not stop seeding zeros here so “source tables match Revenue Trend,” and do not seed historical zeros so “every report shows the catalog.”

8. **Funnel re-sorts by deposit after leftover nest already sorted.** Leftover default nest sort is deposit, then leftover `total_lead_cost`, then bookings, then label. Funnel then leftover-`numberValue` sorts deposit only. Equal-deposit companies can reorder. Do not pass leftover `sort` into nest and also re-sort. Pick one.

9. **`over_2000_leads` / `over_4000_leads` are JSON-only.** Funnel additive fields include them. Leftover funnel CSV does not. Do not add those columns in this rename so “download matches JSON,” and do not drop the sums so “CSV owns the funnel.”

10. **Binder is the Booking total, not an unwound allocation.** Leftover Agent Performance / Agent Sales credit allocation `binder_amount` and can double Deposit. This file sums `$total_binder_amount` / `$deposit_amount` once per Booking. Do not unwind `agent_allocations` here so “Source Company matches Agent Sales.”

11. **Overview last-week by-source is not this story.** Already-recommended `paintTheAdminDashboardHomeOverview` **asks** leftover nest on its own booked group (`bookings` + `total_deposit_amount` only). It never imports this file. Do not paint `last_7_days` here so “Source Company owns the home,” and do not point Wave B `GET .../analytics/overview` at this file.

12. **Leftover Lead Cost / cancellation-ratio also nest, and are not this story.** Later `leadCost.service.ts` and `cancellationAnalytics.service.ts` **ask** leftover `nestObservedSourceRows` themselves. Do not import them here so “every nested source table lives together.”

13. **Tests never call `getLeadSourcePerformance`.** `sourcePerformance.service.test.ts` proves historical company-only for performance and funnel. It never **asks** the third export. Leftover `analytics.service.test.ts` leftover-merges and leftover-flattens — it never **asks** these three. Live catalog-zero seed is unproven at this **interface**.

14. **Leave sibling modules alone.** `bookedLeadPrefix` / `leadMatchForQuery` / `rate` / `roundMoney` stay in later `analyticsFilters.ts`. Catalog nest / zero seed / label humanize stay in later `sourceHierarchy.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Agent Sales, Lead Cost, CSV flatten, and other named reports stay in their files. This file orchestrates booked group → (funnel join) → leftover nest → derive.

15. **Do not treat leftover Receiver-Agent source breakdown as this story.** Later `getReceiverAgentSourceBreakdown` groups Form / Call Leads by Receiver Agent + leftover granularity. Historical returns the leftover unsupported card.

16. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file nested `{ items }`.

## Testing

The **interface** is the test surface: `scoreEachSourceCompanyOnMatchingBookings` (`getSourceCompanyPerformance`), `walkMatchingLeadsThroughToBookings` (`getSourceCompanyFunnel`), and the one-line `scoreEachLeadSourceOnMatchingBookings` alias (`getLeadSourcePerformance`). The `{ items }` tree is part of that **interface**.

Today `sourcePerformance.service.test.ts` covers historical company-only for the first two exports. Fill the gap the story names make obvious:

**Score each Source Company on matching Bookings**
- **Asks** leftover `bookedLeadPrefix(query)` on the handed booked model, then aggregates — does **not** query form / call / cancelled collections.
- Live `$group` `_id` is `{ source_company: "$derived_source_company", source_granularity_key: $ifNull derived / "unknown" }`. Historical `_id` is `"$derived_source_company"`.
- **Asks** leftover `nestObservedSourceRows`. Historical items have `granularities: []`. Live items include leftover catalog children, including zeros.
- `cancellation_rate` is leftover `rate(cancelled_bookings, bookings)`. `booking_rate` is `null`. `active_bookings` is `max(bookings - cancelled_bookings, 0)`.
- Deposit and binder leftover-`roundMoney`. Binder is `$total_binder_amount` once per Booking.
- `getLeadSourcePerformance` returns the same `{ items }` as `getSourceCompanyPerformance` for the same models + chips.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Walk matching Leads through to Bookings**
- **Asks** leftover `leadMatchForQuery("FormLead")` and `"CallLead"` in parallel with the booked group.
- `sheet_booked_leads` counts Lead `booked` refs. `reconciled_bookings` counts booked-group `bookings`. A Lead-booked row without a matching Booking still increments `sheet_booked_leads` only.
- `booking_rate` is leftover `rate(reconciled_bookings, total_leads)`, not `sheet_booked_leads` over leads.
- `cancellation_rate` is leftover `rate(reconciled_cancelled_bookings, reconciled_bookings)`.
- Leftover `lead_type: FormLead` still runs both lead aggregates — leftover call match is empty, not skipped in this file.
- Companies sort by leftover `total_deposit_amount` descending after nest.
- Historical items have `granularities: []` and leftover-recomputed company rates.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of `"Main Site Forms"` + `"main_site"` into one company, or leftover parent-from-children recompute — that is a later sitting (`analyticsMerge.ts`). The existing leftover tests already cover that add.
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover catalog seed / `owner_label` / unknown-child keep — that is a later sitting (`sourceHierarchy.ts`). The existing leftover `sourceHierarchy.test.ts` already covers nest math.
- Do **not** assert CSV “leaves or a childless company, never both” — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert Overview `last_7_days` by-source — that is already-recommended `overview.service.ts`.
- Do **not** assert leftover Lead Cost catalog zeros — that is a later sitting (`leadCost.service.ts`).
- Do **not** assert leftover booking-cancellation-ratio overall card — that is a later sitting (`cancellationAnalytics.service.ts`).
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`takeTheMatchingBookingsBySource`, `joinThoseLeadCountsToTheMatchingBookings`, `scoreEachBookingRow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, or RingCentral reconcile here.

## What I would not do

- A `SourcePerformanceService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$group`.
- Moving this into a CRUD folder, or into `admin/` “because the Admin Dashboard paints the source table.”
- Splitting `getSourceCompanyPerformance` and `getLeadSourcePerformance` into two files or two aggregations.
- Pulling leftover filters / nest / merge / Overview / dispatcher / CSV flatten / Lead Cost / cancellation-ratio into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/overview` at this file, or pointing the three source report routes past the leftover dispatcher.
- Computing `booking_rate` on the booked scorecard from Leads so “every table has a rate.”
- Pointing funnel `booking_rate` at `sheet_booked_leads`, or dropping `sheet_*` / `reconciled_*` so one booking number remains.
- Stopping live catalog-zero seed so source tables match Revenue Trend’s omitted months.
- Unwinding `agent_allocations` so Source Company matches Agent Sales.
- Treating leftover booking-cancellation-ratio, leftover Lead Cost, leftover Receiver-Agent source breakdown, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
