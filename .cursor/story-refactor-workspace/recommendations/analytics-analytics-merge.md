# Add These Two Database Cards For Combined Analytics — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 15 of this service — `analyticsMerge.ts`
- Remaining in this service: `sourceHierarchy.ts`
- Target: `src/services/analytics/analyticsMerge.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Combined merge: `mergeAnalyticsPayload(report, payloads)` sums numeric fields and re-derives `booking_rate` / `cancellation_rate` / `average_cpl` by stable keys. **Does not dedupe rows by business id.** Keys: `source_company` via `normalizeSourceDimension`; other dimensions lowercased. Special shapes: `summary` → `{ totals }`; `booking-cancellation-ratio` → `{ overall, by_source_company }`; `geographic-lanes` → `{ form_lanes, call_lanes }`; Receiver-Agent and SMS-conversion keep live-only warning metadata. Source-company merge keeps child `granularities`; company-only incoming rows become extra leaves; parent totals recompute from children. Invariant: `combined` sums collections; it does not join by business id. Role line on that Service is the dispatcher, not this file — the dispatcher **asks** this when `database_scope === "combined"`). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `concreteScopes` is live then historical; this file **never** picks models). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (**asks** `mergeAnalyticsPayload("summary")` for all-time totals and `mergeRows(..., ["agent_name"])` for top Agents, then slices five; combined `lead_cost` is `null` **next door**). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (**never** sees `combined`; the dispatcher **asks** this after two `getSummary` calls). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (`{ items }` by `period`). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nest **first**; this file **adds** nested cards). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (`{ items }` by lowercased `agent_name`; `$limit 50` is **per database** — this file does **not** re-slice). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (ratio `{ overall, by_source_company }`; `deriveRates` already parked as inventing `booking_rate: 0`). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (lanes are two lists). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (historical empty card; this file **keeps** live rows and stamps warning metadata). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md) (same live-plus-warning shape by `origin`). Distinct from already-recommended Agent Sales: [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md) (live Bookings only — **does not** import this file). Distinct from already-recommended Lead Cost: [`analytics-lead-cost.md`](analytics-lead-cost.md) (Overview card only — combined Overview **never** **asks** this to add CPL). Distinct from already-recommended named-report CSV flatten: [`analytics-analytics-export.md`](analytics-analytics-export.md) (dispatcher already added; flatten must **not** also emit the parent total). Distinct from already-recommended chip match: [`analytics-analytics-filters.md`](analytics-analytics-filters.md) (this file **asks** `normalizeSourceDimension` / `numberValue` / `rate` / `roundMoney` only — **does not** `$match`). Distinct from later catalog nest / zero seed: later `sourceHierarchy.ts` (**asks** normalize / `numberValue` — nest **before** the dispatcher **asks** this). Distinct from scope pick (`adminScope.service.ts`). Distinct from `analyticsReportSchema` (Wave B report name). Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout's `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an analytics-merge Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`query.database_scope === "combined"` → `mergeAnalyticsPayload(report, payloads)`). Already-recommended Overview `overview.service.ts` (`mergeAnalyticsPayload("summary")` + `mergeRows` on `agent_name`). Barrel `analytics/index.ts` does **not** export this file. Wave B `src/routes/v1.routes.ts` never imports this file. Tests: `analytics.service.test.ts` (**asks** `mergeAnalyticsPayload("source-company-performance")` for alias fold; `"revenue-trend"` by `period`; `"source-company-funnel"` parent + company-only leaf; `"receiver-agent-performance"` live rows + `historical_receiver_agent_supported: false`; `"sms-successfully-sent-then-booked"` live rows + `historical_sms_conversion_supported: false`). `overview.service.test.ts` (**asks** `mergeOverviewAllTime`, which **asks** this for Summary totals — **does not** import this file). No `analyticsMerge.test.ts`. **Does not** **ask** `mergeAnalyticsPayload("summary")` / `"booking-cancellation-ratio"` / `"geographic-lanes"` at this **interface**.
- Seams callers need: add-these-two-named-report-cards (`mergeAnalyticsPayload`: report name picks bag shape) vs add-these-scored-rows-by-these-stable-keys (`mergeRows`: Overview top Agents **ask** this without a report name). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already ran live then historical. There is no chip-match **seam**. There is no nest **seam**. There is no CSV-column **seam**. There is no dispatcher **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~280-line file is one sitting if you read it as add these two database cards for combined Analytics — counts add, rates recompute, Source Company aliases fold, a company-only historical row becomes an extra leaf, Receiver-Agent and texted-Lead cards keep live rows and stamp "historical is unsupported." Do **not** split `mergeAnalyticsPayload` / `mergeRows` into `payload.ts` / `rows.ts` on this pass — they are one add, not a CRUD folder. Do **not** split one file per report name so "each chart owns combined." Do **not** pull named reports / nest / chips here so "merge owns the math." If it later splits: `addTheseTwoNamedReportCardsForCombinedAnalytics.ts` / `addTheseScoredRowsByTheseStableKeys.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `merge.ts`

`mergeAnalyticsPayload` / `mergeRows` / `mergeSummary` / `mergeRatioPayloads` / `deriveRates` / `keyFieldsForReport` are executor mechanics. The owner question is: *I already ran this named Analytics report against the live database and against the historical database. Add the two cards together. Do not join the same Job Number. Do not rematch dashboard chips. Do not nest Source Companies. On Source Company rows, "Main Site Forms" and `main_site` are one company. A company-only historical row becomes an extra leaf under live children. After counts add, recompute booking rate, cancellation rate, and average CPL. Receiver-Agent and texted-Lead cards keep live rows and warn that historical does not have Receiver-Agent attribution or Lead Messages. This file does not count. This file does not match chips. This file does not nest Filter Catalog zeros. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / named reports / Agent Sales / Lead Cost / named-report CSV / chip match, later nest, scope pick, Zod report name, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two exports of one "add these two database cards for combined Analytics" story, not "an analytics CRUD merge helper," and not a named report:

1. **Add these two named-report cards for combined Analytics** — `mergeAnalyticsPayload`. The dispatcher already ran live then historical (`concreteScopes("combined")`). `summary` adds `totals` bags. `booking-cancellation-ratio` adds `overall` then `by_source_company` by `source_company`. `geographic-lanes` adds `form_lanes` and `call_lanes` by `pickup_state` + `delivery_state`. The three Receiver-Agent names add `items` by Receiver-Agent keys, then stamp live-only warning metadata (does **not** copy the historical `unsupportedReceiverAgentReport()` bag). `sms-successfully-sent-then-booked` adds `items` by `origin`, then stamps Lead Message warning metadata. Everything else adds `items` by `keyFieldsForReport`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never **asks** `concreteScopes` / `getAdminModels` / `bookedLeadPrefix` / `leadMatchForQuery` / `nestObservedSourceRows`, and never prices Lead Cost.

2. **Add these scored rows by these stable keys** — `mergeRows`. Overview top Agents **ask** this on `agent_name` without a report name. The first row wins non-numeric fields. `NUMERIC_FIELDS` add. Empty incoming `granularities` plus existing children fabricate one leaf from the incoming parent (`source_granularity_key` is `row.source_granularity_key ?? row.source_company`). Children recurse on `source_granularity_key`. Parent counters then recompute from children. `deriveRates` after add. Sort is `period` `localeCompare`, then deposit, binder, bookings, then dimension fold.

There is no third owner operation. `mergeSummary` / `mergeRatioPayloads` / `deriveRates` / `keyFieldsForReport` are beats, not public **seams**. Do not export `NUMERIC_FIELDS` as a public **seam**. Do not export `concreteScopes` from this file as if this story owned live versus historical. Do not export `nestObservedSourceRows` from this file as if this story owned Filter Catalog zeros.

## Organization

Keep one file. This is the screenplay for "add these two database cards for combined Analytics." Named-report counts, chip match, catalog nest, home Overview cards, Agent Sales, Lead Cost, CSV flatten, and scope pick already live in deeper **modules**. Do not pull those in. Do not invent an `AnalyticsMergeService` class. Do not invent a begin / complete **seam** — this is a read add. Do not invent a scope **adapter** beside `concreteScopes`. Do not invent a nest **adapter** beside `nestObservedSourceRows`. Do not invent a chip **adapter** beside `bookedLeadPrefix`.

Do not split this by report name. Summary totals and Source Company leaves are beats of one add. Do not move this into `admin/` so "the desk folder owns combined." Do not add Overview / Agent Sales / Lead Cost cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `mergeAnalyticsPayload` | `addTheseTwoNamedReportCardsForCombinedAnalytics` | dispatcher **asks** combined after two runs |
| `mergeRows` | `addTheseScoredRowsByTheseStableKeys` | Overview top Agents **ask** this without a report name |

Keep the old names as one-line aliases until `analytics.service.ts`, `overview.service.ts`, and `analytics.service.test.ts` migrate. Do not make callers learn `NUMERIC_FIELDS` / `deriveRates` / `keyFieldsForReport` as the domain language. Do not export `mergeSummary` / `mergeRatioPayloads` as public **seams**. Do not hide `mergeRows` so "only `mergeAnalyticsPayload` is testable." Do not export these from `analytics/index.ts` so Wave B can skip the dispatcher.

**No class for the workflow.** The type that *does* earn a name is the two cards the dispatcher already ran:

```ts
type TheseTwoNamedReportCards = AnalyticsPayload[]
// live first, historical second
// concreteScopes("combined") already picked that order
```

That is the handoff from "each database already counted" to "the owner sees one combined card." `AnalyticsPayload` stays the bag named reports already return. `AnalyticsRow` stays the scored row `mergeRows` folds.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// analyticsMerge.ts
// The owner already ran this named Analytics report
// against the live database and against the historical database.
// Add the two cards together.
// Do not join the same Job Number.
// Do not rematch dashboard chips.
// Do not nest Source Companies.
// On Source Company rows, aliases fold.
// A company-only historical row becomes an extra leaf
// under live children.
// After counts add, recompute rates.
// Receiver-Agent and texted-Lead cards keep live rows
// and stamp "historical is unsupported."
// This file does not count.
// This file does not match chips.
// This file does not nest Filter Catalog zeros.
// This file does not flatten a spreadsheet.

// -- 1. Add these two named-report cards -----------------

export function addTheseTwoNamedReportCardsForCombinedAnalytics(report, payloads)

function addTheSummaryTotals(payloads)                 // { totals }
function addTheCancellationRatio(payloads)             // overall + by_source_company
function addTheGeographicLanes(payloads)               // form_lanes + call_lanes
function keepLiveReceiverAgentRowsAndStampTheWarning(payloads)
function keepLiveTextedLeadRowsAndStampTheWarning(payloads)
function addTheItemsListByThisReportKey(report, payloads)

function chooseTheStableKeysForThisReport(report)

// -- 2. Add these scored rows by these stable keys -------

export function addTheseScoredRowsByTheseStableKeys(rows, keyFields)

function foldTheseRowsOnTheStableKey(rows, keyFields)
function addTheNumericCounters(existing, incoming)     // NUMERIC_FIELDS
function turnACompanyOnlyRowIntoAnExtraLeaf(row)       // when existing already has children
function recomputeParentTotalsFromChildren(existing)
function recomputeRatesAfterTheAdd(row)                // deriveRates
function sortCombinedRows(left, right)                 // period, then deposit, binder, bookings
```

Read the add path out loud: *The owner asked for combined. The dispatcher already ran this named report against live, then historical. If this is Summary, add the two totals bags and recompute rates. If this is booking-cancellation-ratio, add overall, then add by Source Company. If this is geographic lanes, add form lanes and call lanes separately. If this is Receiver-Agent or texted-Lead booking rate, keep the live rows and stamp that historical is unsupported. Otherwise add the items lists on the report's stable key. Source Company aliases fold. A company-only historical row becomes an extra leaf under live children, then the parent totals recompute from those children. Do not join Job Numbers. Chip match, nest, Overview last week, Agent Sales, Lead Cost, and CSV flatten live next door.*

That is the operation. `mergeAnalyticsPayload` is not a different story. `mergeRows` is not a second add. Combined warning metadata is not a `database_scope` chip this file reads to refuse historical.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`mergeAnalyticsPayload` is an executor name.** The owner asked to add these two named-report cards for combined Analytics. The name should say that. Do not teach the dispatcher `mergeAnalyticsPayload` as if this file owned `concreteScopes`.

2. **This file never sees `combined` as a chip.** Callers already overwrote `database_scope` to live or historical, ran twice, and handed the two bags here. Do not **ask** `concreteScopes` here so "merge can pick databases," and do not refuse a one-item array so "combined must be two."

3. **Does not join by business id.** Knowledge already names this. Two Bookings with the same Job Number, one live and one historical, become two counted Bookings if they land on the same dimension key. Do not add `normalized_job_no` so "combined de-dupes the same move," and do not silently `$group` here.

4. **Source Company aliases fold; other keys lowercase.** Existing test: `"Main Site Forms"` + `"main_site"` become one `source-company-performance` row (5 bookings). `keyValue("source_company")` **asks** `normalizeSourceDimension` (`resolveSourceCompany`). Every other key **asks** `normalizeDimensionKey` (trim + lowercase). Already-recommended Agent ranking groups raw snapshot casing on one database; combined folds `Alice Agent` / `alice agent`. Do not teach Agent ranking `$toLower` so "live matches combined," and do not stop folding Source Company aliases so "combined keeps both spellings."

5. **Company-only extras as leaves are order-dependent.** Knowledge: company-only incoming rows become extra leaves; parent totals recompute from children. Code fabricates that leaf only when incoming `granularities` is empty **and** existing already has children. `concreteScopes("combined")` is live then historical, so live nest first matches the tested funnel bag. Reverse the arrays and a company-only first card's parent totals are overwritten by the second card's children only. Do not silently fabricate a leaf from the existing parent so "either order works," and do not drop company-only historical rows so "only nested sources combine."

6. **Parent totals recompute from children after the leaf merge.** The tested funnel bag is parent 4 + children 4, then company-only 6 → parent 10, two children (`main_site_form` + fabricated `main_site`), `booking_rate` 0.5. Do not keep the earlier parent-field add so "children are decoration," and do not drop childless companies so "only nested sources survive."

7. **Rates recompute; they are not summed.** `NUMERIC_FIELDS` is the add list. `deriveRates` then writes `booking_rate`, `cancellation_rate`, `average_cpl`, `cost_per_received_lead`, `cost_per_booked_lead`, `not_booked_leads` (from `texted_leads`), and `active_bookings`. Money fields round. Bookings prefer `bookings` || `booked_leads` || `reconciled_bookings`. Do not add `booking_rate` into `NUMERIC_FIELDS` so "rates average," and do not skip `deriveRates` so "each database keeps its own rate."

8. **Receiver-Agent and SMS stamp their own warning; they do not copy the historical bag.** Combined always returns the hardcoded live-only metadata object, even if both payloads were live. Tests check `historical_*_supported: false`, not the stamped `message`. Do not merge metadata objects so "historical wording wins," and do not omit the warning when the second payload is empty so "empty history is quiet."

9. **`booking-cancellation-ratio` `deriveRates` already contradicts the ratio card.** Parked in CONTRADICTIONS: combined `deriveRates` drops `booked_to_cancelled_ratio`, invents `booking_rate: 0`, and adds `active_bookings`. Do not silently keep `booked_to_cancelled_ratio` in this rename, and do not skip `deriveRates` on `overall` so "the ratio file owns the inverse."

10. **This file does not re-slice Agent ranking.** Each database already `$limit`s 50. Combined can return more than 50 folded rows. Do not `.slice(0, 50)` here so "combined matches live," and do not drop `$limit` from already-recommended Agent ranking so "merge can rank the true top 50."

11. **Overview `lead_cost` is not this file's job.** Combined Overview **asks** `mergeAnalyticsPayload("summary")` and `mergeRows` on `agent_name`, then forces `lead_cost: null` next door. Do not add a Lead Cost branch here so "merge can add CPL," and do not import `getLeadCost`.

12. **`geographic-lanes` is two lists, not `{ items }`.** Untested at this **interface**. Do not flatten lanes into `items` so "every report is items," and do not add form + call lanes on one key so "a lane is a lane."

13. **`mergeAnalyticsPayload("summary")` is untested at this interface.** Overview proves totals through `mergeOverviewAllTime`. Do not treat that as proof this export recomputes `booking_rate` / `active_bookings` on `{ totals }`.

14. **Default `keyFieldsForReport` is `["label"]`.** Unknown report names fold on `label`. Do not invent per-report files so "every chart owns a key," and do not change Revenue Trend to `report_date` here.

15. **Leave sibling modules alone.** Named reports stay in their files. Chip match stays in already-recommended `analyticsFilters.ts`. Nest stays in later `sourceHierarchy.ts`. Overview / Agent Sales / Lead Cost / CSV flatten stay next door. This file adds two already-counted cards.

16. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here.

## Testing

The **interface** is the test surface: `addTheseTwoNamedReportCardsForCombinedAnalytics` (`mergeAnalyticsPayload`) and `addTheseScoredRowsByTheseStableKeys` (`mergeRows`).

Today `analytics.service.test.ts` **asks** five `mergeAnalyticsPayload` shapes. Keep those, and fill the gaps the story names make obvious:

**Add these two named-report cards**
- `source-company-performance`: `"Main Site Forms"` + `"main_site"` become one row; bookings 2+3=5; deposit 3000+4500=7500 (existing).
- `revenue-trend`: same `period` `"2026-01"` adds bookings 1+2=3 (existing).
- `source-company-funnel`: live nested parent + company-only historical becomes parent 10 / 5 reconciled, `booking_rate` 0.5, two children including fabricated `main_site` (existing).
- `receiver-agent-performance`: live row kept; `historical_receiver_agent_supported` is false; `booking_rate` 0.5; `average_cpl` 100 (existing).
- `sms-successfully-sent-then-booked`: live `origin` rows kept; `historical_sms_conversion_supported` is false; `not_booked_leads` stays 2 (existing).
- `summary`: two `{ totals }` bags add bookings / leads / deposit; `booking_rate` and `active_bookings` recompute. Do **not** treat Overview's `mergeOverviewAllTime` as this export.
- `booking-cancellation-ratio`: `overall` adds; `by_source_company` folds on `source_company`. Do **not** silently restore `booked_to_cancelled_ratio` here.
- `geographic-lanes`: `form_lanes` and `call_lanes` add separately on pickup + delivery.
- Company-only **first**, nested **second**, is today's order-sensitive behavior — prove it or leave it parked. Do **not** fix the order in this rename.
- Does **not** **ask** `bookedLeadPrefix` / `leadMatchForQuery` / `nestObservedSourceRows` / `getAdminModels`.
- Does **not** mutate Mongo or enqueue Sheet Sync.
- Does **not** join by `normalized_job_no`.

**Add these scored rows by these stable keys**
- Overview-style `mergeRows` on `agent_name` adds deposit across two lists (today proven only through `mergeOverviewAllTime`).
- First row wins non-numeric fields (`receiver_agent_name`, `label`).
- Empty incoming `granularities` plus existing children fabricate one leaf.

**Not this file**
- Do **not** assert named-report `$group` math — those are already-recommended report files.
- Do **not** assert chip `$match` / employee-snapshot order — that is already-recommended `analyticsFilters.ts`.
- Do **not** assert nest seed / quiet zeros — that is a later sitting (`sourceHierarchy.ts`).
- Do **not** assert CSV leaves-or-childless — that is already-recommended `analyticsExport.service.ts`.
- Do **not** assert Overview last-week `null` / live-only Lead Cost — that is already-recommended `overview.service.ts`.
- Do **not** assert Agent Sales TOTAL — that is already-recommended `agentSalesReport.service.ts`.
- Do **not** assert RingCentral reconcile.

Do **not** add a test per helper (`turnACompanyOnlyRowIntoAnExtraLeaf`, `recomputeRatesAfterTheAdd`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test dispatcher scope pick, nest seed math, chip match, Agent Sales TOTAL, Overview combined `null`, Lead Cost stored CPL, Admin Dashboard desk flatten, or RingCentral reconcile here.

## What I would not do

- An `AnalyticsMergeService` class with `merge` / `combine` / `sum`.
- Thirty two-line functions that only wrap `numberValue`.
- Moving this into a CRUD folder, or into `admin/` "because combined is a desk chip."
- Splitting `mergeAnalyticsPayload` / `mergeRows` into `payload.ts` / `rows.ts` / `merge.ts`.
- Pulling named reports / nest / chips / Overview / Agent Sales / Lead Cost / CSV flatten into this file.
- Teaching this file `concreteScopes` / `getAdminModels` so it can pick live versus historical.
- Exporting `deriveRates` / `NUMERIC_FIELDS` / `keyFieldsForReport` as public seams.
- Exporting these from `analytics/index.ts` so Wave B can skip the dispatcher.
- Joining by Job Number / business id so "combined de-dupes the same move."
- Silently fabricating a leaf from the existing parent so "either order works."
- Adding `booking_rate` into `NUMERIC_FIELDS` so "rates average."
- Re-slicing Agent ranking to 50 so "combined matches live."
- Copying historical unsupported metadata instead of stamping the live-only warning.
- Treating Agent Sales, Overview, Lead Cost, nest, chip match, named-report counts, CSV flatten, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
