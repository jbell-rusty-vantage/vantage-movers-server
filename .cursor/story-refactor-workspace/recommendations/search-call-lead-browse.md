# Show The Search Workspace Call Lead Cards — operational story

- Status: recommended
- Service: `search` (Wave A, visited)
- Pass: 4 of this service — `callLeadBrowse.service.ts`
- Remaining in this service: none
- Target: `src/services/search/callLeadBrowse.service.ts`
- Knowledge: `docs/knowledge/services/lead-browse.md` (Form + Call share the same Service file). Distinct from any-clue Call lookup: `docs/knowledge/services/call-lead-search.md`. Distinct from scored Form naming: `docs/knowledge/services/form-lead-search.md`. Distinct from Call writes: `docs/knowledge/services/call-lead.md`. Distinct from admin list: `docs/knowledge/services/admin-search.md` + `admin/adminBrowse.service.ts`. Leftover last-200 list still lives on `findAllCallLeads` in `docs/knowledge/services/call-lead.md`. This checkout’s `CONTEXT.md` does not define Call Lead / Job Number / Duplicate Lead / Admin Dashboard (extension search workspace) — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `GET /api/v1/call-leads` (`handleBrowseCallLeads` → Zod `browseCallLeadsQuerySchema` → this export). Barrel: `search/index.ts`. Leftover `src/services/callLeadSearch.service.ts` re-exports lookup only — it does **not** re-export this file. Zod tests: `v1.validation.test.ts` (`q` + `job_no` only). No `callLeadBrowse.service.test.ts`. `findAllCallLeads`, `searchCallLeads`, `browseFormLeads`, `browseAdminResource("call-leads")`, and booked-from-source Job find do **not** import this file.
- Seams callers need: empty query is “view all newest”; page is `results` plus unpaginated `count`; Duplicate Call Leads stay on the desk; booked / cancelled / receiver are chips on the card; `job_no` is a contains desk filter, not the any-clue exact lookup
- Split later (only if the file outgrows one sitting): keep one file — the Search desk is one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`browseCallLeads` is executor mechanics. The owner question is: *the extension Search workspace wants the Call Lead desk. No filters: newest cards. Filters: keep only rows that match every one of them, including a Job Number the owner typed part of. Each card says booked, cancelled, and who received it. Duplicate Call Leads stay on the desk. This is not looking up every Call Lead any clue touches.*

Any-clue Call lookup (`POST /call-leads/search`), Form browse, admin historical browse, leftover `findAllCallLeads`, and booked-from-source Job find already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a list CRUD service,” and not the any-clue lookup:

1. **Show the Search workspace Call Lead cards** — fold optional desk filters. AND them. Empty fold → `{}` (view all). Pull the newest page (`createdAt` desc, `skip` / `limit`). In the same moment, count every match (not the page length) and populate Booking, Cancellation, and receiver-agent for chips. Map lean docs onto cards. Duplicate Call Leads stay in. This file never mutates Mongo and never enqueues Sheet Sync.

There is no second write operation. `q`, `source_company`, name, email, phone, `job_no`, and booked/cancelled are beats of one desk, not seven services.

## Organization

Keep one file. This is the screenplay for “show the Call Lead desk.” Shared regex / attachment / chip helpers already live in `leadBrowseShared.ts`. Form browse, any-clue Call lookup, admin browse, and leftover last-200 already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadBrowseService` class. Do not invent a `begin` / `complete` **seam** — this is a read. Do not invent a Form-shaped verdict **seam** that has only one real adapter.

Do not split this 202-line file by filter. `q` and `job_no` are beats of one listing. Do not merge Form and Call into a generic `browseLeads(kind)` in this pass — Wave A already recommended `formLeadBrowse.service.ts` as its own screenplay.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `browseCallLeads` | `showTheSearchWorkspaceCallLeadCards` | public GET Search desk |
| `CallLeadBrowseResponse` | `SearchWorkspaceCallLeadPage` | route reads `results` + unpaginated `count` |
| `CallLeadBrowseResult` | `SearchWorkspaceCallLeadCard` | one desk card: identity, `job_no`, `delivery_zip`, chips |

Keep the old names as one-line aliases until the v1 GET handler and `search/index.ts` migrate. Do not make callers learn `$and` / `populate` / `lean` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the card the Search workspace already paints:

```ts
type SearchWorkspaceCallLeadCard = {
  _id: string
  // identity + source snapshots + location + job_no
  receiver_agent_name_snapshot?: string
  receiver_agent_granot_crm_username?: string
  booked: LeadBookingSummary | null
  cancelled: LeadCancellationSummary | null
}

type SearchWorkspaceCallLeadPage = {
  results: SearchWorkspaceCallLeadCard[]
  count: number // every match, not results.length
}
```

That is the handoff from “we ANDed the desk filters” to “paint the page and the booked / cancelled / receiver chips.” Shared chip shapes stay in `leadBrowseShared.ts`. Do not copy them here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadBrowse.service.ts
// The extension Search workspace wants the Call Lead desk.
// No filters: newest cards.
// Filters: keep only rows that match every one of them.
// A typed Job Number is a contains filter, not an exact lookup.
// Each card says booked, cancelled, and who received it.
// Duplicate Call Leads stay on the desk.
// This file does not look up every Call Lead any clue touches.
// This file does not list Form Leads.
// This file does not open the admin historical list.

// ── 1. Show the Search workspace Call Lead cards ──────────

export async function showTheSearchWorkspaceCallLeadCards(query)

function foldTheDeskFilters(query)                 // trim; drop blanks; AND
function matchAnyIdentifyingField(q)               // substring: name parts, email, phone, source snapshots, job_no
function matchTheNamedSourceExactly(sourceCompany) // slug OR three label snapshots; anchored
function matchTheSourceCompanyId(leadSourceCompany)// exact ObjectId string; not regex
function matchTheGranularityKey(key)               // anchored exact
function matchANameContains(name)                  // name / first_name / last_name
function matchAnEmailContains(email)               // lowercased input; case-insensitive contains
function matchTheTypedPhoneContains(phone)         // typed string; not digit-flex; no 8-digit gate
function matchTheTypedJobNumberContains(jobNo)     // substring on job_no — not exact, not normalized_job_no
function matchAttachmentPresence(field, present)   // booked / cancelled chip filter

async function pullTheNewestPage(filter, skip, limit)
async function countEveryMatch(filter)             // same filter; no skip/limit
function pinTheAttachmentAndReceiverChips(doc)     // populate summaries → card
function usernameFromThePopulatedReceiver(agent)
```

Read the desk path out loud: *fold the Search workspace filters. If nothing remains, that is view all. If a phrase, a source, a name, an email, a phone, a Job Number, or booked/cancelled is present, keep only Call Leads that match every one of those. A typed Job Number keeps rows whose stored `job_no` contains those characters. Pull the newest page. Count every match, not the page length. Pin booked, cancelled, and receiver chips on each card. Duplicate Call Leads stay on the desk.*

That is the operation. `browseCallLeads` is not a different story. `count` is not `results.length`. Contains is not exact Job find.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Duplicate Call Leads stay on this desk.** Any-clue Call lookup also keeps them (no flag). Form naming quarantines unless `include_duplicates`. Enrichment `findFormLead` 404s Duplicate Form Leads. This file has no `duplicate` clause. Do not add `{ duplicate: { $ne: true } }` so “search and browse match,” and do not add an `include_duplicates` query key in this rename.

2. **Phone here is the typed substring.** Call lookup drops a phone under 8 digits, then `$or`s `normalized_phone_number` with a digit-flex regex. Form naming flexes at ≥ 7 digits. This file `fieldContainsClause`s whatever the owner typed. `555-1234` does not match `5551234`. A 7-digit typed phone is still a desk filter. Do not import `normalizePhoneNumberForMatch` or the Call-search flex regex so “phone means phone.”

3. **Job Number here contains.** Exact trim is **not** this file. Call lookup and booked-from-source find use exact `{ job_no }`. Identity / Granot use digit-core equivalence. This file `fieldContainsClause`s `job_no` only — `P55` hits `P5556767`, and `P5562366` does not find `5562366`. Three “same Job” meanings already sit on CONTRADICTIONS; this is a fourth (substring). Do not switch this to exact equality so “browse finds the same Job as search,” and do not add `normalized_job_no` or `jobNumbersEquivalent` so prefix twins match.

4. **Empty usable filters are view-all.** `combineClauses([])` → `{}`. Call lookup’s empty usable clues are `{ _id: { $exists: false } }` → `[]`. Do not return the impossible-id filter so “empty browse behaves like empty search.”

5. **AND is the product.** Phone + job returns a Call Lead that matches **both**. Call lookup ORs every clue. Form naming ORs the pull, then scores. Switching this `$and` to `$or` would swell the desk. Knowledge already says so. Rename so the every-filter beat is visible (`foldTheDeskFilters`). Do not OR “because Call search ORs.”

6. **`q` and `job_no` both contain `job_no`.** `q` is substring across identity + snapshots + `job_no` (no `ref_no`). Dedicated `job_no` is substring on that field only. Supplying both ANDs two contains on the same column. Do not collapse `job_no` into `q`, and do not make `q` exact so “Job filters feel the same.”

7. **`q` and `source_company` hit the same snapshots two different ways.** `q` is substring. `source_company` is anchored exact on slug **or** the three snapshots. Supplying both ANDs them. Do not collapse `source_company` into `q`.

8. **`lead_source_company` is an exact ObjectId string.** Not regex. Not the leftover slug. Zod already requires `objectIdSchema`. Do not switch it to `fieldEqualsClause` “for consistency” with `source_granularity_key`.

9. **`count` is every match.** `countDocuments(filter)` ignores `skip` / `limit`. A 50-card page with 200 matches is `count: 200`. Do not return `results.length`, and do not count after `map`.

10. **`GET /call-leads` is this file. `findAllCallLeads` is not.** Leftover last-200 (`callLead.service.ts`, still in `v1.service.ts` / `leads/index.ts`, no HTTP caller) has no populate, no filters, no `count`. Knowledge `call-lead.md` still lists it. Do not point the GET at last-200, and do not delete `findAllCallLeads` in this rename.

11. **Admin `browseAdminResource("call-leads")` is not this file.** Historical / combined scope, `past_move_date`, admin `duplicate` filter, export. This Search desk does not take `database_scope`. Do not teach this file that query.

12. **Call cards use `delivery_zip` and `job_no`.** Form cards use `destination_zip` and `quoted` + `ref_no`. The Call model still has required `quoted` (default false), plus `form_fill`, `created_on_unmatched`, `local`, and `normalized_phone_number`. This card omits all of those. Do not add `quoted` / `form_fill` so “the card looks complete,” and do not rename the Call zip “to match Form.”

13. **Zod Call browse tests are thinner than Form.** Form schema tests lock empty view-all defaults, standalone `source_company`, coerce `booked`/`limit`/`skip`, and unknown keys. Call schema tests only lock `q` + `job_no`. Knowledge `lead-browse.md` says schema coverage is `v1.validation.test.ts`. Do not add the missing Call Zod cases as a silent docs fix in this rename — that gap lives on the schema file.

14. **Leave sibling modules alone.** `leadBrowseShared.ts` already owns contains / exact / `q` / attachment / chip mapping. `browseFormLeads` stays the Form-shaped twin. `searchCallLeads` stays any-clue lookup. This file orchestrates fold → AND → page + count → pin chips. Do not move `getReceiverAgentCrmUsername` into `leadBrowseShared.ts` “for DRY” in this pass — the unwrap is copied, not a second **seam**.

15. **Do not treat any-clue Call lookup or Form browse as this story.** Empty Call lookup returns no rows. Empty Call browse lists newest. Wave A already recommended those modules. Do not write a whole-folder search recommendation.

## Testing

The **interface** is the test surface: `showTheSearchWorkspaceCallLeadCards` (today `browseCallLeads`). The page (`results` + `count`) and the card chips are part of that **interface**.

There is no `callLeadBrowse.service.test.ts`. Zod tests lock `q` + `job_no` only. That is the HTTP **seam**, not the desk story. Fill the gaps the story names make obvious:

**Show the Search workspace Call Lead cards**
- Empty query → `find({})`, `sort({ createdAt: -1 })`, `skip` 0, `limit` 50, `countDocuments({})`.
- `q` adds the full-text `$or` (name parts, email, phone, source snapshots, `job_no` — not `ref_no`).
- `source_company` adds the four-way anchored `$or` (slug + three snapshots).
- `q` + `source_company` → `$and` of those two clauses. Prove today’s AND. Do not “fix” it into OR.
- `lead_source_company` is exact `{ lead_source_company }` — not a regex.
- `name` contains on `name` / `first_name` / `last_name`.
- `phone_number: "555-1234"` contains that typed string; it does **not** match stored `5551234`; a 7-digit typed phone is still a clause.
- `job_no: "P55"` contains — `{ job_no: /P55/i }` hits `P5556767`. It is **not** `{ job_no: "P55" }` and not `normalized_job_no`.
- `q` + `job_no` → `$and` of the full-text `$or` and the Job contains. A row that matches only the phone in `q` is out when `job_no` is also set.
- `booked: true` / `false` and `cancelled: true` / `false` use today’s attachment clauses.
- A Duplicate Call Lead is in `results` when it matches. No default `{ duplicate: { $ne: true } }`.
- `count` is the unpaginated match total when `limit` is smaller than the hit set.
- Each card pins `booked` / `cancelled` summaries from populate (or `null` when the ref has no `_id`) and `receiver_agent_granot_crm_username` from the populated agent.
- Call-only card fields: `job_no`, `delivery_zip` (not `destination_zip`). No `quoted`, no `ref_no`, no `form_fill`, no `local`.

Do **not** add a test per helper (`foldTheDeskFilters`, `matchTheTypedJobNumberContains`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Call-search `$or` / impossible-id empty / 8-digit phone drop, Form `found` / `ambiguous`, booked-from-source 409, admin `database_scope`, or leftover last-200 here. Do not add Zod unknown-key tests in the service file — that gap lives on the schema.

## What I would not do

- A `CallLeadBrowseService` class with `list` / `filter` / `map`.
- Thirty two-line functions that only wrap `fieldContainsClause`.
- Moving this into a CRUD folder, or into `leads/` / `admin/` / `bookings/` “because those also list or find Call Leads.”
- Teaching this file to OR clues, drop short phones, exact-match `job_no`, or return a flat summary array so it can replace `searchCallLeads`.
- Pointing `GET /call-leads` at leftover `findAllCallLeads`, or deleting that leftover so the knowledge table “wins.”
- Merging Form and Call browse into one `kind` switch, or moving receiver-username unwrap into `leadBrowseShared.ts`, in this pass.
- Adding `quoted`, `form_fill`, `normalized_job_no`, historical scope, or `include_duplicates` so the card or admin list “looks complete.”
- Switching contains Job to exact, or empty filters to no rows, so “browse behaves like search.”
- Writing a whole-folder recommendation for `search`.
