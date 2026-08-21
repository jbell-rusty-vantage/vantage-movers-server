---
type: Service
title: Granot HTTP collector / automation
description: HTTP session collector; approved apply captures granot_http_automation receipts.
tags: [granot-lifecycle, automation]
status: draft
stale_after: 2026-09-20
resource: src/services/granotHttpCollector/
applies_to:
  - src/services/granotHttpCollector/
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotHttpCollector/
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Primary code:** `src/services/granotHttpCollector/`
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead Enrichment](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md)

# Granot HTTP collector / automation

**Role:** Owner-gated HTTP session collector that plans form/call work from Granot HTML tables. Mongo is the **System of Record**. Preview never writes a lifecycle receipt. Approved apply captures one `granot_http_automation` receipt per selected action and enters the shared lifecycle claim/processor. It does **not** call `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`.

## HTTP / queue

| Surface | Path |
|---------|------|
| Admin API | `/api/v1/admin/granot-automation/runs/*`, `.../runs/sources`, `.../run-groups`, `.../runs/worker` |
| Auth | `requireApiSecret` + `requireRegistryOwnerActor` |
| Queue | topic `granot-automation-events` → `api/queues/granot-automation-consumer.ts` → `runGranotWorker()` |
| Cron | `/api/cron/granot-automation-heartbeat` → `recoverGranotRuns()` |

`src/app.ts` mounts the admin router **before** v1. Local/non-Vercel workers may run without a queue publish.

## Workflows

| Workflow | Behavior |
|----------|----------|
| `preview` | Collect + plan. No lifecycle receipt. No Lead write. |
| `apply` | Same plan, Owner approval of selected action ids, then capture + `claimAndProcessOrPoll`. Requires `GRANOT_AUTOMATION_APPLY_ENABLED`. |

Operations: `form_leads` or `call_leads`. Form planning never **creates** Form Leads.

`GranotAutomationSource.supported_operations` remains a catalog/list compatibility field. Lifecycle availability and apply routing come from the referenced `GranotCrmSource` via `evaluateGranotAutomationCompatibility`. List/create still return legacy label/operations plus an additive `compatibility` projection. `resolveGranotAutomationSources` fails closed with `INVALID_GRANOT_SOURCES` and per-source issues when the reference is missing, disabled, ambiguous, or operation-incompatible. New automation labels are `missing_reference` until an Owner or reviewed migration attaches an exact Registry row. Reviewed `link_only` / `source_scoped_lead` families (Main Site, TBM, TBM Prime, Top10, 10best) project `ready` after Registry classification; Paid Overflow and Auto stay deferred and unavailable for apply.

## Plan schema v2

Before checksum lock, every collected action receives a server-owned `lifecycle_apply` block: `${run_id}:${action_id}`, operation kind, complete `granot_statement`, and optional preview `expected_target`. Schema-v1 plans cannot be reconstructed and fail `RUN_REPLAN_REQUIRED`.

## Form / Call apply

Selected approved actions call `applyAutomationPlanAction`. Follow Up rows are `lead_snapshot_apply`. Booked Jobs rows, including Form-plan Booked rows, are `booking_action_apply` with raw `Booked` evidence. Unselected actions create no lifecycle receipt. Preview matching remains for owner guidance only.

## Run records

`GranotAutomationRun` stores the immutable plan, approval, lease, and per-action receipts `{ action_id, lifecycle_receipt_id, observation_id?, decision_id?, outcome, applied_at }`. Lifecycle receipts/Observations/Decisions remain durable if the run later expires.

Worker claims `applying` runs under a durable lease (`granot:automation:account`). Approved work precedes new planning. `accepted_for_processing` yields the run lease and resumes the same operation ID.

## Related

- [`granotLifecycle.automationApply.md`](../granot-lifecycle/automation-apply.md)
- [`granotLifecycle.capture.md`](../granot-lifecycle/capture.md)
- [`granot-http-automation.mdc`](../../../.cursor/rules/granot-http-automation.mdc)
