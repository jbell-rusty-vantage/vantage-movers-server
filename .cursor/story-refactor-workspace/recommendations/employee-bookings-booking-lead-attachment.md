# Attach or Reassign an Employee Booking Lead

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/bookingLeadAttachment.service.ts`
- Current declared exports: `attachLeadToEmployeeBooking`, `createAndAttachReconciliationCallLead`, `createAndAttachReconciliationFormLead`, `reassignEmployeeBookingLead`.
- Evidence: `src/services/employeeBookings/bookingLeadAttachment.service.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `attachLeadToEmployeeBooking` to `claimAndStampTheNamedLeadOnThisJob` if the live callers still benefit; keep `attachLeadToEmployeeBooking` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Keep attach, create-and-attach for each origin, and reassign as separate operations. Track before state, optionally apply submission source/temporal CPL, atomically claim, then stamp Booking and mirror with existing CPL preserved. Reassign claims replacement first before clearing old Lead, so failed claim rolls back without detaching old. Create Form handles duplicate detection/Form Fill and no Granot post. Current createAndAttachReconciliationCallLead directly constructs a non-unmatched Call Lead without RingCentral qualification; that is existing behavior, not proof that all non-RingCentral creation is closed. Closing it is a separate policy change. Prove preserved-source CPL, claim loss, two-Lead reassign rollback and create paths' jobs/change recording.
