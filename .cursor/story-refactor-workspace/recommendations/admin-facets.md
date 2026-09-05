# Paint The Admin Dashboard Filter Chips — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 4 of this service — `adminFacets.service.ts`
- Remaining in this service: `filterCatalog.ts`, `agentBrowseMetrics.service.ts`, `adminSheetSync.service.ts`
- Target: `src/services/admin/adminFacets.service.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (Related table: this file plus leftover `filterCatalog.ts` are “Filter Catalog (`catalog`) plus compatibility arrays.” That Service’s primary code is already-recommended typeahead `adminSearch.service.ts`). Already-recommended [`admin-browse.md`](admin-browse.md) is the paginated desk that **asks** this file when a Source Granularity chip is selected. Already-recommended [`admin-export.md`](admin-export.md) / [`admin-search.md`](admin-search.md) do **not** import this file. Distinct from leftover Catalog Service: [`catalog.md`](../../../docs/knowledge/services/catalog.md) / already-recommended [`catalog-catalog.md`](catalog-catalog.md) — `listCatalogItems` is what leftover `filterCatalog.ts` loads, not this file. Distinct from leftover Operations Registry lists: [`operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) / already-recommended [`operations-registry-catalog-registry.md`](operations-registry-catalog-registry.md) / [`operations-registry-source-registry.md`](operations-registry-source-registry.md). Distinct from later unvisited Analytics reports that **ask** `.catalog` here so they share the five-minute chip cache. This checkout’s `CONTEXT.md` does not define Admin Dashboard / Duplicate Lead / Form Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a facets Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAdminFacets` — `GET /api/v1/admin/facets`; `adminBrowseQuerySchema.pick({ database_scope })`, default live). Barrel: `admin/index.ts` (`getAdminFacets`, `AdminFacets` — does **not** re-export `catalogOrEmpty` or `resetAdminFacetsCacheForTests`). Already-recommended desk `adminBrowse.service.ts` (`leadSourceGranularityFilter` takes `.catalog`, then leftover `findCatalogGranularity`). Later Analytics: `analyticsFilters.ts` (`leadMatchForQuery`), `sourceHierarchy.ts` (leftover live source-label index always live; `nestObservedSourceRows` uses the query scope), `receiverAgentPerformance.service.ts`. Tests: `adminFacets.service.test.ts` (live catalog + compatibility arrays, historical overlay, empty-distinct fallback, combined prefer-registry, `"facets"` eviction). Cache reset also in `admin.service.test.ts` and Analytics tests (`analytics.service.test.ts`, `leadCost.service.test.ts`, `sourcePerformance.service.test.ts`). Already-recommended typeahead / spreadsheet do **not** import this file.
- Seams callers need: paint-the-filter-chips (`getAdminFacets`: `{ catalog, source_companies, source_granularities, sources, agents, merchants }`). There is no desk **seam**. There is no typeahead **seam**. There is no spreadsheet **seam**. There is no write **seam**. There is no begin / complete **seam**. The five-minute remember / forget is a beat of the paint, not a second public **seam**.
- Split later (only if the file outgrows one sitting): this ~90-line file is one sitting if you read it as paint the Admin Dashboard filter chips — live registry first, historical distincts with live identity overlaid, both desks merged with registry winning, remember five minutes, forget when Registry says `"facets"`. Do **not** copy leftover live-catalog load / `loadHistoricalCatalog` / `mergeCatalogs` here so “facets owns the catalog.” Do **not** split live vs historical into `getLiveFacets.ts` so “each database owns chips.” If it later splits: `paintTheAdminDashboardFilterChips.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

`getAdminFacets` is executor mechanics. The owner question is: *I opened the Admin Dashboard. Show me the dropdowns I can filter by — Source Companies, Source Granularities (channel, owner label, CRM label), Agents, Merchants. Live first-class Registry rows, including inactive. Historical: what actually appeared on old Form / Call / Booking rows, with live identity overlaid when we recognize the key or label. Both desks: one chip list, Registry labels win, historical-only extras stay. Remember this for five minutes. When I change an Agent, Merchant, Source Company, or Source Granularity, forget it. This is not paging the desk. This is not jumping by typed text. This is not building the catalog rows — that sitting is leftover `filterCatalog.ts`.*

Already-recommended desk walk / spreadsheet flatten / typeahead, leftover scope pick, leftover `filterCatalog` assembly, Wave A siblings `agentBrowseMetrics` / `adminSheetSync`, leftover Catalog / Registry lists, and later Analytics matching already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “paint the Admin Dashboard filter chips” story, not “an admin CRUD facets service,” and not the catalog builder:

1. **Paint the Admin Dashboard filter chips** — `getAdminFacets`. Wave B `GET /api/v1/admin/facets` plus every caller that needs the cached Filter Catalog. Combined: ask live and historical in parallel, **ask** leftover `mergeCatalogs`, then re-project the compatibility arrays. Live: **ask** leftover live-catalog load, wrap `withCompatibility`, remember five minutes on the live slot. Historical: ask the live chips first (overlay identity for leftover `loadHistoricalCatalog`), wrap, remember five minutes on the historical slot. Module load: listen to leftover `onRegistryCacheInvalidation`; when the keys include `"facets"`, forget **both** concrete slots. This file never pages a desk, never typeaheads, never mutates Mongo, and never enqueues Sheet Sync.

There is no second owner operation. `withCompatibility` / `mergeFacets` / the in-memory `Map` / `resetAdminFacetsCacheForTests` are beats of the paint, not extra stories. `catalogOrEmpty` is a dead leftover export (no caller). Do not export the cache `Map` as a public **seam**. Do not export leftover `FilterCatalog` types from here as if this file owned the row shape — they already live next door.

## Organization

Keep one file. This is the screenplay for “paint the Admin Dashboard filter chips.” The catalog load / historical distincts / overlay / merge, the paginated desk, typeahead, spreadsheet columns, scope pick, Agent metric aggregate, and Sheet Sync health already live in deeper **modules**. Do not pull those in. Do not invent an `AdminFacetsService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a catalog **adapter** beside leftover live-catalog load / `loadHistoricalCatalog`.

Do not split this by database. Live remember, historical overlay, and combined merge are beats of one paint. Do not move leftover `filterCatalog.ts` here so the two files “feel like one facets service.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getAdminFacets` | `paintTheAdminDashboardFilterChips` | Wave B `GET /facets` + desk / Analytics **ask** the cached chips |
| `AdminFacets` | `AdminDashboardFilterChips` | `catalog` plus compatibility string arrays |
| `resetAdminFacetsCacheForTests` | leftover test forget | test **adapter**; do not teach routes this name |
| `catalogOrEmpty` | leftover empty-catalog helper | **no caller**; `EMPTY_FILTER_CATALOG` already lives next door |
| re-exported `FilterCatalog*` types | leftover type aliases | row shape stays in `filterCatalog.ts` |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `admin/index.ts`, already-recommended `adminBrowse.service.ts`, later Analytics callers, and `adminFacets.service.test.ts` migrate. Do not make callers learn `withCompatibility` / `CACHE_TTL_MS` / `mergeFacets` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the chip bag Wave B already returns:

```ts
type AdminDashboardFilterChips = {
  catalog: FilterCatalog // leftover filterCatalog row shape; origin registry | historical_distinct
  source_companies: string[]     // company_slug
  source_granularities: string[] // granularity_key
  sources: string[]              // trimmed granularity crm_label — not company slugs
  agents: string[]               // agent name
  merchants: string[]            // merchant name
}
```

That is the handoff from “we loaded or remembered the catalog” to “paint the dropdowns.” Combined is the same bag; it is not a third cache slot.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminFacets.service.ts
// The owner opened the Admin Dashboard.
// Paint the filter chips: companies, granularities, agents, merchants.
// Live first-class Registry rows, including inactive.
// Historical: what old rows actually said, with live identity when we recognize it.
// Both desks: one list. Registry labels win. Historical-only extras stay.
// Remember five minutes. Forget when the Registry says the chips changed.
// This file does not page the desk.
// This file does not jump by typed text.
// This file does not build the catalog rows — leftover filterCatalog does.

// ── 1. Paint the Admin Dashboard filter chips ─────────────

export async function paintTheAdminDashboardFilterChips(scope)

async function paintBothDesksTogether()
  // ask live + historical in parallel; leftover mergeCatalogs; re-project arrays

async function paintOrRememberOneDesk(scope) // live | historical; five-minute Map
async function loadTheLiveCatalogFromTheRegistry()     // leftover live-catalog load
async function loadTheHistoricalCatalogWithLiveIdentity(liveCatalog)
  // ask live chips first, then leftover loadHistoricalCatalog

function projectTheCompatibilityArrays(catalog)
  // slugs, keys, crm_label → sources, agent names, merchant names

function forgetBothDesksWhenTheRegistrySaysFacetsChanged(keys)
  // only the "facets" key; not every Registry invalidation

export function resetAdminFacetsCacheForTests() // leftover test adapter
export function catalogOrEmpty(catalog)         // leftover; no caller — delete or move next door
```

Read the paint path out loud: *If the owner asked for both desks, paint live and historical at once and merge — Registry labels win, historical-only extras stay. If they asked for one desk, return the remembered chips when they are younger than five minutes. Live loads the first-class Registry catalog, including inactive rows. Historical asks those live chips first so leftover overlay can stamp Registry ids and labels onto distincts we recognize, then keeps rows we have never seen on the live desk. Project the old string arrays (`sources` is CRM labels, not company slugs). Remember each concrete desk. When an Owner Registry write includes `"facets"`, forget both.*

That is the operation. `getAdminFacets` is not a different story. Live / historical / combined are not three owner operations.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file does not build the catalog.** Leftover live-catalog load / `loadHistoricalCatalog` / `mergeCatalogs` / `findCatalogGranularity` stay in `filterCatalog.ts`. This file remembers, forgets, merges-at-combined, and projects compatibility. Do not copy the distincts / overlay / company-slug drop here so “facets owns facets,” and do not delete leftover `filterCatalog.ts` in this pass so “one file is cleaner.”

2. **`sources` is CRM labels, not Source Companies.** `withCompatibility.sources` maps `catalog.source_granularities[].crm_label` (trimmed truthy). `source_companies` is `company_slug`. Tests lock `sources` to `"TBM Forms"` / `"TBM Prime Forms"` / `"Top10 Forms"`. Do not fill `sources` from company slugs so “sources means companies,” and do not drop the array “because `catalog` already has labels.”

3. **Inactive rows stay on the chips.** Leftover live load is `includeInactive: true` for companies, granularities, agents, and merchants. Tests lock retired `tbm_prime_leads_form` (`active: false`) on both `catalog` and the compatibility keys / `sources`. Knowledge [`catalog.md`](../../../docs/knowledge/services/catalog.md) Downstream still says this file lists agents / merchants “active only” — that is a lie; the import is leftover `filterCatalog.ts` and it is not active-only. CONTRADICTIONS already names the import-site drift. Do not filter `active: true` so “dropdowns match the employee booking picker,” and do not “fix” that knowledge line in this rename.

4. **Historical asks live first for overlay identity.** `loadHistoricalCatalog((await getAdminFacets(live)).catalog)`. Combined then asks live and historical in parallel — historical will usually hit the live cache, but a cold combined can start both live loads at once. Do not skip the live overlay so “historical stays raw distincts,” and do not add a combined cache slot so “we never race.”

5. **Combined prefers Registry on merge and keeps historical-only extras.** Tested: `top10_leads_form` stays `origin: "registry"` with Registry `owner_label`; `legacy_sheet` stays `historical_distinct`. Do not drop historical-only chips so “the dropdown matches the live catalog,” and do not let a historical distinct overwrite a Registry label.

6. **Remember is per concrete desk, five minutes; combined is never a third slot.** Invalidation deletes live **and** historical only when the keys include `"facets"`. Source-company / granularity / agent / merchant Registry writes already pass `"facets"` (already-recommended Registry audit). Do not evict on every Registry key, and do not cache the combined merge as its own entry.

7. **`catalogOrEmpty` is dead.** Exported from this file, imported nowhere. Leftover `EMPTY_FILTER_CATALOG` / `emptyFilterCatalog()` already live next door. Delete the export or move it with the catalog file. Do not invent a third empty helper.

8. **Most runtime callers only want `.catalog`.** Already-recommended desk granularity filter, `leadMatchForQuery`, `nestObservedSourceRows`, leftover live source-label index, and `receiverAgentPerformance` take `.catalog` and leftover `findCatalogGranularity`. Only Wave B `GET /facets` and `adminFacets.service.test.ts` assert the string arrays. Do not make Analytics call leftover live-catalog load so they skip the remember/forget, and do not drop the arrays from the HTTP payload so “one shape.”

9. **Safe empty on leftover load failure is next door.** `distinctStrings` / `safeList` catch and return `[]`. This file does not retry. Named for the leftover `filterCatalog` pass. Do not add retry or a thrown “catalog unavailable” here so “chips fail closed.”

10. **Leave sibling modules alone.** The desk stays in `adminBrowse.service.ts`. Spreadsheet flatten stays in `adminExport.service.ts`. Typeahead stays in `adminSearch.service.ts`. Scope pick stays in `adminScope.service.ts`. Catalog assembly stays in leftover `filterCatalog.ts`. Agent `$unwind` stays in `agentBrowseMetrics.service.ts`. Sheet Sync health stays in `adminSheetSync.service.ts`. This file orchestrates remember-or-load → overlay-when-historical → merge-when-both → project-the-old-arrays → forget-when-facets-change.

## Testing

The **interface** is the test surface: `paintTheAdminDashboardFilterChips`. The chip bag (`catalog` + compatibility arrays), which desk was remembered, and whether `"facets"` forgot both slots are part of that **interface**.

Today’s `adminFacets.service.test.ts` already locks the live first-class catalog, compatibility arrays, historical overlay / empty-distinct fallback, combined prefer-registry, and `"facets"` eviction. Keep those. Fill the gaps the story names make obvious:

**Paint the Admin Dashboard filter chips**
- Live chips include inactive granularities and inactive Agents (`Pat` is on the stub).
- `sources` is CRM labels (`"TBM Forms"`), not company slugs (`"tbm_leads"`).
- Historical overlay stamps a recognized key with the live Registry id / `owner_label` and keeps `origin: "historical_distinct"`.
- A company-slug-only historical option is dropped when a keyed child for that company already exists.
- Combined keeps Registry `owner_label` on a shared key and still adds a historical-only extra.
- A second live (or historical) paint inside five minutes does not reload Registry / distincts.
- `invalidateRegistryCaches(["facets"])` forgets **both** concrete desks; a later paint reloads.
- Combined is not a third cache slot (it re-asks the two concrete paints).

Do **not** add a test per helper (`projectTheCompatibilityArrays`, `forgetBothDesksWhenTheRegistrySaysFacetsChanged`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover catalog distinct-field lists, overlay map keys, or `preferRicherGranularity` here — that sitting is leftover `filterCatalog.ts`. Do **not** re-test the paginated desk, Duplicate Lead hide, typeahead groups, CSV flatten, Agent `$unwind` deposit-once math, or Analytics `leadMatch` clauses here. The desk proof stays on already-recommended `showTheAdminDashboardDesk`.

`resetAdminFacetsCacheForTests` stays exported because the test **adapter** is a second real caller, not a test leak. Do not teach Wave B that name.

## What I would not do

- An `AdminFacetsService` class with `get` / `list` / `reset`.
- Thirty two-line functions that only wrap leftover live-catalog load.
- Moving this into a CRUD folder, or into leftover `catalog/` “because those also list agents.”
- Copying leftover `filterCatalog.ts` into this file so “facets owns the catalog.”
- Splitting live / historical into `getLiveFacets.ts` so “each database owns chips.”
- Filtering `active: true` so “dropdowns match the employee booking picker.”
- Filling `sources` from company slugs, or dropping the compatibility arrays “because catalog exists.”
- Caching combined as a third slot, or evicting on every Registry key.
- Making Analytics skip this remember/forget and call leftover live-catalog load directly.
- Inventing a begin / complete **seam**, or a write **seam**.
- “Fixing” [`catalog.md`](../../../docs/knowledge/services/catalog.md) Downstream “active only” / import-site drift in this rename.
- Writing a whole-folder recommendation for `admin`.
