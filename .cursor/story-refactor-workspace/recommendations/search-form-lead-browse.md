# Show The Search Workspace Form Lead Cards — operational story

- Status: recommended
- Service: `search` (Wave A, in-progress)
- Pass: 2 of this service — `formLeadBrowse.service.ts`
- Remaining in this service: `callLeadSearch.service.ts`, `callLeadBrowse.service.ts`
- Target: `src/services/search/formLeadBrowse.service.ts`
- Knowledge: `docs/knowledge/services/lead-browse.md`. Distinct from scored naming: `docs/knowledge/services/form-lead-search.md`. Distinct from Call lookup: `docs/knowledge/services/call-lead-search.md`. Distinct from admin list: `docs/knowledge/services/admin-search.md` + `admin/adminBrowse.service.ts`. Leftover last-200 list still lives on `findAllFormLeads` in `docs/knowledge/services/form-lead.md`. This checkout’s `CONTEXT.md` does not define Form Lead / Duplicate Lead / Admin Dashboard (extension search workspace) — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `GET /api/v1/form-leads` (`handleBrowseFormLeads` → Zod `browseFormLeadsQuerySchema` → this export). Barrel: `search/index.ts`. Zod tests: `v1.validation.test.ts` (empty view-all defaults, standalone `source_company`, coerce `booked`/`limit`/`skip`, unknown keys). No `formLeadBrowse.service.test.ts`. `findAllFormLeads`, `findFormLead`, `searchFormLeads`, `browseAdminResource("form-leads")`, and `browseCallLeads` do **not** import this file.
- Seams callers need: empty query is “view all newest”; page is `results` plus unpaginated `count`; Duplicate Leads stay on the desk; booked / cancelled / receiver are chips on the card, not a second request
- Split later (only if the file outgrows one sitting): keep one file — the Search desk is one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`browseFormLeads` is executor mechanics. The owner question is: *the extension Search workspace wants the Form Lead desk. No filters: newest cards. Filters: keep only rows that match every one of them. Each card says booked, cancelled, and who received it. Duplicate Leads stay on the desk. This is not naming one lead before updating quoted.*

Scored Form naming (`POST /form-leads/search`), Call browse, admin historical browse, enrichment `findFormLead`, and leftover `findAllFormLeads` already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a list CRUD service,” and not the scored naming:

1. **Show the Search workspace Form Lead cards** — fold optional desk filters. AND them. Empty fold → `{}` (view all). Pull the newest page (`createdAt` desc, `skip` / `limit`). In the same moment, count every match (not the page length) and populate Booking, Cancellation, and receiver-agent for chips. Map lean docs onto cards. Duplicate Leads stay in. This file never mutates Mongo and never enqueues Sheet Sync.

There is no second write operation. `q`, `source_company`, name, email, phone, and booked/cancelled are beats of one desk, not six services.

## Organization

Keep one file. This is the screenplay for “show the Form Lead desk.” Shared regex / attachment / chip helpers already live in `leadBrowseShared.ts`. Call browse, scored naming, admin browse, and leftover last-200 already live in deeper **modules**. Do not pull those in. Do not invent a `FormLeadBrowseService` class. Do not invent a `begin` / `complete` **seam** — this is a read.

Do not split this 200-line file by filter. `q` and `source_company` are beats of one listing. Do not split Form vs Call into a generic `browseLeads(kind)` in this pass — Wave A will recommend `callLeadBrowse.service.ts` next.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `browseFormLeads` | `showTheSearchWorkspaceFormLeadCards` | public GET Search desk |
| `FormLeadBrowseResponse` | `SearchWorkspaceFormLeadPage` | route reads `results` + unpaginated `count` |
| `FormLeadBrowseResult` | `SearchWorkspaceFormLeadCard` | one desk card: identity, `quoted`, `ref_no`, `destination_zip`, chips |

Keep the old names as one-line aliases until the v1 GET handler and `search/index.ts` migrate. Do not make callers learn `$and` / `populate` / `lean` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the card the Search workspace already paints:

```ts
type SearchWorkspaceFormLeadCard = {
  _id: string
  // identity + source snapshots + location + quoted + ref_no
  receiver_agent_name_snapshot?: string
  receiver_agent_granot_crm_username?: string
  booked: LeadBookingSummary | null
  cancelled: LeadCancellationSummary | null
}

type SearchWorkspaceFormLeadPage = {
  results: SearchWorkspaceFormLeadCard[]
  count: number // every match, not results.length
}
```

That is the handoff from “we ANDed the desk filters” to “paint the page and the booked / cancelled / receiver chips.” Shared chip shapes stay in `leadBrowseShared.ts`. Do not copy them here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formLeadBrowse.service.ts
// The extension Search workspace wants the Form Lead desk.
// No filters: newest cards.
// Filters: keep only rows that match every one of them.
// Each card says booked, cancelled, and who received it.
// Duplicate Leads stay on the desk.
// This file does not name one lead before updating quoted.
// This file does not list Call Leads.
// This file does not open the admin historical list.

// ── 1. Show the Search workspace Form Lead cards ──────────

export async function showTheSearchWorkspaceFormLeadCards(query)

function foldTheDeskFilters(query)                 // trim; drop blanks; AND
function matchAnyIdentifyingField(q)               // substring: name parts, email, phone, source snapshots, ref_no
function matchTheNamedSourceExactly(sourceCompany) // slug OR three label snapshots; anchored
function matchTheSourceCompanyId(leadSourceCompany)// exact ObjectId string; not regex
function matchTheGranularityKey(key)               // anchored exact
function matchANameContains(name)                  // name / first_name / last_name
function matchAnEmailContains(email)               // lowercased input; case-insensitive contains
function matchTheTypedPhoneContains(phone)         // typed string; not digit-flex
function matchAttachmentPresence(field, present)   // booked / cancelled chip filter

async function pullTheNewestPage(filter, skip, limit)
async function countEveryMatch(filter)             // same filter; no skip/limit
function pinTheAttachmentAndReceiverChips(doc)     // populate summaries → card
function usernameFromThePopulatedReceiver(agent)
```

Read the desk path out loud: *fold the Search workspace filters. If nothing remains, that is view all. If a phrase, a source, a name, an email, a phone, or booked/cancelled is present, keep only Form Leads that match every one of those. Pull the newest page. Count every match, not the page length. Pin booked, cancelled, and receiver chips on each card. Duplicate Leads stay on the desk.*

That is the operation. `browseFormLeads` is not a different story. `count` is not `results.length`.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Duplicate Leads stay on this desk.** Scored naming quarantines them unless `include_duplicates`. Enrichment `findFormLead` 404s them. This file has no `duplicate` clause. Do not add `{ duplicate: { $ne: true } }` so “search and browse match,” and do not add an `include_duplicates` query key in this rename.

2. **Phone here is the typed substring.** Scored naming pulls a digit-flex regex at ≥ 7 digits and scores digit strings. This file `fieldContainsClause`s whatever the owner typed. `555-1234` does not match `5551234`. Do not import `normalizePhoneNumberForMatch` or the Call-search flex regex so “phone means phone.”

3. **Name here contains; naming anchors the whole folded name.** Browse `$or`s substring on `name` / `first_name` / `last_name`. Scored naming is `^word\s+word$` after lowercase collapse and never reads first/last. Do not silently merge the two folds, and do not start honoring first/last on `POST /search` from this pass.

4. **Email is lowercased, then matched case-insensitively.** The lowercase does not change the regex. Keep both beats visible (`matchAnEmailContains`). Do not drop the lowercase “because `/i` already does it,” and do not start RFC-strict matching because Zod is `looseEmailString`.

5. **`q` and `source_company` hit the same snapshots two different ways.** `q` is substring across identity + snapshots + `ref_no`. `source_company` is anchored exact on slug **or** the three snapshots. Supplying both ANDs them. Do not collapse `source_company` into `q`, and do not make `q` exact so “source filters feel the same.”

6. **`lead_source_company` is an exact ObjectId string.** Not regex. Not the leftover slug. Zod already requires `objectIdSchema`. Do not switch it to `fieldEqualsClause` “for consistency” with `source_granularity_key`.

7. **`count` is every match.** `countDocuments(filter)` ignores `skip` / `limit`. A 50-card page with 200 matches is `count: 200`. Do not return `results.length`, and do not count after `map`.

8. **`GET /form-leads` is this file. `findAllFormLeads` is not.** Leftover last-200 (`formLead.service.ts`, still in `v1.service.ts` / `leads/index.ts`, no HTTP caller) has no populate, no filters, no `count`. Knowledge `form-lead.md` still lists it. Do not point the GET at last-200, and do not delete `findAllFormLeads` in this rename.

9. **Admin `browseAdminResource("form-leads")` is not this file.** Historical / combined scope, `past_move_date`, admin `duplicate` filter, export. This Search desk does not take `database_scope`. Do not teach this file that query.

10. **Form cards use `destination_zip` and `quoted` + `ref_no`.** Call cards use `delivery_zip` and `job_no` and omit `quoted`. Do not rename the Form zip “to match Call,” and do not add a `quoted` query filter because the card shows the flag.

11. **Leave sibling modules alone.** `leadBrowseShared.ts` already owns contains / exact / `q` / attachment / chip mapping. `browseCallLeads` stays the next Form-shaped twin. `searchFormLeads` stays naming. This file orchestrates fold → AND → page + count → pin chips.

12. **Do not treat Call browse or scored naming as this story.** Empty Call browse also lists newest, then adds `job_no`. Wave A will recommend those modules next. Do not write a whole-folder search recommendation. Do not move `getReceiverAgentCrmUsername` into `leadBrowseShared.ts` “for DRY” in this pass — the unwrap is copied, not a second **seam**.

## Testing

The **interface** is the test surface: `showTheSearchWorkspaceFormLeadCards` (today `browseFormLeads`). The page (`results` + `count`) and the card chips are part of that **interface**.

There is no `formLeadBrowse.service.test.ts`. Zod tests lock empty defaults (`limit` 50, `skip` 0), standalone `source_company`, query-string coerce, and unknown keys. That is the HTTP **seam**, not the desk story. Fill the gaps the story names make obvious:

**Show the Search workspace Form Lead cards**
- Empty query → `find({})`, `sort({ createdAt: -1 })`, `skip` 0, `limit` 50, `countDocuments({})`.
- `q` adds the full-text `$or` (name parts, email, phone, source snapshots, `ref_no`).
- `source_company` adds the four-way anchored `$or` (slug + three snapshots).
- `q` + `source_company` → `$and` of those two clauses. Prove today’s AND. Do not “fix” it into OR.
- `lead_source_company` is exact `{ lead_source_company }` — not a regex.
- `name` contains on `name` / `first_name` / `last_name`.
- `phone_number: "555-1234"` contains that typed string; it does **not** match stored `5551234`.
- `booked: true` / `false` and `cancelled: true` / `false` use today’s attachment clauses.
- A Duplicate Lead is in `results` when it matches. No default `{ duplicate: { $ne: true } }`.
- `count` is the unpaginated match total when `limit` is smaller than the hit set.
- Each card pins `booked` / `cancelled` summaries from populate (or `null` when the ref has no `_id`) and `receiver_agent_granot_crm_username` from the populated agent.
- Form-only card fields: `ref_no`, `quoted`, `destination_zip` (not `delivery_zip`).

Do **not** add a test per helper (`foldTheDeskFilters`, `matchTheTypedPhoneContains`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test scored `found` / `ambiguous`, Granot exact-ref / source-gate, CSV ObjectId skip, admin `database_scope`, or Call `job_no` here. Do not add Zod unknown-key tests in the service file — that gap lives on the schema.

## What I would not do

- A `FormLeadBrowseService` class with `list` / `filter` / `map`.
- Thirty two-line functions that only wrap `fieldContainsClause`.
- Moving this into a CRUD folder, or into `leads/` / `admin/` “because those also list Form Leads.”
- Teaching this file to quarantine Duplicate Leads, digit-flex phones, or score ties so it can replace `searchFormLeads`.
- Pointing `GET /form-leads` at leftover `findAllFormLeads`, or deleting that leftover so the knowledge table “wins.”
- Merging Form and Call browse into one `kind` switch, or moving receiver-username unwrap into `leadBrowseShared.ts`, in this pass.
- Adding `quoted`, historical scope, or `include_duplicates` so the card or admin list “looks complete.”
- Writing a whole-folder recommendation for `search`.
