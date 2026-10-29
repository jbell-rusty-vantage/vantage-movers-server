# Retry Pending Employee Booking Matches

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/reconciliationRematch.service.ts`
- Current declared exports: `runDueBookingLeadRematches`.
- Evidence: `src/services/employeeBookings/reconciliationRematch.service.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `runDueBookingLeadRematches` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: cold rematch connects to Mongo before attempting a lease or model operation; rematch snapshots Exact Job Booking Attach, not the retired five-rule list; rematch evaluator attaches only when a unique Call Lead job appears. See `src/services/employeeBookings/reconciliationRematch.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve cold Mongo connection before global lease, heartbeat renewal and per-case ownership/expiry revalidation inside forced transactions. Skip cancelled/already-attached/missing Booking; linked evaluation attaches with one Lead recorder Change and outbox; pending updates retry count/reason/delay. Recheck lease before finalization, clear only the owned lease on failure, and release global lease in finally. Prove lease loss cannot attach or finalize, retry exhaustion stops scheduling, and shared-job Form preference remains the evaluator's policy.
