# Ringcentral Analytics Reconcile

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/analytics-reconcile.service.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `runRingCentralAnalyticsReconcile`.
- Current exported types: `RingCentralAnalyticsSnapshotSummary`.
- Direct import sites found: `src/routes/ringcentral-cron.routes.ts`, `scripts/dev_ops/ringcentral/ringcentral-analytics-reconcile-run.ts`.
- Related tests: Locate existing callers and targeted tests before changing this module.

## Current operation and naming boundary

`runRingCentralAnalyticsReconcile` calls Analytics Aggregate with inbound **answered** calls and a 120-second minimum, grouped by company numbers from the route snapshot. It stores a diagnostic daily rollup and logs a summary; it never creates a Lead. This answered-only metric is narrower than Call Qualification, where answering is optional. Preserve the configured end buffer (avoids ANL-302 future windows), 24-hour default lookback, payload alternatives and group aggregation. A useful name is `recordRingCentralAnsweredCallDiagnosticSnapshot`; keep its existing alias until cron/scripts move. Parity proof should assert the provider request and stored summary, including empty/non-array records, without treating this count as billing authority.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
