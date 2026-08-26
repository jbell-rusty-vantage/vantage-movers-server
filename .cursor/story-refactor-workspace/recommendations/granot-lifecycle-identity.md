# Say Which Form or Call Lead This Observation Is — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 8 of this service — `identity.ts`
- Remaining in this service: `granotTemporal.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/identity.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/identity.md`. Distinct from fail-closed Registry lookup / eight gates: `recommendations/granot-lifecycle-source-policy.md` + `docs/knowledge/granot-lifecycle/source-policy.md`. Distinct from Observation fold: `recommendations/granot-lifecycle-normalization.md` + `docs/knowledge/granot-lifecycle/normalization.md`. Distinct from desired-state / processor Decision / drain: next module `granotTemporal.ts` + `docs/knowledge/granot-lifecycle/desired-state.md`, `processor.md`, `drainer.md`. Distinct from Job stamp / prefix-twin filter: `recommendations/bookings-booking-identity.md`. Distinct from CSV receiver stamp: `recommendations/agents-receiver-agent-crm-username.md` (this file **never** calls `applyGranotCrmUsernameReceiverMatch`). Distinct from Booking/Release case open: `bookingReconciliation.ts` / `releaseReconciliation.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / Granot Record Link / Source Scope / Active Agent — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` (`toIdentityObservation` then `resolveLeadIdentity`; injected `resolveIdentity` / `identityStore` in tests). `createLeadFromGranot.ts` (re-resolves inside the command session as a race: any target / candidate / non-pending outcome throws). `bookingReconciliation.ts` / `releaseReconciliation.ts` (`loadCurrentContext` resolves for Booking owner + `referral_leadless`; they do not write from this file). Type-only: `leadDesiredState.ts`, `synchronizeLeadTypes.ts`. Tests: `identity.test.ts` (AC-09 / AC-29 / AC-03 / AC-04 / AC-07 / AC-08 / AC-13), `identity.module.test.ts` (AC-39 / AC-04 / AC-07), `identity.replica.test.ts` (AC-07 / AC-13 / AC-39 / AC-04). Operator scripts: inbound Job-prefix repair and Booking-case intake (read-only). Not callers: `capture.ts`, webhook routes, `sourcePolicy.ts` (this file consumes its snapshot), `receiverAgentCrmUsername.ts`, `bookingIdentity.ts` (this file calls it).
- Seams callers need: fail-closed policy / Referral / missing scope vs Form or Call ladder; injected `LeadIdentityStore` (tests + session-bound Mongo); Agent suggestion and Booking context always run, even when the ladder does not; candidates are ids + reason codes only
- Split later (only if the file outgrows one sitting): `sayWhichFormOrCallLeadThisObservationIs.ts` / `sayWhichAgentThisObservationNamed.ts` / `sayWhichBookingAlreadyOwnsThisJob.ts` — story files, never `form-identity.ts` / `call-identity.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`resolveLeadIdentity` is executor mechanics. The owner question is: *Granot observed a Job, a tracking ref, a phone. The reviewed Registry row already said this is a source-scoped Lead — or Referral, or deferred. Which Vantage Form or Call Lead is it? Which Agent did they name? Which Booking already owns this Job? Look only inside that Source Company and Source Granularity. A job-only Record Link is evidence, not a target. Duplicate Form Leads are not targets. Bad Form Leads are priority-only. Referral never searches a Lead. Do not write a Decision. Do not create a Lead. Do not open a Booking case.*

Desired-state, processor writes, Lead create/sync, Booking/Release cases, Registry policy, Observation fold, and receiver stamp already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one story, not “an identity CRUD service,” and not Registry policy / desired-state / create:

1. **Say which Form or Call Lead this Observation is** — consume an already-normalized Observation projection and an already-resolved `SourcePolicySnapshot`. `void provider_context` (`type=AUTO` does not classify or match). `policy_failure` returns that outcome with no Lead query. `deferred` → `deferred` / `source_deferred`. `referral_booking` → `unmatched` / `creation_policy_observation_only`, `referral_leadless=true`, no Lead ladder. Any other disposition → `policy_blocked` / `source_unclassified`. Missing company → `target_source_company_inactive`. Missing granularity or `selected_lead_model` → `missing_creation_route_data`. Then pick exactly one ladder from `selected_lead_model`. **Form:** active Record Link by prefix-equivalent Job (job-only link continues; link with `lead_ref` stops — model / missing Lead / scope / Job disagreement is hard conflict; Duplicate Form Lead is ineligible; Bad Form Lead is `priority_only`); exact eligible `FormLead.ref_no`; if that value is 24-character ObjectId hex, exact `FormLead._id`; else Source Company **and** Source Granularity contact across current / ingested / Granot phone and email. Blank / omitted Form ref is never queried. Exact identity with missing or conflicting canonical scope is `conflict` / `source_scope_conflict` and does not fall through to contact. Several eligible Form exact hits → `conflict` / `multiple_eligible_matches`. Several eligible Form contact hits → `ambiguous` / `multiple_eligible_matches`. Zero eligible contact → `pending_match` / `pending_source_scoped_match` (or `unmatched` when there are no identity keys at all). **Call:** active Record Link (same job-only / conflict rules, Call model); prefix-equivalent `CallLead.normalized_job_no` inside the resolved Source Granularity (Duplicate Call Leads stay readable); then Source Granularity plus current / ingested phone (no Call `granot_contact_snapshot`). Job and phone pointing at different eligible Leads → `conflict` / `job_number_conflict`. Several same-rung Call hits → `conflict` / `multiple_eligible_matches` (not `ambiguous`). After the ladder, Booking-owner scope: Form owner missing or out of scope can become `ambiguous` / `record_link_conflict` or `source_scope_conflict`; Call owner miss is `conflict` / `record_link_conflict`. This function does not write a Lead, a Decision, a Record Link, or a case.

2. **Say which Agent this Observation named** — always runs, including on policy failure / Referral / deferred. Preserve `user_raw` / `rep_raw` on the Observation (this file does not fold those raw fields away). Normalize nonempty values with the Registry Granot username normalizer. Both empty → `agent_assertion: "empty"`. Different nonempty values → `conflict`, no Agent, Lead identity still proceeds. Equal values (or one side empty) look up active Agents by `granot_identity.username` **or** compatibility `granot_crm_username`. Exactly one row → suggest that Agent. Zero or two-plus rows stay `agent_assertion: "single"` with no `agent`. `priority_only` and Agent `conflict` suppress the suggestion in `finalize`. This function does **not** emit `granot_agent_identity_conflict`. It never calls `applyGranotCrmUsernameReceiverMatch`. It never creates, activates, verifies, or mutates an Agent.

3. **Say which Booking already owns this Job** — always runs. No Job → empty context, `referral_leadless` only when the policy is Referral. Prefix-equivalent Booking lookup. Several current Bookings → `multiple_bookings: true`; `finalize` then makes the Lead outcome `conflict` / `job_number_conflict`. One Booking with a Lead is owner context; disagreement with a ladder candidate is `conflict` / `job_number_conflict`, not reassignment. A Booking without a Lead (leadless or missing `lead_ref`) and not Referral sets `booking_lead_reconciliation_required=true` and **does not** open `BookingLeadReconciliationCase`. Referral policy or an existing Referral Booking sets `referral_leadless=true`. This function does not write a Booking or a case.

There is no fourth mutate operation. `createMongoLeadIdentityStore` is the Mongo **adapter** for all three reads. Form vs Call are two ladders on one lookup, not two stories in this file.

## Organization

Keep one file. This is the screenplay for “say which Form or Call Lead this Observation is, which Agent they named, and which Booking already owns this Job.” Registry policy, Observation fold, desired-state, processor Decision, Lead create/sync, and case open already live in deeper **modules**. Do not pull those in. Do not invent a `LeadIdentityService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a fail-closed read, not a Domain Command. Do not invent a write **seam** that has only one **adapter** here.

Do not split this ~1250-line file into Form / Call folders, or into `resolve.ts` / `agent.ts` / `booking.ts` “because three exports.” Those are three beats of one owner question. Do not move prefix-twin Job compare into this file beyond the helpers it already calls. Do not move Agent lookup into `receiverAgentCrmUsername.ts` “because both fold a Granot username.” Do not merge this file into `processor.ts` so “identity and Decision live together.” Do not start writing a Record Link or a case so “linked means persist.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveLeadIdentity` | `sayWhichFormOrCallLeadThisObservationIs` | processor, create-if-missing race, Booking/Release context |
| `createMongoLeadIdentityStore` | `readLeadIdentityFromMongo` | session-bound default **adapter** |
| `LeadIdentityStore` | `LeadIdentityReadStore` | test / session **seam**: Record Link / Form / Call / Agent / Booking |
| `LeadIdentityInput` | `LeadIdentityQuestion` | Observation projection + reviewed snapshot + optional policy failure |
| `LeadIdentityResult` | `LeadIdentityAnswer` | outcome / reason / method / target / candidates / eligibility / Agent / Booking |
| `LeadIdentityCandidate` | `LeadIdentityCandidate` | ids + reason codes only — never contact |
| `LeadIdentityObservation` | `NormalizedIdentityFacts` | processor / case loaders project onto this |
| `SynchronizationMatchMethod` | `HowWeRecognizedThisLead` | Decision `match_method` vocabulary |
| `isMongoObjectIdHex` | `thisTrackingRefLooksLikeAFormId` | Form ObjectId compatibility rung |

Keep the old names as one-line aliases until `processor.ts`, `createLeadFromGranot.ts`, and the Booking/Release context loaders migrate. Do not make callers learn `InTransaction` or `selected_lead_model` as the domain language.

`LeadIdentityStore` stays a test / session **seam**. It is not a fourth public operation. Default remains Mongo: active `GranotRecordLink` by prefix-equivalent Job; Form `ref_no` / `_id` / scoped contact; Call scoped Job / phone / `_id`; active Agent username `$or`; Bookings by prefix-equivalent Job.

**No class for the workflow.** The type that *does* earn a name is the answer the processor will stamp onto a Decision without asking identity again:

```ts
type LeadIdentityAnswer = {
  outcome: SynchronizationOutcome
  reason_code: SynchronizationReasonCode
  match_method?: HowWeRecognizedThisLead
  target?: EntityRef
  candidates: LeadIdentityCandidate[]
  target_eligibility?: "full" | "priority_only"
  agent?: { target: { model: "Agent"; id: string }; normalized_username: string }
  agent_assertion?: "empty" | "single" | "conflict"
  booking_context?: {
    booking?: { model: "BookedLead"; id: string }
    owner_lead?: EntityRef
    booking_lead_reconciliation_required: boolean
    referral_leadless: boolean
    multiple_bookings?: boolean
  }
}
```

That is the handoff from “we looked only inside this Source Scope” to “desired-state may plan, the processor may write a Decision, or a Booking case may show owner context.” Do **not** add contact, Job, or payload fields so “the Owner can see who it is,” and do **not** add processing state so “the answer can be claimed.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// identity.ts
// Granot observed a Job, a tracking ref, a phone.
// The reviewed Registry row already said which ladder this is.
// Which Vantage Form or Call Lead is it?
// Which Agent did they name?
// Which Booking already owns this Job?
// Look only inside that Source Company and Source Granularity.
// A job-only Record Link is not a target.
// Duplicate Form Leads are not targets.
// Bad Form Leads are priority-only.
// Referral never searches a Lead.
// This file does not write a Decision.
// This file does not create a Lead.
// This file does not open a Booking case.
// This file does not stamp a receiver.

// ── 1. Say which Form or Call Lead this Observation is ──

export async function sayWhichFormOrCallLeadThisObservationIs(input, store?)
export function readLeadIdentityFromMongo(session?)

function ignoreProviderType(observation)            // void type=AUTO
function refuseWhenPolicyAlreadyFailed(failure)
function refuseDeferredOrUnclassified(policy)
function referralNeverSearchesALead(policy)         // unmatched + referral_leadless
function refuseMissingCompanyOrRoute(policy)

async function climbTheFormLadder(input, store)
  // Record Link → exact ref_no → ObjectId hex → scoped contact
async function climbTheCallLadder(input, store)
  // Record Link → scoped Job → scoped phone
  // Job vs phone different Leads → job_number_conflict

function aJobOnlyLinkIsNotATarget(link)             // continue the ladder
function theLinkDisagreesWithThisLadder(link)       // model / missing Lead / scope
function thisFormLeadCannotBeATarget(lead)          // duplicate / missing scope
function thisBadFormLeadIsPriorityOnly(lead)
function severalFormExactHitsAreAConflict(leads)
function severalFormContactHitsAreAmbiguous(leads)
function severalCallHitsAreAConflict(leads)         // not ambiguous
function neverQueryABlankFormRef(formRef)

async function applyTheBookingOwnerScope(ladder, booking, input, store)
  // Form owner miss → ambiguous / record_link_conflict
  // Call owner miss → conflict / record_link_conflict

export type LeadIdentityAnswer = { /* today's LeadIdentityResult */ }
export type LeadIdentityReadStore = { /* today's LeadIdentityStore */ }

// ── 2. Say which Agent this Observation named ──

async function sayWhichAgentThisObservationNamed(agentIdentity, store)
  // empty / user≠rep conflict / exactly one active row
  // zero or 2+ rows stay assertion "single" with no agent

// ── 3. Say which Booking already owns this Job ──

async function sayWhichBookingAlreadyOwnsThisJob(input, store)
  // several Bookings → multiple_bookings (finalize → job_number_conflict)
  // leadless Booking → booking_lead_reconciliation_required, no case write
  // owner ≠ ladder target → conflict evidence, not reassignment

function finishWithoutLeakingContact(answer, agent, booking)
```

Read the primary path out loud: *The processor already kept the Observation and already asked which reviewed Registry row this label uses. That snapshot says Form or Call, or Referral, or deferred. If the policy already failed, or the row is deferred, or nobody reviewed the label, stop — do not search a Lead. If it is Referral, say unmatched and leadless; still look up the Agent they named and the Booking on this Job. Otherwise climb the Form or Call ladder inside that Source Company and Source Granularity. A Record Link with only a Job is evidence; keep looking. A Record Link that names the wrong model, a missing Lead, or the wrong Source Scope is a fight; stop. An exact Form tracking ref that lives on another site is a fight; do not try the phone. A Duplicate Form Lead is not a target. A Bad Form Lead from a strong exact hit is priority-only. Two Form phones in the same scope are ambiguous; two Call phones in the same scope are a fight. Then look at the Booking on this Job. If it already names a different Lead, that is conflict evidence, not a new owner. If it names no Lead, tell the Owner a Booking Lead Reconciliation case is needed — do not open one here. Suggest an Agent only when user and rep agree and exactly one active row matches. Do not write the Decision here. Do not create a Lead here. Do not stamp a receiver here.*

That is the operation. `resolveLeadIdentity` is not. `applyGranotCrmUsernameReceiverMatch` is not this lookup.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Referral success is labeled `creation_policy_observation_only`.** A Referral snapshot returns `ok`-path identity `unmatched` with that reason and `referral_leadless=true`. The row is Referral, not observation-only. The Referral test locks leadless + no Lead query, not the reason code. Do not invent `referral_booking` so “the reason is honest,” and do not treat Referral as observation-only so desired-state “matches.”

2. **A successful contact or tracking-ref match says `record_link_confirmed`.** `classifyFormExactLead` and both contact success paths write that reason whenever the Lead is full-eligible. `match_method` is the honest rung (`form_ref_no_exact`, `source_scoped_contact`, `call_job_no_exact`). Processor persists both. Do not change the reason so “confirmed means a Record Link,” and do not start writing a Record Link from this file so the reason “wins.”

3. **`agent_assertion: "single"` means zero, one, or many.** Exactly one active row suggests an Agent. Zero or two-plus stay `"single"` with no `agent`. AC-13 locks the two-plus path. Do not rename the empty/many case so “the enum is honest,” and do not pick the first Agent so “single means we found one.”

4. **This file’s Agent find uses both username fields.** `findActiveAgentsByUsername` queries `granot_identity.username` **or** `granot_crm_username`. Knowledge agrees. `findAgentByGranotCrmUsername` / Registry `resolveAgentByGranotUsername` query only the nested field (test-locked). Do not delete the flat field from this store so “the other find wins,” and do not add the flat field to that other find from this pass. See CONTRADICTIONS.md and `recommendations/agents-receiver-agent-crm-username.md`.

5. **`disputed` is loaded and never read.** `IdentityRecordLink.disputed` is mapped from Mongo. No ladder beat consults it. Do not start failing disputed links so “the field is live,” and do not drop the map so “unused is clutter.”

6. **Form and Call disagree on “several eligible.”** Form exact multi-match is `conflict`. Form contact multi-match is `ambiguous`. Call same-rung multi-match is `conflict`. Knowledge already says so. AC-08 locks Call phone as conflict. Do not make Call ambiguous so “multi-match is one word,” and do not make Form contact a conflict so “every several is a fight.”

7. **Booking-owner Form miss is `ambiguous`; Call miss is `conflict`.** Both use `record_link_conflict`. Knowledge already says so. Do not flip Form to conflict so “owner miss is always a fight.”

8. **Prefix twins are the same Job here; the Booking unique index is the exact stamp.** `equivalentNormalizedJobFilter` / `jobNumbersEquivalent` treat `P5562366` / `5562366` as one Job. Two Bookings can still exist on those two stamps, then this file returns `job_number_conflict`. Do not switch identity to exact `normalized_job_no` so “one Booking per Job wins.” See CONTRADICTIONS.md and `recommendations/bookings-booking-identity.md`.

9. **Call contact ignores `granot_contact_snapshot`.** Form contact reads current + ingested + Granot phone/email. Call phone reads current + ingested only. Knowledge already says so. Do not add the Call Granot snapshot so “contact is one shape.”

10. **Form scoped-contact find skips Duplicate Form Leads; Call Job and phone finds do not skip Duplicate Call Leads.** Duplicate Call Leads stay readable on the Job rung (test-locked). Duplicate Form Leads are filtered in the contact query and classified ineligible on exact rungs. Do not add `duplicate: { $ne: true }` to Call finds so “both ladders skip duplicates.”

11. **`LeadIdentityQueryLog` is a test diary, not a runtime export.** Runtime callers never record it. The recording store in tests pushes those rows. Do not persist query logs so “the type is live.”

12. **`policy_failure` wins over the snapshot disposition.** AC-29 sends both a deferred snapshot and `policy_failure`. The function returns the failure and never inspects `lifecycle_disposition`. Processor always passes the failure when `resolveSourcePolicy` is not `ok`, and still calls this file so Agent / Booking context exist. Do not skip the identity call on policy failure so “there is nothing to match,” and do not ignore `policy_failure` so “the snapshot is enough.”

13. **`allowed` / `linked` is not a write.** Knowledge says this module creates no Decision, desired state, Lead, Booking, case, discrepancy, command, Change, outbox item, or notification. Replica tests lock read-only. Create-if-missing treats any target as a race. Do not create a Lead or open a case from this file so “linked means do it.”

14. **Leave sibling modules alone.** `jobNumbersEquivalent` / `equivalentNormalizedJobFilter` stay in `bookingIdentity.ts`. Username fold stays in Registry (`normalizeGranotCrmUsername`). Receiver stamp stays in `receiverAgentCrmUsername.ts`. Policy lookup stays in `sourcePolicy.ts`. Observation fold stays in `normalization.ts`. Desired-state / processor consume this answer; they do not climb the ladder again.

15. **Do not treat capture `202`, Observation persist, Registry lookup, desired-state `quoted`, `createLeadFromGranot` writes, or Booking-case open as this story.** Those keep evidence, classify a source, plan a patch, or write. This file only answers which Lead / Agent / Booking the Observation already points at.

16. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayWhichFormOrCallLeadThisObservationIs` (today `resolveLeadIdentity`). `LeadIdentityAnswer` is part of that **interface**. `LeadIdentityReadStore` stays exported because processor / create-if-missing / replica tests inject it, not as a test leak. `createMongoLeadIdentityStore` stays exported because Booking/Release context and create-if-missing bind a session.

Today’s `identity.test.ts` / `identity.module.test.ts` / `identity.replica.test.ts` already lock missing route never queries a Lead, deferred + `type=AUTO` never enter a ladder, exact Form ref + ObjectId compatibility, blank Form ref never queried, Form ref / Record Link / Booking-owner Source Scope conflict, Call Job never global, one Form contact target, current+immutable Form contact dedupe, job-only link continues, usable link stops, Duplicate Form ineligible, Bad Form `priority_only` and excluded from contact, inbound letter prefix is the same Job, conflicting Jobs, Form contact multi-match `ambiguous`, Call Job scoped and Duplicate Call readable, Call Job vs phone conflict, Call phone dedupe, Call phone multi-match `conflict`, equal usernames suggest one Agent, user≠rep blocks suggestion, two Agents no suggestion, Referral leadless + no Lead search, leadless Booking delegates and writes no case, several Bookings `job_number_conflict`, Record Link model mismatch, missing link Lead does not fall through, Call phone always scoped, Booking owner ≠ contact candidate is conflict not reassignment, and replica read-only. Keep those. Add the gaps that name the operation:

**Say which Form or Call Lead this Observation is**
- Referral snapshot (no `policy_failure`) → `unmatched` / `creation_policy_observation_only` (current contract; do not “fix”).
- Several eligible Form exact `ref_no` hits → `conflict` / `multiple_eligible_matches` (not `ambiguous`).
- Form contact success reason stays `record_link_confirmed` while `match_method` is `source_scoped_contact` (current contract; do not “fix”).
- No Job / ref / phone / email → `unmatched` / `pending_source_scoped_match` and no contact query.
- Call ladder does **not** query `granot_contact_snapshot`.
- `type=AUTO` on a live `source_scoped_lead` snapshot does not change the ladder.
- This function does not write a Record Link, a Decision, or a Lead.

**Say which Agent this Observation named**
- Both usernames empty → `agent_assertion: "empty"`, no Agent query required.
- Zero active rows → `agent_assertion: "single"`, no `agent` (current contract; do not “fix”).
- `priority_only` Form target suppresses the Agent suggestion.
- This function does not call `applyGranotCrmUsernameReceiverMatch` and does not emit `granot_agent_identity_conflict`.

**Say which Booking already owns this Job**
- Referral + existing Referral Booking → `referral_leadless: true`, `booking_lead_reconciliation_required: false`.
- Ordinary Booking with a Lead and no ladder target → `linked` / `booking_job_no_exact` (current `finalize` contract).
- This function does not open `BookingLeadReconciliationCase`.

Do **not** add a test per helper (`aJobOnlyLinkIsNotATarget`, `severalCallHitsAreAConflict`, `finishWithoutLeakingContact`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Registry label lookup, desired-state `quoted`, processor Decision persist, or `createLeadFromGranot` writes here. Do not add a test that this file reads `writeGranotSourcePolicyCache` or stamps a receiver — it must not. Do not add a test that `type=AUTO` classifies a source. Do not add a test that prefix twins write one Booking.

## What I would not do

- A `LeadIdentityService` class with `create` / `update` / `resolve`.
- Thirty two-line functions that only wrap `jobNumbersEquivalent`.
- Moving this into a CRUD folder, or into `form-identity.ts` / `call-identity.ts` / `processor.ts` “for cleanliness.”
- Calling `applyGranotCrmUsernameReceiverMatch`, or merging Agent lookup with `findAgentByGranotCrmUsername`.
- Switching Job compare to exact `normalized_job_no` so “one Booking per Job wins.”
- Making Call multi-match `ambiguous`, or Form contact multi-match `conflict`, so “several is one word.”
- Inventing a Referral reason, an honest `agent_assertion` for zero matches, or a success reason that is not `record_link_confirmed`.
- Writing a Lead, a Decision, a Record Link, or a Booking case from this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
