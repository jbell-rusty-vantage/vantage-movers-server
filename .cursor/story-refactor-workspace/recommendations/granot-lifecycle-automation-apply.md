# Apply This Owner-Approved HTTP Automation Action — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 4 of this service — `automationApply.ts`
- Remaining in this service: `automationCompatibility.ts`, `normalization.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/automationApply.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`. Distinct from receipt insert: `recommendations/granot-lifecycle-capture.md` + `docs/knowledge/granot-lifecycle/capture.md`. Distinct from the webhook queue wake-up: `recommendations/granot-lifecycle-queue-publisher.md`. Distinct from Owner extension apply: `recommendations/granot-lifecycle-extension-apply.md` + `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from claim/drain: `docs/knowledge/granot-lifecycle/drainer.md`. Distinct from Observation normalize / processor / Lead writes: `docs/knowledge/granot-lifecycle/normalization.md`, `processor.md`. Distinct from plan seal / run lease / approval: `docs/knowledge/services/granot-http-collector.md` + `runWorkflow.ts`. Distinct from Follow Up CSV write and Booked Jobs CSV write: `recommendations/enrichment-call-lead-enrichment.md` / `recommendations/reconciliation-booked-call-lead.md`. Distinct from ordinary Form Edit: `PATCH /api/v1/form-leads/:id`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / Synchronization Decision / System of Record — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `granotHttpCollector/runWorkflow.ts` (`applyRun` loop: sealed schema-v2 plan, Owner `approval.approved_by`, `existing_receipt` from `GranotAutomationRun.receipts`, `request_id` = run id). Tests: `automationApply.test.ts`, `automationApply.replica.test.ts` (one apply proof; the other two cases call `captureChannelOperationReceipt` only), `runWorkflow.test.ts` (source scan: no `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`). Not callers: `queuePublisher.ts`, `extensionApply.ts`, webhook routes, `sealAutomationPlan`, preview planners, ordinary Form PATCH.
- Seams callers need: skip a terminal stored run-action receipt vs recapture/reclaim a pending one; after-capture direct claim (never publish) vs webhook after-commit wake-up; processed Decision vs still-working / dead-letter / processing-disabled answer; injected `capture` / `claimAndProcess` for tests; PII-safe run-action receipt (bounded `error_code`, no payload echo)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `follow-up-apply.ts` / `booked-apply.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`applyAutomationPlanAction` is executor mechanics. The owner question is: *the owner just approved this checksum-locked HTTP automation action. If we already finished it, keep that answer. Otherwise keep the locked plan statement as an HTTP-automation receipt, try to process it now, and give the run a bounded action receipt. The run does not decide identity. If we cannot finish now, say we are still working — the receipt still stands. Do not wake the webhook queue. Do not write a Lead or a Booking from this file.*

Receipt insert, claim/drain, Observation normalize, source policy, identity, desired-state, processor, Lead create/sync, Booking/Release commands, Follow Up CSV write, Booked Jobs CSV write, plan seal / checksum / lease / yield, and Owner extension apply already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “an apply CRUD service,” and not capture / drain / plan seal / CSV sync:

1. **Apply this owner-approved HTTP automation action** — take a sealed apply item (`operation_id` = `${run_id}:${action_id}`, `operation_kind`, bounded `granot_statement`, optional `expected_target`) plus the Owner `automation_owner_approval` initiator and the run’s `action_id`. If the caller already stored a **terminal** run-action receipt (`outcome` is neither `accepted_for_processing` nor `pending_match`), return that receipt and do not capture. Otherwise keep the locked item through channel capture as `observation_channel: "granot_http_automation"`, `authentication_method: "automation_owner_approval"`, `payload_schema_hint: "granot_apply_item_v1"`, `headers: {}`. The payload is the whole item, never a `quoted` patch. Then call `claimAndProcessOrPoll` on that `receipt_id` **directly** — no queue publish. If the claim returns `processed` and the Decision is `pending_match`, remap to `outcome: "accepted_for_processing"` and keep observation / decision ids. Other processed Decisions copy that `SynchronizationOutcome`. Claim `accepted_for_processing` with `state: "dead_letter"` becomes `technical_failure` + `GRANOT_RECEIPT_DEAD_LETTER`. Ordinary accepted / retry stays `accepted_for_processing`. Claim `skipped` with `processing_disabled` stays `accepted_for_processing` + `GRANOT_PROCESSING_DISABLED`. Other skipped reasons (`not_found`, `invalid_id`) stay `accepted_for_processing` + `error_code: claimed.reason`. This function does not seal the plan. It does not check `GRANOT_AUTOMATION_APPLY_ENABLED`. It does not increment run progress or yield the account lease. It does not compare `expected_target`. It does not write a Lead or a Booking.

There is no second mutate operation. `translateAutomationClaimResult` is the same claim-to-receipt fold, exported and unused by any caller. Follow Up vs Booked Jobs are two `operation_kind` values on one apply, not two stories in this file.

## Organization

Keep one file. This is the screenplay for “apply this owner-approved HTTP automation action.” Channel capture, claim/drain, extension translation, plan seal, and the apply-enabled / lease fences already live in deeper **modules**. Do not pull those in. Do not invent an `AutomationApplyService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is receipt apply plus a run-action receipt, not a Domain Command. Do not invent an extension-shaped safe-sentence **seam** that has only one real adapter here.

Do not split this ~150-line file into Follow Up / Booked folders. Those are two kinds on one apply. Do not move `isTerminalStoredReceipt` into `identity.ts` “because terminal sounds like a Decision.” Do not move the claim table into `observability.ts` “because `error_code` looks like an event.” Do not merge this file into `extensionApply.ts` so “every channel apply looks the same.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applyAutomationPlanAction` | `applyThisOwnerApprovedHttpAutomationAction` | run apply loop; tests inject capture / claim |
| `translateAutomationClaimResult` | `translateTheClaimForTheAutomationRun` | same fold, kept as alias until a test or caller uses it |
| `GranotAutomationActionReceipt` | `AutomationRunActionReceipt` | `{ action_id, lifecycle_receipt_id, outcome, applied_at, … }` the run checkpoints |
| `ApplyAutomationActionInput` | `OwnerApprovedAutomationApply` | item + initiator + optional stored receipt; `runWorkflow` builds this |
| `AutomationApplyDeps` | `ApplyThisActionDeps` | test **seam**: override capture and claim |

Keep the old names as one-line aliases until `runWorkflow` migrates. Do not make callers learn `AUTOMATION_APPLY_ITEM_SCHEMA_HINT` / `SyncClaimResult` / `isTerminalStoredReceipt` as the domain language.

`capture` / `claimAndProcess` on the deps bag stay test **seams**. They are not a second public operation. Default remains `captureChannelOperationReceipt` and `claimAndProcessOrPoll(receiptId)` — **without** the initiator.

**No class for the workflow.** The type that *does* earn a name is the run-action receipt the apply loop will checkpoint:

```ts
type AutomationRunActionReceipt = {
  action_id: string
  lifecycle_receipt_id: string
  observation_id?: string
  decision_id?: string
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure"
  applied_at: Date
  error_code?: string
}
```

That is the handoff from “we captured and tried to claim” to “the run can count completed work, or yield and resume the same operation id.” Do **not** add `message` / `changed_paths` so “we match the extension,” and do **not** add `quoted` / `patch` so “the old enrichment apply still looks like a Call Lead write.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// automationApply.ts
// The owner approved this checksum-locked HTTP automation action.
// If we already finished it, keep that answer.
// Otherwise keep it as an HTTP-automation receipt.
// Try to process that receipt now.
// Give the run a bounded action receipt.
// The run does not decide identity.
// This file does not publish the webhook queue.
// This file does not write a Lead or a Booking.
// A still-working receipt recaptures and claims again.

// ── 1. Apply this owner-approved HTTP automation action ──

export async function applyThisOwnerApprovedHttpAutomationAction(input, deps?)

function alreadyFinishedThisAction(existing)
  // terminal = not accepted_for_processing and not pending_match
async function keepTheLockedActionAsAnHttpAutomationReceipt(input)
  // channel: granot_http_automation; auth: automation_owner_approval; hint v1; headers {}
async function tryToProcessThatReceiptNow(receipt_id)
  // claimAndProcessOrPoll(receipt_id) — initiator already on the receipt
export function translateTheClaimForTheAutomationRun(action_id, receipt_id, claimed)
  // pending_match → accepted_for_processing
  // dead_letter → technical_failure + GRANOT_RECEIPT_DEAD_LETTER
  // processing_disabled → accepted_for_processing + GRANOT_PROCESSING_DISABLED
```

Read the primary path out loud: *The owner approved selected Follow Up and Booked Jobs rows on a checksum-locked HTTP automation run. The apply loop already proved the apply flag, the sealed schema-v2 plan, and the Owner actor, and it skipped actions that already have a finished receipt. If this action’s stored receipt is still working, keep the locked item as an HTTP-automation receipt. Try to claim and process that receipt now. If a Decision is already stored and it is not a pending match, tell the run it finished that action. If we are still matching, still working, or processing is off, say we accepted it so the run can yield and resume the same operation id. If the receipt is dead-lettered, say technical failure with a bounded code — never send the Granot body back. Never wake the webhook queue. Never call the CSV Follow Up or Booked Jobs writers. Never write a Lead or a Booking from this file.*

That is the operation. `deps.capture` is not a different story. `applyThisOwnerApprovedGranotRowFromTheExtension` is not this apply.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The apply loop is this file, not the CSV writers.** `runWorkflow.applyRun` calls `applyThisOwnerApprovedHttpAutomationAction` per selected action. `updateFormLead`, `syncCallLeadEnrichment`, and `syncBookedCallLeadReconciliation` must not appear on that path — the collector source scan already locks that. Do not point approved apply back at those writes so the old `operation: "enrichment"` field “matches the name,” and do not delete the CSV helpers so the scan “wins.”

2. **This apply claims; the webhook publishes.** After channel capture, this file calls `claimAndProcessOrPoll`. It never calls `wakeTheDrainForThisWebhookReceipt`. Webhook capture never claims; the route may publish `{ receipt_id }` after commit. Do not publish from here so “every receipt wakes the queue,” and do not move this claim into `capture.ts` so “keep + process is one insert.”

3. **A finished stored receipt does not recapture.** `alreadyFinishedThisAction` returns the stored run-action receipt when `outcome` is neither `accepted_for_processing` nor `pending_match`. That includes `technical_failure`. Extension apply has no such skip — a refresh recaptures and claims again. `runWorkflow` also skips terminal receipts before this file runs. Do not delete the skip so “every apply looks like the extension,” and do not recapture a `technical_failure` so “maybe the 409 cleared.”

4. **`pending_match` is still working here; the extension completes it.** A processed Decision with `outcome: "pending_match"` becomes `accepted_for_processing` and keeps observation / decision ids. A stored `pending_match` is non-terminal and will recapture/reclaim. Extension apply keeps processed `pending_match` as `processing_state: "completed"` and the sentence “Pending source-scoped match.” Do not complete here so “every channel looks like the extension,” and do not remap the extension so “every apply looks like automation.”

5. **`dead_letter` is a bounded technical failure here.** Claim `accepted_for_processing` + `state: "dead_letter"` → `technical_failure` + `GRANOT_RECEIPT_DEAD_LETTER`. Extension maps the same claim to `accepted_for_processing` with no `error_code`. Do not drop the code so the unions match, and do not start returning `technical_failure` from the extension.

6. **Processing-disabled stays recoverable, with a code.** Claim `skipped` + `processing_disabled` → `accepted_for_processing` + `GRANOT_PROCESSING_DISABLED`. Other skipped reasons (`not_found`, `invalid_id`) also stay accepted and copy `claimed.reason` into `error_code`. Extension maps all of those to accepted with no code. Do not swallow the code so “the run can retry smarter later” becomes a silent delete, and do not add `error_code` to the extension answer.

7. **`isTerminalStoredReceipt` reprints the collector helper.** `isPendingAutomationActionOutcome` / `isTerminalAutomationActionOutcome` already live in `granotHttpCollector/lifecycleStatement.ts`. This file imports the pending helper for the processed-Decision remap, then pastes the terminal check locally. Do not invent a third “is done?” in `identity.ts`. Call the collector helper or keep the local fold next to the remap — do not silently change what counts as terminal (`technical_failure` is terminal; `pending_match` is not).

8. **`translateAutomationClaimResult` is an unused public alias.** It only forwards to the private fold. No runtime caller and no test imports it. Keep it as a one-line alias until a caller migrates. Do not grow a second translation table, and do not delete the export in this rename so “dead code cleanup” becomes a surprise.

9. **`expected_target` is evidence, not a conflict fold.** The locked item may name a Form/Call id from preview. This file copies the whole item into the receipt payload and never compares it. Extension apply forces `outcome: "conflict"` and clears `changed_paths` when the processed Lead is a different Form/Call id. Do not add that refuse here so “every apply checks the owner’s pick,” and do not write the expected id onto the run receipt so “the planner wins.”

10. **Capture `409` is the caller’s fight.** This file does not catch `OperationIdempotencyConflictError`. `runWorkflow` maps that throw to `technical_failure` + `error.code` (`GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`) and may store an empty `lifecycle_receipt_id` when there was no prior receipt. Do not swallow the 409 here so “apply always returns a receipt,” and do not start returning the extension’s `409` HTTP from this file.

11. **Headers stay empty; operation id is `${run_id}:${action_id}`.** Capture always sends `headers: {}`. The id is not required to be ObjectId-shaped (`isAutomationOperationId`: nonempty parts, no control/bidi, max 300). Extension uses a UUID v4 `operation_id` and may pass request headers. Do not copy webhook or extension headers so “capture looks complete,” and do not require an ObjectId so “receipts look like Mongo.”

12. **`automationApply.replica.test.ts` is mostly not this apply.** The concurrent same-hash / different-hash cases call `captureChannelOperationReceipt` and never import the apply function. The third case does call apply (injected claim, then a later apply with the stored terminal receipt) and proofs zero writes to `entity_changes` / `sheet_sync_jobs` / `domain_command_executions` / `booked_leads` / `cancelled_leads`. Do not move the uniqueness cases into this recommendation’s test list as if apply owned the unique index, and do not delete them so “the filename is wrong.”

13. **Leave sibling modules alone.** `keepThisApprovedChannelOperationAsAGranotObservationReceipt` stays in `capture.ts`. `claimAndProcessOrPoll` stays in `drainer.ts`. `applyThisOwnerApprovedGranotRowFromTheExtension` stays the previous module. `evaluateGranotAutomationCompatibility` stays the next module. `AUTOMATION_APPLY_ITEM_SCHEMA_HINT` stays in `applyItem.ts`. `sealAutomationPlan`, `GRANOT_AUTOMATION_APPLY_ENABLED`, lease yield, and completed-progress increment stay in `runWorkflow.ts` / `lifecycleStatement.ts`. This file orchestrates optional skip → capture → claim → run-action receipt.

14. **Do not treat Follow Up enrichment, Booked Jobs recon, CRM Posting, webhook `202`, Owner extension apply, or Owner Booking commands as this story.** Those write Leads, Bookings, answer the extension, or wake a queue. This file keeps a receipt and answers the run. Do not write a whole-folder recommendation for `granotLifecycle`.

## Testing

The **interface** is the test surface: `applyThisOwnerApprovedHttpAutomationAction` (today `applyAutomationPlanAction`). `{ action_id, lifecycle_receipt_id, outcome, error_code, observation_id, decision_id }` is part of that **interface**. `translateTheClaimForTheAutomationRun` may stay exported as an alias; do not add a helper-unit suite that only restates the parent.

Today’s `automationApply.test.ts` already locks capture-then-claim (`granot_http_automation` / `automation_owner_approval` / payload is the item / empty headers / no `MIKE` in a dead-letter result), terminal stored replay without recapture, nonterminal stored `accepted_for_processing` recaptures and claims, processed `pending_match` remaps to accepted, dead-letter → `technical_failure` + `GRANOT_RECEIPT_DEAD_LETTER`, and processing-disabled → accepted + `GRANOT_PROCESSING_DISABLED`. Keep those. Add the gaps that name the operation:

**Apply this owner-approved HTTP automation action**
- Default (non-injected) claim is `claimAndProcessOrPoll(receipt_id)` only — initiator is not a drain deps bag.
- This file does not call the webhook publisher.
- Stored `pending_match` is non-terminal: recapture + claim again.
- Stored `technical_failure` is terminal: return it, no recapture.
- Claim `skipped` (`not_found` / `invalid_id`) → `accepted_for_processing` + `error_code` = that reason.
- `expected_target` on the item is captured as payload and is not compared to the processed Lead.
- Capture throw (`409` idempotency / `503`) propagates; this file does not swallow it into `technical_failure`.

Do **not** add a test per helper (`alreadyFinishedThisAction`, `keepTheLockedActionAsAnHttpAutomationReceipt`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test `GRANOT_AUTOMATION_APPLY_ENABLED`, schema-v1 `RUN_REPLAN_REQUIRED`, checksum drift, selected-id ⊆ plan, lease yield, or completed-progress increment here — `runWorkflow` already owns those. Do not re-test concurrent capture uniqueness — that lives on the replica file and on `capture.ts`. Do not re-test `claimAndProcessOrPoll` lease math, Observation normalize, Follow Up CSV write, Booked Jobs CSV write, or `applyThisOwnerApprovedGranotRowFromTheExtension` here. Do not add a test that this file publishes — it must not. Do not add a test that approved apply calls `syncCallLeadEnrichment` — it must not.

## What I would not do

- An `AutomationApplyService` class with `create` / `update` / `apply`.
- Thirty two-line functions that only wrap `capture()` or `claimAndProcessOrPoll()`.
- Moving this into a CRUD folder, or into `capture.ts` / `drainer.ts` / `extensionApply.ts` / `runWorkflow.ts` “for cleanliness.”
- Publishing a webhook wake-up, or waiting on `{ published: true }`.
- Pointing approved HTTP apply back at `updateFormLead` / Follow Up CSV / Booked Jobs CSV.
- Completing `pending_match` or dropping `error_code` so the extension unions match.
- Recapturing a stored `technical_failure`, or swallowing capture `409` inside this file.
- Comparing `expected_target` here, or adding `message` / `changed_paths` so “we match the extension.”
- Teaching CRM Posting, ordinary Form Edit, or Owner Booking commands to call this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
