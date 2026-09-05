# Assemble The Admin Dashboard Filter Catalog — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 5 of this service — `filterCatalog.ts`
- Remaining in this service: `agentBrowseMetrics.service.ts`, `adminSheetSync.service.ts`
- Target: `src/services/admin/filterCatalog.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (Related table: already-recommended `adminFacets.service.ts` plus **this** file are “Filter Catalog (`catalog`) plus compatibility arrays.” That Service’s primary code is already-recommended typeahead `adminSearch.service.ts`). Already-recommended [`admin-facets.md`](admin-facets.md) is the paint that **asks** this file: remember five minutes, forget when Registry says `"facets"`, project the old string arrays. Already-recommended [`admin-browse.md`](admin-browse.md) **asks** `findCatalogGranularity` when a Source Granularity chip is selected. Already-recommended [`admin-export.md`](admin-export.md) / [`admin-search.md`](admin-search.md) do **not** import this file. Distinct from leftover Catalog Service: [`catalog.md`](../../../docs/knowledge/services/catalog.md) / already-recommended [`catalog-catalog.md`](catalog-catalog.md) — `listCatalogItems` is what **this** file loads for Agents / Merchants, not facets. Distinct from leftover Operations Registry lists: [`operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) / already-recommended [`operations-registry-catalog-registry.md`](operations-registry-catalog-registry.md) / [`operations-registry-source-registry.md`](operations-registry-source-registry.md) — `listSourceCompanies` / `listSourceGranularities` with `includeInactive: true`. Distinct from later unvisited Analytics: [`analytics.md`](../../../docs/knowledge/services/analytics.md) `leadMatchForQuery` / `nestObservedSourceRows` take `.catalog` after facets remember. `docs/index.md` still lists `docs/admin-filter-catalog-and-analytics-specification.md`; that file is **absent** in this checkout — do not invent a copy. This checkout’s `CONTEXT.md` does not define Admin Dashboard / Source Company / Source Granularity — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a filter-catalog Service file in this rename.
- Callers: already-recommended `adminFacets.service.ts` (the live-catalog loader, `loadHistoricalCatalog` with the live `.catalog`, `mergeCatalogs`, `EMPTY_FILTER_CATALOG` for leftover `catalogOrEmpty`). Already-recommended `adminBrowse.service.ts` (`findCatalogGranularity` inside leftover `leadSourceGranularityFilter`). Later Analytics: `analyticsFilters.ts` (`findCatalogGranularity` inside leftover `sourceGranularityLeadClause`; `leadMatchForQuery` loads the bag via facets), `sourceHierarchy.ts` (types + leftover `sourceLabelIndexFromCatalog` / `seedCatalogLeaves` / `nestObservedSourceRows` — those **ask** facets, not this file’s loaders). Types only: `sourceHierarchy.test.ts`, `analytics.service.test.ts`. Barrel `admin/index.ts` does **not** re-export this file. No dedicated `filterCatalog.test.ts` — live / historical / combined / company-slug drop are locked through `adminFacets.service.test.ts`. Wave B never imports this file.
- Seams callers need: assemble-the-live-catalog (today’s live-catalog loader export), assemble-the-historical-catalog (`loadHistoricalCatalog`: live bag in, distincts + overlay out), merge-both-desks (`mergeCatalogs`: Registry wins, extras stay), find-the-row-for-this-chip (`findCatalogGranularity`: key or owner label or CRM label). There is no paint **seam**. There is no remember / forget **seam**. There is no desk **seam**. There is no write **seam**. There is no begin / complete **seam**. There is no HTTP **seam**.
- Split later (only if the file outgrows one sitting): this ~670-line file is one sitting if you read it as assemble the Admin Dashboard Filter Catalog — live Registry including inactive, historical distincts with live identity overlaid, both desks merged with Registry winning, find the row for a submitted chip. Do **not** copy the five-minute remember / `"facets"` forget here so “the catalog owns cache.” Do **not** split live vs historical into `loadLiveCatalog.ts` so “each database owns rows.” If it later splits: `assembleTheLiveFilterCatalog.ts` / `assembleTheHistoricalFilterCatalog.ts` / `findTheGranularityRowForThisChip.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

The live-catalog loader / `loadHistoricalCatalog` / `mergeCatalogs` / `findCatalogGranularity` are executor mechanics. The owner question is: *I opened the Admin Dashboard. Before we paint the chips, build the rows. Live: first-class Registry Source Companies, Source Granularities, Agents, and Merchants — including inactive. Historical: what actually appeared on old Form, Call, and Booking rows, with live identity overlaid when we recognize the key or label. A company-slug-only chip is dropped when a keyed child already exists for that company. Both desks: one list. Registry labels win. Historical-only extras stay. When I pick a chip (key, owner label, or CRM label), find that row so the desk and Analytics can match. This is not painting the dropdowns. This is not remembering five minutes. This is not paging the desk. This is not jumping by typed text.*

Already-recommended chip paint / desk walk / spreadsheet flatten / typeahead, leftover scope pick, Wave A siblings `agentBrowseMetrics` / `adminSheetSync`, leftover Catalog / Registry lists, and later Analytics matching already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “assemble the Admin Dashboard Filter Catalog” story, not “an admin CRUD catalog service,” and not the chip paint:

1. **Assemble the live Filter Catalog from the Registry** — today’s live-catalog loader export. **Ask** leftover `listSourceCompanies` / `listSourceGranularities` / `listCatalogItems("agents"|"merchants")` with `includeInactive: true`. Join each granularity to its parent company. Stamp `origin: "registry"`. Sort companies and granularities by `owner_label`, Agents and Merchants by `name`. Nested `granularities[]` on a company document are ignored. Load failure is `[]`, not a throw.
2. **Assemble the historical Filter Catalog from what old rows said** — `loadHistoricalCatalog`. Distinct `source_granularity_key` / `source_granularity_label_snapshot` / `source_company` on historical Form and Call Leads; Booking `source`, `employee_source_snapshot` key + snapshot, `$unwind` Agent names, `merchant`. Overlay live identity when the key, owner label, company slug, Agent name, or Merchant name is recognized — keep `origin: "historical_distinct"`. Drop a company-slug-only option when a keyed child for that company already exists. Booked-only extras have no `channel`. Distinct / list failure is `[]`.
3. **Merge both desks, Registry winning** — `mergeCatalogs`. Combined paint **asks** this after the two assemblies. Shared key / slug / name keeps the Registry row (and its `owner_label`). Historical-only extras stay.
4. **Find the granularity row for this chip** — `findCatalogGranularity`. Trim + lowercase match on `granularity_key` **or** `owner_label` **or** `crm_label`. First hit. No channel filter here — the desk and Analytics apply channel after they have the row.

There is no fifth owner operation. `toRegistryCompany` / `addObservedGranularities` / leftover overlay-identity / `finalizeHistoricalGranularities` / `preferRicherGranularity` are beats of the assemble, not extra stories. Do not export the index maps as a public **seam**. Do not export leftover Catalog / Registry list DTOs from here as if this file owned those writes.

## Organization

Keep one file. This is the screenplay for “assemble the Admin Dashboard Filter Catalog.” The five-minute remember / forget, the compatibility string arrays, the paginated desk, typeahead, spreadsheet columns, scope pick, Agent metric aggregate, and Sheet Sync health already live in deeper **modules**. Do not pull those in. Do not invent a `FilterCatalogService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a paint **adapter** beside already-recommended `getAdminFacets`.

Do not split this by database. Live Registry load, historical distincts, overlay, merge, and chip lookup are beats of one assemble. Do not move already-recommended `adminFacets.service.ts` here so the two files “feel like one facets service.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `loadProductionCatalog` | `assembleTheLiveFilterCatalog` | already-recommended paint **asks** live Registry rows | <!-- pragma: allowlist secret -->
| `loadHistoricalCatalog` | `assembleTheHistoricalFilterCatalog` | paint **asks** distincts + overlay; live bag is the identity handoff |
| `mergeCatalogs` | `mergeBothDesksPreferringRegistry` | combined paint **asks** one list |
| `findCatalogGranularity` | `findTheGranularityRowForThisChip` | desk + Analytics match a submitted chip |
| `FilterCatalog` | `AdminDashboardFilterCatalog` | the row bag (`origin` registry \| historical_distinct) |
| `FilterCatalogCompany` / `FilterCatalogGranularity` / `FilterCatalogAgent` / `FilterCatalogMerchant` | leftover row shapes | chip + match callers share these |
| `EMPTY_FILTER_CATALOG` | leftover empty bag | paint `catalogOrEmpty`; default “no live identity” |
| `emptyFilterCatalog` | leftover empty factory | historical starts a **mutable** bag here |
| `FilterCatalogOrigin` | leftover origin tag | registry vs historical_distinct |

Keep the old names as one-line aliases until already-recommended `adminFacets.service.ts`, `adminBrowse.service.ts`, later Analytics `analyticsFilters.ts` / `sourceHierarchy.ts`, and `adminFacets.service.test.ts` migrate. Paint’s live-catalog loader export is `loadProductionCatalog`. <!-- pragma: allowlist secret --> Do not make callers learn `addObservedGranularities` / leftover overlay-identity / `preferRicherGranularity` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the row bag paint already returns as `.catalog`:

```ts
type AdminDashboardFilterCatalog = {
  source_companies: FilterCatalogCompany[]     // slug + owner_label + origin
  source_granularities: FilterCatalogGranularity[] // key, channel?, owner_label, crm_label?, company, origin
  agents: FilterCatalogAgent[]                 // name + origin
  merchants: FilterCatalogMerchant[]           // name + origin
}
```

That is the handoff from “we listed Registry or distincts” to “paint the chips / find the row.” Combined is the same bag after merge; it is not a third loader.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// filterCatalog.ts
// The owner opened the Admin Dashboard.
// Before we paint the chips, assemble the rows.
// Live: first-class Registry, including inactive.
// Historical: what old Form / Call / Booking rows actually said,
//   with live identity when we recognize the key or label.
// A company-slug-only chip is dropped when a keyed child exists.
// Both desks: one list. Registry labels win. Historical-only extras stay.
// Given a submitted chip, find the row.
// This file does not paint the dropdowns.
// This file does not remember five minutes.
// This file does not page the desk.

// ── 1. Assemble the live Filter Catalog from the Registry ─

export async function assembleTheLiveFilterCatalog()

async function listTheRegistryCompaniesIncludingInactive()     // leftover listSourceCompanies
async function listTheRegistryGranularitiesIncludingInactive() // leftover listSourceGranularities
async function listTheRegistryAgentsIncludingInactive()        // leftover listCatalogItems("agents")
async function listTheRegistryMerchantsIncludingInactive()     // leftover listCatalogItems("merchants")
function joinEachGranularityToItsParentCompany(granularity, companies)
function ignoreNestedGranularitiesOnTheCompanyDocument()
function stampOriginRegistry(row)

// ── 2. Assemble the historical Filter Catalog from old rows

export async function assembleTheHistoricalFilterCatalog(liveCatalog)

async function collectFormDistincts()   // key, snapshot, source_company
async function collectCallDistincts()
async function collectBookedDistincts() // source, employee snapshot key/label, merchant
async function collectBookedAgentNames() // $unwind agent_allocations
function addObservedGranularitiesForAChannel(keys, snapshots, companies, channel, live)
  // key first; snapshot stamps label or becomes a fake key; company-slug-only skipped when a keyed child exists
function addBookedOnlyGranularities(keys, snapshots, sources, live) // no channel
function overlayLiveIdentityAndKeepHistoricalOrigin(observed, live)
function dropCompanySlugOptionsWhenAKeyedChildExists(rows) // leftover finalizeHistoricalGranularities
function preferTheRicherLabelWhenTwoHistoricalRowsShareAKey(left, right)

// ── 3. Merge both desks, Registry winning ─────────────────

export function mergeBothDesksPreferringRegistry(live, historical)
  // companies by slug/label; granularities by key; agents/merchants by name

// ── 4. Find the granularity row for this chip ─────────────

export function findTheGranularityRowForThisChip(catalog, submitted)
  // key or owner_label or crm_label; first hit; no channel here

export const EMPTY_FILTER_CATALOG // leftover shared empty; do not mutate
export function emptyFilterCatalog() // leftover mutable start bag for historical
```

Read the assemble path out loud: *Live lists first-class Registry companies, granularities, Agents, and Merchants, including inactive, joins each granularity to its parent, and ignores leftover nested `granularities[]` on the company document. Historical reads what old Form, Call, and Booking rows actually stored. A recognized key or owner label gets the live Registry id and labels, but the row stays `historical_distinct`. A company-slug-only option is dropped when that company already has a keyed child. Booked-only extras have no channel. Combined merges the two bags — Registry `owner_label` wins, historical-only extras stay. When the owner picks a chip, find the first row whose key, owner label, or CRM label matches. Failures come back empty, not thrown.*

That is the operation. The live-catalog loader is not a different story. Live / historical / combined are not three owner catalogs.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file does not paint the chips.** Already-recommended `getAdminFacets` remembers, forgets, and projects `sources` / slugs / keys. Do not copy the five-minute `Map` or `"facets"` listener here so “the catalog owns facets,” and do not delete leftover `adminFacets.service.ts` in this pass so “one file is cleaner.”

2. **The live-catalog loader names the database, not the story.** The owner question is the live Registry desk, including inactive. Keep the old export as an alias. Do not filter `active: true` so “dropdowns match the employee booking picker.” Knowledge [`catalog.md`](../../../docs/knowledge/services/catalog.md) Downstream still says facets lists Agents / Merchants “active only” and names `adminFacets.service.ts` as the `listCatalogItems` caller. Both lines are lies: the import is this file, and it is `includeInactive: true`. CONTRADICTIONS already names the import-site drift. Do not “fix” those knowledge lines in this rename.

3. **Two empty bags, one reason.** `EMPTY_FILTER_CATALOG` is a shared const (paint `catalogOrEmpty`, default “no live identity”). `emptyFilterCatalog()` is a **new** object because historical mutates the start bag. Do not start historical on the shared const so “one empty is enough.” Do not invent a third empty helper.

4. **Company-slug drop happens twice.** `hasKeyedGranularityForCompany` skips adding a slug option while observing a channel. `finalizeHistoricalGranularities` drops slug-key rows after overlay if a keyed child for that company exists. Tests lock `top10_leads` absent when `top10_leads_form` is present. Do not keep both silently “for safety” without naming them, and do not drop the finalize pass so “the observe skip is enough” — overlay can introduce a keyed child the observe pass had not seen.

5. **A label snapshot can become a fake key.** When no live row matches the snapshot and no same-channel key row exists, historical pushes `granularity_key: snapshot`. Booked snapshots do the same. Do not invent a separate `label_only` origin so “keys stay keys,” and do not skip snapshots so “we only trust `source_granularity_key`.”

6. **Overlay copies live identity and keeps `historical_distinct`.** Tested: `top10_leads_form` gets live `id` / `owner_label` and still `origin: "historical_distinct"`. Combined merge then prefers Registry on that shared key. Do not flip the origin to `"registry"` on overlay so “id means Registry,” and do not skip overlay so “historical stays raw distincts.”

7. **Booked-only extras have no `channel`.** Form / Call observed rows stamp `"form"` / `"call"`. Booked-only (`source`, employee snapshot, booked-only key) leave `channel` undefined. Desk / Analytics company-slug fallback requires `row.channel === expectedChannel`. A booked-only row will not add that slug clause. Do not stamp `"form"` on booked extras so “every chip has a channel.”

8. **`findCatalogGranularity` is first-hit, no channel.** Match is key **or** owner label **or** CRM label. The desk then applies `expectedChannel` when deciding a company-slug fallback. Do not add channel here so “find is complete,” and do not drop `crm_label` so “one field is enough.”

9. **Nested `granularities[]` on a company document are ignored.** The live stub still returns `{ granularities: [{ granularity_key: "should_not_be_used" }] }`. Tests lock that key off the catalog. First-class `listSourceGranularities` is the book. Do not read the embedded array so “legacy seed wins.”

10. **Safe empty on load / distinct failure.** `safeList` / `distinctStrings` catch and return `[]`. This file does not retry. Already-recommended paint does not retry. Do not add a thrown “catalog unavailable” so “chips fail closed.”

11. **`docs/index.md` points at a missing spec.** The catalog row `admin-filter-catalog-and-analytics-specification.md` is not on disk. Do not invent that file in this rename. CONTRADICTIONS names the missing link.

12. **Leave sibling modules alone.** Chip paint / remember / forget stays in `adminFacets.service.ts`. The desk stays in `adminBrowse.service.ts`. Spreadsheet flatten stays in `adminExport.service.ts`. Typeahead stays in `adminSearch.service.ts`. Scope pick stays in `adminScope.service.ts`. Agent `$unwind` for browse metrics stays in `agentBrowseMetrics.service.ts`. Sheet Sync health stays in `adminSheetSync.service.ts`. Leftover Catalog / Registry writes stay where they are. This file orchestrates list-or-distinct → join-or-overlay → drop-slug-when-keyed → merge-when-both → find-the-row.

## Testing

The **interface** is the test surface: `assembleTheLiveFilterCatalog`, `assembleTheHistoricalFilterCatalog`, `mergeBothDesksPreferringRegistry`, `findTheGranularityRowForThisChip`. The row bag (`origin`, inactive flags, company-slug drop, overlay id / label) is part of that **interface**.

Today’s `adminFacets.service.test.ts` already locks live first-class rows (including retired `tbm_prime_leads_form`), historical overlay / empty-distinct fallback / company-slug drop, and combined prefer-registry. Those proofs go through the paint. Keep them. Fill the gaps the story names make obvious **on this interface** (a later `filterCatalog` test file is fine; do not re-test five-minute remember here):

**Assemble the live Filter Catalog**
- Inactive granularities and inactive Agents are on the bag (`tbm_prime_leads_form`, `Pat`).
- Nested `granularities[]` on a company document do not become rows.
- A Registry list throw yields empty arrays, not a throw.

**Assemble the historical Filter Catalog**
- A recognized key is stamped with the live Registry id / `owner_label` and stays `origin: "historical_distinct"`.
- A company-slug-only option is dropped when a keyed child for that company exists.
- Empty key distincts + a company slug still produce a form-channel slug row (`tbm_leads`).
- Booked-only extras have no `channel`.
- Overlay does not flip `origin` to `"registry"`.

**Merge both desks**
- Shared key keeps Registry `owner_label` / `origin: "registry"`.
- A historical-only extra stays (`legacy_sheet`).

**Find the granularity row for this chip**
- Submitted key, owner label, or CRM label hits the same row.
- Unknown chip → `undefined`.
- No channel argument (desk / Analytics apply channel after).

Do **not** add a test per helper (`joinEachGranularityToItsParentCompany`, `preferTheRicherLabelWhenTwoHistoricalRowsShareAKey`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test five-minute remember, `"facets"` eviction, or `sources` === CRM labels here — that sitting is already-recommended `paintTheAdminDashboardFilterChips`. Do **not** re-test the paginated desk, Duplicate Lead hide, typeahead groups, CSV flatten, Agent `$unwind` deposit-once math, or Analytics `leadMatch` clauses here.

`emptyFilterCatalog` / `EMPTY_FILTER_CATALOG` stay exported because the empty bag is a second real **adapter** (mutable start vs shared default), not a test leak. Do not teach Wave B those names.

## What I would not do

- A `FilterCatalogService` class with `load` / `merge` / `find`.
- Thirty two-line functions that only wrap leftover `listSourceCompanies`.
- Moving this into a CRUD folder, or into leftover `catalog/` “because those also list agents.”
- Copying already-recommended `adminFacets.service.ts` into this file so “the catalog owns the chips.”
- Splitting live / historical into `loadLiveCatalog.ts` so “each database owns rows.”
- Filtering `active: true` so “dropdowns match the employee booking picker.”
- Starting historical on the shared `EMPTY_FILTER_CATALOG` const so “one empty is enough.”
- Flipping overlay `origin` to `"registry"` because an id appeared.
- Stamping `"form"` on booked-only extras so “every chip has a channel.”
- Reading nested `granularities[]` on the company document so “legacy seed wins.”
- Adding a thrown “catalog unavailable,” or retry, so “chips fail closed.”
- Inventing a begin / complete **seam**, a paint **seam**, or an HTTP **seam**.
- Inventing the missing `docs/admin-filter-catalog-and-analytics-specification.md`.
- “Fixing” [`catalog.md`](../../../docs/knowledge/services/catalog.md) Downstream “active only” / import-site drift in this rename.
- Writing a whole-folder recommendation for `admin`.
