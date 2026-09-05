# Rank These Agents By Deposit On Their Shares Of Matching Bookings — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 6 of this service — `agentPerformance.service.ts`
- Remaining in this service: `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/agentPerformance.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`agent-performance`: booked, unwind allocations — “Binder from **allocation** `binder_amount`; **deposit is `$deposit_amount` per unwound row** (split bookings credit the full deposit to each agent). Sort deposit desc; **top 50**.” Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ items }` by leftover-lowercased `agent_name` lives in leftover merge, not here. Overview “top 5 agents by deposit” **asks** this file’s slice, not a second pipeline). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/agent-performance` **asks** this; this file **does not** pick live / historical / combined). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (**asks** `getTopAgentsByDeposit` for all-time and live last week; combined rematches the two top-five lists — **does not** import `getAgentPerformance`). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** unwind). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets, Booking-total Binder — **does not** unwind). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children, Booking-total Binder — **does not** unwind). Distinct from leftover booked-prefix / rate helpers: later `analyticsFilters.ts` (this file **asks** `bookedLeadPrefix` only). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` keyed on `agent_name`; leftover `normalizeDimensionKey` lowercases; leftover `deriveRates` recomputes `cancellation_rate` / `active_bookings` and **does not** recompute averages). Distinct from leftover Agent Sales: later `agentSalesReport.service.ts` (live models, required `from`/`to`, optional `agents[]`, no leftover prefix, no `$limit 50`, sorts Binder not Deposit, `leads` = `booked_deals`). Distinct from leftover Receiver-Agent reports: later `receiverAgentPerformance.service.ts` (Form / Call Lead `receiver_agent`, historical unsupported). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits the fifty-row list (omits `over_2000_bookings` / `over_4000_bookings`). Distinct from already-recommended Agents desk credits: [`admin-agent-browse-metrics.md`](admin-agent-browse-metrics.md) / current `agentBrowseMetrics.service.ts` (page-name `$in`, folded key, two-stage group: distinct Booking then Agent — **does not** import this file). Distinct from already-recommended who-shares-the-Binder writes: [`agents-agent-allocation.md`](agents-agent-allocation.md). Distinct from leftover booking-cancellation-ratio / geographic / SMS / Lead Cost. Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Agent / Binder / Agent Allocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an agent-performance Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "agent-performance"` → `getAgentPerformance`). Already-recommended Overview `overview.service.ts` (`getTopAgentsByDeposit` all-time + live last week). Barrel `analytics/index.ts` does **not** export these two. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for `"agent-performance"` — `GET /api/v1/admin/analytics/agent-performance`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/agent-performance.csv`). Leftover Agent Sales / already-recommended desk credits / leftover Summary do **not** import this file. Tests: **no** `agentPerformance.service.test.ts`. `analytics.service.test.ts` leftover-parses other report strings and leftover-merges Receiver-Agent — **does not call these two exports**. `overview.service.test.ts` leftover-merges two `top_agents` lists — **does not call `getTopAgentsByDeposit`**.
- Seams callers need: rank-these-agents (`getAgentPerformance`: one `{ items }` list, hard top 50, for already-scoped booked models + chips) vs name-the-top-five (`getTopAgentsByDeposit`: the same ranking, then `slice(0, limit)` default 5) vs run-this-named-report (already-recommended dispatcher **asks** the fifty-row list, then optionally leftover merge) vs paint-the-home (already-recommended Overview **asks** the five-row slice) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no desk **seam**. There is no Agent-Sales **seam**. There is no Receiver-Agent **seam**. There is no CSV-column **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~77-line file is one sitting if you read it as rank these Agents by Deposit on their shares of matching Bookings, then name the top five of that same list. Do **not** split the fifty-row table and the five-row slice into `getAgentPerformance.ts` / `getTopAgentsByDeposit.ts`. Do **not** pull leftover filters / merge here so “the ranking owns the match.” Do **not** pull leftover Agent Sales or already-recommended desk credits here so “every Agent unwind lives together.” If it later splits: `rankTheseAgentsByDepositOnMatchingBookingShares.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getAgentPerformance` / `getTopAgentsByDeposit` / `aggregateAgentPerformance` are executor mechanics. The owner questions are: *I asked how each Agent is doing. Take the Bookings that match these chips. Unwind who shares each Booking. Binder is this Agent’s share. Deposit rides each allocation row — two Agents each get the full Deposit. Group by the snapshot name as stored, not folded. Rank by Deposit and keep the top fifty. The home Overview then takes the first five of that same list. This file does not pick live versus historical. This file does not add the two collections. This file does not pin the Agents desk. This file does not print Agent Sales. This file does not score Receiver Agents on Leads. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards, leftover filters / merge / CSV / Agent Sales / Lead Cost / other named reports, leftover scope pick, already-recommended Agents desk credits, already-recommended who-shares-the-Binder writes, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Two exports of one “rank these Agents by Deposit on their shares of matching Bookings” story, not “an agent-performance CRUD report service,” and not the Agents desk or Agent Sales:

1. **Rank each Agent by Deposit on matching Booking shares** — `getAgentPerformance`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. **Ask** leftover `bookedLeadPrefix`, `$unwind` `agent_allocations`, treat a null/empty snapshot as `"unknown"`, `$match` `agent_name != ""` (dead after the unknown fill), `$group` by the raw snapshot string. Sum `bookings` (`$sum: 1` after unwind), `cancelled_bookings` (`$cond` leftover `is_cancelled`), allocation `binder_amount`, Booking `deposit_amount` on each unwound row, `over_2000_bookings` / `over_4000_bookings`. Project `active_bookings` as `$subtract` (no `max`), Mongo `$round` money and averages to 2, `cancellation_rate` as cancelled ÷ bookings (0 when none). `$sort` deposit desc, bookings desc, `agent_name` asc. **`$limit` 50.** Return `{ items }`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never counts Form / Call Leads or Cancellation rows, and never calls `concreteScopes` / `getAdminModels`.

2. **Name the top five of that same ranking** — `getTopAgentsByDeposit`. **Ask** the same aggregate, then `slice(0, limit)` (default 5). Return a bare array, not `{ items }`. Already-recommended Overview **asks** this for all-time (empty leftover chips, that scope’s models) and for live last week (rolling window chips). Combined Overview rematches the two five-row lists next door — it never **asks** the fifty-row export.

There is no third owner operation. `aggregateAgentPerformance` is the shared ranking, not a public **seam**. Combined add of two `{ items }` lists is leftover merge after the leftover dispatcher calls the fifty-row export twice (`agent_name` key, leftover-lowercased). Do not export leftover `bookedLeadPrefix` from this file as if this story owned every Booking chip. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases.

## Organization

Keep one file. This is the screenplay for “rank these Agents by Deposit on their shares of matching Bookings, then name the top five.” Chip match, combined add, home Overview, named-report dispatch, Agent Sales, Agents desk credits, who-shares-the-Binder writes, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent an `AgentPerformanceService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `bookedLeadPrefix`. Do not invent a desk **adapter** beside already-recommended `tallyThisAgentsBookingsForTheDesk`.

Do not split this by HTTP vs home. The five-row slice is the same ranking with a shorter cut. Do not move this into `admin/` so “the Admin Dashboard folder owns every Agent table.” Do not add Agent Sales / Receiver-Agent / desk cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getAgentPerformance` | `rankTheseAgentsByDepositOnMatchingBookingShares` | leftover dispatcher **asks** the nested `{ items }` list (hard top 50) |
| `getTopAgentsByDeposit` | `nameTheTopFiveAgentsByDeposit` | already-recommended Overview **asks** the first five of the same ranking |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` and `overview.service.ts` migrate. Do not make callers learn `$unwind` / `aggregateAgentPerformance` / leftover `bookedLeadPrefix` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

`nameTheTopFiveAgentsByDeposit` should keep calling the same ranking, then slice. Do not keep a second copy of the pipeline.

**No class for the workflow.** The type that *does* earn a name is one Agent row the Admin Dashboard already paints:

```ts
type ThisAgentsBookingShareScore = {
  agent_name: string             // raw snapshot; "" / null became "unknown"
  bookings: number               // allocation rows after unwind, not distinct Bookings
  cancelled_bookings: number     // those rows whose Booking has a Cancellation ref
  active_bookings: number        // bookings - cancelled_bookings (no max)
  total_binder_amount: number    // this Agent’s allocation shares, Mongo $round 2
  total_deposit_amount: number   // Booking deposit on each unwound row, Mongo $round 2
  average_binder_amount: number  // binder / bookings
  average_deposit_amount: number // deposit / bookings
  cancellation_rate: number      // cancelled_bookings / bookings
  over_2000_bookings: number     // JSON-only
  over_4000_bookings: number     // JSON-only
}

type TheseAgentsBookingShareRanking = { items: ThisAgentsBookingShareScore[] }
```

That is the handoff from “we ranked the matching allocation rows” to “paint the Agent Performance table.” Combined `items` is leftover merge of two of these lists by leftover-lowercased `agent_name`, not a third database this file sees. A quiet Agent is missing, not a zero row. The fifty-first Agent by Deposit is missing even on one database.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// agentPerformance.service.ts
// The owner asked how each Agent is doing.
// Take the Bookings that match these chips.
// Unwind who shares each Booking.
// Binder is this Agent’s share.
// Deposit rides each allocation row —
// two Agents each get the full Deposit.
// Group by the snapshot name as stored, not folded.
// Rank by Deposit and keep the top fifty.
// The home Overview then takes the first five
// of that same list.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not pin the Agents desk.
// This file does not print Agent Sales.
// This file does not score Receiver Agents on Leads.

// ── 1. Rank each Agent by Deposit on matching Booking shares ─

export async function rankTheseAgentsByDepositOnMatchingBookingShares(models, query)

async function takeTheMatchingBookings(models, query)
  // asks leftover bookedLeadPrefix
function unwindWhoSharesEachBooking()
function treatABlankSnapshotAsUnknown(allocation)   // null / "" → "unknown"
function groupByTheRawSnapshotName()                // not $toLower
function creditBinderAsThisShareAndDepositOnEveryRow()
function rateCancelledAgainstThoseRows()
function keepTheTopFiftyByDeposit()

// ── 2. Name the top five of that same ranking ─────────────

export async function nameTheTopFiveAgentsByDeposit(models, query, limit = 5)
  // same ranking, then slice
```

Read the ranking path out loud: *The owner asked for Agent Performance on a database someone else already picked, plus leftover chips. Take matching Bookings on leftover `book_date` prefix. Unwind who shares each Booking. A blank snapshot is “unknown.” Count each remaining allocation row. Binder is that row’s share. Deposit is the Booking’s Deposit on that row. Cancelled means the Booking already has a Cancellation ref. Group by the snapshot spelling as stored. Rank by Deposit. Keep fifty. Hand `{ items }` back. The home takes the first five of that same list. Live versus historical, adding the two collections, pinning the Agents desk, printing Agent Sales, and flattening a spreadsheet live next door.*

That is the operation. `getAgentPerformance` is not a different story. `getTopAgentsByDeposit` is not a second unwind. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` is an executor name.** The owner asked to rank these Agents by Deposit on their shares of matching Bookings, or to name the top five of that list. The names should say that. Do not teach Wave B `getAgentPerformance` as if this file owned the leftover dispatcher envelope.

2. **`bookings` is allocation rows, not distinct Bookings.** After `$unwind`, `$sum: 1`. Two allocations for the same Agent on one Booking count two. Already-recommended desk credits now group `{ agent_key, booking_id }` first, so that page’s `booking_count` is distinct Bookings. Do not silently copy the desk’s two-stage group here so “the report matches the desk,” and do not change the desk in this pass.

3. **Deposit rides each unwound allocation row.** `total_deposit_amount` sums `$deposit_amount` after unwind. Two Agents on one Booking each receive the full Deposit. The same Agent twice on one Booking doubles it. Knowledge names this. Already-recommended desk credits now `$first` deposit per Booking. project-organization still says “once per Booking” for the desk, not this report. Do not silently `$first` here so “once means once,” and do not split Deposit the way Binder is split so “both money fields feel the same.”

4. **Binder is this Agent’s share, not the Booking total.** `$sum` of `agent_allocations.binder_amount`. Already-recommended Source Company / Revenue Trend / Summary sum `$total_binder_amount` once per Booking. Do not switch to the Booking total here so “Agent Performance matches Source Company,” and do not unwind those other reports so “every table shares allocations.”

5. **This file groups by the raw snapshot; the desk folds; leftover combined merge lowercases.** `Alice Agent` and `alice agent` stay two rows on one database. Already-recommended desk credits `$toLower` + trim. Leftover `mergeAnalyticsPayload("agent-performance")` keys leftover `normalizeDimensionKey` (trim + lowercase), so those two spellings become one row only when combined. Do not silently `$toLower` this `$group` so “the report matches the desk,” and do not teach leftover merge to keep raw casing so “combined matches live.”

6. **The ranking always `$limit`s 50.** Combined leftover merge concatenates two already-cut lists and does **not** re-slice 50. An Agent who is 51st on both databases never appears, even if the added Deposit would have been top fifty. Combined can also paint more than fifty unique names. Do not drop the `$limit` so “combined is honest,” and do not re-slice leftover merge here so “the scorecard file can add.”

7. **The top five is the same ranking, then `slice`.** On one database that is the true top five. Already-recommended combined Overview rematches the two five-row lists and slices 5 again — an Agent who is sixth on both never appears. Do not silently **ask** the fifty-row export from Overview so “combined top five is honest,” and do not drop this file’s 50-limit so Overview can re-rank a full table.

8. **`$match agent_name != ""` is dead.** The previous `$set` already turned null / `""` into `"unknown"`. Do not add a second blank skip so “unknown disappears,” and do not drop the `"unknown"` bucket so “empty snapshots vanish.” A catalog Agent actually named `unknown` inherits those rows.

9. **Averages divide by allocation-row `bookings`.** Leftover combined `deriveRates` recomputes `cancellation_rate` and `active_bookings`. It does **not** recompute `average_binder_amount` / `average_deposit_amount` (those fields are not leftover `NUMERIC_FIELDS`). Combined averages stay the first payload’s values. Do not recompute averages here so “this file owns combined,” and do not add averages to leftover merge in this rename so “download matches JSON.”

10. **`over_2000_bookings` / `over_4000_bookings` are JSON-only.** Leftover agent-performance CSV omits them. Do not add those columns in this rename so “download matches JSON,” and do not drop the sums so “CSV owns the ranking.”

11. **`active_bookings` is `$subtract` without `max`.** Leftover merge uses `Math.max(bookings - cancellations, 0)` when it has to invent the field. Already-recommended Summary uses `max`. Do not wrap this `$subtract` in `max` so “every report matches Summary,” and do not change leftover merge.

12. **This file never sees `combined`.** Callers overwrite `database_scope` to live or historical before they **ask** this. Combined add is leftover `mergeAnalyticsPayload` after two calls. Do not call leftover merge here so “the ranking file can add,” and do not teach this file `concreteScopes`.

13. **A quiet Agent is omitted, not zeroed.** There is no leftover catalog-style seed. Already-recommended desk credits pin zeros for names on the page. Do not seed every catalog Agent here so “the report matches the desk,” and do not pin zeros on Overview’s top five.

14. **Cancelled means the Booking has a Cancellation ref.** Leftover `bookedLeadPrefix` stamps `is_cancelled` from `cancelled != null`. This file never opens `cancelled-leads`. Do not join the Cancellation collection so “rate matches cancellation Analytics.”

15. **Leftover Agent Sales is not this story.** Later `getAgentSalesReport` hard-codes live models, requires `from`/`to`, optional `agents[]` exact `/i`, skips leftover prefix, has no `$limit 50`, sorts Binder not Deposit, and sets `leads` = `booked_deals`. Do not import it here so “every Agent unwind lives together,” and do not point Wave B `GET /api/v1/admin/reports/agent-sales` at this file.

16. **Already-recommended desk credits are not this story.** Current `agentBrowseMetrics.service.ts` matches the page’s folded names, then groups `{ agent_key, booking_id }` before the Agent. That is a later product change than [`admin-agent-browse-metrics.md`](admin-agent-browse-metrics.md) described. Do not copy that two-stage group here, and do not point Wave B `GET /api/v1/admin/analytics/agent-performance` at the desk Map.

17. **Tests never call these two exports.** There is no `agentPerformance.service.test.ts`. Leftover `analytics.service.test.ts` never **asks** `getAgentPerformance`. Already-recommended `overview.service.test.ts` leftover-merges `top_agents` — it never **asks** `getTopAgentsByDeposit`. Live 50-limit, raw-casing split, and deposit-per-row are unproven at this **interface**.

18. **Leave sibling modules alone.** `bookedLeadPrefix` stays in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Source Company scorecards, Agent Sales, desk credits, CSV flatten, and other named reports stay in their files. This file orchestrates leftover prefix → unwind → raw-name group → top 50 → optional slice 5.

19. **Do not treat leftover Receiver-Agent performance as this story.** Later `getReceiverAgentPerformance` groups Form / Call Leads by Lead `receiver_agent`. Historical returns the leftover unsupported card. Do not import it here, and do not teach that file allocation snapshots.

20. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ items }` by Agent.

## Testing

The **interface** is the test surface: `rankTheseAgentsByDepositOnMatchingBookingShares` (`getAgentPerformance`) and `nameTheTopFiveAgentsByDeposit` (`getTopAgentsByDeposit`). The `{ items }` list and the five-row array are part of that **interface**.

Today there is no `agentPerformance.service.test.ts`. Fill the gap the story names make obvious:

**Rank each Agent by Deposit on matching Booking shares**
- **Asks** leftover `bookedLeadPrefix(query)` on the handed booked model, then `$unwind` `agent_allocations` — does **not** query form / call / cancelled collections.
- Blank / null snapshot becomes `"unknown"`. `$match agent_name != ""` does not drop that bucket.
- `$group` `_id` is the raw snapshot string, not `$toLower`. `Alice Agent` and `alice agent` stay two rows.
- `bookings` is leftover `$sum: 1` after unwind. Two allocations for the same Agent on one Booking: prove today’s count of two and doubled Deposit. Do not “fix” it into distinct Booking ids.
- Binder is `$agent_allocations.binder_amount`. Deposit is `$deposit_amount` on each unwound row.
- `cancellation_rate` is cancelled ÷ bookings (0 when none). `active_bookings` is `$subtract` without `max`.
- Sort is deposit desc, bookings desc, `agent_name` asc. Pipeline `$limit`s 50.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Name the top five of that same ranking**
- **Asks** the same aggregate, then `slice(0, 5)` by default. Custom `limit` slices that same list.
- Returns a bare array, not `{ items }`.
- Does **not** run a second Mongo pipeline.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of `Alice Agent` + `alice agent` into one combined row, or leftover stale averages — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert leftover booked-prefix employee-snapshot order — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert CSV omitting `over_2000_bookings` — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert Overview `top_agents` combined rematch of two five-row lists — that is already-recommended `overview.service.ts`. The existing leftover test already covers that add.
- Do **not** assert leftover Agent Sales `leads` = `booked_deals` — that is a later sitting (`agentSalesReport.service.ts`).
- Do **not** assert already-recommended desk two-stage distinct Booking + `$first` deposit — that is `agentBrowseMetrics.service.ts`.
- Do **not** assert leftover Receiver-Agent unsupported historical card — that is a later sitting (`receiverAgentPerformance.service.ts`).
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`unwindWhoSharesEachBooking`, `treatABlankSnapshotAsUnknown`, `keepTheTopFiftyByDeposit`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover Agent Sales totals row, leftover desk page `$in`, leftover Summary rates, or RingCentral reconcile here.

## What I would not do

- An `AgentPerformanceService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$unwind`.
- Moving this into a CRUD folder, or into `admin/` / `agents/` “because those also unwind allocations.”
- Splitting `getAgentPerformance` and `getTopAgentsByDeposit` into two files or two aggregations.
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten / Agent Sales / desk credits into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/overview` or `GET /api/v1/admin/reports/agent-sales` at this file, or pointing the fifty-row route past the leftover dispatcher.
- Copying the desk’s two-stage distinct-Booking + `$first` deposit here so “the report matches the desk.”
- Folding snapshot names with `$toLower` so “the report matches the desk,” or teaching leftover merge to keep raw casing.
- Dropping the `$limit 50` so “combined can re-rank everyone.”
- Switching Binder to `BookedLead.total_binder_amount` so “Agent Performance matches Source Company.”
- Treating leftover Agent Sales, leftover Receiver-Agent performance, already-recommended desk credits, leftover booking-cancellation-ratio, leftover Lead Cost, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
