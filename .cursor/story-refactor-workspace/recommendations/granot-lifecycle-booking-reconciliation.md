# Open Or Refresh Owner Work When Granot Booked This Job — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 22 of this service — `bookingReconciliation.ts`
- Remaining in this service: `bookingConfirmation.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/bookingReconciliation.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) lists this file as primary code beside `bookingPriorityPairing.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, the case model, and `processor.ts` — they are siblings, not this pass. Trigger and pairing authority: [`docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md`](../../../docs/granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md). Processor invoke / fall-through: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) and [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from pairing fold: next-but-pairing `bookingPriorityPairing.ts`. Distinct from Owner confirm / update / No Action: next module `bookingConfirmation.ts` and `bookingOwnerCommands.ts`. Distinct from no-Lead Referral mint: `referralBooking.ts`. Distinct from Release case persist: `releaseReconciliation.ts`. Distinct from discrepancy persist: `discrepancies.ts`. Distinct from official Book This Lead: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md). Distinct from CSV Booked Jobs: [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Distinct from employee leadless rematch: `src/config/domain/bookingReconciliation.ts` and `employeeBookings`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`bookingReconciliation.ts` row). This checkout’s `CONTEXT.md` does not define Granot Booking Reconciliation Case / Booking Priority Pairing / Synchronization Decision — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one automatic persist caller.** `processor.ts` (`maybeReconcileBooking` → `deps.reconcileBooking` or `createGranotBookingReconciliation({ prepared }).reconcileObservation` after live + booked + Job + every Booking-case gate; opened / refreshed become the Decision and **return before** Lead create/sync; typed discrepancy persists via `createGranotDiscrepancies`; `none` except `employee_reconciliation_missing` falls through). Classifier reuse: `discrepancies.ts` (`loadCurrentContext` → `classifyBookingReconciliation`). After-correction persist: `discrepancyOwnerCommands.ts` (`reconcileBookingCaseAfterDiscrepancy` inside the Owner command transaction). Candidate **interface**: `projections.ts` (`listGranotLifecycleCaseCandidates` → `searchBookingLeadCandidates` + `projectBookingCandidateBrowserPolicy`); `discrepancyProjections.ts` (`searchBookingLeadCandidates`). Barrel only: `routes/granot-lifecycle-admin.routes.ts` imports `confirmBooking` / `createReferralBooking` / `updateExistingBooking` / `noAction` from this file — those live in siblings. Operator: `scripts/migrations/granot-lifecycle-owner-booking-case-intake.ts`, `scripts/migrations/granot-lifecycle-inbound-job-prefix-repair.ts`. Tests: `bookingReconciliation.test.ts` (AC-18 / AC-18a / AC-19 / AC-20 / AC-28 / AC-35 / AC-39 / AC-40 / AC-P1–P5 / AC-P8). Replica: `bookingReconciliation.replica.test.ts` (AC-18 / AC-20 / AC-28 / AC-32 / AC-36 / AC-P8). Processor unit locks “invoke once / never invoke / Priority 5 is not a booking.” Not callers: `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts` (this file re-exports them), `releaseReconciliation.ts`, `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `capture.ts`, `drainer.ts`, public `/api/v1/booked-leads`, `reconciliation/bookedCallLeadReconciliation.service.ts`.
- Seams callers need: processor `{ reconcileObservation }` factory vs injected `deps.reconcileBooking`; classifier vs persist (discrepancies classify without writing a case); after-discrepancy reuse inside an existing session vs automatic open (no Decision, no gauge); candidate projection vs 24-hour search; Owner-command re-exports until routes point at siblings
- Split later (only if the file outgrows one sitting): this ~1,150-line file is one screenplay for “open or refresh Owner work when Granot booked this Job.” If it later splits: `decideWhetherThisBookedJobNeedsOwnerWork.ts` / `openOrRefreshTheBookingCaseWhenGranotBookedThisJob.ts` / `showTheOwnerWhichLeadsThisCaseMayAttach.ts` — story files, never `create.ts` / `update.ts` / `classify.ts` / `persist.ts`, and never merge confirm / Referral mint into this file

`createGranotBookingReconciliation` / `reconcileObservation` / `reconcileInTransaction` are executor mechanics. The owner question is: *Granot said this Job is booked. That is not a Booking. If we are live and every Booking-case gate allowed: reread the Observation, the active Job link, identity, and whether a Booking or Cancellation already exists. Open the one open Owner work case for this Job, or append this Observation onto it. Remember the Decision in the same transaction. After commit, recount open cases and tell observability. Priority 5 is not booking evidence. Release is the other case. Never write `BookedLead`. Never confirm. The owner does that later. This file does not plan a Lead. This file does not mint a Lead. This file does not run an Owner command.*

Pairing fold, Owner confirm / update / No Action, Referral mint, Release persist, discrepancy persist, and processor Decision-only persist already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one Booking-case story, not “a reconciliation CRUD service,” and not the Owner confirm / the pairing fold / the Release case / official Book This Lead:

1. **Decide whether this Booked Observation needs Owner work** — refuse a missing Job. Actual `booking_action === "booked"` only. Release is `opposite_action_kind`. Priority 5, or any other non-Booked action, is `not_booking_evidence`. A Booking that is already officially cancelled is a typed discrepancy (`booked_after_official_cancellation`). Reviewed Referral with no Booking opens `create_referral_booking`. Reviewed Referral with a Referral Booking reviews that Booking. A Referral Booking on a source-scoped row, or a source-scoped Booking on a Referral row, is `booked_booking_lead_conflict`. A lead-less non-Referral Booking delegates to the existing employee `BookingLeadReconciliationCase`, or fails closed as `employee_reconciliation_missing`. Identity `conflict` becomes a booked-* discrepancy. Otherwise: no Booking → `create_missing_booking`; one active Booking → `review_existing_booking` with its id. Ambiguous identity still opens a case; it just carries no suggestion. This function does not persist.

2. **Open or refresh the one open Booking case for this Job** — refuse unless the prepared Decision is `live` and every gate is allowed. One retry on duplicate-key / write-conflict / transient transaction. Inside the transaction: reread Observation, policy, identity, active Record Link, Booking, official Cancellation, and employee work. Refuse if the prepared receipt no longer names this Observation. Classify again. Persist a Decision and stop when the answer is `employee_reconciliation_missing` or employee-case delegation. Return a typed discrepancy without writing a case. Fail closed unless `evidence_action === "booked"`. Referral persist also refuses if the reviewed source policy drifted. Find the open `{job, booked}` case; exact Observation replay returns the row and does not rewrite pairing. A new Observation appends the four-field evidence tuple, refreshes observed context / suggestion / pairing, and increments `evidence_revision` (and `case_revision` only when the suggestion changed). No open case → `max(sequence)+1`, `case_revision=1`, `evidence_revision=1`. Referral writes no Source Scope and no suggested Lead. Remember the immutable Decision (`linked` / `booking_case_opened|refreshed`) in the same session. After commit: recompute `granot_lifecycle_open_cases{kind="booking",mode}` (swallow a thrown count) and emit the opened/refreshed event. This function does not write `BookedLead`. This function does not confirm.

3. **After the owner fixes a discrepancy, open or refresh the same case inside their transaction** — reuse the classifier and store on the caller’s session. Fail closed unless the classification is actual Booked. Same open / refresh / sequence rules, including pairing. Do not insert a Decision. Do not recompute the gauge. Do not emit. Return the case ref or `undefined` when classify is not a case. This function does not resolve the discrepancy.

4. **Show the owner which Leads this case may attach** — a suggestion is the current identity target when eligibility is `full`, outcome is not `ambiguous` / `conflict`, and a match method exists (Record Link / exact Form / exact Call Job / Booking-owner = high; Source Scope contact = medium). The candidate list is that identity projection: drop Duplicate Form and Bad Form rows, mark the suggested one, pin it if the ladder omitted it, dedupe by Lead ref. Search rereads identity only while the case is 0–24 hours old (`opened_at` in the future is ineligible). The browser policy copies a canonical row when present; otherwise Job-exact is high (`call_job_no_exact` / `form_ref_no_exact`) and everything else is medium contact, with `requires_override_reason` when the Lead is outside the case Source Scope. This function does not attach a Lead. Referral browse stays empty in `projections.ts`, not here.

There is no fifth mutate operation. `createGranotBookingReconciliation` is the processor **adapter** of operation 2 (`{ reconcileObservation }`), not a second public story. `createMongoBookingReconciliationStore` is the Mongo **adapter**, not a story. Owner `confirmBooking` / `updateExistingBooking` / `createReferralBooking` / `noAction` are re-exports of sibling **modules**. Pairing snapshot is a beat of open/refresh; the fold lives in `bookingPriorityPairing.ts`.

## Organization

Keep one file as the screenplay for “Granot booked this Job; open or refresh Owner work; never write the Booking.” Pairing fold, Owner commands, Referral mint, Release persist, discrepancy persist, identity, and gates already live in deeper **modules**. Do not pull those in. Do not invent a `GranotBookingReconciliationService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — case and Decision commit together; gauge and event stay after commit. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `processor.ts` so “knowledge lists both as primary code.” Do not move this into `bookingConfirmation.ts` so “open and confirm are one sitting.” Do not merge this file into `releaseReconciliation.ts` so “one case writer.” Do not merge this file into `reconciliation/bookedCallLeadReconciliation.service.ts` so “one booked recon.” Do not split `create.ts` / `refresh.ts` / `classify.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotBookingReconciliation` | `openOrRefreshTheBookingCaseWhenGranotBookedThisJob` | processor’s only Booking-case persist |
| `classifyBookingReconciliation` | `decideWhetherThisBookedJobNeedsOwnerWork` | persist and discrepancies share one answer |
| `reconcileBookingCaseAfterDiscrepancy` | `openOrRefreshTheBookingCaseAfterTheOwnerFixesADiscrepancy` | existing Owner-command session; no Decision / gauge |
| `toBookingLeadSuggestion` | `suggestTheLeadThisCaseMayAttach` | persist + candidate list |
| `projectBookingLeadCandidates` | `listTheLeadsThisCaseMayAttach` | ranked identity; exclude Duplicate / Bad Form |
| `searchBookingLeadCandidates` | `refreshWhichLeadsThisCaseMayAttach` | 24-hour door + reread identity |
| `projectBookingCandidateBrowserPolicy` | `markWhetherThisBrowsedLeadNeedsAnOverride` | Owner browse all-scope warning |
| `isBookingCandidateRefreshEligible` | `theCaseIsStillYoungEnoughToRefreshCandidates` | 24-hour door |
| `createMongoBookingReconciliationStore` | `theMongoBookingCaseStore` | discrepancies, after-discrepancy, search |
| `PreparedBookingReconciliationDecision` | `APreparedLiveBookingDecision` | processor handoff: live + gates + ids |
| `CaseEffectResult` | `WhatTheBookingCaseWriteDid` | opened / refreshed / none / employee / discrepancy |
| `confirmBooking` / `createReferralBooking` / `updateExistingBooking` / `noAction` | keep as aliases | admin routes import the barrel today |

Keep the old names as one-line aliases until `processor.ts`, `discrepancies.ts`, `projections.ts`, and the admin routes migrate. Do not make callers learn `reconcileInTransaction` / `reconcilePreparedObservation` / `loadCurrentContext` as the domain language.

**No class for the workflow.** The `{ reconcileObservation }` factory is a one-method processor **adapter**, not a workflow class. The type that *does* earn a name is the reread facts bag:

```ts
type WhatWeKnowAboutThisBookedJob = {
  /* today's BookingReconciliationCurrentContext:
     Observation + receipt, Job, Priority, booked|release,
     reviewed disposition, identity, active link, Booking facts */
}
```

That is the handoff from “reread Observation, identity, Booking, Cancellation, and employee work” to “classify and maybe persist.” Do **not** add `official_booking_details` so “the case can confirm,” and do **not** persist a `BookedLead` so “create-missing is complete.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingReconciliation.ts
// Granot said this Job is booked. That is not a Booking.
// Open or refresh one Owner work case so a human can confirm, update, or take no action.
// Priority 5 is not a booking. Release is the other case.
// Never write BookedLead. Never confirm.

// ── 1. Decide whether this Booked Observation needs Owner work ─

export function decideWhetherThisBookedJobNeedsOwnerWork(facts)
  ifMissingJob, stop("missing_job_number")
  ifRelease, stop("opposite_action_kind")
  ifNotActualBooked, stop("not_booking_evidence")          // Priority 5 lives here
  ifBookingAlreadyCancelled, requireADiscrepancy("booked_after_official_cancellation")
  ifReviewedReferral, openCreateReferralOrReviewThatReferralBooking()
  ifReferralBookingOnASourceScopedRow, requireADiscrepancy("booked_booking_lead_conflict")
  ifLeadlessEmployeeBooking, handToTheExistingEmployeeCaseOrFailClosed()
  ifIdentityIsFighting, requireABookedDiscrepancy()
  ifNoBooking, openCreateMissing()
  ifOneActiveBooking, openReviewExisting(thatId)
  // ambiguous identity still opens; it just carries no suggestion

// ── 2. Open or refresh the one open Booking case ──────────

export function openOrRefreshTheBookingCaseWhenGranotBookedThisJob(prepared)
  refuseUnlessLiveAndEveryGateAllowed()
  retryOnceOnDuplicateKeyOrTransientWrite()
  // then in one transaction:
  //   rereadWhatWeKnowAboutThisBookedJob()
  //   decideWhetherThisBookedJobNeedsOwnerWork()
  //   persistTheCaseAndTheDecisionTogether()
  // after commit:
  //   recountOpenCasesAndTellObservability()

async function persistTheCaseAndTheDecisionTogether(facts, classification, session)
  ifEmployeeWorkMissing, rememberThePreparedDecisionAndStop()
  ifDiscrepancyRequired, returnItWithoutWritingACase()
  refuseUnlessEvidenceActionIsBooked()
  ifReferral, refuseIfReviewedPolicyDrifted()
  snapshotThePriorityPairing()                            // sibling fold
  ifOpenCaseAndSameObservation, replayWithoutRewrite()
  ifOpenCaseAndNewObservation, appendEvidenceAndMaybeBumpCaseRevision()
  ifNoOpenCase, openTheNextSequence()
  rememberTheLinkedDecision()

// ── 3. After the owner fixes a discrepancy ────────────────

export async function openOrRefreshTheBookingCaseAfterTheOwnerFixesADiscrepancy(input, session)
  rereadAndClassifyOnTheCallerSession()
  ifNotACase, return undefined
  persistTheCaseWithoutADecisionOrAGauge()

// ── 4. Show the owner which Leads this case may attach ────

export function suggestTheLeadThisCaseMayAttach(identity)
export function listTheLeadsThisCaseMayAttach(identity)
export async function refreshWhichLeadsThisCaseMayAttach(observation, openedAt)
export function markWhetherThisBrowsedLeadNeedsAnOverride(lead, caseScope, canonical)
export function theCaseIsStillYoungEnoughToRefreshCandidates(openedAt, now)
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, and already authorized live Booking-case gates. Granot said this Job is booked. Reload the Observation, the active Job link, identity, and whether a Booking or Cancellation already exists. If Granot only raised Priority 5, stop — that is still a Lead problem. If Granot released the Job, stop — that is the other case. If the Booking is already cancelled, ask for a discrepancy. If this is a lead-less employee Booking, hand it to the existing employee case. If identity is fighting, ask for a discrepancy. Otherwise open the one open Owner work case for this Job, or append this Observation onto it. Remember the Decision in the same transaction. After commit, recount open cases and tell observability. Nobody writes `BookedLead`. Nobody confirms. The owner does that later, on a different file.*

That is the operation. `createGranotBookingReconciliation` is not a CRUD create. `reconcileObservation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Priority 5 is not a booking, and both doors say so.** `maybeReconcileBooking` returns before invoke unless `normalized === "booked"`. This classifier also returns `not_booking_evidence` for Priority 5. That is two **adapters**, not a duplicate to delete. Do not drop the classifier check so “the processor already filtered,” and do not skip the processor check so “the case module can take a raw Priority.”

2. **`priority_5_existing_booking` is dead. `priority_5_ineligible_target` is unused.** After the early `not_booking_evidence` return, `actualBooked` is always true, so the `booking?.referral && !actualBooked` branch never runs. Nothing emits `priority_5_ineligible_target`. Do not revive those reasons so “the union is complete,” and do not start opening Priority-5 cases so the leftover names “win.”

3. **`evidence_action` still allows `priority_5`.** New traffic never emits it. Stored historical rows may still carry it. Persist and after-discrepancy fail closed unless the live classification is `booked`. Do not delete the union member so “the classifier is honest,” and do not start emitting `priority_5` so “the type is live.”

4. **This file re-exports Owner commands it does not run.** Admin routes import `confirmBooking` / `createReferralBooking` / `updateExistingBooking` / `noAction` from this barrel. Knowledge Primary-code lists those siblings beside this file. Do not pull confirm into this file so “the Service title includes commands,” and do not delete the aliases until the routes point at the siblings.

5. **`createGranotBookingReconciliation` is a one-method factory, not a workflow class.** `{ reconcileObservation }` exists so the processor can inject `deps.reconcileBooking`. Do not grow a `GranotBookingReconciliationService` with `create` / `update` / `delete`, and do not add `confirm` onto that object so “one reconciliation API.”

6. **`employee_reconciliation_missing` is the only `none` that persists a Decision here.** Other `none` reasons persist nothing and the processor falls through to Lead create/sync. This reason inserts the prepared Decision, and the processor returns that attempt instead of falling through. Do not persist every `none` so “every classify writes,” and do not drop this Decision so “none never writes.”

7. **Open/refresh and after-discrepancy reprint the same persist beats.** Suggestion fold, pairing snapshot, open-vs-refresh, sequence, Referral-without-scope. The **seam** is the session and whether a Decision / gauge / event fire. Shared beats: classify, fail closed unless booked, pairing, open or refresh. Do not call `reconcileObservation` from after-discrepancy so “one writer” (that would insert a second Decision and leave the Owner transaction). Do not emit or gauge from after-discrepancy so “the case is announced twice.”

8. **Reviewed Referral policy must still match at persist.** Classifier may already say `create_referral_booking`. Persist still compares current vs prepared `granot_crm_source_id` / disposition / version and throws if they drifted. Do not drop the check so “classify already used disposition,” and do not write Source Scope onto a Referral case so “every case has a scope.”

9. **Exact Observation replay is a no-op, including pairing.** Same `observation_id` on the open case returns refreshed with the stored revisions and does not rewrite `priority_pairing`. A different Decision id on replay throws. Do not recompute pairing on replay so “the snapshot stays fresh,” and do not accept a second Decision id so “the caller minted a new one.”

10. **Pairing never bumps `case_revision`. Suggestion change does.** A second Booked Observation may replace `booked_carries_priority_5` with `booked_without_priority_5` and only increment `evidence_revision`. A changed suggested Lead increments both. Owner drafts key off `case_revision`. Do not `$inc` case revision on pairing so “the snapshot is owner work,” and do not skip case revision on suggestion change so “evidence covers it.”

11. **`later_priority_5` is never stored.** The sibling fold may compute it; this persist only snapshots on actual Booked open/append. A later Priority-5 Observation classifies `not_booking_evidence` and does not touch the case. Do not append Priority 5 onto booked evidence so “the pairing is complete.”

12. **The 24-hour candidate window treats a future `opened_at` as ineligible.** `age >= 0 && age <= 24h`. Do not refresh candidates on a clock-skewed future open so “the case is new,” and do not attach a Lead from search so “refresh found one.”

13. **Duplicate Form and Bad Form never appear as candidates.** `duplicate_form_lead_ineligible` and `bad_form_lead_priority_only` drop in the projection. `toBookingLeadSuggestion` also refuses `priority_only` / `ambiguous` / `conflict`. Do not suggest a Duplicate so “the ladder named it,” and do not pull browse SQL into this file so “one candidate writer.”

14. **Gauge and event stay after commit, and the gauge cannot fail the caller.** Opened / refreshed emit `granot_lifecycle.booking_case_opened|refreshed`; observability remaps those to `granot_lifecycle.booking_case.opened|refreshed` and masks ids. The unit looks for the remapped key. Do not pre-mask details so “the event is already safe,” and do not move the gauge inside the transaction so “the count is atomic.”

15. **Local `maskLifecycleId` is dead.** This file defines it and never calls it. `safeLogging` and `observability` already own two different masks. Do not start calling the local copy so “events are masked here,” and do not silently merge the three helpers.

16. **Knowledge lists this file under the processor and under Owner commands.** `processor.md` Primary code is orchestration + this case persist + Lead commands + planner + temporal. This file does not `$set` a Lead and does not confirm a Booking. Do not move it into `processor.ts` so the Primary-code line “wins,” and do not start writing `BookedLead` here so “create-missing is the Booking.”

17. **`src/config/domain/bookingReconciliation.ts` is employee rematch, not this story.** Same English words, different case (`BookingLeadReconciliationCase`). This file only delegates to that work when a lead-less non-Referral Booking already has a case. Do not import the employee auto-rematch config so “one reconciliation config.”

18. **Leave sibling modules alone.** Pairing fold stays in `bookingPriorityPairing.ts`. Confirm stays in `bookingConfirmation.ts`. Update / No Action stay in `bookingOwnerCommands.ts`. Referral mint stays in `referralBooking.ts`. Release persist stays in `releaseReconciliation.ts`. Discrepancy persist stays in `discrepancies.ts`. Identity stays in `identity.ts`. Gates stay in `sourcePolicy.ts`. Candidate browse page / DTO stay in `projections.ts`. Decision-only persist stays in `processor.ts`.

19. **Do not treat official Book This Lead, CSV Booked Jobs, employee submit, Owner confirm, or drain as this story.** Those write `BookedLead`, patch a Call Lead from a sheet, attach a leadless Booking, run a gated command, or claim a receipt. This file only opens or refreshes Owner work when Granot booked a Job.

20. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `openOrRefreshTheBookingCaseWhenGranotBookedThisJob` (today `createGranotBookingReconciliation` → `reconcileObservation`), `decideWhetherThisBookedJobNeedsOwnerWork` (today `classifyBookingReconciliation`), `openOrRefreshTheBookingCaseAfterTheOwnerFixesADiscrepancy`, and the four candidate exports. The Mongo store is an **adapter**, not a public story.

Today’s `bookingReconciliation.test.ts` already names the operations: Priority 5 never opens; Referral Priority 5 stays `not_booking_evidence`; actual Booked opens create-missing or review-existing and does not treat ambiguity as no-case; employee / cancel / Referral routes; Release is opposite; suggestions drop Bad / Duplicate / ambiguous; browser policy marks out-of-scope override; memory persist opens + Decision + remapped event; refresh does not stale `case_revision`; replay dedupes; Referral has no scope / suggestion; resolved rows take `max+1`; pairing snapshot / replay no-op / later Priority 5 does not write; second Booked refreshes pairing; employee missing persists Decision and no case. `bookingReconciliation.replica.test.ts` is the Mongo proof: Referral race, open/refresh race, replay, sequence after resolve, suggestion vs evidence revision, injected Decision rollback, pairing no-op. Keep those cases. Add command-level names for the gaps:

**Decide whether this Booked Observation needs Owner work**
- Priority 5, with or without a Booking, is `not_booking_evidence` and never `evidence_action: "priority_5"` (already locked).
- Invalid Priority on actual Booked still opens (already locked).
- Release is `opposite_action_kind` and does not append (already locked).
- Officially cancelled Booking → `booked_after_official_cancellation` (already locked).
- Lead-less employee case delegates; missing employee work is `employee_reconciliation_missing` (already locked).
- Identity conflict on Booked → typed booked-* discrepancy (add the no-booking conflict case; today’s AC-28 conflict row still has an employee case and therefore delegates).

**Open or refresh the one open Booking case**
- Live + booked + no Booking → one `create_missing_booking`, `case_revision=1`, causal Decision (already locked).
- Second Booked Observation appends evidence, pairing may change, `case_revision` stays unless suggestion changed (already locked).
- Exact Observation replay does not rewrite pairing or revisions (already locked).
- Concurrent same-Job writers keep one open case (replica already locked).
- Decision insert failure rolls back the case (replica already locked).
- Gauge swallow: add that a thrown `countOpenCasesByMode` still returns opened (today’s memory store never throws).
- Do not add a test that this file inserts `BookedLead`.

**After the owner fixes a discrepancy**
- Booked classification opens or refreshes on the caller session and inserts no Decision (add this; today’s unit/replica do not call `reconcileBookingCaseAfterDiscrepancy`).
- Non-case classification returns `undefined` and writes nothing (add this).
- Do not add a test that after-discrepancy emits or recomputes the gauge.

**Show the owner which Leads this case may attach**
- Duplicate / Bad Form rows drop; suggested pin + dedupe (already locked).
- 24-hour inclusive window; +1ms is empty (already locked).
- Out-of-scope browse requires override (already locked).
- Do not add a test that search attaches a Lead.

Do **not** add a test per helper (`suggestionEquals`, `creatingBookedFromContext`, `discrepancyReason`, `canonicalCandidateMatchMethod`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Owner confirm, Referral mint, Release persist, pairing fold internals, or processor gate remappers here. Do not add a test that this file CRM-posts, `$set`s a Lead, or writes `BookedLead`. Do not add a test that Priority 5 opens a case.

## What I would not do

- A `GranotBookingReconciliationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `insertCase`.
- Moving this into a CRUD folder, or into `processor.ts` / `bookingConfirmation.ts` / `releaseReconciliation.ts` / `reconciliation/bookedCallLeadReconciliation.service.ts` “for cleanliness.”
- Splitting `create.ts` / `refresh.ts` / `classify.ts` / `persist.ts`.
- Writing `BookedLead` so “create-missing is complete.”
- Opening a case on Priority 5 so leftover `priority_5_*` reasons “win.”
- Calling `confirmBooking` from open/refresh so “the case resolves itself.”
- Silently merging employee rematch config (`src/config/domain/bookingReconciliation.ts`) into this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
