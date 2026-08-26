# Duplicate Form Lead and Form Fill — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 3 of this service — `duplicateLead.service.ts`
- Remaining in this service: `leadIngestionProvenance.ts`, `leadSourceCompany.ts`, `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/duplicateLead.service.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (Duplicate Lead + Form Fill steps), `docs/knowledge/services/call-lead.md` (Form Fill linkage). No dedicated Service file for this module.
- Callers: `formLead.service.ts`, `callLead.service.ts`, `employeeBookings/bookingLeadAttachment.service.ts`, `bookings/bookingSourceResolver.ts`, `leads/index.ts`
- Seams callers need: richer classification (match basis + IDs) vs boolean; Form Fill detect (read) vs Form Fill mark (write + returned Sheet Sync jobs, optional session)
- Split later (only if the file outgrows one sitting): `classifyDuplicateFormLead.ts`, `linkFormFill.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Two operations that share a phone sieve, not “a duplicate helper”:

1. **Duplicate Form Lead classification** — a new quote is compared to earlier live Form Leads at the same exact Source Granularity, in the same cohort. The answer is yes/no plus *how* (email, phone, or both) and *which* leads, so the owner event can say why this one is a Duplicate Lead.
2. **Form Fill linkage** — Call and Form are tied by the same source + phone. When a Call Lead is saved, ask whether that caller already submitted a live Form Lead. When a live Form Lead is saved, mark matching Call Leads as Form Fill and hand the caller Sheet Sync jobs so those Call rows ride the Form Lead write.

The file name is the lie. Half the exports never classify a Duplicate Lead. Form Fill is attribution only; it does not set `duplicate` on a Call Lead. RingCentral’s 90-day Call duplicate guard is a different story and does not live here.

`isDuplicateFormLead` is not a third operation. It is a boolean wrapper over classification, used by the unit test and the barrel.

## Organization

Keep one file. This is the screenplay for “have we seen this customer before, and did they already fill the form?” Phone regex, Form/Call models, and Sheet Sync job shape already live in deeper **modules**. Do not pull `leadPhoneMatching.findBestCallLeadMatchByPhone` or the RingCentral duplicate guard in. Do not invent a `DuplicateLeadService` class.

If it later outgrows one sitting, split by **story** (classify vs Form Fill), not by collection.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `findDuplicateFormLeadMatch` | `classifyDuplicateFormLead` | Form Lead ingest and employee-booking attach need match basis + IDs, not a boolean |
| `isDuplicateFormLead` | `formLeadLooksLikeADuplicate` | leftover boolean adapter; tests and `leads/index.ts` still import it |
| `hasFormFillForCallLead` | `detectFormFillForCallLead` | Call Lead ingest, unmatched booking create, and reconciliation attach are read-only |
| `markMatchingCallLeadsWithFormFill` | `markMatchingCallLeadsAsFormFill` | Form Lead ingest must persist Call writes + `call_lead.form_fill.update` jobs in the same session |

Keep the old names as one-line aliases until Form Lead ingest, Call Lead ingest, booking source resolve, and employee-booking attach migrate. Do not make callers learn `Match` as the domain language.

**No class for the workflow.** The types that *do* earn names are the two scopes. They are the **seam**, not leftovers:

```ts
type CompanySourceScope = { /* today's LeadSourceMatchScope — Form Fill */ }
type ExactGranularityScope = { /* today's ExactGranularityMatchScope — Duplicate Form Lead */ }
type DuplicateFormLeadClassification = { /* today's DuplicateFormLeadMatch */ }
```

Company scope is “same Source Company, optionally the Registry company id.” Exact granularity is “same `source_granularity_id` or refuse.” Form Fill and Duplicate Lead are allowed to disagree on that depth. Do not collapse them.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// duplicateLead.service.ts
// When a quote lands: have we already taken this customer at this granularity?
// If the quote is new: mark matching Call Leads as Form Fill.
// When a call lands: did this caller already fill the form?

// ── 1. Duplicate Form Lead classification ─────────────────

export async function classifyDuplicateFormLead(scope, phone, email, when)
export async function formLeadLooksLikeADuplicate(scope, phone, email, when) // alias

function refuseWithoutExactGranularity(scope)
function normalizeTheIdentifiers(phone, email)
function noIdentifierMeansNotADuplicate()
function pickTheCohortWindow(when)          // pre-cutoff: { $lt: when }; on/after: [cutoff, when)
async function findEarlierLiveFormLeads(scope, identifiers, window)
function verifyEachCandidateInMemory(lead, identifiers)  // regex is a sieve
function sayHowTheyMatched(emailHit, phoneHit)           // email | phone | both
function listTheMatchedLeadIds(leads)

// ── 2. Form Fill linkage ──────────────────────────────────

export async function detectFormFillForCallLead(scope, phone)
export async function markMatchingCallLeadsAsFormFill(scope, phone, formLeadId, session?)

function noUsablePhoneMeansNoFormFill()
function matchAtCompanyScope(scope)         // lead_source_company OR source_company
async function findLiveFormLeadsWithThisPhone(scope, phone)
function anyVerifiedPhoneMatch(candidates, phone)

async function findCallLeadsNotYetMarkedFormFill(scope, phone, session)
function verifyTheCallPhoneInMemory(lead, phone)
async function flipFormFillAndQueueASheetJob(callLead, session)
function rememberWhoWeMarked(formLeadId, source, phone, count)
```

Read the Form Lead path out loud: *refuse without an exact Source Granularity, normalize phone and email, skip if neither identifier is usable, pick the cohort window around 30 April 2026, find earlier live Form Leads, verify each candidate in memory, say how they matched. If this quote is not a Duplicate Lead, find Call Leads at company scope that share the phone and are not yet Form Fill, verify the phone again, flip them, and hand back Sheet Sync jobs for the Form Lead write.*

That is the operation. `isDuplicateFormLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file name hides Form Fill.** Callers already import `hasFormFillForCallLead` and `markMatchingCallLeadsWithFormFill` from `duplicateLead.service`. A later split is classify vs Form Fill, not “more duplicate helpers.”

2. **`isDuplicateFormLead` is a pass-through.** Form Lead ingest already calls `findDuplicateFormLeadMatch`. Keep the boolean as an alias. Point the test at `classifyDuplicateFormLead`.

3. **Comments still say “same source company.”** Classification requires exact `source_granularity_id` and throws without it. The unit test named “does not fall back from exact granularity to company” already locks that. Rename the JSDoc and the `isDuplicateFormLead` first argument (`sourceCompany` → `scope`) so the comment cannot drag the rule backward.

4. **Two scopes are a decision, not a mess.** Duplicate Form Lead is exact granularity + cohort. Form Fill is company (`lead_source_company` OR `source_company`) with no cutoff and no email. Do not “fix” Form Fill up to granularity, and do not loosen classification down to company. Name both scopes so the difference stays visible.

5. **Phone matching is a sieve plus a verify.** `buildPhoneRegex` is already the right **depth** (`leadPhoneMatching.ts`). Both operations re-verify with `normalizePhoneNumberForMatch`. Do not replace that with `findBestCallLeadMatchByPhone` (that sibling prefers unbooked Call Leads for booking attach). Do not silently drop the in-memory verify.

6. **Form Fill detect caps at 25 newest Form Leads.** An older exact phone match outside that window is invisible. Rename the beat (`findLiveFormLeadsWithThisPhone`) so the cap is visible. Do not raise it in this pass.

7. **`markMatchingCallLeadsWithFormFill` logs even when it marked nobody.** The name `rememberWhoWeMarked` makes a zero-count info log look odd. Leave the log; do not invent a second event here — Form Lead ingest already emits `lead.form.call_leads_marked_form_fill`.

8. **Leave sibling modules and other duplicate stories alone.** `classifyRingCentralCallLeadDuplicate`, Granot identity’s Duplicate Form ineligibility, and historical consolidation’s 2026-04-30 Master-sheet rule are not this file. Do not move `FORM_DUPLICATE_CUTOFF` into config “for cleanliness.” The constant is the cohort **seam**.

## Testing

The **interface** is the test surface: `classifyDuplicateFormLead`, `detectFormFillForCallLead`, `markMatchingCallLeadsAsFormFill`.

Today’s `duplicateLead.service.test.ts` only stubs `FormLead.find` through `isDuplicateFormLead`. That covers email/phone verify, no-identifier skip, and “no company fallback.” It never exercises Form Fill, the cutoff window, the throw, or the mark/session path.

Replace the stub style with tests that name the operation:

**Classify Duplicate Form Lead**
- Missing `sourceGranularityId` → throws (exact granularity required).
- No usable phone or email → not a Duplicate Lead, and Mongo is not queried.
- Same exact granularity + earlier live Form Lead + matching email (trimmed/lowercased) → Duplicate Lead, `matchedBy: "email"`, IDs listed.
- Same for phone after in-memory verify; a regex candidate whose normalized phone differs is not a match.
- Email **and** phone → `matchedBy: "both"`.
- Timestamp before `2026-04-30T04:00:00.000Z` looks only `{ $lt: when }`; on or after looks `{ $gte: cutoff, $lt: when }`. A modern quote does not match a pre-cutoff live Form Lead.
- An already-`duplicate` Form Lead is not a match (`duplicate: { $ne: true }`).

**Detect Form Fill**
- Missing/unparseable phone → false, no query.
- A live Form Lead at company scope with the same verified phone → true.
- A Duplicate Form Lead does not count.
- Scope with `leadSourceCompany` uses `$or` on Registry id **or** `source_company`.

**Mark Form Fill**
- Matching Call Leads not yet Form Fill are flipped; each returns a `call_lead.form_fill.update` job.
- Already-`form_fill` Call Leads are left alone.
- Unparseable phone → `[]`.
- When a session is passed, the Call writes use it (Form Lead ingest / employee-booking attach need this).
- Duplicate Form Lead callers are the **caller’s** job (`formLead.service` skips the mark). Do not hide that skip inside this module.

Do **not** add a test per helper (`pickTheCohortWindow`, `matchAtCompanyScope`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`formLeadLooksLikeADuplicate` may stay exported as an alias. It is not a second test surface.

## What I would not do

- A `DuplicateLeadService` class with `isDuplicate` / `hasFormFill` / `mark`.
- Thirty two-line functions that only wrap `FormLead.find`.
- Moving this into a CRUD folder, or a `duplicates/` folder that also swallows RingCentral and Granot identity.
- Treating RingCentral Call duplicate classification as this story.
- Collapsing company-scope Form Fill and exact-granularity Duplicate Lead into one filter “for consistency.”
- Silently widening the 25-row Form Fill cap, moving the 30 April 2026 cutoff, or dropping the in-memory phone verify.
- Breaking the mark **seam**: Form Fill Call writes and their Sheet Sync jobs must stay available to the caller’s transaction. Do not finalize sheets here.
