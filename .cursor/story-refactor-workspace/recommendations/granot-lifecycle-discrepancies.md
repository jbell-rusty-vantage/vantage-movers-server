# Open Or Refresh The Discrepancy When Granot And Vantage Disagree About This Job — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 29 of this service — `discrepancies.ts`
- Remaining in this service: `discrepancyOwnerCommands.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/discrepancies.ts`
- Knowledge: There is **no** standalone Service file in `docs/knowledge/granot-lifecycle/` for this persist. [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) names `persistProcessorDiscrepancy` → `createGranotDiscrepancies` and says this file is the persist, not a cluster Service. Owner durable-work / reasons / no-flag rule: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md). Case writers that return typed conflict and do **not** write the row: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md), [recommendations/granot-lifecycle-release-reconciliation.md](granot-lifecycle-release-reconciliation.md). Distinct from Owner re-evaluate / Correct Record Link / No Action: next module `discrepancyOwnerCommands.ts`. Distinct from queue / detail reads: `discrepancyProjections.ts`. Distinct from Booking / Release case open: the two recon files. Distinct from official Book / Cancel: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md), [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (discrepancies/correction in Progress; no `discrepancies.ts` row). This checkout’s `CONTEXT.md` does not define Granot Booking Discrepancy / Granot Release Discrepancy / reason fingerprint — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one automatic persist caller, plus two shared primitives.** `processor.ts` (`persistProcessorDiscrepancy` after `booking_discrepancy_required` / `release_discrepancy_required` → `deps.reconcileDiscrepancy` or `createGranotDiscrepancies({ prepared }).reconcileObservation`; then rebuilds a Decision-shaped return for log / `toProcessorResult` — it does **not** insert a second Decision). Fingerprint + store reuse: `discrepancyOwnerCommands.ts` (`reEvaluateGranotDiscrepancy` → `createDiscrepancyFingerprint` + `createMongoDiscrepancyStore().loadCurrentContext` / `findOpen` / `insert` / `refresh` **inside** the Owner command transaction; it does **not** call `reconcileObservation`). Tests: `discrepancies.test.ts` (AC-35 / AC-36 frozen fingerprint; AC-26 / AC-27 / AC-35 null keys and no evidence/display; AC-26 / AC-36 open then refresh one fingerprint). Processor unit: `[AC-26][AC-27][AC-36] processor persists typed conflict through the discrepancy module` (injected `reconcileDiscrepancy`, Release missing-Booking). `discrepancies.replica.test.ts` is **not** this persist — it seeds rows and proves Owner No Action / re-evaluate / Correct Record Link. Not callers: `bookingReconciliation.ts` / `releaseReconciliation.ts` (this file asks their classifiers), `discrepancyProjections.ts`, admin routes (`GET/POST .../discrepancies*`), `capture.ts`, `drainer.ts`, public Book / Cancel.
- Seams callers need: processor `{ reconcileObservation }` factory vs injected `deps.reconcileDiscrepancy`; fingerprint vs persist (Owner re-evaluate names the next mismatch without this persist story); store vs persist (Owner command session reuses Mongo find/insert/refresh and must not insert a Decision); Booking vs Release collections as two **adapters** of one persist rule; sibling classifier reuse (do not re-decide the reason here)
- Split later (only if the file outgrows one sitting): keep one file — this ~470-line module is one screenplay for “Granot and Vantage disagree about this Job; open or refresh the one open discrepancy for that exact mismatch; never write official facts.” If it later splits: `nameThisExactMismatch.ts` / `openOrRefreshTheDiscrepancyWhenThisJobFights.ts` — story files, never `create.ts` / `update.ts` / `booking.ts` / `release.ts` / `persist.ts`, and never merge Owner review or case open into this file

`createGranotDiscrepancies` / `reconcileObservation` / `reconcileDiscrepancy` are executor mechanics. The owner question is: *Granot said something about this Job that does not match Vantage. That is not a Booking case and not a Cancellation. If we are live and every prepared gate allowed: reread the Observation and current Vantage facts. If the fight is still the same reason: name that exact mismatch (kind, Job, reason, refs). Open the one open discrepancy for that fingerprint, or append this Observation onto it. Remember the Decision in the same transaction. After commit, tell observability. Missing Booking that is normal work, already-cancelled Release, a Booking missing its Lead, and pending Lead match are not this story. Never write `BookedLead`. Never write `CancelledLead`. Never `$set` a Lead. Never touch a Record Link. The owner reviews later.*

Owner re-evaluate / Correct Record Link / No Action, case open, queue reads, and official Book / Cancel already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one mismatch-persist story, not “a discrepancy CRUD service,” and not the Owner review / the Booking case / the Release case:

1. **Name this exact mismatch** — SHA-256 of versioned canonical JSON: `version: 1`, `discrepancy_kind`, `normalized_job_no`, `reason_code`, plus lowercase-or-null `record_link_id`, `lead_ref`, `booking_id`, `cancellation_id`. Contact, source labels, raw Job text, Observation / Decision ids, timestamps, display values, and revisions are excluded. Booking reasons: `booked_record_link_conflict` / `booked_booking_lead_conflict` / `booked_job_number_conflict` / `booked_source_scope_conflict` / `booked_after_official_cancellation`. Release reasons: `release_without_vantage_booking` / `release_record_link_conflict` / `release_job_number_conflict` / `release_source_scope_conflict`. This function does not persist.

2. **Open or refresh the one open discrepancy for that mismatch** — refuse unless the prepared Decision is `live`, the prepared Observation id still matches the request, and every prepared gate is allowed. One retry on duplicate-key `11000` / `TransientTransactionError`. Inside the transaction: reread current facts through the Booking or Release case store and that sibling’s classifier. Refuse if Observation / receipt / classified reason no longer match the request (“classification changed before persistence”). Fingerprint from those live refs. Find the open `{state:"open", reason_fingerprint}` row in the matching collection. Same Observation already on the row → return refreshed and do not `$push`. New Observation → append the four-field evidence tuple, `$set last_evidence_at`, increment only `evidence_revision`. No open row → insert `state:"open"`, `revision:1`, `evidence_revision:1`, `opened_at` from the prepared Decision. Remember the immutable Decision (`conflict` / `{kind}_discrepancy_opened|refreshed`, target = the discrepancy) and stamp `processing.latest_decision_id` on the receipt in the same session. A resolved row cannot be refreshed. This function does not write a Booking, Cancellation, Lead, Record Link, Command, `EntityChange`, Sheet Sync intent, notification, or email. This function does not resolve the discrepancy.

3. **After commit, tell observability** — emit `granot_lifecycle.{kind}_discrepancy_opened|refreshed` with masked ids, kind, reason, and both revisions. Do not recount an open-discrepancy gauge here (health recomputes `open_discrepancies` from Mongo). Replay-as-refresh still emits refreshed.

There is no fourth mutate operation. `createGranotDiscrepancies` is the processor **adapter** of operation 2 (`{ reconcileObservation }`), not a second public story. `createMongoDiscrepancyStore` is the Mongo **adapter**, and it is a real **seam** because Owner re-evaluate reuses find / insert / refresh on an existing session. Booking vs Release models are two **adapters** of one persist rule. `loadCurrentContext` re-asks `classifyBookingReconciliation` / `classifyReleaseReconciliation`; it does not invent a third classifier.

## Organization

Keep one file as the screenplay for “Granot and Vantage disagree about this Job; open or refresh the one open discrepancy for that exact mismatch; never write official facts.” Owner commands, case persist, queue reads, identity, and gates already live in deeper **modules**. Do not pull those in. Do not invent a `GranotDiscrepancyService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — discrepancy and Decision commit together; the event stays after commit. Do not invent a write **seam** that has only one **adapter** here. Do not add a gauge **seam** so “discrepancy matches Booking-case persist.” Do not invent `GRANOT_LIFECYCLE_DISCREPANCIES_ENABLED` — Booking persist rides the Booking-case flag; Release persist rides the Release-case flag.

Do not move this into `processor.ts` so “knowledge lists persist on the processor.” Do not move this into `discrepancyOwnerCommands.ts` so “one discrepancy writer.” Do not merge this file into `bookingReconciliation.ts` or `releaseReconciliation.ts` so “classify already named the reason.” Do not split `booking.ts` / `release.ts` / `create.ts` / `refresh.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotDiscrepancies` | `openOrRefreshTheDiscrepancyWhenThisJobFights` | processor’s only discrepancy persist |
| `createDiscrepancyFingerprint` | `nameThisExactMismatch` | persist and Owner re-evaluate share one identity |
| `createMongoDiscrepancyStore` | `theMongoDiscrepancyStore` | Owner re-evaluate rereads / inserts / refreshes on the command session |
| `PreparedDiscrepancyDecision` | `APreparedLiveDiscrepancyDecision` | processor handoff: live + gates + ids |
| `DiscrepancyEffectResult` | `WhatTheDiscrepancyWriteDid` | opened / refreshed |
| `DiscrepancyCurrentContext` | `WhatWeKnowAboutThisFightingJob` | reread facts + classified reason |
| `DiscrepancyFingerprintInput` | `TheMismatchIdentity` | the tuple that may become an open row |
| `GranotDiscrepancies` / `reconcileObservation` | keep as aliases | processor factory today |

Keep the old names as one-line aliases until `processor.ts` and `discrepancyOwnerCommands.ts` migrate. Do not make callers learn `reconcileDiscrepancy` / `loadCurrentContext` / `findOpen` as the domain language.

**Principle: old exports stay as aliases.** `createGranotDiscrepancies`, `reconcileObservation`, and `createDiscrepancyFingerprint` remain the imported names until the processor and Owner re-evaluate point at the story names.

**No class for the workflow.** The `{ reconcileObservation }` factory is a one-method processor **adapter**, not a workflow class. The type that *does* earn a name is the reread facts bag:

```ts
type WhatWeKnowAboutThisFightingJob = {
  /* today's DiscrepancyCurrentContext:
     Observation + receipt, Job, booked|priority_5|release,
     classified reason, active link, Lead / Booking / Cancellation refs */
}
```

That is the handoff from “reread Observation and sibling classify” to “fingerprint and maybe persist.” Do **not** add `official_booking_details` so “the discrepancy can confirm,” and do **not** persist a `BookedLead` or `CancelledLead` so “the fight is resolved.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// discrepancies.ts
// Granot said something about this Job that does not match Vantage.
// That is not a Booking case and not a Cancellation.
// Open or refresh the one open discrepancy for this exact mismatch.
// Never write BookedLead. Never write CancelledLead.
// The owner reviews later.

// ── 1. Name this exact mismatch ───────────────────────────

export function nameThisExactMismatch(identity)
  // version, kind, Job, reason, link, Lead, Booking, Cancellation
  // lowercase ids; absent refs stay explicit null
  // no contact, no Observation, no Decision, no time

// ── 2. Open or refresh the one open discrepancy ───────────

export function openOrRefreshTheDiscrepancyWhenThisJobFights(prepared)
  refuseUnlessLiveAndEveryGateAllowed()
  refuseIfPreparedObservationDoesNotMatchTheRequest()
  retryOnceOnDuplicateKeyOrTransientWrite()
  // then in one transaction:
  //   rereadWhatWeKnowAboutThisFightingJob()
  //   refuseIfTheClassifiedReasonDrifted()
  //   persistTheDiscrepancyAndTheDecisionTogether()
  // after commit:
  //   tellObservabilityWeOpenedOrRefreshed()   // no gauge

async function rereadWhatWeKnowAboutThisFightingJob(kind, observationId, session)
  ifBooking, askTheBookingClassifierAndRememberTheCancellationId()
  ifRelease, askTheReleaseClassifier()
  // classified_reason_code only when sibling says *_discrepancy_required

async function persistTheDiscrepancyAndTheDecisionTogether(facts, request, session)
  fingerprint = nameThisExactMismatch(facts)
  ifOpenRowAndSameObservation, replayWithoutRewrite()      // still "refreshed"
  ifOpenRowAndNewObservation, appendEvidenceOnly()         // evidence_revision++
  ifNoOpenRow, openRevisionOne()
  rememberTheConflictDecision()                            // target = discrepancy
  stampTheReceiptLatestDecision()

function rememberTheCancellationIdOnABookingFight(booking)
  ifOfficiallyCancelledAndWeHaveAnId,
    findTheCancelledLeadByBookedLead()                     // Booking adapter
  // Release adapter already carries booking.cancellation_id

// ── 3. After commit, tell observability ───────────────────

async function tellObservabilityWeOpenedOrRefreshed(result)
  emitOpenedOrRefreshed()                                  // masked ids only
  doNotRecountOpenDiscrepancies()
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked Booking or Release reconcile, and already heard “this is a typed fight.” Reload the Observation and current Vantage facts. If we are not live, or a gate failed, or the classified reason moved, stop. Name the mismatch from kind, Job, reason, and the live refs — not from the Observation text. If that fingerprint already has an open row, append this Observation or replay it. If not, open one. Remember the Decision in the same transaction. After commit, tell observability. Nobody writes a Booking. Nobody writes a Cancellation. Nobody `$set`s a Lead. Nobody touches a Record Link. Nobody opens a case. The owner sorts out which side is right later, on a different file.*

That is the operation. `createGranotDiscrepancies` is not a CRUD create. `reconcileObservation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file does not decide the fight. It persists a fight the case writer already named.** `classifyBookingReconciliation` / `classifyReleaseReconciliation` return `*_discrepancy_required`. The processor hands the reason here. `loadCurrentContext` asks those classifiers again and refuses if the reason drifted. That is two **adapters** of one “still a fight?” check, not a third classifier to write. Do not insert a `GranotBookingDiscrepancy` from `bookingReconciliation.ts` so “one Booking writer,” and do not skip the reread so “the processor already classified.”

2. **There is no discrepancy flag.** Automatic Booking persist requires the Booking-case gate snapshot; Release persist requires the Release-case snapshot. Shadow, historical, and disabled case flags create no row. Do not add `GRANOT_LIFECYCLE_DISCREPANCIES_ENABLED` so “discrepancy has its own door,” and do not persist in shadow so “the owner can preview the queue.”

3. **Normal missing-Booking work is not a discrepancy.** A Booked Observation with no Booking opens a create-missing case. A Release Observation with no Booking **is** `release_without_vantage_booking`. Already-cancelled Release is already-current, not a discrepancy. A Booking missing its Lead is employee rematch or a valid Release case. Do not open a discrepancy for those so “every gap is a fight,” and do not drop `release_without_vantage_booking` so “Release matches Booking create-missing.”

4. **Owner re-evaluate reprints insert / refresh on the store and must not call this persist.** Re-evaluate may resolve the old row and open a new fingerprint, or open a normal case, in one command transaction. `reconcileObservation` would insert a second Decision and leave that transaction. The **seam** is the store + fingerprint. Do not call `reconcileObservation` from re-evaluate so “one writer,” and do not move re-evaluate into this file so “one discrepancy sitting.”

5. **`createGranotDiscrepancies` is a one-method factory, not a workflow class.** `{ reconcileObservation }` exists so the processor can inject `deps.reconcileDiscrepancy`. Do not grow a `GranotDiscrepancyService` with `create` / `update` / `delete`, and do not add `reEvaluate` / `noAction` onto the persist path so “one discrepancy API.”

6. **Exact Observation replay still reports `refreshed`.** Same `observation_id` on the open row skips `$push` and leaves `evidence_revision`. The effect is still `refreshed` and the event still fires. Do not insert a second Decision on replay so “every attempt has a new row,” and do not emit `opened` on replay so “the owner sees a new fight.”

7. **`revision` stays 1 on refresh. Only `evidence_revision` moves.** Owner review later increments `revision`. Automatic persist must not look like an Owner command. Do not bump `revision` on append so “the queue sorts by newest write,” and do not skip `evidence_revision` so “the Observation list is enough.”

8. **Resolved rows are immutable.** `refresh` CAS-fails unless the row is still open and does not already name this Observation; a missing open row throws `Resolved discrepancy cannot be refreshed.` Later evidence for the same fingerprint after resolve is a **new** insert (partial unique open index allows a resolved history row). Do not `$push` onto resolved so “one row per fingerprint forever,” and do not reopen the old id so “revisions stay contiguous.”

9. **Booking and Release are two collections, one persist rule.** `discrepancyModel(kind)` picks `GranotBookingDiscrepancy` vs `GranotReleaseDiscrepancy`. Fingerprint includes `discrepancy_kind`, so the same Job can hold one open Booking fight and one open Release fight. Do not merge collections so “one discrepancy table,” and do not split this file into `bookingDiscrepancy.ts` / `releaseDiscrepancy.ts` so “one file per kind.”

10. **Cancellation id has two adapters on purpose.** Booking persist looks up `CancelledLead` by `booked_lead` when the Booking is officially cancelled. Release persist copies `booking.cancellation_id` from the Release store. Do not force both through `CancelledLead.findOne` so “one lookup,” and do not drop Booking’s lookup so “the Booking store already has the id” (it does not).

11. **This file has no open-discrepancy gauge.** Booking-case persist recounts `open_cases` after commit. Health recomputes `open_discrepancies` from current cardinality (`kind|reason_code`). This emit is `granot_lifecycle.{reason_code}` / workflow `granot_discrepancy`. Do not add a gauge so “the three persist files match,” and do not put Job / contact / reason prose on the event so “the owner can read the fight from the log.”

12. **The processor rebuilds a Decision-shaped return after this file already inserted the row.** `persistProcessorDiscrepancy` maps `opened` / `refreshed` onto `toDecisionDocument` for the log and the processor result. That is not a second write. Do not insert again in the processor so “the return needs a row,” and do not delete this file’s `insertDecision` so “the processor already owns Decisions.”

13. **`discrepancies.replica.test.ts` names this module and tests the next one.** It seeds Booking discrepancy rows and runs `resolveGranotDiscrepancyNoAction` / `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink`. AC-36 unique-open-fingerprint is the one persist-adjacent replica. Do not move Owner-command proof into this persist recommendation’s “already locked” column, and do not delete that file so “the name is wrong” until the Owner-command pass.

14. **Knowledge says there is no standalone discrepancy Service file.** `processor.md` and the Unit 29 owner spec are the sources. Do not invent `docs/knowledge/granot-lifecycle/discrepancies.md` in this pass, and do not copy Unit 29 into `CONTEXT.md`.

15. **Leave sibling modules alone.** Owner re-evaluate / Correct Record Link / No Action stay in `discrepancyOwnerCommands.ts`. Queue / detail stay in `discrepancyProjections.ts`. Case persist stays in `bookingReconciliation.ts` / `releaseReconciliation.ts`. Decision-only persist stays in `processor.ts`. Events stay in `observability.ts`.

16. **Do not treat official Book / Cancel, case open, Owner review, or drain as this story.** Those write `BookedLead` / `CancelledLead`, open Owner work, resolve a discrepancy, or claim a receipt. This file only opens or refreshes the mismatch row.

17. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `openOrRefreshTheDiscrepancyWhenThisJobFights` (today `createGranotDiscrepancies` → `reconcileObservation`) and `nameThisExactMismatch` (today `createDiscrepancyFingerprint`). The Mongo store is an **adapter**, not a public story — except that Owner re-evaluate must keep calling it.

Today’s `discrepancies.test.ts` already names two beats: the frozen non-PII fingerprint, and memory persist that opens then refreshes one fingerprint without bumping `revision`. Processor unit locks “typed Release conflict goes through this module once.” `discrepancies.replica.test.ts` locks the unique open-fingerprint index (and then Owner commands). Keep those cases. Add command-level names for the gaps:

**Name this exact mismatch**
- Frozen Booking tuple (already locked).
- Null keys stay in the hash; adding a Booking id changes it (already locked).
- Contact / Observation / Decision / timestamp / display must not change the hash (add explicit exclusions; today’s test only implies them).
- Kind + same Job + different reason are different fingerprints (add this).
- Do not add a test that hashes a phone number.

**Open or refresh the one open discrepancy**
- Live + allowed gates + Booking cancel-after-booked → one open row, `revision=1`, causal Decision (already locked in memory).
- Second Observation same fingerprint appends evidence and leaves `revision=1` (already locked).
- Exact Observation replay does not `$push` (add this; today’s memory refresh always pushes only when missing, but the public effect is still `refreshed` with no extra assertion).
- Classification drift throws and writes nothing (add this).
- `execution_mode !== "live"` or a failed gate throws before the transaction (add this).
- Concurrent same-fingerprint writers keep one open row (add replica persist; today’s replica unique-index test inserts raw documents).
- Decision insert failure rolls back the discrepancy (add replica persist).
- Resolved row cannot be refreshed; a later Observation opens a new id (add this).
- Booking and Release fights on one Job may both stay open (add this).
- Do not add a test that this file inserts `BookedLead` or `CancelledLead`.

**After commit, tell observability**
- Opened / refreshed emit after a successful commit (add this; today’s memory test never stubs `emitGranotLifecycleEvent`).
- A thrown emit must not unwrite the row (add this if the current emit is awaited and can fail the caller).
- Do not add a test that this file recounts `open_discrepancies`.

Do **not** add a test per helper (`discrepancyModel`, `isRetryableDiscrepancyRace`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Owner re-evaluate / Correct Record Link / No Action, Booking-case persist, Release-case persist, or processor gate remappers here. Do not add a test that this file CRM-posts, `$set`s a Lead, writes a Record Link, or opens a case.

## What I would not do

- A `GranotDiscrepancyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `insert`.
- Moving this into a CRUD folder, or into `processor.ts` / `discrepancyOwnerCommands.ts` / `bookingReconciliation.ts` / `releaseReconciliation.ts` “for cleanliness.”
- Splitting `create.ts` / `refresh.ts` / `booking.ts` / `release.ts` / `persist.ts`.
- Writing `BookedLead` or `CancelledLead` so “the fight is complete.”
- Opening a case from this file so “normal work and fights share one writer.”
- Calling `reEvaluateGranotDiscrepancy` from persist so “the queue resolves itself.”
- Inventing `GRANOT_LIFECYCLE_DISCREPANCIES_ENABLED`.
- Adding an open-discrepancy gauge so “the persist files match.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` are absent.
- Writing a whole-folder recommendation for `granotLifecycle`.
