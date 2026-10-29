# Find The Lead This Booking Names

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/bookingSourceResolver.ts`
- Current declared exports: `resolveBookingSourceLead`, `effectiveBookingSourceCompany`, `getFormLeadSourceCompanyForBooking`.
- Evidence: `src/services/bookings/bookingSourceResolver.ts`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `resolveBookingSourceLead` to `findTheLeadThisBookingNames` if the live callers still benefit; keep `resolveBookingSourceLead` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: import Call Lead resolver still 409s when two Call Leads share a job. See `src/services/bookings/bookingSourceResolver.test.ts`.

**Further parity:** For an Owner-selected Form Lead, resolve the supplied ID. The compatibility Best Relocation import path looks up a Call Lead by job, rejects multiple matches with 409, then tries phone and finally may create an unmatched Call Lead. Owner Precise Booking Call Lead intake instead uses Exact Job Booking Attach; do not treat the inactive import as a live workflow. Existing resolver writes emit a Lead EntityChange in the supplied session, and stamp the returned revision.

## Source-verified implementation constraints (2026-10-29)

Keep `effectiveBookingSourceCompany` separate from Form correction. The former trims and returns an override verbatim or the stored company/default; despite its old JSDoc it does not resolve display-label aliases. `getFormLeadSourceCompanyForBooking` does resolve `input.source`, only for a Form Lead whose company differs. Prove those two helpers independently and preserve unmatched-stub CPL `applicable:false`. Job/phone corrections may overwrite operational phone on the compatibility import path; changing provenance policy here needs a separate behavior decision.
