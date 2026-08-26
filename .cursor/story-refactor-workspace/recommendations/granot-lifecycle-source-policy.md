# Say Which Registry Policy This Granot Label Uses — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 7 of this service — `sourcePolicy.ts`
- Remaining in this service: `identity.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/sourcePolicy.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/source-policy.md`. Distinct from HTTP automation readiness: `recommendations/granot-lifecycle-automation-compatibility.md` (that file maps `deferred` to `source_disabled` and never walks the eight gates). Distinct from Observation fold: `recommendations/granot-lifecycle-normalization.md` + `docs/knowledge/granot-lifecycle/normalization.md`. Distinct from receipt insert / queue wake-up / Owner extension apply / HTTP apply: `recommendations/granot-lifecycle-capture.md`, `recommendations/granot-lifecycle-queue-publisher.md`, `recommendations/granot-lifecycle-extension-apply.md`, `recommendations/granot-lifecycle-automation-apply.md`. Distinct from source-scoped identity / desired-state / processor / drain: next module `identity.ts` + `docs/knowledge/granot-lifecycle/identity.md`, `desired-state.md`, `processor.md`, `drainer.md`. Distinct from Registry writes and the unused policy cache: `operationsRegistry/granotCrmSources.ts`, `granotCrmSourceCache.ts`. Distinct from source-label fold: sibling `sourceLabel.ts`. This checkout’s `CONTEXT.md` does not define Granot CRM Source / Source Company / Source Granularity / Source Scope / Granot Observation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` (`resolveSourcePolicy` then `evaluateEffectGates` via `snapshotEligibleGates`; injected `SourcePolicyStore` in tests). `createLeadFromGranot.ts` (re-resolves inside the command session, then gates `lead_created`). `bookingReconciliation.ts` / `releaseReconciliation.ts` (`loadCurrentContext` resolves for identity; they do not call the gate evaluator). Type-only: `identity.ts`, `leadDesiredState.ts`, `synchronizeLeadTypes.ts`. Tests: `sourcePolicy.test.ts` (AC-38 / AC-09 / AC-29 / AC-04 / AC-28). Injected stores: `processor.test.ts`, `processor.replica.test.ts`, `createLeadFromGranot` path, `synchronizeLead.replica.test.ts`, `crossChannel.test.ts`. Not callers: `automationCompatibility.ts`, `normalization.ts`, `capture.ts`, webhook routes, `sourceLabel.ts` (this file calls it).
- Seams callers need: fail-closed snapshot vs eight-gate evaluation; injected `SourcePolicyStore` (tests + session-bound Mongo); Referral `ok: true` without a Lead route; processor maps flags → `global_effect_flag` (this file does not read flags)
- Split later (only if the file outgrows one sitting): `sayWhichRegistryPolicyThisGranotLabelUses.ts` / `sayWhetherThisLifecycleEffectMayFire.ts` — story files, never `form-policy.ts` / `call-policy.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`resolveSourcePolicy` / `evaluateEffectGates` are executor mechanics. The owner question is: *Granot named a source on this Observation. Which reviewed Registry row is it, and may this effect fire? Look up the exact normalized label. Zero or two rows — stop. Disabled, deferred, inactive company, mixed Form+Call routes, missing states, missing granularity — stop. Referral can succeed without a Lead route. Then, separately: walk the eight gates in order. Any false gate blocks. Do not match a Lead. Do not write a Decision. Do not apply HTTP automation.*

Identity, desired-state, processor writes, Lead create/sync, Booking/Release cases, Registry writes, and automation readiness already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one story, not “a source-policy CRUD service,” and not automation readiness / identity / create:

1. **Say which Registry policy this Granot label uses** — NFKC-fold the label (`normalizeGranotSourceLabel`). Empty / control / bidi is `policy_blocked` / `source_unclassified`. Exact `normalized_granot_label` lookup only. `provider_type` is ignored (`void facts.provider_type`). Zero rows → unclassified. Two or more → `ambiguous` / `multiple_eligible_matches` — never first-row wins. One row that is operationally off or `lifecycle_enabled=false` → `policy_blocked` / `source_disabled` (snapshot still names the row). `deferred` → `deferred` / `source_deferred`. `referral_booking` returns `ok: true` **without** `selected_lead_model`, `source_granularity_id`, or route fields, and without loading a company. Any other disposition with no company pointer, or an inactive / missing company → `target_source_company_inactive`. Then pick exactly one route: Form + Call routes together → `conflict` / `missing_creation_route_data`; Form routes need two valid USPS states (`selectFormMoveType`: same → local, different → long-distance, missing/invalid → `insufficient_creation_data` / `missing_creation_route_data`); exact move-type wins over `any`; candidate count ≠ 1 → `ambiguous` / `missing_creation_route_data`; missing granularity → `policy_blocked` / `missing_creation_route_data`; granularity company ≠ row company → `conflict` / `source_scope_conflict`; channel ≠ Form/Call → `conflict` / `missing_creation_route_data`; inactive granularity → `policy_blocked` / `target_source_granularity_inactive`. Success stamps `selected_lead_model` so identity does not re-resolve Registry semantics. This function does not read `writeGranotSourcePolicyCache`. It does not write a Lead, a Decision, or a Registry row.

2. **Say whether this requested lifecycle effect may fire** — pure snapshot of the eight `EFFECT_GATE_NAMES` in that order: `global_effect_flag`, `post_activation_live_mode`, `operational_enabled`, `lifecycle_enabled`, `disposition_permits_effect`, `source_company_active`, `source_granularity_active`, `policy_permits_effect`. Live mode is `receipt_post_activation && processor_mode === "live"`. Referral + booking/release reconciliation force the company/granularity gates true (`referralReconciliation`). `deferred` permits no effect. Referral permits only booking/release reconciliation. `observation_only` refuses Lead create/link/enrichment and still permits booking/release. `link_only` permits `lead_link` / `lead_enrichment` only. `source_scope_eligible === false` fails `policy_permits_effect` with `conflict` / `source_scope_conflict`. Any false gate → `allowed: false`. This function does not load Mongo. It does not read lifecycle flags. It does not write.

There is no third mutate operation. `createMongoSourcePolicyStore` is the Mongo **adapter** for operation 1. `selectRoute` is the Form/Call route fold for that one question. Form vs Call are two route families on one lookup, not two stories in this file.

## Organization

Keep one file. This is the screenplay for “say which Registry policy this Granot label uses, then say whether this effect may fire.” Registry writes, identity ladders, and processor flag mapping already live in deeper **modules**. Do not pull those in. Do not invent a `SourcePolicyService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a fail-closed read plus a pure gate snapshot, not a Domain Command. Do not invent an automation-shaped ready / unavailable **seam** that has only one real adapter here.

Do not split this ~500-line file into Form / Call folders, or into `resolve.ts` / `gates.ts` “because two exports.” Those are two beats of one owner question. Do not move the label fold into `sourceLabel.ts` beyond the helper this file already calls. Do not move route pick into `automationCompatibility.ts` “because routes live on the Registry row.” Do not merge this file into `processor.ts` so “policy and Decision live together.” Do not start reading `granotCrmSourceCache` so “Registry cache wins.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveSourcePolicy` | `sayWhichRegistryPolicyThisGranotLabelUses` | processor, create-if-missing, Booking/Release context |
| `evaluateEffectGates` | `sayWhetherThisLifecycleEffectMayFire` | processor `snapshotEligibleGates`; create-if-missing re-check |
| `createMongoSourcePolicyStore` | `readRegistryPolicyFromMongo` | session-bound default **adapter** |
| `EFFECT_GATE_NAMES` | `LifecycleEffectGateNames` | Decision snapshot order; tests lock the eight names |
| `SourcePolicyStore` | `RegistryPolicyReadStore` | test / session **seam**: label / company / granularity |
| `SourcePolicySnapshot` | `ReviewedSourcePolicySnapshot` | identity + desired-state consume this; they do not re-resolve |
| `SourcePolicyResolution` | `RegistryPolicyLookupResult` | `ok` + snapshot, or fail-closed outcome / reason |
| `EffectGateFacts` | `LifecycleEffectGateFacts` | processor maps flags here; this file does not read flags |
| `EffectGateEvaluation` | `LifecycleEffectGateSnapshot` | `{ evaluated_gates, allowed, outcome, reason }` |
| `RequestedLifecycleEffect` | `RequestedLifecycleEffect` | already the owner word |

Keep the old names as one-line aliases until `processor.ts`, `createLeadFromGranot.ts`, and the Booking/Release context loaders migrate. Do not make callers learn `normalized_granot_label` / `void provider_type` as the domain language.

`SourcePolicyStore` stays a test / session **seam**. It is not a third public operation. Default remains Mongo `find({ normalized_granot_label })` / `findById` company / granularity. `enabled !== false` (absent defaults true). `lifecycle_enabled === true` (absent defaults false). `lifecycle_disposition` absent → `deferred`. `lead_created_policy` absent → `observation_only`.

**No class for the workflow.** The type that *does* earn a name is the snapshot identity will consume without asking Registry again:

```ts
type ReviewedSourcePolicySnapshot = {
  granot_crm_source_id: string
  lead_source_company_id?: string
  source_granularity_id?: string
  selected_route_key?: string
  selected_lead_model?: "FormLead" | "CallLead"
  selected_move_type?: "local" | "long_distance" | "any"
  lifecycle_disposition: "source_scoped_lead" | "referral_booking" | "deferred"
  lead_created_policy: "link_only" | "create_if_missing" | "observation_only"
  lifecycle_policy_version?: string
  operational_enabled?: boolean
  lifecycle_enabled?: boolean
  source_company_active?: boolean
  source_granularity_active?: boolean
}
```

That is the handoff from “we looked up the reviewed row” to “identity may choose a Form or Call ladder, or Referral may open a case with no Lead scope.” Do **not** add `supported_operations` so “automation readiness matches,” and do **not** add processing state so “the snapshot can be claimed.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourcePolicy.ts
// Granot named a source on this Observation.
// Which reviewed Registry row is it?
// May this effect fire?
// Look up the exact normalized label.
// Zero or two rows — stop.
// Disabled, deferred, inactive company, mixed Form+Call routes,
// missing states, missing granularity — stop.
// Referral can succeed without a Lead route.
// Then walk the eight gates in order. Any false gate blocks.
// This file does not match a Lead.
// This file does not write a Decision.
// This file does not read the Registry policy cache.
// This file does not apply HTTP automation.

// ── 1. Say which Registry policy this Granot label uses ──

export async function sayWhichRegistryPolicyThisGranotLabelUses(facts, store?)
export function readRegistryPolicyFromMongo(session?)

function theLabelCannotBeNormalized(label)          // empty / control / bidi
function refuseZeroOrSeveralRegistryRows(matches)   // never first-row wins
function theRowIsOffOrLifecycleOff(row)
function theRowIsDeferred(row)
function referralNeedsNoLeadRoute(row)              // ok: true, no selected_lead_model
async function theSourceCompanyIsMissingOrInactive(row, store)
async function pickExactlyOneCreationRoute(row, facts, store)
  // Form + Call together → conflict
  // Form: selectFormMoveType; exact move-type over any
  // candidate count ≠ 1 → ambiguous
  // missing / wrong-company / wrong-channel / inactive granularity
function ignoreProviderType(facts)                  // void facts.provider_type

export type ReviewedSourcePolicySnapshot = { /* today's SourcePolicySnapshot */ }
export type RegistryPolicyReadStore = { /* today's SourcePolicyStore */ }

// ── 2. Say whether this requested lifecycle effect may fire ──

export function sayWhetherThisLifecycleEffectMayFire(facts)
export const LifecycleEffectGateNames = [ /* today's EFFECT_GATE_NAMES */ ]

function liveModeMeansPostActivationAndLive(facts)
function referralReconciliationSkipsLeadScope(facts)
function dispositionPermitsThisEffect(disposition, effect)
function creationPolicyPermitsThisEffect(policy, effect)
function firstBlockingReason(facts, computed)
  // callers read outcome/reason only when allowed === false
```

Read the primary path out loud: *The processor claimed a receipt and already kept the Observation. The source label is on that Observation. Fold it. Find the one Registry row with that exact normalized label. If nobody reviewed this label, or two rows share it, stop. If the one row is off, lifecycle-off, or deferred, stop and keep the snapshot so the Decision can name the source. If it is Referral, that is enough — no Lead company, no route, no granularity. Otherwise the company must be present and active, and exactly one Form or Call route must fit the move. Same valid USPS states pick local; different pick long-distance; missing or XX pick none. Then the processor asks a second question with the flags it already knows: may we create, link, enrich, or open a Booking/Release case? Walk the eight gates. Shadow is not live. Observation-only cannot create a Lead. Referral cannot create a Lead either, but it can open a Booking case without an active company. Do not look up a Lead here. Do not write the Decision here. Do not ask whether HTTP automation may be applied.*

That is the operation. `sayWhetherThisLifecycleEffectMayFire` is not a different story. `evaluateGranotAutomationCompatibility` is not this lookup.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`allowed: true` still carries a blocking outcome.** `firstBlockingReason` always returns a fail-closed pair. When every gate passes, the leftover is `policy_blocked` / `source_disabled`. Referral booking with inactive company/granularity is `allowed: true` and still `target_source_company_inactive`. Processor and create-if-missing only read `outcome` / `reason` when `allowed === false`. AC-28 asserts `allowed`, not the leftover reason. Do not invent a success outcome so “the type is honest,” and do not start failing Referral because the leftover reason “wins.”

2. **Referral refusing Lead create is labeled `source_deferred`.** `dispositionPermitsEffect("referral_booking", "lead_created")` is false. `firstBlockingReason` then maps any failed disposition that is not `deferred` to `policy_blocked` / `source_deferred`. The row is Referral, not deferred. Do not change the reason so “Referral is honest,” and do not treat Referral as deferred so automation readiness “matches.”

3. **Mixed Form+Call routes and several other route failures share `missing_creation_route_data`.** Form + Call together is `conflict`. Candidate count ≠ 1 is `ambiguous`. Missing granularity and wrong channel also reuse that reason. Tests lock the Best Relocation missing/invalid-state path, not the mixed-channel path. Do not invent `mixed_channel_routes` so “every outcome is precise.”

4. **`source_scope_eligible` is never passed by runtime callers.** Only `sourcePolicy.test.ts` AC-04 sends `false`. `processor.ts` `snapshotEligibleGates` and `createLeadFromGranot` omit it, so `!== false` stays eligible. Identity owns Source Scope after this snapshot. Do not wire the processor to pass it so “the gate is live,” and do not delete the fact so “nobody uses it.”

5. **This file never reads the Registry policy cache.** `writeGranotSourcePolicyCache` lives in `operationsRegistry/granotCrmSourceCache.ts`. AC-38 writes a precommit `ok: true` snapshot and still gets `source_unclassified` from the injected empty store. Do not start reading that cache so “Registry cache wins,” and do not delete the write so “unused cache is clutter.”

6. **`provider_type` is ignored.** `type=AUTO` does not classify, defer, or pick a route. A Best Relocation Forms label with `AUTO` still needs origin/destination. Paid Overflow / Auto stay deferred by their Registry row, not by `type`. Do not treat `AUTO` as a label so “auto sources classify themselves.”

7. **Referral resolve is `ok` without a company or route.** Knowledge already says so. `evaluateEffectGates` then force-allows company/granularity for Referral booking/release. Do not require a company on Referral resolve so “every ok snapshot has a company,” and do not make identity treat a missing `selected_lead_model` as unclassified.

8. **Mongo defaults are asymmetric.** Store maps `enabled !== false` (absent true) and `lifecycle_enabled === true` (absent false). Unreviewed rows stay lifecycle-off, deferred, observation-only, route-empty. Do not flip either default so “both flags mean the same on.”

9. **Automation readiness is a different question.** That file maps deferred + operational/lifecycle disable to one `source_disabled`, does not load Mongo, and never reads `lead_created_policy` or the eight gates. This file maps deferred to `deferred` / `source_deferred`. Do not collapse them. See CONTRADICTIONS.md and `recommendations/granot-lifecycle-automation-compatibility.md`.

10. **`allowed: true` is not a write.** Knowledge says this module authorizes no live effect. The snapshot can say the effect may fire; processor / create-if-missing / Owner commands still own the write and the checked-in false flags. Do not create a Lead or open a case from this file so “allowed means do it.”

11. **Leave sibling modules alone.** `normalizeGranotSourceLabel` / `selectFormMoveType` stay in `sourceLabel.ts`. Registry writes stay in `granotCrmSources.ts`. Identity / desired-state / processor consume the snapshot; they do not look up the label again. Automation readiness stays in `automationCompatibility.ts`.

12. **Do not treat capture `202`, Observation persist, Owner apply, HTTP apply, identity ladders, or `createLeadFromGranot` as this story.** Those keep evidence, claim, match, or write a Lead. This file only answers which reviewed row it is and whether the requested effect may fire.

13. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayWhichRegistryPolicyThisGranotLabelUses` (today `resolveSourcePolicy`) and `sayWhetherThisLifecycleEffectMayFire` (today `evaluateEffectGates`). `ReviewedSourcePolicySnapshot` is part of that **interface**. `RegistryPolicyReadStore` stays exported because processor / create-if-missing / replica tests inject it, not as a test leak. `createMongoSourcePolicyStore` stays exported because Booking/Release context and create-if-missing bind a session.

Today’s `sourcePolicy.test.ts` already locks unclassified / two rows / lifecycle-off / inactive company, cache-is-not-authority, Best Relocation same-state local / different-state long-distance / missing-or-XX none, deferred Paid Overflow / Auto, `type=AUTO` is not classification, ineligible Source Scope when passed, eight-name order, first-block `global_effect_disabled`, deferred vs `policy_blocked`, and Referral booking with inactive company/granularity `allowed: true`. Keep those. Add the gaps that name the operation:

**Say which Registry policy this Granot label uses**
- `enabled: false` (operational off, lifecycle still on) → `source_disabled`, snapshot keeps the id.
- Missing `lead_source_company` on a non-Referral row → `target_source_company_inactive`.
- Referral row → `ok: true`, no `selected_lead_model` / `source_granularity_id`.
- One Call route, no Form routes → `ok: true`, `selected_lead_model: "CallLead"` (no states required).
- Form + Call routes on the same row → `conflict` / `missing_creation_route_data`.
- Granularity company ≠ row company → `conflict` / `source_scope_conflict`.
- Form route pointing at a `channel: "call"` granularity → `conflict` / `missing_creation_route_data`.
- Inactive granularity → `target_source_granularity_inactive`.
- This function does not return the precommit cache id.

**Say whether this requested lifecycle effect may fire**
- `link_only` + `lead_created` → blocked / `creation_policy_link_only`; `lead_link` / `lead_enrichment` allowed when the other gates pass.
- `observation_only` + `lead_created` → `creation_policy_observation_only`; `booking_reconciliation` allowed.
- `processor_mode: "historical_shadow"` → `historical_shadow`; `live_shadow` or `receipt_post_activation: false` → `shadow_effect_suppressed`.
- `allowed: true` may still return a leftover blocking `outcome` / `reason` (current contract; do not “fix”).
- Omitting `source_scope_eligible` does **not** fail the gate.
- This function does not load Mongo.

Do **not** add a test per helper (`refuseZeroOrSeveralRegistryRows`, `pickExactlyOneCreationRoute`, `referralReconciliationSkipsLeadScope`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test processor flag mapping (`lead_creation_enabled` → `global_effect_flag`), identity ladders, desired-state `quoted`, or `createLeadFromGranot` writes here. Do not re-test automation `available_for_apply`. Do not add a test that this file reads `writeGranotSourcePolicyCache` or writes a Lead — it must not. Do not add a test that `type=AUTO` classifies a source.

## What I would not do

- A `SourcePolicyService` class with `create` / `update` / `resolve`.
- Thirty two-line functions that only wrap `normalizeGranotSourceLabel`.
- Moving this into a CRUD folder, or into `form-policy.ts` / `call-policy.ts` / `processor.ts` “for cleanliness.”
- Reading the Registry policy cache, or treating `provider_type` as classification.
- Merging deferred handling with `automationCompatibility.ts`, or collapsing automation readiness into the eight gates.
- Wiring `source_scope_eligible` from the processor so “the gate is live.”
- Inventing a success `outcome` when `allowed: true`, or failing Referral because the leftover reason says the company is inactive.
- Writing a Lead, a Decision, or a Booking case from this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
