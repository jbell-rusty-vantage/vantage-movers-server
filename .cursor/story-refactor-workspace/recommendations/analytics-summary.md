# Count This Period's Leads, Bookings, And Cancellations — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 3 of this service — `summary.service.ts`
- Remaining in this service: `revenueTrend.service.ts`, `sourcePerformance.service.ts`, `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/summary.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Summary: `countDocuments` form/call; booking deposit/binder + `is_cancelled` count; separate cancelled-collection `cancellations` + refund. `active_bookings = max(bookings - cancelled_bookings, 0)`. `booking_rate = bookings / (form+call)`. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ totals }` lives in leftover merge, not here). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/summary` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (`overview.service.ts` **asks** this for all-time and live last week; this file **does not** paint last week or Lead Cost). Distinct from leftover booked-prefix / lead match / rate helpers: later `analyticsFilters.ts` (this file **asks** `leadMatchForQuery`, `bookedLeadPrefix`, `cancelledLeadPrefix`, `numberValue`, `rate`, `roundMoney`). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload("summary")` after two calls here; this file never adds collections). Distinct from leftover booking-cancellation-ratio: later `cancellationAnalytics.service.ts` (booked `is_cancelled` only — no cancelled-collection count). Distinct from leftover source / agent / geographic / receiver-agent / SMS reports. Distinct from leftover Agent Sales: later `agentSalesReport.service.ts` (live models, required `from`/`to`, unwind allocations). Distinct from leftover Lead Cost: later `leadCost.service.ts` (overview only). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits one totals row (CSV columns omit `active_bookings`). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file never nests). Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a summary Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "summary"`). Already-recommended Overview `overview.service.ts` (all-time empty chips; live last-week chips). Barrel `analytics/index.ts` does **not** export `getSummary`. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport("summary")` — `GET /api/v1/admin/analytics/summary`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten. Tests: **no** `summary.service.test.ts`. `analytics.service.test.ts` names schema, booked prefix, leftover merge of other reports, and CSV flatten — **does not call `getSummary`**, and **does not** `mergeAnalyticsPayload("summary")`.
- Seams callers need: count-these-totals (`getSummary`: one `{ totals }` bag for already-scoped models + chips) vs run-this-named-report (already-recommended dispatcher **asks** this, then optionally leftover merge) vs paint-the-home-overview (already-recommended Overview **asks** this) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no CSV-column **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~58-line file is one sitting if you read it as count this period's matching leads, bookings, and cancellations, then derive the rates. Do **not** split form / call / booked / cancelled into `countFormLeads.ts` / `countBookings.ts`. Do **not** pull leftover filters / merge here so “the totals card owns the match.” Do **not** pull leftover Overview / dispatcher here so “summary owns every home card.” If it later splits: `countThisPeriodsLeadsBookingsAndCancellations.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getSummary` is executor mechanics. The owner question is: *I asked for the Summary totals. Count the Form Leads and Call Leads that match these chips. Count the Bookings that match, and how many of those Bookings already have a Cancellation. Count the Cancellation rows and their refunds separately. Add Deposit and Binder. Booking rate is bookings over leads. Cancellation rate is cancelled Bookings over Bookings — not Cancellation rows over Bookings. Active Bookings is bookings minus cancelled Bookings, never negative. This file does not pick live versus historical. This file does not add the two collections. This file does not paint the home Overview. This file does not flatten a spreadsheet. This file does not reconcile RingCentral call counts.*

Already-recommended dispatcher / Overview, leftover filters / merge / CSV / Agent Sales / Lead Cost / other named reports, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “count this period's leads, bookings, and cancellations” story, not “a summary CRUD report service,” and not the home Overview:

1. **Count this period's matching leads, bookings, and cancellations** — `getSummary` (count half). Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. In parallel: `countDocuments` Form Leads via leftover `leadMatchForQuery("FormLead")` (`timestamp`, leftover company / granularity / `local` / `lead_type`); `countDocuments` Call Leads the same way; booked aggregate via leftover `bookedLeadPrefix` (`book_date` + employee-snapshot source order + `is_cancelled`) grouped to `bookings`, `cancelled_bookings`, `total_deposit_amount`, `total_binder_amount`; cancelled aggregate via leftover `cancelledLeadPrefix` (`cancel_date` + same derived source) grouped to `cancellations`, `total_refund_amount`. Empty aggregates become `{}`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, and never calls `concreteScopes` / `getAdminModels`.

2. **Derive booking rate, cancellation rate, and active bookings** — still `getSummary`. `total_leads` is form + call (not a third count). `booking_rate` is leftover `rate(bookings, form+call)`. `cancellation_rate` is leftover `rate(cancelled_bookings, bookings)` — **not** leftover `cancellations` over bookings. `active_bookings` is `max(bookings - cancelled_bookings, 0)`. Money fields leftover `roundMoney`. Missing aggregate numbers leftover `numberValue` → 0. Return `{ totals }`.

There is no third owner operation. Combined add of two `{ totals }` bags is leftover merge after the leftover dispatcher calls this twice. Do not export leftover `leadMatchForQuery` from this file as if this story owned the chips. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases.

## Organization

Keep one file. This is the screenplay for “count this period's leads, bookings, and cancellations.” Chip match, booked prefix, combined add, home Overview, named-report dispatch, Agent Sales, Lead Cost, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `SummaryService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `leadMatchForQuery`.

Do not split this by collection. Form count and Cancellation refunds are beats of one totals card. Do not move this into `admin/` so “the Admin Dashboard folder owns every chart.” Do not add Overview / Agent Sales cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getSummary` | `countThisPeriodsLeadsBookingsAndCancellations` | leftover dispatcher + leftover Overview **ask** the same `{ totals }` bag |

Keep the old name as a one-line alias until already-recommended `analytics.service.ts` and `overview.service.ts` migrate. Do not make callers learn `Promise.all` / `bookedLeadPrefix` / `rate` as the domain language. Do not export this from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

**No class for the workflow.** The type that *does* earn a name is the totals bag the Admin Dashboard already paints:

```ts
type ThisPeriodsLeadBookingAndCancellationTotals = {
  totals: {
    form_leads: number
    call_leads: number
    total_leads: number            // form + call, not a third count
    bookings: number
    cancelled_bookings: number     // BookedLead.cancelled set (is_cancelled)
    active_bookings: number        // max(bookings - cancelled_bookings, 0)
    cancellations: number          // cancelled-leads rows — may diverge
    total_deposit_amount: number   // leftover roundMoney
    total_binder_amount: number    // booking total, not unwound allocation
    total_refund_amount: number    // cancelled-leads refund
    booking_rate: number           // bookings / (form + call)
    cancellation_rate: number      // cancelled_bookings / bookings
  }
}
```

That is the handoff from “we counted the four collections” to “paint the Summary card.” Combined `totals` is leftover merge of two of these bags, not a third database this file sees.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// summary.service.ts
// The owner asked for the Summary totals.
// Count the Form Leads and Call Leads that match these chips.
// Count the Bookings that match, and how many of those Bookings
// already have a Cancellation.
// Count the Cancellation rows and their refunds separately.
// Booking rate is bookings over leads.
// Cancellation rate is cancelled Bookings over Bookings.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not paint the home Overview.

// ── 1. Count this period's matching leads, bookings, and cancellations ──

export async function countThisPeriodsLeadsBookingsAndCancellations(models, query)

async function countMatchingFormLeads(models, query)     // asks leftover leadMatchForQuery
async function countMatchingCallLeads(models, query)     // same leftover match
async function countMatchingBookingsAndMoney(models, query)
  // asks leftover bookedLeadPrefix; groups bookings / cancelled_bookings / deposit / binder
async function countMatchingCancellationsAndRefunds(models, query)
  // asks leftover cancelledLeadPrefix; groups cancellations / refund

// ── 2. Derive booking rate, cancellation rate, and active bookings ─

function deriveTheRatesOnThoseCounts(form, call, booked, cancelled)
  // total_leads = form + call
  // booking_rate = bookings / (form + call)
  // cancellation_rate = cancelled_bookings / bookings  — not cancellations / bookings
  // active_bookings = max(bookings - cancelled_bookings, 0)
```

Read the totals path out loud: *The owner asked for Summary totals on a database someone else already picked, plus leftover chips. Count Form Leads and Call Leads on leftover `timestamp` match. Count Bookings on leftover `book_date` prefix, including how many already carry a Cancellation. Count Cancellation rows on leftover `cancel_date` prefix, and add their refunds. Add Deposit and Binder from the Booking collection. Booking rate is bookings over form-plus-call. Cancellation rate is cancelled Bookings over Bookings — do not use the Cancellation-row count for that rate. Active Bookings never go negative. Hand `{ totals }` back. Live versus historical, adding the two collections, painting the home, and flattening a spreadsheet live next door.*

That is the operation. `getSummary` is not a different story. Combined is not a third System of Record this file merges. `cancellations` is not `cancelled_bookings`.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getSummary` is an executor name.** The owner asked for this period's totals. The name should say count the matching leads, bookings, and cancellations. Do not teach Wave B `getSummary` as if this file owned the leftover dispatcher envelope.

2. **`cancelled_bookings` and `cancellations` are two clocks.** Knowledge: “Booking cancellation in booking reports = `BookedLead.cancelled` ref set (`is_cancelled`), not merely a cancelled-leads row.” This file keeps both. Rate and active Bookings use `cancelled_bookings`. Refunds use the cancelled collection. Do not silently drop `cancellations` so “one cancellation number owns the card,” and do not point `cancellation_rate` at leftover `cancellations` so “the row count is the rate.”

3. **`booking_rate` is bookings over form-plus-call.** Knowledge: “`booking_rate = bookings / (form+call)`.” `total_leads` is that sum, not a third `countDocuments`. Do not divide by Form Leads only so “website conversion is the card,” and do not divide by leftover `booked_leads` / `received_leads` aliases from leftover merge.

4. **The same `from` / `to` hits three date fields.** Leads use leftover `timestamp`. Bookings use leftover `book_date`. Cancellations use leftover `cancel_date`. Knowledge already tables this. Do not silently force all four counts onto `book_date` so “one period owns the card,” and do not reuse leftover `revenue-trend` `report_date` here.

5. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover `mergeAnalyticsPayload("summary")` after two calls. Do not call leftover merge here so “the totals file can add,” and do not teach this file `concreteScopes`.

6. **Leftover merge can lie when `cancelled_bookings` is 0.** Leftover `deriveRates` does `cancelled_bookings || cancelled_leads || cancellations`. A live bag with `cancelled_bookings: 0` and `cancellations: 5` would re-rate from the row count after add. Do not “fix” leftover merge in this rename, and do not drop `cancellations` from this bag so the sibling `||` cannot see it.

7. **Overview asks this; it does not live here.** Already-recommended `paintTheAdminDashboardHomeOverview` **asks** `getSummary` with empty chips (all-time) or the rolling last-week window. Do not paint `last_7_days` here so “summary owns the home,” and do not point Wave B `GET .../analytics/overview` at this file.

8. **CSV sibling asks the leftover dispatcher, then drops `active_bookings`.** Leftover `CSV_COLUMNS.summary` lists counts, money, and both rates — not `active_bookings`. Do not flatten columns here so “the totals file owns download,” and do not “fix” the CSV header list in this rename.

9. **Binder is the Booking total, not an unwound allocation.** Leftover Agent Performance / Agent Sales credit allocation `binder_amount` and can double Deposit. This file sums `$total_binder_amount` / `$deposit_amount` once per Booking. Do not unwind `agent_allocations` here so “summary matches Agent Sales.”

10. **`lead_type` can zero one lead count.** Leftover `leadMatch` pushes `{ _id: { $exists: false } }` on the other model. Bookings / cancellations filter `lead_model`. Do not skip the other `countDocuments` so “one query owns both,” and do not teach this file to ignore leftover `lead_type`.

11. **Tests never call this export.** There is no `summary.service.test.ts`. Leftover `analytics.service.test.ts` never calls `getSummary` and never `mergeAnalyticsPayload("summary")`. The totals bag is unproven at the **interface**. Do not treat leftover booked-prefix tests as proof this file asked leftover `leadMatchForQuery`.

12. **Leave sibling modules alone.** `leadMatchForQuery` / `bookedLeadPrefix` / `cancelledLeadPrefix` / `rate` / `roundMoney` stay in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Agent Sales, Lead Cost, CSV flatten, and other named reports stay in their files. This file orchestrates four counts → derive rates.

13. **Do not treat leftover booking-cancellation-ratio as this story.** Later `getBookingCancellationRatio` is booked `is_cancelled` only. Do not import it here so “cancellation means cancellation.”

14. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ totals }`.

## Testing

The **interface** is the test surface: `countThisPeriodsLeadsBookingsAndCancellations` (`getSummary`). The `{ totals }` bag is part of that **interface**.

Today no test calls `getSummary`. Fill the gap the story names make obvious:

**Count this period's matching leads, bookings, and cancellations**
- **Asks** leftover `leadMatchForQuery("FormLead")` and `leadMatchForQuery("CallLead")` on the handed models, then `countDocuments` each.
- **Asks** leftover `bookedLeadPrefix(query)` and groups `bookings` / `cancelled_bookings` / deposit / binder.
- **Asks** leftover `cancelledLeadPrefix(query)` and groups `cancellations` / refund.
- Empty booked or cancelled aggregate becomes zeros (`numberValue`), not a thrown missing row.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Derive booking rate, cancellation rate, and active bookings**
- `total_leads` is form + call.
- `booking_rate` is bookings / (form + call). Zero leads → `0`, not `NaN`.
- `cancellation_rate` is `cancelled_bookings` / bookings. A bag with `cancelled_bookings: 0` and `cancellations: 5` still rates `0`. Zero bookings → `0`.
- `active_bookings` is `max(bookings - cancelled_bookings, 0)`. More cancelled Bookings than Bookings still returns `0`.
- Deposit / binder / refund are leftover `roundMoney`.
- `lead_type: FormLead` still **asks** the Call Lead count (leftover match may zero it) and still prefixes bookings / cancellations with `lead_model`.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert Overview `last_7_days: null` on historical — that is already-recommended `overview.service.ts`.
- Do **not** assert leftover merge `cancelled_bookings || cancellations` — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert CSV headers (including the missing `active_bookings`) — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert Agent Sales live-only models — that is a later sitting (`agentSalesReport.service.ts`).
- Do **not** assert leftover Lead Cost duplicate / unmatched filters — that is a later sitting (`leadCost.service.ts`).

Do **not** add a test per helper (`countMatchingFormLeads`, `countMatchingBookingsAndMoney`, `deriveTheRatesOnThoseCounts`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” or RingCentral reconcile here.

## What I would not do

- A `SummaryService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `countDocuments`.
- Moving this into a CRUD folder, or into `admin/` “because the Admin Dashboard paints the card.”
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/overview` at this file, or pointing `GET /api/v1/admin/analytics/summary` past the leftover dispatcher.
- Collapsing `cancelled_bookings` and `cancellations` into one number.
- Pointing `cancellation_rate` at leftover `cancellations`.
- Unwinding `agent_allocations` so Summary matches Agent Sales.
- “Fixing” leftover merge’s `cancelled_bookings || cancellations` in this rename.
- “Fixing” leftover CSV to emit `active_bookings` in this rename.
- Forcing leads / bookings / cancellations onto one date field in this rename.
- Treating leftover booking-cancellation-ratio, leftover Lead Cost, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
