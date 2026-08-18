**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)
**Primary code:** `src/services/granotLifecycle/automationApply.ts`, `src/services/granotHttpCollector/lifecycleStatement.ts`, `src/services/granotHttpCollector/runWorkflow.ts`
**Domain terms used:** Granot Observation Receipt, Observation Channel, Synchronization Decision, System of Record

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

`applyAutomationPlanAction` captures through `captureChannelOperationReceipt` (`authentication_method: "automation_owner_approval"`, initiator = `approval.approved_by`, hint `granot_apply_item_v1`) and then `claimAndProcessOrPoll`.

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

Nonterminal claim/retry/`pending_match`/processing-disabled stores `accepted_for_processing`, does not increment completed progress, yields the run lease, and resumes the same operation ID. Dead letter is bounded `technical_failure`. Exact replay returns the stored terminal receipt.

Admin GET details redact `granot_statement` from the plan and never project receipt payloads.

## Flags

Lifecycle defaults stay processing/shadow true and all eight effect flags false. `GRANOT_AUTOMATION_APPLY_ENABLED` remains the preexisting Owner apply gate and is not enabled by this unit.
