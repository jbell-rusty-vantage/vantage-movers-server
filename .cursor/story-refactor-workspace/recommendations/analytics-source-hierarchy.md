# Put These Counted Source Rows Under The Filter Catalog Tree — operational story

- Status: recommended
- Service: `analytics` (Wave A, visited)
- Pass: 16 of this service — `sourceHierarchy.ts`
- Remaining in this service: none (`index.ts` already skipped)
- Target: `src/services/analytics/sourceHierarchy.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (Source company performance / funnel: `nestObservedSourceRows` seeds every Filter Catalog Source Granularity in scope (zeros remain), then overlays observed metrics. Parent totals = sum of children. Lead source performance: same hierarchy; does not group by `booked_leads.source`. Lead cost: live / scoped reports seed every catalog Source Granularity in scope (zeros remain); historical group id is company only when no granularity key exists. Overview last-week home source tables still list catalog Source Granularities from that payload, including zeros. Combined merge next door keeps child `granularities`; company-only incoming rows become extra leaves — that add is already-recommended `analyticsMerge.ts`, not this file. CSV flatten next door emits **leaves (including zeros) or a childless company, never both** — this file still returns the parent with children. Role line on that Service is the leftover dispatcher, not this file). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `concreteScopes` overwrites `database_scope` to live then historical **before** named reports **ask** this; this file **never** picks models). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (last-week by-source **asks** `nestObservedSourceRows`; all-time Overview does **not** nest). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (**does not** nest). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (**does not** nest). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (counts first, then **asks** this). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (**does not** nest). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (ratio **asks** this; reasons never nest). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (**does not** nest). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (source breakdown **asks** `sourceLabelIndexFromCatalog` only — **does not** nest; historical empty card lives next door). Distinct from already-recommended texted-Lead booking rate: [`analytics-sms-conversion.md`](analytics-sms-conversion.md) (**does not** nest). Distinct from already-recommended Agent Sales: [`analytics-agent-sales-report.md`](analytics-agent-sales-report.md) (**does not** import this file). Distinct from already-recommended Lead Cost: [`analytics-lead-cost.md`](analytics-lead-cost.md) (**asks** `nestObservedSourceRows` after folding form + call). Distinct from already-recommended named-report CSV flatten: [`analytics-analytics-export.md`](analytics-analytics-export.md) (flatten **after** nest; this file never **asks** `toCsv`). Distinct from already-recommended chip match: [`analytics-analytics-filters.md`](analytics-analytics-filters.md) (this file **asks** `normalizeDimension` / `normalizeSourceDimension` / `numberValue` / `AnalyticsRow` only — **does not** `$match`). Distinct from already-recommended combined add: [`analytics-analytics-merge.md`](analytics-analytics-merge.md) (dispatcher **asks** it **after** each database already nested). Distinct from already-recommended Admin Dashboard Filter Catalog: [`admin-filter-catalog.md`](admin-filter-catalog.md) (this file **asks** leftover `.catalog` after leftover `getAdminFacets`). Distinct from already-recommended chip paint: [`admin-facets.md`](admin-facets.md) (**does not** remember five minutes here). Distinct from leftover `SOURCE_COMPANY_CONFIGS` fallback labels (`src/config/domain/sources`). Distinct from leftover scope pick (`adminScope.service.ts`). Distinct from leftover `analyticsQuerySchema` (Wave B chips). Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout's `CONTEXT.md` does not define Analytics / Source Company / Filter Catalog — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a source-hierarchy Service file in this rename.
- Callers: already-recommended Source Company scorecards `sourcePerformance.service.ts` (`getSourceCompanyPerformance` / `getSourceCompanyFunnel` / `getLeadSourcePerformance` **ask** `nestObservedSourceRows` + `sourceCompanyFromRow` / `sourceGranularityFromRow`). Already-recommended Cancellation ratio `cancellationAnalytics.service.ts` (**asks** `nestObservedSourceRows`; reasons do **not**). Already-recommended Overview `overview.service.ts` (last-week by-source **asks** `nestObservedSourceRows`). Already-recommended Lead Cost `leadCost.service.ts` (**asks** `nestObservedSourceRows` + row readers). Already-recommended Receiver-Agent `receiverAgentPerformance.service.ts` (`getReceiverAgentSourceBreakdown` **asks** `sourceLabelIndexFromCatalog` only). Barrel `analytics/index.ts` does **not** export this file. Wave B `src/routes/v1.routes.ts` never imports this file. Already-recommended dispatcher / CSV flatten / combined add / Agent Sales / Summary / Revenue Trend / Agent ranking / place ranking / SMS / Agent desk credits do **not** import this file. Tests: `sourceHierarchy.test.ts` (**asks** `buildSourceLabelIndex` + `nestSourceCompanyRows` for registry labels + additive rollup, unknown child kept, alias fold + `derive`, catalog zero seed; **asks** `companyOnlySourceRows` for domain label + empty children). `sourcePerformance.service.test.ts` (**asks** historical performance / funnel through `nestObservedSourceRows` → company-only empty `granularities`). `leadCost.service.test.ts` (live nest returns `granularities`). `analytics.service.test.ts` leftover-flattens already-nested trees — **does not** import this file. No test **asks** `nestObservedSourceRows` or `sourceLabelIndexFromCatalog` or the unused live-facets loader at this **interface**.
- Seams callers need: nest-these-observed-source-leaves (`nestObservedSourceRows`: load leftover Filter Catalog, then company-only historical **or** nest + zeros) vs fold-these-leaves-into-source-company-cards (`nestSourceCompanyRows`: existing tests **ask** this without leftover facets) vs keep-these-historical-companies-childless (`companyOnlySourceRows`: existing tests **ask** this) vs name-these-source-granularities-from-the-filter-catalog (`sourceLabelIndexFromCatalog`: Receiver-Agent source breakdown **asks** labels without nesting). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked leftover models; leftover `database_scope` here only chooses company-only vs zeros. There is no chip-match **seam**. There is no combined-add **seam**. There is no CSV-column **seam**. There is no dispatcher **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~348-line file is one sitting if you read it as put these counted source rows under the Filter Catalog tree — live seeds every catalog child including quiet zeros, historical with no granularity keys stays company-only, parent totals are the sum of children, unknown keys stay, observed extras not in the catalog still appear. Do **not** split `nestObservedSourceRows` / `nestSourceCompanyRows` / `companyOnlySourceRows` into `nest.ts` / `fold.ts` / `company.ts` on this pass — they are one tree, not a CRUD folder. Do **not** split one file per leftover report name so "each chart owns a nest." Do **not** pull named reports / chips / merge / flatten here so "hierarchy owns the math." If it later splits: `putTheseCountedSourceRowsUnderTheFilterCatalogTree.ts` / `nameTheseSourceGranularitiesFromTheFilterCatalog.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `nest.ts`

`nestObservedSourceRows` / `nestSourceCompanyRows` / `companyOnlySourceRows` / `seedCatalogLeaves` / `buildSourceLabelIndex` are executor mechanics. The owner question is: *I already counted these Bookings, Leads, or stored-CPL rows by Source Company and Source Granularity. Put those leaves under the Filter Catalog tree. Every catalog child in this channel still appears, even if it is zero — unless this is the historical database. Historical with no granularity keys stays company-only: a label and empty children. Parent totals are the sum of children. Labels are catalog `owner_label`. Unknown keys stay as Unknown. Observed extras that are not in the catalog still appear. Source Company aliases fold. This file does not count. This file does not rematch dashboard chips. This file does not add the two databases. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / named reports / Agent Sales / Lead Cost / named-report CSV / chip match / combined add, leftover Filter Catalog / leftover chip paint, leftover `SOURCE_COMPANY_CONFIGS`, leftover scope pick, leftover Zod chips, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Four exports of one "put these counted source rows under the Filter Catalog tree" story, not "an analytics CRUD hierarchy helper," and not a named report:

1. **Put these counted source rows under the Filter Catalog tree** — `nestObservedSourceRows`. Named reports, Overview last-week by-source, and Lead Cost **ask** this after they already `$group`. Load leftover `getAdminFacets(query.database_scope).catalog`. Map leftover `query.lead_type` to leftover form / call channel. If leftover `database_scope === "historical"` **and** no leaf has a leftover `source_granularity_key` other than leftover `"unknown"`, **ask** leftover `companyOnlySourceRows` (empty children). Otherwise **ask** leftover `nestSourceCompanyRows` with leftover `seedZeros: query.database_scope !== "historical"`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never **asks** leftover `concreteScopes` / leftover `getAdminModels` / leftover `bookedLeadPrefix` / leftover `leadMatchForQuery` / leftover `mergeAnalyticsPayload` / leftover `toCsv`, and never prices Lead Cost.

2. **Fold these leaves into Source Company cards** — `nestSourceCompanyRows`. Existing tests **ask** this without leftover facets. When leftover `options.catalog` is set, leftover labels rebuild from that catalog (the leftover `labels` argument is ignored) and leftover `seedCatalogLeaves` runs first. Fold leftover `sourceCompanyFromRow` / leftover `sourceGranularityFromRow`. Additive fields add on a leftover key collision. Children sort by leftover `source_granularity_label`. Parent leftover additive fields recompute from children. Leftover `derive` runs on each child, then on the parent. Default sort is leftover deposit, then leftover Lead Cost, then leftover bookings, then leftover company label.

3. **Keep these historical companies childless** — `companyOnlySourceRows`. Existing tests **ask** this. One leftover Source Company row, leftover empty `granularities`, leftover domain / catalog label. No leftover zero seed. No leftover children.

4. **Name these Source Granularities from the Filter Catalog** — `sourceLabelIndexFromCatalog`. Receiver-Agent source breakdown **asks** leftover `owner_label` (and leftover channel / leftover company slug) without nesting. Leftover `buildSourceLabelIndex` is the leftover test constructor from leftover Registry items, not leftover Filter Catalog. The unused live-facets loader is unused.

There is no fifth owner operation. Leftover `sourceCompanyFromRow` / leftover `sourceGranularityFromRow` / leftover `resolveCompanyLabel` / leftover `humanizeSourceKey` / leftover `catalogChannelFromLeadType` are leftover beats, not public **seams**. Do not export leftover `seedCatalogLeaves` as a public **seam**. Do not export leftover `getAdminFacets` from this file as if this story owned leftover chip paint. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned combined.

## Organization

Keep one file. This is the screenplay for "put these counted source rows under the Filter Catalog tree." Named-report counts, chip match, combined add, CSV flatten, home Overview cards, Agent Sales, Lead Cost pricing, leftover Filter Catalog assembly, and leftover chip paint already live in deeper **modules**. Do not pull those in. Do not invent a `SourceHierarchyService` class. Do not invent a begin / complete **seam** — this is a read nest. Do not invent a catalog **adapter** beside leftover `getAdminFacets`. Do not invent a chip **adapter** beside leftover `bookedLeadPrefix`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a flatten **adapter** beside leftover `rowsForCsv`.

Do not split this by leftover report name. Source Company zeros and historical company-only are beats of one tree. Do not move this into `admin/` so "the desk folder owns every catalog walk." Do not add Overview / Agent Sales / Lead Cost cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `nestObservedSourceRows` | `putTheseCountedSourceRowsUnderTheFilterCatalogTree` | named reports / Overview last week / Lead Cost **ask** catalog zeros or company-only |
| `nestSourceCompanyRows` | `foldTheseLeavesIntoSourceCompanyCards` | existing tests **ask** the fold without leftover facets |
| `companyOnlySourceRows` | `keepTheseHistoricalCompaniesChildless` | existing tests **ask** the empty-children shape |
| `sourceLabelIndexFromCatalog` | `nameTheseSourceGranularitiesFromTheFilterCatalog` | Receiver-Agent source breakdown **asks** labels without nesting |

Keep the old names as one-line aliases until already-recommended Source Company scorecards / Cancellation ratio / Overview / Lead Cost / Receiver-Agent, and `sourceHierarchy.test.ts`, migrate. Do not make callers learn `seedCatalogLeaves` / `hasGranularityKeys` / `additiveFields` as the domain language. Do not export `buildSourceLabelIndex` as a public **seam** so runtime callers can skip leftover Filter Catalog. Do not export the unused live-facets loader as a public **seam**. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

**No class for the workflow.** The type that *does* earn a name is the leftover nested card named reports already paint:

```ts
type ThisSourceCompanysNestedScore = {
  source_company: string
  source_company_label: string // leftover catalog owner_label, else leftover SOURCE_COMPANY_CONFIGS / humanize
  granularities: ThisSourceGranularitysNestedScore[] // leftover empty on historical company-only
  // leftover additiveFields summed onto the parent from children
}

type ThisSourceGranularitysNestedScore = {
  source_granularity_key: string
  source_granularity_label: string // leftover catalog owner_label, else leftover "Unknown" / humanize
  channel?: string | null
}
```

That is the handoff from "this database already counted leaves" to "the owner sees Source Companies with catalog children." Combined stays two leftover nest calls next door, then leftover merge. A quiet catalog child is a leftover zero leaf, not omitted. A leftover parent that still has leftover children is not a leftover spreadsheet row — leftover flatten lives next door.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceHierarchy.ts
// The owner already counted these Bookings, Leads, or stored-CPL rows
// by Source Company and Source Granularity.
// Put those leaves under the Filter Catalog tree.
// Every catalog child in this channel still appears,
// even if it is zero — unless this is the historical database.
// Historical with no granularity keys stays company-only.
// Parent totals are the sum of children.
// Labels are catalog owner_label.
// Unknown keys stay.
// Observed extras that are not in the catalog still appear.
// This file does not count.
// This file does not rematch dashboard chips.
// This file does not add the two databases.
// This file does not flatten a spreadsheet.

// ── 1. Put these counted source rows under the Filter Catalog tree ──

export async function putTheseCountedSourceRowsUnderTheFilterCatalogTree(leaves, query, options)

function loadTheFilterCatalogForThisScope(query)       // leftover getAdminFacets
function chooseFormOrCallChildren(query.lead_type)     // leftover catalogChannelFromLeadType
function historicalHasNoGranularityKeys(leaves)        // any leftover key other than "unknown"
function seedQuietCatalogChildren(observed, catalog)   // leftover seedCatalogLeaves; skip when seedZeros is false

// ── 2. Fold these leaves into Source Company cards ───────

export function foldTheseLeavesIntoSourceCompanyCards(leaves, labels, options)

function readTheSourceCompanyFromTheLeaf(row)          // leftover sourceCompanyFromRow
function readTheSourceGranularityFromTheLeaf(row)      // leftover sourceGranularityFromRow
function addCollidingLeavesOnTheSameKey(existing, incoming)
function recomputeParentTotalsFromChildren(company)
function deriveEachChildThenTheParent(row)             // leftover options.derive
function sortCompaniesForTheOwner(left, right)         // leftover deposit, Lead Cost, bookings, label

// ── 3. Keep these historical companies childless ─────────

export function keepTheseHistoricalCompaniesChildless(rows, options)

function labelTheCompanyWithoutChildren(row)           // leftover catalog / leftover SOURCE_COMPANY_CONFIGS

// ── 4. Name these Source Granularities from the Filter Catalog ──

export function nameTheseSourceGranularitiesFromTheFilterCatalog(catalog)

function indexCompaniesBySlug(catalog)
function indexGranularitiesByKey(catalog)
```

Read the nest path out loud: *The owner already counted these rows. Load the Filter Catalog for this database. If this is historical and no leaf has a real Source Granularity key, keep each Source Company childless. Otherwise fold the leaves under Source Companies. On live, seed every catalog child in this channel — including quiet zeros. On historical with keys, nest the observed children only. Add colliding keys. Recompute parent totals from children. Keep unknown keys. Keep extras that are not in the catalog. Do not rematch chips. Do not add the two databases. Do not flatten a spreadsheet. Receiver-Agent source breakdown only asks for labels.*

That is the operation. `nestObservedSourceRows` is not a different story. `seedCatalogLeaves` is not a public **seam**. Combined leftover merge of two leftover nested cards is not a leftover `database_scope` chip this file reads to add live plus historical.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`nestObservedSourceRows` is an executor name.** The owner asked to put these counted source rows under the Filter Catalog tree. The name should say that. Do not teach named reports `nestObservedSourceRows` as if this file owned leftover `$group`.

2. **This file never counts.** Callers already `$group`. Do not **ask** leftover `bookedLeadPrefix` / leftover `leadMatchForQuery` here so "nest can recount," and do not import leftover `getSourceCompanyPerformance` so "the tree owns the scorecard."

3. **Historical company-only is "no real key on any leaf," not "scope is historical."** Leftover `hasGranularityKeys` is leftover `some(key && key !== "unknown")`. One leftover historical leaf with a leftover real key nests the **whole** leftover set with leftover `seedZeros: false`. Named reports already group historical **without** leftover granularity (`supportsSourceGranularity = query.database_scope !== "historical"`), so leftover company-only matches leftover `$group`. Do not silently company-only every leftover historical call so "keys never nest," and do not seed leftover historical zeros so "historical matches live."

4. **Live seeds zeros; historical with keys does not.** Leftover `seedZeros: query.database_scope !== "historical"`. Leftover combined as a leftover chip would also seed — leftover dispatcher overwrites leftover `database_scope` to leftover live then leftover historical **before** this file runs, so leftover combined is two leftover nest calls next door. Do not **ask** leftover `concreteScopes` here so "nest can pick databases," and do not skip leftover zeros on leftover live so "quiet children disappear."

5. **`options.catalog` ignores the leftover `labels` argument.** Leftover `nestSourceCompanyRows` rebuilds leftover `sourceLabelIndexFromCatalog(options.catalog)` when leftover catalog is set. Leftover `nestObservedSourceRows` always passes leftover catalog. Leftover tests that pass leftover `buildSourceLabelIndex` **and** leftover catalog prove leftover catalog labels, not leftover Registry labels. Do not keep two leftover indexes so "Registry wins," and do not drop leftover `labels` so "only leftover facets can fold."

6. **Parent totals recompute from children after leftover `derive` on children.** Leftover additive fields sum leftover `numberValue` on leftover children, then leftover `derive` runs on the leftover parent. Leftover rates that leftover `derive` writes on leftover children are **not** leftover additive fields unless the leftover caller listed them. Existing leftover alias-fold test lists leftover `bookings` / leftover `cancelled_bookings` and leftover-derives leftover `cancellation_rate` on leftover child and leftover parent. Do not add leftover `cancellation_rate` into leftover `additiveFields` so "rates average," and do not skip leftover parent leftover `derive` so "only children have rates."

7. **Unknown keys stay.** Existing leftover test: leftover `source_granularity_key: "unknown"` becomes leftover label leftover `"Unknown"` and leftover counts stay on the leftover parent. Do not drop leftover unknown so "only catalog children survive," and do not seed leftover `"unknown"` as a leftover catalog child.

8. **Observed extras not in the catalog still appear.** `seedCatalogLeaves` appends leftover observed keys after catalog candidates. Do not drop extras so "only Filter Catalog rows paint," and do not overwrite catalog `company_slug` with the observed company when keys match (catalog slug wins).

9. **Channel filters seeded children, not observed extras.** `query.lead_type` `FormLead` / `CallLead` / `form` / `call` keeps catalog `channel`. Overview last week has no `lead_type`, so both channels seed. Named reports may pass `lead_type`. Do not drop observed call leaves when channel is form so "the chip owns the fold," and do not ignore `lead_type` so "every catalog child always seeds."

10. **The unused live-facets loader is unused.** It loads live facets. Do not wire Receiver-Agent through it so "labels always live," and do not delete it in this rename without proving no caller.

11. **`buildSourceLabelIndex` is test construction from Registry items.** The runtime path asks Filter Catalog. Do not teach named reports `buildSourceLabelIndex` so "skip facets," and do not merge Registry `crm_label` into `sourceLabelIndexFromCatalog` so "CRM spelling paints the dashboard."

12. **Receiver-Agent source breakdown does not nest.** It asks `sourceLabelIndexFromCatalog` only. The historical empty card lives next door. Do not `nestObservedSourceRows` there so "every source table seeds zeros," and do not hide `sourceLabelIndexFromCatalog` so "only nest is testable."

13. **This file does not flatten.** CSV emit leaves or a childless company, never both. This file still returns the parent with children. Do not `rowsForCsv` here so "nest owns Excel," and do not drop parents so "the JSON matches CSV."

14. **This file does not add combined.** The dispatcher already nested each database. Merge already folds company-only extras as leaves. Do not import `mergeAnalyticsPayload` here so "the tree can add databases."

15. **Leave sibling modules alone.** Named reports stay in their files. Chip match stays in already-recommended `analyticsFilters.ts`. Combined add stays in already-recommended `analyticsMerge.ts`. CSV flatten stays in already-recommended `analyticsExport.service.ts`. Overview / Agent Sales / Lead Cost stay next door. This file nests already-counted leaves.

16. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here.

## Testing

The **interface** is the test surface: `putTheseCountedSourceRowsUnderTheFilterCatalogTree` (`nestObservedSourceRows`), `foldTheseLeavesIntoSourceCompanyCards` (`nestSourceCompanyRows`), `keepTheseHistoricalCompaniesChildless` (`companyOnlySourceRows`), and `nameTheseSourceGranularitiesFromTheFilterCatalog` (`sourceLabelIndexFromCatalog`).

Today `sourceHierarchy.test.ts` **asks** fold / company-only / zero seed. Keep those, and fill the gaps the story names make obvious:

**Put these counted source rows under the Filter Catalog tree**
- Live catalog seeds quiet zeros when `nestObservedSourceRows` runs (today proven only through `nestSourceCompanyRows` + `leadCost.service.test.ts` `granularities`).
- Historical with no real keys **asks** `companyOnlySourceRows` (today proven through `sourcePerformance.service.test.ts` empty `granularities`).
- Historical with one real key nests the whole set with `seedZeros: false`. Do **not** fix that in this rename.
- `query.lead_type` `FormLead` seeds form children only.
- Does **not** **ask** `bookedLeadPrefix` / `leadMatchForQuery` / `mergeAnalyticsPayload` / `getAdminModels`.
- Does **not** mutate Mongo or enqueue Sheet Sync.

**Fold these leaves into Source Company cards**
- Registry labels + additive rollup (existing).
- Unknown child kept (existing).
- `"TBM Prime Leads"` + `tbm_prime_leads` fold; `derive` recomputes `cancellation_rate` 0.4 (existing).
- Catalog zero seed (existing).

**Keep these historical companies childless**
- Domain label + empty `granularities` (existing).

**Name these Source Granularities from the Filter Catalog**
- Receiver-Agent-style `granularityByKey.get(key).label` is `owner_label`. Do **not** treat `getReceiverAgentSourceBreakdown` as this export.

**Not this file**
- Do **not** assert named-report `$group` math — those are already-recommended report files.
- Do **not** assert chip `$match` / employee-snapshot order — that is already-recommended `analyticsFilters.ts`.
- Do **not** assert combined company-only extras as leaves — that is already-recommended `analyticsMerge.ts`.
- Do **not** assert CSV leaves-or-childless — that is already-recommended `analyticsExport.service.ts`.
- Do **not** assert Overview last-week `null` / live-only Lead Cost — that is already-recommended `overview.service.ts`.
- Do **not** assert RingCentral reconcile.

Do **not** add a test per helper (`seedQuietCatalogChildren`, `readTheSourceCompanyFromTheLeaf`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test dispatcher scope pick, chip match, combined add, CSV flatten, Agent Sales TOTAL, Overview combined `null`, Lead Cost stored CPL, Admin Dashboard desk flatten, or RingCentral reconcile here.

## What I would not do

- A `SourceHierarchyService` class with `nest` / `seed` / `label`.
- Thirty two-line functions that only wrap `numberValue`.
- Moving this into a CRUD folder, or into `admin/` "because the Filter Catalog is a desk chip."
- Splitting `nestObservedSourceRows` / `nestSourceCompanyRows` / `companyOnlySourceRows` into `nest.ts` / `fold.ts` / `company.ts`.
- Pulling named reports / chips / merge / flatten / Overview / Agent Sales / Lead Cost into this file.
- Teaching this file `concreteScopes` / `getAdminModels` so it can pick live versus historical.
- Exporting `seedCatalogLeaves` / `hasGranularityKeys` / `additiveFields` as public seams.
- Exporting these from `analytics/index.ts` so Wave B can skip the dispatcher.
- Seeding historical zeros so "historical matches live."
- Dropping unknown keys or observed extras so "only Filter Catalog rows paint."
- Flattening parents away so "JSON matches CSV."
- Importing `mergeAnalyticsPayload` so "the tree can add databases."
- Nesting Receiver-Agent source breakdown so "every source table seeds zeros."
- Treating Agent Sales, Overview counts, Lead Cost pricing, chip match, named-report counts, combined add, CSV flatten, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
