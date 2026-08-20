**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 28.2 and 33  
**Primary code:** `src/services/granotLifecycle/observability.ts`, `src/services/granotLifecycle/metrics.ts`, `src/services/granotLifecycle/alerts.ts`, `src/services/granotLifecycle/projections.ts` (`projectGranotLifecycleHealth`)  
**Domain terms used:** Granot Observation, Synchronization Decision, Booking Reconciliation, Release Reconciliation, Operational Event

# Granot lifecycle operational observability

**Role:** Emit PII-safe Operational Events, update exact Section 33 metrics, project Mongo-backed health, and evaluate the seven initial rollout alerts. None of this is business authority for a Lead, Booking, Cancellation, Record Link, case, or discrepancy.

## Event catalog

Literal keys are issue-author. Section 33 names the transitions. Landed underscore keys normalize one-way at `emitGranotLifecycleEvent`; callers must not emit both an alias and its canonical key for one transition.

Required keys: capture/queue failure, processing completed, technical retry scheduled, dead letter entered, manual requeue, Booking/Release case and discrepancy opened/refreshed/resolved, owner command applied/replayed/conflict, activation committed, and RingCentral adoption/conflict.

Allowed details are bounded enums, booleans, counts, durations, revisions, masked IDs, route templates, outcome/reason/error codes, execution mode, channel, case/discrepancy kind/mode, and trigger. Payload, credentials, contact, Job Number, source/actor labels, command body, reason/notes text, money, provider bodies, and stacks are rejected. Lifecycle events do not populate lead/contact columns.

Emission is best-effort and after the relevant durable commit, except failure transitions that report the failure itself. Activation and manual-requeue audit writes also run after their business transaction commits. Instrumentation failure cannot roll back receipt, case, command, activation, requeue, or aggregate outcomes. Lifecycle identifier keys are normalized and masked case-insensitively; conflict labels are bounded codes.

## Metrics

Exact Section 33 names live in `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES`. Receipt `event_class` is a route class or `"none"` for extension/automation receipts. Unknown labels are dropped. `open_cases` and `open_discrepancies` are current-cardinality gauges recomputed from Mongo during health projection. Replay has its own event and does not increment an applied effect twice. Health never depends solely on process-local counters.

## Health and alerts

`GET /api/v1/admin/granot-lifecycle/operations/health` remains the single Owner/Admin read. Due work is pending/retry plus claimed-only-when-lease-expired with `next_attempt_at <= now`. Health includes generated time, ten flags, activation, receipt/due/dead-letter counts, 24-hour Decision groups with execution mode, open cases/discrepancies, command conflicts, last queue/cron runs, RingCentral lease/cursor telemetry, and the seven frozen alert codes.

Thresholds are fixed in `GRANOT_LIFECYCLE_ALERT_THRESHOLDS`: oldest due > 15 minutes continuously for 10 minutes (tracked from the current oldest due timestamp crossing the threshold), any dead letter, any capture 503 in 24 hours, claim recoveries > 5 in 1 hour, p95 capture-to-decision > 10 minutes over 24 hours, RingCentral lease held > 10 minutes, and ambiguity/policy-blocked rate > 5% over 24 hours for sources with both `enabled` and `lifecycle_enabled` true and a non-deferred disposition. Empty p95/rate samples are `insufficient_data`; that state never recovers an open alert. p95 is nearest-rank. Public source scope is a masked Registry reference. Firing/recovery persist a deduplicated incident transition only; repeated evaluation does not fan out.

Alert evaluation cannot pause capture or processing. `GRANOT_LIFECYCLE_EMAIL_ENABLED` stays unrelated and false.
