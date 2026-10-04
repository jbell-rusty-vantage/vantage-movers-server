---
type: Service
title: Granot lifecycle operational observability
description: Section 33 event catalog (structured logs), closed metric labels, bounded granot_lifecycle_health_state counters, rollout alerts, and Owner/Admin health projection.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/observability.ts
applies_to:
  - src/services/granotLifecycle/observability.ts
  - src/services/granotLifecycle/metrics.ts
  - src/services/granotLifecycle/alerts.ts
  - src/services/granotLifecycle/healthState.ts
  - src/models/GranotLifecycleHealthState.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/observability.ts
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
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 28.2 and 33  
**Primary code:** `src/services/granotLifecycle/observability.ts`, `src/services/granotLifecycle/metrics.ts`, `src/services/granotLifecycle/alerts.ts`, `src/services/granotLifecycle/healthState.ts`, `src/models/GranotLifecycleHealthState.ts`, `src/services/granotLifecycle/projections.ts` (`projectGranotLifecycleHealth`)  
**Domain terms used:** [Granot Observation](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [Booking Reconciliation](../../../../CONTEXT.md), [Release Reconciliation](../../../../CONTEXT.md)

# Granot lifecycle operational observability

**Role:** Write PII-safe structured log lines for the lifecycle event catalog, update exact Section 33 metrics, keep the bounded Health counters in `granot_lifecycle_health_state`, project Mongo-backed health, and evaluate the seven initial rollout alerts. None of this is business authority for a Lead, Booking, Cancellation, Record Link, case, or discrepancy.

**Retired store.** Until the 2026-10 server/admin slimming these events were also persisted as Operational Events (`operational_events`, incidents, notification deliveries). That subsystem was deleted (SLIM-04, [slimming specification](../../server-admin-slimming/SPECIFICATION.md) §4). `emitGranotLifecycleEvent` now writes one logger line and feeds the bounded Health state; nothing else is persisted per event.

## Event catalog

Literal keys are issue-author. Section 33 names the transitions. Landed underscore keys normalize one-way at `emitGranotLifecycleEvent`; callers must not emit both an alias and its canonical key for one transition.

Required keys: capture/queue failure, processing completed, technical retry scheduled, dead letter entered, manual requeue, Booking/Release case and discrepancy opened/refreshed/resolved, owner command applied/replayed/conflict, activation committed, and RingCentral adoption/conflict.

Allowed details are bounded enums, booleans, counts, durations, revisions, masked IDs, route templates, outcome/reason/error codes, execution mode, channel, case/discrepancy kind/mode, and trigger. Payload, credentials, contact, Job Number, source/actor labels, command body, reason/notes text, money, provider bodies, and stacks are rejected. Lifecycle events do not populate lead/contact columns.

Emission is best-effort and after the relevant durable commit, except failure transitions that report the failure itself. `emitGranotLifecycleEvent` never throws. Instrumentation failure cannot roll back receipt, case, command, activation, requeue, or aggregate outcomes. Activation provenance stays on `granot_lifecycle_activations` (`activated_by`). Manual requeue provenance (actor, reason, `dead_letter` → `pending`, `manual_requeue_count`) is one `DomainCommandExecution` row (`granot_lifecycle.receipt.requeue`, idempotency key `granot_lifecycle.receipt.requeue:<receipt id>:<manual_requeue_count>`) written inside the requeue transaction (`operations.ts`). Lifecycle identifier keys are normalized and masked case-insensitively; conflict labels are bounded codes.

Unit 31 routes lifecycle logger failures through a bounded error-code projection:
no `Error` object, stack, provider text, or full causal ID is serialized. The
certification scanner checks generated migration/shadow artifacts for synthetic
canaries, credential values, authorization values, and connection strings.

## Metrics

Exact Section 33 names live in `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES`. Receipt `event_class` is a route class or `"none"` for extension/automation receipts. Unknown labels are dropped. `open_cases` and `open_discrepancies` are current-cardinality gauges recomputed from Mongo during health projection. Replay has its own event and does not increment an applied effect twice. Health never depends solely on process-local counters.

## Health state (`granot_lifecycle_health_state`)

`healthState.ts` over the `GranotLifecycleHealthState` model, in the selected runtime database. Rows have a deterministic string `_id`, so every write is one atomic upsert:

| `_id` (kind) | Holds |
| --- | --- |
| `coverage` | `counters_since` (first write after the cutover), `last_write_at`, `gap_at` (latest missed counter write) |
| `bucket:<metric>:<dimension>:<minute>` | One per-minute counter. Metrics: `capture_failed`, `claim_recovered`, `owner_command_conflict` (dimension = the closed conflict code, otherwise `all`). Unique `granot_lifecycle_health_bucket_unique`; `expires_at` TTL `granot_lifecycle_health_expires_ttl` removes buckets after 48 hours |
| `last_run:<queue or cron>` | Latest queue or cron drain run: `completed` or `failed`, and its time |
| `alert:<code>:<scope>` | Persisted alert state (`firing` or `ok`, `since`) for transition dedupe across replicas and restarts |

`emitGranotLifecycleEvent` maps `granot_lifecycle.capture.failed`, `granot_lifecycle.claim.recovered`, `granot_lifecycle.owner_command.conflict` and `granot_lifecycle.{queue,cron}.run.{completed,failed}` onto these rows. No per-event rows, payloads, contact fields or free text are stored.

Counting started unseeded at the slimming cutover. A window reads as **unknown** (null counts, `insufficient_data` alerts), never zero, until counting covers the whole window, when the state is stale (no write for 20 minutes), or when `gap_at` falls inside it. A failed counter write while Mongo is connected writes `gap_at` at once; after a disconnect the process fences the remembered miss on the next reconnection. Residual: a process frozen or recycled before it reconnects or writes again loses that marker; the staleness rule only catches a total writer outage.

## Health and alerts

`GET /api/v1/admin/granot-lifecycle/operations/health` remains the single Owner/Admin read. The Admin Health page is `/granot-lifecycle/health` (`GRANOT_LIFECYCLE_HEALTH_HREF`). The GET path did not move. Due work is pending/retry plus claimed-only-when-lease-expired with `next_attempt_at <= now`. Health includes generated time, ten flags, activation, receipt/due/dead-letter counts plus `by_work_state` and `expired_claim_count`, 24-hour Decision groups with execution mode, open cases/discrepancies, `command_conflicts_last_24h` (`null` while its 24-hour window is unknown), `counter_coverage`, `record_links: { active, disputed }`, last queue/cron runs, RingCentral lease/cursor telemetry, and the seven frozen alert codes.

`GRANOT_LIFECYCLE_ALERT_THRESHOLDS` (not env-overridable): `oldest_due_ms` 15 minutes, `oldest_due_continuity_ms` 10 minutes, `dead_letter_count` 0, `capture_503_count` 0, `claim_recovery_per_hour` 5, `capture_to_decision_p95_ms` 10 minutes, `ringcentral_lease_held_ms` 10 minutes, `source_ambiguity_policy_blocked_rate` 0.05, `health_window_ms` 24 hours, `claim_recovery_window_ms` 1 hour.

Oldest due > 15 minutes continuously for 10 minutes (tracked from the current oldest due timestamp crossing the threshold), any dead letter, any capture 503 in 24 hours, claim recoveries > 5 in 1 hour, p95 capture-to-decision > 10 minutes over 24 hours, RingCentral lease held > 10 minutes, and ambiguity/policy-blocked rate > 5% over 24 hours for sources with both `enabled` and `lifecycle_enabled` true and a non-deferred disposition. Empty p95/rate samples are `insufficient_data`; that state never recovers an open alert. p95 is nearest-rank. Public source scope is a masked Registry reference. Firing/recovery persist the alert row in `granot_lifecycle_health_state` and log `granot_lifecycle.alert.firing` / `granot_lifecycle.alert.recovered` once per transition; repeated evaluation does not fan out. There is no incident record and no alert email.

`open_cases` gauge keys are `kind|mode` (`create_missing_booking`, `review_existing_booking`, `create_referral_booking`, `release`). `open_discrepancies` keys are `kind|reason_code`.

Alert evaluation cannot pause capture or processing. `GRANOT_LIFECYCLE_EMAIL_ENABLED` stays unrelated and false.
