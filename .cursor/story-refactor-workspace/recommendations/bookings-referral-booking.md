# Book A Referral

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/referralBooking.service.ts`
- Current declared exports: `createReferralBookingInTransaction`, `createReferralBooking`.
- Evidence: `src/services/bookings/referralBooking.service.ts`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `createReferralBooking` to `bookAReferral` if the live callers still benefit; keep `createReferralBooking` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: Referral Booking create does not open a Booking Lead Reconciliation Case. See `src/services/bookings/referralBooking.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Referral persistence sets source=referral and is_referral_booking, has no Lead refs, no Lead mirror, no reconciliation case and no booking_origin. Preserve raw-job collision 409, contact-only customer upsert, resolved allocations/merchant and booked_lead/referral_booking.create intent. The supplied-session export never finalizes Sheets; its finalizer and the public wrapper do so after persistence. Prove no case/Lead writes, duplicate rejection and finalizer ordering rather than importing Form-pair rules into this module.
