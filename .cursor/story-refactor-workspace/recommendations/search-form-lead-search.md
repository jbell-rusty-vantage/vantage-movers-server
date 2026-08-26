# Name The Form Lead Before Updating Quoted — operational story

- Status: recommended
- Service: `search` (Wave A, in-progress)
- Pass: 1 of this service — `formLeadSearch.service.ts`
- Remaining in this service: `formLeadBrowse.service.ts`, `callLeadSearch.service.ts`, `callLeadBrowse.service.ts`
- Target: `src/services/search/formLeadSearch.service.ts`
- Knowledge: `docs/knowledge/services/form-lead-search.md`. Distinct from browse: `docs/knowledge/services/lead-browse.md`. Distinct from Call lookup: `docs/knowledge/services/call-lead-search.md`. Granot fallback after exact ref / Mongo id: `docs/knowledge/services/granot-http-collector.md` (matcher). This checkout’s `CONTEXT.md` does not define Form Lead / Tracking Reference / Duplicate Lead — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `POST /api/v1/form-leads/search` (legacy barrel `formLeadSearch.service.ts`). `granotCrmCsv/sync.service.ts` `resolveFormLead` (phone + email + name, limit 10; ObjectId `ref_no` **skips this file**). `granotHttpCollector/granotFormLeadMatcher.ts` `resolveGranotFormLead` (fallback only; limit 25, duplicates off; then source-gates `matches`). Barrel: `search/index.ts`. Tests: `formLeadSearch.service.test.ts` (duplicate filter on/off). Zod: `v1.validation.test.ts` (`include_duplicates`, loose email). Best Relocation ingest talks HTTP, not this export.
- Seams callers need: the three-way verdict (`found` / `not_found` / `ambiguous`) vs the scored `matches` list the Granot matcher re-picks from; Duplicate Lead quarantine on unless asked
- Split later (only if the file outgrows one sitting): keep one file — naming the Form Lead is one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`searchFormLeads` is executor mechanics. The owner question is: *someone has a tracking ref, a name, an email, or a phone. Which Form Lead is that — one, none, or too many to pick? If two score the same, add another identifier before updating quoted.*

Browse (`GET /form-leads`), Call search, exact Granot `ref_no`, Mongo id, source-gate, and quoted-`prior` tie-break already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a search CRUD service,” and not the extension list:

1. **Name the Form Lead these identifiers point to** — fold tracking ref / name / email / phone. Pull the newest bounded `$or` hits (Duplicate Leads quarantined unless `include_duplicates`). Score in memory. Drop score 0. Unique top score → `found` (the lead, the best match, and every scored match). Empty usable fields, empty `$or`, or no positive score → `not_found`. Top two scores equal → `ambiguous` (`found: false`). Do **not** pick the newest to break a tie. Confidence is a label on the match. It does not decide the verdict.

There is no second write operation. This file never mutates Mongo and never enqueues Sheet Sync.

## Organization

Keep one file. This is the screenplay for “name the Form Lead, or refuse.” Browse filters, Call lookup, Granot exact-ref / Mongo-id / source-gate, and CSV ObjectId skip already live in deeper **modules**. Do not pull those in. Do not invent a `FormLeadSearchService` class. Do not invent a `begin` / `complete` **seam** — this is a read.

Do not split this 297-line file by field. Ref, email, phone, and name are beats of one naming. Do not split `found` / `not_found` / `ambiguous` into three files.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `searchFormLeads` | `nameTheFormLeadTheseIdentifiersPointTo` | public POST, CSV fallback, Granot matcher fallback |
| `FormLeadSearchResult` | `FormLeadIdentityVerdict` | route + CSV read `found` / `not_found` / `ambiguous` |
| `FormLeadSearchMatch` | `ScoredFormLeadCandidate` | matcher reads `matches` and ignores the verdict |
| `FormLeadSearchInput` | `FormLeadIdentityClues` | optional identifiers + `limit` + `include_duplicates` |
| `include_duplicates` (input flag) | keep quarantined Duplicate Leads in the pull | default off; CSV/admin may ask; matcher never does |

Keep the old names as one-line aliases until the v1 route (via the leftover barrel), CSV sync, Granot matcher, and `search/index.ts` migrate. Do not make callers learn `score` / `clamp` / `$or` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the three-way verdict callers already switch on:

```ts
type FormLeadIdentityVerdict =
  | {
      status: "found"
      found: true
      lead: HydratedDocument<FormLeadDocument>
      best_match: ScoredFormLeadCandidate
      matches: ScoredFormLeadCandidate[]
      // searched_fields, criteria, message
    }
  | {
      status: "not_found"
      found: false
      matches: []
    }
  | {
      status: "ambiguous"
      found: false
      matches: ScoredFormLeadCandidate[]
    }
```

That is the handoff from “we scored a pull” to “the extension may update quoted, or must add another identifier.” The Granot matcher does **not** take this verdict. It takes `matches`. Do not collapse those **seams** so “every caller uses `status`.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formLeadSearch.service.ts
// Someone has a tracking ref, a name, an email, or a phone.
// Name the Form Lead those identifiers point to.
// One lead: found. None: not found.
// Two with the same score: ambiguous —
// add another identifier before updating quoted.
// Duplicate Leads stay quarantined unless asked.
// This file does not list the Search workspace.
// This file does not exact-match Granot ref_no or Mongo id.
// This file does not source-gate or break ties with Granot prior.

// ── 1. Name the Form Lead these identifiers point to ──────

export async function nameTheFormLeadTheseIdentifiersPointTo(input)

function foldTheIdentifiers(input)                 // drop "not provided"; lowercase; digits
function refuseWhenNothingUsableRemains(criteria)
function pullTheNewestCandidates(criteria, includeDuplicates, limit)
function scoreEachCandidate(lead, criteria)        // drop score 0
function decideFoundMissOrTie(matches)             // equal top scores → ambiguous; do not pick newest

function confidenceIsInformational(score, fields)  // high / medium / low; does not break ties
```

Read the naming path out loud: *fold the tracking ref, the name, the email, and the phone. Drop “not provided.” If nothing usable remains, say not found. Pull the newest bounded rows that match any folded identifier. Leave Duplicate Leads out unless asked. Score each row. Drop a zero. If the top two scores are equal, say ambiguous — do not pick the newest. If one score stands alone, that is the Form Lead.*

That is the operation. `searchFormLeads` is not a different story. `status: "found"` is not a create.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Zod lets first / last name through; this file never reads them.** `searchFormLeadsSchema` refine treats `first_name` / `last_name` as a usable field. The error text still says “ref_no, name, email, or phone_number.” After fold, name-only first/last → `not_found`. Knowledge already flags the gap. Do not start scoring `first_name` / `last_name` so the refine “wins,” and do not delete those keys from Zod in this rename.

2. **Mongo `limit` runs before scoring.** The newest `limit` `$or` hits are the only scored set. An older exact `ref_no` can lose to newer email/phone hits when both fields are supplied. Knowledge already says so. Rename so the cap is visible (`pullTheNewestCandidates`). Do **not** score the whole collection, or post-filter then limit, as a silent fix.

3. **The Granot matcher ignores this verdict.** `resolveGranotFormLead` calls this only after exact non-duplicate `ref_no` and Mongo `_id` miss, requires phone or email, then runs `selectGranotFormFallback` on `result.matches` (source-gate, then optional quoted-`prior` `0`/`1`/`5`). A `found` here can still become matcher `no_match` / `conflict`. An `ambiguous` here can still become matcher `found` after the gate. Do not teach the matcher to honor `status`, and do not move source-gate / quoted-prior into this file “because both name a Form Lead.”

4. **CSV ObjectId `ref_no` never enters this file.** `resolveFormLead` treats `mongoose.isValidObjectId(ref_no)` as a lead id and returns `status: "no_match"` with a `leadId` and the sentence “Matched by Granot ref_no.” Knowledge says skip search. The status name is the caller’s lie (`no_match` means “not a conflict”). Do not add an ObjectId special-case here so CSV can stop skipping, and do not rename CSV’s status in this pass.

5. **A phone can pull a row and still score 0.** The `$or` has an exact submitted string and, at ≥ 7 digits, a digit-flex regex. Scoring compares digit strings only. Formatted-but-unequal phones drop. Keep both beats. Do not score the regex hit as a phone match so “pull equals score.”

6. **Confidence does not break ties.** `found` vs `ambiguous` is score-tie only. `high` is ref-or-email+phone; `medium` is email-or-phone weight; else `low`. Do not start using confidence as a second sort so “high beats medium” looks like identity.

7. **Name here is the whole folded name.** Anchored `^word\s+word$` after lowercase collapse. Browse contains. Call search is unanchored and does not lowercase. The phone-flex regex is pasted in Call search. Do not silently merge the three name/phone folds, and do not move `escapeRegex` into `leadBrowseShared.ts` “for DRY” in this pass.

8. **`findFormLead` is not this file.** Enrichment lookup 404s Duplicate Leads by id. This file can return a Duplicate Lead only when `include_duplicates` is on. `getLinkedLead` returns Duplicate Leads without asking. Do not silently merge “lead lookup” into one filter.

9. **Leave sibling modules alone.** `browseFormLeads`, `searchCallLeads`, `resolveGranotFormLead`, `selectGranotFormFallback`, and CSV `resolveFormLead` stay where they are. This file orchestrates fold → pull → score → verdict.

10. **Do not treat browse or Call search as this story.** Empty browse lists the newest leads. Call search returns a newest-first summary array with no `ambiguous`. Wave A will recommend those modules next. Do not write a whole-folder search recommendation.

## Testing

The **interface** is the test surface: `nameTheFormLeadTheseIdentifiersPointTo` (today `searchFormLeads`). The verdict and the `matches` list are both part of that **interface**.

Today’s `formLeadSearch.service.test.ts` only stubs `FormLead.find` and locks duplicate exclude vs `include_duplicates: true`. Zod tests lock loose email and the flag on the schema. That is the quarantine **seam**, not the naming story. Fill the gaps the story names make obvious:

**Name the Form Lead these identifiers point to**
- Unique top score → `found`, `found: true`, `lead` is `best_match.lead`, `matches` includes the rest.
- Two different leads with the same score → `ambiguous`, `found: false`, do **not** pick newest `createdAt`.
- No usable fields after fold (`"not provided"` ref only, or first/last only if the caller bypassed Zod) → `not_found` and the “No usable form lead search fields” sentence.
- Pull returns rows that all score 0 → `not_found` and the “No form lead matched the supplied …” sentence.
- Default pull adds `{ duplicate: { $ne: true } }` (already locked). `include_duplicates: true` omits that clause (already locked).
- Phone with fewer than 7 digits still adds the exact-string clause; scoring still uses whatever digits exist.
- Newest-`limit` cap is the scored set: an older exact `ref_no` outside the cap is not a candidate. Prove today’s order. Do not “fix” it in the test.

**Confidence (on the match, not the verdict)**
- Matched `ref_no` or score ≥ 75 → `high`.
- Score ≥ 35 or ≥ 40 without that → `medium`.
- Name-only (15) → `low`.
- Two `high` matches with the same score are still `ambiguous`.

Do **not** add a test per helper (`foldTheIdentifiers`, `confidenceIsInformational`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Granot exact-ref / Mongo-id / source-gate / quoted-prior here. Those are `granotFormLeadMatcher.ts`. Do not re-test CSV ObjectId skip. Do not add Zod first-name tests in this file — that gap lives on the schema.

## What I would not do

- A `FormLeadSearchService` class with `search` / `find` / `score`.
- Thirty two-line functions that only wrap `FIELD_WEIGHTS`.
- Moving this into a CRUD folder, or into `leads/` / `granotHttpCollector/` / `granotCrmCsv/` “because those callers name Form Leads.”
- Teaching this file to exact-match ObjectId `ref_no`, source-gate, or break ties with Granot `prior` so the matcher can delete its first two steps.
- Honoring `first_name` / `last_name`, or scoring the whole collection, so Zod or “the best ref should win” looks true.
- Using confidence to break a score tie, or picking newest on `ambiguous`.
- Merging browse contains-name or Call unanchored-name into this fold.
- Loosening score-tie `ambiguous` for quoted / extension updates without owner sign-off.
- Writing a whole-folder recommendation for `search`.
