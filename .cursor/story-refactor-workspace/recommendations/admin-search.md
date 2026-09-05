# Jump Across The Admin Dashboard By Typed Text — operational story

- Status: recommended
- Service: `admin` (Wave A, in-progress)
- Pass: 3 of this service — `adminSearch.service.ts`
- Remaining in this service: `adminFacets.service.ts`, `filterCatalog.ts`, `agentBrowseMetrics.service.ts`, `adminSheetSync.service.ts`
- Target: `src/services/admin/adminSearch.service.ts`
- Knowledge: [`docs/knowledge/services/admin-search.md`](../../../docs/knowledge/services/admin-search.md) (this file is the primary code: cross-resource typeahead. Already-recommended [`admin-browse.md`](admin-browse.md) is the paginated desk; already-recommended [`admin-export.md`](admin-export.md) is the spreadsheet flatten). Distinct from extension scored Search: [`form-lead-search.md`](../../../docs/knowledge/services/form-lead-search.md) / already-recommended [`search-form-lead-search.md`](search-form-lead-search.md) and [`call-lead-search.md`](../../../docs/knowledge/services/call-lead-search.md) / [`search-call-lead-search.md`](search-call-lead-search.md). Distinct from extension list cards: [`lead-browse.md`](../../../docs/knowledge/services/lead-browse.md). Form contact path lists are shared with the desk via leftover `search/leadBrowseShared.ts` (`FORM_LEAD_CONTACT_*_PATHS`) so those three desks cannot drift; scored Form Search and Call browse do not use them. This checkout’s `CONTEXT.md` does not define Admin Dashboard / Duplicate Lead / Form Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a search Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleAdminSearch` — `GET /api/v1/admin/search`; `adminSearchQuerySchema`: required trimmed `q` min 1, `database_scope` default live, `limit` default 5 max 25). Barrel: `admin/index.ts`. Tests: `admin.service.test.ts` (`global admin search returns grouped results`; `global admin search form leads include Granot snapshot contact paths`). Already-recommended desk / spreadsheet, leftover `getAdminFacets`, and extension `searchFormLeads` / `searchCallLeads` do **not** import this file.
- Seams callers need: jump-across-the-dashboard (`globalAdminSearch`: `{ groups }` of cards). There is no desk **seam**. There is no spreadsheet **seam**. There is no write **seam**. There is no begin / complete **seam**. There is no scored-verdict **seam**.
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as jump across the Admin Dashboard by typed text — every resource in parallel, live / historical / both, exact Mongo id plus substring fields, grouped cards, empty groups dropped. Do **not** split Form vs Call vs Booking into `searchFormLeads.ts` so “each resource owns typeahead.” Do **not** copy desk filters here so “search matches the table.” If it later splits: `jumpAcrossTheAdminDashboardByTypedText.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `search.ts`

`globalAdminSearch` is executor mechanics. The owner question is: *I typed a name, phone, tracking ref, job number, granularity key, or Mongo id. Show me matching cards from every Admin Dashboard resource, grouped so I can pick. Live database, historical database, or both. Duplicate Leads stay visible. This is not the paginated desk. This is not a scored “which Form Lead is this.” This is not painting the filter chips.*

Already-recommended desk walk / spreadsheet flatten, leftover scope pick, leftover `FORM_LEAD_CONTACT_*_PATHS`, Wave A siblings `adminFacets` / `filterCatalog` / `agentBrowseMetrics`, and extension scored Search already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one “jump across the Admin Dashboard by typed text” story, not “an admin CRUD search service,” and not the desk:

1. **Jump across the Admin Dashboard by typed text** — `globalAdminSearch`. Wave B typeahead. Ask all six `SEARCH_CONFIGS` resources in parallel. Per resource: expand `concreteScopes` (live, historical, or both). Per scope: trim `q`; if `mongoose.isValidObjectId(q)` add an exact `{ _id: toObjectId(q) }` **and** still `$or` an escaped `/i` substring across that resource’s fields; `find` newest `createdAt` first, `limit` per scope, `lean`. Flatten the scopes, then `slice(0, limit)` per resource (combined can mix databases but still caps at `limit`, live first). Map each hit to a jump card (`id`, `database_scope`, `primary_label`, `secondary_label`, `badges`, dashboard `href`). Drop groups with no cards. This file never pages a desk, never hides Duplicate Leads, never populates refs, never mutates Mongo, and never enqueues Sheet Sync.

There is no second owner operation. `searchResource` / `searchConcrete` / `leadBadges` / `sourceLabel` / `label` / `uniqueSearchFields` / `escapeRegex` are beats of the jump, not extra stories. Do not export `SEARCH_CONFIGS` as a public **seam**.

## Organization

Keep one file. This is the screenplay for “jump across the Admin Dashboard by typed text.” The paginated desk, spreadsheet columns, scope pick, filter chips, Agent metric aggregate, and extension scored verdict already live in deeper **modules**. Do not pull those in. Do not invent an `AdminSearchService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a desk **adapter** beside already-recommended `browseAdminResource`.

Do not split this by resource. Form Granot-snapshot fields and Booking `agent_allocations.agent_name_snapshot` are beats of one jump. Do not move desk `q` here so the two files “feel like one search.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `globalAdminSearch` | `jumpAcrossTheAdminDashboardByTypedText` | Wave B typeahead; `{ groups }` |
| `AdminSearchGroup` | `AdminDashboardJumpGroup` | `record_type` + cards; empty groups already dropped |
| `AdminSearchItem` | `AdminDashboardJumpCard` | id, which database, labels, badges, dashboard href |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `admin/index.ts`, and `admin.service.test.ts` migrate. Do not make callers learn `SEARCH_CONFIGS` / `$or` / `escapeRegex` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the grouped cards the Admin Dashboard already paints:

```ts
type AdminDashboardJumpGroup = {
  record_type: AdminResource
  items: AdminDashboardJumpCard[]
}

type AdminDashboardJumpCard = {
  id: string
  database_scope: ConcreteAdminScope // live or historical; never combined on one card
  primary_label: string
  secondary_label: string
  badges: string[]
  href: string // dashboard path, e.g. /form-leads/:id — not an API route
}
```

That is the handoff from “we matched typed text on each resource” to “paint the typeahead.” Combined cards keep their own `database_scope` so the UI knows which database to open.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminSearch.service.ts
// The owner typed a name, phone, tracking ref, job number, or Mongo id.
// Jump across every Admin Dashboard resource.
// Live database, historical database, or both.
// Group the cards so they can pick.
// Duplicate Leads stay visible.
// Form can match a Granot snapshot and still show the live submitted name.
// Call does not search a Granot snapshot.
// This file does not page the desk.
// This file does not hide duplicates.
// This file does not score like the extension Search.
// This file does not paint filter chips.

// ── 1. Jump across the Admin Dashboard by typed text ──────

export async function jumpAcrossTheAdminDashboardByTypedText(query)

async function jumpOneResource(resource, query)
async function jumpOneConcreteDatabase(resource, scope, query)

function matchAnExactMongoIdWhenTheTypedTextLooksLikeOne(q) // ObjectId clause; regex still runs
function matchTheConfiguredFieldsAsASubstring(fields, q)    // escaped /i; no phone normalize
function keepOnlyTheNewestCardsUpToTheLimit(items, limit)   // flatten scopes first; live then historical
function dropEmptyResourceGroups(groups)

function paintAJumpCard(doc, config, scope)
function pickTheFirstReadableLabel(...values)
function pickASourceLabelFromTheSnapshotFallback(doc)       // crm → granularity → company snapshot → leftover company
function paintLeadBookedOrUnbookedPlusCancelled(doc)
```

Read the jump path out loud: *Ask every resource at once. Expand live, historical, or both. If the typed text looks like a Mongo id, match that exact id and still substring-match the configured fields. Newest first. Flatten the two databases, then keep only `limit` cards per resource — live first, so combined can hide extra historical hits. Paint a card with live Form labels even when a Granot snapshot was what matched. Drop empty groups. Combined is still one response; each card says which database it came from.*

That is the operation. `globalAdminSearch` is not a different story. Six parallel finds are not six owner operations.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The desk hides Duplicate Leads; typeahead does not.** Already-recommended `hideDuplicateLeadsUnlessAsked` stays on Form / Call desks. This file has no `duplicate` clause. Do not add that hide so “search matches the table,” and do not drop the desk hide so “admin means admin.”

2. **Form can match a Granot snapshot and still show the live submitted name.** Fields include leftover `FORM_LEAD_CONTACT_*_PATHS` (live + ingested + Granot). `primary` / `secondary` still read live `name` / `email` / `phone_number`. Do not swap the label to the snapshot that matched, and do not drop Granot paths so “labels stay honest.”

3. **Call typeahead omits `granot_contact_snapshot`.** Tested. Call fields are live name / email / phone / `normalized_phone_number` plus source snapshots and `job_no`. Do not add Call Granot paths “for symmetry” with Form, and do not strip Form Granot paths so “both leads search the same.”

4. **Form typeahead has `ref_no` / `lid` and no `job_no`.** Additive Form Job Number is not in `SEARCH_CONFIGS`. Call / Booking / Cancellation search `job_no`. Do not add Form `job_no` “for symmetry” in this rename.

5. **Combined flattens live then historical, then slices.** Each scope already `limit`s Mongo. `searchResource` then `flat().slice(0, limit)`. Live cards win the cap; extra historical hits disappear. Do not merge-rank across databases so “the best hit wins,” and do not raise the cap to `limit * scopes` so “combined means twice as many.”

6. **An ObjectId clause does not skip the regex.** `mongoose.isValidObjectId` (more permissive than 24-hex) then `toObjectId`, **and** every configured field still substring-matches. Do not skip the field `$or` when the text looks like an id, and do not treat a 12-byte string that `isValidObjectId` accepts as “not an id.”

7. **Matching is substring regex, not phone normalize and not a score.** No `normalizePhoneNumberForMatch`. No extension `found` / `not_found` / `ambiguous`. Confidence is not a field. Do not import already-recommended `searchFormLeads` so “search means search,” and do not add a verdict **seam** this route never reads.

8. **Empty groups are dropped.** One Form hit → one group. Do not return six empty shells so “the UI can keep a stable slot per resource.”

9. **Inactive Agents stay in the jump.** Badge is `inactive` plus `agent`. Secondary also says `inactive` / `active`. Do not filter `active: false` so “typeahead matches the catalog picker.”

10. **This file copies `escapeRegex` instead of importing leftover `leadBrowseShared`.** The path lists already come from that module. Do not invent a third escaper, and do not move the path lists into this file so “search owns Form contact.”

11. **No populate.** Booking agent match is the dotted `agent_allocations.agent_name_snapshot` on a lean doc. Cancellation matches leftover `agent` string, not allocations. Do not populate live Agent names so “the snapshot can go stale,” and do not flatten Cancellation through `agent_allocations`.

12. **`href` is a dashboard path, not an API route.** `/form-leads/:id`, `/call-leads/:id`, `/bookings/:id`, `/cancellations/:id`, `/customers/:id`, `/agents/:id`. Do not point cards at `/api/v1/admin/...`, and do not reuse desk `getAdminResourceDetail` from here.

13. **No cross-resource ranking.** Groups stay in `SEARCH_CONFIGS` key order. Do not sort all cards by score or recency into one list so “the best hit is first.”

14. **`limit` is per resource after flatten, not a global cap.** Default 5, max 25, from Zod. Six resources can return up to `6 * limit` cards. Do not share one cap across types so “typeahead stays short.”

15. **Source secondary fallback is crm snapshot → granularity snapshot → company snapshot → leftover `source_company`.** Same order as the knowledge doc. Do not skip the snapshots so “the live company always wins.”

16. **Leave sibling modules alone.** The desk stays in `adminBrowse.service.ts`. Spreadsheet flatten stays in `adminExport.service.ts`. Scope pick stays in `adminScope.service.ts`. Filter chips stay in `adminFacets` / `filterCatalog`. Agent `$unwind` stays in `agentBrowseMetrics.service.ts`. Form contact path lists stay in leftover `leadBrowseShared.ts`. This file orchestrates ask-every-resource → match-id-and-fields → cap-per-resource → paint-the-card.

## Testing

The **interface** is the test surface: `jumpAcrossTheAdminDashboardByTypedText`. The `{ groups }` bag, card labels / badges / `href` / `database_scope`, and which fields entered `$or` are part of that **interface**.

Today’s `admin.service.test.ts` only locks one Form group with a booked badge, and Form-vs-Call Granot snapshot paths. Fill the gaps the story names make obvious:

**Jump across the Admin Dashboard by typed text**
- One Form hit still drops the other five empty groups.
- Form `$or` includes leftover Granot / ingested contact paths; Call `$or` does not include `granot_contact_snapshot`.
- Form `$or` has `ref_no` / `lid` and no `job_no`.
- A Duplicate Lead still appears (no desk hide).
- An inactive Agent appears with `inactive` + `agent` badges.
- Typed ObjectId adds `_id` **and** still regexes the configured fields.
- Combined: live cards fill the per-resource `limit` first; extra historical hits are sliced off.
- Form labels stay live `name` / `email` / `phone_number` even when the match was a Granot snapshot.
- Booking `cancelled` badge is additive on top of `booked`; Cancellation group is only `cancelled`.
- `href` stays a dashboard path (`/bookings/:id`, not `/api/v1/admin/booked-leads/:id`).
- `limit` is per resource, not a global cap across the six groups.

Do **not** add a test per helper (`pickTheFirstReadableLabel`, `matchAnExactMongoIdWhenTheTypedTextLooksLikeOne`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test the paginated desk, Duplicate Lead hide, combined first-page desk merge, CSV flatten, facet cache, Agent `$unwind` deposit-once math, or extension `found` / `ambiguous` here. The desk proof stays on already-recommended `showTheAdminDashboardDesk`.

## What I would not do

- An `AdminSearchService` class with `search` / `list` / `get`.
- Thirty two-line functions that only wrap `find`.
- Moving this into a CRUD folder, or into `search/` “because those also search.”
- Splitting Form / Call / Booking into `searchFormLeads.ts` so “each resource owns typeahead.”
- Adding the desk Duplicate Lead hide, date filters, or `source_granularity_key` exact-match so “search matches the table.”
- Importing already-recommended `searchFormLeads` / `searchCallLeads` so “search means search.”
- Adding Call Granot snapshot paths or Form `job_no` “for symmetry.”
- Swapping Form labels to the snapshot that matched.
- Merge-ranking combined hits, or raising the combined cap to `limit * scopes`.
- Skipping the field regex when the typed text looks like an ObjectId.
- Filtering inactive Agents, or returning empty groups as stable slots.
- Pointing `href` at `/api/v1/admin/...`, or calling `getAdminResourceDetail` from here.
- Writing a whole-folder recommendation for `admin`.
