# Book The Employee Job — Auto-Link The Unique Lead Or Open An Owner Case — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 1 of this service — `submitEmployeeBooking.service.ts`
- Remaining in this service: `leadCandidateQueries.ts`, `leadMatchEvaluator.ts`, `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/submitEmployeeBooking.service.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` (`POST /api/v1/employee-booking-submissions` → `handleEmployeeBookingSubmission` after secret-only auth, Zod, and `x-public-client-key-hash`). Barrel: `employeeBookings/index.ts`. No Domain Command adapter. No `submitEmployeeBooking.service.test.ts`. `v1.routes.test.ts` only asserts the path is registered.
- Seams callers need: public submit (the only **adapter**); before-commit write vs after-commit Sheet Sync; linked Booking Chain vs pending Master Booked; duplicate submission is a 200, not an error
- Split later (only if the file outgrows one sitting): keep one file — this is already one origin. Do not split into `create.ts` / `throttle.ts` / `linked.ts` / `pending.ts`. Prepare, candidate query, and match live in siblings.

`submitEmployeeBooking` is executor mechanics. The owner question is: *An employee typed a Job Number, a Source, a phone, agents, and a deposit on the public form. If we already booked that submission, hand back the same confirmation. If that Job already exists, stop. Else look for one unique source-compatible Lead. If we can claim it, book and attach it. If we cannot — including when the matcher throws — still book, leadless, and open an Owner case. Never invent a second Booking for the same submission. Never ask a Domain Command. Never call Book This Lead or Book a Leadless Job. Never POST Granot.*

## What this file actually does

Four operations of one “book the employee Job” story, not “a CRUD service,” and not Book a Leadless Job:

1. **Throttle the public form** — bump a global bucket and, when the route sent a client key hash, a per-client bucket. Over the window limit → 429. The Booking is not written.
2. **Hand back the same confirmation** — an existing `booking_origin=employee_booking` with this `submission_id` is a 200 `duplicate_submission`. No second Booking. Confirmation code is the last 8 hex of the Booking id.
3. **Refuse when that Job is already booked** — another Booking owns this `normalized_job_no` → 409. The unique index is the same contract; a race becomes the same 409.
4. **Book the employee Job** — two endings inside one `runSheetSyncWrite` (`forceTransaction: true`):
   - **Linked:** claim the Lead, save the Booking with `lead_ref`, remember Sheet Sync `booking_chain` / `employee_booking.create_linked` → 201 `booked_and_linked`.
   - **Pending:** save a leadless Booking plus a `BookingLeadReconciliationCase`, remember Sheet Sync `booked_lead` / `employee_booking.create_pending` → 201 `booked_pending_lead`. Matcher exceptions that are not 409 become `matching_unavailable` and still book.

Finding candidates, scoring the five auto-match rules, Owner attach / dismiss / rematch, and the options catalog are other files. After commit this file projects sheets and records the owner event; it does not drain the queue.

## Organization

Keep one file. This is the screenplay for “the employee form booked a Job.” Prepare, candidate query, match, claim, customer upsert, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent an `EmployeeBookingService` class. Do not invent a begin / complete Domain Command **seam** — there is only one **adapter** (the public route). Inventing a second **adapter** so “submit matches Book This Lead” is forbidden.

If it later outgrows one sitting, the split is still this origin vs Owner attach vs rematch, never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `submitEmployeeBooking` | `bookTheEmployeeJob` | public form path: run the whole story |
| `SubmitEmployeeBookingResult` | `EmployeeJobBookingResult` | route status + confirmation the employee sees |
| `SubmitEmployeeBookingContext` | `EmployeeJobBookingContext` | optional client key hash for the per-client bucket |

Keep the old names as one-line aliases until the route and barrel migrate. Do not export the throttle helper, the transaction callback, or `pendingFromClaimFailure`. Do not make callers learn `InTransaction`. Do not add `beginBookTheEmployeeJob` until a second real **adapter** exists.

**No class for the workflow.** The one type that earns a name is the pending write bag the transaction hands to after-commit:

```ts
type EmployeeJobBookingInProgress =
  | { kind: "duplicate"; bookingId: string; leadConnection: "connected" | "pending" }
  | { kind: "linked"; bookingId: string; job: FullSheetSyncJob }
  | { kind: "pending"; bookingId: string; job: FullSheetSyncJob; reason: BookingLeadReconciliationReason }
```

That is the handoff from “the Booking is saved and Sheet Sync intent is remembered” to “project the row and tell the owner linked or pending.” Duplicate never finalizes sheets.

`PreparedEmployeeBookingSubmission` and `EmployeeBookingMatchOutcome` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// submitEmployeeBooking.service.ts
// An employee typed a Job Number, a Source, a phone, agents, and a deposit.
// If we already booked that submission, hand back the same confirmation.
// If that Job already exists, stop.
// Else look for one unique source-compatible Lead.
// If we can claim it, book and attach it.
// If we cannot — including when the matcher throws — still book,
// leadless, and open an Owner case.
// Book This Lead, Book a Leadless Job, and Granot Owner Confirm are other files.

// ── 1. Throttle the public form ───────────────────────────

async function refuseIfThePublicFormIsSendingTooManyJobs(clientKeyHash?)
  // global bucket always; per-client bucket only when the route sent a hash
  // window + limits from getBookingReconciliationConfig — sibling config

// ── 2. Hand back the same confirmation ────────────────────

function thisSubmissionAlreadyBookedAJob(existing)
  // booking_origin employee_booking + submission_id
  // lead_connection = leadless ? pending : connected
function confirmationCodeFor(bookingId)              // last 8 hex, uppercase

// ── 3. Refuse when that Job is already booked ─────────────

function anotherBookingAlreadyOwnsThisJob(normalizedJobNo)
  // findOne normalized_job_no — same unique index the write can still hit

// ── 4. Book the employee Job ──────────────────────────────

export async function bookTheEmployeeJob(input, context)
  // prepare (sibling) → duplicate? → job taken? → write → complete

async function writeTheEmployeeJob(prepared, session)
  // re-check submission + job inside the transaction
  async function findOneUniqueLeadOrDecideThisJobStaysPending(prepared, session)
    // query + evaluate (siblings); AppError 409 rethrows; anything else matching_unavailable
  async function rememberTheCustomerFromTheTypedNameAndPhone(prepared, session)
  async function bookAndAttachWhenTheLeadCanBeClaimed(prepared, match, bookingBase, session)
    // refuse claim if cancelled / already booked / Duplicate Lead / Call created_on_unmatched
    // claimAvailableLeadForBooking — sibling; false → pending, never abort the Booking
    // Sheet Sync booking_chain / employee_booking.create_linked
  async function bookLeadlessAndOpenAnOwnerCase(prepared, pending, bookingBase, session)
    // is_leadless_booking; case origin defaults employee_booking
    // retry.next_attempt_at only when rematch is on and the reason is listed
    // Sheet Sync booked_lead / employee_booking.create_pending

async function completeTheEmployeeJob(pending)
  // finalizeSheetSync; then record linked / pending / matching_unavailable
```

Read the path out loud: *Throttle the public form. Prepare the Job, the Source, the phone, and the agents. If this submission already booked a Job, hand back that confirmation. If another Booking owns this Job Number, stop. Inside one write: look for one unique source-compatible Lead. Remember the customer from the typed name and phone. If we can claim that Lead, book and attach it and remember the Booking Chain. If we cannot, book leadless, open an Owner case, and remember Master Booked. After commit: project the row and tell the owner linked or pending.*

That is the operation. `submitEmployeeBooking` is not.

The route says the same story, except secret-only auth and the 64-hex client key hash live there. This file never reads the header.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Linked falls through into pending by mutating `matchOutcome`.** After a failed pre-claim check or a failed `claimAvailableLeadForBooking`, the function keeps going and writes the leadless Booking. That is the owner rule (always one Booking). The control flow hides it. Name `bookAndAttachWhenTheLeadCanBeClaimed` so it returns linked or pending. Do not abort the write so “claim failure is an error.”

2. **Submission uniqueness is checked three times.** Preflight `findOne`, in-transaction `findOne`, then catch Mongo 11000 on `submission_id`. Job uniqueness is the same trio on `normalized_job_no`. One story, two **adapters** (preflight vs unique index). Shared beat: already booked. Do not drop the preflight “because the index will catch it,” or drop the catch “because we checked first.”

3. **Catch selects `_id` twice.** `.select("_id").select("_id is_leadless_booking")` — the second wins. The lying first select is leftover. Delete it while renaming. Do not change which Booking the 11000 path returns.

4. **`created_on_unmatched` becomes `no_match`.** Pre-claim on a Call Lead with `created_on_unmatched` calls `pendingFromClaimFailure("no_match", …)`. The evaluator’s blocked reason for that Lead is not this file. Do not rename the stored reason to `created_on_unmatched` so the string “matches the field.” Rematch and Owner filters already key on `no_match`.

5. **Claim-time re-read duplicates the pre-claim fence.** After `claimed === false`, `getLinkedLead` again maps cancelled / Duplicate Lead / else `lead_already_booked`. The atomic claim already refused booked / cancelled / duplicate / unmatched. Rename so both fences are visible. Do not delete the re-read “because claim is atomic,” or skip the pre-claim “because claim will fail.”

6. **Matcher 409 is a Job collision, not a match miss.** `AppError` status 409 is rethrown. Everything else becomes `matching_unavailable` with empty candidates and still books. Knowledge already says this. Do not swallow 409 so “the employee always gets a Booking,” or turn a query timeout into a thrown 500 so “errors look honest.”

7. **Customer upsert is inside the write for both endings.** Name and phone always go to `upsertCustomerFromBookingContact`. Book a Leadless Job skips a blank name. This file’s Zod requires `lead_name`. Do not move the upsert outside the transaction, or skip it on the pending ending so “leadless matches admin Leadless.”

8. **Sheet Sync resource is the ending.** Linked is `booking_chain` / `employee_booking.create_linked` (Lead + Booking). Pending is `booked_lead` / `employee_booking.create_pending` (Master Booked only). Do not enqueue `booking_chain` on pending “so both endings match,” or `booked_lead` on linked “because Leadless does.”

9. **Retry state is opened here; rematch is a sibling.** `buildRetryState` stamps `next_attempt_at` from the first delay when rematch is on and the reason is listed (default list is only `matching_unavailable`). Do not pull `runDueBookingLeadRematches` into this file. Do not stamp retry on every pending reason so “the cron has something to do.”

10. **Case origin is the model default.** This file never writes `origin`. The schema defaults `employee_booking`. Best Relocation import cases write `external_sheet_ingestion` in `leadlessBooking.service.ts`. Do not copy that origin here so “both Leadless writers share a case builder.”

11. **Confirmation code is the Booking id, not a new secret.** Last 8 hex, uppercase. Duplicate, linked, and pending all use it. Do not mint a second code so “the employee cannot guess the id.”

12. **Throttle config lives next to rematch config.** Window / limits are `getBookingReconciliationConfig()` (`EMPLOYEE_BOOKING_PUBLIC_THROTTLE_*`, defaults 300s / 10 / 250). Leave that module alone. Do not move the bucket write into rematch, or skip the global bucket when a client hash is present.

13. **Auth is the route.** Secret-only + 64-hex `x-public-client-key-hash`. This file only receives the hash. Do not read the header here, or accept a missing hash and throttle only globally.

14. **No Domain Command, no EntityChange, no `booking.created` event.** Owner case actions may later go through `domainCommands/bookings.ts`. Submit does not. Events are `booking.employee_submission.*` (`duplicate_ignored` / `created_linked` / `created_pending` / `matching_unavailable` / `rate_limited`). Do not wrap submit in a command so attach/cancel “agree,” or add `booking.created` so employee “matches Book This Lead.”

15. **Leave sibling modules alone.** `prepareEmployeeBookingSubmission`, `queryEmployeeBookingCandidates`, `evaluateEmployeeBookingMatch`, `claimAvailableLeadForBooking`, `upsertCustomerFromBookingContact`, `getLinkedLead`, Sheet Sync, and `getEmployeeBookingMatchingConfig` stay where they are. This file orchestrates the public submit.

16. **Do not treat Book a Leadless Job as this story.** `createLeadlessBooking` writes admin / Best Relocation Leadless and may open an import case. This file never calls it. Pending employee Leadless is `booking_origin=employee_booking` plus an employee matching case.

17. **Do not treat Book This Lead or Book from the source form as this story.** Those paths start from a known Lead. This path starts from the employee form and may fail to attach.

18. **Do not treat Owner attach or rematch as this story.** `attachLeadToEmployeeBooking` and `runDueBookingLeadRematches` run after a pending case exists. This file only opens that case.

19. **`EMPLOYEE_BOOKING_AUTO_MATCH_RULES=none` still books.** Enabled rules empty → evaluator returns pending. This file still writes the Booking and the case. Do not skip the write so “no rules means no Booking.”

20. **Do not silently add a command `begin` / `complete`.** There is one **adapter**. A second **adapter** that does not exist is not a **seam**.

## Testing

The **interface** is the test surface: `bookTheEmployeeJob` (today’s `submitEmployeeBooking`).

There is no `submitEmployeeBooking.service.test.ts`. Zod covers the body. `v1.routes.test.ts` only asserts `/api/v1/employee-booking-submissions` is registered. Sibling tests cover options assemble, evaluator rules, candidate query, rematch, and Owner cases. That is not enough for this story.

Add tests that name the operation. Do **not** add a test per helper (`confirmationCodeFor`, `hashCandidates`, `bumpThrottleBucket`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Throttle**
- Over the global limit → 429, no Booking.
- Over the per-client limit → 429, no Booking.
- Missing client hash still bumps global only.

**Same confirmation**
- Second POST with the same `submission_id` and `booking_origin=employee_booking` → 200 `duplicate_submission`, same `booking_id`, no second Booking, no second case, no Sheet Sync finalize.
- Leadless original → `lead_connection: "pending"`. Linked original → `"connected"`.

**Job already booked**
- Another Booking with this `normalized_job_no` → 409, even when `submission_id` is new.
- In-transaction unique-index race on `normalized_job_no` → the same 409.

**Book and attach**
- Unique source-compatible Form LID (or the first enabled winning rule) → 201 `booked_and_linked`, `lead_ref` set, Lead `booked` claimed, Sheet Sync `booking_chain` / `employee_booking.create_linked` remembered **before** commit and finalized **after**.
- Confirmation code is the last 8 hex of `booking_id`.

**Book leadless and open a case**
- No unique Lead → 201 `booked_pending_lead`, `is_leadless_booking: true`, a `pending` case with candidates + `initial` attempt, Sheet Sync `booked_lead` / `employee_booking.create_pending`.
- Matcher throw that is not 409 → `matching_unavailable`, empty candidates, Booking still saved, event level error.
- Claim failure after a would-be link (Lead booked / cancelled / Duplicate Lead) → pending with that reason, Booking still saved, no `lead_ref`.
- Call `created_on_unmatched` at claim time → pending `no_match`, Booking still saved.
- Auto-match `none` → pending case, Booking still saved.
- `next_attempt_at` only when rematch is on and the reason is in the rematch list.

Do not prove Owner attach, rematch cron, or the five scoring rules here. Those are sibling **interfaces**.

## What I would not do

- An `EmployeeBookingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) for cleanliness.
- Breaking the before-commit / after-commit **seam**. Sheet Sync finalize and owner events must not sit inside the Mongo write.
- Inventing a Domain Command **seam** that has only one **adapter**.
- Treating Book This Lead, Book a Leadless Job, Book from the source form, Granot Owner Confirm, Owner attach, or rematch as this story.
- Silently teaching pending employee Leadless to call `createLeadlessBooking`, or linked employee book to call `createBookedLead`, so the three writers “share a write.”
- Unifying `booking_chain` and `booked_lead` so both endings “use the same job.”
- Swallowing Job 409 so the employee always gets a Booking.
- Opening Wave B or the next service while this checklist has unchecked modules.
