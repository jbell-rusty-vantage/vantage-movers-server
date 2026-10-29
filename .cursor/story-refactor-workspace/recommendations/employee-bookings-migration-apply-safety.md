# Authorize Migration Apply Against the Connected Database

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/migrationApplySafety.ts`
- Current declared exports: `MigrationApplyAuthorizationInput`, `assertMigrationApplyAuthorized`, `isMigrationApplyRequested`.
- Evidence: `src/services/employeeBookings/migrationApplySafety.ts`, `docs/knowledge/services/employee-bookings.md`, `docs/knowledge/services/operations-registry.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `isMigrationApplyRequested` to `someoneAskedThisCliToWrite` if the live callers still benefit; keep `isMigrationApplyRequested` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: test-mode migration apply remains available with --apply; production migration apply requires explicit confirmation; test mode cannot apply to the production database without production confirmation. See `src/services/employeeBookings/migrationApplySafety.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep write-request detection separate from authorization: isMigrationApplyRequested recognizes only --apply. Authorization returns immediately only for testMode AND connected testvantagemovers; otherwise it requires --production-apply, exact --confirm-production-db=vantagemovers and connected vantagemovers. It does not connect, infer configured database or itself require --apply. Prove accidental --apply against production rejects, testMode against production still requires explicit production flags, and unknown connected name rejects.
