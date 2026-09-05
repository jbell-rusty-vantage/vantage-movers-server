# Rate Cancelled Bookings Against Matching Bookings, And Group Matching Cancellations By Reason — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 7 of this service — `cancellationAnalytics.service.ts`
- Remaining in this service: `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/cancellationAnalytics.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`booking-cancellation-ratio`: booked — “booked collection `is_cancelled` only (not cancelled-leads count).” `cancellation-reasons`: cancelled — “groups cancelled docs; joins booking for affected deposit/binder and `linked_to_booked`.” Invariant: “Booking cancellation in booking reports = `BookedLead.cancelled` ref set (`is_cancelled`), not merely a cancelled-leads row.” Special shape: `booking-cancellation-ratio` → `{ overall, by_source_company }`. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ overall, by_source_company }` lives in leftover `mergeRatioPayloads`, not here. Combined add of `{ items }` by leftover-lowercased `reason` lives in leftover merge, not here. CSV: leftover flatten prepends a `source_company: "overall"` row, then emits **leaves (including zeros) or a childless company, never both**). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/{booking-cancellation-ratio,cancellation-reasons}` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (Summary + top Agents + leftover last-week by-source — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — booked `is_cancelled` **and** cancelled-collection `cancellations` + refund on one card). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets, booked `is_cancelled` — **does not** nest, **does not** open `cancelled-leads`). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children, field names `bookings` / `cancelled_bookings`, Booking-total money — **does not** emit `{ overall }`). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (unwind allocations, hard top 50 — **does not** nest). Distinct from leftover booked-prefix / cancelled-prefix / rate helpers: later `analyticsFilters.ts` (ratio **asks** `bookedLeadPrefix` + `rate`; reasons **asks** `cancelledLeadPrefix`). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (ratio **asks** `nestObservedSourceRows`; reasons never nests). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` — ratio uses leftover `mergeRatioPayloads`; reasons keys leftover-lowercased `reason`). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits overall + hierarchy leaves (ratio CSV omits `booked_to_cancelled_ratio`; reasons CSV keeps the fifty-row list). Distinct from leftover Lead Cost: later `leadCost.service.ts` (overview only — **asks** leftover nest, not this file). Distinct from leftover geographic / Receiver-Agent / SMS / Agent Sales. Distinct from already-recommended Cancellation writes: [`cancellations-cancelled-lead.md`](cancellations-cancelled-lead.md). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Cancellation / Source Company — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a cancellation-analytics Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "booking-cancellation-ratio"` / `"cancellation-reasons"`). Barrel `analytics/index.ts` does **not** export these two. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for those two strings — `GET /api/v1/admin/analytics/{booking-cancellation-ratio,cancellation-reasons}`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/{booking-cancellation-ratio,cancellation-reasons}.csv`). Already-recommended Overview / leftover Summary / leftover Source Company scorecards / leftover Agent ranking do **not** import this file. Tests: **no** `cancellationAnalytics.service.test.ts`. `analytics.service.test.ts` leftover-merges source / Receiver-Agent and leftover-flattens source-company / funnel CSV — **does not call these two exports**, **does not** `mergeAnalyticsPayload("booking-cancellation-ratio")` / `"cancellation-reasons"`, and **does not** `rowsForCsv("booking-cancellation-ratio")`.
- Seams callers need: rate-cancelled-bookings (`getBookingCancellationRatio`: one `{ overall, by_source_company }` card for already-scoped booked models + chips) vs group-cancellations-by-reason (`getCancellationReasons`: one `{ items }` list, hard top 50, for already-scoped cancelled models + chips) vs run-this-named-report (already-recommended dispatcher **asks** one of the two, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam** — leftover `nestObservedSourceRows` already owns catalog zeros / company-only historical. There is no CSV-column **seam**. There is no Summary **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~111-line file is one sitting if you read it as rate cancelled Bookings against matching Bookings, then group matching Cancellations by reason. Do **not** split the two owner questions into `getBookingCancellationRatio.ts` / `getCancellationReasons.ts` on this pass — they share the Cancellation story, not a CRUD folder. Do **not** pull leftover nest / filters / merge here so “the ratio owns the catalog.” Do **not** pull leftover Summary here so “every cancellation count lives together.” If it later splits: `rateCancelledBookingsAgainstMatchingBookings.ts` and `groupMatchingCancellationsByReason.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getBookingCancellationRatio` / `getCancellationReasons` are executor mechanics. The owner questions are: *I asked how often matching Bookings already have a Cancellation. Count those Bookings. Count how many already have a Cancellation ref. Rate cancelled over Bookings. The inverse is Bookings over cancelled — empty when none are cancelled. Then nest the same counts under each Source Company, and under Source Granularity when this database has keys. Seed every catalog Source Granularity so a quiet child still appears as zero. Historical stays company-only. I also asked why people cancel. Take the Cancellation rows that match these chips — cancel date, not book date. Blank reason is unknown. Count them, how many still join a Booking, refunds, and that Booking’s Deposit and Binder. Keep the top fifty reasons. This file does not pick live versus historical. This file does not add the two collections. This file does not count Cancellation rows on the ratio card. This file does not paint the home Overview. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking, leftover filters / nest / merge / CSV / Lead Cost / other named reports, leftover scope pick, already-recommended Cancellation writes, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two exports of two “cancellation Analytics” stories, not “a cancellation CRUD report service,” and not the Summary totals card:

1. **Rate cancelled Bookings against matching Bookings** — `getBookingCancellationRatio`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. **Ask** leftover `bookedLeadPrefix` twice. Overall `$group` `_id: null`: `booked_leads` (`$sum: 1`), `cancelled_leads` (`$cond` leftover `is_cancelled`). Project `active_booked_leads` as `$subtract` (no `max`), `cancellation_rate` as cancelled ÷ booked (0 when none), `booked_to_cancelled_ratio` as booked ÷ cancelled (`null` when none cancelled). Empty aggregate becomes `overall: null`. By-source: historical sets `supportsSourceGranularity` false; live / leftover combined-concrete keep it true. Live `_id` is `{ source_company: derived_source_company, source_granularity_key: $ifNull derived / "unknown" }`; historical `_id` is `$derived_source_company` only. Same two additive counts. **Ask** leftover `nestObservedSourceRows` with `booked_leads` / `cancelled_leads` and a derive that sets `active_booked_leads` as `max(booked - cancelled, 0)` and `cancellation_rate` as leftover `rate(cancelled, booked)`. Sort companies by cancellation rate descending, then booked count. Return `{ overall, by_source_company }`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never opens `cancelled-leads` on this path, and never calls `concreteScopes` / `getAdminModels`.

2. **Group matching Cancellations by reason** — `getCancellationReasons`. **Ask** leftover `cancelledLeadPrefix` (`cancel_date` + booking lookup as `booked_lead_doc` + same derived source). Blank / null `reason` becomes `"unknown"`. `$group` by that string: `cancellations`, `linked_to_booked` (lookup array size > 0), `total_refund_amount`, `affected_deposit_amount` / `affected_binder_amount` from the first joined Booking. Mongo `$round` money to 2. `$sort` count desc, reason asc. **`$limit` 50.** Return `{ items }`.

There is no third owner operation. Combined add of two `{ overall, by_source_company }` cards is leftover `mergeRatioPayloads` after the leftover dispatcher calls the ratio twice. Combined add of two `{ items }` lists is leftover merge keyed on leftover-lowercased `reason`. Do not export leftover `nestObservedSourceRows` from this file as if this story owned the catalog. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases. Do not export leftover `cancelledLeadPrefix` from the ratio as if the ratio counted Cancellation rows.

## Organization

Keep one file. This is the screenplay for “rate cancelled Bookings against matching Bookings, and group matching Cancellations by reason.” Chip match, catalog nest, combined add, home Overview, named-report dispatch, Summary totals, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `CancellationAnalyticsService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix` / `cancelledLeadPrefix`.

Do not split this by HTTP report string on this pass. Ratio and reasons are two beats of one Cancellation sitting. Do not move this into `cancellations/` so “the write folder owns every cancel count.” Do not add Summary / Source Company / Revenue Trend cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getBookingCancellationRatio` | `rateCancelledBookingsAgainstMatchingBookings` | leftover dispatcher **asks** the `{ overall, by_source_company }` card |
| `getCancellationReasons` | `groupMatchingCancellationsByReason` | leftover dispatcher **asks** the fifty-row `{ items }` list |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$group` / `is_cancelled` / `nestObservedSourceRows` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

**No class for the workflow.** The types that *do* earn a name are the two cards the Admin Dashboard already paints:

```ts
type TheseBookingsCancellationRate = {
  overall: {
    booked_leads: number              // BookedLead rows, not Leads
    cancelled_leads: number           // those rows whose Booking has a Cancellation ref
    active_booked_leads: number       // $subtract, no max — can be missing when overall is null
    cancellation_rate: number         // cancelled_leads / booked_leads
    booked_to_cancelled_ratio: number | null  // booked / cancelled; null when none cancelled
  } | null
  by_source_company: Array<{
    source_company: string
    source_company_label: string
    booked_leads: number
    cancelled_leads: number
    active_booked_leads: number       // max(booked - cancelled, 0)
    cancellation_rate: number
    granularities: Array<{            // leftover nest children; historical []
      source_granularity_key: string
      source_granularity_label: string
      channel?: string | null
      // same additive + derived fields as the parent — no booked_to_cancelled_ratio
    }>
  }>
}

type ThisCancellationReasonScore = {
  reason: string                      // "" / null became "unknown"
  cancellations: number
  linked_to_booked: number            // leftover cancelled prefix still joined a Booking
  total_refund_amount: number         // Mongo $round 2
  affected_deposit_amount: number     // first joined Booking deposit
  affected_binder_amount: number      // first joined Booking total binder
}

type TheseCancellationReasonScores = { items: ThisCancellationReasonScore[] }
```

That is the handoff from “we rated matching Bookings, then grouped matching Cancellations” to “paint the two Cancellation tables.” Combined `overall` / `by_source_company` is leftover `mergeRatioPayloads`, not a third database this file sees. Combined reasons `items` is leftover merge of two fifty-row lists by leftover-lowercased `reason`. A quiet catalog child is a zero row on live ratio; historical has no children. A quiet reason is missing, not a zero row.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cancellationAnalytics.service.ts
// The owner asked how often matching Bookings
// already have a Cancellation.
// Count those Bookings.
// Count how many already have a Cancellation ref.
// Rate cancelled over Bookings.
// The inverse is Bookings over cancelled —
// empty when none are cancelled.
// Then nest the same counts under each Source Company,
// and under Source Granularity when this database has keys.
// Seed quiet children as zero on live.
// Historical stays company-only.
// The owner also asked why people cancel.
// Take the Cancellation rows that match these chips —
// cancel date, not book date.
// Blank reason is unknown.
// Count them, how many still join a Booking,
// refunds, and that Booking’s Deposit and Binder.
// Keep the top fifty reasons.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not count Cancellation rows
// on the ratio card.
// This file does not paint the home Overview.

// ── 1. Rate cancelled Bookings against matching Bookings ─

export async function rateCancelledBookingsAgainstMatchingBookings(models, query)

async function countMatchingBookingsAndHowManyAreCancelled(models, query)
  // asks leftover bookedLeadPrefix; group _id: null
  // empty aggregate → overall null
function rateTheBookedSet(overall)
  // active_booked_leads = $subtract (no max)
  // cancellation_rate = cancelled / booked
  // booked_to_cancelled_ratio = booked / cancelled or null
async function countMatchingBookingsBySource(models, query)
  // live: group company + granularity (unknown if missing)
  // historical: group company only
function rateEachSourceRow(row)
  // active_booked_leads = max(booked - cancelled, 0)
  // cancellation_rate = leftover rate(cancelled, booked)
  // no booked_to_cancelled_ratio
async function nestThoseRatesUnderTheCatalog(leaves, query)
  // asks leftover nestObservedSourceRows
function sortCompaniesByCancellationRate(items)

// ── 2. Group matching Cancellations by reason ─────────────

export async function groupMatchingCancellationsByReason(models, query)

async function takeTheMatchingCancellations(models, query)
  // asks leftover cancelledLeadPrefix (cancel_date)
function treatABlankReasonAsUnknown(row)            // null / "" → "unknown"
function countRefundsAndTheJoinedBookingsMoney()
function keepTheTopFiftyReasons()
```

Read the ratio path out loud: *The owner asked for Booking Cancellation Ratio on a database someone else already picked, plus leftover chips. Take matching Bookings on leftover `book_date` prefix. Count them. Count how many already have a Cancellation ref. Rate cancelled over Bookings. The inverse is Bookings over cancelled, or empty. Then group the same counts by Source Company, and by Source Granularity when this is not historical. Nest under leftover catalog labels. Seed quiet children as zero on live. Hand `{ overall, by_source_company }` back. The reasons table then takes matching Cancellation rows on leftover `cancel_date` prefix, folds a blank reason to unknown, and keeps fifty. Live versus historical, adding the two collections, painting the home, counting both collections on Summary, and flattening a spreadsheet live next door.*

That is the operation. `getBookingCancellationRatio` is not a different story. `getCancellationReasons` is not a cancelled-collection rewrite of the ratio. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` is an executor name.** The owner asked to rate cancelled Bookings against matching Bookings, or to group matching Cancellations by reason. The names should say that. Do not teach Wave B `getBookingCancellationRatio` as if this file owned the leftover dispatcher envelope.

2. **`booked_leads` / `cancelled_leads` are Bookings.** The ratio never opens Form / Call / Cancellation collections. Knowledge says booked `is_cancelled` only. Already-recommended Source Company / Revenue Trend / Agent ranking say `bookings` / `cancelled_bookings` for the same flag. Do not silently rename the JSON keys in this pass so “every booked report matches,” and do not count `cancelled-leads` rows into `cancelled_leads` so “the field name becomes true.”

3. **The ratio never counts Cancellation rows.** A Booking with `cancelled` set and no `CancelledLead` still increments `cancelled_leads`. A Cancellation row whose Booking is outside the `book_date` window does not. Already-recommended Summary keeps both numbers on one card (`cancelled_bookings` vs `cancellations`). Do not add leftover `cancelledLeadPrefix` to the ratio so “both numbers agree,” and do not drop Summary’s cancelled-collection count so “one cancellation number owns Analytics.”

4. **Reasons use `cancel_date`; the ratio uses `book_date`.** The same chips can paint a Cancellation on reasons and miss it on the ratio, or the reverse. Leftover `agent` also differs: booked prefix matches `agent_allocations.agent_name_snapshot`; cancelled prefix matches `agent`. Do not point reasons at `book_date` so “the two tables share a window,” and do not teach the ratio leftover `cancelledLeadPrefix` so “cancel date owns both.”

5. **`booked_to_cancelled_ratio` lives only on `overall`.** By-source derive never computes it. Leftover ratio CSV omits the column. Leftover `NUMERIC_FIELDS` does not include it, and leftover `deriveRates` does not recompute it — combined `overall` **drops** the inverse. Do not add the inverse to every nest child so “the table matches the card,” and do not recompute it in this file so “this file owns combined.”

6. **Leftover combined `deriveRates` invents fields the single-scope card never had.** After leftover `mergeRatioPayloads` sums `booked_leads` / `cancelled_leads` / `active_booked_leads`, leftover `deriveRates` sets `cancellation_rate`, then `active_bookings` (not `active_booked_leads`), then `booking_rate` as leftover `rate(booked_leads, 0)` → **0**. Combined overall can show `booking_rate: 0` and a second active field. Do not compute `booking_rate` here so “combined matches live,” and do not teach leftover merge `booked_to_cancelled_ratio` in this rename so “download matches JSON.”

7. **Overall `active_booked_leads` is `$subtract` without `max`; by-source uses `Math.max`.** Already-recommended Summary / leftover merge use `max`. Empty booked aggregate leaves `overall: null`, not a zero card. Do not wrap the overall `$subtract` in `max` so “every active field matches Summary,” and do not coerce `null` overall to zeros so “CSV always has a number.”

8. **Historical is fenced twice.** This file sets `supportsSourceGranularity = query.database_scope !== "historical"` before `$group`. Leftover nest then company-onlys again when historical and no leftover granularity keys. Same double fence as already-recommended Source Company scorecards. Do not drop this file’s flag so “nest owns historical,” and do not teach leftover nest `database_scope` from here.

9. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover merge after two calls. Do not call leftover merge here so “the ratio file can add,” and do not teach this file `concreteScopes`.

10. **By-source sorts by cancellation rate; leftover combined re-sorts by deposit.** This file’s nest `sort` is rate desc, then `booked_leads`. Leftover `mergeRows` `defaultSort` is deposit, then binder, then `bookings` (not `booked_leads`), then label. Combined companies can reorder. Do not change leftover merge sort here so “combined matches live,” and do not drop this file’s rate sort so “every nested table matches Source Company deposit.”

11. **Quiet catalog children are zeros on live ratio, omitted on historical.** Leftover nest `seedZeros` is false when historical. Reasons never seed. Do not stop seeding ratio zeros so “the ratio matches Revenue Trend’s omitted months,” and do not seed every catalog reason so “the reasons table matches the ratio.”

12. **The reasons ranking always `$limit`s 50.** Combined leftover merge concatenates two already-cut lists and does **not** re-slice 50. A reason that is 51st on both databases never appears, even if the added count would have been top fifty. Combined can also paint more than fifty unique reasons. Same leftover-merge cut as already-recommended Agent ranking. Do not drop the `$limit` so “combined is honest,” and do not re-slice leftover merge here so “the reasons file can add.”

13. **`linked_to_booked` is the leftover prefix lookup, not `BookedLead.cancelled`.** `$gt: [{ $size: "$booked_lead_doc" }, 0]`. A Cancellation whose Booking was deleted still counts in `cancellations` with `linked_to_booked: 0` and zero affected money. Do not require a live Booking so “every reason row has money,” and do not point this at leftover `is_cancelled` so “the ratio owns the join.”

14. **Affected money is the first joined Booking, rounded in Mongo.** `$arrayElemAt` index 0. Leftover combined `deriveRates` leftover-`roundMoney`s `total_refund_amount` only — `affected_deposit_amount` / `affected_binder_amount` are leftover `NUMERIC_FIELDS` sums without a second round. Do not switch to leftover `roundMoney` here so “this file owns combined,” and do not drop affected money so “CSV owns the reasons table.”

15. **Knowledge says ratio flatten is tested; this interface is not.** Leftover `analytics.service.test.ts` proves “leaves or a childless company, never both” on `source-company-performance` / funnel. It never **asks** `rowsForCsv("booking-cancellation-ratio")`, so the prepended `source_company: "overall"` row is unproven. Do not add that overall row here so “the ratio file owns CSV,” and do not drop it from leftover flatten so “ratio matches Source Company.”

16. **Tests never call these two exports.** There is no `cancellationAnalytics.service.test.ts`. Leftover dispatcher tests never **ask** `getBookingCancellationRatio` / `getCancellationReasons`. Live catalog-zero seed, `overall: null`, inverse drop on combined, and the 50-reason cut are unproven at this **interface**.

17. **Leave sibling modules alone.** `bookedLeadPrefix` / `cancelledLeadPrefix` / `rate` stay in later `analyticsFilters.ts`. Catalog nest / zero seed / label humanize stay in later `sourceHierarchy.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Source Company scorecards, Agent ranking, CSV flatten, and other named reports stay in their files. This file orchestrates booked prefix → overall + by-source group → leftover nest → optional cancelled prefix → top 50 reasons.

18. **Do not treat already-recommended Summary as this story.** `getSummary` counts form / call / booked `is_cancelled` / cancelled-collection refunds on one `{ totals }` bag. Overview **asks** that bag. Do not import it here, and do not point Wave B `GET /api/v1/admin/analytics/summary` at this file.

19. **Do not treat already-recommended Source Company scorecards as this story.** Those nest `bookings` / `cancelled_bookings` / deposit / binder and emit `{ items }`, not `{ overall, by_source_company }`. Do not import them here so “every nested source table lives together.”

20. **Do not treat already-recommended Cancellation writes as this story.** Public v1 create / correct / remove and Sheet Sync live in `cancellations/`. This file never writes a `CancelledLead`.

21. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ overall, by_source_company }`.

## Testing

The **interface** is the test surface: `rateCancelledBookingsAgainstMatchingBookings` (`getBookingCancellationRatio`) and `groupMatchingCancellationsByReason` (`getCancellationReasons`). The `{ overall, by_source_company }` card and the fifty-row `{ items }` list are part of that **interface**.

Today there is no `cancellationAnalytics.service.test.ts`. Fill the gap the story names make obvious:

**Rate cancelled Bookings against matching Bookings**
- **Asks** leftover `bookedLeadPrefix(query)` on the handed booked model twice — does **not** query form / call / cancelled collections.
- Empty booked aggregate: `overall` is `null`, not a zero card.
- Live by-source `$group` `_id` is `{ source_company: "$derived_source_company", source_granularity_key: $ifNull derived / "unknown" }`. Historical `_id` is `"$derived_source_company"`.
- **Asks** leftover `nestObservedSourceRows`. Historical companies have `granularities: []`. Live companies include leftover catalog children, including zeros.
- Overall `cancellation_rate` is cancelled ÷ booked (0 when none). `booked_to_cancelled_ratio` is booked ÷ cancelled, or `null` when none cancelled.
- Overall `active_booked_leads` is `$subtract` without `max`. By-source `active_booked_leads` is `max(booked - cancelled, 0)`.
- By-source rows do **not** include `booked_to_cancelled_ratio`.
- Companies sort by `cancellation_rate` desc, then `booked_leads` desc.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Group matching Cancellations by reason**
- **Asks** leftover `cancelledLeadPrefix(query)` on the handed cancelled model — date field is `cancel_date`.
- Blank / null `reason` becomes `"unknown"`.
- `linked_to_booked` is leftover `$size` of `booked_lead_doc` > 0. A Cancellation with an empty lookup still increments `cancellations`.
- Affected deposit / binder come from `$arrayElemAt` of the joined Booking, Mongo `$round` 2.
- Sort is cancellations desc, reason asc. Pipeline `$limit`s 50.
- Does **not** **ask** leftover `bookedLeadPrefix` or leftover nest.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover `mergeRatioPayloads` dropping `booked_to_cancelled_ratio`, inventing `booking_rate: 0`, or adding `active_bookings` — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order or cancelled-prefix `cancel_date` / `agent` chips — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover catalog seed / `owner_label` / unknown-child keep — that is a later sitting (`sourceHierarchy.ts`). The existing leftover `sourceHierarchy.test.ts` already covers nest math.
- Do **not** assert leftover CSV prepended `source_company: "overall"` row or “leaves or a childless company, never both” — that is a later sitting (`analyticsExport.service.ts`). The existing leftover flatten test covers the helper on source-company / funnel, not these two exports.
- Do **not** assert leftover Summary `{ totals }` keeping both `cancelled_bookings` and `cancellations` — that is already-recommended `summary.service.ts`.
- Do **not** assert leftover Source Company `{ items }` `booking_rate: null` — that is already-recommended `sourcePerformance.service.ts`.
- Do **not** assert leftover Agent ranking `$limit` 50 — that is already-recommended `agentPerformance.service.ts`.

Do **not** add a test per helper (`countMatchingBookingsAndHowManyAreCancelled`, `treatABlankReasonAsUnknown`, `keepTheTopFiftyReasons`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, or RingCentral reconcile here.

## What I would not do

- A `CancellationAnalyticsService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$group`.
- Moving this into a CRUD folder, or into `cancellations/` / `admin/` “because those also count cancellations.”
- Splitting `getBookingCancellationRatio` and `getCancellationReasons` into two files on this pass, or teaching the ratio to count `cancelled-leads` rows.
- Pulling leftover filters / nest / merge / Overview / dispatcher / CSV flatten / Summary / Source Company scorecards into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/summary` or `GET /api/v1/admin/analytics/overview` at this file, or pointing the two report routes past the leftover dispatcher.
- Counting Cancellation rows on the ratio so “`cancelled_leads` means cancelled-leads.”
- Pointing reasons at `book_date` so “the two tables share a window.”
- Computing `booking_rate` on the ratio so “combined leftover merge looks intentional.”
- Dropping the reasons `$limit` 50 so “combined can re-rank everyone.”
- Stopping live catalog-zero seed so the ratio matches Revenue Trend’s omitted months.
- Treating leftover Summary, leftover Source Company scorecards, leftover Lead Cost, leftover Agent ranking, leftover geographic / Receiver-Agent / SMS, already-recommended Cancellation writes, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
