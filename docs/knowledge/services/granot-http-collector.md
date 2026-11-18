---
type: Service
title: Granot HTTP collector / automation
description: Scheduled Estimates in Process, Priority Pool collection and fenced application through Granot Lifecycle.
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
  - src/models/GranotEstimatesScheduleSlot.ts
  - src/services/granotHttpCollector/poolCron.ts
  - src/services/granotHttpCollector/estimatesCron.ts
  - src/services/granotHttpCollector/runWorkflow.ts
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
  at: 2026-10-14T21:00:00Z
---
# Scheduled Granot Estimates

The Estimates in Process cron schedules ALL hourly from 08:00 through 20:00 and at 22:00, 00:00, 02:00, 04:00 and 06:00 America/New_York. This gives 18 slots on ordinary and fall-back days and 17 on spring-forward days, when 02:00 is skipped. Each slot freezes its provider Open Date windows. The queue consumer and heartbeat share a worker that accepts the system actor `granot-estimates-in-process-cron`, an Estimates apply operation, a scheduled slot key and automatic approval. Dashboard-created runs, including already queued or approved manual work, have no worker. The Owner can read freshness at `GET /api/v1/admin/granot-automation/runs/freshness`.

The collector authenticates the Granot session and verifies the selectors, direct headers, pagination and totals before planning. Each eligible row gets a provider capture time and immutable operation identity. Apply verifies its lease, original expiry, plan checksum and closed-run index, then processes the receipt through the shared lifecycle. A retry can resume a pending match, recorded action or Outreach nomination by its original identity. It yields after 25 actions or 120 seconds. Freshness reports collection coverage, held rows, synchronization and failures for each scheduled lane.

The browser extension uses its own lifecycle ingestion endpoints. The scheduled collector and extension share the canonical authority for Lead mutations.

### Outreach job navigation (paused, 2026-10-30)

The shared-user Outreach opening endpoint is paused pending account-context qualification. `jobFormLink.ts` remains the historical lookup implementation and its strict page verifier is reused, but the Desk never calls its credential-user lookup. Other desks display **Attempting auth fix.** The separate Josh-only `granot-session-link` pilot uses `sessionJobLink.ts`: company/network authentication only, supplied user-context identity checked against Josh's configured Granot username, then a matching job lookup. It never submits the automation user's login or saves the rep's context. See the Desk Service for authorization, transient handling, browser GET handoff and evidence.

Existing automation continues its two-stage login through the same shared account lease and credential bindings. `authenticateGranotNetwork` is the shared first stage; `openGranotNetworkSession` stops there, while `openGranotAuthenticatedSession` still completes user login. `readGranotNetworkCredentials` reads only the existing network bindings, never `GRANOT_USERNAME`/`GRANOT_PASSWORD`. There are no new settings or changes to enrichment/scheduled collection.

## Priority Pool collection and recovery

The existing hourly Estimates dispatcher also schedules Pool refresh hourly from 08:00 through 20:00 and at 22:00, 00:00, 02:00, 04:00 and 06:00 America/New_York, after complete ALL collection for the same frozen slot, plus nightly Pool discovery at 06:00 from January 1, 2020 through today. Pool scheduling requires active Outreach configuration with Pool enabled. Refresh covers the trailing 90 inclusive provider Open Dates and every older observed provider Open Date month. A rolling 90-day-only query is insufficient: the inspected inventory included 227 Pool results older than that boundary. The nightly discovery floor is explicit; dates before 2020 are not claimed covered.

`granot_estimates_schedule_slots` freezes the complete scope before child runs exist. First insert wins when the date directory changes during a slot. The ALL parent durably records its correlated Pool intent before dispatch; recovery regenerates missing manifests and children outside the original cron hour. Disabled Pool manifests cannot block ALL recovery. Pool refresh remains ineligible until every declared ALL partition has complete collection. Deterministic identities distinguish Pool from ALL without changing existing ALL identities. The shared account lease serializes collection, and ordinary lifecycle matching, assignment protection and sheet transitions remain unchanged.

Discovery partitions are at most 31 days to fit the existing 120-second collection/planning budget; adaptive splitting still fails closed. Pool permits at most 256 total transport requests across session retries and 192 collection requests per child. Eighty historical children imply approximately 480 base authentication/form/report HTTP requests before adaptive splits and retries; the earlier shared-session inspection's 85 requests is not the production scheduler's traffic estimate. No authenticated session is persisted.

Freshness reports ALL, Pool refresh and Pool discovery separately, including missing children from durable manifests, oldest uncovered range, held rows, collection lag and synchronization progress. Complete ALL coverage never implies complete Pool coverage. Accepted live `already_current` Estimates decisions also refresh Pool membership before the ordinary open-subject nomination gate; held or unsuccessful decisions cannot admit Pool work. Webhook `priority_updated: 9` enters the same canonical membership policy through Lead change processing. See [release evidence](../../rep-desk-and-pool/POOL-RELEASE-2026-10-14.md).

## Observation time, assignments and freshness

Estimates seals each row's provider response time in `collection_captured_at` and passes it as receipt `captured_at`; plan-lock/application time must not replace it. Existing pending receipts are claimed directly with their original operation/time. New approval rejects missing-time actions. Already-approved legacy fresh actions without verified time become per-action `technical_failure` / `RUN_REPLAN_REQUIRED`, while independent stored receipts continue draining. Recollect before introducing new evidence. Queue continuations use distinct delivery identities so successive batches are not suppressed by deduplication.

Successful live Estimates receipts also nominate an ordinary `outreach_lead_change` refresh for an existing open subject, using the actual target from their Synchronization Decision, including an `already_current` Lead snapshot. The job identity is per receipt, independent of an already-completed Lead revision job. Both nomination and execution refuse missing/closed subjects; new admission remains owned by EntityChange. After refresh the ordinary evaluator is nominated even when the subject facts were already current, so its queue projection can converge. The normal every-minute desk crons drain these stages. A durable receipt marker permits crash-safe nomination replay without reapplying the canonical action; transient nomination failure keeps the run recoverable and prevents premature completion.

Reviewed automatic rep reassignment requires deployed `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS=true` so newer accepted Granot usernames can replace automatic assignments. One active Agent and valid priority remain required; `manual` and source-less assignments stay protected. Checked-in default remains off. Priorities 1/5 retain the existing qualified contact/move/cubic-feet and monotonic quoted policy; other priorities update identity/priority/assignment without broad enrichment. Deployment values, production verification and backfill manifests are recorded in [release evidence](../../granot-estimates-reliability/RELEASE.md).

Owner `GET /api/v1/admin/granot-automation/runs/freshness` returns `last_complete_coverage_at`, `latest_expected_slot` and latest-slot declared/collected/completed/failed window counts plus held-row totals. Full collection and completed synchronization are separate measures. Warnings expose missing complete coverage, partial scans, held rows, failed windows, pending synchronization and a missing complete expected slot after a 90-minute grace period. Older scope is every observed provider-date month; unobserved older Leads need discovery backfill. Queued does not mean refreshed, and complete collection does not imply every row synchronized.


## Capacity W5 bounded persistence subset (November 17, 2026)

Planning progress is advisory and persists at most every 25 rows or five seconds,
plus the existing final immutable plan lock. A crash still recollects/replans; the
cursor is never authority to skip rows. Every existing action/request lease gate reads both account and run ownership freshly from the primary, including owner/epoch/status and expiration fencing. Renew only within 22.5 minutes of the earlier persisted expiry; recheck the wall clock after reads, and retain fenced renewal and post-effect writes. There is no cached ownership authority.

The worker persists each embedded action outcome under the fenced run and records a successful Outreach nomination after it commits. The archive stores terminal scheduled runs with the plan, receipts and coverage. A verified archive allows the hot run to shrink to its operational freshness summary. The closed-run index prevents recreation of a scheduled child after its summary expires.

[W5 implementation evidence](../../capacity-review-2026-11-16/W5-IMPLEMENTATION.md) and the [Phase 2 qualification](../../operations/evidence/granot-stage-measurement.md) cover recovery across the original apply deadline.
