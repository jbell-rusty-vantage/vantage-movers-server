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
  - src/services/granotHttpCollector/estimatesIdentityPlanning.ts
  - src/services/granotLifecycle/callLeadFormSibling.ts
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

Granot supplies the collected CRM fields. MongoDB owns the Lead, its field ownership rules and its accepted update time. Scheduled Estimates plan real changes for uniquely matched Leads, plus the follow-up work an already-current Lead still owes (below). Apply rechecks identity, source policy, temporal order and desired state inside the write transaction. Other unchanged rows, and ambiguous and unmatched rows, create no per-Lead history. The run keeps aggregate counters for those rows.

## Follow-up work for already-current Leads

For an already-current Lead, the webhook processor does two more things. It establishes the Record Link, and it brings the Form Lead's qualified Call sibling up to date (Owner rule, October 28). Scheduled apply now does the same, with three limits:

- It never contests or aliases a Record Link from an already-current row.
- A Call Lead takes part only while it is admitted (Owner, November 20).
- Each plan does a bounded amount of this work.

Planning promotes an already-current row to `update` and marks it with `follow_up` when either piece of work is owed. Each plan makes at most one batched read of each kind, and each read is bounded by `maxTimeMS` 5,000. If a read fails or runs out of time, that plan promotes nothing and counts `follow_up_unavailable`. Real updates are never blocked.

- **`record_link`** is owed when the Lead has no active Record Link. That means two things hold together:
  - The identity ladder did not reach the Lead through a link. A Lead reached through an equivalent job's link already has a link, so no alias link is added.
  - No active link holds the row's exact job, or the link that does has no Lead.

  A link that names another Lead is never contested from an already-current row. A Call Lead target must be reporting-eligible (`hasReportingEligibleCall`) and not `created_on_unmatched`.
- **`form_sibling`** is owed when the sibling update would write now. `findFormsNeedingSiblingUpdate` (`callLeadFormSibling.ts`) decides this:
  1. Two batched reads load candidate Calls with the planner's fields. The job read finds an eligible Call with the Form's exact job or digit core. The phone read finds an eligible jobless Call sharing one of the Form's phones within its Lead Source Company. It uses both phone indexes; the 45-day window is applied by the planner, because a date range made MongoDB choose the company/date index.
  2. Each Form is planned with the unchanged `planFormSiblingUpdate` gate, so an established pair costs no further read.
  3. Only a Form that would write is confirmed with the update's own loader.

  The target Call must pass `hasReportingEligibleCall`: RingCentral queue qualification, or the preserved historical or trusted final-import Best Relocation admission. It must not be a 90-day repeat `duplicate` or `created_on_unmatched`.

  Planning does not find a Call whose only tie to the Form is a different letter prefix on the same job (`P123` against `X123`). The Form's next applied change or webhook still reaches it.
- **Backoff:** a Form whose scheduled catch-up committed an `already_current` Decision in the last 6 hours is not promoted again. Planning counts it as `follow_up_form_sibling_backoff`. A sibling update that keeps failing therefore commits at most four Observation and Decision pairs a day.
- **Cap:** a plan promotes at most 50 rows (`FOLLOW_UP_PROMOTION_CAP`). The rest count as `follow_up_deferred` and are planned again in a later slot. Promoted rows go after the plan's real updates, so the per-pass apply bound (25 actions) reaches Priority changes first.

Planning counts `follow_up_record_link` and `follow_up_form_sibling`.

Apply rechecks the same rules inside the transaction:

- **Link owed:** the Lead command runs with no Lead field changes. It establishes or attaches the link (outcome `linked`). It advances the temporal winner and certifies it for Pool admission. A Daily Operations `granot.linked` card follows, as on the webhook path. No Sheet job is queued.
- **Sibling owed, link current:** the command commits only the Observation and an `already_current` Decision, which the sibling update cites. The Form Lead is unchanged.
- **Neither:** the transaction aborts with `already_current` and leaves no history.

The sibling update never creates or qualifies a Call Lead. It never changes `form_fill`, `duplicate` or the qualification, so a Form Fill Call is updated in place and stays on **Duplicate Calls**. It requests a Calls-family Sheet update only for a previously synced row whose job or receiver changed.

**Measured on November 20, read-only, at release:**

- **Sibling update:** none of the 4,697 job-holding, non-duplicate Form Leads created since August 1 would be written. The counts were 4,443 `no_call_sibling`, 36 `already_current` and 218 `form_ineligible`.
- **Record Links:** every job-holding Form Lead already has a link. 310 admitted Call Leads with a job have no link under any equivalent job. All 310 have no Priority, so a Granot row for one of them is a real change and is linked through the applied path, as before. None is Priority 9, so no Pool admission is added.

The release therefore queues no catch-up backfill and no Sheet job. Later writes happen one Lead at a time, as live changes.

**Record Link disputes** come only from a real change. If the Lead command finds the exact link naming another Lead, it marks the link disputed. The scheduled command commits that dispute with its `conflict` Decision and does not apply the change. Once a link is disputed, later rows for the same job abort with `conflict` and leave no history.

This can happen when two equivalent-job links name different Leads, for example `A123` naming Y and `X123` naming X. A row for `X123` can reach Y through the `A123` link, and the change then meets the `X123` link. Before `5137f06f`, the receipt-backed path recorded this dispute; the scheduled path then discarded it. Production held 40 such equivalent-job groups that name more than one Lead, none disputed. Each group can become disputed only on a real Granot change for its job.

**Granot health counts:** scheduled `linked` and `already_current` Decisions, and committed `conflict` Decisions, now appear in Decision-based counts alongside webhook Decisions.

A committed change uses the existing Lead synchronization mutation and Sheet Sync outbox inside one canonical command (`synchronizeLeadFromGranot`, idempotency key `scheduled-estimate:<source id>`). The source, Observation and Decision IDs are deterministic hashes of the operation ID. The command inserts the Observation, writes the Decision through the Lead synchronization operation and certifies the winning Lead. Its embedded run result (`scheduled_direct: true`) identifies the source for the Observation, Decision and Lead provenance. When the committed change includes `granot_priority`, the same transaction refreshes Pool membership and nominates the Outreach `outreach_lead_change` stage for an open subject. After commit, the worker wakes Lead links after `applied` or `linked`. For a Form Lead, it also runs the sibling update after `applied`, `linked` or `already_current`. Both steps follow the webhook path's rule: each is bounded to 2 s and never throws. The action receipt records the result in `post_commit`: `lead_link_wake` is `done`, `timeout` or `failed`, and `form_sibling` is the update's outcome, `timeout` or `failed`. A persistent post-commit error therefore no longer holds the run until its 24-hour expiry. On an idempotent replay, the committed Decision supplies the outcome and the post-commit steps run again. Both steps are idempotent. New scheduled actions never enter webhook receipt capture. A pre-cutover action with a saved capture, or an action of a run below schema version 3, resumes by its original receipt ID. [Scheduled change command](../../../src/services/granotHttpCollector/scheduledLeadChange.ts)

A skipped action records its outcome in the run without a Decision. The outcome is one of the following:

- `unmatched` for a missing or changed target;
- `policy_blocked` when processing, Lead writes or live execution is off;
- `already_current` when nothing is owed;
- `conflict` for a change that meets an already-disputed link;
- otherwise, the planned Decision outcome.

 Archive review accepts the direct outcomes `applied`, `linked`, `already_current`, `conflict` and the skip outcomes. It requires Decision and Observation IDs for `applied` and `linked`. Skipped actions are marked Outreach-complete. A transient failure yields the run and retries the same sealed action.

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

- Scheduled Estimates rows → `lead_snapshot_apply`. Only `update` classifications are sealed into the plan, including already-current rows promoted for `follow_up`.
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
