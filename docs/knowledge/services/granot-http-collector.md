---
type: Service
title: Granot HTTP collector / automation
description: HTTP session collector; approved apply captures granot_http_automation receipts and enters the shared lifecycle claim.
tags: [granot-lifecycle, automation]
status: draft
stale_after: 2026-09-21
resource: src/services/granotHttpCollector/
applies_to:
  - src/services/granotHttpCollector/index.ts
  - src/services/granotHttpCollector/runWorkflow.ts
  - src/services/granotHttpCollector/sourceCatalog.ts
  - src/services/granotHttpCollector/formWorkflow.ts
  - src/services/granotHttpCollector/lifecycleStatement.ts
  - src/routes/granot-automation.routes.ts
  - src/routes/granot-automation-cron.routes.ts
  - api/queues/granot-automation-consumer.ts
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
  by: process:okf-docs-optimization
  at: 2026-08-22T05:53:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/granotHttpCollector/`  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead Enrichment](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md)

# Granot HTTP collector / automation

**Role:** Owner-gated HTTP session collector that plans Form/Call work from Granot HTML tables. Mongo is the **System of Record**. Preview never writes a lifecycle receipt. Approved apply captures one `granot_http_automation` receipt per selected action and enters `claimAndProcessOrPoll`. It does **not** call `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`.

Apply effects after capture are owned by [`automation-apply.md`](../granot-lifecycle/automation-apply.md). Reviewed Granot CRM family inventory is owned by [`operations-registry.md`](./operations-registry.md) — this module only evaluates the referenced Registry row.

## HTTP / queue / cron

| Surface | Path |
|---------|------|
| Admin API | `/api/v1/admin/granot-automation/runs`, `.../runs/sources`, `.../runs/:runId`, `.../runs/:runId/approve`, `.../runs/worker`, `.../run-groups` |
| Auth | `requireApiSecret` + `requireRegistryOwnerActor` on every admin handler |
| Queue | topic `granot-automation-events` → `api/queues/granot-automation-consumer.ts` → `runGranotWorker()` then `continueGranotRuns` |
| Cron | `/api/cron/granot-automation-heartbeat` (`CRON_SECRET`) → `recoverGranotRuns()` |

`src/app.ts` mounts the admin router **before** v1.

`publishGranotWakeup` returns true only on Vercel **and** production `NODE_ENV`. Otherwise it returns false (no throw). Non-Vercel `POST /runs` and `POST /run-groups` then call `runGranotWorker` inline. Cron returns **503** when work is recoverable but the wakeup did not publish. // pragma: allowlist secret

Local/non-Vercel workers may run without a queue publish. Collector credentials come from `GRANOT_NETWORK_USERNAME` / `GRANOT_NETWORK_PASSWORD` / `GRANOT_USERNAME` / `GRANOT_PASSWORD` (legacy `MAIN_LOGIN_*` / `SPECIFIC_*` fallbacks). Do not log values.

## Workflows

| Workflow | After plan lock |
|----------|-----------------|
| `preview` | Status `completed`. No approval. No lifecycle receipt. |
| `apply` | `awaiting_approval` if any approvable action exists; otherwise `completed` with no approval step |

Operations: `form_leads` or `call_leads`. Form planning never **creates** Form Leads (`no_match` / `conflict` only).

**Approvable:** Form `classification === "update"`; Call `syncable` (`preview.status === "updateable"` **or** a `target_receiver_agent` binding). Unchanged / no_match / conflict / non-syncable rows stay in the plan but cannot be selected.

Create body: `from`/`to` as real `MM/DD/YYYY`; `source_ids` **or** `source_labels` (not both); optional filters default `date_factor=OPEN`, `type=ALL`, `status=10`. Max 50 sources.

## Source catalog vs apply routing

`GranotAutomationSource.supported_operations` remains a list/create compatibility field. List/create return label + operations plus an additive `compatibility` projection from `evaluateGranotAutomationCompatibility`.

`ready` requires a referenced `GranotCrmSource` that is operationally enabled, `lifecycle_enabled`, not `deferred`, unambiguous on `normalized_granot_label`, and whose `lifecycle_routes` permit the requested Form/Call operation. Missing `granot_crm_source` → `missing_reference`. New admin labels start that way until an Owner or reviewed migration attaches an exact Registry row.

`resolveGranotAutomationSources` (the **`source_ids`** path, including run-groups) fails closed with `INVALID_GRANOT_SOURCES` and per-source issues when the row is missing, inactive, unclassified, not `available_for_apply`, or has no Registry route for the operation. Duplicate/malformed IDs fail the same code.

**Known gap:** `createGranotRun` with **`source_labels` only** does not call `resolveGranotAutomationSources`. Compatibility is enforced on `source_ids` / run-groups, not on the label-only create path.

Reviewed `link_only` / `create_if_missing` families and Auto-deferred posture live in [`operations-registry.md`](./operations-registry.md). This evaluator does not hard-code those labels.

Create-source limit is 200 labels. Exact duplicate label → `GRANOT_SOURCE_ALREADY_EXISTS`.

## Collector happy path

```
network login → user login (session token)
  → report menu → DATE1/DATE2 filter
  → source selector (adverlistwc links)
  → each requested label: parse Booked Jobs + Follow Up Estimates
```

Date window must be real calendar `MM/DD/YYYY` and `to >= from` (`invalid_request`). Session pages that look like login/security → `invalid_session` (collector retries the whole session once). Missing expected page or invalid table headers → `schema_drift`. Cross-origin redirect / HTTP failure / timeout → `provider_error`. Body over 10 MB → `response_too_large`.

A recognized table needs headers `job_no` and `customer`. Data rows also require a numeric `no` plus `job_no` or `customer`. Default collector host is `https://eagle.hellomoving.com`; 20s per request.

`buildGranotOperationPayloads` maps Follow Up → enrichment rows and Booked Jobs → booked-reconciliation rows. `user` or `rep` becomes `granot_crm_username`.

## Plan schema v2

`planGranotFormWorkflow` / `planCallWorkflow` emit `schema_version: 1`. `sealAutomationPlan` then attaches `lifecycle_apply` to **every** collected action and sets `schema_version: 2`:

```
operation_id: `${run_id}:${action_id}`
operation_kind: followUpEstimates → lead_snapshot_apply
                bookedJobs → booking_action_apply (raw Booked evidence)
granot_statement: complete collected row
expected_target?: preview Form/Call id when the planner found one
```

Schema-v1 or unsealed plans fail `assertSealedAutomationPlan` as `RUN_REPLAN_REQUIRED`. Checksum is `computeChecksum` over the sealed plan (`checksum_version: 1`, `artifact_kind: "ingestion_plan"`). Plan TTL 24h; `purge_at` 7 days.

Form planner (`formWorkflow.ts`): `resolveGranotFormLead` then a missing-field patch (quoted/cubic feet when `prior` is `1` or `5`; city/zip/state fill-if-missing; receiver agent only when the lead has none). `invalid` exists on the counter type; current `planRow` emits `update` / `unchanged` / `conflict` / `no_match` (known unused `invalid` / leftover `conflict()` helper).

Call planner: one `previewCallLeadEnrichment` / `previewBookedCallLeadReconciliation` per row plus a target binding.

## Apply happy path

```
GRANOT_AUTOMATION_APPLY_ENABLED === "true"
  → approveGranotRun (awaiting_approval + matching checksum + unexpired)
  → selected ids ⊆ approvable action ids (max 5000, unique)
  → status applying; publish wakeup
  → worker claims applying before queued/planning
  → each selected action: applyAutomationPlanAction
       (skip already-terminal receipts; pending → yield lease, status stays applying)
```

Unselected actions create no lifecycle receipt. Preview matching stays Owner guidance only.

`accepted_for_processing` and `pending_match` are pending (do not increment completed progress; yield `granot:automation:account` lease; resume the same operation ID). Dead letter / idempotency conflict is bounded `technical_failure`. Exact replay of a terminal receipt is skipped.

## Run records + worker

`GranotAutomationRun` stores the immutable plan, approval, lease, checkpoint, and per-action receipts `{ action_id, lifecycle_receipt_id, observation_id?, decision_id?, outcome, applied_at, error_code? }`. Lifecycle receipts/Observations/Decisions remain if the run later expires.

Account lease scope `granot:automation:account`, TTL 45 minutes. Approved `applying` work precedes new planning. `lease_busy` consumer ACKs (continuation comes from the winner). Provider `provider_error` / `invalid_session` requeues while `attempt_count < 3`; other failures are structural `failed`.

Admin `GET .../runs/:runId?details=owner` redacts `granot_statement` from the plan and never projects receipt payloads.

`runGranotAutomation` in `automation.ts` is the standalone collect/preview helper (no run document). Admin runs use `runWorkflow.ts`.

## Skip / fail

| Condition | Code / result |
|-----------|----------------|
| Apply flag off | `APPLY_DISABLED` |
| Expired / not awaiting / checksum mismatch | `RUN_NOT_APPROVABLE` |
| Selected id not approvable | `UNKNOWN_ACTION` |
| Approval update lost the race | `APPROVAL_RACE` |
| Unsealed / missing `lifecycle_apply` | `RUN_REPLAN_REQUIRED` |
| Source resolve miss / disabled / deferred / ambiguous / bad routes | `INVALID_GRANOT_SOURCES` |
| Collector auth / schema / size | HTTP 502, `GranotCollectorError.code` |
| Cron recoverable but no wakeup publish | 503 |

## Invariants

- Preview creates no Observation Receipt.
- Apply must not restore a direct Form/Call/Booked mutation bypass.
- `supported_operations` is not semantic apply authority; Registry routes are.
- Run-level `receipts` are not the Observation Receipt document.

## Related

- [`automation-apply.md`](../granot-lifecycle/automation-apply.md)
- [`capture.md`](../granot-lifecycle/capture.md)
- [`operations-registry.md`](./operations-registry.md)
- [`granot-http-automation.mdc`](../../../.cursor/rules/granot-http-automation.mdc)
- Tests: `granotHttpCollector.test.ts`, `runWorkflow.test.ts`, `formWorkflow.test.ts`, `sourceCatalog.test.ts`, `lifecycleStatement.test.ts`, `granot-automation.routes.test.ts`
