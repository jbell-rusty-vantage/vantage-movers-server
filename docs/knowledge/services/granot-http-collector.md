---
type: Service
title: Granot HTTP collector / automation
description: HTTP session collector; approved apply captures granot_http_automation receipts and enters the shared lifecycle claim.
tags: [granot-lifecycle, automation]
status: draft
stale_after: 2027-01-14
resource: src/services/granotHttpCollector/
applies_to:
  - src/services/granotHttpCollector/index.ts
  - src/services/granotHttpCollector/estimatesInProcess.ts
  - src/services/granotHttpCollector/estimatesCollection.ts
  - src/services/granotHttpCollector/estimatesIdentityPlanning.ts
  - src/models/GranotEstimatesOpenDate.ts
  - src/services/granotHttpCollector/estimatesCron.ts
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
  by: process:owner-instructions
  at: 2026-10-13T18:10:00Z
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

Local/non-Vercel workers may run without a queue publish. Do not log credential values.

The collector signs in through two Granot pages, in order. `readCredentials()` prefers `GRANOT_NETWORK_USERNAME` / `GRANOT_NETWORK_PASSWORD` and `GRANOT_USERNAME` / `GRANOT_PASSWORD`. Each legacy alias is used only when its `GRANOT_*` name is empty: `MAIN_LOGIN_USERNAME` / `MAIN_LOGIN_PASSWORD` for the network page, and `SPECIFIC_USERNAME` / `SPECIFIC_PASSWORD` for the user page.

| Page | Request | Posted fields | Env, in order |
|------|---------|---------------|---------------|
| Network Login | `GET /wc.dll?mp~NetLogonWc~VANTAGE`, then POST `mp~netlogonret` | `LOGON_USER`, `PASSWORD` | `GRANOT_NETWORK_*`, else `MAIN_LOGIN_*` |
| User Login | POST `mp~loginret~{session}~login` | `USERNAME`, `PASSWORD`, `LOGON=Login` | `GRANOT_USERNAME` / `GRANOT_PASSWORD`, else `SPECIFIC_*` |

`/vantage/admin.htm` is the unsigned frame that loads the network login. It is not the main menu. After the user POST the session is the cookie jar plus the id in `mv~mainmenuwc~{session}~LOGIN`. A copied `wc.dll` URL without those cookies returns Granot's cookie security alert. `SAVEPASS` is dropped before the network POST.

## Workflows

| Workflow | After plan lock |
|----------|-----------------|
| `preview` | Status `completed`. No approval. No lifecycle receipt. |
| `apply` | `awaiting_approval` if any approvable action exists; otherwise `completed` with no approval step |

Operations: `form_leads`, `call_leads` or `estimates_in_process`. Preview never creates a Lead or lifecycle receipt.

**Approvable:** legacy Form `classification === "update"`; legacy Call `syncable`. Estimates uses canonical normalization, Registry policy and `resolveLeadIdentity` before classifying matched valid snapshots as lifecycle checks. Apparent no-ops still reach the canonical desired-state planner. Malformed, unmatched, ambiguous and conflicting snapshots remain held. Legacy preview classifiers do not gate Estimates identity. Apply revalidates the expected target and current authority.

Create body: `from`/`to` as real `MM/DD/YYYY`; `source_ids` **or** `source_labels` (not both); optional filters default `date_factor=OPEN`, `type=ALL`, `status=10`. Max 50 sources.

## Source catalog vs apply routing

`GranotAutomationSource.supported_operations` remains a list/create compatibility field. List/create return label + operations plus an additive `compatibility` projection from `evaluateGranotAutomationCompatibility`.

`ready` requires a referenced `GranotCrmSource` that is operationally enabled, `lifecycle_enabled`, not `deferred`, unambiguous on `normalized_granot_label`, and whose `lifecycle_routes` permit the requested Form/Call operation. Missing `granot_crm_source` → `missing_reference`. New admin labels start that way until an Owner or reviewed migration attaches an exact Registry row.

Run-group resolve asks each selected source only for the requested operations its Registry routes permit, then partitions by those routes. A Form-only source in a Form+Call group stays `available_for_apply` and lands in `form_leads`. A source whose routes permit none of the requested operations still fails `operation_not_permitted`.

`resolveGranotAutomationSources` (the **`source_ids`** path, including run-groups) fails closed with `INVALID_GRANOT_SOURCES` and per-source issues when the row is missing, inactive, unclassified, not `available_for_apply`, or has no Registry route for the operation. Duplicate/malformed IDs fail the same code.

**Known gap:** `createGranotRun` with **`source_labels` only** does not call `resolveGranotAutomationSources`. Compatibility is enforced on `source_ids` / run-groups, not on the label-only create path.

Reviewed `link_only` / `create_if_missing` families and Auto-deferred posture live in [`operations-registry.md`](./operations-registry.md). This evaluator does not hard-code those labels.

Create-source limit is 200 labels. Exact duplicate label → `GRANOT_SOURCE_ALREADY_EXISTS`.

## Collector happy path

```
network login (LOGON_USER) → user login (USERNAME)
  → report menu → DATE1/DATE2 filter
  → source selector (adverlistwc links)
  → each requested label: parse Booked Jobs + Follow Up Estimates
```

Date window must be real calendar `MM/DD/YYYY` and `to >= from` (`invalid_request`). Session pages that look like login/security → `invalid_session` (collector retries the whole session once). Missing expected page or invalid table headers → `schema_drift`. Cross-origin redirect / HTTP failure / timeout → `provider_error`. Body over 10 MB → `response_too_large`.

A recognized table needs headers `job_no` and `customer`. Data rows also require a numeric `no` plus `job_no` or `customer`. Default collector host is `https://eagle.hellomoving.com`; 20s per request.

`buildGranotOperationPayloads` maps Follow Up → enrichment rows and Booked Jobs → booked-reconciliation rows. `user` or `rep` becomes `granot_crm_username`.

## Estimates in Process

A second collector, `collectEstimatesInProcess`, and a run operation `estimates_in_process`. `collectGranotReport` keeps walking the source-company report above and still requests `mprep`. It does not request `estprocesswc`. The Estimates collector shares the two-page login (`openGranotAuthenticatedSession`) and the account lease `granot:automation:account`. After login it opens `mv~estprocesswc` and POSTs `mv~estprocessret` with `STATUS=V9`, `TYPEDTE=OPEN`, `DATE1` and `DATE2` from the run, `FUSTATUS=10`, empty `USER`, `DEPT=ALL`, `TYPE=V1`, `SORT=V6`. It does not post `STATUS=V15` and does not request `mprep`. The table has no numeric `no` column, so a separate parser maps rows onto the statement keys the normalizer already reads and drops the totals row that has no job number. Priority is one unambiguous `prior:` value inside `follow_up`. Exact observed `prior: Pool` maps to 9 only with the verified Pool=9 selector; ALL=10 is a filter only. This adds parser support, not a Pool workflow.

`estimatesCollection.ts` validates enabled query selectors, required direct headers, direct-cell alignment, explicit empty reports, same-session pagination and transaction totals. Multi-day reports split adaptively when their renderer is incomplete; incomplete single-day results, unsafe/repeated pages and out-of-request Open Dates fail closed. Blank individual values are allowed where the column exists. Malformed or conflicting priority evidence stays held. Optional phone2 and provider Open Date remain evidence, not new matching keys.

`estimatesIdentityPlanning.ts` resolves each observed source through canonical Registry policy and each normalized row through the same identity ladder as apply. Form matching uses Record Link/reference before scoped contact; Call matching uses Record Link/equivalent Job before unique qualified non-duplicate phone evidence within Source Granularity. Sparse canonical matches must not be suppressed by legacy previews. Missing/ambiguous/deferred sources and unresolved/conflicting matches stay held; missing/ambiguous usernames are reported. Matched valid snapshots carry explicit `expected_target` and enter `lead_snapshot_apply`; unmatched snapshots never create a Lead. Writes stay in `synchronizeLeadFromGranot`, followed by EntityChange and Outreach subject/cadence synchronization.

`ALL /api/cron/granot-estimates-in-process` (`CRON_SECRET`, `vercel.json` `0 * * * *`) runs only when the America/New_York hour is 8, 13, or 18. Every slot schedules the trailing 90 inclusive Open Dates in durable windows of at most seven days, plus older months containing verified provider Open Date evidence. Each child has a deterministic slot-and-window run identity. The `granot_estimates_open_dates` collection retains verified dates from complete scheduled and manual snapshots; older Leads without such evidence require discovery backfill. Ingestion timestamps are not used as provider dates. The cron sets `auto_apply` and applies approvable rows without waiting for an Owner and without `GRANOT_AUTOMATION_APPLY_ENABLED`. Owner-created apply runs, including an Owner `estimates_in_process` apply, still stop at `awaiting_approval` and still require that flag. Lifecycle lead-write gates are unchanged: when they are off, the processor persists the suppressed decision. The cron initiator is the system actor `granot-estimates-in-process-cron` with `origin` `vantage_admin`, which is what automation capture requires. The procedure and columns are in [granot-priorities-and-rep-desk.md](../granot-priorities-and-rep-desk.md). The build contract is [estimates-in-process-update.md](../estimates-in-process-update.md). The default radio on that form, Today’s Recent 50 Estimates Priority 0, is a different query.

## Plan schema v2

Legacy `planGranotFormWorkflow` / `planCallWorkflow` emit schema v1; `sealAutomationPlan` adds lifecycle blocks and emits v2. Estimates canonical planning directly emits v2 with held and matched actions:

```
operation_id: `${run_id}:${action_id}`
operation_kind: followUpEstimates → lead_snapshot_apply
                bookedJobs → booking_action_apply (raw Booked evidence)
granot_statement: complete collected row
expected_target?: canonical preview target for Estimates; legacy preview target otherwise
collection_captured_at: Estimates provider response time (sealed action metadata)
```

Schema-v1 or unsealed plans fail `assertSealedAutomationPlan` as `RUN_REPLAN_REQUIRED`. Checksum is `computeChecksum` over the sealed plan (`checksum_version: 1`, `artifact_kind: "ingestion_plan"`). Plan TTL 24h; `purge_at` 7 days.

Leads & Advertising Form planner (`formWorkflow.ts`): `resolveGranotFormLead` then a missing-field patch (quoted/cubic feet when `prior` is `1` or `5`; city/zip/state fill-if-missing; receiver agent only when the lead has none). `invalid` exists on the counter type; current `planRow` emits `update` / `unchanged` / `conflict` / `no_match` (known unused `invalid` / leftover `conflict()` helper).

Leads & Advertising Call planner: one `previewCallLeadEnrichment` / `previewBookedCallLeadReconciliation` per row plus a target binding.

## Apply happy path

```
GRANOT_AUTOMATION_APPLY_ENABLED === "true"
  (skipped only for an estimates_in_process run whose request_snapshot.auto_apply is true)
  → approveGranotRun (awaiting_approval + matching checksum + unexpired)
  (the estimates cron writes that approval itself, as the system actor, before the worker applies)
  → selected ids ⊆ approvable action ids (max 5000, unique)
  → status applying; publish wakeup
  → worker claims queued/planning/eligible applying in one least-recent-attempt queue
  → each selected action: applyAutomationPlanAction
       (skip terminal receipts; direct canonical claim for an existing pending receipt)
  → yield after 25 actions or 120 seconds, preserving independent action progress
```

Unselected actions create no lifecycle receipt. Preview matching stays Owner guidance only.

`accepted_for_processing` and `pending_match` are pending (do not increment completed progress; yield `granot:automation:account` lease; resume the same operation ID). Dead letter / idempotency conflict is bounded `technical_failure`. Exact replay of a terminal receipt is skipped.

## Run records + worker

`GranotAutomationRun` stores the immutable plan, approval, lease, checkpoint, and per-action receipts `{ action_id, lifecycle_receipt_id, observation_id?, decision_id?, outcome, applied_at, error_code? }`. Lifecycle receipts/Observations/Decisions remain if the run later expires.

Account lease scope `granot:automation:account`, TTL 45 minutes. One least-recent-attempt queue gives fresh collection and approved actions bounded progress alongside eligible waiting-match retries. Apply yields after 25 actions or 120 seconds; fresh remaining actions checkpoint `apply`, pending-only runs checkpoint `waiting_match`. Estimates collection/planning has a shared 120-second budget, checked around all network requests including login and before each planned row. Budget failure requests smaller date windows and cannot claim complete coverage. `lease_busy` consumer ACKs (continuation comes from the winner). Provider `provider_error` / `invalid_session` requeues while `attempt_count < 3`; other failures are structural `failed`.

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
- [`estimates-in-process-update.md`](../estimates-in-process-update.md) — current Estimates contract; keeps Leads & Advertising available.
- Tests: `granotHttpCollector.test.ts`, `runWorkflow.test.ts`, `formWorkflow.test.ts`, `sourceCatalog.test.ts`, `lifecycleStatement.test.ts`, `granot-automation.routes.test.ts`


## Reviewed bounded Estimates apply

An Owner may POST `/api/v1/admin/granot-automation/runs/:runId/apply-reviewed-estimates`
with `plan_checksum` and `selected_action_ids` after reviewing a completed Estimates
preview. The stored Open Date window must contain 1–90 inclusive real calendar dates
ending no later than today in America/New_York. The unexpired schema-v2 plan and checksum
are reused only when selected actions retain verified provider capture times. Only selected approvable actions are authorized;
conflicts, unmatched rows, and unresolved sources cannot be selected. A fenced state
change promotes the preview to `workflow: apply`, sets `request_snapshot.auto_apply: true`,
and stores the signed Owner approval. The existing worker and lifecycle apply perform
the effects. This narrow path skips the ordinary automation flag, retains every
lifecycle gate, and cannot promote form/call runs. Ordinary `/approve` keeps its gate.

The recurring cron covers its full declared scope at 8, 13, and 18 New York.
A deterministic run `_id` keyed by slot and date window makes retries and concurrent
invocations reuse the same run, plan, and lifecycle operation IDs.
The existing Mongo `_id` index enforces uniqueness; no index migration is required.


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

## Observation time, assignments and freshness

Estimates seals each row's provider response time in `collection_captured_at` and passes it as receipt `captured_at`; plan-lock/application time must not replace it. Existing pending receipts are claimed directly with their original operation/time. New approval rejects missing-time actions. Already-approved legacy fresh actions without verified time become per-action `technical_failure` / `RUN_REPLAN_REQUIRED`, while independent stored receipts continue draining. Recollect before introducing new evidence. Queue continuations use distinct delivery identities so successive batches are not suppressed by deduplication.

Reviewed automatic rep reassignment requires deployed `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS=true` so newer accepted Granot usernames can replace automatic assignments. One active Agent and valid priority remain required; `manual` and source-less assignments stay protected. Checked-in default remains off. Priorities 1/5 retain the existing qualified contact/move/cubic-feet and monotonic quoted policy; other priorities update identity/priority/assignment without broad enrichment. Deployment values, production verification and backfill manifests are recorded in [release evidence](../../granot-estimates-reliability/RELEASE.md).

Owner `GET /api/v1/admin/granot-automation/runs/freshness` returns `last_complete_coverage_at`, `latest_expected_slot` and latest-slot declared/collected/completed/failed window counts plus held-row totals. Full collection and completed synchronization are separate measures. Warnings expose missing complete coverage, partial scans, held rows, failed windows, pending synchronization and a missing complete expected slot after a 90-minute grace period. Older scope is every observed provider-date month; unobserved older Leads need discovery backfill. Queued does not mean refreshed, and complete collection does not imply every row synchronized.
