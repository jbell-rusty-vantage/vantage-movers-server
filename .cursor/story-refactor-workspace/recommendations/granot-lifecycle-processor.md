# Turn This Claimed Receipt Into One Synchronization Decision — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 13 of this service — `processor.ts`
- Remaining in this service: `operations.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/processor.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`. That Service file also lists `bookingReconciliation.ts`, `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `leadDesiredState.ts`, and `granotTemporal.ts` as primary code — they are siblings, not this pass. Distinct from receipt insert: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md). Distinct from queue wake-up: [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md). Distinct from Owner extension / HTTP apply (they claim, then this file runs): [recommendations/granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md), [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from Observation fold: [recommendations/granot-lifecycle-normalization.md](granot-lifecycle-normalization.md). Distinct from Registry policy / eight gates: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). Distinct from source-scoped identity: [recommendations/granot-lifecycle-identity.md](granot-lifecycle-identity.md). Distinct from Temporal compare / winner filter: [recommendations/granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Distinct from the in-memory plan: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md). Distinct from the allowlisted write patch: [recommendations/granot-lifecycle-authorized-desired-state.md](granot-lifecycle-authorized-desired-state.md). Distinct from masked contact cards: [recommendations/granot-lifecycle-lead-contact-projection.md](granot-lifecycle-lead-contact-projection.md). Distinct from fenced claim / pending clock: next-but-drain `drainer.ts`. Distinct from Owner activate / requeue: next module `operations.ts`. Distinct from matched-Lead `$set`: `synchronizeLeadFromGranot.ts`. Distinct from create-if-missing: `createLeadFromGranot.ts`. Distinct from Booking / Release case persistence: `bookingReconciliation.ts` / `releaseReconciliation.ts`. Distinct from discrepancy persistence: `discrepancies.ts`. Distinct from official Booking / Cancellation Owner commands: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / Synchronization Decision / Granot Record Link — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `drainer.ts` (`granotObservationProcessor` default; `deps.processor.process({ receipt_id, initiator })` after a fenced claim). Shadow operator: `scripts/migrations/granot-lifecycle-shadow-process.ts` + replica. Tests: `processor.test.ts` (AC-02 / AC-05 / AC-07 / AC-08 / AC-09 / AC-18 / AC-19 / AC-25 / AC-26 / AC-27 / AC-30 / AC-31 / AC-32 / AC-35 / AC-36), `processor.replica.test.ts` (AC-32 CAS), `crossChannel.test.ts`, `synchronizeLead.replica.test.ts`, `createLeadFromGranot.replica.test.ts`. Not callers: `capture.ts` (never invokes), webhook routes, `extensionApply.ts` / `automationApply.ts` (they call `claimAndProcessOrPoll`, not this file), `operations.ts`, `leadDesiredState.ts`, `authorizedDesiredState.ts`, `identity.ts`, `sourcePolicy.ts`, `normalization.ts`.
- Seams callers need: drain `{ process }` object vs direct `processGranotObservation`; stored Decision replay vs a new attempt; in-memory plan vs sibling command vs Decision-only persist; metadata-only temporal CAS vs `synchronizeLeadFromGranot`; injected deps for tests
- Split later (only if the file outgrows one sitting): this ~2,245-line file cannot be read in one sitting. Later story files, never CRUD: `decideWhatThisObservationMeans.ts` / `openOrRefreshAReleaseCaseWhenGranotReleasedTheJob.ts` / `openOrRefreshABookingCaseWhenGranotBookedTheJob.ts` / `createALeadWhenGranotMayInventOne.ts` / `writeTheMatchedLeadOrAttachTheJob.ts` / `rememberTheDecisionAndMaybeTheJobLink.ts` — never `prepare.ts` / `persist.ts` / `create.ts` / `update.ts` / `delete.ts`

`processGranotObservation` / `createGranotObservationProcessor` / `maybeCreateLead` / `maybeSynchronizeMatchedLead` are executor mechanics. The owner question is: *The drain already claimed this receipt. Turn it into one Observation and one Synchronization Decision. If we already decided this attempt, replay that Decision. If Granot released a Job, open or refresh a Release case. If Granot booked a Job, open or refresh a Booking case. Priority 5 is not a booking. If no Lead exists and we may invent one, create it. If a Lead matches and we may write, write the authorized patch or attach the Job. Otherwise persist the Decision, and in historical shadow maybe a job-level Record Link. A newer statement that already matches the fields may advance the clock without a Change. Never write an official Booking or Cancellation. This file does not claim the receipt. This file does not plan fields. This file does not `$set` a Lead itself.*

Policy, identity, Temporal compare, desired-state planning, authorized convert, Lead create/sync, Booking/Release cases, discrepancies, and drain already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one orchestrator story, not “a processor CRUD service,” and not the planner / the Lead command / the case module / the drain:

1. **Decide what this Observation means, or replay the Decision we already wrote** — refuse unless processing is enabled. Load the receipt. Upsert or reuse the Observation. Classify historical-shadow / live-shadow / live from captured-at vs activation plus shadow flag. If this Observation+attempt already has a Decision whose causal meaning matches, return it. After a committed live create / apply / link, a replan of `already_current` or `stale` still replays the stored Decision. A stored `applied` against a current historical-link classification is `DecisionIntegrityError`. Otherwise: terminal invalid/unsupported; Registry policy; source-scoped identity; Temporal compare; desired-state plan; eight gates; decide the prepared outcome. This function does not write a Lead.

2. **When Granot released a Job, open or refresh a Release case** — only actual `booking_action.normalized === "release"` with a Job, not invalid/unsupported, live gates including `release_cases_enabled`. Preallocate the Decision id. Hand the sibling `createGranotReleaseReconciliation`. Opened / refreshed / already-current become the Decision. Typed `release_discrepancy_required` persists through `createGranotDiscrepancies`. This function does not cancel a Booking.

3. **When Granot booked a Job, open or refresh a Booking case** — only actual `normalized === "booked"`. Priority `5` is not booking evidence and continues through the Lead path. Same live-gate shape with `booking_cases_enabled` (Referral also needs `referral_booking_enabled`). Opened / refreshed become the Decision and **return before** Lead create/sync on this Observation. Typed `booking_discrepancy_required` persists the same way. `none` except `employee_reconciliation_missing` falls through. This function does not write an official Booking.

4. **When no Lead exists and Granot may invent one, create that Lead** — live + `lead_creation_enabled` + every gate allowed + plan `creation_eligibility === "eligible"` + a Job + a receipt initiator. Command input is Observation id, selected model, Source Scope, and context — never a Lead patch. Race losers reload policy and the full identity ladder (max 3). Route-assignment race persists `insufficient_creation_data` / `missing_creation_route_data`. A still-eligible create after `link_duplicate` persists `conflict` / `record_link_conflict`. Never retry blind creation. This function does not insert the Form/Call row itself.

5. **When a Lead matches and Granot may write, write the authorized patch or attach the Job** — live + `lead_writes_enabled` + every gate + a Form/Call target + a plan. Convert the plan to the only allowed patch, assert again, then invoke `synchronizeLeadFromGranot` when the plan is `applied`, or when `already_current` still needs a lead-attached Record Link. Exact current links stay off this command. Revision / duplicate-key races reload and replan (max 3). A replan that is still `applied` / `linked` must go through the command again — never persist those outcomes from a race bag. This function does not `$set` the Lead itself.

6. **Otherwise remember the Decision, and maybe a job-level Record Link or a metadata-only clock stamp** — one transaction. Historical shadow may establish or confirm a lead-less job-level link when Job and Source Scope agree; a scope fight is `record_link_conflict`; a duplicate-key race confirms or conflicts the winner. Live `already_current` that should advance the winner tries a metadata-only compare-and-swap (`last_accepted_granot_observation` only — no `domain_revision`, no Change, no Sheet Sync). Zero matched rows abort, reload, and the loser is normally `stale`. Then stamp `processing.latest_decision_id` on the receipt. This function does not claim or drain.

There is no seventh mutate operation. Official Booking / Cancellation Owner commands, Admin DTOs, and fenced claim live in later **modules**. `createGranotObservationProcessor` is the drain **adapter** of the same story (`{ process }` → `processGranotObservation`), not a second public operation. `prepareDecision` is the shared decide fold, not a public story.

## Organization

Keep one file as the screenplay for “turn this claimed receipt into one Synchronization Decision, and only then fire the effect that Decision already authorized.” Policy, identity, Temporal compare, planning, convert, Lead commands, Booking/Release cases, discrepancies, and drain already live in deeper **modules**. Do not pull those in. Do not invent a `GranotObservationProcessorService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the sibling commands own that **seam**. The drain **seam** is `{ process }`, not a Domain Command. Do not invent a channel **seam** that has only one **adapter** here — webhook, extension, and HTTP automation already collapsed to `receipt_id`.

This file cannot be read in one sitting. If it later splits, split by the six stories above. Do not split into `prepare.ts` / `persist.ts` / `create.ts` / `update.ts`. Do not move `planLeadDesiredState` here so “knowledge lists both as primary code.” Do not move `createLeadFromGranot` or `synchronizeLeadFromGranot` here so “invoke and write live together.” Do not move `claimAndProcessOrPoll` here so “process includes claim.” Do not merge `operations.ts` here so “activation and Decision live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `processGranotObservation` | `turnThisClaimedReceiptIntoOneSynchronizationDecision` | drain, shadow operator, and every processor test |
| `createGranotObservationProcessor` | `giveTheDrainAProcessor` | inject stores / sibling commands; `{ process }` |
| `granotObservationProcessor` | `theDefaultProcessor` | drainer default; runtime Mongo **adapters** |
| `GranotLifecycleProcessorDeps` | `ProcessorSeamsForTests` | load / persist / identity / plan-load / sibling invoke |
| `GranotObservationProcessor` | `AProcessorTheDrainCanCall` | re-export; `{ process(input) }` |

Keep the old names as one-line aliases until `drainer.ts` and the shadow script migrate. Do not make callers learn `PreparedDecision` / `maybeReconcileBooking` / `InTransaction` as the domain language.

**No class for the workflow.** The `{ process }` factory is a one-method drain **adapter**, not a workflow class. The type that *does* earn a name is the planned bag before any sibling or persist:

```ts
type WhatWeDecidedThisObservationMeans = {
  /* today's prepareDecision return: PreparedDecision + plan + identity + job/link + policy */
}
```

That is the handoff from “we asked policy, identity, the clock, the planner, and the gates” to “fire one sibling, or persist.” Do **not** add `desired_state.set` so “the Decision is already the patch,” and do **not** add `official_booking_details` so “a booked Observation can confirm.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// processor.ts
// The drain already claimed this receipt.
// Turn it into one Observation and one Synchronization Decision.
// Replay the Decision we already wrote for this attempt.
// If Granot released a Job, open or refresh a Release case.
// If Granot booked a Job, open or refresh a Booking case.
// Priority 5 is not a booking.
// If no Lead exists and we may invent one, create it.
// If a Lead matches and we may write, write the authorized patch
// or attach the Job.
// Otherwise remember the Decision, and maybe a job-level Record Link.
// A newer statement that already matches the fields may advance the clock
// without a Change.
// This file does not claim the receipt.
// This file does not $set a Lead.
// This file does not write an official Booking or Cancellation.

// ── 1. Decide what this Observation means, or replay ──────

export async function turnThisClaimedReceiptIntoOneSynchronizationDecision(
  { receipt_id, initiator },
  deps?,
)
export function giveTheDrainAProcessor(deps?)   // { process } → the function above

async function loadTheReceiptAndKeepTheObservation(receipt_id)
function sayWhetherThisIsHistoricalShadowLiveShadowOrLive(captured_at, activated_at, shadow)
async function replayTheDecisionWeAlreadyWroteForThisAttempt(observation, attempt, prepared)
async function decideWhatThisObservationMeans(observation, attempt, mode, flags)
  // terminal invalid/unsupported
  // which Registry policy
  // which Form or Call Lead
  // whether this statement is newer
  // what the Lead should look like
  // whether the eight gates allow the requested effect
function thisAttemptAlreadyMeansTheSameThing(existing, prepared)
  // live created/applied/linked vs a replan of already_current/stale still matches

// ── 2. When Granot released a Job, open or refresh a Release case ──

async function openOrRefreshAReleaseCaseWhenGranotReleasedTheJob(...)
async function persistTheTypedReleaseOrBookingConflict(...)  // discrepancies.ts

// ── 3. When Granot booked a Job, open or refresh a Booking case ──

async function openOrRefreshABookingCaseWhenGranotBookedTheJob(...)
  // Priority 5 never enters. Return before Lead create/sync.

// ── 4. When no Lead exists and Granot may invent one, create it ──

async function createALeadWhenGranotMayInventOne(...)
  // createLeadFromGranot — no caller patch
  // race: reload policy + identity; never retry blind creation

// ── 5. When a Lead matches and Granot may write, write or attach ──

async function writeTheMatchedLeadOrAttachTheJob(...)
  // convert + assert + synchronizeLeadFromGranot
  // already_current exact link does not invoke

// ── 6. Remember the Decision, and maybe the Job link or the clock ──

async function rememberTheDecisionAndMaybeTheJobLink(...)
function thisHistoricalShadowMayRememberAJobLevelLink(plan)
function thisNewerNoopMayAdvanceTheClockWithoutAChange(plan, flags, mode)
async function tryToAdvanceTheClockIfNobodyNewerWon(...)
async function confirmOrConflictTheExistingJobLink(...)
```

Read the primary path out loud: *The drain already claimed this receipt. Load it. Keep or reuse the Observation. If processing is off, stop — no Decision. Say whether this statement is historical shadow, live shadow, or live. Ask which Registry row it is. Ask which Form or Call Lead it is. Ask whether this statement is newer. Ask what that Lead should look like if we believed Granot. Walk the eight gates. If we already decided this attempt and the meaning matches, hand that Decision back. If Granot released a Job and the Release gates pass, open or refresh the Release case — or persist the typed conflict — and stop. If Granot booked a Job and the Booking gates pass, open or refresh the Booking case and stop. Priority 5 is still a Lead statement, not a booking. If there is no Lead, the plan says we may invent one, and every creation gate is on, create that Lead with no caller patch. If a Lead matches and we may write, turn the plan into the only allowed patch and ask the command to `$set` or attach the Job. If the fields are already current and the clock should move, try a metadata-only compare-and-swap; a loser is stale. Otherwise persist one Decision. In historical shadow we may still remember a job-level Record Link when Job and scope agree. Then stop. Someone else claimed the receipt. Someone else `$set`s the Lead. Someone else confirms the official Booking.*

That is the operation. `processGranotObservation` is not. `maybeReconcileBooking` is not a public story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge lists booking then release; the file asks release then booking.** One Observation cannot be both `booked` and `release`. Do not reorder the two calls so the Role diagram “wins,” and do not run both so “a booked-then-released payload can open two cases.”

2. **Booking and Release remappers are a second gate path.** When `prepared.policy` exists, the file re-walks `snapshotEligibleGates` with `booking_reconciliation` / `release_reconciliation`. When it does not, `bookingGatesFromPrepared` / `releaseGatesFromPrepared` rewrite `global_effect_flag` from the Lead-path gates, force `policy_permits_effect` to `true`, and require exactly eight names. Do not delete the remappers so “one gate function wins” without a no-snapshot proof, and do not start passing `source_scope_eligible` so the unused gate “goes live” (already parked on [granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md)).

3. **Priority 5 is not a booking.** AC-18 locks `booking_action: {}` plus canonical `5` never calling `reconcileBooking`, even when `booking_cases_enabled` is true; the Lead path may still apply. Do not treat Priority `5` as `booked` so “the owner sees a case,” and do not skip Lead writes on Priority `5` so “booked-looking statements only open cases.”

4. **A booked Observation returns before Lead create/sync.** After an opened / refreshed Booking case, this receipt never reaches `maybeCreateLead` / `maybeSynchronizeMatchedLead`. Do not then-sync so “the Lead still updates on the same Booked statement,” and do not open a case after a Lead write so “the diagram can list both.”

5. **`normalized === "release"` after requiring `=== "booked"` is dead.** `maybeReconcileBooking` already returned unless the action is `booked`. Do not keep the extra compare so “release is excluded twice,” and do not drop the `booked` check so the dead line “becomes the fence.”

6. **Replay meaning is causal, not field-equal.** A prepared `link` matches any stored established / confirmed / conflict. A live stored `created` / `applied` / `linked` matches a replan of `already_current` or `stale`. A stored `applied` against current historical-link classification still throws `DecisionIntegrityError`. Do not require every Decision field to match so “integrity is strict,” and do not replay a drifted outcome so “the second call is faster.”

7. **Never persist `applied` or `linked` from a race bag.** `persistRaceReplan` throws if the replan is still `applied` / `linked`. The command must run again. Do not persist those outcomes so “the Decision exists,” and do not drop the throw so “three retries are enough.”

8. **Create races reload; they do not retry blind creation.** Identity / policy / `link_duplicate` abort, re-resolve, and replan. A now-eligible matched Lead flows through sync. A still-eligible create after a lead-less reservation becomes `record_link_conflict`. Route-assignment becomes `missing_creation_route_data`. Unrelated duplicate-key stays a technical error. Do not call `createLeadFromGranot` again with the same input so “three attempts mean three inserts.”

9. **Exact current links stay off `synchronizeLeadFromGranot`.** `already_current` plus an exact lead-attached link uses Decision-only persist or metadata CAS. `already_current` with no active link still invokes association. Do not invoke the command on an exact link so “one write path wins,” and do not skip the command when the Job is unattached so “already_current never writes.”

10. **Metadata CAS is not a Lead write.** `defaultAdvanceTemporalWinner` `$set`s only `last_accepted_granot_observation` behind `olderTemporalWinnerFilter`. No `domain_revision`, no `last_change_*`, no Change, no Sheet Sync. Checked-in shadow never takes this path. The missing-stamp `$exists` fight is already parked on [granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Do not add `$exists: false` so “first winner can CAS,” and do not increment revision so “the clock is a Change.”

11. **`defaultLoadLeadProjection` is two nearly identical Form/Call copies.** About 200 lines live in this orchestrator so the planner can see current fields. Do not move them into `leadDesiredState.ts` so “the planner owns the type,” and do not teach this file to `$set` from that bag so “load and write live together.”

12. **Two receipts of identical evidence are two Decisions.** AC-02 locks portion-identical webhook bodies as two attempts. Same Observation+attempt replays one Decision. Do not collapse two receipts so “the hash is idempotency,” and do not insert a second Decision for the same attempt so “every call is a new row.”

13. **Processing disabled throws and writes nothing.** `ProcessingDisabledError` unless a test supplies flags. Capture and due work stay intact (drain’s job). Do not persist a `policy_blocked` Decision so “every receipt has an outcome.”

14. **Historical shadow may still remember a job-level link.** `decidePreparedOutcome` can return `linked` / `record_link_established` with a `link` proposal when the plan is not a hard refuse. The persist path then establishes or confirms without `lead_ref`. Live shadow persists Decisions only. Do not attach `lead_ref` in historical shadow so “the Job has a Lead,” and do not skip historical links so “shadow never writes.”

15. **`employee_reconciliation_missing` still writes a Booking-path Decision.** Other `none` results fall through to Lead create/sync. Do not treat every `none` as fall-through so “the missing-employee case can still create a Lead.”

16. **Leave sibling modules alone.** Policy stays in `sourcePolicy.ts`. Identity stays in `identity.ts`. Clock order stays in `granotTemporal.ts`. Field wants stay in `leadDesiredState.ts`. Allowlisted convert stays in `authorizedDesiredState.ts`. Lead `$set` stays in `synchronizeLeadFromGranot.ts`. Form/Call insert stays in `createLeadFromGranot.ts`. Case open/refresh stays in `bookingReconciliation.ts` / `releaseReconciliation.ts`. Discrepancy persist stays in `discrepancies.ts`. Claim/lease stays in `drainer.ts`. Activate / requeue stays in `operations.ts`. ObjectId construction stays in `utils/objectId.ts`.

17. **Do not treat capture, drain, Lead `$set`, create-if-missing, or Owner confirm as this story.** Those keep the delivery, claim the receipt, write the Lead, insert the Lead, or write the official Booking. This file only decides and invokes.

18. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `turnThisClaimedReceiptIntoOneSynchronizationDecision` (today `processGranotObservation`) and `giveTheDrainAProcessor` (today `createGranotObservationProcessor` / `granotObservationProcessor`). `WhatWeDecidedThisObservationMeans` is not exported; prove it through the Decision the function returns.

Today’s `processor.test.ts` and `processor.replica.test.ts` already lock Priority 5 ≠ booking, live-only Booking/Release invoke, typed discrepancy persist, two receipts → two Decisions, same attempt replay, integrity failure, historical/live-shadow, historical link establish/confirm/conflict, processing disabled, pending / unmatched, live sync once, applied replay, lost-race stale, exact-link no command, stale / inactive-company no command, already_current association, create-if-missing no-patch command, Job-only Call create, matched Lead Created never creates, identity race replan, lead-less reservation conflict, Form Local vs long-distance, metadata CAS winner/loser. Keep those. Add the gaps that name the operation:

**Decide what this Observation means, or replay**
- Processing disabled throws and inserts no Decision (already locked).
- Same Observation+attempt replays; a drifted stored Decision throws (already locked).
- Live stored `applied` plus a replan of `already_current` replays without a second command (already locked).
- This function does not claim the receipt — do not add a test that it writes `processing.state`.

**When Granot released / booked a Job**
- Actual `release` / `booked` in live gate-enabled posture invokes the sibling once (already locked).
- Priority 5 never invokes Booking reconciliation and may still apply a Lead (already locked).
- A booked opened Decision is returned; `createLead` / `synchronizeLead` are not called on that receipt (add this; today’s Booking tests do not assert the Lead commands stayed quiet).
- Typed conflict goes through `reconcileDiscrepancy`, not a handmade `conflict` persist (already locked).

**When Granot may invent a Lead / write a matched Lead**
- Live eligible no-match invokes `createLeadFromGranot` once with no patch (already locked).
- Matched Lead Created never invokes create (already locked).
- Live authorized matched write invokes `synchronizeLeadFromGranot` once (already locked).
- Exact current link does not invoke the command (already locked).
- Race replan never persists `applied` without the command (already locked via lost-race stale).

**Remember the Decision / Job link / clock**
- Historical establish then confirm keeps one active link; a scope fight conflicts (already locked).
- Metadata CAS advances `last_accepted` without revision / Change / outbox (already locked in replica).
- CAS loser is `stale`, never persisted `already_current` (already locked).
- Two portion-identical receipts are two Decisions (already locked).

Do **not** add a test per helper (`decideWhatThisObservationMeans`, `thisHistoricalShadowMayRememberAJobLevelLink`, `bookingGatesFromPrepared`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test planner WordPress fences, identity ladders, eight-gate order, convert allowlists, or drain leases here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, confirms an official Booking, or `$set`s `granot_priority` itself. Do not add a test that webhook capture invokes this function.

## What I would not do

- A `GranotObservationProcessorService` class with `create` / `update` / `process`.
- Thirty two-line functions that only wrap `createGranotBookingReconciliation().reconcileObservation`.
- Moving this into a CRUD folder, or into `drainer.ts` / `createLeadFromGranot.ts` / `bookingReconciliation.ts` “for cleanliness.”
- Reordering Release before Booking (or the reverse) so the knowledge diagram “wins.”
- Treating Priority 5 as booking evidence.
- Then-syncing a Lead on the same Booked Observation that just opened a case.
- Persisting `applied` from a race bag without `synchronizeLeadFromGranot`.
- Retrying `createLeadFromGranot` with the same input after an identity race.
- Adding `$exists: false` to the metadata CAS filter.
- Moving `planLeadDesiredState` or `claimAndProcessOrPoll` into this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
