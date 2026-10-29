# Run Granot Automation and Apply Approved Lifecycle Actions

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/runWorkflow.ts`
- Current declared exports (local declarations; re-exports are additional): `GRANOT_AUTOMATION_TOPIC`, `GranotLeadOperation`, `GranotOperation`, `GranotWorkflow`, `GranotRunRequest`, `GranotRunGroupRequest`, `GranotRunGroupRuntime`, `EstimatesPlan`, `createGranotRun`, `scheduledEstimatesRunId`, `validateEstimatesRunSelection`, `createEstimatesSchedule`, `dispatchEstimatesSchedule`, `resumeEstimatesSchedules`, `createGranotRunGroup`, `approveGranotRun`, `applyReviewedEstimatesRun`, `assertReviewedEstimatesWindow`, `runGranotWorker`, `assembleEstimatesPlan`, `estimatesActionCaptureTime`, `getGranotRun`, `listGranotRuns`, `estimatesScheduledWindows`, `getEstimatesFreshness`, `releasePoolCollectionDependencies`, `recoverGranotRuns`, `granotApplyReadyFilter`, `granotRecoverableFilter`, `continueGranotRuns`, `publishGranotWakeup`, `granotApplyEnabled`, `buildFormExpectedFilter`, `toDurableGranotValue`.
- Evidence: `src/services/granotHttpCollector/runWorkflow.ts`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Consider renaming `createGranotRun` to `queueADurableGranotAutomationRun` if the live callers still benefit; keep `createGranotRun` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: Pool schedules cannot collide with ALL retry identity or bypass selector/lane validation; run-group creation inserts two correlated compatible queued children; run-group validation completes before any child insertion. See `src/services/granotHttpCollector/runWorkflow.test.ts`.

**Specific parity:** Preserve queued run creation and source validation, sealed plan and approval behavior, worker lease fencing and replay states. Scheduled Estimates use their own slot identities and automatic approval path; do not apply that policy to ordinary dashboard runs.

**Further parity:** Apply requires an unexpired fenced run, sealed plan, matching stored and approved checksums and selected action IDs. The deployment gate applies except when an Estimates run carries the server-owned auto_apply marker, including scheduled and reviewed-preview apply paths. Renew the lease before each processed action; preserve stored terminal receipts and pending replay behavior, bounded processing and fenced receipt writes.

## Source-verified implementation constraints (2026-10-29)

The file also owns group validation/partitioning, planning, approval, reviewed Estimates apply, worker/recovery/continuation, schedule dispatch and freshness reads: queue-create alone is not its implementation story. Retain each seam and private orchestration by decision. Source IDs/groups resolve Registry compatibility before child inserts; label-only create still bypasses that resolver. Ordinary approval checks apply gate, sealed checksum and unexpired awaiting-approval state; applyReviewedEstimatesRun instead accepts an unexpired completed Estimates preview with no prior approval/receipts and bounded 1–90 inclusive nonfuture dates, sets auto_apply and bypasses the deployment gate. Scheduled Estimates also auto-approve; neither bypasses lifecycle write gates. Preserve distinct ALL/Pool slot identity and selector/lane checks.

Worker account lease/fenced run state, 120-second planning/apply budgets and 25-action apply limit remain. Pending actions do not block fresh independent selected actions; at most one nonterminal pending poll receives that budget per pass. Terminal receipts skip canonical reapply but Estimates may still need idempotent Outreach refresh nomination; transient refresh failure yields recoverably, and durable outreach_refresh_completed prevents premature completion/repeated successful nomination. Fresh Estimates evidence uses sealed collection_captured_at; existing receipt replay preserves original identity/time. Preserve waiting_match versus apply checkpoint and least-recent-attempt work order, provider retry bound and redacted run-detail shapes. Prove reviewed-preview gate exception, fresh+pending fairness, refresh retry, missing capture time, checksum drift and stale lease without restoring direct Lead writers.
