---
type: Service
title: Call and Sales Intelligence foundation
description: Shared CSI contracts, persistence, Owner/rep authorization, durable jobs with the retired-stage fence, policy/settings, Call activity retention and Owner live SSE for the retained Numbers and RingCentral Accounts surface.
tags: [sales-intelligence, durable-work]
status: draft
stale_after: 2027-01-31
resource: src/services/salesIntelligence/
applies_to:
  - src/services/salesIntelligence/jobs.ts
  - src/services/salesIntelligence/transactions.ts
  - src/services/salesIntelligence/auth.ts
  - src/services/salesIntelligence/policy.ts
  - src/services/salesIntelligence/settings.ts
  - src/services/salesIntelligence/retention.ts
  - src/services/salesIntelligence/retentionPolicy.ts
  - src/services/salesIntelligence/live.ts
  - src/services/salesIntelligence/deploymentStamp.ts
  - src/config/domain/salesIntelligence.ts
  - src/models/salesIntelligence/
  - src/routes/sales-intelligence-boundary.routes.ts
  - src/routes/sales-intelligence-cron.routes.ts
  - api/queues/sales-intelligence-consumer.ts
owners: [team:main-server]
sources:
  - id: slimming
    resource: docs/server-admin-slimming/SPECIFICATION.md
    title: Server and Admin slimming specification (§7.3–7.4)
  - id: interim-contract
    resource: docs/server-admin-slimming/evidence/S-NUM-CONTRACT.md
    title: Interim Numbers and RingCentral Accounts contract
generated:
  by: process:docs-keeper
  at: 2026-10-04T00:00:00Z
---

# Call and Sales Intelligence foundation

Shared primitives for the retained Sales Intelligence surface: **Numbers and RingCentral Accounts only**. The 2026-10 server/admin slimming removed recording media, transcription, analysis, Move assessment, the Outreach/Attention planner, the AI budget and the scoped AI-run routes ([slimming specification](../../server-admin-slimming/SPECIFICATION.md) §7). Their Service docs are marked retired. Feature behavior lives in [number-activity-capture.md](./number-activity-capture.md), [number-activity-reads.md](./number-activity-reads.md), [sales-intelligence-attachment.md](./sales-intelligence-attachment.md), [sales-intelligence-rep-identity.md](./sales-intelligence-rep-identity.md), [sales-intelligence-nudges.md](./sales-intelligence-nudges.md) and [sales-intelligence-live.md](./sales-intelligence-live.md).

## Flags

`csiFlag` (`src/config/domain/salesIntelligence.ts`) reads `SALES_INTELLIGENCE_<NAME>`; a flag is on only when the trimmed value is `true`. Every flag defaults off. Retained names (`CSI_FLAGS`): `ENABLED` (Owner reads/commands and the retention cron), `CAPTURE_WEBHOOK`, `CAPTURE_CALL_LOG`, `DIRECTORY_SYNC`, `ATTACHMENT_REFRESH`, `AUTO_ATTACH`, `NUDGE_ENABLED`, `WEBHOOK_AUTO_CREATE`, `FORM_LEAD_NUMBERS`, `NUMBERS_HAS_CALLS_DEFAULT`, `RECEIVER_LATEST_WINS` (read by the Granot lifecycle Lead planner) and `REP_ACCESS`. Capture is operational work and does not depend on `ENABLED`. Names and the retired list: [environment.md](../environment.md).

## Mongo, commands and audit

Mongo is authoritative. `executeCsiCommand` (`transactions.ts`) combines revision CAS (`csiCas`), the idempotency receipt in `sales_intelligence_command_executions`, the CSI audit row and any downstream job in one transaction. Same key + same payload hash replays the stored result; a different payload is `IDEMPOTENCY_CONFLICT`. `assertIndexes` fails closed with `INDEX_REQUIRED` when a unique fence is missing; runtime never creates indexes. `appendCsiAudit` accepts only the retained invalidation kinds; the stored enum still accepts historical kinds. **Disk trim (2026-10-07):** audit rows are Owner/desk history only. The worker call-capture kinds (`interaction.*`, `capture_projection.completed`, `call_log_refresh.completed`, the retired `attachment_*`) are no longer written and their backlog was deleted; every remaining row expires 90 days after `happened_at` (`csi_audit_happened_ttl`, declared on the model like `csi_job_completed_ttl`). Idempotency replay never depends on an audit row: it reads `sales_intelligence_command_executions`, which has no TTL. Reuse `db.withTransaction`, runtime database routing and canonical payload hashing. Do not add CSI origins or entities to official domain-command enums. CSI never writes `EntityChange`.

## Durable jobs (`jobs.ts`)

Retained stages (`CSI_JOB_STAGES`): `capture_projection`, `call_log_reconcile`, `call_log_refresh`, `directory`, `lead_link` (All Numbers), `nudge_repair`, and the Sales Outreach Desk stages (`outreach_contact_change`, `rep_sms_sync`, `rep_sms_remap` (olr C7, Accounts re-map), `outreach_lead_change`, `outreach_evaluate`, `outreach_rep_day`).

- `enqueueCsiJob` dedupes on the unique key inside the caller's transaction and initializes `createdAt`/`updatedAt` from its `now` only on insertion, so a matching duplicate changes no stored bytes. Payload hash and dataset conflicts still apply.
- Claims fence lease owner, epoch and expiry; renew/continue/complete/fail all require `status: "leased"` with the claimed epoch. `continueCsiJob` commits a bounded batch and returns the job to pending without charging an attempt. `failCsiJob` reasons are `transient`, `schema_invalid` (back off, dead-letter when exhausted) and `throttled` (defers without spending an attempt; optional provider `resumeAt`).
- **Retired-stage fence.** `CSI_RETIRED_JOB_STAGES` lists what earlier releases wrote: `outreach_ensure`, `outreach_derive`, `recording_discovery`, `media`, `media_fetch`, `transcription`, `analysis`, `application`, `number_refresh`, `backfill`, `retention`, `rep_identity_reevaluate`, `move_assessment`, and since All Numbers phase B `attachment_refresh` and `rebuild`. `enqueueCsiJob` refuses them (`INVALID_INPUT`, `stage_retired`); claims only lease retained stages. `retireLegacyCsiJobs` (batches of 500) sets runnable rows of a retired stage to `status: "retired"`, `reason: "stage_retired"`, clears the lease and bumps `lease_epoch`, so an old deployment's in-flight lease can no longer commit. It does **not** set `completed_at`: the 14-day completed TTL never removes a fenced row, and the slimming purge backs it up and deletes it. Job recovery runs this sweep first; the queue dispatcher terminalizes a wake-up for a retired-stage row the same way and acknowledges it with no provider call.
- Completed jobs keep the 14-day `completed_at` TTL. Pending, leased, retry, paused and dead-letter rows never expire.

`node --import tsx ops/test-csi-enqueue-replica.ts` (`pnpm test:csi:fence:replica`) proves enqueue dedupe and the retired-stage fence on a disposable test database on the local `rs0` replica at `127.0.0.1:27017` ([CLOUD_AGENTS.md](../../../CLOUD_AGENTS.md#mongodb-must-be-running-and-must-be-a-replica-set)). It accepts no target override and drops only its own randomly named database. Do not route that port to a remote deployment.

## Queue and crons

`api/queues/sales-intelligence-consumer.ts` handles `{ job_id }` wake-ups on `sales-intelligence-events*` through `numberActivity/jobDispatch.ts` (handlers: `capture_projection`, `lead_link`, `nudge_repair`, `call_log_refresh` and the desk stages). Cron recovery claims the same jobs, so a lost wake-up loses nothing and a duplicate hits the claim fence.

`sales-intelligence-cron.routes.ts` (Bearer `CRON_SECRET` or `x-cron-secret`; disabled → `{ ok: true, skipped: true, reason: "disabled" }`, lease held → `reason: "lease_held"`):

| Path | Schedule | Work |
| --- | --- | --- |
| `/api/cron/sales-intelligence-job-recovery` | every minute | retire legacy jobs, deployment stamp, coverage refresh, `lead_messages.to` index ensure; then receipt recovery + capture drain (`CAPTURE_WEBHOOK`, plus provisional settle when `CAPTURE_CALL_LOG` is off), the All Numbers lead-link step (`ENABLED`: the `lead_link_entity_changes` Lead-change scan, then the `lead_link` drain), and the `nudge_repair` (`NUDGE_ENABLED`), `call_log_refresh` and `rep_sms_sync` (`CAPTURE_WEBHOOK`) and `rep_sms_remap` (`ENABLED`, olr C7) drains |
| `/api/cron/sales-intelligence-call-log-reconcile` | `3-59/5` | Call Log reconcile (`CAPTURE_CALL_LOG`) |
| `/api/cron/sales-intelligence-call-log-sweep` | 07:40 UTC | nightly authoritative sweep (`CAPTURE_CALL_LOG`) |
| `/api/cron/sales-intelligence-directory-sync` | 05:20 UTC | directory snapshot (`DIRECTORY_SYNC`) |
| `/api/cron/sales-intelligence-webhook-subscription` | 06:15 UTC | renew/repair the owned all-direction subscription (`CAPTURE_WEBHOOK`; create only with `WEBHOOK_AUTO_CREATE`) |
| `/api/cron/sales-intelligence-subscription-health` | every 5 minutes | read-only `calls` / `rep_sms` subscription health on sync-state `webhook_subscription_health:<channel>` (`CAPTURE_WEBHOOK`; never mutates; see the Sales Outreach Desk Service) |
| `/api/cron/sales-intelligence-nudge-repair` | every 5 minutes | nudge receipt repair (`ENABLED` and `NUDGE_ENABLED`) |
| `/api/cron/sales-intelligence-retention` | 04:30 UTC | Call activity retention (`ENABLED`) |

The extract, apply, transcribe, media-fetch, Outreach ensure, Attention publish, Overview refresh and backfill-step crons were removed with their pipeline.

## Authorization (`auth.ts`)

- `/api/v1/admin/sales-intelligence/*` passes the boundary router (`ENABLED`, signed reader, production scope; any other `scope` is 403 `UNSUPPORTED_SCOPE`). Every interim route then calls `requireCsiOwner`: the signed Registry Owner verifier after the unchanged v1 chain. The Admin role, a scoped key and a signed rep get 403 `OWNER_REQUIRED`, because Numbers carry full customer numbers and no rep scope exists for them.
- `requireCsiReader` still admits a signed rep when `REP_ACCESS` is on (the admin proxy signs `x-vantage-admin-agent-id` as an eighth canonical line), but no retained admin route accepts one. The old rep reads and follow-up commands left with Outreach.
- The scoped AI-run routes `/api/v1/internal/sales-intelligence/runs/:id/*`, their run tokens and the scoped key's access are retired: no router serves them. `SALES_INTELLIGENCE_SCOPED_KEY_NAME` remains only so the scoped key entry in `VANTAGE_SCOPED_API_KEYS` is refused (`RUN_SCOPE_DENIED`) until that entry is removed.
- The MCP history reads `/api/v1/internal/sales-intelligence/history/*` accept the broad secret or a signed-in user, never the scoped key or a rep ([number-activity-reads.md](./number-activity-reads.md)).

## Policy and settings

`GET`/`PATCH /api/v1/admin/sales-intelligence/settings` use `readCsiSettings` / `commandCsiSettings` over `resolvePolicy`, `initializeCsiPolicy` and `updateCsiPolicy`. GET never writes. The policy (`csiPolicySchema`, strict on write) is `{ version, timezone, staffed_hours, enabled_capabilities: ("capture"|"nudges"|"live")[], retention: { audit_days } }`. Older stored versions are read through `csiStoredPolicySchema`, which ignores retired fields and capability names without rewriting them. `PATCH` rejects a retired field. A new version carries the active version's retired fields forward unchanged (`withRetiredPolicyFields`) so a pre-slimming build rolled back during the observation window can still parse it; a first `initializeCsiPolicy` in a fresh environment does not. Deployment `csiFlag` switches are displayed and are not PATCH-able. Retained policy readers: Owner coverage (staffed clock), nudge eligibility (`nudges` capability) and retention (`audit_days`).

## Retention (`retention.ts`)

The daily cron purges Call activity only. Under its own lease (fenced inside each transaction), `call_interactions` older than the activity window lose parties, legs, recordings, external number and provider names; provider ids and aliases stay so replay cannot resurrect a call. Stale `contact_numbers` are tombstoned with the retained rollup shape, their attachments are deleted, and nudge content tied to that Number is redacted. The window is the persisted policy's `retention.audit_days`, else `SALES_INTELLIGENCE_RETENTION_ACTIVITY_DAYS` (default 730; `0` disables). It never reads a retired collection and never touches `sales_intelligence_jobs`. Blob audio deletion, transcript/analysis purges and Outreach writes were removed.

## Deployment stamp

`deploymentStamp.ts` records the deployed commit once per process in `sales_intelligence_sync_state` scope `deployment` (Vercel production only; `VERCEL_GIT_COMMIT_SHA`, or `DEPLOYMENT_COMMIT_SHA` for CLI deploys, plus `VERCEL_DEPLOYMENT_ID`). Operator scripts that write production compare against it and refuse a different tree. It never throws.

## Models

`src/models/salesIntelligence/` keeps capture, infrastructure (jobs with the `retired` status), review (owner instructions, review items, contact restrictions) and common schemas. Outreach, follow-up, Attention, overview, intelligence and assessment models were deleted. The Job model no longer has `evidence_fence`, `result_ref`, `owner_reanalysis` or `rep_identity_window`; the purge unsets them on old rows ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)).
