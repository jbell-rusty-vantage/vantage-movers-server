# Show The Admin Dashboard Desk For This Resource — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 1 of this service — `adminBrowse.service.ts`
- Remaining in this service: `adminExport.service.ts`, `adminSearch.service.ts`, `adminFacets.service.ts`, `filterCatalog.ts`, `agentBrowseMetrics.service.ts`, `adminSheetSync.service.ts`
- Target: `src/services/admin/adminBrowse.service.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (this file is the paginated desk; that Service’s primary code is typeahead `adminSearch.service.ts`. It already distinguishes browse: tables with pagination, sort, date range, Source Company via `source_granularity_key`, default Duplicate Lead hide). Distinct from extension Search cards: [`lead-browse.md`](../../../docs/knowledge/services/lead-browse.md) + already-recommended [`search-form-lead-browse.md`](search-form-lead-browse.md) / [`search-call-lead-browse.md`](search-call-lead-browse.md). Agent list metrics live in sibling `agentBrowseMetrics.service.ts` (project-organization + admin-search Related). This checkout’s `CONTEXT.md` does not define Admin Dashboard / Duplicate Lead / Form Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a browse Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAdminBrowse` — `GET /api/v1/admin/{form-leads|call-leads|booked-leads|cancelled-leads|customers|agents}`; `handleAdminDetail` — `GET /api/v1/admin/{resource}/:id`, both parse `adminBrowseQuerySchema`). Barrel: `admin/index.ts`. CSV sibling `adminExport.service.ts` **asks** `exportAdminResourceRows` (Wave B `GET /api/v1/admin/exports/{resource}.csv` does **not** import this file). Tests: `admin.service.test.ts` (filter / pagination / Duplicate Lead hide / past move date / granularity vs leftover `source_company` / Booking source / leadless / Agent metrics attach / Form SMS flag / historical models / Form detail SMS body). `getAdminResourceConfig` has no runtime caller besides the barrel re-export. Extension `browseFormLeads` / `browseCallLeads`, `globalAdminSearch`, and leftover `findAllFormLeads` do **not** import this file.
- Seams callers need: show-the-desk (`browseAdminResource`: live / historical / combined page) vs open-one-record (`getAdminResourceDetail`: refuses combined) vs collect-rows-for-download (`exportAdminResourceRows`: CSV sibling walks the same desk). There is no write **seam**. There is no begin / complete **seam**. There is no typeahead **seam**. There is no CSV-column **seam**.
- Split later (only if the file outgrows one sitting): this ~840-line file is one sitting if you read it as show the Admin Dashboard desk for this resource — open one record — collect rows for a download. Do **not** split Form vs Call vs Booking into `browseFormLeads.ts` so “each resource owns a desk.” Do **not** split combined merge into a second module so “one scope never sees the other.” If it later splits: `showTheAdminDashboardDesk.ts` / `openOneAdminDashboardRecord.ts` / `collectTheAdminDashboardRowsForDownload.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

`browseAdminResource` / `getAdminResourceDetail` / `exportAdminResourceRows` are executor mechanics. The owner question is: *Open the Admin Dashboard desk for one resource. Live database, historical database, or both. Duplicate Leads stay off the Form and Call desks unless I ask for them. Page, sort, and filter. When I open one row, do not mix the two databases. A download walks this same desk and stops at five thousand rows. This is not jumping by name across every resource. This is not painting the filter chips. This is not flattening CSV columns.*

Already-recommended extension Search desks, leftover last-200 Form list, and Wave A siblings `adminScope` / `adminExport` / `adminSearch` / `adminFacets` / `filterCatalog` / `agentBrowseMetrics` already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “show the Admin Dashboard desk for this resource” story, not “an admin CRUD list service,” and not the typeahead:

1. **Show the Admin Dashboard desk** — `browseAdminResource`. Wave B list. One resource. Fold the desk filters (date, `q`, leftover `source_company` bookmark, Source Granularity, booked / cancelled presence, money ranges, receiver-agent id, Lead Source Company id, Form past-move-date, Booking leadless / source). Form and Call desks hide Duplicate Leads unless `duplicate === true`. Concrete scope: page Mongo, populate the configured refs, stamp `database_scope` on each row. Combined: ask each concrete desk for its first page (limit capped at 250), merge, sort in memory, then slice. After the page: Form rows get `sms_message_sent` (live only); Customer rows get booking / cancellation / deposit totals; Agent rows **ask** sibling `getAgentBrowseMetrics`. This file never mutates Mongo and never enqueues Sheet Sync.

2. **Open one Admin Dashboard record** — `getAdminResourceDetail`. Wave B detail. Bad ObjectId → 400. Combined → throw (`rejectCombinedDetailScope`). Missing row → 404. Same populate as the desk. Customer: last 25 related Bookings and Cancellations plus `aggregates` from those arrays. Agent: same metric attach as the desk (date filters from the query). Form (live): latest Lead Message body plus `sms_message_sent`. Historical Form: `sms_message_sent: false` and `sms_message: null`.

3. **Collect the Admin Dashboard rows for a download** — `exportAdminResourceRows`. CSV sibling **asks** this. Walk each concrete scope page by page (`limit` min of 250 and the cap). Stop at 5_000 rows. Combined download walks both scopes for real; it does **not** reuse the combined desk’s in-memory first-page merge.

There is no fourth write operation. `getAdminResourceConfig` is leftover config leak, not an owner operation. Do not export `browseConcrete` / `buildFilter` / `leadSourceGranularityFilter` as a public **seam**.

## Organization

Keep one file. This is the screenplay for “show the Admin Dashboard desk, open one record, collect rows for a download.” Scope pick, filter-catalog assembly, facet cache, Agent metric aggregate, and CSV flatten already live in deeper **modules**. Do not pull those in. Do not invent an `AdminBrowseService` class. Do not invent a begin / complete **seam** — this is a read.

Do not split this by resource. Form `q` paths and Booking `leadless` are beats of one desk. Do not split list vs detail vs export-rows into CRUD files.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `browseAdminResource` | `showTheAdminDashboardDesk` | Wave B list; live / historical / combined |
| `getAdminResourceDetail` | `openOneAdminDashboardRecord` | Wave B detail; refuses combined |
| `exportAdminResourceRows` | `collectTheAdminDashboardRowsForDownload` | CSV sibling walks the same desk; flatten stays next door |
| `AdminBrowseResult` | `AdminDashboardDeskPage` | `items` + `page` + `limit` + `total` + `has_next_page` |
| `getAdminResourceConfig` | leftover sort / filter map | barrel re-export; no Wave B caller — do not teach routes this name |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `admin/index.ts`, `adminExport.service.ts`, and `admin.service.test.ts` migrate. Do not make callers learn `$and` / `populate` / `RESOURCE_CONFIGS` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the page the Admin Dashboard already paints:

```ts
type AdminDashboardDeskPage = {
  items: AdminDashboardDeskRow[]
  page: number
  limit: number
  total: number // every match in this scope (sum when combined)
  has_next_page: boolean
}

type AdminDashboardDeskRow = {
  _id: string
  database_scope: ConcreteAdminScope // live or historical; never combined on one row
  // resource fields + optional sms_message_sent / customer totals / agent metrics
}
```

That is the handoff from “we folded the desk filters” to “paint the page.” Combined rows keep their own `database_scope` so the UI knows which database to open.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminBrowse.service.ts
// The owner opens the Admin Dashboard desk for one resource.
// Live database, historical database, or both.
// Duplicate Leads stay off the Form and Call desks unless asked for.
// Opening one row refuses both-databases-at-once.
// A download walks this same desk and stops at five thousand rows.
// This file does not typeahead across resources.
// This file does not paint filter chips.
// This file does not flatten CSV columns.
// This file does not count Agent bookings itself.

// ── 1. Show the Admin Dashboard desk ──────────────────────

export async function showTheAdminDashboardDesk(resource, query)

async function showOneConcreteDesk(resource, scope, query)
async function showBothDesksMergedInMemory(resource, query) // first page each; then slice

function foldTheDeskFilters(config, query)
async function matchTheChosenSourceGranularity(resource, query, scope) // asks leftover facets
function hideDuplicateLeadsUnlessAsked(query)              // Form / Call only
function matchAPastMoveDateAgainstTheTimestamp(query)      // Form; Florida calendar UTC parts
function matchALeadlessBooking(query)
function matchABookingSourceLabel(query)                   // leftover resolveSourceCompany
function stampWhichDatabaseThisRowCameFrom(doc, scope)

async function markWhetherAFormLeadGotAText(items, scope, includeBody)
async function pinCustomerBookingTotalsOnTheDesk(items, models)
async function pinAgentBookingMetricsOnTheDesk(items, models, query) // asks leftover metrics

// ── 2. Open one Admin Dashboard record ────────────────────

export async function openOneAdminDashboardRecord(resource, id, scope, query)

function refuseBothDatabasesOnOneRecord(scope)
async function pinRelatedBookingsOnTheCustomer(item, models, scope) // last 25
async function pinTheLatestFormLeadTextOnTheRecord(item, scope)

// ── 3. Collect the Admin Dashboard rows for a download ────

export async function collectTheAdminDashboardRowsForDownload(resource, query, maxRows = 5_000)
```

Read the desk path out loud: *Pick the resource. Fold the Admin Dashboard filters. Hide Duplicate Leads on Form and Call unless asked. If the desk is one database, page Mongo and stamp which database each row came from. If the desk is both databases, take the first page of each, merge, sort, and slice — do not pretend that is a real deep page. After the page, mark whether a live Form Lead got a text, pin Customer totals, and ask the Agent-metrics sibling for booking counts. Opening one row refuses both-databases-at-once. A download walks each concrete desk page by page and stops at five thousand rows.*

That is the operation. `browseAdminResource` is not a different story. Combined `has_next_page` is not proof the next page was fetched.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Combined desk is a first-page merge.** `showBothDesksMergedInMemory` asks each concrete desk for `page: 1` with `limit` capped at 250, concatenates, sorts in process, then `slice`s. `total` and `has_next_page` use the summed Mongo counts. Page 3 of a 10_000-row combined desk can claim a next page whose rows were never loaded. Do not silently replace this with a sorted `$unionWith` in this rename, and do not teach the CSV walk to use this merge.

2. **Combined download is the real walk.** `collectTheAdminDashboardRowsForDownload` loops `browseConcrete` per scope until the cap. Same owner question, two adapters. Do not point the CSV sibling at `showBothDesksMergedInMemory` so “export matches the combined table,” and do not make the combined desk walk every page so “list matches export.”

3. **Duplicate Leads are hidden here and kept on the extension Search desk.** Default `{ duplicate: { $ne: true } }` on Form and Call. Already-recommended `browseFormLeads` has no duplicate clause. Do not add that hide to the Search workspace so “browse means browse,” and do not drop the hide here so “admin matches Search.”

4. **`source_granularity_key` wins over leftover `source_company`.** When a granularity is selected, the leftover company string filter is skipped. Granularity **asks** leftover `getAdminFacets` + `findCatalogGranularity`, then matches key / label snapshot / catalog id, and on historical may also exact-match `source_company` / catalog `company_slug`. Leftover `source_company` alone is bookmark compatibility (anchored exact, not substring). Do not collapse granularity into leftover `source_company`, and do not make leftover `source_company` a substring so “q and source feel the same.”

5. **`q` is substring; leftover company / granularity are anchored.** `q` `$or`s contains across identity + snapshots + ids. ObjectId-shaped `q` also exact-matches `_id`. Do not make `q` exact so “source filters feel the same,” and do not make granularity a contains.

6. **Booked / cancelled on the desk mean “a ref is present,” not the boolean field.** `presenceClause` is `$ne: null` / `$exists` (true) vs null-or-missing (false). Agent `active` is the real boolean. Do not switch booked / cancelled to `{ booked: true }` so “boolean means boolean.”

7. **Past move date is Form-only Florida calendar math.** `move_date` (UTC midnight) vs UTC start of `timestamp`’s calendar day. `past_move_date: false` wraps `$not`. Call desks ignore the flag. Do not import a timezone library, and do not apply this clause to Call Leads “for symmetry.”

8. **Customer detail `aggregates.booking_count` is the related-list length (max 25).** The desk pin uses a real `$group`. Detail `aggregates` recounts the last-25 arrays. Do not silently make detail ask the desk aggregate so “the numbers match,” and do not make the desk use `related_bookings.length`.

9. **Live Form SMS is existence on the desk and the latest body on the record.** Historical Form always `sms_message_sent: false`. Browse does not attach `sms_message`. Do not load every Lead Message on the desk so “list matches detail,” and do not start writing historical texts from the live `LeadMessage` collection.

10. **Leave sibling modules alone.** `getAdminModels` / `concreteScopes` / `rejectCombinedDetailScope` stay in `adminScope.service.ts`. Filter chips stay in `adminFacets` / `filterCatalog`. Agent `$unwind` / deposit-once rules stay in `agentBrowseMetrics.service.ts`. CSV columns stay in `adminExport.service.ts`. Typeahead stays in `adminSearch.service.ts`. This file orchestrates fold → hide duplicates → page → stamp scope → pin extras.

11. **Do not treat extension Search or leftover last-200 as this story.** `GET /api/v1/form-leads` is `browseFormLeads`. `GET /api/v1/admin/form-leads` is this file. Do not point the admin route at Search cards, and do not teach this file `skip` / `results` / `count` so the envelopes match.

12. **`getAdminResourceConfig` is not an owner operation.** No Wave B caller. Do not add a route that returns `RESOURCE_CONFIGS`. Leave the export as an alias until the barrel drops it.

## Testing

The **interface** is the test surface: `showTheAdminDashboardDesk`, `openOneAdminDashboardRecord`, `collectTheAdminDashboardRowsForDownload`. The page (`items` + `total` + `has_next_page`) and the stamped `database_scope` are part of that **interface**.

Today’s `admin.service.test.ts` already names most desk filters and Agent-metric attach. Fill the gaps the story names make obvious:

**Show the Admin Dashboard desk**
- Default Form / Call desk adds `{ duplicate: { $ne: true } }`. `duplicate: true` keeps only duplicates.
- `source_granularity_key` + leftover `source_company` → granularity clause only (no leftover company substring).
- Leftover `source_company` alone is anchored exact (does not match `tbm_prime_leads` for `tbm_leads`).
- Combined desk: each concrete call is `page: 1`; returned `has_next_page` can be true when only those first pages were fetched. Prove today’s merge. Do not “fix” it into a deep union.
- Historical Form rows stamp `database_scope: "historical"` and do not touch the live model.
- Live Form desk sets `sms_message_sent` without `sms_message`.
- Customer desk totals come from `$group`, not from a related-list length.
- Agent desk attaches sibling metrics (including zeros) and forwards `from` / `to` onto `book_date`.

**Open one Admin Dashboard record**
- Combined throws. Invalid id → 400. Missing → 404.
- Live Form detail attaches the latest Lead Message body.
- Customer `aggregates.booking_count` equals `related_bookings.length` (today’s cap), not the desk `$group`.
- Agent detail uses the same metric attach as the desk.

**Collect the Admin Dashboard rows for a download**
- Combined download asks `browseConcrete` per scope (not the in-memory merge).
- Stops at 5_000. Per-page limit is `min(maxRows, 250)`.
- Do **not** assert CSV headers here — that is the next sitting (`adminExport.service.ts`).

Do **not** add a test per helper (`foldTheDeskFilters`, `hideDuplicateLeadsUnlessAsked`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test typeahead groups, facet cache TTL, filter-catalog overlay, Agent `$unwind` deposit-once math, or CSV escaping here.

## What I would not do

- An `AdminBrowseService` class with `list` / `get` / `export`.
- Thirty two-line functions that only wrap `mergeFilters`.
- Moving this into a CRUD folder, or into `search/` / `leads/` “because those also list Form Leads.”
- Breaking the combined first-page merge by “fixing” it to a deep union in this rename.
- Teaching the extension Search desk to hide Duplicate Leads, or teaching this desk to keep them, so the two browsed desks match.
- Pointing Wave B `GET /api/v1/admin/form-leads` at `browseFormLeads`, or pointing `GET /api/v1/form-leads` at this file.
- Pulling facet catalog, Agent metric aggregate, or CSV flatten into this file.
- Writing a whole-folder recommendation for `admin`.
