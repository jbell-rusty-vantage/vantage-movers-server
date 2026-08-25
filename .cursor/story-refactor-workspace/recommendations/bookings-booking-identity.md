# Recognize The Same Job — operational story

- Status: recommended
- Service: `bookings` (Wave A, visited)
- Pass: 7 of this service — `bookingIdentity.ts`
- Remaining in this service: none — `bookingWarnings.ts` and `bestRelocationImportGuard.ts` already skipped
- Target: `src/services/bookings/bookingIdentity.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (`normalized_job_no` unique partial index; tests claim “job/name normalize”). Prefix twins are `docs/knowledge/granot-lifecycle/identity.md` and `desired-state.md`. Employee prepare / 409 / LID-name match are `docs/knowledge/services/employee-bookings.md`. Form Job stamp is `docs/knowledge/services/form-lead.md`. This checkout’s `CONTEXT.md` does not define Job Number — do not invent a glossary copy.
- Callers: FormLead / CallLead / BookedLead / GranotRecordLink pre-validate; `granotLifecycle/identity.ts` (filter + equivalence); `employeeBookings/employeeBookingPreparation.ts` and `leadCandidateQueries.ts`; `leadlessBooking.service.ts` recon snapshot; `leads/leadIngestionProvenance.ts`. Others import the stamps (desired-state, processor, projections, recon search, historical planner) — do not dump them.
- Seams callers need: stamp the stored Job vs say two stamps are the same Job vs find every stored twin; LID keeps punctuation; name/email fold vs Lead display compose; unique Booking index is the exact stamp, not the digit core
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this a helper. The names agree: `normalizeJobNo`, `jobNumbersEquivalent`, `equivalentNormalizedJobFilter`. Those are token mechanics. The owner question is: *someone typed a Job, a Form LID, or a person’s name. What do we store so we can say “this is the same Job,” “this is the same LID,” or “this is the same person” later — and when Granot looks, which stored twins count as that Job?*

## What this file actually does

Three operations, not “an identity helper” and not Book This Lead:

1. **Recognize the same Job** — stamp a comparable Job (`normalizeJobNo`). If two stamps are exactly equal, they are the same Job. If both are letters then digits and the digits match (`P5562366` / `5562366`, `RF5555313` / `5555313`), they are the same Job. When Granot looks up a Record Link, a scoped Call, or a Booking, find the exact stamp, the bare digits, and any letter-prefixed twin.
2. **Name this Form LID for match** — uppercase, collapse spaces, **keep** internal punctuation. Form `pre("validate")` writes `normalized_lid`. Employee auto-match `form_lid_exact` compares that stamp.
3. **Name this person and email for match** — fold a display name (NFKC, quotes and dashes to spaces, drop other punctuation, lowercase, collapse spaces) and lowercase an email. Form writes `normalized_contact_name`. Employee prepare and leadless Best Relocation recon cases store those stamps so later compare is not “whatever they typed.”

Phone is `utils/phone`. Lead display Name is `leadName.service.ts`. Book This Lead, Referral / Leadless collision, from-source raw `job_no` find, and the Granot identity **ladder** are not this file. They call these **interfaces**, or they never ask “same Job.”

## Organization

Keep one file. This is the screenplay for “what Job / LID / person do we mean.” Model hooks, Granot identity, employee match, provenance snapshots, and Referral / Leadless 409 already live in deeper **modules**. Do not pull those in. Do not invent a `BookingIdentityService` class. Do not move this into `src/utils/` “because it is generic.”

Do not split this 90-line file. Stamp / compare / find-twins are three **seams** on one Job story, not three folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `normalizeJobNo` | `nameThisJob` | models, provenance, employee prepare, leadless recon — write the stored comparable Job |
| `jobNumbersEquivalent` | `theseAreTheSameJob` | Granot identity `job_number_conflict` and desired-state conflict — prefix twins are not a fight |
| `equivalentNormalizedJobFilter` | `findEveryStoredJobThatMeansThisJob` | identity Record Link / Call / Booking `find` — exact, core, and `^[A-Z]+core$` |
| `normalizeSubmissionLid` | `nameThisFormLidForMatch` | Form `normalized_lid` + employee LID exact rule |
| `normalizeComparisonEmail` | `nameThisEmailForMatch` | employee prepare only (recon search lowercases inline) |
| `normalizeComparisonName` | `nameThisPersonForMatch` | Form `normalized_contact_name`, employee candidates, leadless recon snapshot |

`jobNumberDigitCore` is a child of recognize-the-same-Job. Keep the old name as a one-line alias — the inbound-prefix repair script imports it. Do not make callers learn `DigitCore` as the domain language.

Keep the old names as one-line aliases until models, identity, employee prepare, and provenance migrate.

**No class for the workflow.** The one type that *does* earn a name is the lookup identity already returns as a Mongo clause:

```ts
type JobsThatMeanThisJob =
  | { normalized_job_no: string }
  | { $or: Array<{ normalized_job_no: string | { $regex: string } }> }
```

That is the handoff from “here is the Job Granot named” to “find every stored twin.” A synthetic Job with no digit core is the first branch — exact stamp only.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingIdentity.ts
// Someone typed a Job, a Form LID, or a person's name.
// Stamp a comparable form.
// P5562366 and 5562366 are the same Job.
// A synthetic Job with spaces is only itself.
// A Form LID keeps its punctuation.
// A name for match folds quotes and dashes.
// Booking the Lead is bookedLead. Matching the Lead is identity / employee.

// ── 1. Recognize the same Job ─────────────────────────────

export function nameThisJob(value)
  // NFKC, trim, punctuation → space, collapse, en-US upper
  // "P-5562366" becomes "P 5562366" — no digit core after that

export function theseAreTheSameJob(left, right)
  // missing either side → false
  // exact stamp → true (including "SYNTHETIC JOB 100")
  // else same digit core → true

export function findEveryStoredJobThatMeansThisJob(normalizedJobNo)
  // no core → { normalized_job_no } exact
  // else $or exact, bare core, /^[A-Z]+core$/

function readTheDigitCoreOfThisJob(normalized)
  // ^[A-Z]*(\d+)$  — ASCII letters, then digits, nothing else
function foldTheToken(value, { uppercase, keepInternalPunctuation })

// ── 2. Name this Form LID for match ───────────────────────

export function nameThisFormLidForMatch(value)
  // same fold, uppercase, keep punctuation ("ABC-12" stays "ABC-12")

// ── 3. Name this person and email for match ───────────────

export function nameThisPersonForMatch(value)
  // NFKC, quotes/dashes → space, drop other punctuation, en-US lower, collapse

export function nameThisEmailForMatch(value)
  // trim + lower; empty → undefined
```

Read the Job path out loud: *Take the Job they typed. Fold punctuation to spaces and uppercase it. If it is only letters then digits, the digits are the Job Granot means — so P5562366 and 5562366 are the same Job, and a lookup must find the exact stamp, the bare digits, and any other letter-prefixed twin. If it is a synthetic Job with spaces, there is no digit core: only that exact stamp matches, even when the words are identical. Store the stamp on the Lead, the Booking, the provenance snapshot, and the Record Link. The unique Booking index is that exact stamp, not the digit core.*

Read the LID path out loud: *Take the Form LID. Uppercase it, collapse spaces, keep the hyphen. Write `normalized_lid`. Employee `form_lid_exact` compares that stamp, not the raw box.*

Read the person path out loud: *Take the name they typed. Fold curly quotes and dashes to spaces, drop the rest of the punctuation, lowercase it. Write `normalized_contact_name`. Take the email, lowercase it. Employee auto-match and a leadless Best Relocation recon case compare those stamps. Do not rebuild the Lead’s display Name here.*

That is the operation. `normalizeJobNo` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There are three “same Job” meanings.** Raw `job_no` (from-source find, Referral / Leadless 409, Call search). Exact `nameThisJob` stamp (Booking unique index, employee submit 409, employee candidate `CallLead.find({ normalized_job_no })`, provenance snapshot, GranotRecordLink snapshot guard). Digit-core equivalence (this file’s compare + filter; Granot identity conflict and lookup). `P5562366` and `5562366` are two unique Bookings and two unique active Record Links, then identity `findOne`s the filter and can call that `job_number_conflict` / `multiple_bookings`. Do **not** silently switch the unique index, Referral 409, or from-source find to `findEveryStoredJobThatMeansThisJob`. The earlier bookings recommendations already forbade that.

2. **A hyphenated prefix loses the digit core.** `nameThisJob("P-5562366")` is `"P 5562366"`. `readTheDigitCoreOfThisJob` requires `^[A-Z]*(\d+)$`, so that stamp has no core. `theseAreTheSameJob` then needs exact equality. The lookup for `"5562366"` will not find `"P 5562366"`. Do not start stripping spaces after fold so “hyphens still prefix,” and do not teach the core regex to allow spaces.

3. **The filter’s first two `$or` branches duplicate when the input is already the core.** `findEveryStoredJobThatMeansThisJob("5562366")` emits exact + core + regex, and exact === core. Harmless. Do not “dedupe” in a way that drops the regex.

4. **Prefix and core are ASCII `[A-Z]` only.** `nameThisJob` keeps `\p{L}`. A Job that stamps with a non-ASCII letter will not get a digit core and will not match `^[A-Z]+core$`. Leave that. Do not widen the regex to `\p{L}` so “normalize and lookup agree” without a reviewed identity change.

5. **Employee candidate Job find is the exact stamp.** `leadCandidateQueries` does `CallLead.find({ normalized_job_no: submission.normalizedJobNo })`, not this filter. A Call stored as `P5562366` will not auto-match a submit of `5562366`. Granot identity would. Do not import the filter into employee match so “every Job lookup is prefix-aware.”

6. **Employee recon search Job clause is also exact.** `bookingLeadReconciliation.service.ts` pushes `{ normalized_job_no: normalizeJobNo(query.job_no) }`. Same gap. Leave recon search in that module.

7. **Desired-state fill and conflict disagree.** `conflictingJob` uses `theseAreTheSameJob`. `valuesSemanticallyEqual` for `job_no` / `normalized_job_no` uses exact `nameThisJob` stamps. Knowledge says prefix twins “agree” for fill. Prefix twins therefore neither conflict nor count as equal, so the planner can treat them as a write. That is `leadDesiredState.ts`. Do not change `theseAreTheSameJob` so fill and conflict “line up,” and do not pull the planner in.

8. **GranotRecordLink refuses a snapshot that does not stamp back to `normalized_job_no`.** The hook compares `nameThisJob(job_no_snapshot) === normalized_job_no`. It does not allow a prefix twin as the snapshot of a core. Do not relax that guard to `theseAreTheSameJob`.

9. **Form Job is not Tracking Reference.** `nameThisJob` stamps `job_no` → `normalized_job_no`. `ref_no` stays `"not provided"` / the CRM lead number. `form-lead.md` already says that. Do not stamp `ref_no` here.

10. **LID punctuation is the opposite of Job punctuation.** `ABC-12` as a LID stays `ABC-12`. As a Job it becomes `ABC 12` and has no digit core. Do not reuse `nameThisJob` for LID so “one fold function.”

11. **Email has two folds.** `nameThisEmailForMatch` is employee prepare. Recon candidate search does `query.email.trim().toLowerCase()` inline. Form `email` is schema `lowercase` + `trim`, and recon does not read `normalizeComparisonEmail`. Do not force every email compare through this export so “one email story.”

12. **Name fold is not display compose.** `nameThisPersonForMatch` does not invent first/last and does not write `name`. `composeTheLeadDisplayName` does not lowercase or strip punctuation. Employee `name_contradiction` re-folds `doc.name` and compares to the submission stamp. Do not merge the two files.

13. **Knowledge says this test file covers “job/name normalize.”** `bookingIdentity.test.ts` only locks digit-core Job compare and the filter. LID, email, and name have no unit tests here. Do not silently “fix” the Service line; add the missing **interface** tests.

14. **`bookings/index.ts` does not re-export this file.** Callers import `bookingIdentity` directly. Do not add a barrel export so “the public bookings surface includes identity.”

15. **Leave sibling modules alone.** Model hooks, Granot identity ladder, employee auto-match rules, provenance snapshots, Referral / Leadless 409, from-source raw Job find, and `utils/phone` stay where they are. This file stamps and compares.

16. **Do not treat Book This Lead, Granot identity, or employee auto-match as this story.** They are callers. Prefix-repair migrations and historical planners are callers too.

## Testing

The **interface** is the test surface: `nameThisJob`, `theseAreTheSameJob`, `findEveryStoredJobThatMeansThisJob`, `nameThisFormLidForMatch`, `nameThisPersonForMatch`, `nameThisEmailForMatch`.

`bookingIdentity.test.ts` already locks digit-core Job compare and the filter. Keep those cases. Add the missing operations. The functions are pure — no Mongo.

**Recognize the same Job — stamp**
- `"p5562366"` → `"P5562366"`.
- `"P-5562366"` → `"P 5562366"` (no digit core).
- `"  ab-12  "` → `"AB 12"`.
- blank / null → `undefined`.

**Recognize — same Job**
- Keep today’s prefix cases (`P5562366` ≡ `5562366`, `RF5555313` ≡ `5555313`, same stamp, different core, synthetic exact vs different).
- `"P 5562366"` vs `"5562366"` → **false** (hyphen path lost the core).
- one side missing → false.

**Recognize — find twins**
- Keep today’s synthetic exact filter and core `$or` (including the duplicate exact/core branch on `"5562366"`).
- `"P5562366"` → `$or` exact `P5562366`, core `5562366`, regex `^[A-Z]+5562366$`.
- Do not lock a Mongo `find` here. Identity and employee tests own the query.

**Name this Form LID**
- `" abc-12 "` → `"ABC-12"` (punctuation kept).
- blank → `undefined`.

**Name this person and email**
- `" Jane O’Malley-Smith "` → folded lowercase without curly quote or hyphen (`jane o malley smith`).
- `"  Ada@Example.COM  "` → `"ada@example.com"`.
- whitespace-only name or email → `undefined`.

Do **not** add a test per helper (`readTheDigitCoreOfThisJob`, `foldTheToken`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Booking unique-index apply, Referral raw `job_no` 409, from-source newest-five Job find, Granot identity ladder outcomes, employee auto-match ranking, or `composeTheLeadDisplayName` here. Model validate tests may keep proving `normalized_job_no === nameThisJob(job_no)`.

## What I would not do

- A `BookingIdentityService` class with `normalize` / `equivalent` / `filter`.
- Thirty two-line functions that only wrap `trim` and `toUpperCase`.
- Moving this into a CRUD folder, or into `src/utils/` / `granotLifecycle/` “because everyone imports it.”
- Switching the Booking unique index, Referral / Leadless 409, from-source find, or employee candidate Job query to the prefix filter.
- Teaching `nameThisJob` to strip spaces so hyphenated prefixes keep a digit core.
- Reusing the Job fold for LID, or merging display-name compose into this file.
- Relaxing GranotRecordLink’s snapshot guard to prefix equivalence.
- Changing `theseAreTheSameJob` so desired-state fill and conflict line up.
- Writing a whole-folder `bookings` recommendation in this pass.
