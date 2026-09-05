# Pin This Agent's Booking Credits On The Admin Dashboard Desk — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 6 of this service — `agentBrowseMetrics.service.ts`
- Remaining in this service: `adminSheetSync.service.ts`
- Target: `src/services/admin/agentBrowseMetrics.service.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (Related table names already-recommended `adminBrowse.service.ts` as the paginated desk; that Service’s primary code is already-recommended typeahead `adminSearch.service.ts`. It does **not** name this file). Already-recommended [`admin-browse.md`](admin-browse.md) already named this file as the Agent-metric sitting: the desk **asks** after the Agent page; this file unwinds allocations. Distinct from leftover who-shares-the-Binder writes: [`agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md) / already-recommended [`agents-agent-allocation.md`](agents-agent-allocation.md). Distinct from leftover receiver-on-the-Lead: [`agents-receiver-agent-crm-username.md`](agents-receiver-agent-crm-username.md). Distinct from later unvisited Analytics `agent-performance`: [`analytics.md`](../../../docs/knowledge/services/analytics.md) / `agentPerformance.service.ts` — same leftover `bookedLeadPrefix` + `$unwind`, every Agent, not this page’s names. Distinct from later unvisited `receiver-agent-performance` (Lead `receiver_agent`, not catalog snapshot). This checkout’s `CONTEXT.md` does not define Admin Dashboard / Agent / Binder / Agent Allocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an agent-metrics Service file in this rename.
- Callers: already-recommended `adminBrowse.service.ts` (`enrichAgentItems` on the Agent desk and Agent detail — **asks** `getAgentBrowseMetrics`, looks up with `normalizeAgentMetricKey`, spreads `emptyAgentBrowseMetrics` on a miss). Barrel `admin/index.ts` does **not** re-export this file. Wave B never imports this file. Already-recommended `adminExport.service.ts` walks the desk (so the numbers are on the row) and then omits them from `CSV_COLUMNS.agents`. Later Analytics `agentPerformance.service.ts` does **not** import this file — it copies the unwind locally. Tests: `admin.service.test.ts` (Agent list attach / zeros / `book_date` + `$unwind` / Agent detail same attach). No dedicated `agentBrowseMetrics.service.test.ts`.
- Seams callers need: tally-this-page (`getAgentBrowseMetrics`: Map keyed by folded name) vs zeros-when-missing (`emptyAgentBrowseMetrics`) vs fold-the-name (`normalizeAgentMetricKey`). There is no desk **seam**. There is no write **seam**. There is no begin / complete **seam**. There is no HTTP **seam**. There is no Analytics-report **seam**.
- Split later (only if the file outgrows one sitting): this ~140-line file is one sitting if you read it as pin this Agent’s Booking credits on the Admin Dashboard desk — names on this page, unwind allocations, Binder is this share, Deposit rides each matched row, cancelled means the Booking has a Cancellation ref, zeros when they share none. Do **not** copy the Agent desk walk here so “metrics own the page.” Do **not** merge later Analytics `agent-performance` here so “one unwind owns every Agent table.” If it later splits: `tallyThisAgentsBookingsForTheDesk.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts`

`getAgentBrowseMetrics` / `emptyAgentBrowseMetrics` / `normalizeAgentMetricKey` are executor mechanics. The owner question is: *I opened the Agents desk, or one Agent. For the names on this page, how many Bookings does this Agent share? How much Binder is theirs? How much Deposit sits on those Bookings? How many of those Bookings later cancelled? Date and source chips use the same Booking prefix Analytics already uses. An Agent who shares none gets zeros, not a missing row. This is not paging the desk. This is not the Analytics agent-performance table. This is not naming who shares the Binder. This is not the receiver-agent on a Lead.*

Already-recommended desk walk / spreadsheet flatten / typeahead / chip paint / catalog assembly, leftover scope pick, leftover `bookedLeadPrefix`, leftover Agent Allocation writes, and later Analytics reports already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “pin this Agent’s Booking credits on the Admin Dashboard desk” story, not “an admin CRUD metrics helper,” and not the desk walk:

1. **Tally this Agent’s Bookings for the desk** — `getAgentBrowseMetrics`. Already-recommended desk **asks** this with the names on the current page (or the one detail row) and that scope’s models. Fold the names, keep first-seen casing, skip blanks. Empty list → empty Map (no aggregate). Otherwise **ask** leftover `bookedLeadPrefix` on a thin Analytics-shaped query (`from` / `to` / leftover `source_company` / Source Granularity / leftover `source` / leftover `agent` / merchant / local; `lead_type` forced off; leftover `granularity: "month"`), `$unwind` `agent_allocations`, treat a null/empty snapshot as `"unknown"`, exact case-insensitive match the page names, `$group` by `$toLower` of that name. `booking_count` is `$sum: 1` after unwind. Binder is this allocation’s `binder_amount`. Deposit is the Booking’s `deposit_amount` on each matched allocation row. Cancelled is leftover `is_cancelled` (Cancellation ref present). Rate is cancelled ÷ bookings, else `0`. Money rounds to two decimals. Return a Map keyed by the folded name.

2. **Hand zeros when this Agent shares none** — `emptyAgentBrowseMetrics`. Desk **asks** this when the Map misses. Same five fields, all `0`, including `cancellation_rate`.

There is no third owner operation. `normalizeAgentMetricKey` is the fold **seam** the desk already uses to read the Map — not a second story. `toAnalyticsCompatibleQuery` / `uniqueAgentNames` / leftover exact-regex are beats of the tally. Do not export the pipeline stages as a public **seam**. Do not export leftover `bookedLeadPrefix` from here as if this file owned Analytics.

## Organization

Keep one file. This is the screenplay for “pin this Agent’s Booking credits on the Admin Dashboard desk.” The paginated Agent walk, CSV flatten, typeahead, filter chips, catalog assembly, scope pick, who-shares-the-Binder writes, leftover Booking prefix, and the Analytics agent-performance table already live in deeper **modules**. Do not pull those in. Do not invent an `AgentBrowseMetricsService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a desk **adapter** beside already-recommended `showTheAdminDashboardDesk`.

Do not split this by field. Binder, Deposit, and cancelled-rate are beats of one tally. Do not move later `agentPerformance.service.ts` here so the two files “feel like one unwind.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getAgentBrowseMetrics` | `tallyThisAgentsBookingsForTheDesk` | already-recommended desk **asks** credits for the names on this page |
| `emptyAgentBrowseMetrics` | `zerosWhenThisAgentSharesNone` | desk pins zeros instead of leaving the fields off |
| `normalizeAgentMetricKey` | `foldTheAgentNameForTheCreditsMap` | desk lookup must use the same fold the Map was keyed with |
| `AgentBrowseMetrics` | `AgentBookingCreditsOnTheDesk` | the five numbers the Agent row already paints |

Keep the old names as one-line aliases until already-recommended `adminBrowse.service.ts` and `admin.service.test.ts` migrate. Do not make callers learn `$unwind` / `agent_key` / leftover `bookedLeadPrefix` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the five numbers the Agent desk already spreads onto the row:

```ts
type AgentBookingCreditsOnTheDesk = {
  booking_count: number           // allocation rows after unwind + match
  total_binder_amount: number     // this Agent’s allocation shares, rounded 2
  total_deposit_amount: number    // Booking deposit on each matched allocation row, rounded 2
  cancellation_count: number      // those rows whose Booking has a Cancellation ref
  cancellation_rate: number       // cancelled ÷ bookings; 0 if none
}
```

That is the handoff from “we counted this page’s allocations” to “paint the Agent row.” The Map key is the folded name, not the catalog id.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// agentBrowseMetrics.service.ts
// The owner opened the Agents desk, or one Agent.
// For the names on this page, how many Bookings does this Agent share?
// How much Binder is theirs?
// How much Deposit sits on those Bookings?
// How many of those Bookings later cancelled?
// Date and source chips use the same Booking prefix Analytics already uses.
// An Agent who shares none gets zeros, not a missing row.
// This file does not page the desk.
// This file does not flatten a spreadsheet.
// This file does not name who shares the Binder.
// This file does not paint the Analytics agent-performance table.

// ── 1. Tally this Agent’s Bookings for the desk ───────────

export async function tallyThisAgentsBookingsForTheDesk(models, query, agentNames)

function keepTheFirstSeenCasingForEachFoldedName(agentNames) // skip blanks
function askTheSameBookingPrefixAnalyticsUses(query)         // leftover bookedLeadPrefix
function treatABlankSnapshotAsUnknown(allocation)            // null / "" → "unknown"
function matchOnlyTheNamesOnThisPage(uniqueNames)            // exact /i
function groupByTheFoldedName()                              // $toLower
function pinBinderAsThisShareAndDepositAsTheBookingAmount()
function rateCancelledAgainstThoseRows()

export function foldTheAgentNameForTheCreditsMap(value)      // trim + lowercase

// ── 2. Hand zeros when this Agent shares none ─────────────

export function zerosWhenThisAgentSharesNone()
```

Read the desk path out loud: *Take the Agent names on this page. Fold them and keep the first spelling we saw. If the page has no names, stop. Ask the same Booking prefix Analytics already uses — book date, not created-at, and only the source chips that prefix understands. Unwind who shares each Booking. A blank snapshot is “unknown.” Keep only the names on this page. Count each remaining allocation row. Binder is that row’s share. Deposit is the Booking’s Deposit on that row. Cancelled means the Booking already has a Cancellation ref. Fold the name again for the Map. If this Agent is not in the Map, pin zeros.*

That is the operation. `getAgentBrowseMetrics` is not a different story. `booking_count` is not proof we `$addToSet`’d Booking ids.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`booking_count` is allocation rows, not distinct Bookings.** After `$unwind`, `$sum: 1`. Two allocations for the same Agent on one Booking count two. project-organization still says “distinct-booking metrics.” Do not silently `$addToSet` `$ _id` in this rename so “the rule becomes true,” and do not change the Agent desk label so “count means allocations.”

2. **Deposit rides each matched allocation row.** `total_deposit_amount` sums `$deposit_amount` after unwind. Two Agents on one Booking each receive the full Deposit. The same Agent twice on one Booking doubles it. project-organization says “once per Booking.” Later Analytics `agent-performance` does the same sum. Do not silently `$first` per Booking here so “once means once,” and do not change the unvisited report in this pass so “the two tables match a new rule.”

3. **Binder is this Agent’s share, not the Booking total.** `$sum` of `agent_allocations.binder_amount`. Do not switch to `BookedLead.total_binder_amount` so “the Agent row matches the Booking desk,” and do not split Deposit the way Binder is split so “both money fields feel the same.”

4. **Cancelled means the Booking has a Cancellation ref.** Leftover `bookedLeadPrefix` stamps `is_cancelled` from `cancelled != null`. This file never opens `cancelled-leads`. Do not join the Cancellation collection so “rate matches cancellation Analytics,” and do not read a boolean `cancelled` field so “boolean means boolean.”

5. **A blank snapshot becomes `"unknown"`.** A catalog Agent actually named `unknown` inherits those rows. The desk never sends blank names (it skips them), so `"unknown"` only appears when a stored snapshot is empty **and** a page name folds to `unknown`. Do not drop the `"unknown"` bucket so “empty snapshots disappear,” and do not create a catalog Agent for them.

6. **This file folds; later Analytics does not.** Group `_id` is `$toLower: "$agent_name"`. Unvisited `agentPerformance.service.ts` groups by the raw snapshot. `Alice Agent` and `alice agent` merge on the desk and can split on the report. Do not silently lowercase the report in this rename, and do not group this file by raw casing so “the two tables match.”

7. **Only the names on this page enter the `$in`.** Later Analytics tallies every Agent and `$limit`s 50 by Deposit. Do not drop the page `$in` so “desk totals match the report,” and do not import this Map into `getAgentPerformance` so “one tally owns both.”

8. **First-seen casing is the regex; the Map key is folded.** `uniqueAgentNames` keeps the first trimmed spelling. Desk lookup **asks** `foldTheAgentNameForTheCreditsMap`. Do not key the Map by display name so “the row name looks nicer,” and do not send catalog ids into the `$in` so “rename-safe.”

9. **Only Analytics-shaped chips reach the prefix.** Forwarded: `from` / `to` / leftover `source_company` / Source Granularity / leftover `source` / leftover `agent` / merchant / local. Date is always `book_date`. Desk `q` / `active` / `role` / `date_field` / `leadless` / `receiver_agent` / money ranges do not enter. Leftover `granularity: "month"` is unused by this prefix. Do not honor `date_field` so “Agent metrics use the same date_field as Form,” and do not filter credits by `Agent.active` so “inactive Agents show zero.”

10. **Each concrete desk asks its own models.** Combined browse enriches live rows against live Bookings and historical rows against historical Bookings. This file never unions the two. Do not `$unionWith` here so “one Agent row owns both databases.”

11. **The spreadsheet walk attaches these numbers and then drops them.** Already-recommended `CSV_COLUMNS.agents` has no `booking_count` / Binder / Deposit / cancelled fields. Do not add those columns in this rename, and do not stop attaching so “export matches the flatten.”

12. **Leave sibling modules alone.** The Agent page stays in `adminBrowse.service.ts`. Spreadsheet flatten stays in `adminExport.service.ts`. Typeahead stays in `adminSearch.service.ts`. Filter chips stay in `adminFacets` / `filterCatalog`. Scope pick stays in `adminScope.service.ts`. Who shares the Binder stays in `agents/agentAllocation.service.ts`. Leftover `bookedLeadPrefix` stays in later `analyticsFilters.ts`. Later `agent-performance` stays unvisited. This file orchestrates fold-the-page-names → ask-the-prefix → unwind → match-this-page → group-by-fold → zeros-on-miss.

13. **Do not treat receiver-agent or catalog create as this story.** Lead `receiver_agent` is a different Agent credit. Catalog `POST /api/v1/admin/agents` does not import this file. Do not point Wave B `GET /api/v1/admin/analytics/agent-performance` at this Map, and do not teach this file `bookings` / `average_deposit_amount` so the envelopes match.

## Testing

The **interface** is the test surface: `tallyThisAgentsBookingsForTheDesk`, `zerosWhenThisAgentSharesNone`, `foldTheAgentNameForTheCreditsMap`. The five numbers and the folded Map key are part of that **interface**.

Today’s `admin.service.test.ts` already names list attach, zeros, `book_date` + `$unwind`, and detail attach. Fill the gaps the story names make obvious:

**Tally this Agent’s Bookings for the desk**
- Empty / blank name list → empty Map, no aggregate.
- Page names `Alice Agent` + `alice agent` → one `$in` (first-seen casing) and one Map key `alice agent`.
- Pipeline **asks** leftover `bookedLeadPrefix` (`book_date`, `$unwind`, `agent_allocations.binder_amount`, `is_cancelled`). Does **not** match `createdAt`.
- Desk `from` / `to` appear. Desk `q` / `active` / `date_field` / `receiver_agent` do not.
- Two allocations for the same folded name on one Booking: prove today’s `$sum: 1` booking_count and doubled Deposit. Do not “fix” it into distinct Booking ids.
- Blank snapshot → `"unknown"`. A page name that folds to `unknown` can receive those rows. Prove today’s bucket. Do not drop it.
- Missing Agent on the page still gets zeros from the desk (already locked). The Map itself omits that key.

**Hand zeros when this Agent shares none**
- All five fields are `0`, including `cancellation_rate`.
- The object is a copy (mutating one zeros bag must not change the next).

**Fold the Agent name for the credits Map**
- `" Alice Agent "` → `"alice agent"`. Non-string → `""`.

Do **not** add a test per helper (`keepTheFirstSeenCasingForEachFoldedName`, `treatABlankSnapshotAsUnknown`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test desk pagination, combined first-page merge, CSV column lists, typeahead groups, facet cache TTL, Agent Allocation even-cent split, or later Analytics `agent-performance` sort / `$limit 50` here.

## What I would not do

- An `AgentBrowseMetricsService` class with `get` / `list` / `aggregate`.
- Thirty two-line functions that only wrap `$sum`.
- Moving this into a CRUD folder, or into `analytics/` / `agents/` “because those also unwind allocations.”
- Breaking the allocation-row count by “fixing” it to distinct Booking ids in this rename.
- Teaching later `agent-performance` to fold names, or teaching this file to keep raw casing, so the two tables match.
- Pointing Wave B `GET /api/v1/admin/analytics/agent-performance` at this Map, or pointing the Agent desk at `getAgentPerformance`.
- Pulling leftover `bookedLeadPrefix`, the Agent page walk, or CSV columns into this file.
- Adding `booking_count` to `CSV_COLUMNS.agents` so “the spreadsheet shows the credits.”
- Writing a whole-folder recommendation for `admin`.
