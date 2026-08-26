# Say What This Observation Wants The Lead To Become — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 10 of this service — `leadDesiredState.ts`
- Remaining in this service: `authorizedDesiredState.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/leadDesiredState.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md` (planner + no-match / minimum data). That Service file also lists `granotTemporal.ts`, `authorizedDesiredState.ts`, and `leadContactProjection.ts` as primary code — they are siblings, not this pass. Distinct from Temporal compare / winner filter: `recommendations/granot-lifecycle-granot-temporal.md`. Distinct from source-scoped identity: `recommendations/granot-lifecycle-identity.md`. Distinct from Registry policy / eight gates: `recommendations/granot-lifecycle-source-policy.md`. Distinct from the allowlisted write patch: next module `authorizedDesiredState.ts`. Distinct from role-safe contact display: `leadContactProjection.ts`. Distinct from processor Decision / live writes / create command: `processor.ts`, `synchronizeLeadFromGranot.ts`, `createLeadFromGranot.ts`. Distinct from Job prefix-twin compare: `recommendations/bookings-booking-identity.md` (this file calls `jobNumbersEquivalent` / `normalizeJobNo`). Distinct from WordPress Form Lead ingestion contact: `recommendations/form-lead.md`. This checkout’s `CONTEXT.md` does not define Granot Observation / desired state / Synchronization Decision / Ingestion Origin — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` (always compares, then `planLeadDesiredState`; maps `creation_eligibility === "eligible"` to `lead_created` and `applied` / nonempty `changed_paths` to `lead_enrichment`; metadata CAS only when `already_current` **and** `temporal_winner_should_advance`). `createLeadFromGranot.ts` (`evaluateMinimumCreationData` inside the command session; ineligible throws `route`). Type-only: `authorizedDesiredState.ts` (`LeadDesiredStatePlan`), `synchronizeLeadFromGranot.ts` / `synchronizeLeadTypes.ts` (`LeadDesiredStateProjection`). Tests: `leadDesiredState.test.ts` (AC-05 / AC-06 / AC-07 / AC-08 / AC-09 / AC-10 / AC-11 / AC-12 / AC-13 / AC-30 / AC-32). Processor / create / authorizer tests consume the plan without re-implementing field rules. Not callers: `capture.ts`, `identity.ts`, `sourcePolicy.ts`, `granotTemporal.ts` (this file calls it), `leadContactProjection.ts`, `normalization.ts`.
- Seams callers need: in-memory plan vs authorized patch; passed `temporal_order` vs fallback compare; create-if-missing eligibility vs the create command; same-statement `already_current` vs newer-noop `already_current` (the advance flag)
- Split later (only if the file outgrows one sitting): `sayWhatThisObservationWantsTheLeadToBecome.ts` / `sayWhetherGranotGaveEnoughToCreateALead.ts` — story files, never `plan.ts` / `create.ts` / `update.ts` / `delete.ts`

`planLeadDesiredState` / `evaluateMinimumCreationData` are executor mechanics. The owner question is: *Granot sent another statement. We already know which Form or Call Lead it is — or that there is none. We already know if this statement is newer. What should that Lead look like if we believed Granot, without writing anything? If there is no Lead, may we create one, wait for a match, or stop? If there is a Lead, which fields may Granot fill, and which WordPress facts stay ours? A newer statement that already matches the current fields still wins the clock. The same statement twice does not. This file does not write a Lead. This file does not authorize the patch. This file does not open a Booking case.*

Temporal compare, identity, Registry policy, authorized conversion, matched-Lead writes, and create-if-missing already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one story, not “a desired-state CRUD service,” and not Temporal compare / identity / authorize / write:

1. **Say what this Observation wants the Lead to become** — take a persisted Observation, an already-resolved identity result, an optional current Lead projection, a Registry policy snapshot, optional `temporal_order`, `now`, and attempt. If the caller omitted order, fall back to `compareGranotTemporal`. Older → `stale` / `older_than_temporal_winner`, do not advance the winner. Same statement → `already_current` / `desired_state_already_current`, **do not** advance the winner. A malformed Priority Update (`route_event_class === "priority_updated"` plus invalid normalization or `invalid_priority`) → `invalid` / `invalid_priority_update` and plan nothing. Duplicate Form Lead and other terminal identity outcomes (`ambiguous`, `conflict`, `deferred`, `policy_blocked`, `invalid`, `unsupported`) pass through with empty `desired_values`. No target → the no-match beats: `observation_only` is `policy_blocked` / `creation_policy_observation_only` and never pending; Lead Created with incomplete minimum data is `insufficient_creation_data` and never pending; Lead Created + `create_if_missing` + complete data is `created` / `lead_created_authorized` with `creation_eligibility: "eligible"` and empty `desired_values` (this is not a write); otherwise pending match with `next_match_attempt_at` from the Unit 08 clock, or `unmatched` / `match_window_expired` at 24h. `create_if_missing` on Priority Update / Booked is still pending — only Lead Created may authorize create. A target with no loaded Lead is pending again. Job numbers that both exist and are not prefix-equivalent → `conflict` / `job_number_conflict`. Otherwise plan only allowlisted field wants: valid Priority always (unless `invalid_priority` skips it); fill missing Job only; fill empty receiver from the identity Agent at any valid Priority; Priority `1` / `5` and `target_eligibility !== "priority_only"` may set `quoted: true` (never false) and plan contact / move. WordPress Form: current name/phone/email stay off `changed_paths`; only `granot_contact_snapshot`. Granot-created / RingCentral: current contact leaves plus `last_granot_contact_change.changed_paths`. Form ZIP is `destination_zip`; Call ZIP is `delivery_zip`. Vantage `move_size`, ingested snapshots, source, CPL, booked, cancelled stay forbidden. Equivalent Job / phone / email / state / date folds do not manufacture a change. No remaining paths → `already_current` with `temporal_winner_should_advance: true`. Any remaining path → `applied` / `lead_state_changed` with the same advance flag. This function does not write. It does not convert to `GranotAuthorizedLeadDesiredState`. It does not evaluate the eight effect gates.

2. **Say whether Granot gave enough to create a Form or Call Lead** — Job required. Deterministic route required (`selected_route_key` + `selected_lead_model` + `source_granularity_id`). CallLead: that is enough — do not invent telephony, duration, or RingCentral metadata. FormLead: a name component, normalized phone, origin and destination US states, two 5-digit ZIPs, and a `selectFormMoveType` result. Missing Job / contact / route are the three exact reasons. The planner uses this on Lead Created no-match. `createLeadFromGranot` uses it again as a race. This function does not create a Lead.

There is no third mutate operation. `emptyPlan` is the shared empty-patch bag, not a public story. Temporal fallback and Job/phone folds are **adapters** this file already consumes.

## Organization

Keep one file. This is the screenplay for “say what this Observation wants the Lead to become, and whether Granot gave enough to create one if none exists.” Temporal compare, identity, Registry policy, authorized conversion, and the write commands already live in deeper **modules**. Do not pull those in. Do not invent a `LeadDesiredStateService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a pure plan, not a Domain Command. Do not invent a write **seam** that has only one **adapter** here.

Do not split this ~630-line file into `plan.ts` / `create.ts` / `contact.ts` / `move.ts`. Those are beats of one owner question. Do not move `compareGranotTemporal` into this file so “knowledge lists both as primary code.” Do not move `toAuthorizedLeadDesiredState` here so “the plan is already the patch.” Do not move `projectRoleSafeLeadContacts` here so “contact lives together.” Do not merge this file into `processor.ts` so “plan and Decision live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planLeadDesiredState` | `sayWhatThisObservationWantsTheLeadToBecome` | processor’s only planner call |
| `evaluateMinimumCreationData` | `sayWhetherGranotGaveEnoughToCreateALead` | planner no-match + create-command race |
| `LeadDesiredStatePlan` | `WhatThisObservationWantsTheLeadToBecome` | in-memory handoff; never persisted |
| `LeadDesiredStateProjection` | `TheLeadFactsThePlannerMaySee` | processor / sync load this shape |
| `LeadDesiredStateInput` | `DesiredStateQuestion` | Observation + identity + Lead + policy + clock |
| `LeadCreationEligibility` | `WhetherWeMayCreateALead` | `not_applicable` / `eligible` / `insufficient` |
| `MinimumCreationDataResult` | `WhetherGranotGaveEnoughToCreate` | eligible vs the three missing reasons |
| `LeadContactSnapshot` | `GranotContactThePlannerCompared` | WordPress snapshot vs current leaves |

Keep the old names as one-line aliases until `processor.ts` and `createLeadFromGranot.ts` migrate. Do not make callers learn `changed_paths` / `FORBIDDEN_DESIRED_PATHS` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the plan both callers consume:

```ts
type WhatThisObservationWantsTheLeadToBecome = {
  outcome: SynchronizationOutcome
  reason_code: SynchronizationReasonCode
  target?: EntityRef
  desired_values: Record<string, unknown>
  changed_paths: string[]
  agent_changed_paths: string[]
  temporal_winner_should_advance: boolean
  creation_eligibility?: WhetherWeMayCreateALead
  creation_model?: "FormLead" | "CallLead"
  next_match_attempt_at?: Date
}
```

That is the handoff from “we know which Lead and whether this statement is newer” to “the processor may write, create, wait, or stop.” Do **not** add `set` / contact hashes / `temporal_winner` so “the plan is already authorized,” and do **not** add gate results so “the plan can fire.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadDesiredState.ts
// Granot sent another statement about this Lead.
// We already know which Form or Call Lead it is — or that there is none.
// We already know if this statement is newer.
// What should that Lead look like if we believed Granot?
// Do not write. Do not authorize. Do not open a Booking case.
// WordPress name and phone stay ours.
// A newer statement that already matches still wins the clock.
// The same statement twice does not.

// ── 1. Say what this Observation wants the Lead to become ──

export function sayWhatThisObservationWantsTheLeadToBecome(input)

function thisStatementIsOlderThanTheLastAcceptedOne(order)
function thisIsTheSameStatementWeAlreadyAccepted(order)
function thisPriorityUpdateIsMalformed(observation)
function identityAlreadyStoppedUs(identity)

function thereIsNoLeadToChange(input)
function thisSourceMayOnlyKeepEvidence(policy)          // observation_only
function granotAskedUsToCreateALead(observation, policy) // Lead Created + create_if_missing
function keepWaitingForASourceScopedMatch(input)
function theMatchWindowHasExpired(input)

function thereIsALeadToChange(input)
function theseJobNumbersDisagree(lead, observation)
function planThePriorityGranotNamed(desired, observation)
function fillTheJobOnlyIfTheLeadHasNone(desired, lead, observation)
function fillTheEmptyReceiverFromTheNamedAgent(desired, identity, lead, observation)
function thisPriorityMayEnrichContactAndMove(observation, identity)
function quotedMayBecomeTrueNeverFalse(desired, lead)
function wordpressKeepsItsSubmittedContact(desired, observation, lead)
function granotOrRingCentralMayUpdateCurrentContact(desired, observation, lead)
function planTheQualifiedMove(desired, observation, lead)
function dropForbiddenAndUnchangedPaths(lead, desired)
function aNewerStatementThatAlreadyMatchesStillWinsTheClock()

export type WhatThisObservationWantsTheLeadToBecome = { /* today's LeadDesiredStatePlan */ }
export type TheLeadFactsThePlannerMaySee = { /* today's LeadDesiredStateProjection */ }

// ── 2. Say whether Granot gave enough to create a Form or Call Lead ──

export function sayWhetherGranotGaveEnoughToCreateALead(observation, policy)
  // Job, deterministic route, then Form contact + states + ZIPs
  // Call: Job + route is enough
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, and already asked whether this statement is newer. Now ask: what should that Lead look like if we believed Granot? If the statement is older, stop — stale. If it is the same statement we already accepted, say already current and do not move the clock. If Granot sent a broken Priority Update, plan nothing. If identity already said duplicate, conflict, or deferred, believe that and plan nothing. If there is no Lead: an observation-only source keeps evidence; Lead Created without Job, contact, or route stops as insufficient and is never scheduled; Lead Created plus create-if-missing plus complete data says we may create — still without writing; otherwise wait on the match clock, or expire at 24 hours. A Priority Update never creates. If there is a Lead: disagreeing Jobs conflict; valid Priority may land; a missing Job may fill; an empty receiver may fill from the named Agent even at Priority 8; only Priority 1 and 5 may mark quoted true and enrich contact and move. WordPress keeps the submitted name and phone and only stores a Granot snapshot. A Granot-created or RingCentral Lead may take current contact. Vantage move size, ingested snapshots, source, and money stay forbidden. If nothing material changed, still advance the winner. Then stop. The processor converts, gates, and writes somewhere else.*

That is the operation. `planLeadDesiredState` is not. `toAuthorizedLeadDesiredState` is not this plan.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`created` is not a create.** Eligible create-if-missing returns `outcome: "created"` / `lead_created_authorized` with empty `desired_values`. The processor still needs live mode, `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED`, and the eight gates; `createLeadFromGranot` re-checks minimum data and may throw `route`. Do not insert a Form Lead here so “created means created,” and do not rename only the export while leaving the outcome as a past-tense write.

2. **Two `already_current` answers, opposite clocks.** Same Temporal tuple → `already_current` and `temporal_winner_should_advance: false` (replay). Newer statement, no field diff → `already_current` and `temporal_winner_should_advance: true` (processor metadata CAS). Do not set both flags the same so “already current is one rule,” and do not make Temporal `same` advance the winner.

3. **`lead_created_policy` only answers no-match create.** `observation_only` blocks the no-match path and never pending. A matched Lead under `observation_only` still plans Priority / contact / move. `link_only` with complete Lead Created data still pending-matches. Do not block matched enrichment so “observation_only means no effects,” and do not create on `link_only` so “eligible data should write.”

4. **Lead Created with incomplete data is insufficient even on `link_only`.** AC-30 locks that it is never scheduled as pending. A reader of `link_only` expects a match retry. Do not schedule those rows so “link_only always waits,” and do not skip the minimum-data check unless the policy is `create_if_missing`.

5. **Only Lead Created may authorize create.** Priority Update / Booked with `create_if_missing` and no target fall through to pending. Do not authorize create from every route so “missing Lead plus the policy is enough.”

6. **The planner writes `last_granot_contact_change.changed_paths`; the authorizer strips it.** Knowledge says the command derives provenance. Do not stop planning the summary so “forbidden means never emit,” and do not put hashes / `temporal_winner` on the plan so “conversion is a copy.”

7. **`evaluateMinimumCreationData` ignores `policy.selected_move_type`.** AC-09’s name says the Local vs long-distance route result controls Form eligibility; the function uses Observation states plus `selectFormMoveType`. Invalid `XX` fails that fold. Do not start reading `selected_move_type` so “the test title wins,” and do not require Call contact so “Form and Call match.”

8. **`priority_only` still plans `granot_priority`.** Bad Form is not “plan nothing.” Quoted, contact, and move stay off. Do not skip Priority so “priority_only means empty,” and do not enrich a Bad Form so “Priority 1 always quotes.”

9. **Job fill never overwrites.** Missing `normalized_job_no` may fill. Both present and not prefix-equivalent conflict. Equivalent formatting does not manufacture a change. Do not overwrite a letter-prefixed Lead Job with Granot digits so “the CRM spelling wins.”

10. **WordPress current contact is not a Granot field.** Qualified contact plans `granot_contact_snapshot` only. Do not copy Granot name onto `first_name` because “the CRM is fresher,” and do not put `ingested_contact_snapshot` on `changed_paths`.

11. **`quoted` may become true, never false.** Priority `0` / `8` do not unset it. A Lead already quoted stays quoted. Do not plan `quoted: false` so “Priority 0 means unquoted.”

12. **Processor compares, then this file may compare again.** Processor always passes `temporal_order`. Tests omit it and hit the fallback. Do not delete the fallback so “one compare site wins,” and do not ignore a passed order so “the Lead row is fresher.”

13. **Leave sibling modules alone.** Temporal order stays in `granotTemporal.ts`. Ladders stay in `identity.ts`. Gates stay in `sourcePolicy.ts`. Allowlisted `set` / hashes stay in `authorizedDesiredState.ts`. Display masking stays in `leadContactProjection.ts`. Lead `$set` and Form/Call insert stay in `synchronizeLeadFromGranot.ts` / `createLeadFromGranot.ts`. Retry offsets stay in `schedules.ts`. State / move-type fold stays in `sourceLabel.ts`.

14. **Do not treat authorized conversion, matched-Lead writes, create-if-missing, or contact display as this story.** Those turn a plan into a patch, write a Lead, insert a Lead, or mask a phone. This file only says what Granot wants and whether create has enough facts.

15. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayWhatThisObservationWantsTheLeadToBecome` (today `planLeadDesiredState`) and `sayWhetherGranotGaveEnoughToCreateALead` (today `evaluateMinimumCreationData`). `WhatThisObservationWantsTheLeadToBecome` is part of that **interface**.

Today’s `leadDesiredState.test.ts` already locks Priority `1`/`5` enrich and `quoted: true`, malformed Priority Update vs skip-and-continue, matched Lead Created never plans a second Lead, create-if-missing eligibility, WordPress contact/move snapshot fences, Call current-contact summary, Agent fill at Priority `8`, pending vs 24h expiry, no-op newer still advances, and older is stale. Keep those. Add the gaps that name the operation:

**Say what this Observation wants the Lead to become**
- Temporal `same` is `already_current` and **does not** advance the winner (today only older / newer-noop are named).
- `observation_only` no-match is `creation_policy_observation_only` and never pending (already locked).
- Matched `observation_only` still plans Priority (add this; do not “fix” by blocking).
- Priority Update + `create_if_missing` + no target is pending, not `lead_created_authorized`.
- `priority_only` plans `granot_priority` and not `quoted`.
- This function does not `$set` a Lead.

**Say whether Granot gave enough to create a Form or Call Lead**
- CallLead with Job + deterministic route is eligible without contact (knowledge; add if missing).
- Form missing ZIP / state / move type is `missing_creation_route_data` (AC-09 invalid state already locks the reason).
- `selected_move_type` on the policy does not override Observation states (do not “fix”).
- `createLeadFromGranot` may still refuse after this returns eligible — that race stays in the command tests.

Do **not** add a test per helper (`wordpressKeepsItsSubmittedContact`, `quotedMayBecomeTrueNeverFalse`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Temporal `$or` filters, identity ladders, eight gates, authorized `set` hashes, or processor Decision persist here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, inserts a Form Lead, or stamps `last_accepted_granot_observation`. Do not add a test that WordPress current `name` changes because Granot sent a different one.

## What I would not do

- A `LeadDesiredStateService` class with `create` / `update` / `plan`.
- Thirty two-line functions that only wrap `desired.set`.
- Moving this into a CRUD folder, or into `processor.ts` / `authorizedDesiredState.ts` “for cleanliness.”
- Inserting a Lead because the outcome says `created`.
- Making Temporal `same` advance the winner, or making a newer no-op refuse the clock.
- Blocking matched enrichment because `lead_created_policy` is `observation_only`.
- Authorizing create from Priority Update / Booked.
- Copying Granot contact onto a WordPress Form Lead’s current name and phone.
- Planning `quoted: false`, or Vantage `move_size`.
- Merging `compareGranotTemporal` or `toAuthorizedLeadDesiredState` into this file because the knowledge `resource` list names them together.
- Writing a whole-folder recommendation for `granotLifecycle`.
