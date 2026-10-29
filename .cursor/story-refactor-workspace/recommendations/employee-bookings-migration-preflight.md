# Report Employee Booking Migration Identity Collisions

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/migrationPreflight.ts`
- Current declared exports: `collectNormalizedCollisions`, `buildEmployeeBookingMigrationReport`, `reportHasBlockingCollisions`.
- Evidence: `src/services/employeeBookings/migrationPreflight.ts`, `docs/knowledge/services/employee-bookings.md`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `buildEmployeeBookingMigrationReport` to `inspectEmployeeJobUniqueIdentities` if the live callers still benefit; keep `buildEmployeeBookingMigrationReport` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: collectNormalizedCollisions groups normalized duplicates; reportHasBlockingCollisions flags booking identity collisions; submission collision preflight ignores bookings outside the partial unique index scope. See `src/services/employeeBookings/migrationPreflight.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Build the report from already-loaded rows; do not load Mongo or apply indexes. Preserve all diagnostic collision groups and invalid active channels, but only exact normalized Booking job and employee_booking submission collisions block. Nonemployee submission duplicates, Call job/Form LID/phone/name diagnostics do not block. Prefix-equivalent jobs are not merged by this normalizer. Prove all blocker/nonblocker populations rather than treating any collision as fatal.
