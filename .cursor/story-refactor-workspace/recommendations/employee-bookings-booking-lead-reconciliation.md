# Work Booking Lead Reconciliation Cases

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/bookingLeadReconciliation.service.ts`
- Current declared exports: `listBookingLeadReconciliationCases`, `getBookingLeadReconciliationCase`, `searchBookingLeadCandidates`, `refreshBookingLeadCandidates`, `updatePendingEmployeeBooking`, `resolveBookingLeadReconciliation`, `resolveBookingLeadReconciliationInTransaction`, `persistBookingLeadReconciliationResolveInTransaction`, `reopenBookingLeadReconciliation`.
- Evidence: `src/services/employeeBookings/bookingLeadReconciliation.service.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `listBookingLeadReconciliationCases` to `browseTheOwnerCases` if the live callers still benefit; keep `listBookingLeadReconciliationCases` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: listBookingLeadReconciliationCases returns admin-facing summary fields; getBookingLeadReconciliationCase returns detail fields consumed by admin; searchBookingLeadCandidates returns compact case-aware results with a cursor. See `src/services/employeeBookings/bookingLeadReconciliation.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep list/detail/search, candidate refresh, pending correction, resolution and reopen as different public seams. Candidate refresh records cards/attempt/revision without claiming a Lead; pending correction updates Booking/submission and re-evaluates. Resolution checks revision, case action and current Booking before warning overrides and claim, persists case/Booking/Lead/intent atomically, then finalizes after commit. Canonical supplied-session resolution must not emit another recorder Change when its command owns emission. Dismiss leaves a Leadless Booking; reopen is not reassign and emits no Lead change. Prove each mutation through its public operation, revision conflict, exact warnings and failed claim rollback; list/search tests do not establish these writes.
