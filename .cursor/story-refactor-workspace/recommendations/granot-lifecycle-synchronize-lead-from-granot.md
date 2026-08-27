# Write What Granot May Change Onto This Matched Lead — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 20 of this service — `synchronizeLeadFromGranot.ts`
- Remaining in this service: `createLeadFromGranot.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/synchronizeLeadFromGranot.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) lists this file as primary code beside `processor.ts`, `createLeadFromGranot.ts`, `bookingReconciliation.ts`, `leadDesiredState.ts`, and `granotTemporal.ts` — they are siblings, not this pass. Command conversion / contact hashes: [`docs/knowledge/granot-lifecycle/desired-state.md`](../../../docs/knowledge/granot-lifecycle/desired-state.md). Revision CAS + `EntityChange` stamp: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) and [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Distinct from the in-memory plan: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md). Distinct from the allowlisted convert / command-door assert / fingerprints: [recommendations/granot-lifecycle-authorized-desired-state.md](granot-lifecycle-authorized-desired-state.md). Distinct from Temporal compare / winner filter: [recommendations/granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Distinct from processor Decision / live invoke / metadata-only clock stamp: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from the trusted mint stamp: [recommendations/granot-lifecycle-trusted-lead-create-validation.md](granot-lifecycle-trusted-lead-create-validation.md). Distinct from the write that invents a Lead: next module `createLeadFromGranot.ts`. Distinct from public Form correction: [recommendations/form-lead.md](form-lead.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`synchronizeLeadFromGranot.ts` row). This checkout’s `CONTEXT.md` does not define Granot Observation / Synchronization Decision / Granot Record Link / Ingestion Origin — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one live service import.** `processor.ts` (`maybeSynchronizeMatchedLead` → `deps.synchronizeLead ?? synchronizeLeadFromGranot` after convert + assert; `applied` plan, or `already_current` that still needs a lead-attached Record Link). Registry: `domainCommands/index.ts` (`canonicalDomainCommands.synchronizeLeadFromGranot`). Type-only: `domainCommands/types.ts`. Tests: `synchronizeLeadFromGranot.test.ts` (AC-32 door: refuse shadow / writes-off / failed gate / wrong actor; catalog stamp helper). Replica proof: `synchronizeLead.replica.test.ts` (AC-05 / AC-07 / AC-10 / AC-11 / AC-12 / AC-13 / AC-32 through the processor). Processor unit stubs the command. Executor integration uses the command name as a fixture string. Not callers: `createLeadFromGranot.ts`, `leadDesiredState.ts`, `authorizedDesiredState.ts` (this file calls `assert` / `hashGranotContactLeaves`), `capture.ts`, `drainer.ts`, public `/api/v1/form-leads` PATCH, `formLead.service.ts`.
- Seams callers need: public write vs executor `operation` / `finalize` (Sheet Sync after commit); field write vs Job attach vs disputed conflict; command-door assert vs convert already ran; injected `findActiveLink` vs default Mongo; `SynchronizeLeadRaceError` / `DomainRevisionConflictError` vs a hard throw
- Split later (only if the file outgrows one sitting): keep one file — this ~840-line command is one screenplay. If it later splits: `writeWhatGranotMayChangeOntoThisMatchedLead.ts` / `attachThisJobToThisLead.ts` / `markThisJobLinkDisputed.ts` — story files, never `apply.ts` / `classify.ts` / `persist.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`synchronizeLeadFromGranot` / `applySynchronizeLeadOperation` are executor mechanics. The owner question is: *We already matched this Observation to a Form or Call Lead. We already turned Granot’s wish into the only patch we may write. Now, if we still hold this revision and this Observation is newer than the last one we accepted: write that patch onto the Lead, stamp who won the clock, remember the Decision, and after commit project the Lead onto sheets. If the Job is not attached to this Lead yet, attach it in the same write. If the Job already belongs to another Lead, mark that link disputed and do not touch this Lead. A Duplicate Form is not a target. A Bad Form may only get Priority. An empty receiver may be filled once from the catalog; a set receiver never flips. Exact current links stay off this command. This file does not mint a new Lead. This file does not plan fields. This file does not convert the plan.*

Planning, convert, Temporal compare, identity, gates, create-if-missing, and processor Decision-only persist already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one matched-Lead write story, not “a synchronize CRUD service,” and not the planner / the convert / the create command / the processor’s metadata clock:

1. **Write what Granot may change onto this matched Lead** — refuse unless live + Lead writes + every gate. Assert the patch again at the command door. Load the Lead we already matched. Refuse if it is gone, a Duplicate Form, the revision moved, or this Observation is older or the same as the stored winner. A Bad Form (`priority_only`) may keep only `granot_priority`. `quoted: false` is still forbidden. An incoming receiver is refused if the Lead already has one. `$set` the allowlisted fields. If current contact moved, stamp Granot contact provenance, bump `granot_contact_revision`, and hash before/after. If the move moved, stamp move provenance. Always stamp `last_accepted_granot_observation`. CAS on `{ _id, domain_revision }` and, when a winner already exists, the older-tuple filter. `EntityChange` later increments `domain_revision`. Enqueue `form_lead.update` / `call_lead.update` in the same session. After commit, `finalizeSheetSync`. This function does not invent Priority, quoted, Job, or contact. It does not CRM-post.

2. **Attach this Job to this Lead when the fields are already current, or while writing them** — if the Observation carries a Job and no active link exists, establish one (`lead_ref` + Source Scope). If a lead-less active link exists and Job / scope agree, attach this Lead. If the link already names this Lead, only a field write may confirm last-seen evidence — confirm-only with no field change is an eligibility race. Association-only (`already_current` + no lead-attached link) advances the clock without a Lead Change and without Sheet Sync. Outcome is `linked` / `record_link_established`. Historical shadow job-level links stay in the processor. This function does not open a Booking case.

3. **Mark this Job’s link disputed when it already belongs elsewhere** — active link names another Lead, a different Job Number, or a disagreeing Source Scope. If the row is not already disputed, CAS-mark `disputed` + `dispute_reason`. Persist a `conflict` Decision with no `lead_updated`, no attach, no Sheet Sync. A lost link CAS is a `link_duplicate` race. This function does not `$set` the matched Lead.

There is no fourth mutate operation. `buildLeadUpdate` / `classifyLinkAction` / `loadLeadSnapshot` are beats, not public stories. Establish and attach are two **adapters** of one “this Job belongs on this Lead” rule. Field write and association-only are two **adapters** of one “this Observation won the clock” rule. The executor `operation` / `finalize` pair is the before-commit / after-commit **seam**, not a second public export.

## Organization

Keep one file as the screenplay for “write what Granot may change onto this matched Lead, attach the Job if it is free, or mark the link disputed.” Planning, convert, Temporal compare, identity, gates, mint-a-Lead, and processor Decision-only persist already live in deeper **modules**. Do not pull those in. Do not invent a `SynchronizeLeadService` class. Do not invent a second `begin` / `complete` export — `executeCanonicalCommandWithPostCommit` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `processor.ts` so “knowledge lists both as primary code.” Do not move `toAuthorizedLeadDesiredState` here so “convert and `$set` live together.” Do not move `advanceTemporalWinnerOnly` into `processor.ts` so “every clock stamp lives together” — the processor’s metadata CAS is the exact-link path; this file’s clock stamp is the association-only path. Do not merge this file into `createLeadFromGranot.ts` so “one Granot Lead command.” Do not merge this file into `formLead.service.ts` so “every Form patch is one update.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `synchronizeLeadFromGranot` | `writeWhatGranotMayChangeOntoThisMatchedLead` | processor’s only matched-Lead write |
| `SynchronizeLeadFromGranotInput` | `AMatchedLeadWriteWeMayCommit` | Lead + expected revision + authorized patch + execution bag |
| `SynchronizeLeadRaceError` | `ThisMatchedLeadWriteLostARace` | processor reloads and replans (max 3) |
| `AuthorizedPathError` | `ThisPatchIsNotAllowedOnThisLead` | Bad Form extra paths; `quoted: false` reprint |
| `receiverAgentCatalogStamps` | `nameTheReceiverFromTheCatalogWhenWeFillIt` | SalesRep snapshot; keep as alias, stop treating it as a public story |

Keep the old names as one-line aliases until `processor.ts` and `canonicalDomainCommands` migrate. Do not make callers learn `applySynchronizeLeadOperation` / `leadSet.reportable` / `LinkAction` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the pending Sheet job handed across commit:

```ts
type MatchedLeadWriteInProgress = {
  resource: "source_lead"
  operation: "form_lead.update" | "call_lead.update"
  leadModel: "FormLead" | "CallLead"
  leadId: string
}
```

That is the handoff from “the Lead is saved” to “project it onto sheets.” Do **not** add `ingestion_origin`, `post_to_granot`, or official Booking fields so “the write is complete,” and do **not** add the planner’s leftover `last_granot_contact_change.changed_paths` so “the command can plan.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// synchronizeLeadFromGranot.ts
// We already matched this Observation to a Form or Call Lead.
// We already turned Granot’s wish into the only patch we may write.
// Write that patch if we still hold this revision and this Observation is newer.
// Attach the Job if it is not attached yet.
// If the Job already belongs to someone else, mark that link disputed and stop.
// After commit, project the Lead onto sheets.
// This file does not mint a new Lead.
// This file does not plan fields.
// Exact current links stay off this command.

// ── 1. Write what Granot may change onto this matched Lead ─

export async function writeWhatGranotMayChangeOntoThisMatchedLead(input)
  refuseUnlessLiveWritesAndEveryGate()
  refuseALeadPatchThatWouldWriteForbiddenOrLyingFields()  // command-door assert
  // then executeCanonicalCommandWithPostCommit:
  //   beginTheMatchedLeadWrite(session)
  //   completeTheMatchedLeadWriteByProjectingSheets(pending)

async function beginTheMatchedLeadWrite(input, session, now)
  loadTheMatchedLead()
  refuseIfTheLeadIsGoneOrADuplicate()
  refuseIfWeNoLongerHoldThisRevision()
  refuseIfThisObservationIsNotNewer()
  refuseIfABadFormWouldWriteMoreThanPriority()
  refuseQuotedFalse()
  refuseFlippingAReceiverThatIsAlreadySet()
  // Job beats below, then:
  writeTheAllowlistedFieldsAndWhoWonTheClock()
  rememberEntityChanges()
  rememberTheDecision()
  rememberSheetSyncIntentIfFieldsChanged()

function writeTheAllowlistedFieldsAndWhoWonTheClock(patch, lead, now)
  copyOnlyTheAuthorizedPaths()
  ifSnapshot, sayWhetherItDiffersFromWhatWeIngested()
  ifContactMoved, stampGranotContactProvenanceAndHashBeforeAfter()
  ifMoveMoved, stampGranotMoveProvenance()
  stampWhoWonTheClock()
  ifFillingReceiver, nameTheReceiverFromTheCatalog()
  compareAndSwapOnRevisionAndOlderWinner()

// ── 2. Attach this Job to this Lead ─

async function attachThisJobToThisLead(job, lead)
  ifNoActiveLink, establishANewRecordLink()
  ifLeadlessActiveLinkAndScopeAgrees, attachThisLead()
  ifAlreadyThisLead, confirmLastSeenOnlyWhileWritingFields()
  ifFieldsDidNotChange, advanceTheClockWithoutALeadChange()  // no Sheet Sync

// ── 3. Mark this Job’s link disputed when it already belongs elsewhere ─

async function markThisJobLinkDisputed(reason, existingLink)
  ifNotAlreadyDisputed, markDisputed()
  rememberAConflictDecisionWithNoLeadWrite()
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, already asked whether this statement is newer, already asked what that Lead should look like, and already turned that wish into the only patch we may write. This command is live, Lead writes are on, and every gate allowed. Load the Lead. If it is a Duplicate, or someone else already wrote a newer revision, or we already accepted this Observation or a newer one, stop and let the processor replan. Write Priority, quoted true, Job, receiver, current contact, move, and the Granot snapshot. WordPress submitted name stays; the snapshot remembers that Granot’s card differs. Hash the six contact leaves only when current contact actually moved. Stamp who won the clock. If this Job has no active link, create one that names this Lead. If a lead-less reservation agrees, attach it. If the Job already names another Lead, dispute that row and do not `$set` this Lead. Remember the Decision and the Changes in the same transaction. After commit, project the Lead onto sheets. Nobody CRM-posts. Nobody mints a second Lead. An exact current link never enters this file.*

That is the operation. `synchronizeLeadFromGranot` is not a CRUD update. `applySynchronizeLeadOperation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Command-door assert is required; convert already ran.** `processor.ts` converts, asserts, then invokes. This file asserts again before the executor. That is two **adapters**, not a duplicate to delete. Do not drop the door assert so “convert already checked,” and do not skip convert so “the command can take a raw plan.”

2. **Exact current links stay off this command.** Processor `already_current` plus an exact lead-attached link uses Decision-only persist or metadata-only CAS. Confirm in this file is a beat of a field write (`applied` + this Lead already on the link). Confirm-only with no reportable field change throws `SynchronizeLeadRaceError("eligibility")`. Do not start invoking this command on an exact link so “one write path wins,” and do not teach confirm-only to succeed so “every link visit writes evidence.”

3. **Association-only advances the clock without a Change or Sheet Sync.** `advanceTemporalWinnerOnly` `$set`s `last_accepted_granot_observation` only. No `domain_revision` bump, no `EntityChange` on the Lead, no outbox. Outcome is `linked`. Do not increment revision so “every clock stamp is a Change,” and do not enqueue Sheet Sync so “every command finalizes.”

4. **The processor’s metadata CAS is a different clock path.** Exact-link `already_current` never enters this file. Do not move `advanceTemporalWinnerOnly` into `processor.ts` so “every clock stamp lives together,” and do not call the processor’s `defaultAdvanceTemporalWinner` from here so “CAS is one function.”

5. **`applyLeadMutation` reports a temporal loss as a revision conflict.** The filter is `{ _id, domain_revision }` plus `olderTemporalWinnerFilter` when a winner already exists. Zero rows throw `DomainRevisionConflictError`. The processor treats that as a race either way. Do not drop the temporal clause so “the name is honest,” and do not throw `SynchronizeLeadRaceError("temporal")` here as a silent “fix” without a test that names the lost filter.

6. **`domain_revision` increments in `EntityChange`, not in this `$set`.** `applyLeadMutation` CAS-writes fields at the expected revision. `persistEntityChangeMutations` → `stampAggregateRevision` then bumps it. Do not `$inc` revision inside `applyLeadMutation` so “CAS is local,” and do not skip the Change so “the `$set` already wrote.”

7. **Duplicate Form is an eligibility race at the door.** Identity already refuses Duplicate as a target. This file still throws if the loaded row is `duplicate: true`. Do not delete that refuse so “identity already checked,” and do not `$set` Priority on a Duplicate so “Bad and Duplicate match.”

8. **Bad Form may only keep Priority.** `revalidateDesiredAgainstLead` throws `AuthorizedPathError` on any other `changed_paths` when `target_eligibility === "priority_only"`. Replica locks quoted / name / ZIP stay put. Do not let convert emit contact on a Bad Form so “the command can drop it,” and do not skip this reprint so “convert already allowlisted.”

9. **Receiver fill is one-shot and catalog-derived.** Planner + convert may name `receiver_agent`. This file refuses if the Lead already has one, refuses if identity’s Agent id disagrees, refuses an inactive / nameless catalog row, then stamps `receiver_agent_name_snapshot` / `receiver_agent_set_at` off the loaded name. Sheet SalesRep reads that snapshot. Do not add those stamps to the authorized patch so “the convert is complete,” and do not overwrite a set receiver so “Granot won.”

10. **`quoted: false` is refused twice.** Convert/assert already throw. `revalidateDesiredAgainstLead` throws again. Do not drop the reprint so “assert already checked.”

11. **`execution.loadLead` is never called.** `SynchronizeLeadExecution` advertises `loadLead`; this file always uses `loadLeadSnapshot`. `findActiveLink` is the live injection. Do not wire `loadLead` so “the type is honest” without a test, and do not delete the type field in this pass — `synchronizeLeadTypes.ts` is a skipped sibling.

12. **Link field diffs are handmade; `RECORD_LINK_CHANGE_PATHS` is imported and voided.** Establish/attach/dispute build `fields` by hand. Do not switch those rows to `collectDocumentFieldChanges` so “every aggregate uses the path list” without proving `lead_ref` / `disputed` stay `stored` vs `reference_only`. Do not delete the unused import as the whole pass.

13. **`void sheetJob` after the executor is leftover.** The job already rides `pending` into `finalize`. Do not start finalizing from the outer `sheetJob` so “both names write sheets.”

14. **`sourceScopeAgrees` is asymmetric.** Existing empty + Job has scope → agree. Existing has scope + Job empty → conflict. Do not “fix” that to require both sides so “scope is always present,” and do not let a scoped link attach a Job with no scope.

15. **WordPress snapshot `differs_from_ingested` / `observation_id` are stamped here, not in convert.** Convert keeps `granot_contact_snapshot` as semantic contact. This file adds the compare and the winning Observation. Do not move that compare into convert so “the patch is already the write,” and do not overwrite submitted `name` because the snapshot differs.

16. **Sheet Sync only when reportable fields changed.** Conflict and association-only return no `sheetJob`. Do not enqueue on `linked` so “every Decision projects,” and do not skip enqueue on `applied` so “WordPress never syncs Granot Priority.”

17. **Leave sibling modules alone.** Field wants stay in `leadDesiredState.ts`. Allowlisted convert / hashes stay in `authorizedDesiredState.ts`. Clock order / filter stay in `granotTemporal.ts`. Form/Call insert stays in `createLeadFromGranot.ts`. Decision-only persist and metadata CAS stay in `processor.ts`. Claim/lease stays in `drainer.ts`. Executor / `EntityChange` stay in `domainCommands/`. ObjectId construction stays in `utils/objectId.ts`.

18. **Do not treat create-if-missing, public Form correction, Booking confirm, or drain as this story.** Those mint a Lead, CRM-post a website quote, write an official Booking, or claim a receipt. This file only writes a matched Lead, attaches a free Job, or disputes a taken one.

19. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `writeWhatGranotMayChangeOntoThisMatchedLead` (today `synchronizeLeadFromGranot`). `SynchronizeLeadRaceError` and `AuthorizedPathError` are part of that **interface**. `receiverAgentCatalogStamps` is not.

Today’s `synchronizeLeadFromGranot.test.ts` only locks the door: refuse `live_shadow`, refuse writes-off, refuse a failed gate, refuse a non-processor actor, plus the catalog-stamp helper. That is not enough for a write this long. `synchronizeLead.replica.test.ts` is the real proof and goes through the processor. Keep those replica cases. Add command-level tests that name the operation (replica may stay the Mongo proof):

**Write what Granot may change onto this matched Lead**
- Live + writes + eight allowed gates is required before the executor (already locked).
- WordPress submitted name/phone stay; Granot card lands on `granot_contact_snapshot` with `differs_from_ingested: true`; origin stays `wordpress_form` (replica AC-10 / AC-11).
- RingCentral / `granot_lead_created` qualified contact becomes current and hashes without raw phone (replica AC-12).
- Sheet Sync intent is remembered before commit; `finalize` runs after (replica outbox + command row).
- Replay of the same Observation does not bump `domain_revision` or add a second command (replica).
- Duplicate Form throws eligibility and writes no command (door + replica unmatched).
- Bad Form keeps Priority only (replica AC-05).
- Empty receiver fills once from the catalog; `quoted` stays false on Priority `8` (replica AC-13).
- Revision / temporal races: one winner; loser is not stored `applied` (replica AC-32).

**Attach this Job to this Lead**
- No active link → establish + `record_link_established` (replica AC-07).
- Lead-less active link + agreeing scope → attach (replica AC-07).
- Already this Lead + field write → confirm last-seen Observation id (replica AC-07).
- Association-only (`already_current` + no lead-attached link): Decision `linked`, no Lead `EntityChange`, no Sheet Sync (add this at the command; today’s replica `already_current` is the exact-link processor path and never enters this file).
- Confirm-only + no reportable fields throws eligibility — do not add a test that it must succeed.

**Mark this Job’s link disputed**
- Active link names another Lead → `conflict` / `record_link_conflict`, `disputed: true`, no Lead `$set`, no Sheet Sync (add this at the command; today’s replica race is duplicate-key establish, not dispute).
- Already-disputed row does not rewrite `dispute_reason` (add this).
- Lost link CAS is `link_duplicate` (replica 11000 race stays the establish proof).

Do **not** add a test per helper (`copyOnlyTheAuthorizedPaths`, `sourceScopeAgrees`, `pick`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. The catalog-stamp unit is that leak — keep the replica Agent case; do not grow helper units.

Do **not** re-test planner WordPress fences, convert allowlists, eight gates, or processor Decision replay here. Do not add a test that this file inserts a Form Lead, CRM-posts, opens a Booking case, or `$set`s an exact current link. Do not add a test that metadata-only CAS lives in this file — that path is the processor’s.

## What I would not do

- A `SynchronizeLeadService` class with `create` / `update` / `sync`.
- Thirty two-line functions that only wrap `$set`.
- Moving this into a CRUD folder, or into `processor.ts` / `authorizedDesiredState.ts` / `createLeadFromGranot.ts` / `formLead.service.ts` “for cleanliness.”
- Splitting `apply.ts` / `classify.ts` / `persist.ts`.
- Deleting the command-door assert because convert already called it.
- Invoking this command on an exact current link so “one write path wins.”
- Incrementing `domain_revision` inside the Lead `$set`, or enqueueing Sheet Sync on `linked` / `conflict`.
- Overwriting a set receiver or a Duplicate Form.
- Teaching this file to mint a Lead or CRM-post.
- Silently changing `applyLeadMutation`’s zero-row error from revision-conflict to temporal-race without a named test.
- Writing a whole-folder recommendation for `granotLifecycle`.
