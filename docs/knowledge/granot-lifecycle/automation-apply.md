---
type: Service
title: "Granot HTTP automation apply (`granotLifecycle/`)"
description: Scheduled Estimates compare Granot fields with MongoDB and apply changes to uniquely matched Leads.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-12-19
resource: src/services/granotLifecycle/automationApply.ts
applies_to:
  - src/services/granotLifecycle/automationApply.ts
  - src/services/granotHttpCollector/lifecycleStatement.ts
  - src/services/granotHttpCollector/runWorkflow.ts
  - src/services/granotHttpCollector/scheduledLeadChange.ts
  - src/services/granotHttpCollector/estimatesOutreachRefresh.ts
  - src/services/granotHistory/scheduledRunArchive.ts
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
  by: process:docs-keeper
  at: 2026-09-04T20:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Primary code:** `src/services/granotHttpCollector/scheduledLeadChange.ts`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/lifecycleStatement.ts`, `src/services/granotLifecycle/automationApply.ts` (pre-cutover resume)
**Domain terms used:** [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Granot HTTP automation apply (`granotLifecycle/`)

Granot supplies the collected CRM fields. MongoDB owns the Lead, its field ownership rules and its accepted update time. Scheduled Estimates plan only real changes for uniquely matched Leads and recheck identity, source policy, temporal order and desired state inside the write transaction. Unchanged, ambiguous and unmatched rows create no per-Lead history. The run keeps aggregate counters for those rows.

A committed change uses the existing Lead synchronization mutation and Sheet Sync outbox inside one canonical command (`synchronizeLeadFromGranot`, idempotency key `scheduled-estimate:<source id>`). The source, Observation and Decision IDs are deterministic hashes of the operation ID. The command inserts the Observation, writes the Decision through the Lead synchronization operation and certifies the winning Lead. Its embedded run result (`scheduled_direct: true`) identifies the source for the Observation, Decision and Lead provenance. When the committed change includes `granot_priority`, the same transaction refreshes Pool membership and nominates the Outreach `outreach_lead_change` stage for an open subject. After commit the worker wakes Lead links and mirrors a Form Lead change onto its qualified Call Lead sibling. New scheduled actions never enter webhook receipt capture. A pre-cutover action with a saved capture, or an action of a run below schema version 3, resumes by its original receipt ID. [Scheduled change command](../../../src/services/granotHttpCollector/scheduledLeadChange.ts)

A skipped action records its outcome in the run without a Decision: `unmatched` for a missing or changed target, `policy_blocked` when processing, Lead writes or live execution is off, and otherwise the planned Decision outcome. Skipped actions are marked Outreach-complete. A transient failure yields the run and retries the same sealed action.

## Historical receipt-backed automation

The following contracts describe pre-cutover automation captures and their replay.

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

- Scheduled Estimates rows → `lead_snapshot_apply`. Only `update` classifications are sealed into the plan.
- `booking_action_apply` remains a channel operation kind for the browser extension. The retired Leads & Advertising collector produced it for Booked Jobs rows.
- `user` and `rep` stay separate; raw Priority stays canonicalizable
- Schema-v1 approved plans fail closed as `RUN_REPLAN_REQUIRED`

## Apply

`applyAutomationPlanAction` captures through `captureChannelOperationReceipt` (`authentication_method: "automation_owner_approval"`, initiator = `approval.approved_by`, hint `granot_apply_item_v1`) and then `claimAndProcessOrPoll(receipt_id)` in [`drainer.md`](./drainer.md). It does **not** publish a lifecycle queue wake-up.

`operation_id` is `${run_id}:${action_id}` (`isAutomationOperationId`: nonempty parts, no control/bidi, max 300 chars). It is not required to be ObjectId-shaped. A stored action receipt with terminal outcome is returned without recapture. Stored `pending_match` is **non-terminal** and re-enters the due canonical claim using the original receipt, without recapture.

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

Nonterminal `accepted_for_processing` does not increment completed progress, yields the run lease, and resumes the same operation ID. Exact replay of a **terminal** stored receipt returns that receipt. The run detail and approval routes were retired on November 18; only `GET /api/v1/admin/granot-automation/runs/freshness` remains.

## Scheduled identity

Lifecycle defaults stay processing/shadow true and all eight effect flags false. The scheduled worker requires processing, Lead writes and live execution; otherwise each changed action records `policy_blocked`. There is no bypass of those gates. Dashboard-initiated runs, Owner approval and `GRANOT_AUTOMATION_APPLY_ENABLED` were retired on November 18 ([release record](../../operations/GRANOT-SLIMMING-RELEASE-2026-11-18.md)).

The recurring cron covers trailing 90 inclusive Open Dates plus verified older provider-date months hourly from 08:00 through 20:00 America/New_York.
A deterministic run `_id` keyed by the scheduled slot, date window and selection makes retries
and concurrent invocations reuse the same run, plan, and lifecycle operation IDs.
The existing Mongo `_id` index enforces uniqueness. Run creation first checks
`granot_closed_automation_runs`, so an archived run is never recreated.


Pending-match actions keep their lifecycle retry clock and operation identity.
The worker attempts the remaining independent selected actions before yielding;
terminal receipts are skipped on replay. A waiting run checkpoints `waiting_match`
and is eligible for bounded polling after one minute (the receipt's own drainer
still controls whether a claim is due). Claims use least-recent-attempt order so
one pending run cannot starve other approved work; heartbeat and continuation
only nominate eligible runs. No lifecycle outcome is converted or forced.

Existing pending receipts are bulk-read before replay. Non-due or actively claimed
receipts are skipped, terminal results can refresh immediately, and at most one
potentially blocking pending replay is attempted per pass. Dead letters use the same bounded canonical
claim/poll so an intervening Owner requeue cannot be terminalized from a stale
snapshot. Fresh selected actions
remain independent; this bounds replay polling while preserving lifecycle clocks.

Automation replays use the canonical claim/poll with a zero polling deadline:
it still claims due work and reads the live terminal state, including after an
Owner requeue, but does not sleep on another claimant. Completed/dead-letter
refreshes do not share the pending retry cap and can all settle in the same pass.
Other synchronous lifecycle callers retain their default five-second poll.

## Fulfilled scheduled runs

Successful completion makes the run due for archival immediately. The two-minute worker reviews up to 16 runs. It verifies the sealed plan, every selected action result and its completed Outreach handoff, then reads the original BSON and replay manifest back from pinned GCS generations. One Mongo transaction publishes the closed-run lookup and coverage window and deletes the full run. A duplicate schedule uses the closed-run ID. Historical automation retries use the archived result and original payload hash.

Freshness and the ALL-to-Pool dependency read both queued work and completed coverage windows. The compact windows expire at the latest of creation plus nine days, slot expiry plus one day, and archival plus one day. The GCS lookup survives that reporting window. Failed, unfinished, or inconsistent runs stay available for recovery.
