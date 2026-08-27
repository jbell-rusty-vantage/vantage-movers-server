# Ask Again Whether This Job Still Fights — Or Point The Job At The Lead The Owner Chose — Or Close The Discrepancy With No Official Write — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 30 of this service — `discrepancyOwnerCommands.ts`
- Remaining in this service: `discrepancyProjections.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/discrepancyOwnerCommands.ts`
- Knowledge: There is **no** standalone Service file in `docs/knowledge/granot-lifecycle/` for these Owner commands. Owner durable-work / reasons / no-flag rule / the three mutations: [`docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md`](../../../docs/granot-lead-lifecycle/discrepancy-review-and-record-link-correction.md). Registry listing: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (`reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` / `resolveGranotDiscrepancyNoAction` are on `canonicalDomainCommands`). Flag table: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) (registered; no command flag). Persist that opened the row: [recommendations/granot-lifecycle-discrepancies.md](granot-lifecycle-discrepancies.md). After-correction case open: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md), [recommendations/granot-lifecycle-release-reconciliation.md](granot-lifecycle-release-reconciliation.md) (`reconcileBookingCaseAfterDiscrepancy` / `reconcileReleaseCaseAfterDiscrepancy`). Distinct from queue / detail reads: next module `discrepancyProjections.ts`. Distinct from Booking / Release Owner review: [recommendations/granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md), [recommendations/granot-lifecycle-release-owner-commands.md](granot-lifecycle-release-owner-commands.md). Distinct from official Book / Cancel: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md), [recommendations/cancellations-cancelled-lead.md](cancellations-cancelled-lead.md). Distinct from Lead-sync / create-if-missing Record Link establish: [recommendations/granot-lifecycle-synchronize-lead-from-granot.md](granot-lifecycle-synchronize-lead-from-granot.md), [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (discrepancies/correction in Progress; no `discrepancyOwnerCommands.ts` row). This checkout’s `CONTEXT.md` does not define Granot Booking Discrepancy / Granot Release Discrepancy / Granot Record Link / No Action — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three HTTP callers, plus the registry object.** `routes/granot-lifecycle-admin.routes.ts` (`POST .../discrepancies/:id/re-evaluate` → `reEvaluateGranotDiscrepancy`; `POST .../discrepancies/:id/correct-record-link` → `correctGranotRecordLink` as `correctDiscrepancyRecordLink`; `POST .../discrepancies/:id/no-action` → `resolveGranotDiscrepancyNoAction`; always 200; `requireRegistryOwnerActor` + one `Idempotency-Key`; route owns `discrepancy_id`; after the return, `void observeGranotOwnerCommandResult` with `discrepancy_resolved: data.state === "resolved"`). Route unit stubs `deps.reEvaluateDiscrepancy` / `deps.correctRecordLink` / `deps.discrepancyNoAction`. Registry: `domainCommands/index.ts` puts all three on `canonicalDomainCommands` (unlike Booking / Release Owner review). Types: `domainCommands/types.ts`. Replica proof lives in `discrepancies.replica.test.ts` (AC-35 / AC-36 / AC-23 / AC-26: No Action replay + revision race with zero Changes/Sheets; still-conflicting re-evaluate replay; correction two Changes / old link retained / Lead scope unchanged / zero official/Sheet; injected `test_fail_after: "changes"` rollback). Not callers: `processor.ts`, `discrepancies.ts` (this file reuses fingerprint + store; it does **not** call `reconcileObservation`), `discrepancyProjections.ts`, `bookingOwnerCommands.ts`, `releaseOwnerCommands.ts`, `bookingReconciliation.ts` / `releaseReconciliation.ts` except the after-discrepancy **adapters**, `synchronizeLeadFromGranot.ts`, `createLeadFromGranot.ts`, public Book / Cancel, `capture.ts`, `drainer.ts`. There is no `discrepancyOwnerCommands.test.ts`.
- Seams callers need: public review vs executor `operation` (no after-commit `finalizeSheetSync`); still-the-same-fight vs resolve-and-open-the-next-fingerprint vs resolve-and-open-a-normal-case; fingerprint + store vs persist (must not insert a second Decision); Booking vs Release collections as two **adapters** of one review rule; Owner initiator vs processor actor from the newest Receipt; this No Action vs Booking / Release No Action; this Record Link supersession vs Lead-sync / create-if-missing establish; `test_fail_after` rollback probe
- Split later (only if the file outgrows one sitting): keep one file — this ~220-line module is one screenplay for “the owner reviewed the fight this discrepancy already named — ask again whether the Job still fights, point the Job at the Lead they chose, or close the row with no official write.” If it later splits: `askAgainWhetherThisJobStillFights.ts` / `pointThisJobAtTheLeadTheOwnerChose.ts` / `closeThisDiscrepancyWithoutWritingOfficialFacts.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `noAction.ts`, and never merge persist / queue reads / Booking-case review / official Book / Cancel into this file

`reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` / `resolveGranotDiscrepancyNoAction` are executor mechanics. The owner questions are: *Granot and Vantage disagree about this Job. That disagreement is already an open discrepancy. The owner is looking at it. If they ask us to look again: reread the newest Observation and current Vantage facts without re-normalizing Granot. If the classified reason is still this reason, leave the row open, write the Command, and stop. If the reason changed, resolve this row and open or refresh the new fingerprint — or, if it is now normal work, open the Booking or Release case — in the same transaction. Never write `BookedLead`. Never write `CancelledLead`. Never `$set` a Lead. Never project sheets.* And: *The owner picked a different Lead for a link / Lead / Job / Source fight whose Granot link is still active and disputed. Supersede that link, write a new active link that names the chosen Lead and that Lead’s Source Scope, remember two Changes, resolve the discrepancy, and open any now-valid normal case. The old link stays. The Lead’s company, granularity, origin, CPL, and business fields do not move. Never write official facts. Never project sheets.* And: *The owner decided this fight needs no official write. Resolve it. Write the Command. Touch nothing else.*

Automatic persist, queue reads, Booking / Release Owner review, Lead-sync Record Link establish, and official Book / Cancel already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one Owner-review story, not “a discrepancy CRUD service,” and not the automatic persist / the queue / Booking-case review / official Book / Cancel:

1. **Ask again whether this Job still fights** — refuse a missing / non-owner actor, a missing idempotency key, a missing discrepancy, or a discrepancy whose newest evidence no longer has a Receipt / Observation / Decision. Inside the transaction: reread the open row at `expected_revision`. Reload current facts through the persist store’s `loadCurrentContext` (sibling classifiers). If the classified reason is still this row’s `reason_code`: return `still_conflicting`, leave `state:"open"`, leave `revision`, write no Change, open no case, enqueue no Sheet. If a different classified reason exists: fingerprint it, find-or-insert-or-refresh the open row for that fingerprint on this command session, then resolve this row `re_evaluated`. If there is no classified reason: ask the Booking or Release after-discrepancy **adapter** to open or refresh a now-valid case (or return nothing when the classifier says it is already satisfied), then resolve this row `re_evaluated`. This function does not call `reconcileObservation`. This function does not insert a Decision. This function does not write a Booking, Cancellation, Lead, Record Link, `EntityChange`, or Sheet Sync intent.

2. **Point this Job at the Lead the owner chose** — same owner door and newest-evidence chain. Inside the transaction: reread the open row at `expected_revision`. Refuse unless this reason is a link / Lead / Job / Source fight (`record_link_conflict` / `job_number_conflict` / `source_scope_conflict` substring, or exact `booked_booking_lead_conflict`) and the row still names a Record Link. Load that link: `provider:"granot"`, `state:"active"`, same Job, `disputed:true`, `domain_revision` still `expected_link_revision`. Load the selected Lead: same Job, has Source Company + Source Granularity; a Form Lead that is Duplicate or Bad is refused. `$set` the old link `superseded` + `superseded_by` on `{_id, state:"active", domain_revision}`. Insert the replacement active link (`disputed:false`, `lead_ref` = chosen Lead, `source_scope` from that Lead, optional `booking_ref` copied, `domain_revision:0`). Remember two `EntityChange` rows; the sibling stamp moves each link `0→1` / `expected→expected+1`. Ask the after-discrepancy **adapter** to open or refresh a now-valid case. Resolve this row `record_link_corrected`. This function does not `$set` the Lead. This function does not write `BookedLead` or `CancelledLead`. This function does not enqueue Sheet Sync. This function does not insert a Decision.

3. **Close this discrepancy without writing official facts** — same owner door and newest-evidence chain. Inside the transaction: reread the open row at `expected_revision`. CAS it to `resolved` / `no_action` and increment `revision` once. Optional reason code/text are metadata only. This function does not write a Booking, Cancellation, Lead, Record Link, `EntityChange`, case, Sheet Sync intent, Decision, notification, or email.

There is no fourth mutate operation and no after-commit sheet finalize. `prepare` / `loadOpen` / `resolve` / `reload` are beats, not public stories. Booking vs Release models are two **adapters** of one review rule. The executor `operation` is the write **seam**; observability after the HTTP return lives on the route, not here. `DiscrepancyOwnerCommandResult` is this file’s Owner-command envelope; it returns `still_conflicting`, `re_evaluated`, `record_link_corrected`, or `no_action`. `test_fail_after` is a rollback-probe **seam** for the replica, not a caller-facing option.

## Organization

Keep one file as the screenplay for “the owner reviewed the fight this discrepancy already named; ask again whether the Job still fights, point the Job at the Lead they chose, or close the row with no official write.” Automatic persist, queue reads, case persist, Booking / Release review, Lead-sync establish, and official Book / Cancel already live in deeper **modules**. Do not pull those in. Do not invent a `GranotDiscrepancyOwnerCommandService` class. Do not invent a second `begin` / `complete` export — `executeIdempotentCanonicalCommand` already is that **seam**, and there is no after-commit sheet **adapter** here. Do not invent a write **seam** that has only one **adapter** here. Do not invent `GRANOT_LIFECYCLE_DISCREPANCY_COMMANDS_ENABLED` — the owner spec says there is no discrepancy flag.

Do not move this into `discrepancies.ts` so “one discrepancy writer.” Do not move this into `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts` so “one `noAction`.” Do not move this into `synchronizeLeadFromGranot.ts` so “one Record Link writer.” Do not move this into `discrepancyProjections.ts` so “the queue can resolve itself.” Do not split `create.ts` / `update.ts` / `delete.ts` / `noAction.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `reEvaluateGranotDiscrepancy` | `askAgainWhetherThisJobStillFights` | admin review’s reread |
| `correctGranotRecordLink` | `pointThisJobAtTheLeadTheOwnerChose` | admin review’s link correction |
| `resolveGranotDiscrepancyNoAction` | `closeThisDiscrepancyWithoutWritingOfficialFacts` | admin review’s zero-effect close |
| `RE_EVALUATE_DISCREPANCY_COMMAND_NAME` | keep — persisted `reEvaluateGranotDiscrepancy` | durable command name |
| `CORRECT_RECORD_LINK_COMMAND_NAME` | keep — persisted `correctGranotRecordLink` | durable command name; do not “fix” the collision with Lead-sync establish |
| `DISCREPANCY_NO_ACTION_COMMAND_NAME` | keep — persisted `resolveGranotDiscrepancyNoAction` | durable command name; do not share `noAction` with Booking / Release |
| `ReEvaluateDiscrepancyInput` | `ARereadTheOwnerMayCommit` | discrepancy + expected revision + owner + key |
| `CorrectRecordLinkInput` | `ALinkCorrectionTheOwnerMayCommit` | discrepancy + both revisions + selected Lead + required reason + owner + key |
| `DiscrepancyNoActionInput` | `ADiscrepancyNoActionTheOwnerMayCommit` | discrepancy + revision + optional reason + owner + key |
| `DiscrepancyOwnerCommandResult` | `WhatTheOwnerReviewDid` | open or resolved + outcome + optional replacement link / opened case |

Keep the old names as one-line aliases until the admin route and the registry migrate. Do not make callers learn `prepare` / `loadOpen` / `reconcileNormalCase` as the domain language.

**Principle: old exports stay as aliases.** `reEvaluateGranotDiscrepancy`, `correctGranotRecordLink`, and `resolveGranotDiscrepancyNoAction` remain the imported names until `granot-lifecycle-admin.routes.ts` and `domainCommands/index.ts` point at the story names.

**No class for the workflow.** The type that *does* earn a name is the causal bag from `prepare`:

```ts
type DiscrepancyReviewInProgress = {
  kind: "booking" | "release"
  observation_id: string
  decision_id: string
  context: CanonicalCommandContext  /* processor actor from the Receipt; owner is initiator */
}
```

That is the handoff from “we found the fight and its newest evidence” to “run the command.” Do **not** add Sheet Sync or CRM Posting so “review matches Booking-case review,” do **not** `$set` a Lead so “the new link can re-home the company,” and do **not** call `reconcileObservation` so “one discrepancy writer.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// discrepancyOwnerCommands.ts
// Granot and Vantage disagree about this Job.
// That disagreement is already an open discrepancy.
// Ask again whether it still fights.
// Or point the Job at the Lead the owner chose.
// Or close the row with no official write.
// Never write BookedLead. Never write CancelledLead.
// Never $set a Lead. Never project sheets.
// This file does not open the discrepancy.
// This file does not list the queue.

// ── 1. Ask again whether this Job still fights ────────────

export async function askAgainWhetherThisJobStillFights(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheNewestEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   rereadTheOpenDiscrepancy()
  //   rereadWhatWeKnowAboutThisFightingJob()   // persist store, sibling classify
  //   ifSameReason, leaveItOpen()              // still_conflicting; revision stays
  //   ifNewReason, openOrRefreshThatFingerprintThenResolveThisRow()
  //   ifNoReason, openTheNowValidCaseThenResolveThisRow()
  //   doNotCallTheAutomaticPersist()
  //   doNotInsertADecision()

function openOrRefreshThatFingerprintThenResolveThisRow(facts, newest, session)
  fingerprint = nameThisExactMismatch(facts)      // sibling
  findOpenOrInsertOrRefreshOnThisSession()        // persist store, not reconcileObservation
  resolveThisRowReEvaluated()

function openTheNowValidCaseThenResolveThisRow(kind, newest, session)
  ifBooking, askTheBookingAfterDiscrepancyAdapter()
  ifRelease, askTheReleaseAfterDiscrepancyAdapter()
  // undefined when the classifier says already satisfied
  resolveThisRowReEvaluated()

// ── 2. Point this Job at the Lead the owner chose ─────────

export async function pointThisJobAtTheLeadTheOwnerChose(input, rollbackProbe?)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheNewestEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   rereadTheOpenDiscrepancy()
  //   refuseUnlessThisFightCanCorrectALink()
  //   loadTheDisputedActiveLinkAtTheExpectedRevision()
  //   loadTheEligibleLeadTheOwnerChose()
  //   supersedeTheOldLink()
  //   writeTheReplacementActiveLink()
  //   rememberTwoRecordLinkChanges()           // sibling stamps domain_revision
  //   openTheNowValidCase()
  //   resolveThisRowRecordLinkCorrected()

function refuseUnlessThisFightCanCorrectALink(row)
  needsARecordLinkId()
  reasonIsLinkOrLeadOrJobOrSourceConflict()
  // not booked_after_official_cancellation
  // not release_without_vantage_booking

function loadTheEligibleLeadTheOwnerChose(selected, job)
  sameJob()
  hasSourceCompanyAndGranularity()
  ifFormLead, refuseDuplicateOrBad()
  doNotChangeTheLead()

function writeTheReplacementActiveLink(old, lead, causal)
  copyJobAndOptionalBookingRef()
  takeSourceScopeFromTheChosenLead()
  disputedFalse()
  domainRevisionZeroUntilTheChangeStamps()

// ── 3. Close this discrepancy without writing official facts

export async function closeThisDiscrepancyWithoutWritingOfficialFacts(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheNewestEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   rereadTheOpenDiscrepancy()
  //   resolveThisRowNoAction()                 // optional reason metadata
  //   writeNoLinkLeadBookingCancellationChangeCaseOrOutbox()
```

Read the primary path out loud: *The processor already opened a fight because Granot said something about this Job that does not match Vantage. That row is not a Booking and not a Cancellation. The owner is looking at it. They can ask us to look again. We reread the newest Observation and current facts. We do not re-normalize Granot. If the classified reason is still this reason, we leave the row open and remember that we asked. If the reason changed, we close this row and open or refresh the new fingerprint in the same transaction. If it is now normal work, we open the Booking or Release case instead. Or they pick a different Lead for a disputed active link. We supersede that link, write a new active one that names the chosen Lead and that Lead’s Source Scope, remember two Changes, close the fight, and open any now-valid case. The old link stays. The Lead does not move. Or they say this fight needs no official write. We close the row, write the Command, and stop. Nobody writes a Booking. Nobody writes a Cancellation. Nobody `$set`s a Lead. Nobody projects sheets. Nobody inserts a second Decision. Nobody calls the automatic persist.*

That is the operation. `reEvaluateGranotDiscrepancy` is not a CRUD update. `correctGranotRecordLink` is not. `resolveGranotDiscrepancyNoAction` is not a delete.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Re-evaluate must not call the automatic persist.** `reconcileObservation` would insert a Decision and leave this command transaction. The **seam** is `createDiscrepancyFingerprint` + `createMongoDiscrepancyStore` on the existing session. Do not call `createGranotDiscrepancies` so “one writer,” and do not move re-evaluate into `discrepancies.ts` so “one discrepancy sitting.”

2. **`still_conflicting` writes a Command and does not resolve.** Same classified reason leaves `state:"open"` and `revision` untouched, with zero Changes and zero cases. The executor still persists `DomainCommandExecution`. Replay returns that row. Do not skip the Command so “nothing changed,” and do not increment `revision` so “every look is a write.”

3. **A new reason resolves this id and may open a different id.** The old row becomes `re_evaluated`. The new fingerprint find-or-insert-or-refresh uses the persist store, not a second Decision. A resolved fingerprint cannot be refreshed; a later Observation for that fingerprint is a new insert (partial unique open index). Do not `$push` onto this resolved row so “one row per Job forever,” and do not reopen the old id so “revisions stay contiguous.”

4. **No classified reason may open a case, or open nothing.** `reconcileBookingCaseAfterDiscrepancy` / `reconcileReleaseCaseAfterDiscrepancy` return `undefined` when the sibling classifier is not `kind:"case"` (already satisfied). The discrepancy still resolves `re_evaluated`. Do not force a case so “every closed fight becomes Owner work,” and do not call public Book / Cancel so “the fight is finished.”

5. **Correction always resolves, even if the Job still fights.** After the new link, this file does not re-fingerprint. A leftover `job_number_conflict` waits for a later Observation (the owner cannot re-evaluate a resolved row). Do not call persist from correction so “the leftover fight is saved,” and do not leave the row open so “we might have been wrong.”

6. **`booked_after_official_cancellation` and `release_without_vantage_booking` cannot correct a link.** `isLinkConflict` is substring `record_link_conflict` / `job_number_conflict` / `source_scope_conflict`, plus exact `booked_booking_lead_conflict`. Those two reasons have no disputed link to supersede. Do not widen the matcher so “every open row can correct,” and do not drop `booked_booking_lead_conflict` so “only `*_record_link_conflict` is a link fight.”

7. **The old link `$set` does not increment `domain_revision`. The Change stamp does.** First write CAS-es `{_id, state:"active", domain_revision}` to `superseded` + `superseded_by`. `persistEntityChangeMutations` then `$set`s `last_change_*` and `domain_revision: expected+1`. Replica AC-23 locks old and replacement at `1`. Do not increment in the first `$set` so “one write,” and do not skip the stamp so “superseded is enough.”

8. **The replacement takes Source Scope from the chosen Lead, not from the old link.** The Lead’s company, granularity, Ingestion Origin, CPL, and business fields never change (replica AC-23). A Lead outside the old scope is still eligible; Zod always requires `reason_text` (10–1000). This file does not compare scopes. Do not `$set` the Lead so “the new link can re-home the company,” and do not add a scope-diff check in this rename so the owner-spec sentence “wins.”

9. **Form Duplicate / Bad is refused. Call Lead has no such flags here.** `loadEligibleLead` only applies `duplicate` / `bad_lead` when `lead_model === "FormLead"`. Same Job + Source Company + Source Granularity is enough for Call. Do not start reading Call `created_on_unmatched` so “every Lead has a quarantine,” and do not accept a Duplicate Form Lead so “the owner typed the id.”

10. **There is no discrepancy command flag.** Booking / Release official writes hide behind `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` / `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED`. These three commands are on `canonicalDomainCommands` and the Owner routes exist. Rollback is caller-side disablement (hide correction, then the case flags). Do not invent `GRANOT_LIFECYCLE_DISCREPANCY_COMMANDS_ENABLED` so “every Owner write has a door,” and do not remove these from the registry so “they match Booking review.”

11. **These commands are on the registry. Booking / Release Owner review is not.** `domainCommands.md` lists all three here and says confirm / Booking No Action / Release commands call the executor without being on the object. `existingWrites.ts` is tested to **not** import `correctGranotRecordLink`. Do not add Booking review to the registry so “every command is registered,” and do not route this file through `existingWrites` so “one adapter.”

12. **`noAction` is three different Owner closes.** This file, `bookingOwnerCommands.ts`, and `releaseOwnerCommands.ts` all close Owner work. Persisted names already tell them apart (`resolveGranotDiscrepancyNoAction` / `resolveGranotBookingCaseNoAction` / `resolveGranotReleaseCaseNoAction`). This close writes no `EntityChange`. Do not share one function so “one No Action,” and do not rename the persisted discrepancy command to `noAction`.

13. **Observability is route-owned, not this file.** After a 200, the route `void observeGranotOwnerCommandResult` (`applied` / `replayed`, plus `{kind}_discrepancy.resolved` when `state === "resolved"`). `still_conflicting` does not emit resolved. This file has no after-commit finalize and no Sheet **adapter**. Do not move the emit in here so “the command matches persist,” and do not enqueue Sheet Sync so “review matches Booking-case review.”

14. **`test_fail_after` is a replica probe, not a caller-facing option.** `"old_link"` / `"replacement"` / `"changes"` throw inside the transaction so rollback can be proved. Keep it as a named rollback-probe **seam**. Do not grow a fourth public export, and do not delete the probe so “the interface is clean” until a memory test can fail the same boundaries another way.

15. **`prepare` loads Observation / Receipt outside the transaction.** `findAny` + newest evidence + Receipt happen before `executeIdempotentCanonicalCommand`. `loadOpen` then CAS-es `{state:"open", revision}` inside. A resolve race is `CASE_REVISION_CONFLICT`. Do not move the evidence load inside so “one read,” and do not drop the inside CAS so “prepare already saw it.”

16. **Command-door gates are required; the route already checked the owner.** The route requires `requireRegistryOwnerActor` and one `Idempotency-Key`, and it owns `discrepancy_id` (a body `discrepancy_id` is 400). This file still asserts owner + key, then rereads kind / revision / newest evidence inside. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the route already authorized.”

17. **`discrepancies.replica.test.ts` names the persist module and tests this one.** AC-36 unique-open-fingerprint is persist-adjacent. The other four replica cases are these commands. There is no `discrepancyOwnerCommands.test.ts`. Do not move persist proof into this file’s “already locked” column, and do not delete the replica filename so “the name is wrong” in this rename.

18. **Leave sibling modules alone.** Automatic persist stays in `discrepancies.ts`. Queue / detail stay in `discrepancyProjections.ts`. After-correction case open stays in `bookingReconciliation.ts` / `releaseReconciliation.ts`. `EntityChange` stamps stay in `domainCommands/entityChange.ts`. Owner events stay in `observability.ts`. Booking / Release official review stay in their Owner-command files.

19. **Do not treat official Book / Cancel, automatic persist, queue reads, or drain as this story.** Those write `BookedLead` / `CancelledLead`, open the mismatch row, list the queue, or claim a receipt. This file only reviews a row that already exists.

20. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `askAgainWhetherThisJobStillFights` (today `reEvaluateGranotDiscrepancy`), `pointThisJobAtTheLeadTheOwnerChose` (today `correctGranotRecordLink`), and `closeThisDiscrepancyWithoutWritingOfficialFacts` (today `resolveGranotDiscrepancyNoAction`).

Today there is no `discrepancyOwnerCommands.test.ts`. Replica `discrepancies.replica.test.ts` already names four beats: No Action replay + one-winner revision race with zero Changes/Sheets; still-conflicting re-evaluate replay; correction two Changes / old link retained / Lead scope unchanged / zero official/Sheet; injected rollback after Changes. Route unit only stubs the three deps and locks Owner-only + route-owned id. Keep those cases. Add command-level names for the gaps:

**Ask again whether this Job still fights**
- Same classified reason stays open, `revision` unchanged, Command written, zero Changes (already locked in replica).
- Exact replay returns the same `command_execution_id` (already locked).
- A new classified reason resolves this id and opens or refreshes the other fingerprint in one transaction (add this; today’s replica never changes the reason).
- No classified reason resolves this id and may return `opened_case_ref` (add this).
- Already-satisfied classifier resolves with no case (add this).
- Re-evaluate does not insert a Decision and does not call `reconcileObservation` (add this).
- Stale `expected_revision` is `CASE_REVISION_CONFLICT` (add this).
- Do not add a test that this path writes `BookedLead` or `$set`s a Lead.

**Point this Job at the Lead the owner chose**
- Disputed active link is superseded; replacement is active and names the chosen Lead (already locked).
- Two Changes; old and replacement `domain_revision` become 1 (already locked).
- Lead Source Company / granularity unchanged (already locked).
- Zero Bookings / Cancellations / Sheet Sync jobs (already locked).
- Failure after Changes rolls back link, discrepancy, Command, and Changes (already locked).
- Failure after old-link `$set` / after replacement insert also rolls back (add these; the probe exists, the replica only uses `"changes"`).
- Non-link reason / missing `record_link_id` is `IDENTITY_CONFLICT` (add this).
- Stale `expected_link_revision` is `DOMAIN_REVISION_CONFLICT` (add this).
- Duplicate or Bad Form Lead is `IDENTITY_CONFLICT` (add this).
- Call Lead with the same Job and source is eligible (add this).
- `booked_after_official_cancellation` cannot correct (add this).
- Do not add a test that this file `$set`s the Lead or enqueues Sheet Sync.

**Close this discrepancy without writing official facts**
- Resolves, `revision+1`, one Command, zero Changes / Sheets (already locked).
- Exact replay (already locked).
- Pairwise one winner (already locked).
- Optional reason is metadata only (add an assertion on `resolution.reason_code`).
- Do not add a test that No Action opens a case.

Do **not** add a test per helper (`isLinkConflict`, `modelName`, `body`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test automatic persist, queue DTOs, Booking-case review, Release-case review, or Lead-sync establish here. Do not add a test that this file CRM-posts, `$set`s a Lead, writes `BookedLead`, or lists the discrepancy queue.

## What I would not do

- A `GranotDiscrepancyOwnerCommandService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `resolve`.
- Moving this into a CRUD folder, or into `discrepancies.ts` / `discrepancyProjections.ts` / `bookingOwnerCommands.ts` / `synchronizeLeadFromGranot.ts` “for cleanliness.”
- Splitting `create.ts` / `update.ts` / `delete.ts` / `noAction.ts`.
- Calling `reconcileObservation` from re-evaluate so “one writer.”
- Writing `BookedLead` or `CancelledLead` so “the fight is complete.”
- `$set`ting the chosen Lead so “the new link can re-home the company.”
- Enqueueing Sheet Sync so “review matches Booking-case review.”
- Inventing `GRANOT_LIFECYCLE_DISCREPANCY_COMMANDS_ENABLED`.
- Sharing one `noAction` with Booking / Release review.
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` are absent.
- Writing a whole-folder recommendation for `granotLifecycle`.
