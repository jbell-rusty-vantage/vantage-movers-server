# Price These Matching Form And Call Leads By Stored CPL, Grouped By Source Company — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 12 of this service — `leadCost.service.ts`
- Remaining in this service: `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/leadCost.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Lead cost: **overview only**, leftover live all-time / last-7-days. Sums stored **CPL**. Form Leads `duplicate: { $ne: true }`; Call Leads `created_on_unmatched: { $ne: true }`. Null `cpl` increments `unresolved_count` and contributes 0. Leftover live / scoped reports seed every catalog Source Granularity in scope (zeros remain); historical group id is company only when no granularity key exists. Role line on that Service is the leftover dispatcher, not this file — this file **is not** on leftover `analyticsReportSchema`). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — **does not** import this file; there is no `"lead-cost"` case). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (`overview.service.ts` **asks** this only when requested scope **and** concrete scope are leftover live; combined / historical `lead_cost` is `null`; last week **asks** this with leftover `from`/`to`). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** sum `$cpl`). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets, Booking-total Binder — **does not** open form / call). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children on Bookings / funnel — **asks** leftover nest, **does not** import this file). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (unwind allocations — **does not** sum `$cpl`). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (Form + Call on `timestamp`, billable CPL by Receiver — **does not** nest Source Companies; leftover dispatcher owns that HTTP). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md). Distinct from already-recommended Agent Sales: [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md) (live Bookings, unwind allocations — **does not** import this file). Distinct from leftover booked-prefix / lead match: later `analyticsFilters.ts` (this file **asks** leftover `leadMatchForQuery` / leftover `numberValue` / leftover `roundMoney` — **does not** ask leftover `bookedLeadPrefix`). Distinct from leftover combined add: later `analyticsMerge.ts` (this file never **asks** it — Overview combined never prices). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file **asks** leftover `nestObservedSourceRows`). Distinct from leftover named-report CSV flatten: later `analyticsExport.service.ts` (**does not** flatten this card; there is no Lead Cost spreadsheet). Distinct from already-recommended Lead write pricing: [`leads-cpl-resolution.md`](leads-cpl-resolution.md) (stamps the snapshot this file later **reads**). Distinct from already-recommended CPL schedule / corrections: [`operations-registry-cpl-schedule.md`](operations-registry-cpl-schedule.md) / [`operations-registry-cpl-corrections.md`](operations-registry-cpl-corrections.md). Distinct from already-recommended Registry leftover `open_lead_costs` gate: [`operations-registry-queries-lead-source-projection.md`](operations-registry-queries-lead-source-projection.md) (schedule-ready, not stored-CPL sum). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / CPL / Source Company — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a lead-cost Service file in this rename.
- Callers: already-recommended Overview `overview.service.ts` (`buildAllTimeSection` **asks** this only when requested + concrete leftover live; `buildLast7DaysSection` **asks** this with leftover live models + leftover `from`/`to`). Barrel `analytics/index.ts` does **not** export `getLeadCost`. Wave B `src/routes/v1.routes.ts` (`handleOverviewReport` → `GET /api/v1/admin/analytics/overview`) **asks** leftover Overview, not this file. Already-recommended dispatcher / leftover named-report CSV / leftover Agent Sales / leftover Source Company scorecards / leftover Receiver-Agent ranking do **not** import this file. Tests: `leadCost.service.test.ts` (**asks** `getLeadCost` — Form `$match` mentions `duplicate`, Call `$match` mentions `created_on_unmatched`, `$group` mentions `$cpl` and `source_granularity_key`, does **not** mention `cpl_resolution_status`, live nest returns `granularities`). `overview.service.test.ts` leftover-keeps / leftover-clears `lead_cost` on leftover `mergeOverviewAllTime` — **does not call `getLeadCost`**.
- Seams callers need: price-these-matching-leads (`getLeadCost`: one `{ total, unresolved_count, by_source_company }` card for already-scoped form / call models + leftover chips). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam** — leftover `nestObservedSourceRows` already owns catalog zeros / company-only historical. There is no CSV-column **seam**. There is no schedule **seam**. There is no dispatcher **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~163-line file is one sitting if you read it as price these matching Form and Call Leads by stored CPL, grouped by Source Company. Do **not** split Form vs Call into `formLeadCost.ts` / `callLeadCost.ts` on this pass — they are one card, not a CRUD folder. Do **not** pull leftover nest / filters here so “Lead Cost owns the catalog.” Do **not** pull leftover Overview here so “the home page owns the math.” If it later splits: `priceTheseMatchingLeadsByStoredCplGroupedBySourceCompany.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getLeadCost` / `leadCostRowsBySource` / `billableFormLeadMatch` / `billableCallLeadMatch` are executor mechanics. The owner question is: *I opened the home Overview. How much did these matching Leads cost? Take Form Leads that are not duplicates and Call Leads that are not unmatched. Sum the stored CPL snapshot — do not reprice from the schedule. A missing CPL is unresolved and costs zero. A stored zero is a priced Lead. Group by Source Company, and by Source Granularity when this database has keys. Fold form and call into one map. Seed every catalog Source Granularity so a quiet child still appears as zero. Historical stays company-only. Add the parent Source Company rows for the card total. This file does not pick live versus historical. This file does not add the two collections. This file does not flatten a spreadsheet. This file is not a named Analytics report.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking / Receiver-Agent ranking / texted-Lead booking rate / Agent Sales, leftover filters / merge / nest / named-report CSV, already-recommended Lead write pricing, leftover CPL schedule / corrections, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

One export of one “price these matching Form and Call Leads by stored CPL, grouped by Source Company” story, not “a lead-cost CRUD report service,” and not a named Analytics report:

1. **Price these matching Form and Call Leads by stored CPL, grouped by Source Company** — `getLeadCost`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. Historical sets `supportsSourceGranularity` false; leftover live / leftover combined-concrete keep it true. In parallel: leftover `leadMatchForQuery("FormLead")` plus `duplicate: { $ne: true }`; leftover `leadMatchForQuery("CallLead")` plus `created_on_unmatched: { $ne: true }`. `$group`: live `_id` is `{ source_company, source_granularity_key ?? "unknown" }`; historical `_id` is `$source_company` only. Sum `lead_count`, `unresolved_cpl_count` (`$cpl` null), `total_lead_cost` (`$ifNull: ["$cpl", 0]`). Fold form + call into one map keyed `source|granularity` (`sourceCompanyFromRow` / `sourceGranularityFromRow`; historical granularity is `""`). Leftover-`roundMoney` each leaf. **Ask** leftover `nestObservedSourceRows` with those three additive fields, leftover-`roundMoney` again on `total_lead_cost`, sort leftover-cost desc then leftover `source_company` slug. Sum parent `total_lead_cost` into leftover-`roundMoney` `total`. Sum parent `unresolved_cpl_count` into `unresolved_count`. Return `{ total, unresolved_count, by_source_company }`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never opens booked / cancelled / agents models, never **asks** leftover `bookedLeadPrefix` / leftover `concreteScopes` / leftover `getAdminModels` / leftover `mergeAnalyticsPayload`, and never **asks** already-recommended `resolveLeadCplSnapshot`.

There is no second owner operation. Form vs Call are two halves of one card. Combined add of two `{ total, by_source_company }` cards does not exist here — leftover Overview sets combined `lead_cost` `null` instead. Do not export leftover `nestObservedSourceRows` from this file as if this story owned the catalog. Do not export leftover `getOverviewReport` from this file as if this story painted the home.

## Organization

Keep one file. This is the screenplay for “price these matching Form and Call Leads by stored CPL, grouped by Source Company.” Chip match, catalog nest, combined add, home Overview, named-report dispatch, Lead write pricing, CPL schedule, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `LeadCostService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`. Do not invent a filter **adapter** beside leftover `leadMatchForQuery`. Do not invent a schedule **adapter** beside already-recommended `resolveLeadCplSnapshot`.

Do not split this by collection. Form and Call are one card. Do not move this into `cpl/` or `leads/` so “the pricing folder owns every CPL read.” Do not add `"lead-cost"` to leftover `analyticsReportSchema` so “one report enum owns the dashboard.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getLeadCost` | `priceTheseMatchingLeadsByStoredCplGroupedBySourceCompany` | leftover Overview **asks** the `{ total, unresolved_count, by_source_company }` card |
| `LeadCostResult` | `TheseLeadsStoredCpl` | the card leftover Overview already paints |

Keep the old names as one-line aliases until leftover `overview.service.ts` and `leadCost.service.test.ts` migrate. Do not make callers learn `$group` / `billableFormLeadMatch` / `nestObservedSourceRows` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip leftover Overview. Do not hide these behind leftover `getAnalyticsReport` so “every chart goes through the switch.”

**No class for the workflow.** The type that *does* earn a name is the card leftover Overview already paints:

```ts
type TheseLeadsStoredCpl = {
  total: number                    // leftover-roundMoney sum of parent total_lead_cost
  unresolved_count: number         // sum of parent unresolved_cpl_count (null $cpl)
  by_source_company: AnalyticsRow[] // leftover nest: live children + catalog zeros; historical company-only
}
```

That is the handoff from “we priced the matching billable Leads” to “paint Overview Lead Cost.” A quiet catalog child is a zero row on leftover live, not omitted. Combined never receives this card.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadCost.service.ts
// The owner opened the home Overview
// and asked how much these matching Leads cost.
// Take Form Leads that are not duplicates.
// Take Call Leads that are not unmatched.
// Sum the stored CPL snapshot.
// Do not reprice from the schedule.
// A missing CPL is unresolved and costs zero.
// A stored zero is a priced Lead.
// Group by Source Company,
// and by Source Granularity when this database has keys.
// Fold form and call into one map.
// Seed every catalog Source Granularity
// so a quiet child still appears as zero.
// Historical stays company-only.
// Add the parent Source Company rows for the card total.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not flatten a spreadsheet.
// This file is not a named Analytics report.

// ── 1. Price these matching Form and Call Leads by stored CPL, grouped by Source Company ─

export async function priceTheseMatchingLeadsByStoredCplGroupedBySourceCompany(models, query)

async function keepBillableFormLeads(query)          // leftover leadMatchForQuery + duplicate != true
async function keepBillableCallLeads(query)          // leftover leadMatchForQuery + created_on_unmatched != true
function groupBySourceOnThisDatabase(query)          // live company + granularity; historical company only
function treatAMissingCplAsUnresolvedAndZero()       // null $cpl → unresolved + $ifNull 0
function foldFormAndCallIntoOneMap(formRows, callRows)
async function nestTheSourceCompanyRows(leaves, query) // leftover nestObservedSourceRows
function addTheParentRowsForTheCardTotal(companies)
```

Read the pricing path out loud: *The owner opened the home Overview and asked how much the matching Leads cost. Open the handed form and call models. Match leftover chips on leftover `timestamp`. Drop duplicate Form Leads. Drop unmatched Call Leads. Sum the stored `cpl` field. A null `cpl` is unresolved and adds zero. A stored zero is a priced Lead. On leftover live, group by Source Company and Source Granularity (`unknown` when the key is missing). On historical, group by Source Company only. Fold form and call into one map. Ask leftover nest to seed catalog zeros on leftover live and to stay company-only on historical. Add the parent Source Company rows. Hand `{ total, unresolved_count, by_source_company }` back. Combined, the leftover named-report dispatcher, leftover CSV, and already-recommended Lead write pricing live next door.*

That is the operation. `getLeadCost` is not a different story. Form vs Call is not a second card. Overview live-only is not a leftover `database_scope` chip this file reads to refuse historical.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getLeadCost` is an executor name.** The owner asked to price these matching Form and Call Leads by stored CPL, grouped by Source Company. The name should say that. Do not teach leftover Overview `getLeadCost` as if this file owned leftover `getAnalyticsReport`.

2. **This file reads stored `$cpl`. It does not reprice.** Already-recommended `resolveLeadCplSnapshot` stamps dollars, period, and `cpl_resolution_status` on write. This file never **asks** the schedule. Do not import leftover `resolveCpl` here so “Analytics matches today’s rate,” and do not teach this file leftover `cpl_rate_periods` so “a schedule edit rewrites the home card.”

3. **Unresolved is null `$cpl`, not `cpl_resolution_status`.** The test forbids `cpl_resolution_status` in the `$group`. A leftover `missing_rate` write that stored compatibility zero looks priced (`unresolved_count` stays 0, `total_lead_cost` adds 0). Already-recommended Lead CPL writes say missing rates save compatibility zero. Do not switch this `$cond` to leftover `cpl_resolution_status === "missing_rate"` so “unresolved means the schedule had a hole,” and do not treat stored `0` as unresolved so “every zero looks missing.”

4. **Billable Form is `duplicate != true`. Billable Call is `created_on_unmatched != true`.** A leftover `duplicate_zero` Call Lead still enters the card when `created_on_unmatched` is false. Already-recommended Receiver-Agent ranking uses the same two fences plus “priced CPL.” This file does **not** drop Call `duplicate: true`. Do not add `duplicate != true` on Call so “both collections share one fence,” and do not drop unmatched Calls so “every Call Lead costs.”

5. **Form and Call `$group` bodies are copies.** Same `_id`, same three sums. Fold happens in process after both aggregates return. Do not add a third Mongo `$unionWith` so “one pipeline owns both collections,” and do not keep two public exports so “each collection is its own card.”

6. **`total` and `unresolved_count` sum leftover nest *parents*, not pre-nest leaves.** Leftover nest already summed children onto each company. A second pass over `granularities` would double. Catalog-zero children add 0. Do not sum leaves after nest so “zeros and parents both count,” and do not skip leftover nest so “the card omits quiet catalog children.”

7. **Leftover live seeds every catalog Source Granularity.** Leftover `nestObservedSourceRows` sets `seedZeros` when leftover `database_scope !== "historical"`. Overview last-week by-source does the same leftover nest on Bookings. Do not pass `seedZeros: false` here so “Lead Cost only shows spenders,” and do not seed historical so “every catalog child appears on old rows.”

8. **Historical group id is `$source_company` only.** This file also omits `source_granularity_key` on historical leaves, so leftover nest takes leftover `companyOnlySourceRows` (`granularities: []`). Do not emit `unknown` granularity on historical so “historical suddenly nests,” and do not `$ifNull` historical `_id` so “old rows grow children.”

9. **Sort is leftover-cost desc, then leftover `source_company` slug — not owner label.** Leftover nest’s default sort would have used leftover `source_company_label` after deposit / cost / bookings. This file passes its own sort. Do not switch to leftover `source_company_label` so “Lead Cost matches leftover default nest sort,” and do not sort `lead_count` so “busy sources beat expensive ones.”

10. **This file never asks leftover `bookedLeadPrefix`.** Date / source / local / leftover `lead_type` ride leftover `leadMatchForQuery` on leftover `timestamp`. There is no merchant / leftover `agent` chip on Leads. Overview all-time hands an empty leftover query (scope only). Overview last week hands leftover `from`/`to`. Do not import leftover prefix here so “Lead Cost matches Booking tables,” and do not ignore leftover chips so “the card is always all-time.”

11. **Leftover `lead_type` can empty one collection.** Leftover `leadMatch` pushes `{ _id: { $exists: false } }` when leftover `lead_type` is the other model. This file still aggregates both. Overview never hands leftover `lead_type`. Do not drop the other aggregate when leftover `lead_type` is set so “we skip a collection,” unless a later sitting proves the empty `$match` is the cost.

12. **The barrel does not export this.** Wave B **asks** leftover Overview. Already-recommended named reports stay hidden behind leftover `getAnalyticsReport`. Do not add `getLeadCost` to `analytics/index.ts` so “Wave B can skip Overview,” and do not add `"lead-cost"` to leftover `analyticsReportSchema` so “the switch owns Lead Cost.”

13. **There is no Lead Cost spreadsheet.** Leftover `analyticsExport.service.ts` never sees `"lead-cost"`. Do not route a new CSV through leftover `exportAnalyticsReportCsv` so “one flatten owns every card,” and do not copy leftover Agent Sales’ dedicated export here so “every home card downloads.”

14. **Already-recommended Overview decides when this card exists.** Leftover live requested + leftover live concrete → **ask** this. Historical → `null`. Combined → `null` (never even prices the live collection). This file will price historical models if handed them. Do not refuse historical inside this file so “Lead Cost owns the live fence,” and do not teach leftover `mergeAnalyticsPayload` a `"lead-cost"` case so “combined can add two CPL trees.”

15. **Already-recommended Receiver-Agent ranking is not this story.** That file also sums stored `$cpl` on billable Form / Call, groups by Receiver, and is a named report. Do not import it here so “every CPL sum lives together,” and do not point leftover `GET /api/v1/admin/analytics/receiver-agent-performance` at this file.

16. **Already-recommended Source Company scorecards are not this story.** Those nest Bookings / funnel, not stored CPL. Do not import leftover `getSourceCompanyPerformance` here, and do not point leftover Overview `lead_cost` at that `{ items }` list.

17. **Already-recommended Registry leftover `open_lead_costs` is not this story.** That gate asks whether the CPL schedule is ready for a leftover Connect-a-Granot-name row. Do not import leftover `projectLeadSource` here, and do not teach that file `{ total, unresolved_count }`.

18. **Tests prove the two billable fences and `$cpl`, not catalog zeros or historical company-only.** `leadCost.service.test.ts` leftover-mocks one Form group row (`total` 190, `unresolved_count` 1) and an empty Call pipeline. Live `granularities instanceof Array` is proven. Seeded quiet children, historical `granularities: []`, Call `duplicate: true` still counted, and parent-sum-after-nest are unproven at this **interface**.

19. **Leave sibling modules alone.** Leftover `leadMatchForQuery` / leftover `numberValue` / leftover `roundMoney` stay in later `analyticsFilters.ts`. Leftover nest stays in later `sourceHierarchy.ts`. Leftover Overview, leftover dispatcher, leftover named-report CSV, leftover Receiver-Agent ranking, leftover Source Company scorecards, and already-recommended Lead write pricing stay in their files. This file orchestrates leftover lead match → billable fences → stored-CPL group → form/call fold → leftover nest → parent totals.

20. **Do not treat leftover Agent Sales as this story.** Live Bookings, allocation unwind, dedicated CSV. Do not import it here, and do not teach that file `$cpl`.

21. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file stored CPL.

## Testing

The **interface** is the test surface: `priceTheseMatchingLeadsByStoredCplGroupedBySourceCompany` (`getLeadCost`). The `{ total, unresolved_count, by_source_company }` card is part of that **interface**.

Today `leadCost.service.test.ts` leftover-asks `getLeadCost` once. Keep that, and fill the gaps the story names make obvious:

**Price these matching Form and Call Leads by stored CPL, grouped by Source Company**
- Aggregates leftover `models["form-leads"]` and leftover `models["call-leads"]` in parallel — does **not** query booked / cancelled / agents collections.
- Form `$match` includes `duplicate: { $ne: true }`. Call `$match` includes `created_on_unmatched: { $ne: true }`. Call `$match` does **not** require `duplicate != true`.
- `$group` sums `$cpl` via `$ifNull` 0. Pipeline does **not** mention `cpl_resolution_status`.
- Null `$cpl` increments `unresolved_cpl_count` and contributes 0 to `total_lead_cost`. Stored `0` is a priced Lead (`unresolved_cpl_count` 0).
- Leftover live `$group` `_id` includes `source_granularity_key` (`$ifNull` `"unknown"`). Historical `$group` `_id` is `$source_company` only.
- Form + Call rows with the same leftover `source|granularity` add `lead_count` / `unresolved_cpl_count` / `total_lead_cost` before leftover nest.
- Leftover live **asks** leftover nest; `by_source_company[].granularities` is an array; quiet catalog children remain as zeros; `total` equals leftover-`roundMoney` sum of parent `total_lead_cost` (zeros do not change it).
- Historical **asks** leftover nest; `granularities` is `[]`; does **not** seed catalog children.
- Sort is parent `total_lead_cost` desc, then leftover `source_company` slug.
- Handed leftover `from`/`to` ride leftover `leadMatchForQuery` on leftover `timestamp`. Does **not** mention leftover `bookedLeadPrefix` fields (`merchant`, leftover `agent`, leftover `book_date`).
- Does **not** call leftover `concreteScopes` / leftover `getAdminModels` / leftover `mergeAnalyticsPayload` / leftover `getAnalyticsReport` / leftover `resolveLeadCplSnapshot`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Not this file**
- Do **not** assert leftover Overview live-only `lead_cost` / combined `null` — that is already-recommended `overview.service.ts`.
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of two Source Company trees — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover nest seed / company-only internals beyond what this card returns — that is a later sitting (`sourceHierarchy.ts`).
- Do **not** assert leftover named-report CSV columns — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert leftover Receiver-Agent `$cpl` by Receiver — that is already-recommended `receiverAgentPerformance.service.ts`.
- Do **not** assert leftover Source Company booking nest — that is already-recommended `sourcePerformance.service.ts`.
- Do **not** assert already-recommended Lead write snapshot stamps — that is `leadCplResolution.ts`.
- Do **not** assert leftover Agent Sales unwind — that is already-recommended `agentSalesReport.service.ts`.

Do **not** add a test per helper (`keepBillableFormLeads`, `keepBillableCallLeads`, `foldFormAndCallIntoOneMap`, `addTheParentRowsForTheCardTotal`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover lead-match chip order, leftover nest seed math, leftover merge parent/leaf math, leftover Overview combined `null`, leftover Receiver-Agent ranking, leftover Source Company funnel, leftover named-report CSV flatten, leftover Agent Sales, or RingCentral reconcile here.

## What I would not do

- A `LeadCostService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$group`.
- Moving this into a CRUD folder, or into `cpl/` / `leads/` / `admin/` “because those also touch CPL.”
- Splitting Form vs Call into two files or two public exports.
- Pulling leftover filters / nest / merge / Overview / dispatcher / named-report CSV / Receiver-Agent ranking / Source Company scorecards into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Adding `"lead-cost"` to leftover `analyticsReportSchema`, or pointing Wave B `GET /api/v1/admin/analytics/overview` at this file.
- Exporting `getLeadCost` from `analytics/index.ts` so Wave B can skip leftover Overview.
- Routing a new CSV through leftover `exportAnalyticsReportCsv` so “one flatten owns every card.”
- Importing leftover `resolveLeadCplSnapshot` / leftover `resolveCpl` so “Analytics matches today’s schedule.”
- Switching unresolved to leftover `cpl_resolution_status` so “unresolved means missing_rate.”
- Treating stored `0` as unresolved so “every compatibility zero looks missing.”
- Adding `duplicate != true` on Call Leads so “both collections share one fence.”
- Passing `seedZeros: false` so “Lead Cost only shows spenders.”
- Emitting historical granularity children so “old rows nest like leftover live.”
- Importing leftover `bookedLeadPrefix` so “Lead Cost matches Booking tables.”
- Teaching leftover `mergeAnalyticsPayload` a `"lead-cost"` case so “combined can add two CPL trees.”
- Treating leftover Receiver-Agent ranking, leftover Source Company scorecards, leftover Overview last-week by-source, leftover Agent Sales, leftover named-report CSV, already-recommended Lead write pricing, leftover Registry `open_lead_costs`, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
