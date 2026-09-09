# Link The Already-Booked Employee Job To A Lead — Claim The Named Lead Or Mint Then Claim, Reprice Only When The Owner Applies The Submission Source, Then Stamp The Booking Chain — On Reassign Claim The Next Lead First Then Take The Old Stamp Off — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 5 of this service — `bookingLeadAttachment.service.ts`
- Remaining in this service: `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/bookingLeadAttachment.service.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (Owner attach / mint / reassign; overrideable warnings live on the desk; rematch delayed attach uses this write). The Service `applies_to` list does not name this file — do not invent a second Service. This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. This write is **not** Book The Employee Job, **not** Book This Lead, and **not** Granot Connect Booking to Lead.
- Callers: `bookingLeadReconciliation.service.ts` (`attach_existing`, `create_and_attach`, `reassign` — persist each returned job; warning overrides and `source_resolution` required-on-conflict live there), `reconciliationRematch.service.ts` (`auto_attach_delayed` — no `sourceResolution`). Barrel does **not** re-export this file. `domainCommands/bookings.ts` `attachBookingToLead` never imports it; it calls `beginWorkingTheOwnerCase` with `attach_existing` only. No `bookingLeadAttachment.service.test.ts`.
- Seams callers need: one claim-and-stamp write shared by Owner attach and rematch (the `operation` string is the Sheet job name); mint Form vs mint Call (Form may return extra Form-Fill jobs); reassign must claim the next Lead before taking the old stamp off; `sourceResolution` three-way (`preserve_lead_source` / `apply_submission_source` / omitted); this file returns jobs and does **not** persist or finalize Sheet Sync
- Split later (only if the file outgrows one sitting): `claimAndStampTheNamedLeadOnThisJob.ts`, `mintALeadThenAttachIt.ts`, `reassignThisJobToADifferentLead.ts` — never `create.ts` / `update.ts` / `delete.ts`. Desk, policy, rematch cron, and submit stay siblings.

`attachLeadToEmployeeBooking` / `createAndAttachReconciliation*Lead` / `reassignEmployeeBookingLead` are executor mechanics. The owner question is: *This Job is already booked. Link it to a Lead. If I named a live Lead, claim it before someone else does, rewrite Source and reprice only when I said apply the submission Source, write the pointer on the Booking, and stamp the Lead booked without touching CPL again. If I asked to mint, write a Form or Call that never POSTs Granot, then attach it. If I am changing Leads, claim the next one first — a failed claim must leave the old attachment. Never book a second Job. Never persist sheets here. Never decide the warnings.*

## What this file actually does

Four operations of one “link the already-booked employee Job to a Lead” story, not “a CRUD attachment service,” and not Book The Employee Job:

1. **Claim and stamp the named Lead on this Job** — load the Lead. If the Owner chose `apply_submission_source`, assign the submission Source onto that Lead and reprice CPL from the Lead’s stored timestamp. Atomically claim it. Claim miss → 409 (*refresh the reconciliation case*). Write `lead_ref` / `lead_model` / `is_leadless_booking=false` / display `source` / Move Type onto the Booking. Stamp the Lead booked with `preserveExistingCpl: true`. Return one `booking_chain` job whose `operation` the caller named (`attach_existing`, `create_and_attach`, `reassign`, or `auto_attach_delayed`).
2. **Mint a Call Lead then attach it** — fold Owner fields over the prepared bag, optional-locate with an empty body (`booking_reconciliation_create_call`), assign the submission Source, remember Form Fill, Florida-timestamp, price CPL, force `created_on_unmatched: false`. Save. Report a missing rate inside this write. Attach with `apply_submission_source`. `extraJobs` is always `[]`.
3. **Mint a Form Lead then attach it** — required name / phone / zips / move size / move date, required locate + derive Move Type (`booking_reconciliation_create_form`), assign the submission Source, detect a Duplicate Lead, Florida-timestamp, price CPL, force `post_to_granot: false`. Save. Report a missing rate inside this write. If it is not a Duplicate Lead, mark matching Call Leads as Form Fill and keep those jobs. Attach with `apply_submission_source`.
4. **Reassign this Job to a different Lead** — remember the previous pointer. Claim and stamp the next Lead first (same write as operation 1, `booking_reconciliation.reassign`). Only then take the Booking off the old Lead (`syncAfterClear: false`) and enqueue `source_lead` / `booking_reconciliation.detach_old`. A failed claim throws so the surrounding transaction keeps the existing attachment.

Finding the unique Lead, Owner warning overrides, case status, rematch lease, and the public employee submit are other files. This file never writes a second Booking, never POSTs Granot, never persists Sheet Sync intent, and never finalizes sheets.

## Organization

Keep one file. This is the screenplay for “the already-booked employee Job now points at this Lead.” Claim / stamp / take-off, Source Assignment, CPL, locate, duplicate / Form Fill, and Sheet Sync persist already live in deeper **modules**. Do not pull those in. Do not invent a `BookingLeadAttachmentService` class. Do not invent a begin / complete Domain Command **seam** — this file is the write the desk and rematch already started. Persist and finalize stay on those callers.

If it later outgrows one sitting, split by the three stories above, never CRUD and never one file per `operation` string.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `attachLeadToEmployeeBooking` | `claimAndStampTheNamedLeadOnThisJob` | Owner attach and rematch delayed attach share one write; the `operation` string names the Sheet job |
| `createAndAttachReconciliationCallLead` | `mintACallLeadThenAttachIt` | Owner mint Call; always empty `extraJobs` |
| `createAndAttachReconciliationFormLead` | `mintAFormLeadThenAttachIt` | Owner mint Form; may return Form-Fill jobs |
| `reassignEmployeeBookingLead` | `reassignThisJobToADifferentLead` | claim the next Lead first so a failed claim keeps the old attachment |

Keep the old names as one-line aliases until the desk and rematch migrate. Do not export `sourceDisplayLabel` or `SourceResolutionChoice`. Do not make callers learn `createAndAttachReconciliation*` as the domain language.

**No class for the workflow.** The one type that earns a name is the mint handoff:

```ts
type MintedLeadAttachmentInProgress = {
  leadId: string
  job: FullSheetSyncJob
  extraJobs: FullSheetSyncJob[]
}
```

That is the handoff from “the Lead is saved and the Booking points at it” to “the desk persists every job, including Form-Fill extras.” Claim-and-stamp alone returns the Booking job. Reassign returns the detach job (when there was a previous Lead) plus that Booking job.

Leave `PreparedEmployeeBookingSubmission` on sibling `types.ts`. Leave the `source_resolution` enum on validation. Do not move warning overrides or case CAS here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingLeadAttachment.service.ts
// This Job is already booked.
// Link it to a Lead.
// If I named a live Lead, claim it before someone else does.
// Rewrite Source and reprice only when I said apply the submission Source.
// Write the pointer on the Booking.
// Stamp the Lead booked without touching CPL again.
// If I asked to mint, write a Form or Call that never POSTs Granot, then attach it.
// If I am changing Leads, claim the next one first —
// a failed claim must leave the old attachment.
// Book The Employee Job, Book This Lead, and Granot Connect Booking to Lead
// are other files.

// ── 1. Claim and stamp the named Lead on this Job ─────────

export async function claimAndStampTheNamedLeadOnThisJob(args)
  // operation is the Sheet job name the caller already chose

async function loadTheLiveLead(leadModel, leadId, session)
async function applyTheSubmissionSourceWhenTheOwnerSaidTo(lead, prepared, leadModel)
  // resolveLeadSourceAssignment + resolveLeadCplSnapshot
  // skip unless sourceResolution === "apply_submission_source"
async function claimTheLeadOrRefuseBecauseSomeoneElseTookIt(...)
  // claimAvailableLeadForBooking
  // false → 409 refresh the case (not stay leadless)
function writeThePointerOnTheBooking(booking, lead, prepared, sourceResolution)
  // lead_ref, lead_model, is_leadless_booking=false
  // preserve_lead_source → lead snapshot label
  // else prepared.sourceDisplayLabel (apply or rematch omit)
  // local: lead ?? prepared ?? booking
async function stampTheLeadBookedWithoutTouchingCplAgain(...)
  // mirrorBookingToLead(..., undefined, session, true)
function handBackTheBookingChainJob(bookingId, operation)

function readTheLeadSourceDisplayLabel(lead)
  // crm / granularity / company snapshot / company slug / "unknown"

// ── 2. Mint a Call Lead then attach it ────────────────────

export async function mintACallLeadThenAttachIt(args)

function foldTheOwnerCallFieldsOverThePreparedBag(leadFields, prepared)
  // phone or job_no already required by Zod
async function optionalLocateWithAnEmptyBody()
  // resolveOptionalLocation({}, booking_reconciliation_create_call)
async function assignTheSubmissionSourceAsACall(prepared, local)
async function rememberWhetherAFormAlreadyFilledThisPhone(assignment, phone)
async function priceTheMintedCall(assignment, timestamp)
async function writeTheCallLeadThatIsNotAnUnmatchedStub(fields, session)
  // created_on_unmatched: false so claim can take it
async function reportAMissingCplRateInsideThisWrite(lead)
  // today runs before attach, inside the caller’s transaction
const job = await claimAndStampTheNamedLeadOnThisJob({
  operation: "booking_reconciliation.create_and_attach",
  sourceResolution: "apply_submission_source",
})
return { leadId, job, extraJobs: [] }

// ── 3. Mint a Form Lead then attach it ────────────────────

export async function mintAFormLeadThenAttachIt(args)

function foldTheOwnerFormFieldsOverThePreparedBag(leadFields, prepared)
async function locateTheMoveTheOwnerTyped(normalized)
  // resolveRequiredLocation + deriveFormLeadLocal
  // workflow booking_reconciliation_create_form
async function assignTheSubmissionSourceAsAForm(prepared, local)
async function detectADuplicateLead(assignment, phone, email, timestamp)
async function priceTheMintedForm(assignment, timestamp)
async function writeTheFormLeadThatNeverPostsToGranot(fields, session)
  // post_to_granot: false
async function reportAMissingCplRateInsideThisWrite(lead)
async function markMatchingCallLeadsAsFormFillUnlessThisIsADuplicate(...)
  // extraJobs; skip when duplicate
const job = await claimAndStampTheNamedLeadOnThisJob({
  operation: "booking_reconciliation.create_and_attach",
  sourceResolution: "apply_submission_source",
})
return { leadId, job, extraJobs }

// ── 4. Reassign this Job to a different Lead ──────────────

export async function reassignThisJobToADifferentLead(args)

function rememberTheLeadThisJobPointsAtNow(booking)
const attachJob = await claimAndStampTheNamedLeadOnThisJob({
  operation: "booking_reconciliation.reassign",
  sourceResolution: args.sourceResolution,
})
  // failed claim throws; do not detach first
async function takeTheOldStampOffOnlyAfterTheNextClaimStuck(...)
  // clearBookingFromLead(..., { syncAfterClear: false })
  // source_lead / booking_reconciliation.detach_old
return [...detachJob?, attachJob]
```

Read the path out loud: *Load the Lead I named. If I said apply the submission Source, rewrite assignment and reprice now. Claim it; if someone else already took it, stop and tell me to refresh. Point the Booking at that Lead. Stamp the Lead booked and keep the price we just decided. If I asked to mint, write a Form or Call that never POSTs Granot — a Call is never an unmatched stub — then attach with apply. If I am changing Leads, claim the next one first, then take the old stamp off. Hand the jobs back. Do not persist sheets. Do not book a second Job.*

That is the operation. `attachLeadToEmployeeBooking` is not.

Submit says a different next sentence after the same claim: stay leadless and open a case. Rematch says the same claim-and-stamp sentence after the matcher returns `linked`, and omits `sourceResolution`. The desk says the warning-override sentence *before* this file runs.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Claim miss is 409 here; submit stays leadless.** `claimAvailableLeadForBooking` returns `false` for both. Public submit turns that into a pending case. This file throws *Lead is no longer eligible for attachment; refresh the reconciliation case*. Do not stay leadless so “both employee paths agree,” or teach submit to 409 so “claim always means stop.”

2. **Submit claims only; this file claims then stamps.** Public linked submit never calls `mirrorBookingToLead`, so it never reprices. Attach stamps with `preserveExistingCpl: true` and no `sourceCompany`, so the stamp does not reprice. The price that survives is the one `applyTheSubmissionSourceWhenTheOwnerSaidTo` just wrote, or the Lead’s old price. Do not delete the stamp so “claim already wrote `booked`,” or teach submit to stamp “so both paths hydrate the document.”

3. **Mint then `apply_submission_source` writes Source and CPL twice.** Create already assigned the submission Source and priced from the new Florida timestamp. Attach immediately re-resolves and reprices, then stamps with preserve. Do not skip the second apply so “create already did it,” or pass `preserve_lead_source` on mint so “the Lead we just wrote keeps itself” — the Owner mint contract is apply.

4. **`sourceResolution` is three-valued.** `apply_submission_source` rewrites the Lead and sets Booking `source` to the prepared display label. `preserve_lead_source` leaves the Lead and sets Booking `source` to the Lead snapshot ladder. Omitted (rematch delayed attach) leaves the Lead and still sets Booking `source` to the prepared display label. Do not default rematch to `preserve_lead_source` so “auto-link never changes the Booking label,” or apply the submission Source on rematch so “linked always agrees with the form.”

5. **`readTheLeadSourceDisplayLabel` walks the ladder twice.** `find` to test, then `find` again to stringify. One walk. Do not import `leads/callLeadSourceMatch`’s CRM-row ladder — that recommendation already says the employee helper is a different field.

6. **Call mint locates with `{}`.** `resolveOptionalLocation({}, { workflow: "booking_reconciliation_create_call" })` never sees a zip. Move Type falls through to the prepared bag, then the Booking. Do not copy Form required-locate onto Call mint so “both mints have an address,” or skip locate so “Call never has local.”

7. **Minted Form never POSTs Granot.** `post_to_granot: false` is forced. Duplicate detection still runs; a Duplicate Lead still attaches. Form Fill marks only when it is not a Duplicate Lead. Do not POST so “a real Form Lead should hit CRM,” or skip duplicate detection so “the Owner typed a new Lead.”

8. **Minted Call is forced `created_on_unmatched: false`.** Claim refuses unmatched stubs. The mint would be un-attachable if that flag stayed true. Do not omit the force so “Call ingest defaults apply,” or skip claim after mint so “we just wrote it.”

9. **Missing CPL is reported inside this write.** Form Lead ingestion reports after commit. Here `recordMissingLeadCplRate` runs after `save`, before attach, inside the caller’s transaction. Leave the order visible. Do not move the report after finalize so “it matches ingest,” or skip the report so “mint is not a real ingest.”

10. **Call mint `extraJobs` is always empty.** Form Fill on a new Call Lead is a flag, not a sheet job. Form mint can return Call Form-Fill jobs. Do not invent a Call extra so “both mints return the same shape,” or drop Form extras so “attach always has one job.”

11. **Reassign claims the next Lead first.** The comment in file is the contract: a failed claim throws and the transaction keeps the existing attachment. Detach-first would clear the old Lead and then 409 with a leadless Booking. Do not detach first so “the old Lead is free before we take the new one,” or skip detach so “the old Lead stays booked too.”

12. **Reassign take-off passes `syncAfterClear: false`.** The desk persists `source_lead` / `detach_old` before commit. Default take-off would inline-sync in the same transaction. Do not flip the flag so “clear always syncs,” or persist the detach job inside this file.

13. **This file does not persist or finalize Sheet Sync.** It returns jobs. The desk and rematch call `persistSheetSyncIntent`. Public resolve / rematch finalize after commit. Begin resolve must not finalize. Do not persist here so “attach is complete,” or finalize here so “the job does not leak.”

14. **This file does not decide warnings.** `assertLeadAttachable` / exact overrides / `source_resolution` required on `source_conflict` live on the desk. Rematch never sends overrides. Do not import the override list so “attach is safe by itself,” or skip desk checks because claim already refuses cancelled / booked / duplicate / unmatched.

15. **Canonical `attachBookingToLead` never calls this file directly.** It can only send `attach_existing` through begin-work. Mint and reassign stay Owner HTTP. Do not add mint to the command so “ingestion can create the Lead,” or export attach from the barrel so “the command can skip the desk.”

16. **`preparedFromCase` may omit allocations and `local`.** Attach reads money / agents from the Booking and Move Type from lead ?? prepared ?? booking. Do not re-prepare inside attach so “the bag is complete,” or copy allocations onto the Lead.

17. **Leave sibling modules alone.** `claimAvailableLeadForBooking`, `mirrorBookingToLead`, `clearBookingFromLead`, `getLinkedLead`, `resolveLeadSourceAssignment`, `resolveLeadCplSnapshot`, `recordMissingLeadCplRate`, `resolveRequiredLocation` / `resolveOptionalLocation` / `deriveFormLeadLocal`, `normalizeLeadName`, `findDuplicateFormLeadMatch`, `hasFormFillForCallLead`, `markMatchingCallLeadsWithFormFill`, `assertLeadAttachable`, and `persistSheetSyncIntent` stay where they are. This file orchestrates the pointer write.

18. **Do not treat Book The Employee Job as this story.** Submit claims during Booking create (`employee_booking.create_linked`) and never calls this file. A would-be link that fails claim stays leadless.

19. **Do not treat Book This Lead, Book a Leadless Job, or Granot Connect Booking to Lead as this story.** Those write a Booking, or a Granot case, or attach through a different command. This file only points an existing employee Booking at a Lead.

20. **Do not silently reorder Sheet Sync or Granot.** There is no CRM Post. Intent stays on the caller, before commit. Do not POST the minted Form after attach so “ingest and mint agree.”

## Testing

The **interface** is the test surface: `claimAndStampTheNamedLeadOnThisJob`, `mintACallLeadThenAttachIt`, `mintAFormLeadThenAttachIt`, `reassignThisJobToADifferentLead`.

There is no `bookingLeadAttachment.service.test.ts`. Desk tests do not prove this write. Add tests that name the operation. Do **not** add a test per helper (`readTheLeadSourceDisplayLabel`, `foldTheOwnerCallFieldsOverThePreparedBag`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Claim and stamp**
- `apply_submission_source` rewrites Lead Source + CPL, then claim, then stamp with preserve; Booking `source` is the prepared display label.
- `preserve_lead_source` does not rewrite the Lead; Booking `source` is the Lead snapshot label.
- Omitted `sourceResolution` does not rewrite the Lead; Booking `source` is the prepared display label (rematch).
- Claim `false` → 409; Booking `lead_ref` unchanged.
- Stamp is called with `preserveExistingCpl: true` and no `sourceCompany`.
- Returned job is `booking_chain` with the caller’s `operation` string.
- Does not call `persistSheetSyncIntent` or `finalizeSheetSync`.

**Mint Call**
- Phone-or-job Zod already passed; missing both never reaches this file.
- `created_on_unmatched` is false.
- Locate is called with `{}` and workflow `booking_reconciliation_create_call`.
- Attach uses `apply_submission_source` and `create_and_attach`.
- `extraJobs` is `[]`.
- Missing-rate report runs after save, before attach.

**Mint Form**
- `post_to_granot` is false.
- Duplicate Lead still attaches; Form Fill jobs are skipped.
- Non-duplicate marks matching Call Leads and returns those jobs plus the Booking job.
- Required locate + `deriveFormLeadLocal`.
- Does not POST Granot.

**Reassign**
- Next-Lead claim `false` → 409; previous `lead_ref` still on the Booking; `clearBookingFromLead` not called.
- Successful claim then take-off with `syncAfterClear: false` and a `detach_old` job before the attach job.
- No previous pointer → only the attach job.

Do not prove warning overrides, case CAS, rematch lease, or the five scoring rules here. Those are sibling **interfaces**. Do not assert that submit calls this file — it does not.

## What I would not do

- A `BookingLeadAttachmentService` class with `attach` / `create` / `reassign`.
- Thirty two-line functions that only wrap `getLinkedLead` or `toObjectId`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or one file per Sheet `operation` string.
- Inventing a begin / complete **seam** here (one write; persist / finalize stay on the desk and rematch).
- Breaking the claim-then-detach **seam** on reassign, or the before-commit persist **seam** on the callers.
- Treating Book The Employee Job, Book This Lead, Book a Leadless Job, Granot Connect Booking to Lead, or rematch cron scheduling as this story.
- Pulling `assertLeadAttachable` / exact overrides into this file so “attach is self-fencing.”
- Persisting or finalizing Sheet Sync here so “the job cannot leak.”
- POSTing the minted Form Lead, or teaching submit to 409 on a failed claim.
- Opening Wave B or the next service while this checklist has unchecked modules.
