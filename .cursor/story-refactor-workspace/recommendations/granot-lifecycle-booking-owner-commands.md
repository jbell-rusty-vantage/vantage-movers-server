# Replace Official Fields On The Booking This Case Already Named — Or Close The Case With No Official Write — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 24 of this service — `bookingOwnerCommands.ts`
- Remaining in this service: `bookingPriorityPairing.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/bookingOwnerCommands.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) lists this file as primary code beside `bookingReconciliation.ts`, `bookingPriorityPairing.ts`, `bookingConfirmation.ts`, `referralBooking.ts`, the case model, and `processor.ts` — they are siblings, not this pass. Owner-command door, official replace, No Action, and post-commit sheets: same file. Executor / `EntityChange` / “not on the registry object”: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). The registry `updateBooking` primitive lives in `domainCommands/bookings.ts` — same persisted name, different **adapter**. Flag: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) (`GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`; Referral review / Referral No Action also need `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED`). Derived allocations: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md). Distinct from opening the case: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md). Distinct from minting the first official Booking: [recommendations/granot-lifecycle-booking-confirmation.md](granot-lifecycle-booking-confirmation.md). Distinct from no-Lead Referral mint: next-but-later `referralBooking.ts`. Distinct from the exact aggregate replace that takes a Booking id and no case: `domainCommands/bookings.ts`. Distinct from Release update / Release No Action: later `releaseOwnerCommands.ts`. Distinct from public Book This Lead: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`bookingOwnerCommands.ts` row). This checkout’s `CONTEXT.md` does not define Granot Booking Reconciliation Case / Update Existing Booking / No Action / Referral Booking / Granot Record Link / Entity Change — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **two HTTP callers, via the case barrel.** `routes/granot-lifecycle-admin.routes.ts` (`POST .../booking-cases/:id/update-booking` → `updateExistingBooking` imported from `bookingReconciliation.ts` as `updateGranotBooking`; always 200; `requireRegistryOwnerActor` + one `Idempotency-Key`. `POST .../booking-cases/:id/no-action` → `noAction` as `resolveGranotBookingNoAction`; always 200). Route unit stubs `deps.updateBooking` / `deps.noAction`. Replica proof lives in `bookingConfirmation.replica.test.ts` (AC-20 / AC-21 / AC-24 / AC-32: full official replace, exact replay, `already_satisfied`, injected-boundary rollback, update-versus-No-Action one winner). Referral review + Referral No Action are seeded from `referralBooking.replica.test.ts` (AC-28 / AC-32: no Lead Change, no candidates, No Action writes nothing official). Not callers: `processor.ts`, `bookingReconciliation.ts` (re-export only), `bookingConfirmation.ts` (owns the shared result type), `referralBooking.ts` (except the replica that calls this file), `domainCommands/bookings.ts`, `canonicalDomainCommands` (this command is **not** on the registry object; the registry `updateBooking` is the other **adapter**), `releaseOwnerCommands.ts` (same export names, different case), `discrepancyOwnerCommands.ts`, public `/api/v1/booked-leads`.
- Seams callers need: public review vs executor `operation` / after-commit `finalizeSheetSync` (manual; this file does not use `executeCanonicalCommandWithPostCommit`); official replace vs `already_satisfied`; standard Booking Chain vs Referral master-only sheet; Owner initiator vs processor actor from first evidence; this case-owned `updateBooking` vs the registry primitive that takes a Booking id and no case
- Split later (only if the file outgrows one sitting): keep one file — this ~670-line module is one screenplay for “the owner reviewed the Booking this case already named — replace official fields, or close the case with no official write.” If it later splits: `replaceOfficialFieldsOnTheBookingThisCaseNamed.ts` / `closeThisBookingCaseWithoutWritingABooking.ts` / `projectTheBookingChainAfterReview.ts` — story files, never `update.ts` / `noAction.ts` / `apply.ts`, and never merge confirm / Referral mint / Release review into this file

`updateExistingBooking` / `applyUpdate` / `noAction` / `applyNoAction` are executor mechanics. The owner questions are: *Granot booked this Job. We already have a Booking. The owner typed new official details. If Booking commands are on, the case is still open `review_existing_booking`, both revisions still match, the reviewed source is still active, and the Booking still belongs to this Job: replace only Book Date, Agents, Binder, Deposit, and Merchant. Mirror deposit thresholds onto the already-linked Lead. Resolve the case. After commit, project the Booking Chain — or the Referral master sheet. If those official facts are already true, just resolve the case. Never mint a Booking. Never attach a Job. Never CRM-post. Never upsert a Customer. Never change Job, source, Lead pointer, or customer name.* And: *The owner decided this case needs no official write. Resolve it. Write the Command. Touch nothing else.*

Case open/refresh, first-time confirm, Referral mint, the registry Booking-id replace, Release review, and derived allocations already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one Owner-review story, not “a booking update CRUD service,” and not the case open / the first confirm / the Referral mint / the registry Booking-id replace / public Book This Lead:

1. **Replace official fields on the Booking this case already named — or recognize they already match** — refuse a missing / non-owner actor, a missing idempotency key, or a case with no first-evidence Receipt / Observation / Decision. Inside the transaction: reread the case. Refuse unless it is still open `review_existing_booking` at the expected `case_revision`, Booking commands are on, and the case names a deterministic Booking. That Booking must still exist, not be cancelled, and still sit at `expected_booking_revision`. Referral Bookings revalidate the live Referral Decision / source policy and must stay lead-less; standard Bookings revalidate the reviewed Source Scope and must still point at the same Lead + company + granularity. A Leadless non-Referral Booking is `IDENTITY_CONFLICT`. Source slug, Job Number, and optional active Record Link must still claim this Booking. Agents / Merchant must still be active. If official fields and (when a Lead exists) deposit thresholds already match: resolve `already_satisfied` with no Change and no outbox. Otherwise `$set` only Book Date, derived allocations, Binder, Deposit, Merchant, and the two deposit flags. CAS the Booking on `_id` + revision + Job + not-cancelled. If thresholds drifted, CAS the already-linked Lead on `_id` + revision + `booked` and `$set` only `over_2000` / `over_4000`. Remember one or two `EntityChange` rows. Resolve the case `booking_updated`. Enqueue `booking_chain` / `booked_lead.update`, or `booked_lead` / `referral_booking.update`, in the same session. This function does not insert a Booking. This function does not write `booking_ref`. This function does not CRM-post. This function does not upsert a Customer.

2. **Close the case without writing a Booking** — same owner door and first-evidence chain. Inside the transaction: reread an open `create_missing_booking`, `review_existing_booking`, or `create_referral_booking` case at the expected revision. Booking commands must be on; a Referral case also needs the Referral flag. Revalidate the reviewed source or Referral policy. CAS the case to `resolved` / `no_action`. Optional reason code/text are metadata only. If the case already named a Booking, remember that id on the resolution; do not load or mutate it. This function does not write a Booking, Lead, Record Link, `EntityChange`, Sheet Sync intent, discrepancy, notification, or replacement case.

3. **After commit, project sheets only when official fields actually changed** — reload the durable command and resolved case, or throw. `finalizeSheetSync` runs only when this attempt was not a replay **and** the case resolved `booking_updated` with a Booking id. Replay, `already_satisfied`, and No Action do not dispatch. This function does not persist the outbox after commit.

There is no fourth mutate operation. `prepareOwnerCommand` / `loadOpenCase` / `assertActiveSourceScope` / `assertActiveReferralPolicy` / `loadActiveCatalog` / `resolveCase` are beats, not public stories. Form and Call Lead persist are two **adapters** of one “mirror deposit thresholds onto the already-linked Lead” rule. Source Scope vs Referral policy are two **adapters** of one “the reviewed source is still live” rule. The executor `operation` plus the manual after-commit finalize is the before-commit / after-commit **seam**, not a second public export. `BookingOwnerCommandResult` is the shared Owner-command envelope; this file returns `booking_updated`, `already_satisfied`, or `no_action`.

## Organization

Keep one file as the screenplay for “the owner reviewed the Booking this case already named; replace official fields, or close the case with no official write, then tell sheets only when something official changed.” Case open, first-time confirm, Referral mint, the registry Booking-id replace, Release review, and even-cent split already live in deeper **modules**. Do not pull those in. Do not invent a `BookingOwnerCommandService` class. Do not invent a second `begin` / `complete` export — `executeIdempotentCanonicalCommand` plus the post-commit `finalizeSheetSync` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `bookingReconciliation.ts` so “knowledge lists both as primary code.” Do not move this into `bookingConfirmation.ts` so “one Owner command file.” Do not move this into `domainCommands/bookings.ts` so “one `updateBooking`.” Do not move this into `referralBooking.ts` so “Referral review lives with Referral mint.” Do not move this into `releaseOwnerCommands.ts` so “one `noAction`.” Do not split `update.ts` / `noAction.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `updateExistingBooking` | `replaceOfficialFieldsOnTheBookingThisCaseNamed` | admin review’s official replace |
| `noAction` | `closeThisBookingCaseWithoutWritingABooking` | admin review’s zero-effect close |
| `UpdateExistingBookingInput` | `AReviewTheOwnerMayCommit` | case + both revisions + official details + owner + key |
| `BookingNoActionInput` | `ANoActionTheOwnerMayCommit` | case + revision + optional reason + owner + key |
| `UPDATE_BOOKING_COMMAND_NAME` | keep — persisted `updateBooking` | durable command name; do not “fix” the collision with the registry primitive |
| `BOOKING_NO_ACTION_COMMAND_NAME` | keep — persisted `resolveGranotBookingCaseNoAction` | durable command name; do not share `noAction` with Release / discrepancy |

Keep the old names as one-line aliases until the admin route and the case barrel migrate. Do not make callers learn `applyUpdate` / `applyNoAction` / `desiredBooking` as the domain language.

**Principle: old exports stay as aliases.** `updateExistingBooking` and `noAction` remain the imported names until `granot-lifecycle-admin.routes.ts` and `bookingReconciliation.ts` point at the story names.

**No class for the workflow.** The type that *does* earn a name is the pending bag handed across commit:

```ts
type BookingReviewInProgress = {
  outcome: "booking_updated" | "already_satisfied" | "no_action"
  bookingId?: string
  sheetOperation?: "booked_lead.update" | "referral_booking.update"
}
```

That is the handoff from “the Booking, Lead thresholds, and case are saved — or the case just closed” to “project sheets only when we actually replaced official fields.” Do **not** add Customer upsert or CRM Posting so “review matches public Book This Lead,” do **not** insert a Booking so “review can also confirm,” and do **not** route this file through `domainCommands/bookings.ts` so “one `updateBooking`.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingOwnerCommands.ts
// Granot booked this Job. We already have a Booking — or the owner
// decided not to write one.
// Replace only official fields on the Booking this case named.
// Or close the case with no official write.
// After commit, project sheets only when official fields changed.
// Never mint a Booking. Never attach a Job. Never CRM-post.
// This file does not open the case.
// This file does not confirm a missing Booking.

// ── 1. Replace official fields on the Booking this case named ──

export async function replaceOfficialFieldsOnTheBookingThisCaseNamed(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheOfficialReplace(session)
  //   completeTheReviewByProjectingSheets(pending)

async function beginTheOfficialReplace(input, session, now)
  rereadTheOpenReviewExistingCase()
  refuseUnlessBookingCommandsAreOn()
  loadTheDeterministicBookingAtTheExpectedRevision()
  ifReferral, refuseUnlessTheReferralPolicyIsStillLive()
  ifStandard, refuseUnlessTheReviewedSourceIsStillActive()
  refuseIfTheBookingIdentityNoLongerMatchesTheCase()
  refuseALeadlessNonReferralBooking()
  assertTheActiveLinkStillNamesThisBooking()
  loadActiveAgentsAndMerchant()
  ifOfficialFieldsAndLeadThresholdsAlreadyMatch,
    resolveAlreadySatisfied()                     // no Change, no outbox
  replaceOnlyTheOfficialFields()                  // CAS id + revision + Job
  mirrorDepositThresholdsOntoTheLinkedLead()      // Form / Call adapters
  rememberOneOrTwoEntityChanges()
  resolveTheCaseBookingUpdated()
  rememberSheetSyncIntent()                       // chain vs referral master

function replaceOnlyTheOfficialFields(booking, details)
  deriveAllocationsEvenly()                       // officialBookingAllocations
  $setBookDateAgentsBinderDepositMerchantAndFlags()
  doNotTouchJobSourceLeadPointerOrCustomerName()

function resolveAlreadySatisfied(booking, desired, lead)
  ifSameOfficialFactsAndSameLeadThresholds,
    resolveTheCaseAlreadySatisfied()
  else continueTheReplace()

// ── 2. Close the case without writing a Booking ───────────

export async function closeThisBookingCaseWithoutWritingABooking(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheNoAction(session)

async function beginTheNoAction(input, session, now)
  rereadAnOpenCreateMissingOrReviewOrReferralCase()
  refuseUnlessBookingCommandsAreOn()
  revalidateTheReviewedSourceOrReferralPolicy()
  resolveTheCaseNoAction()                        // optional reason metadata
  writeNoBookingLeadLinkChangeOrOutbox()

// ── 3. After commit, project sheets only when fields changed ─

async function completeTheReviewByProjectingSheets(pending)
  reloadTheCommittedCaseAndBooking()
  ifWeReplacedOfficialFieldsAndThisIsNotAReplay,
    projectTheBookingChainOrTheReferralMasterSheet()
```

Read the primary path out loud: *The processor already opened Owner work because Granot said this Job is booked, and we already have a Booking. That case is not a Booking. The owner is looking at the case. They type a new Book Date, one Binder, Deposit, Merchant, a primary Agent, and maybe a second Agent. Per-agent allocations are rejected; the server splits the Binder evenly. Booking commands are on. The case is still open `review_existing_booking` at the revision they drafted. The Booking still sits at the revision they drafted. The reviewed source is still active. First evidence still names the same Observation. Replace only those official fields. Leave Job, source, Lead pointer, and customer name alone. If deposit crossed 2000 or 4000, mirror those two flags onto the already-linked Lead. Remember the Changes and resolve the case. After commit, project the Booking Chain — or, on a Referral Booking, the master sheet only. If those official facts are already true, just resolve the case and do not dispatch sheets. If the owner instead says this case needs no official write, resolve it and stop. Nobody mints a Booking. Nobody attaches a Job. Nobody CRM-posts. Nobody upserts a Customer. Nobody calls public Book This Lead. Nobody calls the registry `updateBooking` that takes a Booking id and no case.*

That is the operation. `updateExistingBooking` is not a CRUD update. `applyUpdate` is not. `noAction` is not a delete.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This `updateBooking` is not the registry `updateBooking`.** `domainCommands/bookings.ts` takes a Booking id, expected revision, official details, and a caller-built context. It does not open a case, revalidate Source Scope, mirror Lead thresholds, or resolve Owner work. It is on `canonicalDomainCommands`. This file is not. Same persisted command name, two **adapters**. Do not route review through the registry primitive so “one `updateBooking`,” and do not add this file to the registry object so “every command is registered.”

2. **Command-door gates are required; the route already checked the owner.** The route requires `requireRegistryOwnerActor` and one `Idempotency-Key`. This file still asserts owner + key, then rereads case mode / both revisions / flag / source / Booking / catalogs inside the transaction. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the route already authorized,” and do not skip the route gate so “the command can take a raw review.”

3. **`already_satisfied` is not a no-op skip of the case.** Same official facts + same Lead thresholds resolve the case with zero Changes and zero outbox. A deposit off by a cent is a replace, not a conflict — unlike confirm, which treats a mismatched existing Booking as `IDENTITY_CONFLICT`. Do not start throwing `IDENTITY_CONFLICT` on a one-cent drift so “review matches confirm,” and do not skip case resolution so “nothing changed.”

4. **A Lead-only threshold repair still `$set`s the Booking.** `already_satisfied` requires both `bookingSatisfied` and `leadSatisfied`. If only the Lead flags drifted, the file still CAS-writes the same official fields onto the Booking before mirroring the Lead. Do not skip the Booking write so “the Booking already matches,” and do not treat a Lead-only drift as `already_satisfied`.

5. **The shared result type still lives on confirm.** `BookingOwnerCommandResult` is exported from `bookingConfirmation.ts`. This file returns `booking_updated` / `already_satisfied` / `no_action`. `reloadResult` remaps any leftover resolution to `no_action`. Do not start returning `booking_created` from review so “the union is honest,” and do not move the type into a `types.ts` CRUD folder. Leave the envelope on confirm until Referral mint migrates; then the type can follow the last caller.

6. **`noAction` is three different Owner closes.** This file, `releaseOwnerCommands.ts`, and `discrepancyOwnerCommands.ts` all export `noAction`. Persisted names already tell them apart (`resolveGranotBookingCaseNoAction` / `resolveGranotReleaseCaseNoAction` / `resolveGranotDiscrepancyNoAction`). Do not share one function so “one No Action,” and do not rename the persisted Booking command to `noAction`.

7. **Knowledge’s first No Action sentence is narrower than the code.** `booking-reconciliation.md` says No Action is for open standard create-missing or review-existing. The same page then says existing Referral review reuses No Action, and the code also accepts `create_referral_booking`. Replica AC-28 locks Referral create-missing No Action. Do not delete the Referral mode so the first sentence “wins,” and do not silently widen the knowledge sentence in this rename.

8. **Finalize is manual, not `executeCanonicalCommandWithPostCommit`.** Confirm and this file both reload evidence, then call `finalizeSheetSync` only for a non-replay official write. No Action returns `reloadResult` and never finalizes. Knowledge says Sheet delivery is post-commit only; intent stays in-session. Do not move `finalizeSheetSync` inside `applyUpdate` so “the projection is atomic,” and do not dispatch on `already_satisfied`, replay, or No Action so “the case resolved.”

9. **Standard review and Referral review are two sheet operations, not two files.** Source-scoped review queues `booking_chain` / `booked_lead.update`. Referral review queues `booked_lead` / `referral_booking.update` and never touches a Lead. Do not always queue the Booking Chain so “every Booking update is a chain,” and do not split `referralUpdate.ts` so “one file per disposition.”

10. **Identity fields cannot change.** Replica AC-20 locks Job, source, Lead pointer, and customer name across the replace. `$set` only the official bag. Do not copy the Lead’s landing-page source onto the Booking so “they match,” and do not `$set` the Lead source so “review can re-home the Job.”

11. **Deposit thresholds are derived twice, on purpose.** Booking stores `over_2000` / `over_4000` from the typed Deposit. The Lead CAS copies those two flags only. Do not derive them again on the Lead from a different number, and do not skip the Lead mirror so “the Booking already has them.”

12. **A Leadless non-Referral Booking is refused today.** The file treats `is_leadless_booking` as `IDENTITY_CONFLICT`. `docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md` later says that reject must drop for Granot official bookings. Do not drop the refuse in this rename so the later spec “wins,” and do not invent Connect-Booking-to-Lead here.

13. **Official details reject `agent_allocations[]`; this file derives them.** `officialBookingAllocations` even-cent splits Binder across primary / optional secondary. Do not accept a caller allocation list so “the owner typed the split,” and do not pull `splitBinderEvenly` into this file so “one allocation writer.”

14. **The replica file is confirm’s home; this module is the later seed.** `bookingConfirmation.replica.test.ts` locks confirm first, then update / No Action. `referralBooking.replica.test.ts` locks Referral mint first, then this file’s Referral review / Referral No Action. There is no `bookingOwnerCommands.test.ts`. Do not pull confirm or Referral mint into this file so “the test file is the module,” and do not drop those later seeds until a later pass owns them.

15. **Injected failure points are a test seam, not a product export.** `test_fail_after` / `test_fail_after_case` exist so replica AC-24 can abort after booking, Lead, Changes, case, or outbox and prove the transaction hides all of it. Do not delete the hooks so “runtime has no test flags,” and do not promote them onto the public **interface**.

16. **Leave sibling modules alone.** Case open stays in `bookingReconciliation.ts`. Confirm stays in `bookingConfirmation.ts`. Referral mint stays in `referralBooking.ts`. The registry Booking-id replace stays in `domainCommands/bookings.ts`. Release review stays in `releaseOwnerCommands.ts`. Even-cent split stays in `agents/agentAllocation.service.ts`. Public Book This Lead stays in `bookings/bookedLead.service.ts`. Executor / `EntityChange` stay in `domainCommands/`. Sheet finalize stays in `sheetSync`. ObjectId construction stays in `utils/objectId.ts`.

17. **Do not treat first-time confirm, Referral mint, case open, registry Booking-id replace, Release review, or public Book This Lead as this story.** Those mint a Booking, mint a no-Lead Referral, open Owner work, replace official fields with no case, review a Release, or write a Booking from a Mongo Lead id. This file only reviews an open case that already named a Booking — or closes a case with no official write.

18. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `replaceOfficialFieldsOnTheBookingThisCaseNamed` (today `updateExistingBooking`) and `closeThisBookingCaseWithoutWritingABooking` (today `noAction`). `UpdateExistingBookingInput` and `BookingNoActionInput` are part of that **interface**. There is no `bookingOwnerCommands.test.ts`. `bookingConfirmation.replica.test.ts` is the real proof for standard review — and it also seeds confirm. `referralBooking.replica.test.ts` is the real proof for Referral review / Referral No Action. Keep those cases. Add command-level names for the gaps (replica may stay the Mongo proof):

**Replace official fields on the Booking this case already named**
- Concurrent update versus No Action on the same case-revision commits one Command and one case revision (already locked).
- Exact replay returns the same command id and does not add Changes or outbox (already locked).
- Same official facts + matching Lead thresholds on a later review case is `already_satisfied` with zero Changes (already locked).
- Injected failure after booking / Lead / Changes / case / outbox leaves Booking, Lead, case-open, Command, Changes, and outbox invisible (already locked).
- Job / source / Lead pointer / customer name stay unchanged; Deposit 2500.5 sets Lead `over_2000` (already locked).
- Referral review writes one Booking Change, no Lead Change, and no candidates (already locked in the Referral replica).
- Flag-off is `POLICY_BLOCKED` and writes nothing (add this; today’s replica always injects `booking_commands_enabled: true`).
- Stale `case_revision`, stale Booking revision, cancelled Booking, or `create_missing_booking` mode is `CASE_REVISION_CONFLICT` / `DOMAIN_REVISION_CONFLICT` (add mode refuse; today’s update only seeds review-existing).
- Inactive Agent / Merchant is `VALIDATION_FAILED` and leaves the Booking at the old revision (add this).
- Leadless non-Referral Booking is `IDENTITY_CONFLICT` (add this).
- Incompatible Job / source / Lead / link is `IDENTITY_CONFLICT` (add this).
- Do not add a test that this file inserts a Booking or writes `booking_ref`.

**Close the case without writing a Booking**
- Create-missing No Action resolves the case, writes one Command, and leaves Booking / Lead / link / Changes / outbox counts unchanged (already locked).
- Exact replay returns the same command id and does not increment `case_revision` again (already locked).
- Injected failure after the case write leaves the case open and writes no Command (already locked).
- Referral create-missing No Action writes no Booking, no link, no Change, no outbox (already locked in the Referral replica).
- Optional reason code/text land on the resolution and do not become official fields (already locked).
- Admin is denied at the route; Owner plus one key is required (already locked in the route unit).
- Do not add a test that No Action finalizes sheets or writes an `EntityChange`.

**After commit, project sheets only when official fields changed**
- `booked_lead.update` intent is remembered before commit; `finalizeSheetSync` runs after a non-replay replace (replica outbox count already locked).
- Referral review queues `referral_booking.update` (add an explicit operation assert; today’s Referral replica locks Change count, not the outbox name).
- Replay, `already_satisfied`, and No Action do not dispatch a second job (already locked).
- Do not add a test that finalize runs inside the transaction.

Do **not** add a test per helper (`cents`, `desiredBooking`, `sameOfficialBooking`, `updateBody`, `failAfter`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test first-time confirm, Referral mint, case open/refresh, the registry Booking-id replace, or Release review here. Do not add a test that this file upserts a Customer, CRM-posts, or inserts a Booking. Do not add a test that review lives in `bookingConfirmation.ts` or `domainCommands/bookings.ts`.

## What I would not do

- A `BookingOwnerCommandService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save`.
- Moving this into a CRUD folder, or into `bookingReconciliation.ts` / `bookingConfirmation.ts` / `referralBooking.ts` / `domainCommands/bookings.ts` / `releaseOwnerCommands.ts` / `bookedLead.service.ts` “for cleanliness.”
- Splitting `update.ts` / `noAction.ts` / `apply.ts`.
- Routing this file through the registry `updateBooking` so “one Booking replace.”
- Calling `confirmBooking` or inserting a Booking so “review can also confirm.”
- Dispatching sheets on replay, `already_satisfied`, or No Action.
- Opening the case from this file so “review can create the work.”
- Dropping the Leadless refuse so a later intake spec “wins.”
- Writing a whole-folder recommendation for `granotLifecycle`.
