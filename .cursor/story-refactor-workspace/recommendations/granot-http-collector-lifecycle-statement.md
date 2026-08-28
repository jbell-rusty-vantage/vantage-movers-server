# Seal The Collected Plan As Schema-V2 Lifecycle Evidence — Write The Row As A Granot Statement, Name The Channel Operation, Refuse Schema-V1, Then Tell Whether Approved Apply Is Still Pending — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, in-progress)
- Pass: 6 of this service — `lifecycleStatement.ts`
- Remaining in this service: `runWorkflow.ts`
- Target: `src/services/granotHttpCollector/lifecycleStatement.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — **Plan schema v2**: planners emit `schema_version: 1`; `sealAutomationPlan` then attaches `lifecycle_apply` to **every** collected action and sets schema 2 (`operation_id: \`${run_id}:${action_id}\``, Follow Up → `lead_snapshot_apply`, Booked Jobs → `booking_action_apply` with raw Booked evidence, `granot_statement` = complete collected row, optional `expected_target` when the planner found a Form/Call id). Schema-v1 or unsealed plans fail `assertSealedAutomationPlan` as `RUN_REPLAN_REQUIRED`. Checksum is over the **sealed** plan. `accepted_for_processing` and `pending_match` are pending (do not increment completed progress). [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) Primary code lists this file beside `automationApply.ts` and `runWorkflow.ts` — this file **does not capture or claim**. Distinct from session collect + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from standalone collect/preview: [recommendations/granot-http-collector-automation.md](granot-http-collector-automation.md). Distinct from fail-closed source resolve: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md). Distinct from Form plan + missing-field patch: [recommendations/granot-http-collector-form-workflow.md](granot-http-collector-form-workflow.md). Distinct from Form match: [recommendations/granot-http-collector-form-lead-matcher.md](granot-http-collector-form-lead-matcher.md). Distinct from admin create / plan lock / approve / worker: later `runWorkflow.ts`. Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from collector `user`/`rep` → `granot_crm_username` map: `index.ts` `mapEnrichmentRow` / `mapBookedRow`. Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` **omits this file** from the module map and still says Form writes cross `updateFormLead` — approved apply must not restore that bypass. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / Granot HTTP collector — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **two runtime import sites + type-only + the test file.** Seal + refuse + completion: `runWorkflow.ts` seals after Form/Call plan and before checksum (`sealAutomationPlan(planned, runId, collection.sources)`); `assertSealedAutomationPlan` on approve and again on `applyRun`; `isTerminalAutomationActionOutcome` / `isPendingAutomationActionOutcome` skip finished receipts, increment completed progress only when a pending stored receipt becomes terminal, and yield the account lease on pending; `automationRunCompletionStatus` names `applying` / `completed` / `completed_with_errors` after the selected-action loop. Pending remap: `granotLifecycle/automationApply.ts` imports only `isPendingAutomationActionOutcome` (processed `pending_match` → run `accepted_for_processing`) and **reprints** the terminal check locally as `isTerminalStoredReceipt`. Type-only: `formWorkflow.ts` imports `GranotAutomationLifecycleApply` / `GranotTableSection` for the plan action shape. Tests: `lifecycleStatement.test.ts` (`[AC-33]` Follow Up / Booked statement shape; `[AC-02]` oversized operation id and schema-v1 refuse; sealing a collected Form plan stores schema 2 before checksum; pending outcomes keep the run applying). Not callers: `index.ts`, `automation.ts`, `sourceCatalog.ts`, `granotFormLeadMatcher.ts`, public Form/Call write, CSV sync, `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`, `captureChannelOperationReceipt`, `claimAndProcessOrPoll`. `runWorkflow.test.ts` does **not** import this file (it locks the no-legacy-mutation scan and a schema-v1 fixture shape).
- Seams callers need: write-the-statement vs seal-the-whole-plan; Form find (`source_label` + `row_id`) vs Call find (mapped `${sourceLabel}:${entry.id}` === `action.row.row_id`); Follow Up `lead_snapshot_apply` vs Booked Jobs `booking_action_apply`; optional `expected_target` vs omit; sealed schema 2 vs refuse v1 (`RUN_REPLAN_REQUIRED`); pending (`accepted_for_processing` / `pending_match`) vs terminal (everything else, including `technical_failure`); plan seal (this file) vs checksum / lease / approve / capture (siblings)
- Split later (only if the file outgrows one sitting): keep one file — this ~345-line module is one screenplay for “seal the collected plan as schema-v2 lifecycle evidence, then later tell whether approved apply is still pending.” If it later splits: `writeTheCollectedRowAsALifecycleStatement.ts` / `sealTheCollectedPlanAsSchemaV2LifecycleEvidence.ts` / `tellWhetherThisApprovedRunIsStillApplying.ts` — story files, never `seal.ts` / `statement.ts` / `completion.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge HTML parse, Form match, missing-field patch, durable run lock, checksum, approve, capture, or claim into this file

`sealAutomationPlan` / `buildLifecycleApply` / `buildGranotStatementFromCollectedRow` are executor mechanics. The owner question is: *The Form or Call planner just handed us a schema-v1 list of actions and we still have the collected Granot tables. Before anyone checksums or approves, write each collected row as a credential-safe Granot statement, name the channel operation `${run_id}:${action_id}`, stamp Follow Up as a lead snapshot and Booked Jobs as a booking action with raw Booked evidence, and lock that evidence onto every action as schema 2. If a planned action can no longer find its collected row, refuse — do not invent a statement. Later, when approved apply is walking receipts, say whether the run is still applying, finished, or finished with errors. This file does not collect HTML. This file does not plan a patch. This file does not checksum. This file does not capture a receipt. This file does not write a Lead.*

Session collect, Form match, Form plan, Call preview, durable run lock, checksum, approve, capture, and claim already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “seal the collected plan as schema-v2 lifecycle evidence, then later tell whether approved apply is still pending” story, not “a plan CRUD service,” and not the apply capture:

1. **Write the collected Granot row as a lifecycle statement** — copy the known raw passthrough keys (`job_no`, `ref_no`, `phone`, `email`, `user`, `rep`, `prior`, `customer`, addresses, `est_cf`, `type`, `move_date`, `service`, money, `book_date`, …), then any other finite scalar the row still has. Fold aliases: `source` from the row or the collected label; `priority` from `prior` then `priority`; `customer_name` from `customer` then `customer_name`. Parse `from` / `to` into city/state; keep zip via `parseGranotZip` or the raw zip. Booked Jobs stamp `event_type: "Booked"`. Follow Up leaves `event_type` off. Drop `granot_crm_username` after the copy. Drop credential-like keys, control/bidi text, keys longer than 64, values longer than 300, and non-finite numbers. Collapse `nbsp` / whitespace. This function does not name an operation id. This function does not write Mongo.

2. **Seal the collected plan as schema-v2 lifecycle evidence** — for every planned action, find the collected row again. Form: the source whose label equals `source_label`, then that section’s row whose `id` equals `row_id` (`table_section` or infer Booked Jobs vs Follow Up by which table still has the id). Call: Booked Jobs when `operation === "booked_reconciliation"` or `table_section === "bookedJobs"`, else Follow Up; then search every source for `${sourceLabel}:${entry.id}` equal to `action.row.row_id`. Missing row → `GranotRunConflict` / `RUN_REPLAN_REQUIRED`. Found row → name `${runId}:${actionId}`, refuse an unsafe id (`assertChannelOperationId` for `granot_http_automation`, remapped to `UNSAFE_OPERATION_ID`), pick `lead_snapshot_apply` or `booking_action_apply` from the section, write the statement, and attach optional `expected_target` (Form `lead_id` → `{ model: "FormLead", id }`; Call `target_binding.call_lead_id` → `{ model: "CallLead", id }`; otherwise omit). Stamp `schema_version: 2` and `table_section`. Seal **every** action, including `no_match` / `conflict` / `unchanged`. This function does not checksum. This function does not capture a receipt.

3. **Tell whether this approved run is still applying** — `accepted_for_processing` and `pending_match` are pending. Everything else is terminal, including `technical_failure`. A selected action with no receipt, or a pending receipt, keeps the run `applying`. Once every selected action is terminal, any `technical_failure` makes `completed_with_errors`; otherwise `completed`. `isSealedAutomationPlan` / `assertSealedAutomationPlan` are the refuse **seam** for approve and apply: schema must be 2, every action must carry `lifecycle_apply`, the stored `operation_id` must rebuild as `${prefixBeforeFirstColon}:${action_id}`, and `granot_statement` must be an object. Schema-v1 cannot be reconstructed.

There is no fourth mutate operation. `buildLifecycleApply` / `buildAutomationOperationId` / `assertSafeAutomationOperationId` / `resolveAutomationOperationKind` are beats of seal. `assignStatementValue` / `findCollectedRow` / `expectedTargetFor` are folds, not public stories.

## Organization

Keep one file as the screenplay for “seal the collected plan as schema-v2 lifecycle evidence, then later tell whether approved apply is still pending.” HTML parse, Form match, missing-field patch, Call preview, durable run lock, checksum, approve, capture, and claim already live in deeper **modules**. Do not pull those in. Do not invent a `LifecycleStatementService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this file does not write Mongo. Do not invent a second channel-id **adapter** beside `assertChannelOperationId`. Do not invent a second statement-redaction **adapter** beside `resolveForbiddenCredentialKey` plus the local credential-like fold.

Do not move this into `runWorkflow.ts` so “seal lives with the lock.” Do not move this into `automationApply.ts` so “the apply item is built where it is captured.” Do not move this into `formWorkflow.ts` so “plan and seal are one sitting.” Do not split `seal.ts` / `statement.ts` / `completion.ts` / `create.ts`. Do not rewrite HANDOFF so this file “finally appears on the module map.”

**External interface** stays small (this is the test surface). Write-the-statement, seal-the-plan, and tell-whether-applying are one story’s lock and later status, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildGranotStatementFromCollectedRow` | `writeTheCollectedRowAsALifecycleStatement` | `[AC-33]` tests; seal uses it |
| `buildAutomationOperationId` | `nameThisApprovedActionAsAChannelOperation` | `${run_id}:${action_id}`; apply capture reads the sealed copy |
| `assertSafeAutomationOperationId` | `refuseAnUnsafeAutomationOperationId` | `[AC-02]` before plan lock |
| `resolveAutomationOperationKind` | `nameTheChannelOperationFromTheTableSection` | Follow Up vs Booked Jobs |
| `buildLifecycleApply` | `attachLifecycleEvidenceToThisPlannedAction` | seal + `[AC-33]` Booked tests |
| `sealAutomationPlan` | `sealTheCollectedPlanAsSchemaV2LifecycleEvidence` | `runWorkflow` after plan, before checksum |
| `isSealedAutomationPlan` | `thisPlanAlreadyCarriesSchemaV2LifecycleEvidence` | assert + tests |
| `assertSealedAutomationPlan` | `refuseAnUnsealedOrSchemaV1Plan` | approve + `applyRun` |
| `isPendingAutomationActionOutcome` | `thisApprovedActionIsStillWaitingOnTheProcessor` | apply loop + `automationApply` remap |
| `isTerminalAutomationActionOutcome` | `thisApprovedActionHasAFinalOutcome` | apply loop skip / progress |
| `automationRunCompletionStatus` | `tellWhetherThisApprovedRunIsStillApplying` | `applyRun` after the selected-action loop |
| `GranotAutomationLifecycleApply` | `TheSealedLifecycleEvidenceForThisAction` | alias of `GranotApplyItem` |
| `SealableAutomationPlan` | `APlannedWorkflowWeCanSeal` | Form or Call schema-v1 list + counters |
| `GranotTableSection` | `WhichGranotTableThisRowCameFrom` | `bookedJobs` \| `followUpEstimates` |

Keep the old names as one-line aliases until `runWorkflow.ts` and `automationApply.ts` migrate. Do not make callers learn `findCollectedRow` / `expectedTargetFor` / `assignStatementValue` / `RAW_PASSTHROUGH_KEYS` as the domain language.

**Principle: old exports stay as aliases.** `sealAutomationPlan`, `assertSealedAutomationPlan`, and the pending/terminal helpers remain the imported names until the run worker and apply remap point at the story names.

**No class for the workflow.** The type that *does* earn a name is the sealed evidence we lock onto each action before checksum:

```ts
type TheSealedLifecycleEvidenceForThisAction = {
  operation_id: string            // `${run_id}:${action_id}`
  operation_kind: "lead_snapshot_apply" | "booking_action_apply"
  granot_statement: Record<string, string | number | null>
  expected_target?: { model: "FormLead" | "CallLead"; id: string }
}
```

That is the handoff from “we still have the collected tables” to “checksum, approve, and later capture this exact statement.” Do **not** put `patch` / `quoted` / `preview` on this object so “seal owns the proposal,” do **not** add `event_type: "Released"` so “Booked Jobs can mean Release,” and do **not** keep `granot_crm_username` so “the statement matches the Call preview row.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// lifecycleStatement.ts
// The Form or Call planner just handed us a schema-v1 list of actions.
// We still have the collected Granot tables.
// Before anyone checksums or approves, write each collected row
// as a credential-safe Granot statement, name the channel operation,
// and lock that evidence onto every action as schema 2.
// If a planned action can no longer find its collected row, refuse.
// Later, when approved apply is walking receipts,
// say whether the run is still applying, finished, or finished with errors.
// This file does not collect HTML. This file does not plan a patch.
// This file does not checksum. This file does not capture a receipt.
// This file does not write a Lead.

// ── 1. Write the collected Granot row as a lifecycle statement ──

export function writeTheCollectedRowAsALifecycleStatement({
  row,
  sourceLabel,
  section,
})

function copyTheRawPassthroughKeysThenTheRestOfTheScalars(values)
function foldSourcePriorityAndCustomerName(values, sourceLabel)
function parseCityStateAndZipAliases(values)
function stampBookedOnlyWhenThisRowCameFromBookedJobs(section)
function dropGranotCrmUsernameAndCredentialLikeKeys(statement)

// ── 2. Seal the collected plan as schema-v2 lifecycle evidence ──

export function sealTheCollectedPlanAsSchemaV2LifecycleEvidence(
  plan,
  runId,
  collectedSources,
)

export function attachLifecycleEvidenceToThisPlannedAction({
  runId,
  actionId,
  row,
  sourceLabel,
  section,
  expectedTarget,
})

export function nameThisApprovedActionAsAChannelOperation(runId, actionId)
export function refuseAnUnsafeAutomationOperationId(operationId)
export function nameTheChannelOperationFromTheTableSection(section)

function findTheCollectedRowThisPlannedActionStillOwns(sources, action, kind)
function findTheFormRowBySourceLabelAndRowId(sources, action)
function findTheCallRowByMappedSourceAndRowId(sources, action)
function inferFormSectionFromWhicheverTableStillHasTheId(source, rowId)
function expectedTargetWhenThePlannerAlreadyNamedALead(action, kind)
function refuseWhenTheCollectedRowIsGone()                 // RUN_REPLAN_REQUIRED

export function thisPlanAlreadyCarriesSchemaV2LifecycleEvidence(plan)
export function refuseAnUnsealedOrSchemaV1Plan(plan)

// ── 3. Tell whether this approved run is still applying ──

export function thisApprovedActionIsStillWaitingOnTheProcessor(outcome)
export function thisApprovedActionHasAFinalOutcome(outcome)  // !pending
export function tellWhetherThisApprovedRunIsStillApplying(
  receipts,
  selectedActionIds,
)
```

Read the seal path out loud: *take the schema-v1 plan. For every action, find the collected row again — Form by source label and row id, Call by the mapped `${source}:${id}` the row mapper already stamped. Missing row, refuse and do not invent a statement. Found row: name `${run}:${action}`, refuse an unsafe id, call Follow Up a lead snapshot and Booked Jobs a booking action, write the credential-safe statement with raw Booked evidence and separate user/rep, attach the planner’s Form or Call id only when it already has one, and lock that onto the action. Stamp schema 2. Checksum happens after this file. Approve and apply refuse anything still on schema 1. Later, pending receipts keep the run applying; a technical failure among finished receipts is completed with errors.*

That is the operation. `sealAutomationPlan` as a schema-version bump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Seal every action, not only the approvable ones.** Knowledge already says `lifecycle_apply` attaches to every collected action. Approve later selects Form `update` / Call `syncable` only. Unselected actions create no receipt. Do not skip sealing `no_match` / `conflict` / `unchanged` so “only writable rows get evidence,” and do not capture those rows from this file.

2. **Schema-v1 cannot be reconstructed.** `[AC-02]` locks `RUN_REPLAN_REQUIRED`. Do not upgrade a stored v1 plan in place so “old approvals still work,” and do not invent a second error code for “missing `lifecycle_apply` on an otherwise v2 plan” — `applyRun` already throws the same `RUN_REPLAN_REQUIRED` when a selected action lost the block.

3. **Booked Jobs are raw Booked evidence. This file does not infer Release.** `[AC-33]` locks `event_type: "Booked"` and “does not infer Release.” Follow Up leaves `event_type` off. Do not stamp `Released` from a missing `book_date` or a later cancellation hint so “the statement tells the whole story.”

4. **`user` and `rep` stay separate on the statement; `granot_crm_username` is deleted.** Collector `mapEnrichmentRow` / `mapBookedRow` collapse `user || rep` into `granot_crm_username` for Call preview. The statement keeps both raw columns and deletes the collapsed key. Do not collapse `user`/`rep` here so “preview and statement match,” and do not put `granot_crm_username` back so “the processor can find the Agent the same way the preview did.”

5. **Form find and Call find are two adapters, not one row lookup.** Form uses `source_label` + `row_id` (the HTML row id). Call uses the mapped payload `row.row_id` already shaped as `${sourceLabel}:${entry.id}`. Do not teach Form to read `action.row.row_id`, and do not teach Call to use `action.row_id` so “one finder.”

6. **`expected_target` is a preview id the planner already had, or it is omitted.** Conflict / no_match Form actions have no `lead_id`. Call actions without `target_binding.call_lead_id` omit the target. Do not invent a target from `job_no` / `ref_no` so “every sealed action names a Lead.”

7. **The sealed-id check splits on the first colon.** `isSealedAutomationPlan` rebuilds `${prefixBeforeFirstColon}:${action_id}`. That works because `run_id` is a Mongo ObjectId (no colon) and `action_id` often contains colons (`Synthetic Forms:row-1`, `booked_reconciliation:…`). Do not split on the last colon so “action_id looks cleaner,” and do not require `run_id` to be ObjectId-shaped here — `isAutomationOperationId` already allows any nonempty parts.

8. **Terminal means not pending.** `isTerminalAutomationActionOutcome` is `!isPending`. Unknown outcomes complete the run. Do not whitelist `applied` / `already_current` / `technical_failure` so “only known Decisions finish,” and do not treat `technical_failure` as pending so “errors keep applying.”

9. **`automationApply.ts` reprints the terminal check.** CONTRADICTIONS already records `isTerminalStoredReceipt` as a paste of this helper. This file already exports `isTerminalAutomationActionOutcome`. Do not invent a third “is done?” in `identity.ts`. Call this helper or keep the local fold next to the remap — do not silently change what counts as terminal (`technical_failure` is terminal; `pending_match` is not).

10. **Redaction is silent drop, not a throw.** Oversized keys/values, control/bidi, and credential-like keys are skipped. Only an unsafe **operation id** becomes `UNSAFE_OPERATION_ID`. Do not throw on a bad statement key so “the owner sees the redaction,” and do not log the dropped value.

11. **HANDOFF omits this file and still describes the old Form write.** The module map jumps from `formWorkflow.ts` to `runWorkflow.ts`. Safety still says Form writes cross `updateFormLead`. Approved apply must not restore that bypass. Do not silently rewrite HANDOFF so the story “owns the folder note.”

12. **Knowledge `automation-apply.md` lists this file as Primary code beside capture.** This file does not insert a receipt and does not call `claimAndProcessOrPoll`. Do not move capture here so the Primary-code line “wins.”

13. **Leave sibling modules alone.** Session collect, Form match, Form plan, Call preview, durable run lock, checksum, approve, capture, and claim are already the right **depth**. This file orchestrates statement → seal → sealed-or-refuse → pending-or-done only.

## Testing

The **interface** is the test surface: `writeTheCollectedRowAsALifecycleStatement`, `sealTheCollectedPlanAsSchemaV2LifecycleEvidence`, `refuseAnUnsealedOrSchemaV1Plan`, `tellWhetherThisApprovedRunIsStillApplying`. Today those tests live on `lifecycleStatement.test.ts`. Keep them. Claim the story names on this **interface**. Do not re-test HTML parse, Form match, missing-field patch, checksum, approve, capture, or `updateFormLead` here.

**Write the collected Granot row as a lifecycle statement**
- Form Follow Up keeps raw Priority, separate `user`/`rep`, location aliases, and no `event_type` (already `[AC-33]`; keep it).
- Form Booked is `booking_action_apply` with `event_type: "Booked"` (already `[AC-33]`; keep it).
- Call enrichment does not collapse `user`/`rep` (already `[AC-33]`; keep it).
- Call Booked keeps raw Booked and does not infer Release (already `[AC-33]`; keep it).
- `granot_crm_username` is absent even when the row mapper would have collapsed `user`/`rep` (add this — today’s tests only assert `undefined` on a row that never had the key).
- A credential-like key (`authorization`, `api_key`) is dropped and does not throw (add this).
- Control / bidi text is dropped (add this).
- A key longer than 64 or a value longer than 300 is dropped (add this).

**Seal the collected plan as schema-v2 lifecycle evidence**
- Sealing a collected Form plan stores schema 2, `lead_snapshot_apply`, and `expected_target` before checksum (already `[AC-02]`; keep it).
- Oversized `${run_id}:${action_id}` is `UNSAFE_OPERATION_ID` before plan lock (already `[AC-02]`; keep it).
- Schema-v1 fails closed as `RUN_REPLAN_REQUIRED` (already `[AC-02]`; keep it).
- Missing collected row is `RUN_REPLAN_REQUIRED` and must not invent a statement (add this).
- A Call booked-reconciliation action finds the row by mapped `${sourceLabel}:${entry.id}` (add this — today’s seal test is Form-only).
- A Form Booked action without `table_section` still infers `bookedJobs` when that table has the id (add this).
- `no_match` / `conflict` still receive `lifecycle_apply` and omit `expected_target` (add this).
- Call `expected_target` comes from `target_binding.call_lead_id`, not from `lead_id` (add this).
- A sealed plan whose `operation_id` prefix does not rebuild with `action_id` is not sealed (add this).
- Do not add a test that this function writes a receipt, Lead, or checksum.

**Tell whether this approved run is still applying**
- `accepted_for_processing` / `pending_match` keep the run `applying` (already locked; keep it).
- A terminal `already_current` is `completed` (already locked; keep it).
- `technical_failure` is `completed_with_errors` (already locked; keep it).
- A selected action with no receipt is `applying` (add this).
- Mixed terminal + pending selected receipts stay `applying` (add this).
- `thisApprovedActionHasAFinalOutcome("pending_match")` is false; `"technical_failure"` is true (add this — today’s tests never call the terminal helper).
- Do not add a test that this function yields the account lease or increments run progress — those beats stay on `runWorkflow.ts`.

Do **not** add a test per helper (`copyTheRawPassthroughKeysThenTheRestOfTheScalars`, `findTheCallRowByMappedSourceAndRowId`, `stampBookedOnlyWhenThisRowCameFromBookedJobs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. Checksum / approve / capture / no-legacy-mutation tests stay on `runWorkflow.test.ts` / `automationApply.test.ts`; they are not this **interface**.

Do **not** re-test HTML parse, Form match, missing-field patch, Call preview, durable lease, `GRANOT_AUTOMATION_APPLY_ENABLED`, or Form Lead Correction write here.

## What I would not do

- A `LifecycleStatementService` class with `seal` / `build` / `complete` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `assertChannelOperationId` or `parseGranotCityState`.
- Moving this into a CRUD folder (`seal.ts` / `statement.ts` / `completion.ts` / `create.ts` / `update.ts` / `delete.ts`), or into `runWorkflow.ts` / `automationApply.ts` / `formWorkflow.ts` “for cleanliness.”
- Capturing a `granot_http_automation` receipt, calling `claimAndProcessOrPoll`, or writing a Lead / Booking from this file.
- Calling `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation` so HANDOFF’s old Form-write sentence “wins.”
- Upgrading a stored schema-v1 plan in place so “old approvals still work.”
- Stamping `event_type: "Released"` so “Booked Jobs can mean Release.”
- Collapsing `user`/`rep` into `granot_crm_username` so “the statement matches the Call preview row.”
- Unifying Form and Call row find so “one lookup.”
- Inventing `expected_target` from `job_no` / `ref_no` so “every sealed action names a Lead.”
- Splitting `operation_id` on the last colon so “action_id looks cleaner.”
- Inventing a third terminal check, or treating `technical_failure` as pending.
- Silently rewriting HANDOFF so this file “finally appears on the module map.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Granot Observation Receipt / Observation Channel.
- Writing a whole-folder recommendation for `granotHttpCollector`.
