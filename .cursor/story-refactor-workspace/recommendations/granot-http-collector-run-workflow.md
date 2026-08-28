# Queue The Durable Granot Automation Run, Collect And Lock The Sealed Plan, Let The Owner Approve Selected Actions, Then Walk Those Actions Into Lifecycle Capture — Never Write A Lead From Here — operational story

- Status: recommended
- Service: `granotHttpCollector` (Wave A, visited)
- Pass: 7 of this service — `runWorkflow.ts`
- Remaining in this service: none (`errors.ts` already skipped)
- Target: `src/services/granotHttpCollector/runWorkflow.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) — **Admin runs live here.** Preview completes at plan lock (no approval, no receipt). Apply with any approvable action waits at `awaiting_approval`; owner approval of selected ids + matching checksum + `GRANOT_AUTOMATION_APPLY_ENABLED` then walks `applyAutomationPlanAction` (skip terminal receipts; pending yields the account lease). Account lease `granot:automation:account` 45 minutes; approved `applying` precedes queued/planning. Provider `provider_error` / `invalid_session` requeues while `attempt_count < 3`. Plan TTL 24h; `purge_at` 7 days. Checksum is `computeChecksum` over the **sealed** plan (`checksum_version: 1`, `artifact_kind: "ingestion_plan"` — the envelope still says `schema_version: 1`; the plan itself is schema 2). **Known gap:** `createGranotRun` with `source_labels` only does **not** call `resolveGranotAutomationSources`. `publishGranotWakeup` returns true only on Vercel and the hosted `NODE_ENV` gate (same rule as the knowledge doc); otherwise false (no throw). Non-Vercel create / run-group / approve then call `runGranotWorker` inline. Cron `/api/cron/granot-automation-heartbeat` → `recoverGranotRuns` (503 when recoverable but no publish). Queue topic `granot-automation-events` → `runGranotWorker` then `continueGranotRuns`. Distinct from session collect + row map: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from standalone collect/preview (no run document): [recommendations/granot-http-collector-automation.md](granot-http-collector-automation.md). Distinct from fail-closed source resolve: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md). Distinct from Form plan + missing-field patch: [recommendations/granot-http-collector-form-workflow.md](granot-http-collector-form-workflow.md). Distinct from Form match: [recommendations/granot-http-collector-form-lead-matcher.md](granot-http-collector-form-lead-matcher.md). Distinct from plan seal / pending-or-done: [recommendations/granot-http-collector-lifecycle-statement.md](granot-http-collector-lifecycle-statement.md). Distinct from approved apply (receipt + `claimAndProcessOrPoll`): [`docs/knowledge/granot-lifecycle/automation-apply.md`](../../../docs/knowledge/granot-lifecycle/automation-apply.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) — knowledge Primary code lists **this file** beside capture; this file **does not insert a receipt**. Distinct from Call Lead Enrichment write / Booked Call Lead Reconciliation write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Distinct from receiver stamp: [recommendations/agents-receiver-agent-crm-username.md](agents-receiver-agent-crm-username.md). Software map: `.cursor/rules/granot-http-automation.mdc`. Folder note: `src/services/granotHttpCollector/HANDOFF.md` calls this “durable create/plan/approve/apply/recovery interface” and still says Form writes cross `updateFormLead`. `[AC-02]` already forbids those imports. Approved apply must not restore that bypass. Do not silently rewrite HANDOFF so the story “owns the folder note.” This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / Granot HTTP collector — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three runtime import sites + two test files + a misplaced apply-gate lock.** Admin HTTP: `routes/granot-automation.routes.ts` (`requireApiSecret` + `requireRegistryOwnerActor`) — `POST /runs` → `createGranotRun` then local `runGranotWorker` when the wakeup did not publish; `POST /run-groups` → `createGranotRunGroup` then one local worker per child; `GET /runs` → `listGranotRuns`; `GET /runs/:runId` → `getGranotRun` (`details=owner` is the redacted-plan **seam**); `POST /runs/:runId/approve` → `approveGranotRun` then local worker; `POST /runs/worker` → `recoverGranotRuns` or `runGranotWorker`. Cron: `routes/granot-automation-cron.routes.ts` `recoverGranotRuns` (503 when leftover work exists and publish failed). Queue: `api/queues/granot-automation-consumer.ts` `runGranotWorker` then `continueGranotRuns(result.run_id)` (`lease_busy` ACKs). Tests: `runWorkflow.test.ts` (run-group insert-before-wakeup + validation-before-insert; Call preview ObjectId durability; leftover `buildFormExpectedFilter`; `[AC-02]` no-legacy-mutation source scan). `granot-automation.routes.test.ts` (admin contract + `[AC-35]` redaction source scan + consumer continuation). Misplaced: `formWorkflow.test.ts` locks `granotApplyEnabled` from this file. Not callers: `index.ts` (this file imports collect + row map), `automation.ts`, `sourceCatalog.ts` (this file imports resolve), `formWorkflow.ts` (this file imports Form plan), `granotFormLeadMatcher.ts`, `lifecycleStatement.ts` (this file imports seal / refuse / pending / completion), `granotLifecycle/automationApply.ts` (this file imports apply), public Form/Call write, CSV sync, `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`, `captureChannelOperationReceipt`, `claimAndProcessOrPoll`.
- Seams callers need: `source_ids` fail-closed vs label-only `createGranotRun` (known gap — leave it); one run vs run group (validate both partitions, insert together, then wakeup); Vercel wakeup vs local inline worker; preview completes at plan lock vs apply waits for owner approval; Form plan (sibling) vs Call plan (this file); seal (sibling) vs checksum / immutable lock (this file); owner approve vs worker walk; pending yield vs terminal complete / complete-with-errors; recover (cron) vs continue (after a claimed run) — same leftover query, different wakeup reason; apply capture (sibling) vs this file’s selected-action loop
- Split later (only if the file outgrows one sitting): this ~1140-line module is one screenplay for “queue the durable run, collect and lock the sealed plan, let the owner approve selected actions, then walk those actions into lifecycle capture.” If it later splits: `queueTheDurableGranotAutomationRun.ts` / `collectTheTablesAndLockTheSealedPlan.ts` / `approveSelectedActionsOnTheSealedApplyPlan.ts` / `walkSelectedActionsIntoLifecycleCapture.ts` / `claimTheAccountAndWakeLeftoverQueuedWork.ts` — story files, never `create.ts` / `plan.ts` / `approve.ts` / `apply.ts` / `update.ts` / `delete.ts`, and never merge HTML parse, Form match, missing-field patch, statement seal, source-catalog resolve, or receipt capture into this file

`createGranotRun` / `planRun` / `approveGranotRun` / `applyRun` / `runGranotWorker` are executor mechanics. The owner question is: *The owner asked for a durable Granot automation run — Form, Call, or both as a correlated group. Queue the documents. When the worker claims the account, collect the tables, plan Form or Call, seal every action as schema 2, checksum, and lock. Preview finishes there. Apply waits until the owner approves selected update/syncable actions against that checksum, then walks those selected actions into lifecycle capture — one receipt each — and yields when the processor is still pending. Recover and continue are just wake-ups for leftover queued work. This file does not write a Lead. This file does not insert a receipt. This file does not parse HTML.*

Session collect, Form match, Form plan, plan seal, source-catalog resolve, and approved apply already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “queue the durable run, lock the sealed plan, approve selected actions, then walk them into lifecycle capture” story, not “a Granot run CRUD service,” and not the apply capture:

1. **Queue a durable Granot automation run** — persist one `queued` `GranotAutomationRun`, or a one-or-two-run group that shares `run_group_id`. Single create: when `sourceIds` is present, fail-closed resolve then store the returned ids and labels; when only labels arrived, store those labels and skip resolve (known gap). Group: refuse zero, more than two, or duplicate operations; always resolve; insert every child in one transaction; then publish a wakeup per child. A failed wakeup must not roll back the queued documents. This function does not collect HTML. This function does not plan.

2. **Collect the tables and lock the sealed plan** — under the fenced account lease, collect the requested tables (renew + checkpoint per source), then plan. Form: sibling `planGranotFormWorkflow`. Call: this file walks mapped Follow Up rows through `previewCallLeadEnrichment` and Booked Jobs rows through `previewBookedCallLeadReconciliation`, one row at a time, and binds the Call Lead / Booking / receiver Agent the preview already named (`syncable` = `updateable` **or** a `target_receiver_agent`). Seal the schema-v1 list as schema 2. Refuse duplicate `action_id`s. Checksum the **sealed** plan. Lock `plan_snapshot` / `plan_checksum` / `plan_locked_at` once. Preview, or apply with no approvable action, becomes `completed`. Apply with any Form `update` / Call `syncable` becomes `awaiting_approval`. This function does not capture a receipt.

3. **Approve selected actions on the sealed apply plan** — refuse unless `GRANOT_AUTOMATION_APPLY_ENABLED` is the string `true`. Load an unexpired `awaiting_approval` apply run whose stored checksum matches. Refuse an unsealed or schema-v1 plan. Selected ids must be unique and a subset of the approvable ids (Form `classification === "update"`; Call `syncable`). CAS `awaiting_approval` → `applying`, stamp the approval bag, clear the run lease, publish an approval wakeup. Lost CAS is `APPROVAL_RACE`. This function does not walk actions.

4. **Walk selected actions into lifecycle capture** — refuse unless the apply gate is still on. Reload the fenced applying run. Refuse drift (missing plan / checksum / approval, unsealed plan, approval checksum ≠ run checksum). Skip a selected action that already has a terminal run receipt. A selected action missing `lifecycle_apply` is `RUN_REPLAN_REQUIRED`. Otherwise renew the lease and call `applyAutomationPlanAction` with the sealed block and `approved_by`. Idempotency conflict becomes a local `technical_failure` receipt. Pending outcomes yield the account lease and leave status `applying`. When every selected action is terminal, `technical_failure` among them is `completed_with_errors`; otherwise `completed`. Unselected actions create no receipt. This function does not insert the Observation Receipt itself.

5. **Claim the account, wake leftover queued work, and show a redacted run** — the worker acquires `granot:automation:account` (45 minutes), expires stale `awaiting_approval`, prefers `applying` over queued/planning, then runs collect-and-lock or walk-into-capture. Transient Granot `provider_error` / `invalid_session` requeues while `attempt_count < 3`; other failures are structural `failed`. Recover (cron) and continue (after a claimed run) ask the same leftover-work question and publish different wakeup reasons. List/get never echo `granot_statement` or receipt payloads; owner `details=owner` still redacts the statement and keeps lifecycle ids. This function does not collect HTML.

There is no sixth mutate operation. `planCallWorkflow` / `buildCallTargetBinding` are beats of collect-and-lock. `publishGranotWakeup` / `granotApplyEnabled` / `toDurableGranotValue` are adapters, not public stories. `buildFormExpectedFilter` is a leftover from the old Form write — not a story.

## Organization

Keep one file as the screenplay for “queue the durable run, collect and lock the sealed plan, let the owner approve selected actions, then walk those actions into lifecycle capture.” HTML parse, Form match, missing-field patch, statement seal, source-catalog resolve, and receipt capture already live in deeper **modules**. Do not pull those in. Do not invent a `GranotRunWorkflowService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the durable boundary is the run document plus the fenced account lease, not a domain-command transaction (the run-group insert is the one Mongo transaction). Do not invent a second apply-capture **adapter** beside `applyAutomationPlanAction`. Do not invent a second seal **adapter** beside `sealAutomationPlan`.

Do not move this into `automation.ts` so “preview and the run are one sitting.” Do not move this into `lifecycleStatement.ts` so “seal lives with the lock.” Do not move this into `automationApply.ts` so “the loop lives with capture.” Do not move Call plan into `formWorkflow.ts` so “one planner.” Do not split `create.ts` / `plan.ts` / `approve.ts` / `apply.ts`. Do not silently close the label-only create gap. Do not silently rewrite HANDOFF so the old Form-write sentence disappears.

**External interface** stays small (this is the test surface). Queue, lock, approve, walk, and claim-or-show are one story’s durable run, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotRun` | `queueADurableGranotAutomationRun` | single-operation admin create; label-only compatibility path |
| `createGranotRunGroup` | `queueCorrelatedFormAndCallRunsFromTheSameSubmission` | one owner submit → one or two child runs; injectable runtime |
| `approveGranotRun` | `approveSelectedActionsOnTheSealedApplyPlan` | owner checksum + selected ids; CAS to applying |
| `runGranotWorker` | `claimTheAccountAndDoTheNextRun` | queue consumer + local inline worker + admin execute |
| `getGranotRun` | `showThisRedactedGranotAutomationRun` | default vs `details=owner` |
| `listGranotRuns` | `listRecentRedactedGranotAutomationRuns` | last 1–100 |
| `recoverGranotRuns` | `wakeTheNextLeftoverQueuedOrLeasedRun` | cron + admin recover |
| `continueGranotRuns` | `wakeTheNextLeftoverRunAfterThisOneFinished` | consumer after a claimed run |
| `publishGranotWakeup` | `publishAGranotAutomationWakeupIfThisHostMay` | Vercel plus the hosted `NODE_ENV` gate; create / approval / recovery / continuation |
| `granotApplyEnabled` | `theOwnerHasTurnedOnApprovedApply` | approve + apply refuse; `formWorkflow.test.ts` still locks it |
| `toDurableGranotValue` | `makeThisCallPreviewSafeToChecksum` | ObjectId / Date / drop `undefined`; Call plan + its test |
| `buildFormExpectedFilter` | *(leave as leftover alias — do not promote)* | old expected-value Form write; test-only |
| `GRANOT_AUTOMATION_TOPIC` | `theGranotAutomationWakeupTopic` | `granot-automation-events` |
| `GranotRunConflict` | `ThisGranotRunCannotContinue` | re-export from `errors.ts` |
| `GranotRunGroupRuntime` | `HowThisRunGroupResolvesInsertsAndWakes` | test / default adapters |

Keep the old names as one-line aliases until the admin routes, cron, and queue consumer migrate. Do not make callers learn `fenced` / `checkpoint` / `planCallWorkflow` / `readCredentials` as the domain language.

**Principle: old exports stay as aliases.** `createGranotRun`, `approveGranotRun`, and `runGranotWorker` remain the imported names until the admin router and consumer point at the story names.

**No class for the workflow.** The type that *does* earn a name is the locked plan we hand from collect-and-lock to approve-and-walk:

```ts
type TheLockedSealedGranotAutomationPlan = {
  kind: "form_leads" | "call_leads"
  schema_version: 2
  actions: Array<{
    action_id: string
    lifecycle_apply: TheSealedLifecycleEvidenceForThisAction
    // Form: classification; Call: syncable + target_binding
  }>
  counters: Record<string, number>
}
```

That is the handoff from “we still have the collected tables” to “the owner may approve selected actions against this checksum.” Do **not** put credentials, cookies, or raw HTML on this object so “ops can replay the session,” do **not** add a combined `both` operation so “one run does Form and Call,” and do **not** keep a schema-v1 plan so “old approvals still work.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// runWorkflow.ts
// The owner asked for a durable Granot automation run.
// Queue it. When the worker claims the account, collect the tables,
// plan Form or Call, seal every action as schema 2, checksum, and lock.
// Preview finishes there.
// Apply waits until the owner approves selected update/syncable actions
// against that checksum, then walks those actions into lifecycle capture.
// Recover and continue are just wake-ups for leftover queued work.
// This file does not write a Lead. This file does not insert a receipt.
// This file does not parse HTML.

// ── 1. Queue a durable Granot automation run ──────────────

export async function queueADurableGranotAutomationRun(request)
export async function queueCorrelatedFormAndCallRunsFromTheSameSubmission(
  request,
  runtime = defaultGranotRunGroupRuntime,
)

function refuseUnlessTheGroupAskedForOneOrTwoUniqueOperations(operations)
function rememberTheQueuedRun(input)                    // status queued; TTL 24h; purge 7d
async function insertTheChildRunsTogetherOrInsertNone(documents)
export async function publishAGranotAutomationWakeupIfThisHostMay(
  runId,
  reason,                                               // create | approval | recovery | continuation
  predecessorRunId?,
)

// ── 2. Collect the tables and lock the sealed plan ────────

async function collectTheTablesAndLockTheSealedPlan(runId, lease)

async function planTheCallRowsOneAtATimeAndBindTheTargetsThePreviewNamed(
  sources,
  beforeRow,
)
async function bindTheCallLeadBookingAndReceiverThisPreviewAlreadyNamed(row, preview)
function thisPlannedActionMayBeApprovedLater(action)    // Form update | Call syncable
function refuseDuplicateActionIds(plan)
function checksumTheSealedPlan(plan)                    // envelope schema_version 1; payload is schema 2
function lockTheImmutablePlanOnce(runId, lease, plan, checksum)

// ── 3. Approve selected actions on the sealed apply plan ─

export async function approveSelectedActionsOnTheSealedApplyPlan({
  run_id,
  plan_checksum,
  selected_action_ids,
  approved_by,
})

export function theOwnerHasTurnedOnApprovedApply(value?)
function refuseUnlessThisPlanIsStillWaitingAndTheChecksumMatches(run, checksum)
function refuseUnlessEverySelectedIdIsApprovable(plan, selected)

// ── 4. Walk selected actions into lifecycle capture ───────

async function walkSelectedActionsIntoLifecycleCapture(runId, lease)

function skipThisActionWhenItsReceiptIsAlreadyFinal(existing)
async function captureThisSelectedActionThroughTheApplySibling({
  action,
  approved_by,
  existing,
  runId,
})
function rememberIdempotencyConflictAsATechnicalFailure(error, existing)
async function yieldTheAccountLeaseWhileTheProcessorIsStillPending(runId, lease)
async function finishTheRunWhenEverySelectedActionIsTerminal(runId, lease, receipts, selected)

// ── 5. Claim the account, wake leftover work, show a run ─

export async function claimTheAccountAndDoTheNextRun()
export async function wakeTheNextLeftoverQueuedOrLeasedRun()
export async function wakeTheNextLeftoverRunAfterThisOneFinished(completedRunId)
export async function showThisRedactedGranotAutomationRun(runId, includeOwnerDetails)
export async function listRecentRedactedGranotAutomationRuns(limit?)

async function expireStaleAwaitingApproval(now)
async function claimApplyingBeforeQueuedOrPlanning(lease, now)
async function requeueATransientProviderFailureOrMarkTheRunFailed(runId, lease, error)
function hideTheGranotStatementAndReceiptPayloads(run, details)
```

Read the apply path out loud: *queue the run. The worker claims the account lease, expires leftover approval, and prefers an already-approved applying run. If this run is still queued, collect the tables, plan Form or Call, seal every action, checksum the sealed plan, and lock it. Preview is done. Apply waits. The owner sends the checksum and the selected update/syncable ids. We refuse an unsealed plan, a dead checksum, or a gate that is off, then mark the run applying. The worker walks those selected actions into the apply sibling — skip a finished receipt, yield when the processor is still pending, finish when every selected action is terminal. Unselected rows stay in the plan and never become a receipt. We never call updateFormLead.*

That is the operation. `createGranotRun` plus `applyRun` as CRUD is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Label-only create skips resolve.** Knowledge already says `createGranotRun` with `source_labels` only does not call `resolveGranotAutomationSources`. Run-groups and the `source_ids` path fail closed. Do not teach this file to resolve raw labels so “the gap closes,” and do not delete the label path so “every create is honest” — HANDOFF still calls it the compatibility path.

2. **The checksum envelope still says `schema_version: 1`.** The payload is the sealed schema-2 plan. Knowledge already names `checksum_version: 1` / `artifact_kind: "ingestion_plan"`. Do not bump the envelope to 2 so “the numbers match,” and do not checksum the unsealed plan so “seal is display-only.”

3. **Call plan lives here; Form plan does not.** `planCallWorkflow` previews one row at a time and binds targets. Form planning is `formWorkflow.ts`. Do not move Form plan into this file so “the worker owns both planners,” and do not move Call plan into `formWorkflow.ts` so “one planner.” A later story split may extract Call plan; this pass does not.

4. **`syncable` is `updateable` or a target receiver, not “the preview said update.”** A Call row with no field patch can still be approved when `buildCallTargetBinding` found a `target_receiver_agent`. Do not drop the receiver clause so “approvable means the preview card,” and do not teach Form to read `syncable`.

5. **Approve and apply both check the deployment gate.** `approveGranotRun` and `applyRun` each call `granotApplyEnabled()`. Turning the flag off after approval still refuses the walk. Do not skip the apply check so “approval already meant yes,” and do not move the gate onto `formWorkflow.ts` because that test file imported it.

6. **Pending yields the account; it does not fail the run.** `accepted_for_processing` / `pending_match` increment nothing, clear the run lease, and return `applying`. The consumer then `continueGranotRuns`. Do not mark the run `failed` so “we did not finish,” and do not increment `completed` on a pending receipt.

7. **`recoverGranotRuns` and `continueGranotRuns` reprint the leftover-work query.** Same `$or` of queued / expired-lease planning-or-applying. Different wakeup reason (`recovery` vs `continuation` + predecessor). Collapse the exists fold. Do not publish `create` from recover so “one wakeup helper,” and do not skip continue when `lease_busy` — that ACK is the consumer’s job.

8. **`buildFormExpectedFilter` is leftover from the old Form write.** `[AC-02]` already forbids `updateFormLead`. Nothing in `applyRun` calls this helper. The test only locks `receiver_agent: null` vs `{ $in: [null, ""] }` for other paths. Do not wire it back into apply so “expected values return,” and do not invent a Form write **seam** from the export.

9. **`toDurableGranotValue` is the Call-plan checksum fence, not a general serializer.** It stringifies ObjectIds, drops `undefined`, refuses non-finite numbers and non-plain objects. Form actions are sealed from collected rows, not this fold. Do not run Form patches through it so “one durable helper,” and do not keep `undefined` so “the preview card is honest.”

10. **Wakeup publish is Vercel plus the hosted `NODE_ENV` gate.** Elsewhere it returns false and the admin route runs the worker inline. Cron 503s when leftover work exists and publish failed. Do not throw from `publishGranotWakeup` so “the owner sees the queue error,” and do not delete the local-worker branch so “one path.”

11. **Approved applying precedes new planning.** The comment already says the owner must not wait behind a sibling plan. Do not FIFO the account so “fairness,” and do not take two runs under one lease.

12. **HANDOFF still describes the old Form write.** Safety says Form writes cross `updateFormLead` and Call writes re-preview then sync. `[AC-02]` and knowledge forbid those imports. Do not restore `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation` so HANDOFF “wins,” and do not silently rewrite HANDOFF in this pass.

13. **Knowledge `automation-apply.md` lists this file as Primary code beside capture.** This file does not insert a receipt and does not call `claimAndProcessOrPoll`. Do not move capture here so the Primary-code line “wins.”

14. **Leave sibling modules alone.** Session collect, Form match, Form plan, statement seal, source-catalog resolve, and apply capture are already the right **depth**. This file orchestrates queue → claim → collect/lock → approve → walk → redact only.

## Testing

The **interface** is the test surface: `queueADurableGranotAutomationRun`, `queueCorrelatedFormAndCallRunsFromTheSameSubmission`, `collectTheTablesAndLockTheSealedPlan` (via `claimTheAccountAndDoTheNextRun` on a queued run), `approveSelectedActionsOnTheSealedApplyPlan`, `walkSelectedActionsIntoLifecycleCapture` (via the worker on an applying run), `wakeTheNextLeftoverQueuedOrLeasedRun`, `showThisRedactedGranotAutomationRun`. Today those tests are thin. Keep the proofs that exist. Claim the story names on this **interface**. Do not re-test HTML parse, Form match, missing-field patch, statement redaction rules, or `updateFormLead` here.

**Queue a durable Granot automation run**
- A run-group of Form + Call inserts two correlated queued children and a failed wakeup does not roll them back (already locked; keep it).
- Resolve failure happens before any insert (already locked; keep it).
- One or two unique operations only — empty, three, or `["form_leads", "form_leads"]` refuse before resolve (add this).
- `source_ids` create calls resolve and stores the returned labels (add this).
- Label-only `createGranotRun` does **not** call resolve and still queues (add this — the known gap must stay visible).
- Do not add a test that this function collects HTML or writes a Lead.

**Collect the tables and lock the sealed plan**
- After plan, the stored snapshot is schema 2 and checksum is over that sealed payload (add this — today’s `[AC-02]` seal proof lives on `lifecycleStatement.test.ts`).
- Preview with any actions completes and does not wait for approval (add this).
- Apply with only `no_match` / `unchanged` completes; apply with one Form `update` or Call `syncable` becomes `awaiting_approval` (add this).
- Call `syncable` is true when the preview is not `updateable` but `target_receiver_agent` is set (add this).
- Duplicate `action_id` refuses before lock (add this).
- ObjectIds in a Call preview become strings before checksum (already locked on `toDurableGranotValue`; keep it).
- Do not add a test that this function captures a receipt.

**Approve selected actions on the sealed apply plan**
- Gate off is `APPLY_DISABLED` (add this; steal the `granotApplyEnabled` cases from `formWorkflow.test.ts`).
- Expired / not awaiting / checksum mismatch is `RUN_NOT_APPROVABLE` (add this).
- Schema-v1 is `RUN_REPLAN_REQUIRED` (add this — seal tests already refuse v1; approve must too).
- A `no_match` id is `UNKNOWN_ACTION` (add this).
- Lost CAS is `APPROVAL_RACE` (add this).
- Happy path stamps `selected_action_ids`, clears the run lease, and publishes approval (add this).

**Walk selected actions into lifecycle capture**
- `[AC-02]` source scan: no `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`; must call `applyAutomationPlanAction` (already locked; keep it).
- Terminal stored receipt is skipped (add this).
- Pending receipt yields `applying` and does not increment completed (add this).
- Idempotency conflict stores `technical_failure` and continues (add this).
- All selected terminal + one `technical_failure` is `completed_with_errors` (add this).
- Unselected actions create no receipt (add this).
- Do not add a test that this function inserts a `GranotObservationReceipt` — that stays on `automationApply.test.ts`.

**Claim the account, wake leftover work, show a run**
- Worker prefers `applying` over queued (add this).
- `lease_busy` returns `{ claimed: false, status: "lease_busy" }` (add this — consumer source scan already locks the ACK).
- Provider `invalid_session` with `attempt_count < 3` requeues; the third failure is structural `failed` (add this).
- Recover and continue share the leftover-work question and differ only by wakeup reason (add this).
- `[AC-35]` owner details keep `lifecycle_receipt_id` and drop `granot_statement` (already a source scan; add a behavioral proof).
- Default list/get never include `plan` or `receipts` (add this).

Do **not** add a test per helper (`rememberTheQueuedRun`, `bindTheCallLeadBookingAndReceiverThisPreviewAlreadyNamed`, `hideTheGranotStatementAndReceiptPayloads`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**. The leftover `buildFormExpectedFilter` test may stay until a later delete; it is not this story. HTML parse / Form match / missing-field patch / statement shape tests stay on their sibling files; they are not this **interface**.

Do **not** re-test `sealAutomationPlan` row-find rules, `applyAutomationPlanAction` capture, or Form Lead Correction write here.

## What I would not do

- A `GranotRunWorkflowService` class with `create` / `plan` / `approve` / `apply` / `update` / `delete`.
- Thirty two-line functions that only wrap `sealAutomationPlan` or `applyAutomationPlanAction`.
- Moving this into a CRUD folder (`create.ts` / `plan.ts` / `approve.ts` / `apply.ts` / `update.ts` / `delete.ts`), or into `automation.ts` / `lifecycleStatement.ts` / `automationApply.ts` / `formWorkflow.ts` “for cleanliness.”
- Restoring `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation` so HANDOFF’s old write sentence “wins.”
- Capturing a `granot_http_automation` receipt or calling `claimAndProcessOrPoll` from this file.
- Closing the label-only `createGranotRun` gap so “every create resolves.”
- Bumping the checksum envelope to `schema_version: 2` so “the numbers match.”
- Adding a `both` operation so “one run does Form and Call.”
- FIFO-ing the account lease so “planning is fair.”
- Treating pending as `failed`, or incrementing completed on `accepted_for_processing`.
- Wiring `buildFormExpectedFilter` back into apply so “expected values return.”
- Silently rewriting HANDOFF so this file “finally drops the old Form write.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Granot Observation Receipt / Observation Channel.
- Writing a whole-folder recommendation for `granotHttpCollector`.
