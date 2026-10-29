# Measure lifecycle facts with bounded labels

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/metrics.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/observability.md`

## Current operation and boundaries

Section 33 counters and samples are process-local; durable Health facts live separately in healthState/observability and Mongo cardinality gauges refresh in projections. Instrumentation is not business evidence.

## Remaining recommendation

Group named counters/getters/reset by measured family and keep label guards. Preserve metric keys; never replace durable Health with fresh-instance samples or restore Operational Events.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES`; `GRANOT_LIFECYCLE_RECEIPT_EVENT_CLASSES`; `GRANOT_LIFECYCLE_CASE_KINDS`; `GRANOT_LIFECYCLE_CASE_MODES`; `GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES`; `GranotLifecycleReceiptMetricLabels`; `GranotLifecycleDecisionMetricLabels`; `GranotLifecycleCaseKind`; `GranotLifecycleCaseMode`; `incrementGranotLifecycleReceiptsTotal`; `incrementGranotLifecycleCaptureFailures`; `incrementGranotLifecycleQueuePublishFailures`; `incrementGranotLifecycleDecisionsTotal`; `recordGranotLifecycleCaptureToDecisionMs`; `recordGranotLifecycleDecisionToEffectMs`; `incrementGranotLifecycleActivationsTotal`; `setGranotLifecycleQueueDue`; `setGranotLifecycleOldestDueSeconds`; `incrementGranotLifecycleClaimRecoveries`; `incrementGranotLifecycleTechnicalRetries`; `incrementGranotLifecycleDeadLetters`; `setGranotLifecycleOpenCases`; `setGranotLifecycleOpenBookingCases`; `setGranotLifecycleOpenDiscrepancies`; `incrementGranotLifecycleCommandConflicts`; `getGranotLifecycleOpenCases`; `getGranotLifecycleOpenBookingCases`; `getGranotLifecycleOpenDiscrepancies`; `getGranotLifecycleReceiptsTotal`; `getGranotLifecycleCaptureFailures`; `getGranotLifecycleQueuePublishFailures`; `getGranotLifecycleDecisionsTotal`; `getGranotLifecycleCaptureToDecisionSamples`; `getGranotLifecycleDecisionToEffectSamples`; `getGranotLifecycleActivationsTotal`; `getGranotLifecycleQueueDue`; `getGranotLifecycleOldestDueSeconds`; `getGranotLifecycleClaimRecoveriesTotal`; `getGranotLifecycleTechnicalRetriesTotal`; `getGranotLifecycleDeadLettersTotal`; `getGranotLifecycleCommandConflictsTotal`; `resetGranotLifecycleMetrics`

## Parity proof

Unknown labels/codes dropped; finite nonnegative durations; gauge rounding/zero; reset; replay no double effect count; durable Health survives process restart.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
