# Match These Dashboard Chips To Bookings, Cancellations, And Leads — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 14 of this service — `analyticsFilters.ts`
- Remaining in this service: `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/analyticsFilters.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Shared pipeline helpers: leftover `bookedLeadPrefix` is leading `$match` on Booking fields → `$lookup` form + call on `lead_ref` → set leftover `derived_source_company` / leftover `derived_source_granularity_key` + leftover `is_cancelled` → leftover company / granularity `$match`. Leftover `derived_source_company` order is **employee snapshot, then form slug, then call slug, then form label snapshot, then call label snapshot, then Booking `source`, then `"unknown"`**. Leftover `derived_source_granularity_key` is employee snapshot → form key → call key → Booking `source`. Leftover `cancelledLeadPrefix` is cancel-field match → lookup Booking → join leftover `lead_ref` / leftover `lead_model` → lookup form/call → same derived fields + leftover filters. Leftover `leadMatchForQuery` loads leftover Filter Catalog via leftover `getAdminFacets(query.database_scope)` only when leftover `source_granularity_key` is set. Leftover `source_granularity_key` on Bookings / Cancellations is leftover `sourceGranularityMatch` only — does **not** run leftover company regexes. Leftover `source_company` is compatibility only. Date fields: Leads `timestamp`, Bookings `book_date`, Cancellations `cancel_date`. Invariant: do not bypass leftover `bookedLeadPrefix` / leftover `cancelledLeadPrefix` / leftover `leadMatchForQuery` when adding Booking- or Lead-scoped reports. Role line on that Service is the leftover dispatcher, not this file). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — **does not** import this file; leftover named reports **ask** this). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (last-week leftover `getSalesBySourceCompany` **asks** leftover `bookedLeadPrefix`; leftover Overview HTTP stays unfiltered). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (**asks** leftover `leadMatchForQuery` + leftover `bookedLeadPrefix` + leftover `cancelledLeadPrefix`). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (**asks** leftover `bookedLeadPrefix` + leftover `trendDateExpression`). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (**asks** leftover `bookedLeadPrefix` + leftover `leadMatchForQuery`). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (**asks** leftover `bookedLeadPrefix`, then leftover `$unwind`). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (ratio **asks** leftover `bookedLeadPrefix`; reasons **asks** leftover `cancelledLeadPrefix`). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (local **asks** leftover `bookedLeadPrefix`; lanes / states **ask** leftover `leadMatchForQuery`). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (**asks** leftover `leadMatchForQuery` + leftover `trendDateExpression`). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md) (**asks** leftover `leadMatchForQuery`, then leftover-prefixes keys with leftover `"lead."`). Distinct from already-recommended Agent Sales: [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md) (**asks** leftover `numberValue` / leftover `roundMoney` only — **does not** ask leftover `bookedLeadPrefix`; leftover live Bookings + leftover `from`/`to` live next door). Distinct from already-recommended Lead Cost: [`analytics-lead-cost.md`](analytics-lead-cost.md) (**asks** leftover `leadMatchForQuery` then leftover billable fences). Distinct from already-recommended named-report CSV flatten: [`analytics-analytics-export.md`](analytics-analytics-export.md) (**does not** import this file — leftover dispatcher already matched). Distinct from leftover combined add: later `analyticsMerge.ts` (**asks** leftover `normalizeSourceDimension` / leftover `numberValue` / leftover `rate` — **does not** match chips). Distinct from leftover catalog nest / zero seed: later `sourceHierarchy.ts` (**asks** leftover normalize / leftover `numberValue` — **does not** match chips). Distinct from already-recommended Admin Dashboard Filter Catalog: [`admin-filter-catalog.md`](admin-filter-catalog.md) (this file **asks** leftover `findCatalogGranularity` after leftover `getAdminFacets`). Distinct from already-recommended chip paint: [`admin-facets.md`](admin-facets.md) (this file **asks** leftover `.catalog` — **does not** remember five minutes). Distinct from already-recommended Agent desk credits: [`admin-agent-browse-metrics.md`](admin-agent-browse-metrics.md) (**asks** leftover `bookedLeadPrefix` on leftover desk chips; leftover `lead_type` forced off). Distinct from leftover `SOURCE_COMPANY_CONFIGS` / leftover `SOURCE_LABEL_TO_COMPANY` / leftover `resolveSourceCompany` (`src/config/domain/sources`). Distinct from already-recommended leftover sheet-label resolve: [`operations-registry-label-mappings.md`](operations-registry-label-mappings.md) (leftover `resolveSheetOrLegacyLabel` is leftover Owner preview — leftover ORS-1 does **not** land in this rename). Distinct from leftover `analyticsQuerySchema` (Wave B Zod — leftover `lead_type` `form`/`call` → leftover `FormLead`/`CallLead`). Distinct from leftover scope pick (`adminScope.service.ts`). Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Source Company / CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an analytics-filters Service file in this rename.
- Callers: already-recommended Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking / Receiver-Agent ranking / texted-Lead booking rate / Lead Cost / Overview last-week by-source (leftover `bookedLeadPrefix` and/or leftover `leadMatchForQuery` / leftover `cancelledLeadPrefix`). Already-recommended Agent desk credits `agentBrowseMetrics.service.ts` (leftover `bookedLeadPrefix` on leftover `toAnalyticsCompatibleQuery`). Leftover merge / leftover nest import leftover math only. Barrel `analytics/index.ts` does **not** export this file. Wave B `src/routes/v1.routes.ts` never imports this file. Tests: `analytics.service.test.ts` (**asks** leftover `bookedLeadPrefix` for leftover leading `book_date` match, leftover `source_granularity_key` wins over leftover `source_company`, leftover employee-snapshot order; **asks** leftover `leadMatch` for leftover historical slug + leftover channel-scoped leftover `company_slug`; **asks** leftover `sourceGranularityMatch` so the leftover last stage equals leftover prefix). No `analyticsFilters.test.ts`.
- Seams callers need: match-these-chips-to-bookings (`bookedLeadPrefix`: leftover date / leftover source / leftover merchant / leftover local / leftover agent snapshot / leftover `lead_model`, then leftover join + leftover employee-snapshot source, then leftover dropdown) vs match-these-chips-to-cancellations (`cancelledLeadPrefix`: leftover `cancel_date` + leftover join through Booking, then the same leftover derived source) vs match-these-chips-to-leads (`leadMatchForQuery`: leftover Filter Catalog when leftover `source_granularity_key` is set) vs match-these-leads-without-reloading-the-catalog (`leadMatch`: existing tests **ask** this). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked leftover models; leftover `database_scope` here only opens leftover historical leftover `company_slug`. There is no nest **seam**. There is no combined-add **seam**. There is no CSV-column **seam**. There is no dispatcher **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~348-line file is one sitting if you read it as match these dashboard chips to Bookings, Cancellations, and Leads — leftover Booking prefix prefers leftover employee snapshot, leftover Cancellation prefix walks leftover Booking then leftover Lead, leftover Lead match loads leftover Filter Catalog only for leftover Source Granularity, leftover `source_granularity_key` wins over leftover `source_company`. Do **not** split `bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatch` into `bookings.ts` / `cancellations.ts` / `leads.ts` on this pass — they are one chip contract, not a CRUD folder. Do **not** pull leftover named reports / leftover nest / leftover merge here so “filters own the math.” If it later splits: `matchTheseDashboardChipsToBookings.ts` / `matchTheseDashboardChipsToCancellations.ts` / `matchTheseDashboardChipsToLeads.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `filter.ts`

`bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatchForQuery` / `leadMatch` / `dateMatch` are executor mechanics. The owner question is: *I picked a date range, a Source Company — or the Admin Dashboard Source Company dropdown — maybe a merchant, an Agent, local, and a Lead type. Which Bookings count? Which Cancellations count? Which Form Leads and Call Leads count? On a Booking, leftover employee snapshot wins over the joined Lead. On a Lead, leftover Source Granularity is leftover key, leftover snapshot, leftover submitted company, leftover catalog id, and leftover historical leftover `company_slug` on that channel — not leftover company aliases. Leftover `source_company` is the old spelling. This file does not count. This file does not nest Source Companies. This file does not add the two databases. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / named reports / Agent Sales / Lead Cost / named-report CSV, leftover merge / nest, already-recommended Filter Catalog / leftover chip paint / leftover Agent desk credits, leftover `SOURCE_LABEL_TO_COMPANY`, leftover scope pick, leftover Zod chips, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Three exports of one “match these dashboard chips to Bookings, Cancellations, and Leads” story, not “an analytics CRUD filter helper,” and not a named report:

1. **Match these chips to Bookings** — `bookedLeadPrefix`. Leading leftover `$match` on leftover `book_date` (`from` / `to`), leftover compatibility `source`, leftover `merchant`, leftover `local`, leftover `agent_allocations.agent_name_snapshot`, leftover `lead_model` when leftover `lead_type` is set. Then leftover `$lookup` form + call on leftover `lead_ref`. Then leftover `$set`: leftover `derived_source_company` (leftover employee snapshot → leftover form slug → leftover call slug → leftover form label snapshot → leftover call label snapshot → leftover Booking `source` → leftover `"unknown"`), leftover `derived_source_granularity_key` (leftover employee snapshot → leftover form key → leftover call key → leftover Booking `source`), leftover `is_cancelled` (`cancelled` ref present). Then leftover Source Granularity exact `/i` on leftover `derived_source_granularity_key` when leftover `source_granularity_key` is set; otherwise leftover alias-aware leftover `source_company` `$in` on leftover `derived_source_company`. Empty chips → leftover lookups still run so leftover named reports can group on leftover derived fields. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never **asks** leftover `concreteScopes` / leftover `getAdminModels` / leftover `mergeAnalyticsPayload` / leftover `nestObservedSourceRows`, and never talks to leftover Agent Sales’ leftover live fence.

2. **Match these chips to Cancellations** — `cancelledLeadPrefix`. Leading leftover `$match` on leftover `cancel_date`, leftover compatibility `source`, leftover `merchant`, leftover `agent` (the leftover Cancellation string — **not** leftover allocation snapshot), leftover `lead_model`. Then leftover `$lookup` Booking on leftover `booked_lead`. Then leftover join leftover `lead_ref` / leftover `lead_model` from the leftover Cancellation, else leftover Booking. Then leftover `$lookup` form + call. Then the same leftover derived-source `$set` (no leftover `is_cancelled` here). Then the same leftover dropdown. Leftover `local` is **not** applied on the leftover Cancellation row.

3. **Match these chips to Form or Call Leads** — `leadMatchForQuery` / `leadMatch`. Leftover `leadMatchForQuery` **asks** leftover `getAdminFacets(query.database_scope).catalog` only when leftover `source_granularity_key` is set, then leftover `leadMatch`. Leftover `lead_type` that is not this leftover collection → leftover `{ _id: { $exists: false } }`. Leftover `timestamp` range. Leftover `local` exact `/i`. Leftover `source_granularity_key` → leftover `$or` of leftover key, leftover `source_granularity_label_snapshot`, leftover submitted leftover `source_company`, leftover catalog ObjectId when leftover `findCatalogGranularity` returns leftover `id`, plus leftover historical / leftover combined leftover `company_slug` when leftover channel matches this leftover Lead type and leftover slug ≠ leftover submitted. Else leftover `source_company` → leftover `$in` leftover alias regexes. Empty leftover clauses → leftover `{}` (count every leftover Lead). Existing tests **ask** leftover `leadMatch` without leftover facets.

There is no fourth owner operation. Leftover `roundMoney` / leftover `rate` / leftover `numberValue` / leftover `normalizeDimension*` / leftover `trendDateExpression` / leftover `AnalyticsRow` are leftover math leftovers named reports already import — not a public chip **seam**. Do not export leftover `getAdminFacets` from this file as if this story owned leftover chip paint. Do not export leftover `SOURCE_LABEL_TO_COMPANY` from this file as if this story owned leftover Registry resolve.

## Organization

Keep one file. This is the screenplay for “match these dashboard chips to Bookings, Cancellations, and Leads.” Named-report counts, leftover nest, leftover combined add, leftover Filter Catalog assembly, leftover chip paint, leftover Agent desk credits, leftover Agent Sales, leftover CSV flatten, and leftover sheet-label resolve already live in deeper **modules**. Do not pull those in. Do not invent an `AnalyticsFiltersService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a catalog **adapter** beside leftover `getAdminFacets` / leftover `findCatalogGranularity`. Do not invent a source-resolve **adapter** beside leftover `resolveSourceCompany`. Do not invent a nest **adapter** beside leftover `nestObservedSourceRows`.

Do not split this by leftover collection. Booking prefix and Lead match are one leftover chip contract. Do not move this into `admin/` so “the desk folder owns every leftover `$match`.” Do not add leftover Overview / leftover Agent Sales / leftover Lead Cost cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `bookedLeadPrefix` | `matchTheseDashboardChipsToBookings` | leftover named reports, leftover Overview last week, leftover Agent desk credits **ask** the leftover Booking pipeline |
| `cancelledLeadPrefix` | `matchTheseDashboardChipsToCancellations` | leftover Summary + leftover cancellation reasons **ask** the leftover Cancellation pipeline |
| `leadMatchForQuery` | `matchTheseDashboardChipsToLeads` | leftover named reports **ask** leftover facets only when leftover Source Granularity is set |
| `leadMatch` | `matchTheseLeadChipsWithoutReloadingTheCatalog` | existing tests **ask** leftover historical leftover `company_slug` without leftover Mongo |

Keep the old names as one-line aliases until leftover named reports, leftover Overview, leftover `agentBrowseMetrics.service.ts`, and `analytics.service.test.ts` migrate. Do not make callers learn leftover `$lookup` / leftover `derived_source_company` / leftover `exactRegex` as the domain language. Do not export leftover `dateMatch` / leftover `bookedLeadSourceLookups` / leftover `sourceGranularityMatch` as public **seams** — leftover prefix already owns those leftover beats. Do not export leftover `roundMoney` / leftover `rate` as leftover chip **seams**. Do not hide leftover `leadMatch` so “only leftover `leadMatchForQuery` is testable.” Do not export these from `analytics/index.ts` so Wave B can skip leftover named reports.

**No class for the workflow.** The type that *does* earn a name is the leftover chip bag Wave B already parsed:

```ts
type TheseDashboardChips = AnalyticsQuery
// leftover from / to, leftover source_company (compatibility),
// leftover source_granularity_key (Admin Dashboard Source Company dropdown),
// leftover source / leftover agent / leftover merchant / leftover local / leftover lead_type,
// leftover database_scope only for leftover historical leftover company_slug
```

That is the handoff from “the owner picked leftover chips” to “leftover named reports may `$match`.” Leftover math leftovers (`AnalyticsRow`, leftover `numberValue`) stay leftover aliases for leftover siblings — they are not a second leftover chip bag.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// analyticsFilters.ts
// The owner picked leftover dashboard chips.
// Which Bookings count?
// Which Cancellations count?
// Which Form Leads and Call Leads count?
// On a Booking, leftover employee snapshot wins over the joined Lead.
// On a Cancellation, walk leftover Booking then leftover Lead.
// On a Lead, leftover Source Granularity is leftover key, leftover snapshot,
// leftover submitted company, leftover catalog id,
// and leftover historical leftover company_slug on that channel.
// Leftover source_company is the old spelling.
// Leftover source_granularity_key wins.
// This file does not count.
// This file does not nest Source Companies.
// This file does not add the two databases.
// This file does not flatten a spreadsheet.

// ── 1. Match these chips to Bookings ──────────────────────

export function matchTheseDashboardChipsToBookings(query)

function matchTheBookingRowItself(query)              // leftover book_date / leftover source / leftover merchant / leftover local / leftover agent snapshot / leftover lead_model
function joinTheFormAndCallLeadsOnThisBooking()       // leftover bookedLeadSourceLookups
function preferTheEmployeeSourceSnapshotThenTheJoinedLead()
function markWhetherThisBookingAlreadyHasACancellation()
function applyTheSourceCompanyDropdownOrTheOldSpelling(query) // leftover source_granularity_key wins

// ── 2. Match these chips to Cancellations ─────────────────

export function matchTheseDashboardChipsToCancellations(query)

function matchTheCancellationRowItself(query)         // leftover cancel_date; leftover agent is leftover Cancellation string
function joinTheBookingThenTheFormAndCallLeads()
function preferTheEmployeeSourceSnapshotThenTheJoinedLead()

// ── 3. Match these chips to Form or Call Leads ────────────

export async function matchTheseDashboardChipsToLeads(leadType, query)
export function matchTheseLeadChipsWithoutReloadingTheCatalog(leadType, query, catalog?)

function refuseTheOtherLeadCollection(leadType, query) // leftover { _id: { $exists: false } }
function matchTheLeadTimestampAndLocal(query)
function matchTheSourceGranularityChipAgainstTheCatalog(leadType, submitted, catalog, databaseScope)
function matchTheOldSourceCompanySpelling(query)      // leftover alias regexes; leftover SOURCE_LABEL_TO_COMPANY
```

Read the leftover Booking path out loud: *The owner picked leftover chips. Match leftover book_date, leftover merchant, leftover local, leftover Agent snapshot, leftover Lead type on the leftover Booking itself. Join leftover Form and Call. Prefer leftover employee snapshot over leftover joined Lead slugs, then leftover label snapshots, then leftover Booking source. Mark leftover is_cancelled when leftover cancelled is set. If leftover Source Granularity is set, leftover exact-match leftover derived key and ignore leftover source_company. Otherwise leftover alias-match leftover derived company. Cancellations walk leftover Booking first. Leads load leftover Filter Catalog only for leftover Source Granularity. Combined add, leftover nest, leftover named-report counts, leftover Agent Sales, leftover Overview cards, leftover Agent desk credits, and leftover CSV flatten live next door.*

That is the operation. `bookedLeadPrefix` is not a leftover `$lookup` dump. `leadMatchForQuery` is not a leftover facets wrapper. Leftover `roundMoney` is not a fourth leftover chip story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`bookedLeadPrefix` is an executor name.** The owner asked which Bookings match these chips. The name should say that. Do not teach named reports `Prefix` as if this file owned `$group`.

2. **Employee snapshot wins over the joined Lead.** Knowledge already names the order. Existing test walks the field references. Do not flip form slug ahead of employee snapshot so "the Lead is the source of truth," and do not drop Booking `source` so "unknown stays unknown."

3. **`source_granularity_key` wins over `source_company`.** Existing test: last `$match` is `derived_source_granularity_key` `^top10_leads_form$`; pipeline JSON does **not** mention `tbm_leads`. Do not `$and` both chips so "both dropdowns apply," and do not run company regexes on Bookings when Source Granularity is set.

4. **Booking `source` is compatibility; `derived_source_*` is attribution.** Leading `$match` filters Booking `source` before the join. The dropdown filters derived fields after the join. Do not move `source` onto the derived `$match` so "one source field owns both," and do not drop the leading `source` so "only snapshot counts."

5. **Cancellation `agent` is Cancellation `agent`, not allocation snapshot.** Booking `agent` matches `agent_allocations.agent_name_snapshot`. Do not copy Booking agent onto Cancellations so "one agent field owns both," and do not apply `local` on Cancellations in this rename — `directCancelledLeadMatch` omits it.

6. **Lead `lead_type` empties the other collection.** `{ _id: { $exists: false } }` keeps `countDocuments` at zero without skipping `Promise.all`. Do not skip `leadMatchForQuery("CallLead")` so "the caller owns lead_type," and do not throw so "the other type 400s."

7. **`leadMatchForQuery` loads Filter Catalog only when `source_granularity_key` is set.** `source_company` uses `SOURCE_LABEL_TO_COMPANY` aliases without facets. Do not load facets on every Lead count so "company can use catalog id," and do not skip catalog ObjectId so "key is enough."

8. **Historical `company_slug` is channel-scoped.** Existing test: combined Form match includes `^top10_leads$`; Call match does **not**. When catalog slug equals submitted, skip the extra `source_company` clause. Do not add `company_slug` on live so "every scope matches company," and do not add Call slug onto Form `$or` so "company owns both channels."

9. **Lead Source Granularity `$or` includes submitted `source_company`.** Historical `legacy_sheet` matches `source_company` `^legacy_sheet$`. Do not drop submitted company so "key is only," and do not run `sourceCompanyVariants` on Source Granularity so "aliases apply to keys."

10. **`dateMatch` and `dateMatchObject` duplicate `from` / `to`.** Leads use pipeline stages on `timestamp`. Bookings use a field object on `book_date`. Do not switch Bookings onto `timestamp` so "one date field owns every collection," and do not change Revenue Trend `report_date` (`trendDateExpression`) here.

11. **`dateMatch` and `bookedLeadSourceLookups` are exported and unused outside this file.** `sourceGranularityMatch` is test-asked so prefix last stage equals it. Keep `leadMatch` public. Do not export `exactRegex` so callers can build their own `$match`.

12. **Already-recommended texted-Lead booking rate asks `leadMatchForQuery`, then prefixes keys with `"lead."`.** The sibling clears `lead_type` first (`FormLead` unless chip is `CallLead`). Do not move `"lead."` prefix here so "filters own joined messages," and do not ask `bookedLeadPrefix` from SMS so "booked is official Lead `booked` next door."

13. **Already-recommended Agent desk credits asks `bookedLeadPrefix` on desk chips.** `lead_type` is forced off; `granularity` is `"month"`. Do not import `toAnalyticsCompatibleQuery` here so "filters own the desk," and do not skip `bookedLeadPrefix` from Agent desk so "Analytics chips stay on reports only."

14. **Already-recommended Agent Sales does not ask `bookedLeadPrefix`.** Live Bookings + `from` / `to` + optional `agents[]` live next door. Do not route Agent Sales through `bookedLeadPrefix` so "one prefix owns every Agent table."

15. **Math helpers are not chip seams.** `roundMoney` / `rate` / `numberValue` / `normalizeDimension*` / `trendDateExpression` stay one-line aliases until merge / nest / named reports migrate them later. Do not invent a "score these numbers" story in this file.

16. **`SOURCE_LABEL_TO_COMPANY` is ORS-1 apply work.** Already-recommended label mappings already named that `granotFormLeadMatcher` / `analyticsFilters` still walk `SOURCE_LABEL_TO_COMPANY` directly. Do not silently retarget `resolveSheetOrLegacyLabel` in this rename.

17. **Empty chips still join Form and Call on Bookings.** Named reports group on `derived_source_*`. Do not skip `$lookup` when chips are empty so "unmatched Bookings stay cheap."

18. **Tests prove Booking prefix and Lead `company_slug`, not `cancelledLeadPrefix`.** Cancellation `cancel_date` / join through Booking / missing `local` are unproven at this **interface**.

19. **Leave sibling modules alone.** Named reports stay in their files. Nest stays in later `sourceHierarchy.ts`. Merge stays in later `analyticsMerge.ts`. Filter Catalog stays in already-recommended `filterCatalog.ts`. This file orchestrates chips to `$match` / `$lookup` / derived source.

20. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here.

## Testing

The **interface** is the test surface: `matchTheseDashboardChipsToBookings` (`bookedLeadPrefix`), `matchTheseDashboardChipsToCancellations` (`cancelledLeadPrefix`), `matchTheseDashboardChipsToLeads` (`leadMatchForQuery`), and `matchTheseLeadChipsWithoutReloadingTheCatalog` (`leadMatch`).

Today `analytics.service.test.ts` asks `bookedLeadPrefix` three times and asks `leadMatch` once (historical slug + channel `company_slug`). Keep those, and fill the gaps the story names make obvious:

**Match these chips to Bookings**
- Leading `$match` uses `book_date` when `from` / `to` are set (existing merchant test).
- `source_granularity_key` wins over `source_company` — last `$match` is `derived_source_granularity_key` anchored `/i`; pipeline JSON does **not** mention the `source_company` spelling.
- `derived_source_company` field order is employee snapshot, then form slug, then call slug, then form label snapshot, then call label snapshot, then Booking `source`.
- `derived_source_granularity_key` field order is employee snapshot, then form key, then call key, then Booking `source`.
- Conflicting employee snapshot + joined form slug prefers the employee snapshot.
- Empty chips still `$lookup` form and call.
- Does **not** ask `getAdminFacets` / `findCatalogGranularity` / `nestObservedSourceRows` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Match these chips to Cancellations**
- Leading `$match` uses `cancel_date` when `from` / `to` are set.
- Agent chip matches Cancellation `agent`, not `agent_allocations.agent_name_snapshot`.
- `local` is **not** on the Cancellation row match.
- Joins Booking, then form and call, then the same derived-source order.
- Same `source_granularity_key` wins over `source_company` rule.

**Match these chips to Form or Call Leads**
- `leadMatchForQuery` asks `getAdminFacets(query.database_scope).catalog` only when `source_granularity_key` is set.
- `leadMatch` without catalog still exact-matches key / snapshot / submitted `source_company`.
- Combined Form match includes catalog `company_slug` `^top10_leads$`; Call match does **not**.
- Historical `legacy_sheet` matches `source_company` `^legacy_sheet$`.
- `lead_type` that is not this collection becomes `{ _id: { $exists: false } }`.
- Empty chips return `{}`.
- `source_company` without `source_granularity_key` uses alias regexes from `resolveSourceCompany` + `SOURCE_LABEL_TO_COMPANY`. Does **not** load facets.

**Not this file**
- Do **not** assert named-report `$group` math — those are already-recommended report files.
- Do **not** assert nest seed / company-only internals — that is a later sitting (`sourceHierarchy.ts`).
- Do **not** assert merge parent/leaf math — that is a later sitting (`analyticsMerge.ts`).
- Do **not** assert Agent Sales TOTAL — that is already-recommended `agentSalesReport.service.ts`.
- Do **not** assert Overview last-week cards — that is already-recommended `overview.service.ts`.
- Do **not** assert Agent desk credits Map — that is already-recommended `agentBrowseMetrics.service.ts`.
- Do **not** assert Filter Catalog remember / forget — that is already-recommended `adminFacets.service.ts`.
- Do **not** assert RingCentral reconcile.

Do **not** add a test per helper (`preferTheEmployeeSourceSnapshotThenTheJoinedLead`, `refuseTheOtherLeadCollection`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test dispatcher scope pick, nest seed math, merge parent/leaf math, Agent Sales TOTAL, Overview combined `null`, Lead Cost stored CPL, Admin Dashboard desk flatten, or RingCentral reconcile here.

## What I would not do

- An `AnalyticsFiltersService` class with `filter` / `match` / `prefix`.
- Thirty two-line functions that only wrap `exactRegex`.
- Moving this into a CRUD folder, or into `admin/` "because the desk also chips."
- Splitting `bookedLeadPrefix` / `cancelledLeadPrefix` / `leadMatch` into `bookings.ts` / `cancellations.ts` / `leads.ts` / `filter.ts`.
- Pulling named reports / nest / merge / Overview / Agent Sales / Lead Cost / CSV flatten into this file.
- Teaching this file `concreteScopes` / `getAdminModels` so it can pick live versus historical.
- Exporting `dateMatch` / `bookedLeadSourceLookups` / `sourceGranularityMatch` / `exactRegex` as public seams.
- Exporting `roundMoney` / `rate` as chip seams.
- Exporting these from `analytics/index.ts` so Wave B can skip named reports.
- Flipping employee snapshot behind joined Lead slugs.
- `$and`-ing `source_granularity_key` with `source_company` so "both dropdowns apply."
- Applying `local` on Cancellations in this rename.
- Silently retargeting `SOURCE_LABEL_TO_COMPANY` onto `resolveSheetOrLegacyLabel`.
- Routing Agent Sales through `bookedLeadPrefix`.
- Importing `"lead."` prefix from SMS so "filters own joined messages."
- Treating Agent Sales, Overview, Lead Cost, nest, merge, Filter Catalog, Agent desk credits, named-report counts, CSV flatten, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.

