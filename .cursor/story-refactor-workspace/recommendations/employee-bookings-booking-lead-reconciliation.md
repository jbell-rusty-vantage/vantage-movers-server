# Work The Owner Desk For The Already-Booked Employee Job — Browse The Cases, Search Any Known Contact, Refresh The Cards Without Claiming, Correct The Pending Job, Then Dismiss Attach Mint Or Reassign — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 4 of this service — `bookingLeadReconciliation.service.ts`
- Remaining in this service: `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/bookingLeadReconciliation.service.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (Owner case actions + live Booking state; overrideable warnings must match exactly; Owner search is any-known-contact including Granot / ingested paths; automatic submit match stays Job / operational phone). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. This desk is **not** the Granot Booking Reconciliation Case.
- Callers: `routes/v1.routes.ts` (`GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*` after `deriveTrustedOwnerActor`), barrel `employeeBookings/index.ts` (public exports only), `domainCommands/bookings.ts` (`attachBookingToLead` → `resolveBookingLeadReconciliationInTransaction` with `attach_existing` only). Tests: `bookingLeadReconciliation.service.test.ts` (list / detail / Owner search shape + a source-read reopen guard). `domainCommands.test.ts` only asserts the begin export does not open its own transaction.
- Seams callers need: public resolve (Owner HTTP) vs begin resolve (canonical command, same write, no finalize); Owner any-known-contact search vs the six operational auto-match lookups; refresh / correct-pending / reopen **record** a would-be link and do not claim; before-commit Sheet Sync intent vs after-commit finalize
- Split later (only if the file outgrows one sitting): `browseTheOwnerCases.ts`, `searchAnyKnownContactForThisJob.ts`, `recordTheMatcherWithoutClaiming.ts`, `workTheOwnerCase.ts` — never `create.ts` / `update.ts` / `delete.ts`. Attach, policy, rematch cron, and submit stay siblings.

`listBookingLeadReconciliationCases` / `resolveBookingLeadReconciliation` / `refreshBookingLeadCandidates` are executor mechanics. The owner question is: *The employee Job is already booked. Open the Owner case. If I type any known contact, show me Form Leads and Call Leads — including Granot and ingested snapshots — and do not pretend those rows are the auto-match set. If I refresh the cards, write what the matcher would do and do not claim. If the case is still pending, I may correct the Job on the Booking. When I am ready, dismiss it, attach a live Lead I named, mint a Lead and attach it, or reassign. A cancelled Booking is for inspection and dismiss only. Never auto-link on refresh. Never open a Granot Booking case. Never book a second Job.*

## What this file actually does

Six operations of one “work the Owner desk for an already-booked employee Job” story, not “a CRUD case service,” and not Book The Employee Job:

1. **Browse the Owner cases** — filter by status, origin, reason, Source, typed `q`, and dates; page by date+id. Open one case with the Booking and the attached Lead if any.
2. **Search any known contact** — the Owner types mongo id, LID, Job Number, phone, email, name, Source, or free `q`. Search live + ingested + Granot snapshot paths. Echo warnings for this Booking. Do **not** write the case. Do **not** call the six operational auto-match lookups.
3. **Refresh the cards without claiming** — re-run the operational finder + matcher, store `latest_candidates` and an `owner_refresh` attempt, clear `retry.last_error`. Do **not** change `reason`. Do **not** claim even when the matcher returns `linked`.
4. **Correct the pending Job** — only a pending, leadless, live Booking. Re-prepare the submission, refuse a stolen Job Number, upsert the customer, patch the Booking and the case, re-run the matcher. Overwrite `reason` only when the decision is still `pending`. Remember Sheet Sync `booked_lead` / `employee_booking.update_pending`.
5. **Work the Owner case** — `dismiss`, `attach_existing`, `create_and_attach`, or `reassign`. Revision CAS + allowed status + live Booking state. Attach / mint / reassign live in the attachment sibling. Public path finalizes sheets and records the owner event; the command path needs the before-commit **seam**.
6. **Reopen for inspection** — leadless dismissed or leadless resolved → `pending`. Clear the rematch lease so a cancelled Booking cannot re-enter the cron. Record the matcher. Do **not** claim. Do **not** change `reason` on a `linked` decision.

Finding the auto-match cards, picking the unique Lead, claiming, minting the Lead, rematch cron, and the public employee submit are other files. This file never POSTs Granot, never opens a Granot Booking case, and never writes a second Booking.

## Organization

Keep one file. This is the screenplay for “the Owner works the already-booked employee Job.” Prepare, operational finder, matcher, attach / mint / reassign, allowed-action policy, and rematch already live in deeper **modules**. Do not pull those in. Do not invent a `BookingLeadReconciliationService` class.

The begin / complete **seam** is real: Owner HTTP `resolve` and canonical `attachBookingToLead` are two **adapters**. Do not add begin / complete for browse, search, refresh, correct-pending, or reopen — those have one **adapter** each.

If it later outgrows one sitting, split by the four stories above, never CRUD and never one file per resolve action.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listBookingLeadReconciliationCases` | `browseTheOwnerCases` | Owner queue |
| `getBookingLeadReconciliationCase` | `openTheOwnerCase` | one case + Booking + attached Lead |
| `searchBookingLeadCandidates` | `searchAnyKnownContactForThisJob` | Owner typed search; not the auto-match finder |
| `refreshBookingLeadCandidates` | `refreshTheCardsWithoutClaiming` | record the matcher; do not attach |
| `updatePendingEmployeeBooking` | `correctThePendingEmployeeJob` | rewrite the still-pending Booking |
| `resolveBookingLeadReconciliation` | `workTheOwnerCase` | Owner HTTP: run the whole act, then finalize sheets |
| `resolveBookingLeadReconciliationInTransaction` | `beginWorkingTheOwnerCase` | canonical `attachBookingToLead` needs the write before commit |
| `persistBookingLeadReconciliationResolveInTransaction` | *(delete — alias of begin)* | same function; a third name is executor mechanics |
| `reopenBookingLeadReconciliation` | `reopenTheOwnerCase` | inspection only; rematch lease cleared |

Keep the old names as one-line aliases until the route, barrel, and `attachBookingToLead` migrate. Fold `persist*` into `beginWorkingTheOwnerCase` (keep both old names as aliases of that one function). Do not make callers learn `InTransaction` / `persist` as the domain language. Do not export `searchCandidates`, `preparedFromCase`, `deriveLiveLeadWarnings`, `assertLeadAttachable`, `buildMatchAttempt`, or `hashCandidates`.

**No class for the workflow.** The one type that earns a name is the pending resolve bag:

```ts
type OwnerCaseWorkInProgress = FullSheetSyncJob[]
```

That is the handoff from “the case is saved and Sheet Sync intent is remembered” to “project the rows and tell the owner the act completed.” Dismiss and a no-sheet reopen hand an empty list.

Leave `PreparedEmployeeBookingSubmission`, `EvaluatedLeadCandidate`, and `EmployeeBookingActorContext` on sibling `types.ts`. Leave the resolve discriminated union on validation. Do not move `assertAllowedCaseAction` / `assertLiveBookingState` / cursor helpers here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingLeadReconciliation.service.ts
// The employee Job is already booked.
// Open the Owner case.
// If I type any known contact, show me Form Leads and Call Leads —
// including Granot and ingested snapshots.
// If I refresh the cards, write what the matcher would do and do not claim.
// If the case is still pending, I may correct the Job on the Booking.
// When I am ready, dismiss it, attach a live Lead I named,
// mint a Lead and attach it, or reassign.
// A cancelled Booking is for inspection and dismiss only.
// Book The Employee Job, Pick The Unique Lead, and Granot Owner Confirm
// are other files.

// ── 1. Browse the Owner cases ─────────────────────────────

export async function browseTheOwnerCases(query)
  // status, origin, reason, Source Company, site, q, from/to, date+id cursor
  // q also matches booking ObjectId when the typed string is one
  // missing stored origin still *displays* employee_booking

export async function openTheOwnerCase(id)
  // 404 if the case is gone
  // attached_lead only when the Booking already has lead_ref + lead_model

// ── 2. Search any known contact ───────────────────────────

export async function searchAnyKnownContactForThisJob(caseId, query)
  // load the case + Booking so warnings are about *this* Job
  // do not call assembleTheAutoMatchCandidateSet
  // do not write latest_candidates

async function findLeadsTheOwnerTyped(query)
  // mongo id, LID, Job Number, email, phone (normalized + substring),
  // name, Source, booked/cancelled/duplicate flags, free q
  // CALL_LEAD_CONTACT_*_PATHS = live + ingested + Granot
  // Form, Call, or both — two finds, then merge by createdAt desc
  // fetch limit+1 per model; cursor is createdAt+_id

function cardThisLeadForTheOwner(lead, booking, prepared)
  // live warnings + sanitized ingested / Granot snapshots
  // is_current_attachment when lead.booked === this Booking

// ── 3. Refresh the cards without claiming ─────────────────

export async function refreshTheCardsWithoutClaiming(caseId, input, actor)
  // revision CAS
  // operational finder + matcher (overflow flag included)
  // store cards + owner_refresh attempt
  // do not overwrite reason
  // do not claim
  // clear retry.last_error
  // transaction with no Sheet job
  // after commit: booking.lead_reconciliation.candidates_refreshed

// ── 4. Correct the pending Job ────────────────────────────

export async function correctThePendingEmployeeJob(caseId, patch, actor)
  // pending only; live Booking; not already attached; not cancelled
  // re-prepare; 409 if another Booking owns the Job Number
  // upsert customer; patch Booking + case submission
  // matcher: reason only when still pending
  // attempt trigger is still stored as owner_refresh today
  // remember booked_lead / employee_booking.update_pending
  // after commit: finalize sheets; no owner event today

// ── 5. Work the Owner case ────────────────────────────────

export async function workTheOwnerCase(caseId, command, actor)
  // runSheetSyncWrite → begin → finalize each job
  // event: dismissed | resolved | reassigned

export async function beginWorkingTheOwnerCase(caseId, command, actor, tx)
  // revision CAS + allowed status + live Booking state
  // dismiss: status dismissed; no Sheet job
  // attach_existing: live Lead, live warnings, exact overrides,
  //   source_resolution required on source_conflict,
  //   cancelled / already-booked-elsewhere cannot be overridden
  // create_and_attach: sibling mints Form or Call, then attach
  //   (extra Lead sheet jobs + the Booking job)
  // reassign: same live-Lead fence; allowSameBooking false
  // attachment sibling owns claim / mint / source apply
  // increment revision; return jobs

// ── 6. Reopen for inspection ──────────────────────────────

export async function reopenTheOwnerCase(caseId, command, actor)
  // allowed on leadless dismissed / leadless resolved
  // cancelled Booking may reopen (inspection) then only dismiss
  // status pending; wipe next_attempt_at / lease so rematch stays off
  // matcher: reason only when still pending; do not claim
  // after commit: booking.lead_reconciliation.reopened
```

Read the path out loud: *Open the case for the Job we already booked. If I search, look up any known contact — including Granot snapshots — and do not write the case. If I refresh, store what the matcher would do and leave the Lead unclaimed. If I still have a pending leadless Job, I may correct the Booking. When I act, dismiss it, attach the Lead I named (overrides exact), mint a Lead and attach it, or reassign. Reopen only for inspection; a cancelled Job must not re-enter rematch. Hand the case back. Do not book a second Job. Do not open a Granot case.*

That is the operation. `resolveBookingLeadReconciliationInTransaction` is not.

Submit and rematch say a different next sentence after the same matcher: claim when `linked`. This file’s refresh, correct-pending, and reopen do **not**. The attachment sibling says the next sentence after Owner attach / mint / reassign.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Refresh never claims and never overwrites `reason`.** A `linked` return becomes `high_confidence` on the attempt and the cards are stored. Status stays whatever it was. `reason` stays the old pending reason. Knowledge and the matcher recommendation already say this. Do not call `claimAvailableLeadForBooking` so “linked always attaches,” or copy `reason` from a `linked` decision so “the case agrees with the attempt.”

2. **Correct-pending and reopen overwrite `reason` only when still `pending`.** Same matcher, different write. A would-be link after the Owner edits the phone still does not attach. Do not attach here so “the new phone is unique,” or skip the matcher so “this is only a Booking patch.”

3. **Correct-pending stores the attempt as `owner_refresh`.** The trigger union in `buildMatchAttempt` is only `"owner_refresh"`. The Owner corrected the Job. Do not invent a second trigger in this pass so “the history is honest,” or stop writing the attempt so “refresh is the only recorder.”

4. **`beginWorkingTheOwnerCase` and `persist*` are the same function.** `resolveBookingLeadReconciliationInTransaction` is a pass-through. Keep one implementation. `domainCommands.test.ts` locks that the begin export does not call `runSheetSyncWrite` or `finalizeSheetSync`. Do not move finalize into begin so “the command finishes the story,” or delete begin so “HTTP is the only caller.”

5. **Canonical `attachBookingToLead` cannot override warnings.** It sends `attach_existing` with revision, model, and id only. Any overrideable live warning → 409. `source_conflict` also needs `source_resolution`. Owner HTTP can send both. Do not default overrides in begin so “ingestion attach always works,” or require overrides on the command so “both adapters match.”

6. **Owner search is not the auto-match finder.** `searchCandidates` uses `CALL_LEAD_CONTACT_*_PATHS` (live + ingested + Granot). `queryEmployeeBookingCandidates` does not search those paths. Refresh / correct-pending / reopen use the finder. Search does not. Do not route Owner `q` through the six operational lookups so “one finder,” or add Granot paths to the finder so “search and match agree.”

7. **Dual-model Owner search pages two collections, then merges.** Each model fetches `limit+1`. The merged page can skip or duplicate across Form vs Call. Leave it. Do not “fix” interleaving in this pass, or drop the unused model so “cursor is honest.”

8. **List `origin` filter vs displayed origin.** Filter can be `external_sheet_ingestion`. `summarizeCase` / `detailCase` default a missing field to `employee_booking`. Best Relocation import cases write the import origin on the sibling Leadless writer; employee submit never writes `origin` (schema default). Do not force-display the filter value so “the row matches the query,” or write `employee_booking` from this file so “every case stamps origin.”

9. **Correct-pending skips `assertAllowedCaseAction`.** It only checks `status === "pending"`. Policy already lists `update_pending` on pending. Live Booking state is still asserted. Do not call dismiss/reassign rules from here, or allow resolved cases to patch the Booking so “the Owner can always edit money.”

10. **Refresh has no status or live-Booking fence.** A resolved or cancelled case can still refresh cards. Do not add `assertAllowedCaseAction` so “refresh is an act,” or refuse cancelled refresh so “inspection cannot see new cards.”

11. **`preparedFromCase` drops `agentAllocations` and `local`.** Refresh, search, resolve, and reopen rebuild the prepared bag from the stored submission. Correct-pending re-prepares from the patch and writes allocations onto the Booking. Attach reads the Booking for money / agents. Do not copy allocations into `preparedFromCase` so “the bag is complete,” or re-prepare on every refresh so “allocations stay live.”

12. **`matching_unavailable` on an Owner attempt is dead.** `buildMatchAttempt` maps that matcher reason to attempt `error`. This **interface** never catches a thrown finder. Submit / rematch stamp that reason themselves. Do not throw from refresh so “the cron has something to do,” or return `matching_unavailable` on empty cards so “no cards is an error.”

13. **Reopen clears the rematch lease on purpose.** Comment in file: a reopened cancelled Booking is inspection; it must not re-enter automatic rematch while cancellation is still active. `next_attempt_at` / `leased_until` / `lease_owner` are wiped. Do not stamp a new `next_attempt_at` so “reopen retries,” or skip the wipe so “the cron continues.”

14. **`lead_cancelled` and `lead_already_booked` cannot be overridden.** `assertLeadAttachable` throws before overrides matter. Overrideable set is `duplicate_lead`, `source_conflict`, `channel_conflict`, `source_unassigned`, `same_company_legacy`, `created_on_unmatched` — and the list must match **exactly**. Do not allow cancelled-Lead attach so “the Owner said so,” or treat `same_company_legacy` as hard-block so “auto-match and Owner agree.”

15. **`source_conflict` needs both `source_resolution` and the exact override.** Missing resolution throws first. Do not infer `preserve_lead_source` so “attach can proceed,” or apply the submission Source without the Owner choice.

16. **Dismissed may `attach_existing`; it may not mint.** Policy: pending → dismiss / attach / mint / correct-pending; dismissed → attach, reassign, reopen; resolved → reassign, reopen. Already attached: only reassign. Cancelled Booking: only reopen / dismiss. Leave those rules in `reconciliationPolicy.ts`. Do not allow mint on dismissed so “the Owner can always create,” or allow dismiss on an attached Booking so “the case can go quiet.”

17. **Create-and-attach can enqueue extra Lead sheet jobs.** The sibling returns `extraJobs` plus the Booking job. Persist each intent before commit. Do not drop extras so “resolve always has one job,” or finalize inside the sibling.

18. **Correct-pending does not record an owner event.** Refresh, resolve, and reopen do. Leave that gap visible. Do not add `booking.lead_reconciliation.updated` in this pass so “every write notifies,” or delete the refresh event so “none of them notify.”

19. **Owner search does not persist `latest_candidates`.** The Owner is looking past the auto-match set. Attach uses the live Lead id the Owner sent, not the last search page. Do not write search hits onto the case so “refresh and search share a list.”

20. **Leave sibling modules alone.** `queryEmployeeBookingCandidates`, `evaluateEmployeeBookingMatch`, `prepareEmployeeBookingSubmission`, `attachLeadToEmployeeBooking`, `createAndAttachReconciliationFormLead` / `CallLead`, `reassignEmployeeBookingLead`, `assertAllowedCaseAction`, `assertLiveBookingState`, `assertExactWarningOverrides`, `upsertCustomerFromBookingContact`, and `getLinkedLead` stay where they are. This file orchestrates the desk.

21. **Do not treat Granot Booking Reconciliation as this story.** `granotLifecycle/bookingReconciliation.ts` exports a different `searchBookingLeadCandidates`. That case is not a Booking. This case sits on an official employee Booking.

22. **Do not treat Book The Employee Job, rematch cron, or Book a Leadless Job as this story.** Submit opens the case. Rematch claims later. Admin / Best Relocation Leadless may open an import-origin case; this file works whichever origin is stored.

23. **Do not silently reorder Sheet Sync.** Intent is remembered inside the write; finalize runs after commit. Begin must not finalize. Public resolve must not persist intent after commit.

## Testing

The **interface** is the test surface: `browseTheOwnerCases`, `openTheOwnerCase`, `searchAnyKnownContactForThisJob`, `refreshTheCardsWithoutClaiming`, `correctThePendingEmployeeJob`, `workTheOwnerCase` / `beginWorkingTheOwnerCase`, `reopenTheOwnerCase`.

Today’s `bookingLeadReconciliation.service.test.ts` stubs Mongo for list / detail / search shape (including Granot / ingested snapshot paths and sanitized cards) and source-reads reopen for the two guards. That is the browse / search **seam**. It is not enough for refresh-without-claim, correct-pending, resolve, or reopen.

Add tests that name the operation. Do **not** add a test per helper (`preparedFromCase`, `hashCandidates`, `deriveLiveLeadWarnings`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Browse**
- Filters status / origin / reason / Source / `q` (including booking ObjectId).
- Missing stored `origin` still displays `employee_booking` (already locked).
- Detail includes `attached_lead` only when the Booking has `lead_ref` + `lead_model` (already locked).

**Search any known contact**
- Call `q` / phone / name / email include Granot and ingested paths (already locked).
- Returned snapshots are sanitized (already locked).
- Does not call `queryEmployeeBookingCandidates`.
- Does not write `latest_candidates` or increment revision.

**Refresh without claiming**
- Matcher `linked` → attempt `high_confidence`, cards stored, `reason` unchanged, no `lead_ref`.
- Matcher `pending` → cards stored, `reason` unchanged.
- Stale revision → 409.
- No Sheet Sync finalize.

**Correct the pending Job**
- Non-pending case → 409.
- Another Booking owns the new Job Number → 409.
- Attached or cancelled Booking → 409 from live state.
- Matcher `linked` after the patch → cards stored, `reason` unchanged, still leadless.
- Matcher `pending` → `reason` overwritten.
- Sheet Sync `booked_lead` / `employee_booking.update_pending` remembered before commit and finalized after.
- Customer upsert runs inside the write.

**Work the Owner case**
- Pending `dismiss` → `dismissed`, no Sheet job, event `dismissed`.
- `attach_existing` with exact overrides → sibling attach, case `resolved`, sheets finalized after commit.
- `source_conflict` without `source_resolution` → 409.
- Override list not exact → 409.
- Cancelled Lead / Lead booked elsewhere → 409, not overrideable.
- Dismissed `create_and_attach` → 409 (mint is pending-only).
- Already attached `attach_existing` / `dismiss` → 409; `reassign` is the act.
- Begin export does not call `runSheetSyncWrite` or `finalizeSheetSync` (already locked in `domainCommands.test.ts`).
- Canonical `attachBookingToLead` still 409s when the live Lead has an overrideable warning.

**Reopen**
- Leadless dismissed / resolved → `pending`, rematch lease cleared, matcher recorded, no claim.
- Cancelled Booking may reopen; `next_attempt_at` stays empty.
- Attached Booking → 409.

Do not prove claim internals, mint field mapping, rematch cron, or the five scoring rules here. Those are sibling **interfaces**. Do not assert that refresh attaches on `linked` — it does not.

## What I would not do

- A `BookingLeadReconciliationService` class with `list` / `get` / `update` / `resolve`.
- Thirty two-line functions that only wrap `assertRevision` or `summarizeCase`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or one file per resolve action.
- Breaking the before-commit / after-commit **seam**. Sheet Sync finalize and owner events stay after the Mongo write. Begin must not finalize.
- Inventing a begin / complete **seam** for refresh, search, or reopen (one **adapter** each).
- Treating Book The Employee Job, Pick The Unique Lead, rematch cron, Granot Owner Confirm, or admin Book a Leadless Job as this story.
- Pulling `claimAvailableLeadForBooking` into refresh / correct-pending / reopen so every `linked` attaches.
- Routing Owner search through the six operational lookups, or Granot snapshot paths through the auto-match finder.
- Opening Wave B or the next service while this checklist has unchecked modules.
