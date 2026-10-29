# Book The Employee Job — Auto-Link The Unique Lead Or Open An Owner Case

- Status: reviewed starter, 2026-10-29
- Target: `src/services/employeeBookings/submitEmployeeBooking.service.ts`
- Current declared exports: `SubmitEmployeeBookingContext`, `SubmitEmployeeBookingResult`, `submitEmployeeBooking`.
- Evidence: `src/services/employeeBookings/submitEmployeeBooking.service.ts`, `docs/knowledge/services/employee-bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `submitEmployeeBooking` to `bookTheEmployeeJob` if the live callers still benefit; keep `submitEmployeeBooking` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Throttle before preparation/duplicate detection. Recheck submission and normalized job inside the forced transaction; same employee submission returns 200 without new Booking, job collision is 409, linked/pending new outcomes are 201 with last-eight-hex uppercase confirmation. Matcher non409 failures downgrade to matching_unavailable pending, but 409 remains an error. Revalidate and atomically claim before saving linked Booking; claim loss creates pending instead. Linked path emits Lead Change and booking_chain intent; pending saves Leadless Booking plus case and booked_lead intent. Sheets and Daily Operations fact follow commit. Prove all three outcomes, duplicate-key race recovery and claim-race fallback.
