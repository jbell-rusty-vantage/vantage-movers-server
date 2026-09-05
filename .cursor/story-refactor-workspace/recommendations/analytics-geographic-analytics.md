# Split Matching Bookings By Local Vs Long-Distance, Rank Form And Call Pickup-To-Delivery Lanes, And Rank Matching Leads By Pickup Or Delivery State — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 8 of this service — `geographicAnalytics.service.ts`
- Remaining in this service: `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/geographicAnalytics.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`local-vs-long-distance`: booked (`local`). `geographic-lanes`: form + call (pickup × delivery) — special shape `{ form_lanes, call_lanes }`. `pickup-state-performance` / `delivery-state-performance`: form + call. Combined add of `{ items }` by leftover-lowercased `local_type` / `state`, and of `{ form_lanes, call_lanes }` by leftover-lowercased `pickup_state|delivery_state`, lives in leftover merge, not here. Role line on that Service is the leftover dispatcher, not this file. CSV: leftover flatten emits `{ items }` for local / states; lanes prepend leftover `lead_type: "form"` / `"call"`). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/{local-vs-long-distance,geographic-lanes,pickup-state-performance,delivery-state-performance}` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (Summary + top Agents + leftover last-week by-source — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** group by place). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets, booked — **does not** group by `local` or state). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children; funnel **does** count Form / Call `booked` / `cancelled` refs, then overlays Bookings — **does not** group pickup × delivery). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (unwind allocations, hard top 50 — **does not** group place). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (booked `is_cancelled` overall / by source; reasons open `cancelled-leads` — **does not** group `local` or state). Distinct from leftover booked-prefix / lead match / rate helpers: later `analyticsFilters.ts` (local-vs-long **asks** `bookedLeadPrefix`; lanes / states **ask** `leadMatchForQuery`). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` — lanes use leftover `mergeRows` twice; local / states use leftover `{ items }`). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits local / state `{ items }` or form-then-call lane rows. Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (this file never nests). Distinct from leftover Lead Cost: later `leadCost.service.ts` (overview only — **asks** leftover nest, not this file). Distinct from leftover Receiver-Agent / SMS / Agent Sales. Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Booking / Form Lead / Call Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a geographic-analytics Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "local-vs-long-distance"` / `"geographic-lanes"` / `"pickup-state-performance"` / `"delivery-state-performance"`). Barrel `analytics/index.ts` does **not** export these three. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for those four strings — `GET /api/v1/admin/analytics/{local-vs-long-distance,geographic-lanes,pickup-state-performance,delivery-state-performance}`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/{local-vs-long-distance,geographic-lanes,pickup-state-performance,delivery-state-performance}.csv`). Already-recommended Overview / leftover Summary / leftover Source Company scorecards / leftover Agent ranking / leftover Cancellation rating do **not** import this file. Tests: **no** `geographicAnalytics.service.test.ts`. `analytics.service.test.ts` leftover-merges source / Receiver-Agent / SMS and leftover-flattens source-company / funnel CSV — **does not call these three exports**, **does not** `mergeAnalyticsPayload("local-vs-long-distance")` / `"geographic-lanes"` / `"pickup-state-performance"`, and **does not** `rowsForCsv("geographic-lanes")`.
- Seams callers need: split-matching-bookings-by-local (`getLocalVsLongDistance`: one `{ items }` list by `local_type` for already-scoped booked models + chips) vs rank-form-and-call-lanes (`getGeographicLanes`: one `{ form_lanes, call_lanes }` pair, each hard top 50, for already-scoped form / call models + chips) vs rank-matching-leads-by-state (`getStatePerformance`: one `{ items }` list after adding Form + Call, hard top 50, for already-scoped form / call models + chips + `"pickup_state"` / `"delivery_state"`) vs run-this-named-report (already-recommended dispatcher **asks** one of the four strings, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam**. There is no CSV-column **seam**. There is no Summary **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~159-line file is one sitting if you read it as split matching Bookings by local vs long-distance, then rank Form and Call pickup-to-delivery lanes, then rank matching Leads by pickup or delivery state. Do **not** split the three owner questions into `getLocalVsLongDistance.ts` / `getGeographicLanes.ts` / `getStatePerformance.ts` on this pass — they share the place story, not a CRUD folder. Do **not** split pickup vs delivery into two files — they are one ranking with a dimension argument. Do **not** pull leftover filters / merge here so “the place file owns the match.” Do **not** pull leftover Source Company funnel here so “every Form + Call count lives together.” If it later splits: `splitMatchingBookingsByLocalVsLongDistance.ts`, `rankPickupToDeliveryLanesForFormAndCallLeads.ts`, and `rankMatchingLeadsByPickupOrDeliveryState.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getLocalVsLongDistance` / `getGeographicLanes` / `getStatePerformance` are executor mechanics. The owner questions are: *I asked how local moves compare to long-distance. Take the Bookings that match these chips. Blank local is unknown. Count them, how many already have a Cancellation ref, Deposit, and Binder. Rate cancelled over Bookings. I also asked which pickup-to-delivery lanes are busiest. Take matching Form Leads and matching Call Leads on lead timestamp, not book date. Keep the two lists apart. Blank state is unknown. Count Leads, how many already have a booked ref, how many already have a cancelled ref. Rate booked over Leads. Keep the top fifty lanes on each list. I also asked which pickup states, or delivery states, are busiest. Add Form and Call into one list first. Keep the top fifty states. This file does not pick live versus historical. This file does not add the two collections. This file does not nest Source Companies. This file does not paint the home Overview. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating, leftover filters / merge / CSV / Lead Cost / other named reports, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Three exports of three “place” stories, not “a geographic CRUD report service,” and not the Source Company funnel:

1. **Split matching Bookings by local vs long-distance** — `getLocalVsLongDistance`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. **Ask** leftover `bookedLeadPrefix`. `$group` `_id` is `$local`, or `"unknown"` when null / `""`. Sum `bookings` (`$sum: 1`), `cancelled_bookings` (`$cond` leftover `is_cancelled`), Booking `deposit_amount` / `total_binder_amount` (`$ifNull` 0). Project `local_type`, Mongo `$round` money to 2, `cancellation_rate` as cancelled ÷ bookings (0 when none). `$sort` deposit desc. Return `{ items }`. No `$limit`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never opens form / call / cancelled collections on this path, and never calls `concreteScopes` / `getAdminModels`.

2. **Rank Form and Call pickup-to-delivery lanes** — `getGeographicLanes`. In parallel: leftover `leadMatchForQuery("FormLead")` and `"CallLead"` (lead `timestamp` + leftover chips). Blank / null `pickup_state` / `delivery_state` become `"unknown"`. `$group` `_id` is `{ pickup_state, delivery_state }`. Sum `leads`, `booked_leads` (Lead `booked` ref set), `cancelled_leads` (Lead `cancelled` ref set). Project `booking_rate` as booked ÷ leads (0 when none). `$sort` leads desc, booked desc. **`$limit` 50** on each list. Return `{ form_lanes, call_lanes }`. The two lists never add.

3. **Rank matching Leads by pickup or delivery state** — `getStatePerformance`. Same leftover lead match, same blank → `"unknown"`, same three additive counts, keyed on `"pickup_state"` or `"delivery_state"` (leftover dispatcher picks which). **Add Form + Call in this file** (`mergeStateRows` by raw `_id`). `booking_rate` is booked ÷ leads. Sort leads desc, booked desc. **`slice(0, 50)`**. Return `{ items }`.

There is no fourth owner operation. Pickup and delivery are one ranking with a dimension argument. Combined add of two `{ items }` lists, or of two `{ form_lanes, call_lanes }` pairs, is leftover merge after the leftover dispatcher calls this twice. Do not export leftover `leadMatchForQuery` from this file as if this story owned every Lead chip. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases.

## Organization

Keep one file. This is the screenplay for “split matching Bookings by local vs long-distance, rank Form and Call pickup-to-delivery lanes, and rank matching Leads by pickup or delivery state.” Chip match, combined add, home Overview, named-report dispatch, Source Company funnel, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `GeographicAnalyticsService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix` / `leadMatchForQuery`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`.

Do not split this by HTTP report string on this pass. Local, lanes, and states are three beats of one place sitting. Do not move this into `leads/` or `bookings/` so “the write folder owns every state field.” Do not add Source Company / Summary / Revenue Trend cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getLocalVsLongDistance` | `splitMatchingBookingsByLocalVsLongDistance` | leftover dispatcher **asks** the `{ items }` local-type list |
| `getGeographicLanes` | `rankPickupToDeliveryLanesForFormAndCallLeads` | leftover dispatcher **asks** the `{ form_lanes, call_lanes }` pair |
| `getStatePerformance` | `rankMatchingLeadsByPickupOrDeliveryState` | leftover dispatcher **asks** the fifty-row `{ items }` list twice (pickup, then delivery) |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$group` / `laneStats` / `mergeStateRows` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

`rankMatchingLeadsByPickupOrDeliveryState` should keep taking the dimension argument. Do not keep two copies of the state pipeline.

**No class for the workflow.** The types that *do* earn a name are the three cards the Admin Dashboard already paints:

```ts
type ThisLocalTypeBookingScore = {
  local_type: string              // "local" | "long_distance" | "unknown"
  bookings: number                // BookedLead rows, not Leads
  cancelled_bookings: number      // those rows whose Booking has a Cancellation ref
  total_deposit_amount: number    // Booking deposit, Mongo $round 2
  total_binder_amount: number     // Booking total binder, Mongo $round 2
  cancellation_rate: number       // cancelled_bookings / bookings
}

type TheseLocalTypeBookingScores = { items: ThisLocalTypeBookingScore[] }

type ThisPickupToDeliveryLaneScore = {
  pickup_state: string            // "" / null became "unknown"
  delivery_state: string
  leads: number                   // Form or Call rows on that list
  booked_leads: number            // Lead.booked ref set, not BookedLead rows
  cancelled_leads: number         // Lead.cancelled ref set, not cancelled-leads
  booking_rate: number            // booked_leads / leads
}

type TheseFormAndCallLanes = {
  form_lanes: ThisPickupToDeliveryLaneScore[]
  call_lanes: ThisPickupToDeliveryLaneScore[]
}

type ThisStateLeadScore = {
  state: string                   // raw pickup or delivery spelling; "" / null became "unknown"
  leads: number                   // Form + Call added in this file
  booked_leads: number            // Lead.booked ref set
  cancelled_leads: number         // Lead.cancelled ref set
  booking_rate: number
}

type TheseStateLeadScores = { items: ThisStateLeadScore[] }
```

That is the handoff from “we split Bookings by local, then ranked Lead lanes and states” to “paint the four place tables.” Combined `items` / `form_lanes` / `call_lanes` is leftover merge of two of these lists, not a third database this file sees. A quiet state or lane is missing, not a zero row. The fifty-first lane or state by Lead count is missing even on one database. A quiet `local` / `long_distance` bucket is missing — this file does not seed the two enum values.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// geographicAnalytics.service.ts
// The owner asked how local moves compare
// to long-distance.
// Take the Bookings that match these chips.
// Blank local is unknown.
// Count them, how many already have a Cancellation ref,
// Deposit, and Binder.
// Rate cancelled over Bookings.
// The owner also asked which pickup-to-delivery
// lanes are busiest.
// Take matching Form Leads and matching Call Leads
// on lead timestamp, not book date.
// Keep the two lists apart.
// Blank state is unknown.
// Count Leads, how many already have a booked ref,
// how many already have a cancelled ref.
// Rate booked over Leads.
// Keep the top fifty lanes on each list.
// The owner also asked which pickup states,
// or delivery states, are busiest.
// Add Form and Call into one list first.
// Keep the top fifty states.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not nest Source Companies.
// This file does not paint the home Overview.

// ── 1. Split matching Bookings by local vs long-distance ─

export async function splitMatchingBookingsByLocalVsLongDistance(models, query)

async function takeTheMatchingBookings(models, query)
  // asks leftover bookedLeadPrefix
function treatABlankLocalAsUnknown(booking)        // null / "" → "unknown"
function countCancelledAndTheBookingMoney()
function rateCancelledAgainstThoseBookings()
function sortLocalTypesByDeposit()

// ── 2. Rank Form and Call pickup-to-delivery lanes ────────

export async function rankPickupToDeliveryLanesForFormAndCallLeads(models, query)

async function takeTheMatchingFormLeads(models, query)
  // asks leftover leadMatchForQuery("FormLead")
async function takeTheMatchingCallLeads(models, query)
  // asks leftover leadMatchForQuery("CallLead")
function treatABlankStateAsUnknown(lead)           // pickup / delivery
function groupByPickupAndDelivery()
function rateBookedAgainstThoseLeads()
function keepTheTopFiftyLanes()
function keepFormAndCallLanesApart()               // never add the two lists

// ── 3. Rank matching Leads by pickup or delivery state ────

export async function rankMatchingLeadsByPickupOrDeliveryState(models, query, dimension)

async function countMatchingFormLeadsByState(models, query, dimension)
async function countMatchingCallLeadsByState(models, query, dimension)
function addFormAndCallCountsByRawState()          // "CA" and "ca" stay two rows
function rateBookedAgainstThoseLeads()
function keepTheTopFiftyStates()
```

Read the local path out loud: *The owner asked for Local vs Long Distance on a database someone else already picked, plus leftover chips. Take matching Bookings on leftover `book_date` prefix. A blank local is “unknown.” Count them. Count how many already have a Cancellation ref. Add Deposit and Binder. Rate cancelled over Bookings. Hand `{ items }` back. The lane table then takes matching Form Leads and matching Call Leads on leftover `timestamp` match, keeps the two lists apart, and cuts each to fifty. The state table adds Form and Call first, then cuts fifty. Live versus historical, adding the two collections, nesting Source Companies, and flattening a spreadsheet live next door.*

That is the operation. `getLocalVsLongDistance` is not a different story. `getGeographicLanes` is not a booked rewrite of local. `getStatePerformance` is not a merged rewrite of lanes. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` is an executor name.** The owner asked to split matching Bookings by local vs long-distance, to rank Form and Call pickup-to-delivery lanes, or to rank matching Leads by pickup or delivery state. The names should say that. Do not teach Wave B `getLocalVsLongDistance` as if this file owned the leftover dispatcher envelope.

2. **Local-vs-long is Bookings; lanes and states are Leads.** The first export never opens form / call collections. The other two never open `booked-leads`. A Booking whose Lead sits outside the timestamp window can paint local and miss the lane. The reverse is also true. Do not point lanes at leftover `bookedLeadPrefix` so “every place table shares book date,” and do not teach local leftover `leadMatchForQuery` so “timestamp owns all three.”

3. **`booked_leads` / `cancelled_leads` on lanes and states are Lead refs, not collections.** `$ne: [{ $ifNull: ["$booked", null] }, null]` / same for `cancelled`. Already-recommended Source Company funnel names those `sheet_booked_leads` / `sheet_cancelled_leads` and overlays Bookings as `reconciled_*`. Already-recommended Cancellation rating’s `cancelled_leads` is booked `is_cancelled`. Do not silently join `booked-leads` here so “booked means Bookings,” and do not rename the JSON keys in this pass so “every report matches funnel.”

4. **Lanes keep Form and Call apart; states add them.** A CA→NY Form Lead and a CA→NY Call Lead stay two lane rows. The same two Leads become one CA pickup-state row. Leftover CSV then stamps `lead_type: "form"` / `"call"` only on lanes. Do not add the two lane lists so “lanes match states,” and do not split states back into form/call so “states match lanes.”

5. **The lane and state rankings always cut 50.** Lanes `$limit` each list. States `slice(0, 50)` after the add. Leftover combined merge concatenates two already-cut lists and does **not** re-slice 50. A lane that is 51st on both databases never appears, even if the added Lead count would have been top fifty. Combined can also paint more than fifty unique lanes or states. Same leftover-merge cut as already-recommended Agent ranking and Cancellation reasons. Do not drop the cut so “combined is honest,” and do not re-slice leftover merge here so “the place file can add.”

6. **Local-vs-long never cuts and never seeds the enum.** `LOCAL_TYPES` is `local` | `long_distance`. A quiet type is omitted, not zeroed. Live `BookedLead.local` is optional, so `"unknown"` is a real third bucket. Do not seed both enum values so “the table always has two rows,” and do not drop `"unknown"` so “empty locals vanish.”

7. **This file groups by the raw spelling; leftover combined merge lowercases.** `CA` and `ca` stay two state rows on one database. `TX|NY` and `tx|ny` stay two lanes. Leftover `mergeAnalyticsPayload` keys leftover `normalizeDimensionKey` (trim + lowercase), so those spellings become one row only when combined. Do not silently `$toLower` this `$group` so “the report matches combined,” and do not teach leftover merge to keep raw casing so “combined matches live.”

8. **Leftover combined `defaultSort` does not know `leads` or `state`.** This file sorts local by deposit, lanes / states by leads then booked. Leftover `mergeRows` re-sorts deposit, then binder, then `bookings` (not `leads` / `booked_leads`), then leftover `local_type`. Combined lanes and states have no deposit and no `bookings`, so they lose the leads-desc order. Do not change leftover merge sort here so “combined matches live,” and do not drop this file’s leads sort so “every place table matches local deposit.”

9. **Leftover combined `deriveRates` invents fields these cards never had.** After leftover merge sums additive counts, leftover `deriveRates` sets `cancellation_rate` and `active_bookings` whenever it sees `bookings` or `booked_leads` / `cancelled_*`. Combined local can show `active_bookings` and `booking_rate: 0` (`rate(bookings, 0)`). Combined lanes / states can show `cancellation_rate` as cancelled-refs ÷ booked-refs and a second `active_bookings`. Do not compute those fields here so “combined matches live,” and do not teach leftover merge to skip them in this rename so “download matches JSON.”

10. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover merge after two calls. Do not call leftover merge here so “the place file can add,” and do not teach this file `concreteScopes`.

11. **The leftover `local` chip can collapse the local split.** Leftover `bookedLeadPrefix` exact-matches Booking `local`. Asking Local vs Long Distance with `local=local` returns at most that bucket plus nothing for `long_distance`. Lanes / states apply the same chip to Lead `local`, not to state. Do not ignore the chip on the local export so “the split always shows both types,” and do not teach lanes to filter Booking `local` so “the chip means the same collection.”

12. **The leftover `lead_type` chip empties the other lane list.** Leftover `leadMatch` pushes `{ _id: { $exists: false } }` on the other type. `lead_type=form` leaves `call_lanes: []` and a state table that is Form only. Local-vs-long uses leftover booked `lead_model` instead. Do not skip the empty Call aggregate so “lanes always have two lists,” and do not teach local leftover `leadMatchForQuery` so “lead_type means the same prefix.”

13. **Date fields differ.** Local uses leftover `book_date`. Lanes / states use leftover Lead `timestamp`. The same chips can paint a Lead on a lane and miss its Booking on the local card. Do not point all three at `book_date` so “the three tables share a window.”

14. **Money lives only on the Booking split.** Lanes / states have no deposit / binder. Do not add Booking money to lanes so “every place table can sort like local,” and do not drop money from local so “CSV owns the split.”

15. **A quiet catalog state is omitted, not zeroed.** There is no leftover nest. Already-recommended Source Company scorecards seed catalog children. Do not seed every USPS state here so “the table matches the catalog,” and do not nest lanes under Source Company.

16. **Tests never call these three exports.** There is no `geographicAnalytics.service.test.ts`. Leftover dispatcher tests never **ask** `getLocalVsLongDistance` / `getGeographicLanes` / `getStatePerformance`. Live 50-cuts, form/call-apart lanes, form+call state add, and `"unknown"` local are unproven at this **interface**.

17. **Leave sibling modules alone.** `bookedLeadPrefix` / `leadMatchForQuery` stay in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Source Company scorecards, Agent ranking, Cancellation rating, CSV flatten, and other named reports stay in their files. This file orchestrates booked prefix → local group, then leftover lead match → lane group or state add → optional top 50.

18. **Do not treat already-recommended Source Company funnel as this story.** Funnel counts Form / Call refs, then overlays Bookings as reconciled money, then leftover-nests catalog children. Do not import it here so “every Form + Call count lives together.”

19. **Do not treat already-recommended Cancellation rating as this story.** Ratio counts booked `is_cancelled` and leftover-nests Source Companies. Reasons open `cancelled-leads` on `cancel_date`. Do not import them here, and do not teach this file `{ overall, by_source_company }`.

20. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file pickup × delivery.

## Testing

The **interface** is the test surface: `splitMatchingBookingsByLocalVsLongDistance` (`getLocalVsLongDistance`), `rankPickupToDeliveryLanesForFormAndCallLeads` (`getGeographicLanes`), and `rankMatchingLeadsByPickupOrDeliveryState` (`getStatePerformance`). The `{ items }` lists and the `{ form_lanes, call_lanes }` pair are part of that **interface**.

Today there is no `geographicAnalytics.service.test.ts`. Fill the gap the story names make obvious:

**Split matching Bookings by local vs long-distance**
- **Asks** leftover `bookedLeadPrefix(query)` on the handed booked model — does **not** query form / call / cancelled collections.
- Blank / null `local` becomes `"unknown"`. Stored `local` / `long_distance` stay those strings.
- `cancelled_bookings` is leftover `$cond` on `is_cancelled`. Deposit / binder are Booking totals, Mongo `$round` 2.
- `cancellation_rate` is cancelled ÷ bookings (0 when none). There is no `booking_rate` / `active_bookings` on this card.
- Sort is deposit desc. Pipeline does **not** `$limit`.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Rank Form and Call pickup-to-delivery lanes**
- **Asks** leftover `leadMatchForQuery("FormLead")` and `"CallLead"` in parallel — date field is `timestamp`.
- Blank / null pickup or delivery becomes `"unknown"`.
- `booked_leads` / `cancelled_leads` are Lead refs, not collection counts.
- Form CA→NY and Call CA→NY stay on different lists. The export does **not** add them.
- Each list `$sort`s leads desc, booked desc, then `$limit`s 50.
- Returns `{ form_lanes, call_lanes }`, not `{ items }`.

**Rank matching Leads by pickup or delivery state**
- **Asks** the same leftover lead match twice, once per lead type, then adds by raw `_id`. `CA` and `ca` stay two rows.
- `dimension: "pickup_state"` reads `$pickup_state`. `"delivery_state"` reads `$delivery_state`.
- Sort is leads desc, booked desc. Result `slice`s 50.
- Returns `{ items }` with `state`, not `pickup_state` / `delivery_state`.
- Does **not** **ask** leftover `bookedLeadPrefix` or leftover nest.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge lowercasing `CA` + `ca`, inventing `active_bookings` / lane `cancellation_rate`, or re-sorting lanes by deposit — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order or leftover lead-match catalog load — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover CSV `lead_type: "form"` / `"call"` prepend — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert leftover Source Company funnel `sheet_booked_leads` vs `reconciled_bookings` — that is already-recommended `sourcePerformance.service.ts`.
- Do **not** assert leftover Cancellation rating `{ overall, by_source_company }` — that is already-recommended `cancellationAnalytics.service.ts`.
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`treatABlankLocalAsUnknown`, `keepFormAndCallLanesApart`, `addFormAndCallCountsByRawState`, `keepTheTopFiftyStates`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, or RingCentral reconcile here.

## What I would not do

- A `GeographicAnalyticsService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$group`.
- Moving this into a CRUD folder, or into `leads/` / `bookings/` / `admin/` “because those also store state and local.”
- Splitting `getLocalVsLongDistance`, `getGeographicLanes`, and `getStatePerformance` into three files on this pass, or splitting pickup vs delivery into two aggregations.
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten / Source Company funnel into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/summary` or `GET /api/v1/admin/analytics/source-company-funnel` at this file, or pointing the four report routes past the leftover dispatcher.
- Adding Form and Call lane lists so “lanes match states,” or joining `booked-leads` so “`booked_leads` means Bookings.”
- Pointing lanes and states at `book_date` so “the three tables share a window.”
- Computing `active_bookings` / lane `cancellation_rate` here so “combined leftover merge looks intentional.”
- Dropping the lane / state 50-cut so “combined can re-rank everyone.”
- Seeding every catalog state or both `LOCAL_TYPES` so “the table always looks full.”
- Treating leftover Source Company funnel, leftover Cancellation rating, leftover Lead Cost, leftover Receiver-Agent / SMS / Agent Sales, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
