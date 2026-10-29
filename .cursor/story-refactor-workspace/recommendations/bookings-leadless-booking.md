# Book A Leadless Job

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/leadlessBooking.service.ts`
- Current declared exports: `createLeadlessBooking`, `createLeadlessBookingInTransaction`, `persistLeadlessBookingCreateInTransaction`.
- Evidence: `src/services/bookings/leadlessBooking.service.ts`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `createLeadlessBooking` to `bookALeadlessJob` if the live callers still benefit; keep `createLeadlessBooking` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: Owner leadless create opens owner_booking case and sets booking_origin; Best Relocation import leadless keeps external_sheet_ingestion and no booking_origin. See `src/services/bookings/leadlessBooking.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Preserve public preparation and supplied-session persistence. Raw Job Number collision is 409. Resolve active merchant/allocations, infer source channel from inbound/call label and upsert customer; no Lead mirror occurs. Owner creation opens owner_booking pending reconciliation, stamps booking_origin and queues owner_booking.create_pending. Inactive import keeps external_sheet_ingestion pending case, no booking_origin and leadless_booking.create; an inactive ingest is not a reason to remove its guarded compatibility behavior. Prove distinct case origins/jobs and rollback of Booking, case and intent together.
