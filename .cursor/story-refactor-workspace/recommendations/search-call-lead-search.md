# Look Up The Newest Call Leads Any Clue Matches — operational story

- Status: recommended
- Service: `search` (Wave A, in-progress)
- Pass: 3 of this service — `callLeadSearch.service.ts`
- Remaining in this service: `callLeadBrowse.service.ts`
- Target: `src/services/search/callLeadSearch.service.ts`
- Knowledge: `docs/knowledge/services/call-lead-search.md`. Distinct from scored Form naming: `docs/knowledge/services/form-lead-search.md`. Distinct from the Search desk: `docs/knowledge/services/lead-browse.md`. Distinct from Call writes: `docs/knowledge/services/call-lead.md`. Distinct from Book-This-Lead find: `docs/knowledge/services/bookings.md` (from-source). This checkout’s `CONTEXT.md` does not define Call Lead / Job Number / Duplicate Lead / Caller Match Key — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `POST /api/v1/call-leads/search` (legacy barrel `callLeadSearch.service.ts`). `bestRelocationSheetIngest/apply.ts` `findExistingEntity` for `create_call_lead` (HTTP; phone and/or job, limit 25; then exact job or phone+timestamp pick). Barrel: `search/index.ts`. `summarizeCallLead` has no other import site. Tests: none (`callLeadSearch.service.test.ts` missing). Zod: `searchCallLeadsSchema` is **not** covered in `v1.validation.test.ts` (knowledge says it is). Enrichment, booked-from-source, employee candidates, and Call browse do **not** import this file.
- Seams callers need: the flat newest-first summary array vs Form search’s three-way verdict; empty usable clues → guaranteed empty list, not view-all
- Split later (only if the file outgrows one sitting): keep one file — looking up Call Leads by any clue is one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`searchCallLeads` is executor mechanics. The owner question is: *someone has a phone, a job number, an email, or a name. Which newest Call Leads does any of those touch? If two clues match two different rows, both come back. This is not naming one lead before a write.*

Scored Form naming (`POST /form-leads/search`), Call browse, booked-from-source Job/phone find, enrichment, and RingCentral ingest already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a search CRUD service,” and not the Form-style naming:

1. **Look up the newest Call Leads any clue matches** — fold phone / job number / email / name. Drop a phone that `normalizePhoneNumberForMatch` refuses (fewer than 8 digits). If nothing usable remains, return `[]` via `{ _id: { $exists: false } }`. One usable clue → that clause. Two or more → `$or` (a Call Lead that matches **any** clue is in). Pull the newest bounded rows. Map each to a search summary. Duplicate Call Leads stay in. Booking and cancellation stay raw refs. This file never mutates Mongo and never enqueues Sheet Sync.

There is no second write operation. There is no `found` / `not_found` / `ambiguous` verdict. Confidence is not a concept here.

## Organization

Keep one file. This is the screenplay for “look up Call Leads by any clue.” Browse filters, Form naming, booked-from-source find, and Best Relocation’s post-HTTP pick already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadSearchService` class. Do not invent a `begin` / `complete` **seam** — this is a read. Do not invent a Form-shaped verdict **seam** that has only one real adapter.

Do not split this 118-line file by field. Phone, job number, email, and name are beats of one lookup. Do not split “one clause” vs `$or` into two files.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `searchCallLeads` | `lookUpTheNewestCallLeadsAnyClueMatches` | public POST + Best Relocation HTTP existence check |
| `CallLeadSearchSummary` | `LookedUpCallLeadSummary` | route + ingest read the flat card (`job_no`, phones, raw `booked` / `cancelled`) |
| `summarizeCallLead` | `summarizeTheLookedUpCallLead` | mapper; only this file and leftover barrels import it today |

Keep the old names as one-line aliases until the v1 route (via the leftover barrel), Best Relocation HTTP, and `search/index.ts` migrate. Do not make callers learn `$or` / `$exists: false` / digit-flex as the domain language.

**No class for the workflow.** The type that *does* earn a name is the flat list callers already consume — not a three-way status:

```ts
type LookedUpCallLeadSummary = {
  _id: string
  // identity + job_no + phones + lane + booked/cancelled raw refs
}

type LookedUpCallLeadPage = LookedUpCallLeadSummary[]
```

That is the handoff from “we ORed the clues” to “here are the newest summaries.” Best Relocation then re-picks by exact `job_no` or phone digits + timestamp. Do **not** collapse that into `status: "found"` so “every search looks like Form search.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadSearch.service.ts
// Someone has a phone, a job number, an email, or a name.
// Look up the newest Call Leads any of those clues touch.
// One clue: that clause. Several: any of them.
// Nothing usable: no rows.
// Duplicate Call Leads stay in.
// This file does not name one lead.
// This file does not list the Search workspace desk.
// This file does not book from source or create an unmatched stub.

// ── 1. Look up the newest Call Leads any clue matches ─────

export async function lookUpTheNewestCallLeadsAnyClueMatches(input)

function foldTheClues(input)                       // trim; lowercase email; collapse name spaces
function dropAPhoneTooShortToMatch(phone)          // normalizePhoneNumberForMatch; < 8 digits gone
function refuseWhenNothingUsableRemains(clues)     // { _id: { $exists: false } } → []
function matchAnyFoldedClue(clues)                 // 1 clause bare; else $or
function matchTheNormalizedPhoneOrTheTypedDigits(phone)
function matchTheTypedJobNumberExactly(jobNo)      // job_no only — not normalized_job_no
function matchTheLowercasedEmailExactly(email)
function matchTheNameAsAnUnanchoredWordSequence(name)

async function pullTheNewestRows(filter, limit)    // createdAt desc; 1–25, default 10
export function summarizeTheLookedUpCallLead(lead) // raw booked/cancelled ids
```

Read the lookup path out loud: *fold the phone, the job number, the email, and the name. If the phone has fewer than eight digits after fold, drop it. If nothing usable remains, return no rows. If more than one clue remains, a Call Lead that matches any of them is in. Pull the newest bounded rows. Map each to a summary. Duplicate Call Leads stay in. Booking and cancellation stay raw ids.*

That is the operation. `searchCallLeads` is not a different story. `[]` is not `not_found`. Two rows are not `ambiguous`.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Zod lets first / last name through; this file never reads them.** `searchCallLeadsSchema` refine treats `first_name` / `last_name` as a usable field. The error text still says “phone_number, job_no, email, or name.” First/last-only → empty clauses → `{ _id: { $exists: false } }` → `[]`. Knowledge already flags the gap. Do not start matching `first_name` / `last_name` so the refine “wins,” and do not delete those keys from Zod in this rename.

2. **A short phone is not a clue.** `normalizePhoneNumberForMatch` returns undefined under 8 digits, so the phone clause never lands. Form naming still adds a digit-flex regex at ≥ 7 digits and scores whatever digits exist. Do not import Form’s 7-digit gate so “phone means phone,” and do not add the exact submitted string as a fallback so a 7-digit typed phone starts hitting.

3. **Job Number here is the typed `job_no`.** Exact trim. Not `normalized_job_no`. `P5562366` does not find `5562366`. Booked-from-source Job find is the same exact `job_no` (then 409 if two share it). Identity / Granot use digit-core equivalence. Three “same Job” meanings already sit on CONTRADICTIONS. Do not add `normalized_job_no` or `jobNumbersEquivalent` here so “search finds the Job.”

4. **Email is exact lowercase. Browse contains.** `email: "a@b.com"` here misses `A@B.com` only if storage was not lowercased — the query itself is exact equality on the folded string. Browse `fieldContainsClause`s. Do not switch this to contains so “search and browse match.”

5. **Name here is an unanchored word sequence.** Trim + collapse spaces; **not** lowercased before the regex (`/i` does the case work). Pattern is `word\s+word`, not `^…$`. Form naming lowercases then anchors the whole folded name. Browse contains on `name` / `first_name` / `last_name`. Do not silently merge the three folds, and do not move `escapeRegex` into `leadBrowseShared.ts` “for DRY” in this pass.

6. **OR is the product.** Phone + job returns a Call Lead that matches **either**. Browse ANDs every supplied filter. Form naming ORs the pull, then scores. Switching this `$or` to `$and` would shrink extension hits. Knowledge already says so. Rename so the any-clue beat is visible (`matchAnyFoldedClue`). Do not AND “because booking find requires both.”

7. **Empty usable clues are an impossible id, not view-all.** `{ _id: { $exists: false } }` is the miss **seam**. Browse empty `{}` lists newest. Schema already requires a field, but first/last-only still reaches this miss. Do not return `find({})` so “empty search lists the desk.”

8. **There is no score and no verdict.** Newest `createdAt` is the only order. Two equal clues on two leads both appear. Best Relocation’s HTTP client then re-picks by exact `job_no` or phone digits + timestamp — and also accepts a Form-shaped `{ matches, lead }` this file never returns. Do not teach this file `found` / `ambiguous` so ingest can drop its picker, and do not make ingest honor a verdict that does not exist.

9. **Duplicate Call Leads stay in.** No `include_duplicates` flag. Form naming quarantines unless asked. Enrichment `findFormLead` 404s Duplicate Form Leads. Do not add `{ duplicate: { $ne: true } }` so “search matches Form,” and do not add the flag in this rename.

10. **`summarizeCallLead` is not a second operation.** Booking / cancellation stay raw ids (not populated chips). Call browse pins chips. Do not populate here so “the summary looks like the desk card,” and do not delete the export because only barrels re-export it.

11. **Book-This-Lead is not this file.** `resolveBookingSourceLead` finds exact `job_no` (409 on multiples), then `findBestCallLeadMatchByPhone`, then may **write** phone/job or create an unmatched stub. This file is read-only and never 409s. Do not route from-source through this lookup.

12. **Leave sibling modules alone.** `browseCallLeads`, `searchFormLeads`, `findBestCallLeadMatchByPhone`, and BR `findExistingEntity` stay where they are. This file orchestrates fold → any-clue filter → newest pull → summarize. The phone-flex regex is pasted in Form search, employee candidates, and booked-call-lead reconciliation. Do not extract a shared helper in this pass.

13. **Knowledge says schema tests live in `v1.validation.test.ts`.** Disk has Form-search schema tests and `browseCallLeadsQuerySchema` tests. It does not import `searchCallLeadsSchema`. Do not add those Zod tests as a silent docs fix in this rename — that gap lives on the schema file.

## Testing

The **interface** is the test surface: `lookUpTheNewestCallLeadsAnyClueMatches` (today `searchCallLeads`). The flat summary array is the **interface**. `summarizeTheLookedUpCallLead` is only a second **adapter** if a caller starts importing it; today it is the mapper inside the parent.

There is no `callLeadSearch.service.test.ts`. Knowledge’s “schema tests live in `v1.validation.test.ts`” is stale. Fill the gaps the story names make obvious:

**Look up the newest Call Leads any clue matches**
- Unique phone (8+ digits after fold) → `find` with `{ $or: [ { normalized_phone_number }, { phone_number: digit-flex } ] }`, `sort({ createdAt: -1 })`, `limit` 10.
- Phone with fewer than 8 digits and no other usable clue → `{ _id: { $exists: false } }` → `[]`.
- `job_no: "P5562366"` is exact `{ job_no: "P5562366" }` — not `normalized_job_no`, not digit-core.
- `email` is exact lowercased equality.
- `name: "Jane Doe"` is unanchored `Jane\\s+Doe` / `i`, not `^Jane\\s+Doe$`.
- Phone + job → `{ $or: [phoneClause, jobClause] }`. A row that matches only the phone is in. Prove today’s OR. Do not “fix” it into AND.
- First/last only (caller bypassed the intended refine) → empty list via the impossible-id filter.
- Default `limit` 10; `limit` 25 stays 25; `limit` above 25 clamps to 25; `limit` 0 or missing non-finite clamps to 10.
- A Duplicate Call Lead is in the array when it matches. No default `{ duplicate: { $ne: true } }`.
- Each summary has `_id` as a string, `job_no`, both phone fields, and raw `booked` / `cancelled` (not populated chips). No `quoted`. Delivery zip is `delivery_zip`.

Do **not** add a test per helper (`foldTheClues`, `matchTheTypedJobNumberExactly`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Form `found` / `ambiguous`, Call browse `count` / chips, booked-from-source 409, or Best Relocation’s timestamp pick here. Do not add Zod first-name tests in this file — that gap lives on the schema.

## What I would not do

- A `CallLeadSearchService` class with `search` / `find` / `summarize`.
- Thirty two-line functions that only wrap `normalizeValue`.
- Moving this into a CRUD folder, or into `leads/` / `bookings/` / `bestRelocationSheetIngest/` “because those also find Call Leads.”
- Teaching this file `found` / `not_found` / `ambiguous`, `include_duplicates`, or populated chips so it can replace Form naming or Call browse.
- Routing booked-from-source or employee candidates through this lookup, or adding `normalized_job_no` so prefix twins match.
- Switching `$or` to `$and`, or empty clues to view-all, so “search behaves like browse.”
- Honoring `first_name` / `last_name`, or accepting 7-digit phones, so Zod or Form’s gate “wins.”
- Extracting the pasted phone-flex regex into `leadBrowseShared.ts` in this pass.
- Writing a whole-folder recommendation for `search`.
