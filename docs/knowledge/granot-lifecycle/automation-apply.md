---
type: Service
title: "Granot HTTP automation apply (`granotLifecycle/`)"
description: Owner-approved HTTP automation apply captures a receipt and enters claimAndProcessOrPoll.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/automationApply.ts
applies_to:
  - src/services/granotLifecycle/automationApply.ts
  - src/services/granotHttpCollector/lifecycleStatement.ts
  - src/services/granotHttpCollector/runWorkflow.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/automationApply.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T06:52:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Primary code:** `src/services/granotLifecycle/automationApply.ts`, `src/services/granotHttpCollector/lifecycleStatement.ts`, `src/services/granotHttpCollector/runWorkflow.ts`
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Granot HTTP automation apply (`granotLifecycle/`)

**Role:** Convert each selected Owner-approved, checksum-locked HTTP-automation action into one `granot_http_automation` receipt under `${run_id}:${action_id}`, then enter Unit 08 `claimAndProcessOrPoll`. The locked plan statement is evidence. Apply does **not** call `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`.

Mongo is the **System of Record**. Preview still uses existing matching services and creates no receipt.

## Plan schema v2

Before checksum lock, `sealAutomationPlan` attaches:

```ts
{
  operation_id: `${run_id}:${action_id}`,
  operation_kind: "lead_snapshot_apply" | "booking_action_apply",
  granot_statement: Record<string, string | number | null>,
  expected_target?: { model: "FormLead" | "CallLead"; id: string }
}
```

- Follow Up Form and Call enrichment → `lead_snapshot_apply`
- Every Booked Jobs row, including Form-plan Booked rows → `booking_action_apply` with raw `event_type: "Booked"`
- `user` and `rep` stay separate; raw Priority stays canonicalizable
- Schema-v1 approved plans fail closed as `RUN_REPLAN_REQUIRED`

## Apply

`applyAutomationPlanAction` captures through `captureChannelOperationReceipt` (`authentication_method: "automation_owner_approval"`, initiator = `approval.approved_by`, hint `granot_apply_item_v1`) and then `claimAndProcessOrPoll(receipt_id)` in [`drainer.md`](./drainer.md). It does **not** publish a lifecycle queue wake-up.

`operation_id` is `${run_id}:${action_id}` (`isAutomationOperationId`: nonempty parts, no control/bidi, max 300 chars). It is not required to be ObjectId-shaped. A stored action receipt with terminal outcome is returned without recapture. Stored `pending_match` is **non-terminal** and will recapture/reclaim.

Run action receipt:

```ts
{
  action_id,
  lifecycle_receipt_id,
  observation_id?,
  decision_id?,
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure",
  applied_at
}
```

| Claim / Decision | Automation `outcome` |
|------------------|----------------------|
| terminal Decision (`applied`, `created`, `already_current`, …) | that `SynchronizationOutcome` |
| `pending_match`, lost claim, poll miss | `accepted_for_processing` |
| processing disabled | `accepted_for_processing` + `error_code: "GRANOT_PROCESSING_DISABLED"` |
| receipt `dead_letter` | `technical_failure` + `error_code: "GRANOT_RECEIPT_DEAD_LETTER"` |
| capture `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT` | run maps to `technical_failure` |

Nonterminal `accepted_for_processing` does not increment completed progress, yields the run lease, and resumes the same operation ID. Exact replay of a **terminal** stored receipt returns that receipt. Admin GET details redact `granot_statement` from the plan and never project receipt payloads.

## Flags

Lifecycle defaults stay processing/shadow true and all eight effect flags false. `GRANOT_AUTOMATION_APPLY_ENABLED` remains the preexisting Owner apply gate and is not enabled by this unit.
