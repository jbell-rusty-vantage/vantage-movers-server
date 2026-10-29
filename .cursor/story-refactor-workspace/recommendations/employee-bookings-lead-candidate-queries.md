# Assemble Employee Booking Candidates from Seven Operational Lookups

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/leadCandidateQueries.ts`
- Current declared exports: `queryEmployeeBookingCandidates`, `PublicLeadContactSnapshot`, `toPublicLeadContactSnapshot`, `leadContactSnapshotsFromDoc`.
- Evidence: `src/services/employeeBookings/leadCandidateQueries.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `queryEmployeeBookingCandidates` to `assembleTheAutoMatchCandidateSet` if the live callers still benefit; keep `queryEmployeeBookingCandidates` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: candidate query detects the 26th matching lead instead of proving false uniqueness; candidate snapshots keep Granot and ingested contact for owner display; candidate query tags a unique Form Lead Job Number as job_no. See `src/services/employeeBookings/leadCandidateQueries.test.ts`.

## Source-verified implementation constraints (2026-10-29)

There are seven independent lookups: Form LID, Form job, Call job, Form phone, Call phone, Form email and Form normalized-name (the last requires email plus name). Each fetches 26 to expose overflow, contributes at most 25, and merges by model:id with all match methods. Search uses operational fields, not contact snapshots; snapshots are sanitized display evidence. Preserve null/not_provided phone handling, name post-check, source compatibility and eligibility precedence cancelled before booked before duplicate. Prove overflow in any lookup and merged job+phone evidence without false uniqueness.
