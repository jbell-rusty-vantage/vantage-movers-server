# Seal The Collected Plan As Schema-V2 Lifecycle Evidence — Write The Row As A Granot Statement, Name The Channel Operation, Refuse Schema-V1, Then Tell Whether Approved Apply Is Still Pending

- Status: reviewed starter, 2026-10-29
- Target: `src/services/granotHttpCollector/lifecycleStatement.ts`
- Current declared exports (local declarations; re-exports are additional): `GranotTableSection`, `GranotAutomationLifecycleApply`, `SealableAutomationAction`, `SealableAutomationPlan`, `buildAutomationOperationId`, `assertSafeAutomationOperationId`, `buildGranotStatementFromCollectedRow`, `resolveAutomationOperationKind`, `buildLifecycleApply`, `sealAutomationPlan`, `isSealedAutomationPlan`, `assertSealedAutomationPlan`, `isPendingAutomationActionOutcome`, `isTerminalAutomationActionOutcome`, `automationRunCompletionStatus`.
- Evidence: `src/services/granotHttpCollector/lifecycleStatement.ts`, `docs/knowledge/services/granot-http-collector.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/granotHttpCollector/estimatesCron.ts`

## Recommendation

Keep `buildGranotStatementFromCollectedRow` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Dashboard Granot automation and the separately scheduled Estimates path both exist; `runWorkflow.ts` now includes Estimates operations and scheduled auto-apply, so preserve the live distinctions and authorization. Do not fold the Estimates cron into a dashboard-only story.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: [AC-33] Form Follow Up statement keeps raw Priority, separate user/rep, and location aliases; [AC-33] Form Booked statement is booking_action_apply with raw Booked evidence; [AC-33] Call enrichment statement does not collapse user/rep. See `src/services/granotHttpCollector/lifecycleStatement.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep operation-id construction/validation, safe statement mapping, plan sealing/assertion and completion classification separate. Preserve user and rep independently, priority/customer/location aliases, Booked event_type and table-based operation kind; delete synthetic granot_crm_username. Reject/drop credential-like or unsafe/control/bidi keys/values with current bounds, retain finite numbers/null, and normalize whitespace. Seal v1 plans from original collected row, bind expected target and provider collectedAt when available, emit v2; never reconstruct approval from mutable CSV/latest data. Pending means accepted_for_processing or pending_match; only technical_failure makes completed_with_errors. Prove missing collected row fail, operation identity, safe fields and pending/terminal mix; existing Estimates plans are already sealed by their canonical assembler.
