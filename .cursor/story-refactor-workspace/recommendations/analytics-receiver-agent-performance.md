# Rank These Receiver Agents By Received Leads, Chart Them Across Periods, And Break Them Down By Source And Lead Type — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 9 of this service — `receiverAgentPerformance.service.ts`
- Remaining in this service: `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/receiverAgentPerformance.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`receiver-agent-performance` / `trend` / `source-breakdown`: form + call (`receiver_agent`). Historical skip: leftover dispatcher returns `unsupportedReceiverAgentReport()` (`items: []` + `historical_receiver_agent_supported: false`). Combined merge keeps live rows and that warning metadata. Source breakdown groups by `source_granularity_key` and catalog `owner_label`. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ items }` by leftover keys lives in leftover merge, not here. CSV: leftover flatten emits the ranking / trend / breakdown columns; trend CSV omits rates; breakdown CSV omits `form_leads` / `call_leads` / CPL averages). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/{receiver-agent-performance,receiver-agent-trend,receiver-agent-source-breakdown}` **asks** this; this file **does not** pick live / historical / combined — leftover dispatcher returns the empty card on historical). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (Summary + top Agents + leftover last-week by-source — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** group Receiver). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets on booked `$report_date` after leftover `$set` from `book_date` — **does not** group Receiver, **does not** open form / call). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children; funnel **does** count Form / Call refs, then overlays Bookings — **does not** group `receiver_agent`). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (unwind Booking allocations, hard top 50, Deposit sort — **does not** read Lead `receiver_agent`). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (booked `is_cancelled` overall / by source; reasons open `cancelled-leads` — **does not** group Receiver). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (local / lanes / states — **does not** look up Booking or Cancellation rows). Distinct from already-recommended Receiver stamp writes: [`agents-receiver-agent-crm-username.md`](agents-receiver-agent-crm-username.md). Distinct from leftover booked-prefix / lead match / rate / `trendDateExpression` helpers: later `analyticsFilters.ts` (this file **asks** `leadMatchForQuery`, `trendDateExpression`, leftover number / rate / fold helpers). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` — keys `receiver_agent_id` + `receiver_agent_name`, plus `period` on trend, plus source / `lead_type` on breakdown; leftover rewrite of warning metadata). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (breakdown **asks** `sourceLabelIndexFromCatalog` for labels only — **does not** nest or seed zeros). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits the three column lists. Distinct from leftover SMS conversion: later `smsConversion.service.ts` (same historical-empty shape, Lead Messages — **does not** group Receiver). Distinct from leftover Agent Sales / Lead Cost. Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Receiver Agent / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a receiver-agent-performance Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "receiver-agent-performance"` / `"receiver-agent-trend"` / `"receiver-agent-source-breakdown"` — historical **asks** `unsupportedReceiverAgentReport`; live **asks** the matching ranking). Barrel `analytics/index.ts` does **not** export these four. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for those three strings — `GET /api/v1/admin/analytics/{receiver-agent-performance,receiver-agent-trend,receiver-agent-source-breakdown}`; `analyticsQuerySchema` `receiver_agent` 24-hex) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/{receiver-agent-performance,receiver-agent-trend,receiver-agent-source-breakdown}.csv`). Already-recommended Overview / leftover Summary / leftover Source Company scorecards / leftover Agent ranking / leftover Cancellation rating / leftover place ranking do **not** import this file. Tests: `receiverAgentPerformance.service.test.ts` (**asks** `getReceiverAgentPerformance` only — both form and call pipelines mention `$cpl` and do **not** mention `cpl_resolution_status`; **does not call** trend / breakdown / unsupported). `analytics.service.test.ts` leftover-merges `"receiver-agent-performance"` with an empty historical card and leftover-parses the report string — **does not call these four exports**.
- Seams callers need: rank-these-receiver-agents (`getReceiverAgentPerformance`: one `{ items, metadata }` list for already-scoped form / call models + chips) vs chart-them-across-periods (`getReceiverAgentTrend`: the same counts grouped by leftover period + Receiver) vs break-them-down-by-source (`getReceiverAgentSourceBreakdown`: the same counts grouped by Receiver + Source Granularity + `lead_type`, then leftover catalog labels) vs hand-back-the-empty-card (`unsupportedReceiverAgentReport`: leftover dispatcher **asks** this on historical) vs run-this-named-report (already-recommended dispatcher **asks** one of the four, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam**. There is no CSV-column **seam**. There is no Agent-allocation **seam**. There is no SMS **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~413-line file is one sitting if you read it as rank these Receiver Agents by received Leads, then chart that same ranking across periods, then break it down by Source and lead type, and hand back the empty historical card. Do **not** split the three owner tables into `getReceiverAgentPerformance.ts` / `getReceiverAgentTrend.ts` / `getReceiverAgentSourceBreakdown.ts` on this pass — they share one received-Lead pipeline, not a CRUD folder. Do **not** pull leftover filters / merge here so “the Receiver file owns the match.” Do **not** pull leftover Agent ranking here so “every Agent table lives together.” If it later splits: `rankTheseReceiverAgentsByReceivedLeads.ts`, `chartTheseReceiverAgentsAcrossPeriods.ts`, and `breakTheseReceiverAgentsDownBySourceAndLeadType.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getReceiverAgentPerformance` / `getReceiverAgentTrend` / `getReceiverAgentSourceBreakdown` / `unsupportedReceiverAgentReport` are executor mechanics. The owner questions are: *I asked how each Receiver Agent is doing on Leads they received. Take matching Form Leads and matching Call Leads on lead timestamp, not book date. A blank receiver is Unassigned. Count every Lead. Count how many are billable — priced CPL, not a Duplicate Form and not an unmatched Call. Count how many still have no CPL. Count how many already have a Booking, including a Booking row that points back when the Lead ref is empty. Count how many already have a Cancellation, including a Cancellation row or a Booking that already has a Cancellation ref. Add Form and Call into one row per Receiver. Rate booked over received. Rate cancelled over booked. Cost is stored CPL on billable Leads only. Chart that same ranking across days or months. Then break the same ranking down by Source Granularity and lead type. Historical Leads do not carry Receiver attribution — hand back the empty card when the leftover dispatcher asks. This file does not pick live versus historical. This file does not add the two collections. This file does not unwind Booking allocations. This file does not nest Source Companies. This file does not paint the home Overview. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking, leftover filters / merge / catalog labels / CSV / SMS / Agent Sales / Lead Cost / other named reports, leftover scope pick, already-recommended Receiver stamp writes, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Four exports of one “rank these Receiver Agents by received Leads” story, not “a receiver-agent CRUD report service,” and not the Agent Performance unwind:

1. **Rank these Receiver Agents by received Leads** — `getReceiverAgentPerformance`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. In parallel: leftover `leadMatchForQuery("FormLead")` / `"CallLead"`, plus an optional leftover `receiver_agent` ObjectId clause. `$lookup` hardcoded `agents`, `booked_leads`, `cancelled_leads` (collection names, not the handed models). Blank / null `receiver_agent` becomes id `"unassigned"`, name `"Unassigned"`, group `"unassigned"`. Prefer `receiver_agent_name_snapshot`, else the joined Agent name, else `"Unassigned"`. `$group` `_id` is `{ receiver_agent_id, receiver_agent_name, receiver_agent_group }`. Sum `received_leads`, `billable_received_leads`, `unresolved_cpl_count`, `form_leads` / `call_leads`, `booked_leads`, `cancelled_leads`, `total_lead_cost` (stored `$cpl` only when billable). Project `active_booked_leads` as `$max(booked - cancelled, 0)`, Mongo `$round` cost to 2. **Add Form + Call in this file** (`mergeReceiverRows` by those three fields). Derive rates in JS. Sort received desc, booked desc, name asc. **No `$limit`.** Return `{ items, metadata }` with the live-only warning. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never calls `concreteScopes` / `getAdminModels`, and never opens the handed booked / cancelled models.

2. **Chart these Receiver Agents across periods** — `getReceiverAgentTrend`. Same received-Lead pipeline. `$set period` from leftover `trendDateExpression` (`$report_date`, day or month). `$group` `_id` is `{ period, receiver_agent_id, receiver_agent_name }` (no group). Same add of Form + Call. Sort period asc, then the same received / booked / name order. Same metadata.

3. **Break these Receiver Agents down by Source and lead type** — `getReceiverAgentSourceBreakdown`. Same pipeline. `$group` `_id` is `{ receiver_agent_id, receiver_agent_name, source_company, source_granularity_key, lead_type }`. After the add, **ask** leftover `getAdminFacets(query.database_scope)` + leftover `sourceLabelIndexFromCatalog` for the granularity `owner_label`. Keep leftover-lowercased keys except `"unknown"`. Sort by the same received / booked / name order. Same metadata. Does **not** nest companies or seed quiet catalog children.

4. **Hand back the empty historical card** — `unsupportedReceiverAgentReport`. `{ items: [], metadata }` with `receiver_agent_scope: "unsupported"` and the switch-to-live-or-combined message. Leftover dispatcher **asks** this when the concrete scope is historical. Combined leftover merge then keeps the live `{ items }` and rewrites the warning.

There is no fifth owner operation. Trend and breakdown are the same ranking with extra group fields. Combined add of two `{ items }` lists is leftover merge after the leftover dispatcher calls this twice (or once plus the empty card). Do not export leftover `leadMatchForQuery` from this file as if this story owned every Lead chip. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases. Do not export leftover `trendDateExpression` from this file as if this story owned Revenue Trend.

## Organization

Keep one file. This is the screenplay for “rank these Receiver Agents by received Leads, chart them across periods, and break them down by Source and lead type.” Chip match, combined add, catalog labels, home Overview, named-report dispatch, Agent ranking, SMS conversion, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `ReceiverAgentPerformanceService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `leadMatchForQuery`. Do not invent a date **adapter** beside leftover `trendDateExpression`. Do not invent a label **adapter** beside leftover `sourceLabelIndexFromCatalog`.

Do not split this by HTTP report string on this pass. Ranking, trend, and breakdown are three beats of one Receiver sitting. Do not move this into `agents/` so “the write folder owns every Receiver table.” Do not add Agent Performance / Agent Sales / SMS cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getReceiverAgentPerformance` | `rankTheseReceiverAgentsByReceivedLeads` | leftover dispatcher **asks** the `{ items, metadata }` ranking |
| `getReceiverAgentTrend` | `chartTheseReceiverAgentsAcrossPeriods` | leftover dispatcher **asks** the same ranking grouped by period |
| `getReceiverAgentSourceBreakdown` | `breakTheseReceiverAgentsDownBySourceAndLeadType` | leftover dispatcher **asks** the same ranking grouped by Source + `lead_type` |
| `unsupportedReceiverAgentReport` | `handBackTheEmptyReceiverAgentCard` | leftover dispatcher **asks** the empty historical card |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$lookup` / `receivedLeadRows` / `deriveReceiverRates` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

`chartTheseReceiverAgentsAcrossPeriods` and `breakTheseReceiverAgentsDownBySourceAndLeadType` should keep calling the same received-Lead pipeline with different group fields. Do not keep three copies of the Form / Call aggregate.

**No class for the workflow.** The types that *do* earn a name are the cards the Admin Dashboard already paints:

```ts
type ThisReceiverAgentLeadScore = {
  receiver_agent_id: string          // ObjectId string, or "unassigned"
  receiver_agent_name: string        // snapshot, else joined Agent name, else "Unassigned"
  receiver_agent_group?: "assigned" | "unassigned"  // ranking only
  period?: string                    // trend only — leftover $report_date string
  source_company?: string
  source_granularity_key?: string
  source_granularity_label?: string  // leftover catalog owner_label, else snapshot / "Unknown"
  lead_type?: "FormLead" | "CallLead"
  received_leads: number             // Form + Call rows after this file’s add
  billable_received_leads: number    // priced CPL; Form not duplicate; Call not unmatched
  unresolved_cpl_count: number       // same eligibility, cpl null
  form_leads: number
  call_leads: number
  booked_leads: number               // Lead.booked set OR a booked_leads row pointing back
  cancelled_leads: number            // Lead.cancelled, Booking.cancelled, or a cancelled_leads row
  active_booked_leads: number        // max(booked - cancelled, 0)
  total_lead_cost: number            // stored cpl on billable rows only, rounded 2
  average_cpl: number                // cost / billable — same formula as cost_per_received_lead
  cost_per_received_lead: number
  cost_per_booked_lead: number       // cost / booked_leads
  booking_rate: number               // booked / received
  cancellation_rate: number          // cancelled / booked
  receiver_attribution_rate: number  // 0 when group is unassigned, else 1
}

type TheseReceiverAgentLeadScores = {
  items: ThisReceiverAgentLeadScore[]
  metadata: {
    receiver_agent_scope: string     // live-only on the ranking; "unsupported" on the empty card
    historical_receiver_agent_supported: false
    historical_excluded_from_receiver_agent_metrics: true
    message: string
  }
}
```

That is the handoff from “we ranked the matching received Leads” to “paint the three Receiver tables.” Combined `items` is leftover merge of two of these lists, not a third database this file sees. A quiet Receiver is missing, not a zero row. There is no fifty-cut.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// receiverAgentPerformance.service.ts
// The owner asked how each Receiver Agent
// is doing on Leads they received.
// Take matching Form Leads and matching Call Leads
// on lead timestamp, not book date.
// A blank receiver is Unassigned.
// Count every Lead.
// Count how many are billable —
// priced CPL, not a Duplicate Form
// and not an unmatched Call.
// Count how many still have no CPL.
// Count how many already have a Booking,
// including a Booking row that points back
// when the Lead ref is empty.
// Count how many already have a Cancellation,
// including a Cancellation row or a Booking
// that already has a Cancellation ref.
// Add Form and Call into one row per Receiver.
// Rate booked over received.
// Rate cancelled over booked.
// Cost is stored CPL on billable Leads only.
// Chart that same ranking across days or months.
// Then break the same ranking down
// by Source Granularity and lead type.
// Historical Leads do not carry Receiver attribution —
// hand back the empty card when asked.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not unwind Booking allocations.
// This file does not nest Source Companies.
// This file does not paint the home Overview.

// ── 1. Rank these Receiver Agents by received Leads ───────

export async function rankTheseReceiverAgentsByReceivedLeads(models, query)

async function takeTheMatchingFormLeads(models, query)
  // asks leftover leadMatchForQuery("FormLead")
  // plus optional leftover receiver_agent ObjectId
async function takeTheMatchingCallLeads(models, query)
function lookUpTheAgentNameAndTheBookingChain()
  // hardcoded agents / booked_leads / cancelled_leads
function treatABlankReceiverAsUnassigned(lead)
function decideWhetherThisLeadIsBillable(lead, leadType)
function countBookedEvenWhenTheLeadRefIsEmpty()
function countCancelledFromLeadOrBookingOrCancellationRow()
function addFormAndCallCountsByReceiver()
function rateBookedAgainstReceivedAndCancelledAgainstBooked()
function sortReceiversByReceivedThenBooked()
function stampTheLiveOnlyWarning()

// ── 2. Chart these Receiver Agents across periods ─────────

export async function chartTheseReceiverAgentsAcrossPeriods(models, query)
  // same ranking; group also includes leftover period

// ── 3. Break these Receiver Agents down by Source ─────────

export async function breakTheseReceiverAgentsDownBySourceAndLeadType(models, query)
  // same ranking; group also includes source + lead_type
  // asks leftover facets + leftover catalog labels

// ── 4. Hand back the empty historical card ────────────────

export function handBackTheEmptyReceiverAgentCard()
```

Read the ranking path out loud: *The owner asked for Receiver-Agent Performance on a database someone else already picked, plus leftover chips. Take matching Form Leads and matching Call Leads on leftover `timestamp` match. A blank receiver is Unassigned. Count them. Count billable priced-CPL rows. Count unresolved CPL. Count Bookings even when the Lead ref is empty, by looking up a Booking that points back. Count Cancellations from the Lead, the Booking, or a Cancellation row. Add Form and Call. Rate booked over received. Hand `{ items, metadata }` back. The trend table groups that same list by leftover period. The breakdown table groups it by Source and lead type, then labels from the leftover catalog. Historical asks the empty card next door. Live versus historical, adding the two collections, unwinding Booking allocations, and flattening a spreadsheet live next door.*

That is the operation. `getReceiverAgentPerformance` is not a different story. `getReceiverAgentTrend` is not a booked rewrite of Revenue Trend. `getReceiverAgentSourceBreakdown` is not a nested rewrite of Source Company scorecards. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` is an executor name.** The owner asked to rank these Receiver Agents by received Leads, to chart them across periods, or to break them down by Source and lead type. The names should say that. Do not teach Wave B `getReceiverAgentPerformance` as if this file owned the leftover dispatcher envelope.

2. **This file never sees `combined` or `historical` on the ranking path.** Leftover dispatcher overwrites `database_scope` to live before it **asks** the three rankings, and **asks** the empty card on historical. Combined add is leftover merge after those two calls. Do not call leftover merge here so “the Receiver file can add,” and do not teach this file `concreteScopes`. Do not run the ranking on historical models so “the empty card can go away.”

3. **The live ranking still stamps the historical warning.** `receiverAgentMetadata()` always says historical records have no Receiver attribution, even on a live-only call. Leftover combined merge then rewrites a stronger combined-only message. Do not drop the warning on live so “the card looks clean,” and do not teach leftover merge to keep this file’s shorter sentence so “combined matches live.”

4. **Receiver-Agent is Leads, not Booking allocations.** Already-recommended Agent ranking `$unwind`s `agent_allocations` on booked models and ranks by Deposit. This file never opens the handed booked model and never sums Binder. Do not point this ranking at leftover `bookedLeadPrefix` so “every Agent table shares book date,” and do not teach Agent Performance Lead `receiver_agent` so “both tables mean Receiver.”

5. **`booked_leads` here is a Lead or a Booking row, not only a Lead ref.** `$or` of Lead `booked` set and `$size` of the `booked_leads` lookup (`lead_ref` + `lead_model`, `$limit` 1). Already-recommended place ranking / Source Company funnel count only the Lead ref. A Lead whose Booking exists without `lead.booked` still paints here and misses those other tables. Do not drop the lookup so “booked means the same as lanes,” and do not teach lanes the lookup so “every Lead report matches Receiver.”

6. **`cancelled_leads` here is three places, not booked `is_cancelled`.** Lead `cancelled`, first joined Booking `cancelled`, or a `cancelled_leads` row on the Lead or that Booking. Already-recommended Cancellation rating counts booked `is_cancelled` only. Do not drop the Cancellation lookup so “cancelled means the ratio,” and do not teach the ratio these three `$or`s so “every cancel count matches.”

7. **`$lookup` uses hardcoded collection names, not the handed models.** `from: "agents"` / `"booked_leads"` / `"cancelled_leads"`. Leftover SMS conversion reads `models["form-leads"].collection.collectionName`. Historical models use the same names on the other database; leftover dispatcher never **asks** this ranking there. Do not switch these lookups to handed `collectionName` in this rename so “SMS owns the style,” and do not teach SMS hardcoded names so “every lookup matches Receiver.”

8. **Trend buckets `$report_date` on Form and Call Leads that do not have that field.** Leftover `trendDateExpression` reads `$report_date`. Already-recommended Revenue Trend `$set`s `report_date` from booked `book_date` / `timestamp` first. This file never `$set`s `report_date`. `$dateToString` on a missing date collapses every Lead into one null period. Do not silently `$set report_date: "$timestamp"` here so “the trend works,” and do not change leftover `trendDateExpression` to `$timestamp` so “every trend shares lead time.” Leave the leftover helper on `$report_date`. Name the missing `$set` in the story.

9. **Form and Call add in this file; leftover combined add happens next door.** `mergeReceiverRows` keys the raw group fields (plus leftover `normalizeSourceDimension` on `source_company`). Leftover `mergeAnalyticsPayload` keys leftover-lowercased `receiver_agent_id` + `receiver_agent_name` (trend also `period`; breakdown also source / `lead_type`) and **does not** key `receiver_agent_group`. `Alice` and `alice` stay two live rows and become one combined row. Do not `$toLower` this `$group` so “the report matches combined,” and do not teach leftover merge to keep raw casing so “combined matches live.”

10. **There is no fifty-cut.** Already-recommended Agent ranking / place lanes / Cancellation reasons `$limit` 50. This ranking returns everyone. Do not add `$limit 50` so “every Agent table matches Agent Performance,” and do not drop Agent Performance’s cut so “every ranking matches Receiver.”

11. **`average_cpl` and `cost_per_received_lead` are the same formula.** Both are leftover `rate(total_lead_cost, billable_received_leads)`. Cost per booked divides by `booked_leads`, including non-billable booked rows. Do not divide cost by `received_leads` so “per received means every Lead,” and do not drop one of the twin fields so “CSV owns the ranking.”

12. **`receiver_attribution_rate` is not a rate.** `0` when `receiver_agent_group === "unassigned"`, else `1`. Trend and breakdown omit `receiver_agent_group`, so leftover derive never recomputes this field and every leftover-merged trend / breakdown row keeps `1` after `deriveReceiverRates` (group missing). Do not average assigned over received so “the name becomes a rate,” and do not add `receiver_agent_group` to trend / breakdown so “every table can stamp 0 or 1.”

13. **Billable is stored CPL plus an eligibility flag, not rate-period status.** Form: `duplicate !== true` and `cpl != null`. Call: `created_on_unmatched !== true` and `cpl != null`. Unresolved is the same eligibility with `cpl == null`. The existing test proves the pipeline mentions `$cpl` and does not mention `cpl_resolution_status`. Do not join `cpl_rate_periods` here so “Analytics can explain a missing rate,” and do not count Duplicate / unmatched rows as unresolved so “every null CPL is a gap.”

14. **The leftover `lead_type` chip empties the other aggregate.** This file returns `[]` for the other type before Mongo. `lead_type=form` leaves `call_leads: 0` after the add. Already-recommended lanes keep two lists and empty the other. Do not skip the empty Call aggregate so “the ranking always has both types,” and do not split this ranking back into form/call lists so “Receiver matches lanes.”

15. **The leftover `receiver_agent` chip is an extra ObjectId `$and`.** Leftover `leadMatchForQuery` does not know that chip. Invalid hex is already refused at leftover Zod. Do not treat a missing Agent catalog row as a 404 here — unmatched ids simply return no rows.

16. **Name snapshot wins over the live Agent join.** `$receiver_agent_name_snapshot` if non-empty, else `agents.name`, else `"Unassigned"`. A renamed catalog Agent keeps the old snapshot on one database. Combined leftover merge keys id **and** name, so the same id with two snapshots stays two rows. Do not `$group` by id only so “rename collapses,” and do not drop the snapshot so “the table always shows the catalog.”

17. **A quiet catalog Receiver is omitted, not zeroed.** Breakdown **asks** leftover facets for labels only. Already-recommended Source Company scorecards seed catalog children. Do not seed every catalog Agent here so “the table matches the desk,” and do not nest Receivers under Source Company.

18. **`source_label` is set and never grouped.** The `$set` builds leftover CRM / granularity / company snapshots, then no export puts `source_label` in `groupFields`. Do not start grouping by it so “the dead field earns a column,” and do not delete the expression in this rename so “cleanup is the story.”

19. **Unused `mongoose` import.** The file imports `mongoose` and never uses it. Do not keep the import so “lookups need the driver,” and do not treat deleting it as a behavior change.

20. **Tests barely call this interface.** `receiverAgentPerformance.service.test.ts` only proves `$cpl` vs `cpl_resolution_status` on the ranking export. Trend, breakdown, unassigned, billable flags, Booking-without-ref, and the empty card are unproven here. Leftover dispatcher tests leftover-merge the ranking — they never **ask** `getReceiverAgentTrend`.

21. **Leave sibling modules alone.** `leadMatchForQuery` / `trendDateExpression` stay in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Catalog labels stay in later `sourceHierarchy.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Source Company scorecards, Agent ranking, Cancellation rating, place ranking, CSV flatten, and leftover SMS stay in their files. This file orchestrates leftover lead match → Agent / Booking / Cancellation lookup → Receiver group → Form+Call add → optional period or Source group → rates.

22. **Do not treat already-recommended Agent ranking as this story.** Allocation unwind, Deposit sort, hard top 50. Do not import it here, and do not teach that file Lead `receiver_agent`.

23. **Do not treat leftover SMS conversion as this story.** Same historical-empty shape, Lead Messages + Lead `booked` ref only. Do not import it here, and do not teach that file Receiver group fields.

24. **Do not treat already-recommended Receiver stamp writes as this story.** `applyGranotCrmUsernameReceiverMatch` mutates a Lead. Do not import it here, and do not teach this file `extension_crm_username_match`.

25. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ items }` by Receiver.

## Testing

The **interface** is the test surface: `rankTheseReceiverAgentsByReceivedLeads` (`getReceiverAgentPerformance`), `chartTheseReceiverAgentsAcrossPeriods` (`getReceiverAgentTrend`), `breakTheseReceiverAgentsDownBySourceAndLeadType` (`getReceiverAgentSourceBreakdown`), and `handBackTheEmptyReceiverAgentCard` (`unsupportedReceiverAgentReport`). The `{ items, metadata }` cards are part of that **interface**.

Today’s `receiverAgentPerformance.service.test.ts` only stubs `aggregate` on form + call and asserts `$cpl` without `cpl_resolution_status`. Keep that proof. Fill the gap the story names make obvious:

**Rank these Receiver Agents by received Leads**
- **Asks** leftover `leadMatchForQuery("FormLead")` and `"CallLead"` in parallel — date field is `timestamp`.
- Blank / null `receiver_agent` becomes id `"unassigned"`, name `"Unassigned"`, group `"unassigned"`.
- Name prefers `receiver_agent_name_snapshot` over the joined Agent name.
- Form + Call rows for the same Receiver add in this file. `lead_type=form` leaves Call counts at 0.
- Form billable is `duplicate !== true` and `cpl != null`. Call billable is `created_on_unmatched !== true` and `cpl != null`. Duplicate / unmatched with null CPL are not unresolved.
- `booked_leads` is true when Lead `booked` is set **or** the `booked_leads` lookup returns a row.
- `cancelled_leads` is true when Lead `cancelled` is set **or** the joined Booking is cancelled **or** the `cancelled_leads` lookup returns a row.
- `total_lead_cost` sums stored `$cpl` only on billable rows. `average_cpl` equals `cost_per_received_lead`.
- `booking_rate` is booked ÷ received. `cancellation_rate` is cancelled ÷ booked (0 when none booked).
- `receiver_attribution_rate` is `0` on the unassigned group and `1` otherwise.
- Sort is received desc, booked desc, name asc. Pipeline does **not** `$limit`.
- Returns `{ items, metadata }` with `historical_receiver_agent_supported: false`.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.
- Lookups name `agents` / `booked_leads` / `cancelled_leads`, not the handed models.

**Chart these Receiver Agents across periods**
- **Asks** the same received-Lead pipeline. `$set period` is leftover `trendDateExpression` (`$report_date`).
- Prove today’s grouping: a Form / Call Lead with no `report_date` still emits a period field (null / missing), and those rows add together. Do not “fix” it onto `$timestamp`.
- Group fields are `period`, `receiver_agent_id`, `receiver_agent_name` — not `receiver_agent_group`.
- Sort is period asc, then the same received / booked / name order.

**Break these Receiver Agents down by Source and lead type**
- **Asks** leftover `getAdminFacets(query.database_scope)` + leftover `sourceLabelIndexFromCatalog`.
- Group keeps `lead_type` so a Form row and a Call row stay apart after the add.
- Catalog `owner_label` wins over the snapshot when the leftover-lowercased key hits. `"unknown"` keeps the raw key.
- Does **not** **ask** leftover `nestObservedSourceRows` or seed quiet catalog children.

**Hand back the empty historical card**
- `{ items: [], metadata.receiver_agent_scope: "unsupported", historical_receiver_agent_supported: false }`.
- Does **not** query Mongo.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of `Alice` + `alice` into one combined row, or leftover rewrite of the combined warning — that is a later sitting (`analyticsMerge.ts`). The existing leftover test already covers the empty-historical add.
- Do **not** assert leftover booked-prefix employee-snapshot order or leftover lead-match catalog load — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover `trendDateExpression` `$report_date` on booked Revenue Trend — that is already-recommended `revenueTrend.service.ts`.
- Do **not** assert leftover CSV omitting trend rates / breakdown averages — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert leftover Agent ranking Deposit-per-allocation-row — that is already-recommended `agentPerformance.service.ts`.
- Do **not** assert leftover SMS historical-empty card — that is a later sitting (`smsConversion.service.ts`).
- Do **not** assert leftover Source Company funnel `sheet_booked_leads` vs `reconciled_bookings` — that is already-recommended `sourcePerformance.service.ts`.
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`treatABlankReceiverAsUnassigned`, `decideWhetherThisLeadIsBillable`, `addFormAndCallCountsByReceiver`, `stampTheLiveOnlyWarning`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, leftover Agent ranking 50-cut, or RingCentral reconcile here.

## What I would not do

- A `ReceiverAgentPerformanceService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$lookup`.
- Moving this into a CRUD folder, or into `agents/` / `admin/` “because those also store Receiver.”
- Splitting `getReceiverAgentPerformance`, `getReceiverAgentTrend`, and `getReceiverAgentSourceBreakdown` into three files or three aggregations on this pass.
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten / Agent ranking / SMS / Source Company nest into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/agent-performance` or `GET /api/v1/admin/reports/agent-sales` at this file, or pointing the three Receiver routes past the leftover dispatcher.
- Pointing the ranking at leftover `bookedLeadPrefix` so “every Agent table shares book date.”
- `$set`ting `report_date: "$timestamp"` so “the trend works,” or changing leftover `trendDateExpression` to `$timestamp`.
- Adding `$limit 50` so “Receiver matches Agent Performance.”
- Seeding every catalog Agent or nesting Receivers under Source Company so “the table matches the funnel.”
- Dropping the Booking / Cancellation lookups so “`booked_leads` means the same as lanes.”
- Treating leftover Agent ranking, leftover SMS conversion, leftover Agent Sales, leftover Lead Cost, leftover Source Company funnel, leftover place ranking, already-recommended Receiver stamp writes, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
