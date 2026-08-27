# Match Each Collected Booked Jobs And Follow Up Row To An Existing Form Lead, Then Propose Only The Missing Fields — Never Create One, Never Write, Never Seal — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 4 of this service — `formWorkflow.ts`
- Remaining in this service: `granotFormLeadMatcher.ts`, `lifecycleStatement.ts`, `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/formWorkflow.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — Form planner: `resolveGranotFormLead` then a missing-field patch (quoted/cubic feet when `prior` is `1` or `5`; city/zip/state fill-if-missing; receiver agent only when the lead has none). Form planning never **creates** Form Leads (`no_match` / `conflict` only). `invalid` exists on the counter type; current `planRow` emits `update` / `unchanged` / `conflict` / `no_match` (known unused `invalid` / leftover `conflict()` helper). `planGranotFormWorkflow` emits `schema_version: 1`; `sealAutomationPlan` later attaches `lifecycle_apply` to every action and sets schema 2. Approvable Form actions are `classification === "update"` only (that gate lives on `runWorkflow.ts`). Distinct from session collect + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from standalone collect/preview: [recommendations/granot-http-collector-automation.md](granot-http-collector-automation.md). Distinct from fail-closed source resolve: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md). Distinct from Form match (exact `ref_no`, then Mongo id, then same-source fallback): later `granotFormLeadMatcher.ts`. Distinct from plan seal: later `lifecycleStatement.ts`. Distinct from admin create / plan / approve / worker: later `runWorkflow.ts`. Distinct from Form Lead Correction write: [recommendations/form-lead.md](form-lead.md). Distinct from receiver stamp: [recommendations/agents-receiver-agent-crm-username.md](agents-receiver-agent-crm-username.md) (this file copies the five fields; it does not mutate the live Lead). Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` calls this “form parser, strict identity resolution, immutable actions, and safe patch planning” — parse is `index.ts`, identity is `granotFormLeadMatcher.ts`; this file only walks collected rows and proposes patches. HANDOFF Safety also says Form exact identity is only `Granot ref_no === FormLead.ref_no` and “Never add `_id`, `lid`, or `normalized_lid` interpretations” — the matcher and `[AC-03]` already allow Mongo `_id` after exact `ref_no` misses; do not delete that lookup so HANDOFF “wins.” This checkout’s `CONTEXT.md` does not define Form Lead / Granot HTTP collector / Observation Receipt / Tracking Reference as glossary entries — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one runtime import site + the test file.** Planning: `runWorkflow.ts` calls `planGranotFormWorkflow(collection.sources, { beforeRow })` when `run.operation === "form_leads"`; `beforeRow` renews the fenced account lease and stamps `checkpoint: plan`. After this file returns, the run seals (`sealAutomationPlan`), checksums, and locks. Tests: `formWorkflow.test.ts` (exact `ref_no` wins and must not fall back; duplicate exact refs are `conflict`; Mongo id only after exact miss; fallback after exact miss; source-company warning on exact; fallback source-gate / quoted-prior / name-only refuse; both table sections labeled; patch fill-if-missing + never overwrite receiver). That file also re-exports `selectGranotFormFallback` for two unit tests and locks `granotFormIdentityFields` plus a misplaced `granotApplyEnabled` check imported from `runWorkflow.ts`. Not callers: `index.ts`, `automation.ts`, `sourceCatalog.ts`, `lifecycleStatement.ts`, `granotLifecycle/automationApply.ts`, public `PATCH /api/v1/form-leads`, `updateFormLead`, CSV sync.
- Seams callers need: walk-both-tables + classify (`schema_version: 1`) vs seal (`schema_version: 2` + `lifecycle_apply`); `update` (approvable later) vs `unchanged` / `conflict` / `no_match` (in the plan, not selectable); `beforeRow` lease/checkpoint vs each row; propose-a-patch vs write-the-lead; copy-the-five-receiver-fields vs stamp-the-live-lead; Form planner (this file, both tables) vs Call planner (`planCallWorkflow` in `runWorkflow.ts`, Follow Up → enrichment + Booked Jobs → booked-reconciliation)
- Split later (only if the file outgrows one sitting): keep one file — this ~294-line module is one screenplay for “match each collected Booked Jobs and Follow Up row to an existing Form Lead, then propose only the missing fields.” If it later splits: `planWhichFormLeadsTheseCollectedRowsWouldCorrect.ts` / `proposeTheMissingFieldsThisRowWouldFillOnThatFormLead.ts` — story files, never `plan.ts` / `patch.ts` / `match.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge HTML parse, Form match, plan seal, approve, apply, or Form Lead Correction write into this file

`planGranotFormWorkflow` / `buildGranotFormPatch` / `planRow` are executor mechanics. The owner question is: *We collected Booked Jobs and Follow Up Estimates for some Form sources. For each row, find the existing Form Lead — do not create one. If we find it, propose only the missing fields: mark quoted and copy cubic feet when Granot prior is 1 or 5, fill city / zip / state only when the lead is blank (and only when zip and state do not fight), and attach a receiver Agent only when the lead has none. If nothing would change, say unchanged. If we cannot find exactly one lead, say no_match or conflict. Hand the plan back at schema version 1 so the seal sibling can stamp every action. Do not write the Lead. Do not capture a receipt. Do not lock the run.*

Session collect, Form match, plan seal, durable admin runs, approved apply, and Form Lead Correction already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “match the collected Form rows, then propose only the missing fields” story, not “a Form Lead CRUD service,” and not the admin run / apply:

1. **Plan which Form Leads these collected rows would correct** — walk every collected source. For each source, walk Booked Jobs first, then Follow Up Estimates. Call `beforeRow` before each row (the run uses that hook to renew the lease and count planned rows). Ask the matcher sibling who this row is. Not found → `no_match`. Duplicate / ambiguous → `conflict`. Found → propose the missing-field patch, compare each path to `lead.get(path)`, and classify `unchanged` (empty diff) or `update` (diff + `expected` snapshot of the live values). Return `{ kind: "form_leads", schema_version: 1, actions, counters }`. This function does not seal. This function does not write. This function does not emit `invalid`.

2. **Propose the missing fields this row would fill on that Form Lead** — only after a match. `prior === "1"` or `"5"` → `quoted: true` and `cubic_feet` from `est_cf` when the number parses. Parse Granot `from` / `to` / zips. Fill city when the lead city is empty. Fill zip when the lead zip is missing (blank or all zeros) **and** the lead state is missing or already matches the candidate state. Fill state when the lead state is missing (`""`, `","`, `not_found`) **and** the lead zip is missing or already equals the candidate zip. If the lead has no `receiver_agent`, fold `user || rep`, find an Agent, and copy the five receiver fields (`id`, name snapshot, `extension_crm_username_match`, folded username, ISO `set_at`). This function does not mutate the live Lead. This function does not call `updateFormLead`. This function does not overwrite a city, zip, state, or receiver that is already set.

There is no third mutate operation. `fillMissing` / `isMissingZip` / `isMissingState` / `statesMatch` / `sameValue` / `serializeExpected` / `countActions` are folds, not public stories. `conflict()` is a leftover unused helper that hardcodes `table_section: "followUpEstimates"`. `clean()` is unused here (the matcher has its own). `granotFormIdentityFields` and the `selectGranotFormFallback` re-export are test compatibility, not a third operation. `invalid` is a counter slot that `planRow` never writes.

## Organization

Keep one file as the screenplay for “match each collected Booked Jobs and Follow Up row to an existing Form Lead, then propose only the missing fields.” HTML parse, Form match, plan seal, durable run lock, approved apply, and Form Lead Correction already live in deeper **modules**. Do not pull those in. Do not invent a `GranotFormWorkflowService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this file does not write Mongo. Do not invent a second matcher **adapter** beside `resolveGranotFormLead`. Do not invent a second receiver **adapter** beside `findAgentByGranotCrmUsername`.

Do not move this into `runWorkflow.ts` so “the run owns the Form plan.” Do not move this into `granotFormLeadMatcher.ts` so “match and patch are one sitting.” Do not move this into `leads/formLead.service.ts` so “the correction write owns the proposal.” Do not split `plan.ts` / `patch.ts` / `create.ts` / `update.ts`. Do not delete leftover `conflict()` / `invalid` / `granotFormIdentityFields` in this rename so “the unused names are cleaner” — CONTRADICTIONS already records them.

**External interface** stays small (this is the test surface). Walk-and-classify and propose-the-missing-fields are one story’s plan, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planGranotFormWorkflow` | `planWhichFormLeadsTheseCollectedRowsWouldCorrect` | `runWorkflow.ts` Form branch; `beforeRow` is the lease/checkpoint hook |
| `buildGranotFormPatch` | `proposeTheMissingFieldsThisRowWouldFillOnThatFormLead` | plan uses it; tests lock fill-if-missing + never-overwrite-receiver |
| `selectGranotFormFallback` | keep as re-export alias | tests still import the matcher fold from this file; next pass owns the matcher |
| `granotFormIdentityFields` | keep as leftover alias | `[AC-03]` locks “no `lid` / `normalized_lid`” on this export; identity lives on the matcher |
| `GranotFormPlan` | `WhichFormLeadsTheseCollectedRowsWouldCorrect` | schema v1 handoff to seal |
| `GranotFormPlanAction` | `WhatThisCollectedRowWouldDoToOneFormLead` | `update` / `unchanged` / `conflict` / `no_match` (+ unused `invalid`) |
| `GranotFormPatch` | `TheMissingFieldsThisRowWouldFill` | quoted / cuft / locations / receiver five-pack |
| `GranotFormWorkflowDependencies` | `HowTheFormPlannerFindsALeadAndAnAgent` | matcher deps + optional `resolveAgent` + `beforeRow` |

Keep the old names as one-line aliases until `runWorkflow.ts` and the tests migrate. Do not make callers learn `planRow` / `fillMissing` / `countActions` as the domain language.

**Principle: old exports stay as aliases.** `planGranotFormWorkflow` and `buildGranotFormPatch` remain the imported names until the run module points at the story names.

**No class for the workflow.** The type that *does* earn a name is the schema-v1 plan we hand the seal sibling:

```ts
type WhichFormLeadsTheseCollectedRowsWouldCorrect = {
  kind: "form_leads"
  schema_version: 1
  actions: Array<{
    action_id: string            // `${sourceLabel}:${row.id}`
    row_id: string
    source_label: string
    table_section: "bookedJobs" | "followUpEstimates"
    classification: "update" | "unchanged" | "conflict" | "no_match"
    match_method?: "ref_no_exact" | "mongo_id" | "fallback" | "none"
    lead_id?: string             // only when found
    patch?: TheMissingFieldsThisRowWouldFill
    expected?: Record<string, unknown>  // live values of changed paths only
    reason?: string
    warnings?: string[]
    // lifecycle_apply is absent until seal
  }>
  counters: {
    update: number
    unchanged: number
    conflict: number
    no_match: number
    invalid: 0                   // leftover slot; do not start writing it
  }
}
```

That is the handoff from “we collected Form-source tables” to “seal every action, then lock the run.” Do **not** add `lifecycle_apply` here so “the planner owns schema 2,” do **not** add `syncable` so “Form matches Call,” and do **not** add a `create` classification so “no_match can become a new Form Lead.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formWorkflow.ts
// We collected Booked Jobs and Follow Up Estimates for some Form sources.
// For each row, find the existing Form Lead — do not create one.
// If we find it, propose only the missing fields:
// quoted and cubic feet when Granot prior is 1 or 5,
// city / zip / state only when the lead is blank and they do not fight,
// a receiver Agent only when the lead has none.
// If nothing would change, say unchanged.
// If we cannot find exactly one lead, say no_match or conflict.
// Hand the plan back at schema version 1.
// This file does not parse HTML. This file does not seal.
// This file does not write a Lead. This file does not capture a receipt.

// ── 1. Plan which Form Leads these collected rows would correct ──

export async function planWhichFormLeadsTheseCollectedRowsWouldCorrect(
  collectedSources,
  { findTheLead, findTheAgent, beforeEachRow } = {},
)

async function sayWhatThisCollectedRowWouldDoToAFormLead(
  sourceLabel,
  row,
  whichTable,
)
function countHowManyRowsLandedInEachClass(actions)

// ── 2. Propose the missing fields this row would fill ──

export async function proposeTheMissingFieldsThisRowWouldFillOnThatFormLead(
  lead,
  row,
  findTheAgent,
)

function markQuotedAndCopyCubicFeetWhenPriorSaysTheEstimateIsReal(row)  // prior 1 or 5
function fillCityZipStateOnlyWhenTheLeadIsBlankAndTheyDoNotFight(lead, row)
function copyTheReceiverFivePackOnlyWhenTheLeadHasNone(lead, row, findTheAgent)

function leftoverConflictActionThatAlwaysSaysFollowUp()  // unused; do not call
```

Read the plan path out loud: *walk Booked Jobs, then Follow Up, for every collected source. Before each row, let the run renew its lease. Ask the matcher who this row is. No lead, or more than one lead, stop that row and keep walking. One lead, propose only the missing fields and compare them to what is already on the lead. Nothing differs, say unchanged. Something differs, say update and remember the live values so apply can see drift later. Count the classes. Hand schema version 1 to the seal sibling. Do not create a Form Lead. Do not write. Do not stamp `lifecycle_apply` here.*

That is the operation. `planGranotFormWorkflow` as a planner verb is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This planner never creates a Form Lead.** Knowledge already says `no_match` / `conflict` only. HANDOFF’s later “Form writes cross `updateFormLead`” is the apply path, not this file. Do not add a `create` classification so “missing WordPress leads get ingested,” and do not call `createFormLead` / `createLeadFromGranot` from here.

2. **Both tables are Form rows.** Call planning maps Follow Up → enrichment and Booked Jobs → booked-reconciliation. This file walks **both** sections with the same match-and-patch. `[AC-33]` locks the `table_section` label. Do not drop Booked Jobs so “Form means Follow Up,” and do not route Booked Jobs through booked-reconciliation so “one table map.”

3. **Schema 1 is the handoff.** This file always emits `schema_version: 1` with no `lifecycle_apply`. Seal attaches the statement and sets 2. Unsealed plans fail apply as `RUN_REPLAN_REQUIRED`. Do not stamp `lifecycle_apply` here so “the planner is already sealed.”

4. **`invalid` is a leftover counter slot.** `countActions` starts `invalid: 0`. `planRow` never writes it. Knowledge already names this. Do not start emitting `invalid` for a bad zip so “the slot is used,” and do not delete the key so “counters match emitted classes.”

5. **Leftover `conflict()` is dead and lies.** It hardcodes `table_section: "followUpEstimates"` and is never called — `planRow` uses the matcher’s `conflict` / `no_match`. Do not start calling it so “one conflict helper,” and do not silently delete it in this rename so CONTRADICTIONS can keep pointing at it.

6. **Identity lives on the matcher.** Exact `ref_no`, then Mongo `_id` when the ref looks like an ObjectId, then same-source phone/email fallback. This file only forwards the row. Tests import `selectGranotFormFallback` and `granotFormIdentityFields` from **this** file. Keep the re-export / leftover constant. Do not move the matcher in, and do not teach this file a second `ref_no` lookup.

7. **HANDOFF forbids `_id`; tests require it.** HANDOFF Safety says never add `_id` / `lid` / `normalized_lid`. `[AC-03]` locks Mongo id after exact `ref_no` miss and locks `lid` off `granotFormIdentityFields`. Do not delete `mongo_id` so HANDOFF “wins,” and do not add `lid` so “identity fields are complete.”

8. **Receiver is a copy, not a stamp.** `proposeTheMissingFields…` folds `user || rep`, finds, and pastes the five fields with an ISO `set_at` when `receiver_agent` is empty. The agents recommendation already says do not dirty the live Lead so “both call apply.” Do not call `stampThisLeadsReceiverFromThatCrmUsername` / `applyGranotCrmUsernameReceiverMatch` from here. Do not overwrite an existing receiver. Do not write `granot_username_match`.

9. **Quoted / cubic feet are prior-gated, then compared.** Prior `1` or `5` always puts `quoted: true` on the proposal. `sameValue` may still classify `unchanged` when the lead is already quoted and cuft matches. Do not skip the quoted write when the lead is already quoted so “the patch is smaller” — `expected` needs the live value if cuft still changes. Do not mark quoted on prior `0`.

10. **Zip and state must not fight.** A zip fills only when the lead zip is missing and the lead state is missing or already matches. A state fills only when the lead state is missing and the lead zip is missing or already equals the candidate zip. All-zero zip is missing. `","` / `not_found` state is missing. Do not overwrite a filled city. Do not fill a zip that would disagree with a present state.

11. **`expected` is the live values of changed paths only.** `undefined` serializes to `null`. Do not snapshot the whole lead. Do not put proposed values in `expected` so “the owner sees the patch twice.”

12. **`beforeRow` is the run’s lease, not this file’s persist.** The Form branch injects it. Direct tests omit it. Do not stamp `GranotAutomationRun.checkpoint` from here so “the planner owns progress.”

13. **`formWorkflow.test.ts` locks the apply gate.** `granotApplyEnabled("true")` is imported from `runWorkflow.ts`. That is the next-but-one module. Do not move the gate here so “Form tests own apply,” and do not delete that test in this rename.

14. **Leave sibling modules alone.** Session collect, Form match, plan seal, durable run lock, approved apply, Form Lead Correction, and receiver stamp are already the right **depth**. This file orchestrates walk → match → propose only.

## Testing

The **interface** is the test surface: `planWhichFormLeadsTheseCollectedRowsWouldCorrect`, `proposeTheMissingFieldsThisRowWouldFillOnThatFormLead`, plus the leftover `selectGranotFormFallback` / `granotFormIdentityFields` aliases until the matcher pass moves those tests.

Today’s `formWorkflow.test.ts` already locks a lot of the matcher through this file’s plan export, plus two patch cases and a misplaced apply-gate check. Keep those. Add the gaps on **this** interface. Inject matcher / agent deps — do not re-test HTML parse or `updateFormLead` here.

**Plan which Form Leads these collected rows would correct**
- Booked Jobs then Follow Up become two actions with distinct `table_section` (already `[AC-33]`; keep it).
- Exact `ref_no` is `ref_no_exact` and must not call fallback (already `[AC-03]`; keep it).
- Duplicate exact refs are `conflict` / `duplicate_exact_ref` and must not fall back (already locked; keep it).
- Mongo id runs only after exact `ref_no` miss (already `[AC-03]`; keep it).
- Fallback after exact miss can still `found` (already locked; keep it).
- Exact match with a source-company mismatch stays `found` and warns (already locked; keep it).
- A found lead whose proposed patch equals the live values is `unchanged` and has no `patch` (add this — today’s exact-ref fixture uses `prior: "0"` and a filled lead, so it is already unchanged, but the test never asserts `classification`).
- A found lead with a real diff is `update`, carries `patch` + `expected` live values, and no `lifecycle_apply` (add this).
- `schema_version` is `1` (add this).
- `counters.invalid` stays `0` when every row classified (add this).
- `beforeRow` runs once per collected row, including `no_match` rows (add this).
- Do not add a test that this function writes a Form Lead, receipt, or `plan_locked_at`.

**Propose the missing fields this row would fill on that Form Lead**
- Prior `5` + `est_cf: "1,250"` sets `quoted: true` and `cubic_feet: 1250`; existing pickup city is left alone; empty pickup zip fills; empty delivery city fills; existing destination zip is left alone; empty receiver copies the five-pack (already locked; keep it).
- An existing `receiver_agent` does not call find (already locked; keep it).
- Prior `0` does not set `quoted` or `cubic_feet` (add this).
- All-zero pickup zip is treated as missing and may fill when the state agrees (add this).
- A present pickup state that disagrees with the candidate state refuses the zip fill (add this).
- `","` / `not_found` delivery state is missing and may fill when the zip agrees or is missing (add this).
- Do not add a test that this function `save`s the Lead, calls `updateFormLead`, or writes `granot_username_match`.

Do **not** add a test per helper (`sayWhatThisCollectedRowWouldDoToAFormLead`, `fillCityZipStateOnlyWhenTheLeadIsBlankAndTheyDoNotFight`, `leftoverConflictActionThatAlwaysSaysFollowUp`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. The two `selectGranotFormFallback` tests may stay until the matcher pass claims them; they are not plan coverage. The `granotApplyEnabled` test may stay until the run-workflow pass; it is not this interface.

Do **not** re-test HTML parse, source-catalog resolve, plan seal, approve, apply, Form Lead Correction write, or receiver stamp persist here.

## What I would not do

- A `GranotFormWorkflowService` class with `plan` / `patch` / `match` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `resolveGranotFormLead` or `Object.fromEntries`.
- Moving this into a CRUD folder (`plan.ts` / `patch.ts` / `create.ts` / `update.ts` / `delete.ts`), or into `runWorkflow.ts` / `granotFormLeadMatcher.ts` / `leads/formLead.service.ts` “for cleanliness.”
- Creating a Form Lead from `no_match`, or calling `createFormLead` / `createLeadFromGranot` / `updateFormLead` from this file.
- Stamping `lifecycle_apply` or setting `schema_version: 2` so “the planner is already sealed.”
- Routing Booked Jobs through booked-reconciliation so “one table map.”
- Calling `stampThisLeadsReceiverFromThatCrmUsername` so “both receiver paths apply.”
- Overwriting a filled city, zip, state, or receiver so “Granot wins.”
- Deleting `mongo_id` so HANDOFF’s “never add `_id`” sentence “wins.”
- Emitting `invalid` or calling leftover `conflict()` so “the unused names work.”
- Teaching `beforeRow` to write `GranotAutomationRun` so “the planner owns the checkpoint.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Form Lead / Granot HTTP collector.
- Writing a whole-folder recommendation for `granotHttpCollector`.
