---
type: Service
title: Granot lifecycle operational observability
description: Section 33 event catalog, closed metric labels, rollout alerts, and Owner/Admin health projection.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/observability.ts
applies_to:
  - src/services/granotLifecycle/observability.ts
  - src/services/granotLifecycle/metrics.ts
  - src/services/granotLifecycle/alerts.ts
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
**Primary code:** `src/services/granotLifecycle/observability.ts`, `src/services/granotLifecycle/metrics.ts`, `src/services/granotLifecycle/alerts.ts`, `src/services/granotLifecycle/projections.ts` (`projectGranotLifecycleHealth`)  
**Domain terms used:** [Granot Observation](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [Booking Reconciliation](../../../../CONTEXT.md), [Release Reconciliation](../../../../CONTEXT.md), [Operational Event](../../../../CONTEXT.md)

# Granot lifecycle operational observability

**Role:** Emit PII-safe Operational Events, update exact Section 33 metrics, project Mongo-backed health, and evaluate the seven initial rollout alerts. None of this is business authority for a Lead, Booking, Cancellation, Record Link, case, or discrepancy.

## Event catalog

Literal keys are issue-author. Section 33 names the transitions. Landed underscore keys normalize one-way at `emitGranotLifecycleEvent`; callers must not emit both an alias and its canonical key for one transition.

Required keys: capture/queue failure, processing completed, technical retry scheduled, dead letter entered, manual requeue, Booking/Release case and discrepancy opened/refreshed/resolved, owner command applied/replayed/conflict, activation committed, and RingCentral adoption/conflict.

Allowed details are bounded enums, booleans, counts, durations, revisions, masked IDs, route templates, outcome/reason/error codes, execution mode, channel, case/discrepancy kind/mode, and trigger. Payload, credentials, contact, Job Number, source/actor labels, command body, reason/notes text, money, provider bodies, and stacks are rejected. Lifecycle events do not populate lead/contact columns.

Emission is best-effort and after the relevant durable commit, except failure transitions that report the failure itself. Activation and manual-requeue audit writes also run after their business transaction commits. Instrumentation failure cannot roll back receipt, case, command, activation, requeue, or aggregate outcomes. Lifecycle identifier keys are normalized and masked case-insensitively; conflict labels are bounded codes.

Unit 31 routes lifecycle logger failures through a bounded error-code projection:
no `Error` object, stack, provider text, or full causal ID is serialized. The
certification scanner checks generated migration/shadow artifacts for synthetic
canaries, credential values, authorization values, and connection strings.

## Metrics

Exact Section 33 names live in `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES`. Receipt `event_class` is a route class or `"none"` for extension/automation receipts. Unknown labels are dropped. `open_cases` and `open_discrepancies` are current-cardinality gauges recomputed from Mongo during health projection. Replay has its own event and does not increment an applied effect twice. Health never depends solely on process-local counters.

## Health and alerts

`GET /api/v1/admin/granot-lifecycle/operations/health` remains the single Owner/Admin read. Due work is pending/retry plus claimed-only-when-lease-expired with `next_attempt_at <= now`. Health includes generated time, ten flags, activation, receipt/due/dead-letter counts plus `by_work_state` and `expired_claim_count`, 24-hour Decision groups with execution mode, open cases/discrepancies, `command_conflicts_last_24h`, `record_links: { active, disputed }`, last queue/cron runs, RingCentral lease/cursor telemetry, and the seven frozen alert codes.

`GRANOT_LIFECYCLE_ALERT_THRESHOLDS` (not env-overridable): `oldest_due_ms` 15 minutes, `oldest_due_continuity_ms` 10 minutes, `dead_letter_count` 0, `capture_503_count` 0, `claim_recovery_per_hour` 5, `capture_to_decision_p95_ms` 10 minutes, `ringcentral_lease_held_ms` 10 minutes, `source_ambiguity_policy_blocked_rate` 0.05, `health_window_ms` 24 hours, `claim_recovery_window_ms` 1 hour.

Oldest due > 15 minutes continuously for 10 minutes (tracked from the current oldest due timestamp crossing the threshold), any dead letter, any capture 503 in 24 hours, claim recoveries > 5 in 1 hour, p95 capture-to-decision > 10 minutes over 24 hours, RingCentral lease held > 10 minutes, and ambiguity/policy-blocked rate > 5% over 24 hours for sources with both `enabled` and `lifecycle_enabled` true and a non-deferred disposition. Empty p95/rate samples are `insufficient_data`; that state never recovers an open alert. p95 is nearest-rank. Public source scope is a masked Registry reference. Firing/recovery persist a deduplicated incident transition and emit `granot_lifecycle.alert.firing` / `granot_lifecycle.alert.recovered`; repeated evaluation does not fan out.

`open_cases` gauge keys are `kind|mode` (`create_missing_booking`, `review_existing_booking`, `create_referral_booking`, `release`). `open_discrepancies` keys are `kind|reason_code`.

Alert evaluation cannot pause capture or processing. `GRANOT_LIFECYCLE_EMAIL_ENABLED` stays unrelated and false.
