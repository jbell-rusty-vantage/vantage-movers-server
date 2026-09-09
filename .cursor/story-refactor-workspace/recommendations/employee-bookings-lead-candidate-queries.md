# Assemble The Auto-Match Candidate Set — Six Operational Lookups, Merge By Lead, Never Prove Uniqueness From A Truncated Page — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 2 of this service — `leadCandidateQueries.ts`
- Remaining in this service: `leadMatchEvaluator.ts`, `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/leadCandidateQueries.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (auto-match candidate query stays Job / operational phone and does not search Granot snapshot paths; overflow is `multiple_matches` and never auto-links; Owner search is a different any-known-contact query). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `submitEmployeeBooking.service.ts` (initial match), `reconciliationRematch.service.ts` (delayed retry), `bookingLeadReconciliation.service.ts` (`refreshBookingLeadCandidates`, `updatePendingEmployeeBooking`, `reopenBookingLeadReconciliation` — same query; `searchBookingLeadCandidates` only imports `leadContactSnapshotsFromDoc`). Tests: `leadCandidateQueries.test.ts` (overflow + snapshot). Barrel does not re-export this file.
- Seams callers need: the assembled set plus `hasOverflow` for the matcher; optional Mongo session so the six finds share the caller’s write; Owner display snapshots without using this finder
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Do not split into `query.ts` / `merge.ts` / `snapshot.ts`. Prepare, score, attach, and Owner any-known-contact search live in siblings.

`queryEmployeeBookingCandidates` is executor mechanics. The owner question is: *The employee typed a Job Number, a phone, and maybe a LID, email, and name. Which Form Leads and Call Leads could be that Job? If any lookup found more than we can keep, say so — never let the matcher treat a truncated page as unique. Card each hit with how we found it, whether it can be claimed, whether the Source fits, and the contact the owner should see. Do not search Granot snapshot paths. Do not pick the winner.*

## What this file actually does

Two operations of one “assemble the auto-match set” story, not “a Mongo find helper,” and not the five scoring rules:

1. **Assemble the auto-match candidate set** — six operational lookups in parallel (Form LID, Call Job Number, Form phone, Call phone, Form email when typed, Form name when email *and* name are typed). Merge by `(FormLead|CallLead, id)`. Remember every method that hit. Fetch 26 to keep 25. If any lookup overflowed, stamp `hasOverflow` so the matcher must refuse uniqueness.
2. **Copy the Lead contact the owner should see** — sanitize stored `ingested_contact_snapshot` and `granot_contact_snapshot` onto the card (and onto Owner search rows). Automatic submit match still does **not** query those Granot / ingested paths. Display is not search.

Finding the winner (`evaluateEmployeeBookingMatch`), claiming the Lead, opening the Owner case, and Owner any-known-contact search (`searchCandidates` inside `bookingLeadReconciliation.service.ts`) are other files. This file never writes a Booking, never claims, never POSTs Granot, and never drains Sheet Sync.

## Organization

Keep one file. This is the screenplay for “which Leads could be this employee Job.” Prepare, source-fit score, the five auto-match rules, claim, rematch, and Owner typed search already live in deeper **modules**. Do not pull those in. Do not invent an `EmployeeBookingCandidateService` class. Do not invent a begin / complete Domain Command **seam** — this file is a read the write already started.

If it later outgrows one sitting, the split is still this operational finder vs Owner typed search, never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `queryEmployeeBookingCandidates` | `assembleTheAutoMatchCandidateSet` | submit, rematch, owner refresh, update-pending, reopen — same operational keys + overflow |
| `leadContactSnapshotsFromDoc` | `copyTheLeadContactTheOwnerShouldSee` | Owner any-known-contact search is a different query and still needs this display card |
| `toPublicLeadContactSnapshot` | `sanitizeOneStoredContactSnapshot` | one stored blob → owner card; only the copy helper uses it today |
| `PublicLeadContactSnapshot` | `OwnerLeadContactCard` | name / phone / email / `differs_from_ingested` / `captured_at` |

Keep the old names as one-line aliases until submit, rematch, and Owner reconciliation migrate. Do not make callers learn `query` / `Candidates` as the domain language. Do not export `runQuery`, `addCandidates`, `confidenceFor`, `classifyEligibility`, `buildCandidateWarnings`, or `buildPhoneRegex`.

**No class for the workflow.** The one type that earns a name is the handoff the matcher already requires:

```ts
type AutoMatchCandidateSet = {
  candidates: EvaluatedLeadCandidate[]
  hasOverflow: boolean  // any lookup returned a 26th row — uniqueness is unproven
}
```

That is today’s `EmployeeBookingCandidateQueryResult`. Leave it on sibling `types.ts`. Do not move `EvaluatedLeadCandidate` or `PreparedEmployeeBookingSubmission` here.

`OwnerLeadContactCard` can stay exported from this file — Owner search already depends on the shape, not on the six finds.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadCandidateQueries.ts
// The employee typed a Job Number, a phone, and maybe a LID, email, and name.
// Look for Form Leads and Call Leads on those operational keys.
// Merge hits into one card per Lead.
// If any lookup found a 26th row, say uniqueness is unproven.
// Do not search Granot snapshot paths.
// Do not pick the winner. That is the matcher.

const KEEP = 25
const FETCH_TO_DETECT_OVERFLOW = KEEP + 1

// ── 1. Assemble the auto-match candidate set ──────────────

export async function assembleTheAutoMatchCandidateSet(prepared, session?)
  // six finds in parallel; optional session shares the caller’s write
  // LID / email / name lookups skip when that stamp is missing
  // name lookup also skips unless email was typed (today’s only name rule needs email)

async function findFormLeadsByLid(lid, session)
async function findCallLeadsByExactJobStamp(normalizedJobNo, session)
  // exact `normalized_job_no` — not the Granot prefix-aware Job filter
async function findFormLeadsByOperationalPhone(phone, session)
async function findCallLeadsByOperationalPhone(phone, session)
  // normalized_phone_number OR digit-fuzzy regex on raw phone_number
async function findFormLeadsByTypedEmail(email, session)
  // exact `email` field, only when normalizedEmail is present
async function findFormLeadsByTypedNameWhenEmailIsAlsoPresent(name, session)
  // `normalized_contact_name`; dropped later if booking-identity fold disagrees

function uniquenessIsUnproven(pages)
  // any page length > KEEP → hasOverflow

function mergeHitsIntoOneCardPerLead(pages, prepared)
  // key = FormLead|CallLead + id
  // accumulate match methods; recompute confidence from the set
  // name-method first insert may drop the row when comparison names disagree
  // name-method on an already-merged card still appends the method (no drop)

function cardThisLead(doc, model, method, prepared)
  async? no — classifyEligibility, scoreHowThisLeadFitsTheBookingSource (sibling),
  warnings, snapshot + copyTheLeadContactTheOwnerShouldSee

function confidenceFromTheMethodsThatHit(methods)
  // lid or job_no → high
  // phone plus email or name → high
  // phone or email alone → medium
  // name alone → low

function whetherThisLeadCanBeClaimed(doc)
  // cancelled > booked > Duplicate Lead > eligible

function warnTheOwnerAboutThisCard(doc, model, sourceFit, prepared)
  // duplicate / booked / cancelled / created_on_unmatched
  // channel_conflict (form booking vs Call, or call booking vs Form)
  // source_conflict / source_unassigned / same_company_legacy (not exact_granularity)
  // name_contradiction on Form when both folds exist and disagree

function phoneDigitsMayAppearInThisRawNumber(normalizedPhone)
  // /(?:^|\D)2\D*1\D*2…(?:\D|$)/

// ── 2. Copy the Lead contact the owner should see ─────────

export function copyTheLeadContactTheOwnerShouldSee(doc)
export function sanitizeOneStoredContactSnapshot(value)
  // empty name+phone+email → omit the blob; Date captured_at → ISO
```

Read the path out loud: *Look up Form LID, Call Job Number, Form phone, Call phone, Form email, and Form name (when email was also typed). If any of those pages has a 26th row, uniqueness is unproven. Merge the kept rows into one card per Lead. Stamp how we found it, whether it can be claimed, how the Source fits, and the contact the owner should see. Hand the set to the matcher. Do not search Granot snapshot paths. Do not pick the winner.*

That is the operation. `queryEmployeeBookingCandidates` is not.

Submit, rematch, owner refresh, update-pending, and reopen all say the same next sentence: `evaluateEmployeeBookingMatch(prepared, candidates, hasOverflow)`. Overflow becomes `pending` / `multiple_matches` before any positive rule. This file does not write that reason.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Any overflow kills every rule, including LID.** `hasOverflow` is `some(page.length > 25)`. The matcher returns `multiple_matches` *before* `form_lid_exact`. Twenty-six Form Leads sharing a phone (or a name, when email was typed) will refuse a unique LID sitting in another page. Knowledge already says overflow never auto-links. Rename so that is visible. Do not change overflow to “only the winning rule’s query” so LID can still link, or drop `hasOverflow` “because we merged to 25.”

2. **The 26th row is discarded and still counts.** The eligible Lead can be index 25 (0-based) and never appear on the case. Tests already lock this: 25 duplicates kept, the 26th eligible dropped, `hasOverflow: true`. Do not keep the 26th “so the owner sees the live one,” or treat `candidates.length === 25` as overflow without fetching 26.

3. **Name lookup is gated on email.** `formByName` runs only when `normalizedEmail && normalizedLeadName`. Today’s only name-using rule (`form_contact_triple_exact`) also requires email, so the gate matches the matcher. The code does not say that. Do not ungate so “every typed name is searched” — a popular name can overflow and block LID. Do not move the email gate into the matcher so “query always searches name.”

4. **Name drop only applies to a first insert via name.** A Form Lead whose `normalizeComparisonName(doc.name)` disagrees with the typed name is skipped when name is the first method. If phone (or LID) already merged the card, `normalized_name` is appended with no drop. `name_contradiction` is stamped on first insert, not on the append. Do not “fix” the append so methods stay honest in this pass, or drop the post-filter so `normalized_contact_name` is the only fold.

5. **Two name folds.** The find uses `normalized_contact_name`. The drop and the warning use `normalizeComparisonName(doc.name)` from `bookingIdentity`. A Lead can be found, then dropped, or found and warned, depending on which fold was stored. Leave `bookingIdentity` alone. Do not import Granot identity so “every name is one fold.”

6. **Call Job find is the exact stamp.** `CallLead.find({ normalized_job_no: submission.normalizedJobNo })`. A Call stored as `P5562366` will not auto-match a submit of `5562366`. The `bookings-booking-identity` recommendation already flagged this. Do not import the Granot prefix-aware filter so “every Job lookup agrees.”

7. **Email find is the raw `email` field.** Not `normalized_email`. Phone uses both `normalized_phone_number` and a digit-fuzzy regex on raw `phone_number`. Do not add Granot / ingested contact paths so “submit matches Owner search.” Knowledge forbids that on this finder.

8. **Confidence is not the matcher.** `lid` / `job_no` → high; phone plus email or name → high; phone or email → medium; name → low. The matcher does not read `confidence` for the five rules — it reads methods, eligibility, source fit, and overflow. Confidence is stored on the case card. Do not delete it so “only the matcher scores,” or make the matcher key on `high` so “the names agree.”

9. **Eligibility and warnings both stamp booked / cancelled / duplicate.** `classifyEligibility` is one of four (`cancelled` wins over `booked` over `duplicate`). Warnings can stack. The matcher’s blocked-reason walk is a sibling. Do not collapse warnings into eligibility so “one field is enough.”

10. **Channel conflict is the booking channel vs the Lead model.** Form assignment vs Call Lead, or call assignment vs Form Lead. It is not a match method. Source-fit warnings come from sibling `classifyLeadSourceCompatibility`. `exact_granularity` is silent. Do not add `channel_conflict` to that sibling.

11. **Call Job lookup always runs.** Form LID / email / name are conditional. A form-channel submit still loads Call Leads by Job Number so the matcher can see identity conflict and channel-only hits. Do not skip Call Job on form channel so “preferred model is the only collection.”

12. **`runQuery` is an `any` cast.** Session attach vs `exec`. Rename the beat (`attachTheCallerSession`). Do not invent a repository class so “Mongoose is hidden.”

13. **`toPublicLeadContactSnapshot` has no external caller.** Only `leadContactSnapshotsFromDoc` uses it. Owner search imports the copy helper. Keep the sanitize export as an alias until that helper is the only name. Do not add a third snapshot mapper in `bookingLeadReconciliation`.

14. **Owner typed search is not this story.** `searchCandidates` already walks `q` / name / email / phone plus live + ingested + Granot paths. This file must not absorb that query so “one candidate module.” Refresh / rematch must not start calling Owner search so “the owner sees the same list they typed.”

15. **Leave sibling modules alone.** `prepareEmployeeBookingSubmission`, `evaluateEmployeeBookingMatch`, `classifyLeadSourceCompatibility`, `normalizeComparisonName`, and `searchBookingLeadCandidates` stay where they are. This file orchestrates the six finds and the display card.

16. **This file does not own `matching unavailable`.** Submit / rematch catch a thrown query and turn it into that reason. A successful overflow is `multiple_matches`, not a throw. Do not throw on overflow so “errors look honest.”

17. **No write, no claim, no Sheet Sync, no Domain Command.** Optional `session` is only so the finds see the same snapshot as the booking write. Do not open a transaction here.

## Testing

The **interface** is the test surface: `assembleTheAutoMatchCandidateSet` (today’s `queryEmployeeBookingCandidates`) and `copyTheLeadContactTheOwnerShouldSee`.

Today’s `leadCandidateQueries.test.ts` stubs `FormLead.find` / `CallLead.find` and proves two facts: a 26th LID hit sets `hasOverflow` and keeps 25 (none eligible when the 26th is the live one); snapshots keep ingested + Granot contact. That is the overflow **seam**. It is not enough for the rest of the story.

Add tests that name the operation. Do **not** add a test per helper (`confidenceFromTheMethodsThatHit`, `phoneDigitsMayAppearInThisRawNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Assemble the set**
- Form LID + Call Job + Form phone + Call phone run in parallel; email and name lookups are omitted when those stamps are missing.
- Name lookup is omitted when email is missing, even if a name was typed.
- The same Form Lead found by LID and phone is one card with both methods, not two rows.
- Any lookup returning 26 docs → `hasOverflow: true`, 25 kept from that page, matcher-facing uniqueness unproven (do not assert the matcher’s `multiple_matches` here).
- Call Job uses exact `normalized_job_no`. A `P`-prefix store does not appear for a digit-only submit (lock the current stamp; do not “fix” it here).
- Form-channel submit still returns Call Job hits (channel_conflict lives on the card; the matcher decides).
- Optional session is attached to every find that ran.

**Card the Lead**
- Cancelled wins eligibility over booked over Duplicate Lead.
- Source-fit `conflict` / `unassigned` / `same_company` become warnings; `exact_granularity` does not.
- `created_on_unmatched` warns only on Call Lead.
- Ingested + Granot contact blobs are copied onto the card; empty blobs are omitted.

**Owner contact copy**
- `copyTheLeadContactTheOwnerShouldSee` on a search-row-shaped doc returns the same sanitized blobs the finder puts on a card.
- A stored Date `captured_at` becomes ISO. A blob with no name / phone / email is omitted.

Do not prove the five scoring rules, claim, rematch cron, or Owner typed search here. Those are sibling **interfaces**.

## What I would not do

- An `EmployeeBookingCandidateService` class with `query` / `merge` / `map`.
- Thirty two-line functions that only wrap an existing `find`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `query.ts` / `snapshot.ts` split for cleanliness.
- Breaking a caller’s before-commit **seam**. These finds stay inside the write the caller already opened; they do not finalize Sheet Sync or record owner events.
- Inventing a Domain Command **seam** that has only one **adapter**.
- Treating Owner any-known-contact search, the five auto-match rules, claim, rematch, or Book This Lead as this story.
- Searching Granot / ingested snapshot paths so “submit matches Owner search.”
- Importing the Granot prefix-aware Job filter so “every Job lookup agrees.”
- Ungating the name lookup, or scoping overflow to one rule, so a unique LID can still auto-link.
- Opening Wave B or the next service while this checklist has unchecked modules.
