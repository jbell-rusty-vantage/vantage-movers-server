# Open Or Refresh Owner Work When Granot Released This Job — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 27 of this service — `releaseReconciliation.ts`
- Remaining in this service: `releaseOwnerCommands.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/releaseReconciliation.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/release-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/release-reconciliation.md) lists this file as primary code beside `releaseOwnerCommands.ts`, the Release case model, `processor.ts`, and `projections.ts` — they are siblings, not this pass. Processor invoke / fall-through: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) and [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from Booking-case persist: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md). Distinct from Owner create-Cancellation / Booking replacement / No Action: next module `releaseOwnerCommands.ts`. Distinct from discrepancy persist: `discrepancies.ts`. Distinct from official Cancel This Booking: [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from creating-observation read (`selectReleaseCreatingObservationEvidence`): `creatingObservation.ts`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`releaseReconciliation.ts` / `releaseOwnerCommands.ts` row). This checkout’s `CONTEXT.md` does not define Granot Release Reconciliation Case / Synchronization Decision / deterministic Booking — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one automatic persist caller.** `processor.ts` (`maybeReconcileRelease` → `deps.reconcileRelease` or `createGranotReleaseReconciliation({ prepared }).reconcileObservation` after live + actual `booking_action.normalized === "release"` + Job + every Release-case gate; opened / refreshed / already-current become the Decision and **return before** Booking-case persist and Lead create/sync; typed `release_discrepancy_required` persists via `createGranotDiscrepancies`; `none` falls through). Classifier reuse: `discrepancies.ts` (`loadCurrentContext` → `classifyReleaseReconciliation`). After-correction persist: `discrepancyOwnerCommands.ts` (`reconcileReleaseCaseAfterDiscrepancy` inside the Owner command transaction). Barrel only: `routes/granot-lifecycle-admin.routes.ts` imports `confirmCancellation` / `updateExistingBooking` / `noAction` from this file — those live in `releaseOwnerCommands.ts`. Tests: `releaseReconciliation.test.ts` (AC-25 / AC-26 / AC-27 / AC-40). Replica: `releaseReconciliation.replica.test.ts` (AC-25 / AC-29 / AC-31 / AC-32 / AC-36 / AC-40). Processor unit locks “invoke once for live gate-enabled Release / never invoke when the flag is off / persist typed conflict through the discrepancy module.” Not callers: `releaseOwnerCommands.ts`, `bookingReconciliation.ts`, `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `capture.ts`, `drainer.ts`, public `POST /api/v1/cancelled-leads`.
- Seams callers need: processor `{ reconcileObservation }` factory vs injected `deps.reconcileRelease`; classifier vs persist (discrepancies classify without writing a case); already-current Decision vs open case; after-discrepancy reuse inside an existing session vs automatic open (no Decision, no event); Owner-command re-exports until routes point at the sibling
- Split later (only if the file outgrows one sitting): this ~730-line file is one screenplay for “open or refresh Owner work when Granot released this Job.” If it later splits: `decideWhetherThisReleasedJobNeedsOwnerWork.ts` / `openOrRefreshTheReleaseCaseWhenGranotReleasedThisJob.ts` / `rememberThatThisBookingIsAlreadyCancelled.ts` — story files, never `create.ts` / `update.ts` / `classify.ts` / `persist.ts`, and never merge confirm-cancellation into this file

`createGranotReleaseReconciliation` / `reconcileObservation` / `reconcileInTransaction` are executor mechanics. The owner question is: *Granot said this Job is released. That is not a Cancellation. If we are live and every Release-case gate allowed: reread the Observation, the active Job link, identity, and whether a Booking or Cancellation already exists. If the Booking is already officially cancelled, remember that Decision and stop. If there is no Booking, or identity is fighting, ask for a discrepancy. Otherwise open the one open Owner work case for this Job, or append this Observation onto it. Remember the Decision in the same transaction. After commit, tell observability. Never write `CancelledLead`. Never confirm. The owner does that later. This file does not plan a Lead. This file does not cancel a Booking. This file does not open a Booking case.*

Owner create-Cancellation / Booking replacement / No Action, Booking-case persist, discrepancy persist, identity, and gates already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one Release-case story, not “a reconciliation CRUD service,” and not the Owner confirm-cancellation / the Booking case / official Cancel This Booking:

1. **Decide whether this Release Observation needs Owner work** — refuse a missing Job. Actual `booking_action === "release"` only. Booked is `not_release_evidence`. An officially cancelled Booking is `already_current` / `booking_already_cancelled` (the Cancellation id when we have one). Identity `conflict` becomes a typed release-* discrepancy (`release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`) or `identity_conflict_unmapped` when the reason is not one of those three. No Booking → `release_without_vantage_booking`. One active Booking → open a case on that deterministic Booking id and the Booking’s current `domain_revision`. A Booking with no Lead still opens. This function does not persist.

2. **Open or refresh the one open Release case for this Job** — refuse unless the prepared Decision is `live` and every gate is allowed. One retry on duplicate-key / write-conflict / transient transaction. Inside the transaction: reread Observation, policy, identity, active Record Link, Booking, and official Cancellation. Refuse if the prepared receipt no longer names this Observation. Classify again. Persist a Decision and stop when the Booking is already cancelled (target is `CancelledLead` when we have the id, otherwise `BookedLead`). Return a typed discrepancy without writing a case. Fail closed unless classify is an actual case. Find the open `{job, release}` case; if it already names a different Booking, throw — a case never silently retargets. Exact Observation replay returns the row and does not rewrite revisions. A new Observation appends the four-field evidence tuple, refreshes observed context, and increments `evidence_revision` (and `case_revision` only when the live Booking revision or Record Link changed). `booking_revision_at_open` stays the opening revision. No open case → `max(sequence)+1`, `case_revision=1`, `evidence_revision=1`. Remember the immutable Decision (`linked` / `release_case_opened|refreshed`) in the same session. After commit: emit the opened/refreshed event. This function does not recount a gauge. This function does not write `CancelledLead`. This function does not confirm.

3. **After the owner fixes a discrepancy, open or refresh the same case inside their transaction** — reuse the classifier and store on the caller’s session. Fail closed unless the classification is an actual case. Same open / refresh / sequence / no-silent-retarget rules. Do not insert a Decision. Do not emit. Return the case ref or `undefined` when classify is not a case. This function does not resolve the discrepancy.

There is no fourth mutate operation. `createGranotReleaseReconciliation` is the processor **adapter** of operation 2 (`{ reconcileObservation }`), not a second public story. `createMongoReleaseReconciliationStore` is the Mongo **adapter**, not a story. Owner `confirmCancellation` / `updateExistingBooking` / `noAction` are re-exports of `releaseOwnerCommands.ts`. There is no candidate search, no suggested Lead, no pairing fold, and no employee rematch.

## Organization

Keep one file as the screenplay for “Granot released this Job; open or refresh Owner work; never write the Cancellation.” Owner commands, Booking-case persist, discrepancy persist, identity, and gates already live in deeper **modules**. Do not pull those in. Do not invent a `GranotReleaseReconciliationService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — case and Decision commit together; the event stays after commit. Do not invent a write **seam** that has only one **adapter** here. Do not add a gauge **seam** so “Release matches Booking” — Booking recounts open cases after commit; this file does not.

Do not move this into `processor.ts` so “knowledge lists both as primary code.” Do not move this into `releaseOwnerCommands.ts` so “open and confirm are one sitting.” Do not merge this file into `bookingReconciliation.ts` so “one case writer.” Do not merge this file into `cancellations/cancelledLead.service.ts` so “one cancel.” Do not split `create.ts` / `refresh.ts` / `classify.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotReleaseReconciliation` | `openOrRefreshTheReleaseCaseWhenGranotReleasedThisJob` | processor’s only Release-case persist |
| `classifyReleaseReconciliation` | `decideWhetherThisReleasedJobNeedsOwnerWork` | persist and discrepancies share one answer |
| `reconcileReleaseCaseAfterDiscrepancy` | `openOrRefreshTheReleaseCaseAfterTheOwnerFixesADiscrepancy` | existing Owner-command session; no Decision / event |
| `createMongoReleaseReconciliationStore` | `theMongoReleaseCaseStore` | discrepancies, after-discrepancy |
| `PreparedReleaseReconciliationDecision` | `APreparedLiveReleaseDecision` | processor handoff: live + gates + ids |
| `ReleaseCaseEffectResult` | `WhatTheReleaseCaseWriteDid` | opened / refreshed / already-current / discrepancy / none |
| `confirmCancellation` / `updateExistingBooking` / `noAction` | keep as aliases | admin routes import the barrel today |

Keep the old names as one-line aliases until `processor.ts`, `discrepancies.ts`, and the admin routes migrate. Do not make callers learn `reconcileInTransaction` / `reconcilePreparedObservation` / `loadCurrentContext` as the domain language.

**No class for the workflow.** The `{ reconcileObservation }` factory is a one-method processor **adapter**, not a workflow class. The type that *does* earn a name is the reread facts bag:

```ts
type WhatWeKnowAboutThisReleasedJob = {
  /* today's ReleaseReconciliationCurrentContext:
     Observation + receipt, Job, release|booked,
     identity, active link, Booking / Cancellation facts */
}
```

That is the handoff from “reread Observation, identity, Booking, and Cancellation” to “classify and maybe persist.” Do **not** add `suggested_lead` so “Release matches Booking browse,” and do **not** persist a `CancelledLead` so “already-current is complete.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// releaseReconciliation.ts
// Granot said this Job is released. That is not a Cancellation.
// Open or refresh one Owner work case so a human can cancel,
// replace the Booking, or take no action.
// Booked is the other case. Already-cancelled is already current.
// Never write CancelledLead. Never confirm.

// ── 1. Decide whether this Release Observation needs Owner work ─

export function decideWhetherThisReleasedJobNeedsOwnerWork(facts)
  ifMissingJob, stop("missing_job_number")
  ifNotActualRelease, stop("not_release_evidence")          // Booked lives here
  ifBookingAlreadyCancelled, rememberAlreadyCurrent()
  ifIdentityIsFighting, requireAReleaseDiscrepancyOrStopUnmapped()
  ifNoBooking, requireADiscrepancy("release_without_vantage_booking")
  ifOneActiveBooking, openReviewOnThatBooking(id, domain_revision)
  // a Booking with no Lead still opens

// ── 2. Open or refresh the one open Release case ──────────

export function openOrRefreshTheReleaseCaseWhenGranotReleasedThisJob(prepared)
  refuseUnlessLiveAndEveryGateAllowed()
  retryOnceOnDuplicateKeyOrTransientWrite()
  // then in one transaction:
  //   rereadWhatWeKnowAboutThisReleasedJob()
  //   decideWhetherThisReleasedJobNeedsOwnerWork()
  //   persistTheCaseAndTheDecisionTogether()
  // after commit:
  //   tellObservabilityWeOpenedOrRefreshed()   // no gauge

async function persistTheCaseAndTheDecisionTogether(facts, classification, session)
  ifAlreadyCancelled, rememberTheAlreadyCurrentDecisionAndStop()
  ifDiscrepancyRequired, returnItWithoutWritingACase()
  ifOpenCaseAndDifferentBooking, throw("cannot silently retarget")
  ifOpenCaseAndSameObservation, replayWithoutRewrite()
  ifOpenCaseAndNewObservation, appendEvidenceAndMaybeBumpCaseRevision()
  ifNoOpenCase, openTheNextSequence()
  rememberTheLinkedDecision()

// ── 3. After the owner fixes a discrepancy ────────────────

export async function openOrRefreshTheReleaseCaseAfterTheOwnerFixesADiscrepancy(input, session)
  rereadAndClassifyOnTheCallerSession()
  ifNotACase, return undefined
  persistTheCaseWithoutADecisionOrAnEvent()
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, and already authorized live Release-case gates. Granot said this Job is released. Reload the Observation, the active Job link, identity, and whether a Booking or Cancellation already exists. If Granot only booked the Job, stop — that is the other case. If the Booking is already cancelled, remember that Decision and stop. If there is no Booking, or identity is fighting, ask for a discrepancy. Otherwise open the one open Owner work case for this Job, or append this Observation onto it. Never retarget the case to a different Booking. Remember the Decision in the same transaction. After commit, tell observability. Nobody writes `CancelledLead`. Nobody confirms. The owner does that later, on a different file.*

That is the operation. `createGranotReleaseReconciliation` is not a CRUD create. `reconcileObservation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Release is two doors, and both say so.** `maybeReconcileRelease` returns before invoke unless `normalized === "release"` and a Job exists and normalization is not `invalid` / `unsupported`. This classifier also returns `not_release_evidence` / `missing_job_number`. That is two **adapters**, not a duplicate to delete. Do not drop the classifier check so “the processor already filtered,” and do not skip the processor check so “the case module can take a raw Booked row.”

2. **Malformed Priority does not suppress Release.** The processor unit feeds `priority.valid === false` and still invokes. This classifier never looks at Priority. Do not refuse Release so “Priority 5 is not booking evidence,” and do not start pairing a preceding Priority 5 so “Release matches Booking.”

3. **Already-cancelled persists a Decision and no case.** Booking-case persist treats an officially cancelled Booking as a typed discrepancy (`booked_after_official_cancellation`). This file treats it as `already_current` / `booking_already_cancelled` and inserts the Decision (target `CancelledLead` when we have the id, else `BookedLead`). The processor returns that attempt instead of falling through. Do not open a Release case so “every Release gets Owner work,” and do not drop this Decision so “already-current never writes.”

4. **`none` falls through; already-current does not.** `missing_job_number` / `not_release_evidence` / `identity_conflict_unmapped` persist nothing here and the processor continues to Booking-case persist, then Lead create/sync. Do not persist those `none` reasons so “every classify writes,” and do not fall through on `already_current` so “cancelled is a Lead problem.”

5. **This file does not write discrepancy rows.** `release_discrepancy_required` returns the reason. The processor persists through `createGranotDiscrepancies`. Do not insert a `GranotReleaseDiscrepancy` here so “one Release writer,” and do not skip the processor handoff so “classify already named the reason.”

6. **Identity conflict is checked before missing Booking.** A fighting identity with no Booking is a release-* conflict (or `identity_conflict_unmapped`), not `release_without_vantage_booking`. Officially cancelled is checked before identity, so a cancelled Booking with a fighting identity is already-current. Do not reorder those so “no Booking always wins,” and do not map every identity reason so `identity_conflict_unmapped` “goes away.”

7. **`has_lead` is loaded and never classified.** Knowledge says an active Booking opens even with no Lead. The classifier never reads `has_lead`. The model also declares `suggested_lead`; this file never writes it. Do not start suggesting a Lead so “the field exists,” and do not refuse a lead-less Booking so “Release needs a Lead.”

8. **This file re-exports Owner commands it does not run.** Admin routes import `confirmCancellation` / `updateExistingBooking` / `noAction` from this barrel. Knowledge Primary-code lists `releaseOwnerCommands.ts` beside this file. Do not pull confirm-cancellation into this file so “the Service title includes commands,” and do not delete the aliases until the routes point at the sibling.

9. **`createGranotReleaseReconciliation` is a one-method factory, not a workflow class.** `{ reconcileObservation }` exists so the processor can inject `deps.reconcileRelease`. The factory also attaches the three Owner commands; the processor never calls them that way. Do not grow a `GranotReleaseReconciliationService` with `create` / `update` / `delete`, and do not add `confirmCancellation` onto the persist path so “one reconciliation API.”

10. **Open/refresh and after-discrepancy reprint the same persist beats.** Retarget refuse, exact Observation replay, append / sequence, `booking_revision_at_open` stays. The **seam** is the session and whether a Decision / event fire. Do not call `reconcileObservation` from after-discrepancy so “one writer” (that would insert a second Decision and leave the Owner transaction). Do not emit from after-discrepancy so “the case is announced twice.”

11. **Exact Observation replay is a no-op, including revisions.** Same `observation_id` on the open case returns refreshed with the stored revisions and does not `$push`. A different Decision id on replay throws. Replay does **not** insert a Decision. A new drain attempt for that same Observation therefore returns a Decision-shaped result the processor never stored. Do not insert a second Decision on replay so “every attempt has a row,” and do not accept a second Decision id so “the caller minted a new one.”

12. **A case never silently retargets.** Open-case persist and after-discrepancy both throw when `deterministic_booking_id` ≠ the classified Booking. Do not `$set` the Booking id so “the case follows the live Booking,” and do not open a second sequence so “retarget is a new case” without an explicit Owner command.

13. **`booking_revision_at_open` is immutable. Live revision change bumps `case_revision`.** A second Release Observation may see `domain_revision` 5 after opening at 4 and only increment `evidence_revision` + `case_revision`. The opening revision stays 4. Record Link change is the other `owner_state_changed` bit. Do not rewrite `booking_revision_at_open` so “the snapshot stays fresh,” and do not skip `case_revision` on a live Booking change so “evidence covers it.”

14. **This file has no open-case gauge.** Booking persist recounts `granot_lifecycle_open_cases` after commit and swallows a thrown count. Release emit is `granot_lifecycle.release_case_opened|refreshed`; observability remaps those to `granot_lifecycle.release_case.opened|refreshed`. Do not add a Release gauge so “the two case writers match,” and do not pre-mask event details so “the event is already safe.”

15. **Booking and Release cases may stay open on one Job.** The replica proves both rows exist, mixed list pages them, Release detail has `candidate_search.available === false`, and `listGranotLifecycleCaseCandidates` returns `null`. Opening a Release case must not write `BookedLead`, `CancelledLead`, Record Link, Command, `EntityChange`, Sheet Sync, or notifications. Do not close the Booking case so “one Job one case,” and do not enable candidate search so “Release can attach a Lead.”

16. **Knowledge lists this file under the processor and under Owner commands.** `release-reconciliation.md` Primary code is this persist + the case model + `processor.ts` + `projections.ts`. This file does not `$set` a Lead, does not project list/detail DTOs, and does not confirm a Cancellation. Do not move it into `processor.ts` so the Primary-code line “wins,” and do not start writing `CancelledLead` here so “already-current is the Cancellation.”

17. **Leave sibling modules alone.** Confirm-cancellation / Booking replacement / No Action stay in `releaseOwnerCommands.ts`. Booking persist stays in `bookingReconciliation.ts`. Discrepancy persist stays in `discrepancies.ts`. Identity stays in `identity.ts`. Gates stay in `sourcePolicy.ts`. Case list / detail / timeline stay in `projections.ts`. Creating-observation read stays in `creatingObservation.ts`. Decision-only persist stays in `processor.ts`.

18. **Do not treat official Cancel This Booking, public v1 cancel, Owner confirm-cancellation, Booking-case persist, or drain as this story.** Those write `CancelledLead`, refuse Referral, run a gated command, open Booking work, or claim a receipt. This file only opens or refreshes Owner work when Granot released a Job.

19. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `openOrRefreshTheReleaseCaseWhenGranotReleasedThisJob` (today `createGranotReleaseReconciliation` → `reconcileObservation`), `decideWhetherThisReleasedJobNeedsOwnerWork` (today `classifyReleaseReconciliation`), and `openOrRefreshTheReleaseCaseAfterTheOwnerFixesADiscrepancy`. The Mongo store is an **adapter**, not a public story.

Today’s `releaseReconciliation.test.ts` already names the operations: a lead-less active Booking opens; already-cancelled is already-current and never a case; missing Booking and the three identity conflicts are typed discrepancies; Booked / missing Job are `none`. Memory persist opens + Decision, then a second Observation refreshes, bumps both revisions, and keeps `booking_revision_at_open`. `releaseReconciliation.replica.test.ts` is the Mongo proof: concurrent open/refresh, replay dedupe, sequence after resolve, revision split, Decision-insert rollback on create and refresh, Booking + Release coexist with no official writes and no candidate search. Keep those cases. Add command-level names for the gaps:

**Decide whether this Release Observation needs Owner work**
- Booked is `not_release_evidence` (already locked).
- Missing Job is `missing_job_number` (already locked).
- Officially cancelled Booking → `already_current` / `booking_already_cancelled` (already locked).
- No Booking → `release_without_vantage_booking` (already locked).
- The three identity conflicts map; an unmapped identity reason is `identity_conflict_unmapped` (add the unmapped case; today’s AC-27 only covers the three mapped reasons).
- A lead-less Booking still opens (already locked).
- Do not add a test that Priority 5 opens or suppresses a Release case.

**Open or refresh the one open Release case**
- Live + release + one Booking → one open case, `case_revision=1`, causal Decision (already locked).
- Second Release Observation appends evidence; live Booking revision change increments `case_revision` and leaves `booking_revision_at_open` (already locked).
- Exact Observation replay does not rewrite revisions (replica already locked).
- Concurrent same-Job writers keep one open case (replica already locked).
- Decision insert failure rolls back create and refresh (replica already locked).
- Already-cancelled inserts a Decision and no case (add persist coverage; today’s unit only classifies).
- Silent retarget throws (add this; today’s unit/replica never change `deterministic_booking_id`).
- Do not add a test that this file inserts `CancelledLead`.

**After the owner fixes a discrepancy**
- Case classification opens or refreshes on the caller session and inserts no Decision (add this; today’s unit/replica do not call `reconcileReleaseCaseAfterDiscrepancy`).
- Non-case classification returns `undefined` and writes nothing (add this).
- Retarget still throws on the caller session (add this).
- Do not add a test that after-discrepancy emits.

Do **not** add a test per helper (`releaseDiscrepancyReason`, `observationToObservedContext`, `decisionDocument`, `isRetryableReleaseCaseRace`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Owner confirm-cancellation, Booking-case persist, discrepancy persist, or processor gate remappers here. Do not add a test that this file CRM-posts, `$set`s a Lead, writes `CancelledLead`, or searches candidates. Do not add a test that Booked opens a Release case.

## What I would not do

- A `GranotReleaseReconciliationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `insertCase`.
- Moving this into a CRUD folder, or into `processor.ts` / `releaseOwnerCommands.ts` / `bookingReconciliation.ts` / `cancellations/cancelledLead.service.ts` “for cleanliness.”
- Splitting `create.ts` / `refresh.ts` / `classify.ts` / `persist.ts`.
- Writing `CancelledLead` so “already-current is complete.”
- Opening a case on Booked so “one case writer handles both actions.”
- Calling `confirmCancellation` from open/refresh so “the case resolves itself.”
- Adding a suggested Lead or candidate search so “Release matches Booking.”
- Adding an open-case gauge so “the two persist files match.”
- Silently retargeting `deterministic_booking_id` so “the case follows the live Booking.”
- Writing a whole-folder recommendation for `granotLifecycle`.
