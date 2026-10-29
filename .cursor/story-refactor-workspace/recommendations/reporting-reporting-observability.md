# Log bounded Reporting delivery health signals

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/reporting/reportingObservability.ts`
- Domain evidence: `docs/knowledge/services/reporting.md`
- Current exported operations/constants: `emitReportingOAuthHealthFailure`, `emitReportingDestinationHealthFailure`, `emitReportingStuckPhaseAlert`, `emitReportingRetryExhausted`, `emitReportingVerificationMismatch`, `emitReportingPromotionAmbiguous`, `emitReportingCleanupBacklog`, `emitReportingDenylistUnavailable`, `emitReportingCapacityDivergence`, `recordReportingLiveTestJanitorOutcome`, `emitReportingCleanupJanitorFailed`, `findReportingStuckRuns`, `scanReportingOperationalHealth`, `REPORTING_OBSERVABILITY_EVENT_KEYS`, `REPORTING_PHASE_STUCK_THRESHOLD_MS`.
- Current exported types: `ReportingStuckRunCandidate`.
- Direct import sites found: `src/routes/google-drive-oauth.routes.ts`, `src/routes/reporting-cron.routes.ts`, `src/routes/reporting.routes.ts`, `src/services/reporting/cleanup.ts`, `src/services/reporting/reportingObservability.test.ts`, `src/services/reporting/reportingWorker.ts`, `src/services/reporting/live/testArtifactJanitor.ts`.
- Related tests: `src/services/reporting/reportingObservability.test.ts`

## Current boundary and parity

Reporting definitions, immutable revisions, confirmed runs and Google delivery remain live. Preserve the Owner gate, destination checks, leased execution and cleanup boundaries. Live-test harnesses and their safety checks remain operational tooling. Reporting signals are structured logs; do not recreate the retired Operational Events persistence or notification pipeline.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

`logReportingSignal` writes through `logger` with the `reporting_projection` workflow. The `emitReporting*` entry points name bounded signals; health scan and janitor outcomes remain separate callers. Retain event keys, levels and bounded fields. There is no event persistence or email adapter.

## Specific implementation checks from the original brief

2. **Walk the reporting health scan** — `scanReportingOperationalHealth`. Leftover cron already gathered leftover stuck candidates, leftover `cleanupPendingCount`, leftover oldest cleanup run, leftover `denylistIncomplete`, leftover missing keys. This file clocks leftover `Date.now()`. Leftover `findReportingStuckRuns` keeps a candidate whose leftover `nowMs - updatedAtMs >= REPORTING_PHASE_STUCK_THRESHOLD_MS` (thirty minutes). For each stuck leftover **ask** leftover stuck-phase tell. If leftover pending cleanup is greater than zero, leftover **ask** leftover backlog tell. If leftover denylist is incomplete, leftover **ask** leftover denylist tell. This file does not query `ReportingRun`. This file does not **ask** leftover `listCleanupPendingDeliveries`. This file does not **ask** leftover `assertConfigurationComplete`.

2. **Leftover worker passes the phase as leftover verification `reasons`.** Leftover `emitObservabilityForReportingFailure` leftover `VERIFICATION_MISMATCH` **asks** leftover `reasons: [input.phase]`. The emit slices “reasons.” Do not silently start passing leftover engine leftover mismatch codes so “the name becomes honest” in this rename — leftover `failRun` metadata may not have them.

3. **Leftover capacity tell is leftover `DESTINATION_CAPACITY_EXCEEDED`.** Leftover worker maps leftover `metadata.limit` / leftover `metadata.count` onto leftover `expectedCells` / leftover `observedCells`. That may be leftover estimate vs leftover observed write, or leftover provider max vs leftover projected cells. Do not silently rename leftover `capacityDivergence` to leftover `capacityExceeded` so “the key matches the fail code” — that would change the structured log key.

4. **Leftover denylist from leftover worker has no missing keys.** Leftover worker leftover **asks** `emitReportingDenylistUnavailable({})`. Leftover scan leftover **asks** leftover `missingKeys` from leftover `OperationalWorkbookConfigurationError`. Do not silently teach leftover worker to pass leftover `missing_registration_keys` so “both tells match” without leftover worker catching leftover `OperationalWorkbookConfigurationError` (today leftover `catch` is empty).

## Current signal ownership

These exports synchronously log through `logger` and return void; there is no notification or persistent Operational Events adapter. Routine delivery success is omitted, but `recordReportingLiveTestJanitorOutcome` logs a successful janitor outcome at info. Do not interpret the historical title's “never notify routine success” as absence of every info-level signal. Preserve bounded fields and key strings; error/retry disposition stays in worker/repositories.
