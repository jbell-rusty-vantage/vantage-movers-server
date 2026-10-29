# Enforce Owner Booking Reconciliation Policy

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/reconciliationPolicy.ts`
- Current declared exports (local declarations; re-exports are additional): `OVERRIDEABLE_RECONCILIATION_WARNINGS`, `ReconciliationWarning`, `deriveTrustedOwnerActor`, `getOverrideableWarnings`, `assertExactWarningOverrides`, `normalizeWarningCodes`, `assertAllowedCaseAction`, `assertLiveBookingState`, `applyCursorFilter`, `encodeDateIdCursor`, `decodeDateIdCursor`.
- Evidence: `src/services/employeeBookings/reconciliationPolicy.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `deriveTrustedOwnerActor` to `sayWhoIsSpeakingAsThisEmployeeJobOwner` if the live callers still benefit; keep `deriveTrustedOwnerActor` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: deriveTrustedOwnerActor rejects bare api secret actor; deriveTrustedOwnerActor accepts trusted owner headers with primary secret; deriveTrustedOwnerActor accepts owner users directly. See `src/services/employeeBookings/reconciliationPolicy.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep trusted Owner derivation, warning override policy, case status policy, live Booking fences and cursor helpers explicit. Bare secret/scoped key/admin role cannot become Owner here. Exact overrides compare deduplicated recognized warning sets; unknown strings are filtered, while lead booked/cancelled remain blocking. Case status permission and live Booking checks both apply. Cursor order uses date then id in the chosen direction; invalid payload is 400. Prove allowed status with forbidden live state, missing/extra recognized warnings, equal-date pagination and malformed cursor.
