# Cancel The Booking This Release Case Already Named — Or Replace Official Fields — Or Close The Case With No Official Write — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 28 of this service — `releaseOwnerCommands.ts`
- Remaining in this service: `discrepancies.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/releaseOwnerCommands.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/release-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/release-reconciliation.md) lists this file as primary code beside `releaseReconciliation.ts`, the Release case model, `processor.ts`, and `projections.ts` — they are siblings, not this pass. Owner-command door, confirm-cancellation, official replace, No Action, and post-commit sheets: same file. Executor / `EntityChange` / “not on the registry object”: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). The registry `createCancellation` lives in `domainCommands/cancellations.ts` and the registry `updateBooking` lives in `domainCommands/bookings.ts` — same persisted names, different **adapters**. Verified CAS write: [`docs/knowledge/services/cancelled-lead.md`](../../../docs/knowledge/services/cancelled-lead.md) and [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Flag: `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED` (checked-in false). Derived allocations: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md). Distinct from opening the case: [recommendations/granot-lifecycle-release-reconciliation.md](granot-lifecycle-release-reconciliation.md). Distinct from Booking-case official replace / Booking No Action: [recommendations/granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md). Distinct from public Cancel This Booking: [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from the exact Booking-id replace that takes no case: `domainCommands/bookings.ts`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`releaseOwnerCommands.ts` row). This checkout’s `CONTEXT.md` does not define Granot Release Reconciliation Case / Cancellation / Update Existing Booking / No Action / Granot Record Link / Entity Change — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three HTTP callers, via the case barrel.** `routes/granot-lifecycle-admin.routes.ts` (`POST .../release-cases/:id/confirm-cancellation` → `confirmCancellation` imported from `releaseReconciliation.ts` as `confirmGranotCancellation`; 201, or 200 on replay / `already_satisfied`; `requireRegistryOwnerActor` + one `Idempotency-Key`. `POST .../release-cases/:id/update-booking` → `updateExistingBooking` as `updateGranotReleaseBooking`; always 200. `POST .../release-cases/:id/no-action` → `noAction` as `resolveGranotReleaseNoAction`; always 200). Route unit stubs `deps.confirmCancellation` / `deps.updateReleaseBooking` / `deps.releaseNoAction`. Replica proof lives in `releaseOwnerCommands.replica.test.ts` (AC-21 / AC-25 / AC-26 / AC-32: complete cancel chain, Referral cancel without a Lead, `already_satisfied`, official replace, exact replay, pairwise one-winner, injected-boundary rollback). Not callers: `processor.ts`, `releaseReconciliation.ts` (re-export only), `bookingOwnerCommands.ts` (same export names, different case), `discrepancyOwnerCommands.ts`, `domainCommands/cancellations.ts`, `domainCommands/bookings.ts`, `canonicalDomainCommands` (these commands are **not** on the registry object), public `POST /api/v1/cancelled-leads`. There is no `releaseOwnerCommands.test.ts` (UNIT-27.md still names one).
- Seams callers need: public review vs executor `operation` / after-commit `finalizeSheetSync` (manual; this file does not use `executeCanonicalCommandWithPostCommit`); mint Cancellation vs `already_satisfied`; official replace vs `already_satisfied`; Owner initiator vs processor actor from first evidence; this case-owned `createCancellation` vs the public/registry adapter that 409s Referral Bookings; this case-owned `updateBooking` vs Booking-case review and vs the registry primitive that takes a Booking id and no case
- Split later (only if the file outgrows one sitting): keep one file — this ~860-line module is one screenplay for “the owner reviewed the Release this case already named — cancel the Booking, replace official fields, or close the case with no official write.” If it later splits: `cancelTheBookingThisReleaseCaseNamed.ts` / `replaceOfficialFieldsOnTheBookingThisReleaseCaseNamed.ts` / `closeThisReleaseCaseWithoutWritingACancellation.ts` — story files, never `create.ts` / `update.ts` / `noAction.ts` / `apply.ts`, and never merge case open / Booking-case review / public Cancel This Booking into this file

`confirmCancellation` / `updateExistingBooking` / `noAction` are executor mechanics. The owner questions are: *Granot released this Job. We already have a Booking. The owner typed official cancellation details. If Release commands are on, the case is still open `release` at the expected revision, the reviewed source is still active, and the Booking still belongs to this Job: CAS-claim that Booking, write one complete `CancelledLead`, optionally mirror the already-linked Lead, resolve the case. After commit, project the Cancellation Chain. If that official Cancellation already exists and still points at this Booking, just resolve the case. Never resolve a Booking from a client id. Never CRM-post. Never upsert a Customer. Never invent a Lead on a Referral Booking.* And: *The owner typed new official Booking details instead of cancelling. Replace only Book Date, Agents, Binder, Deposit, and Merchant. Mirror deposit thresholds onto the already-linked Lead. Resolve the case. After commit, project the Booking Chain. If those official facts are already true, just resolve the case.* And: *The owner decided this case needs no official write. Resolve it. Write the Command. Touch nothing else.*

Case open/refresh, Booking-case review, public Cancel This Booking, the registry Booking-id replace, and derived allocations already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one Owner-review story, not “a cancellation CRUD service,” and not the case open / Booking-case review / public Cancel This Booking:

1. **Cancel the Booking this Release case already named — or recognize it is already cancelled** — refuse a missing / non-owner actor, a missing idempotency key, or a case with no first-evidence Receipt / Observation / Decision. Inside the transaction: reread the case. Refuse unless it is still open `action_kind:"release"` at the expected `case_revision` and Release commands are on. The deterministic Booking must still exist. Revalidate the reviewed source (Source Scope or Referral). Job Number, source / Referral disposition, optional Lead pointer, and optional active Record Link must still claim this Booking. If the Booking already has a Cancellation and that one row’s id is exactly `booking.cancelled`: resolve `already_satisfied` with no Change and no outbox. A Booking that says cancelled with a mismatched or missing Cancellation row is `IDENTITY_CONFLICT`. Otherwise refuse a stale `expected_booking_revision`, then call `createCancellationForVerifiedBookingInTransaction` to CAS-claim the Booking on `_id` + revision + Job + not-cancelled, insert the preallocated `CancelledLead`, and optionally CAS-mirror the already-linked Lead. Remember two or three `EntityChange` rows (Booking, Cancellation, optional Lead). Resolve the case `cancellation_created`. Enqueue `cancellation_chain` / `cancelled_lead.create` in the same session. This function does not resolve a Booking from a client id. This function does not CRM-post. This function does not upsert a Customer. This function does not invent a Lead on a Referral Booking.

2. **Replace official fields on the Booking this Release case already named — or recognize they already match** — same owner door and first-evidence chain. Inside the transaction: reread an open `release` case at the expected revision. Release commands must be on. The Booking must still exist, not be cancelled, and still sit at `expected_booking_revision`. Same identity / source / link checks as cancel. Agents / Merchant must still be active. If official fields and (when a Lead exists) deposit thresholds already match: resolve `already_satisfied` with no Change and no outbox. Otherwise `$set` only Book Date, derived allocations, Binder, Deposit, Merchant, and the two deposit flags. CAS the Booking on `_id` + revision + Job + not-cancelled. If thresholds drifted, CAS the already-linked Lead on `_id` + revision + `booked` and `$set` only `over_2000` / `over_4000`. Remember one or two `EntityChange` rows. Resolve the case `booking_updated`. Enqueue `booking_chain` / `booked_lead.update` in the same session — including when the Booking is a Referral. This function does not insert a Booking. This function does not write `booking_ref`. This function does not cancel.

3. **Close the case without writing a Cancellation or Booking** — same owner door and first-evidence chain. Inside the transaction: reread an open `release` case at the expected revision. Release commands must be on. Revalidate the reviewed source. CAS the case to `resolved` / `no_action`. Optional reason code/text are metadata only. Remember the deterministic Booking id on the resolution; do not load or mutate it. This function does not write a Booking, Cancellation, Lead, Record Link, `EntityChange`, Sheet Sync intent, discrepancy, notification, or replacement case.

4. **After commit, project sheets only when something official changed** — reload the durable command and resolved case, or throw. `finalizeSheetSync` runs only when this attempt was not a replay **and** the case resolved `cancellation_created` (Cancellation Chain) or `booking_updated` (Booking Chain) with the matching id. Replay, `already_satisfied`, and No Action do not dispatch. This function does not persist the outbox after commit.

There is no fifth mutate operation. `prepareOwnerCommand` / `loadOpenCase` / `assertReleasePolicy` / `loadActiveCatalog` / `resolveCase` are beats, not public stories. Form and Call Lead persist are two **adapters** of one “mirror the already-linked Lead” rule. Source Scope vs Referral policy are two **adapters** of one “the reviewed source is still live” rule. The executor `operation` plus the manual after-commit finalize is the before-commit / after-commit **seam**, not a second public export. `ReleaseOwnerCommandResult` is this file’s Owner-command envelope; it returns `cancellation_created`, `booking_updated`, `already_satisfied`, or `no_action`.

## Organization

Keep one file as the screenplay for “the owner reviewed the Release this case already named; cancel the Booking, replace official fields, or close the case with no official write, then tell sheets only when something official changed.” Case open, Booking-case review, public Cancel This Booking, the registry Booking-id replace, and even-cent split already live in deeper **modules**. Do not pull those in. Do not invent a `ReleaseOwnerCommandService` class. Do not invent a second `begin` / `complete` export — `executeIdempotentCanonicalCommand` plus the post-commit `finalizeSheetSync` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `releaseReconciliation.ts` so “knowledge lists both as primary code.” Do not move this into `bookingOwnerCommands.ts` so “one `updateExistingBooking` / `noAction`.” Do not move this into `cancellations/cancelledLead.service.ts` so “one `createCancellation`.” Do not move this into `domainCommands/cancellations.ts` or `domainCommands/bookings.ts` so “every command is registered.” Do not split `create.ts` / `update.ts` / `noAction.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `confirmCancellation` | `cancelTheBookingThisReleaseCaseNamed` | admin review’s official cancel |
| `updateExistingBooking` | `replaceOfficialFieldsOnTheBookingThisReleaseCaseNamed` | admin review’s official replace |
| `noAction` | `closeThisReleaseCaseWithoutWritingACancellation` | admin review’s zero-effect close |
| `ConfirmCancellationInput` | `ACancellationTheOwnerMayCommit` | case + both revisions + official cancel details + owner + key |
| `UpdateReleaseBookingInput` | `AReleaseReviewTheOwnerMayCommit` | case + both revisions + official booking details + owner + key |
| `ReleaseNoActionInput` | `AReleaseNoActionTheOwnerMayCommit` | case + revision + optional reason + owner + key |
| `CREATE_CANCELLATION_COMMAND_NAME` | keep — persisted `createCancellation` | durable command name; do not “fix” the collision with the public/registry adapter |
| `UPDATE_RELEASE_BOOKING_COMMAND_NAME` | keep — persisted `updateBooking` | durable command name; do not “fix” the collision with Booking-case review or the registry primitive |
| `RELEASE_NO_ACTION_COMMAND_NAME` | keep — persisted `resolveGranotReleaseCaseNoAction` | durable command name; do not share `noAction` with Booking / discrepancy |

Keep the old names as one-line aliases until the admin route and the case barrel migrate. Do not make callers learn `applyCancel` / `desiredBooking` / `reloadResult` as the domain language.

**Principle: old exports stay as aliases.** `confirmCancellation`, `updateExistingBooking`, and `noAction` remain the imported names until `granot-lifecycle-admin.routes.ts` and `releaseReconciliation.ts` point at the story names.

**No class for the workflow.** The type that *does* earn a name is the pending bag handed across commit:

```ts
type ReleaseReviewInProgress = {
  outcome: "cancellation_created" | "booking_updated" | "already_satisfied" | "no_action"
  bookingId: string
  cancellationId?: string
  sheet?:
    | { resource: "cancellation_chain"; operation: "cancelled_lead.create" }
    | { resource: "booking_chain"; operation: "booked_lead.update" }
}
```

That is the handoff from “the Booking, Cancellation or official fields, and case are saved — or the case just closed” to “project sheets only when we actually wrote something official.” Do **not** add Customer upsert or CRM Posting so “review matches public Cancel This Booking,” do **not** invent a Lead so “Referral cancel can mirror,” and do **not** route this file through `domainCommands/cancellations.ts` so “one `createCancellation`.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// releaseOwnerCommands.ts
// Granot released this Job. We already have a Booking.
// Cancel it. Or replace only official fields.
// Or close the case with no official write.
// After commit, project sheets only when something official changed.
// Never resolve a Booking from a client id. Never CRM-post.
// Never invent a Lead on a Referral Booking.
// This file does not open the case.

// ── 1. Cancel the Booking this Release case named ─────────

export async function cancelTheBookingThisReleaseCaseNamed(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheOfficialCancellation(session)
  //   completeTheReviewByProjectingSheets(pending)

async function beginTheOfficialCancellation(input, session, now)
  rereadTheOpenReleaseCase()
  refuseUnlessReleaseCommandsAreOn()
  loadTheDeterministicBooking()
  refuseUnlessTheReviewedSourceIsStillActive()      // Source Scope or Referral
  refuseIfTheBookingIdentityNoLongerMatchesTheCase()
  assertTheActiveLinkStillNamesThisBooking()
  ifTheOfficialCancellationAlreadyExists,
    resolveAlreadySatisfied()                       // no Change, no outbox
  refuseIfTheBookingRevisionDrifted()
  cancelTheVerifiedBooking()                        // sibling CAS primitive
  rememberTwoOrThreeEntityChanges()
  resolveTheCaseCancellationCreated()
  rememberCancellationChainIntent()

function resolveAlreadySatisfiedWhenAlreadyCancelled(booking, existing)
  ifExactlyOneCancellationAndItsIdIsBookingCancelled,
    resolveTheCaseAlreadySatisfied()
  else refuseIdentityConflict()                     // mismatched chain

// ── 2. Replace official fields on the Booking this case named ─

export async function replaceOfficialFieldsOnTheBookingThisReleaseCaseNamed(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheOfficialReplace(session)
  //   completeTheReviewByProjectingSheets(pending)

async function beginTheOfficialReplace(input, session, now)
  rereadTheOpenReleaseCase()
  refuseUnlessReleaseCommandsAreOn()
  loadTheDeterministicBookingAtTheExpectedRevision()
  refuseIfTheBookingIsAlreadyCancelled()
  refuseUnlessTheReviewedSourceIsStillActive()
  refuseIfTheBookingIdentityNoLongerMatchesTheCase()
  assertTheActiveLinkStillNamesThisBooking()
  loadActiveAgentsAndMerchant()
  ifOfficialFieldsAndLeadThresholdsAlreadyMatch,
    resolveAlreadySatisfied()                       // no Change, no outbox
  replaceOnlyTheOfficialFields()                    // CAS id + revision + Job
  mirrorDepositThresholdsOntoTheLinkedLead()        // Form / Call adapters
  rememberOneOrTwoEntityChanges()
  resolveTheCaseBookingUpdated()
  rememberBookingChainIntent()                      // always booking_chain

function replaceOnlyTheOfficialFields(booking, details)
  deriveAllocationsEvenly()                         // officialBookingAllocations
  $setBookDateAgentsBinderDepositMerchantAndFlags()
  doNotTouchJobSourceLeadPointerOrCustomerName()

// ── 3. Close the case without writing a Cancellation ──────

export async function closeThisReleaseCaseWithoutWritingACancellation(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheNoAction(session)

async function beginTheNoAction(input, session, now)
  rereadTheOpenReleaseCase()
  refuseUnlessReleaseCommandsAreOn()
  revalidateTheReviewedSource()
  resolveTheCaseNoAction()                          // optional reason metadata
  writeNoBookingCancellationLeadChangeOrOutbox()

// ── 4. After commit, project sheets only when something official changed ─

async function completeTheReviewByProjectingSheets(pending)
  reloadTheCommittedCaseAndBooking()
  ifWeCreatedACancellationAndThisIsNotAReplay,
    projectTheCancellationChain()
  ifWeReplacedOfficialFieldsAndThisIsNotAReplay,
    projectTheBookingChain()
```

Read the primary path out loud: *The processor already opened Owner work because Granot said this Job is released, and we already have a Booking. That case is not a Cancellation. The owner is looking at the case. They type a cancel date, refund, and reason — or a new Book Date, one Binder, Deposit, Merchant, a primary Agent, and maybe a second Agent. Release commands are on. The case is still open `release` at the revision they drafted. The Booking still sits at the revision they drafted. The reviewed source is still active. First evidence still names the same Observation. If they confirmed the cancel: claim that Booking, write one complete Cancellation, stamp the Lead when one exists, remember the Changes, resolve the case, and after commit project the Cancellation Chain. If that official Cancellation is already there and still points at this Booking, just resolve the case and do not dispatch sheets. If they typed new official Booking details instead: replace only those fields. Leave Job, source, Lead pointer, and customer name alone. If deposit crossed 2000 or 4000, mirror those two flags onto the already-linked Lead. After commit, project the Booking Chain — even when the Booking is a Referral. If those official facts are already true, just resolve the case. If the owner instead says this case needs no official write, resolve it and stop. Nobody resolves a Booking from a client id. Nobody CRM-posts. Nobody upserts a Customer. Nobody invents a Lead on a Referral Booking. Nobody calls public Cancel This Booking. Nobody calls the registry `createCancellation` or the registry `updateBooking` that takes a Booking id and no case.*

That is the operation. `confirmCancellation` is not a CRUD create. `updateExistingBooking` is not a CRUD update. `noAction` is not a delete.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This `createCancellation` is not the public / registry `createCancellation`.** `domainCommands/cancellations.ts` / `existingWrites` resolve a Booking from a client id, snapshot the chain, 409 Referral Bookings, and sit on `canonicalDomainCommands`. This file already has a verified Booking, calls the CAS primitive, can cancel a Referral with no Lead, and is **not** on the registry object. Same persisted command name, two **adapters**. Do not route review through the public write so “one `createCancellation`,” and do not add this file to the registry object so “every command is registered.”

2. **This `updateBooking` is the third `updateBooking`.** `domainCommands/bookings.ts` takes a Booking id and no case. `bookingOwnerCommands.ts` reviews an open Booking case and, on Referral, queues `referral_booking.update`. This file reviews an open Release case and always queues `booking_chain` / `booked_lead.update`, including Referral. Same persisted command name, three **adapters**. Do not route Release review through Booking-case review so “one `updateExistingBooking`,” and do not start queuing `referral_booking.update` so “Release matches Booking review.”

3. **Public Cancel This Booking 409s Referral; this file cancels it.** `.cursor/okf-workspace/CONTRADICTIONS.md` `public-v1-referral-cancel-vs-gated-release` already names this. Replica AC-25 locks two Changes (Booking + Cancellation), no Lead Change, and the leftover Form Lead still `cancelled: undefined`. Do not call the resolver so “one cancel path,” and do not invent a Lead so “Referral cancel can mirror.”

4. **Command-door gates are required; the route already checked the owner.** The route requires `requireRegistryOwnerActor` and one `Idempotency-Key`. This file still asserts owner + key, then rereads case / both revisions / flag / source / Booking / catalogs inside the transaction. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the route already authorized,” and do not skip the route gate so “the command can take a raw review.”

5. **`already_satisfied` on cancel ignores the typed refund.** A later open case against an already-cancelled Booking resolves with the existing Cancellation id even when the owner typed a different date and a $999 refund. Zero Changes, zero outbox. A Booking that says cancelled with a mismatched or missing Cancellation row is `IDENTITY_CONFLICT`, not another insert. Do not apply the new refund so “the owner typed it,” and do not skip case resolution so “nothing changed.”

6. **`already_satisfied` on replace is not a no-op skip of the case.** Same official facts + same Lead thresholds resolve the case with zero Changes and zero outbox. A deposit off by a cent is a replace. A Lead-only threshold repair still `$set`s the Booking first — `already_satisfied` requires both. Do not skip the Booking write so “the Booking already matches,” and do not treat a Lead-only drift as `already_satisfied`.

7. **Release replace always queues the Booking Chain.** Booking-case Referral review queues `booked_lead` / `referral_booking.update` and never touches a Lead. This file queues `booking_chain` / `booked_lead.update` even when `assertReleasePolicy` returned `referral_booking`. Do not switch the outbox so “Release matches Booking review,” and do not split `referralReleaseUpdate.ts` so “one file per disposition.”

8. **The verified write owns claim / insert / Lead mirror; this file owns policy / Changes / case / outbox.** `createCancellationForVerifiedBookingInTransaction` throws bare `DOMAIN_REVISION_CONFLICT` / `GRANOT_IDENTITY_CONFLICT` strings; this file remaps them to lifecycle 409s and also injects `test_fail_after` booking / cancellation / lead into that sibling. Do not move Changes into the verified write so “one cancel is complete,” and do not inline the CAS here so “one file owns the claim.”

9. **Finalize is manual, not `executeCanonicalCommandWithPostCommit`.** Confirm and replace both reload evidence, then call `finalizeSheetSync` only for a non-replay official write. No Action returns `reloadResult` and never finalizes. Knowledge says Sheet delivery is post-commit only; intent stays in-session. Do not move `finalizeSheetSync` inside the `operation` so “the projection is atomic,” and do not dispatch on `already_satisfied`, replay, or No Action so “the case resolved.”

10. **`noAction` is three different Owner closes.** This file, `bookingOwnerCommands.ts`, and `discrepancyOwnerCommands.ts` all export `noAction`. Persisted names already tell them apart (`resolveGranotReleaseCaseNoAction` / `resolveGranotBookingCaseNoAction` / `resolveGranotDiscrepancyNoAction`). Do not share one function so “one No Action,” and do not rename the persisted Release command to `noAction`.

11. **Identity fields cannot change on replace.** Replica AC-25 locks Job and Lead pointer across the replace; source company / ingestion origin / CPL on the Lead stay put. `$set` only the official bag. Do not `$set` the Lead source so “review can re-home the Job,” and do not copy the Lead’s landing-page source onto the Booking so “they match.”

12. **Deposit thresholds are derived twice, on purpose.** Booking stores `over_2000` / `over_4000` from the typed Deposit. The Lead CAS copies those two flags only. Do not derive them again on the Lead from a different number, and do not skip the Lead mirror so “the Booking already has them.”

13. **Official details reject `agent_allocations[]`; this file derives them.** `officialBookingAllocations` even-cent splits Binder across primary / optional secondary. Do not accept a caller allocation list so “the owner typed the split,” and do not pull `splitBinderEvenly` into this file so “one allocation writer.”

14. **Cancel notes stay out of Change values.** Replica AC-26 stringifies every `EntityChange.fields` and forbids the private note. Do not start persisting `notes` on the Change so “the owner typed it.”

15. **There is no mode on a Release case.** `loadOpenCase` only checks `action_kind === "release"` + `state === "open"` + revision. Booking-case review branches on `review_existing_booking` / `create_missing_booking` / `create_referral_booking`. Do not invent a Release mode so “the two case writers match,” and do not start refusing `create_missing_booking` here.

16. **Injected failure points are a test seam, not a product export.** `test_fail_after` / `test_fail_after_case` exist so replica AC-32 can abort after booking, cancellation, Lead, Changes, case, or outbox and prove the transaction hides all of it. Do not delete the hooks so “runtime has no test flags,” and do not promote them onto the public **interface**.

17. **UNIT-27.md still names `releaseOwnerCommands.test.ts`.** Disk has only the replica. Route unit stubs the three HTTP deps. Do not invent a unit file in this rename so “the completion report wins,” and do not drop the replica until a later pass owns the same AC numbers.

18. **Leave sibling modules alone.** Case open stays in `releaseReconciliation.ts`. Booking-case review stays in `bookingOwnerCommands.ts`. The verified CAS write stays in `cancellations/cancelledLead.service.ts`. Public Cancel This Booking stays in the leftover / `existingWrites` path. The registry Booking-id replace stays in `domainCommands/bookings.ts`. Even-cent split stays in `agents/agentAllocation.service.ts`. Executor / `EntityChange` stay in `domainCommands/`. Sheet finalize stays in `sheetSync`. ObjectId construction stays in `utils/objectId.ts`.

19. **Do not treat case open, Booking-case review, public Cancel This Booking, registry Booking-id replace, or discrepancy close as this story.** Those open Owner work, review a Booking case, cancel from a client id, replace official fields with no case, or close a discrepancy. This file only reviews an open Release case that already named a Booking — or closes that case with no official write.

20. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `cancelTheBookingThisReleaseCaseNamed` (today `confirmCancellation`), `replaceOfficialFieldsOnTheBookingThisReleaseCaseNamed` (today `updateExistingBooking`), and `closeThisReleaseCaseWithoutWritingACancellation` (today `noAction`). The three input types are part of that **interface**. There is no `releaseOwnerCommands.test.ts`. `releaseOwnerCommands.replica.test.ts` is the real proof. Keep those cases. Add command-level names for the gaps (replica may stay the Mongo proof):

**Cancel the Booking this Release case already named**
- Concurrent cancel versus cancel / update / No Action on the same case-revision commits one Command and one case revision (already locked).
- Exact replay returns the same command id and does not add a second Cancellation, Change, or outbox (already locked).
- A later open case against the same already-cancelled Booking is `already_satisfied` with the existing Cancellation id and zero new Changes (already locked).
- Injected failure after booking / cancellation / Lead / Changes / case / outbox leaves Booking uncancelled, no `CancelledLead`, case-open, no Command, no Changes, no outbox (already locked).
- Referral cancel writes two Changes, no Lead Change, and leaves the leftover Form Lead uncancelled (already locked).
- Private notes do not enter `EntityChange.fields` (already locked).
- Flag-off is `POLICY_BLOCKED` and writes nothing (add this; today’s replica always injects `release_commands_enabled: true`).
- Stale `case_revision` or stale Booking revision is `CASE_REVISION_CONFLICT` / `DOMAIN_REVISION_CONFLICT` (add this).
- Mismatched `booking.cancelled` versus Cancellation rows is `IDENTITY_CONFLICT` (add this).
- Incompatible Job / source / Lead / link is `IDENTITY_CONFLICT` (add this).
- Admin is denied at the route; Owner plus one key is required (already locked in the route unit).
- Do not add a test that this file resolves a Booking from a client id or invents a Lead.

**Replace official fields on the Booking this Release case already named**
- Concurrent update versus No Action on the same case-revision commits one Command and one case revision (already locked).
- Exact replay returns the same command id and does not add Changes or outbox (already locked).
- Job / Lead pointer stay unchanged; Deposit 2500.5 sets Lead `over_2000` (already locked).
- Injected failure after booking / Lead / Changes / case / outbox leaves Booking revision 0 and case-open (already locked).
- Same official facts + matching Lead thresholds is `already_satisfied` with zero Changes (add this; today’s replica only locks cancel `already_satisfied`).
- Flag-off is `POLICY_BLOCKED` and writes nothing (add this).
- Cancelled Booking is `DOMAIN_REVISION_CONFLICT` (add this).
- Inactive Agent / Merchant is `VALIDATION_FAILED` and leaves the Booking at the old revision (add this).
- Referral replace still queues `booking_chain` / `booked_lead.update`, not `referral_booking.update` (add this).
- Do not add a test that this file inserts a Booking or writes `booking_ref`.

**Close the case without writing a Cancellation**
- No Action resolves the case, writes one Command, and leaves Booking / Lead / Cancellation / Changes / outbox counts unchanged (already locked).
- Exact replay returns the same command id and does not increment `case_revision` again (already locked).
- Injected failure after the case write leaves the case open and writes no Command (already locked).
- Optional reason code/text land on the resolution and do not become official fields (already locked).
- Do not add a test that No Action finalizes sheets or writes an `EntityChange`.

**After commit, project sheets only when something official changed**
- `cancelled_lead.create` intent is remembered before commit; `finalizeSheetSync` runs after a non-replay cancel (replica outbox resource already locked).
- `booked_lead.update` intent is remembered before commit; `finalizeSheetSync` runs after a non-replay replace (replica outbox count already locked).
- Replay, `already_satisfied`, and No Action do not dispatch a second job (already locked).
- Do not add a test that finalize runs inside the transaction.

Do **not** add a test per helper (`cents`, `desiredBooking`, `sameOfficialBooking`, `cancellationBody`, `failAfter`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test case open/refresh, Booking-case review, public Cancel This Booking, or the registry Booking-id replace here. Do not add a test that this file upserts a Customer, CRM-posts, or resolves a Booking from a client id. Do not add a test that review lives in `releaseReconciliation.ts` or `domainCommands/cancellations.ts`.

## What I would not do

- A `ReleaseOwnerCommandService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save`.
- Moving this into a CRUD folder, or into `releaseReconciliation.ts` / `bookingOwnerCommands.ts` / `cancelledLead.service.ts` / `domainCommands/cancellations.ts` / `domainCommands/bookings.ts` “for cleanliness.”
- Splitting `create.ts` / `update.ts` / `noAction.ts` / `apply.ts`.
- Routing this file through public Cancel This Booking or the registry `createCancellation` so “one cancel.”
- Routing this file through Booking-case review or the registry `updateBooking` so “one Booking replace.”
- Queuing `referral_booking.update` so “Release matches Booking review.”
- Inventing a Lead on Referral cancel so “every cancel mirrors.”
- Dispatching sheets on replay, `already_satisfied`, or No Action.
- Opening the case from this file so “review can create the work.”
- Applying a new refund on `already_satisfied` so “the owner typed it.”
- Writing a whole-folder recommendation for `granotLifecycle`.
