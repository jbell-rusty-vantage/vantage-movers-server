# Keep The Lead And The Booking In Agreement

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/bookingMirror.service.ts`
- Current declared exports: `refreshAttachedBookingFromLead`, `mirrorBookingToLead`, `claimAvailableLeadForBooking`, `clearBookingFromLead`.
- Evidence: `src/services/bookings/bookingMirror.service.ts`, `docs/knowledge/services/bookings.md`, `docs/knowledge/services/cancellation-mirror.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `mirrorBookingToLead` to `stampThisLeadBooked` if the live callers still benefit; keep `mirrorBookingToLead` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Preserve `claimAvailableLeadForBooking`, `mirrorBookingToLead`, `refreshAttachedBookingFromLead` and `clearBookingFromLead` as distinct operations. Verify conflicts and attached-booking refresh against current tests, without assuming this helper performs Granot Form sibling propagation.

## Source-verified implementation constraints (2026-10-29)

Four operations have different side effects. Refresh returns `source_lead` for unbooked, missing or mismatched Booking; valid attachment updates customer/local only when needed and still returns `booking_chain`. Mirror writes booking/thresholds/local and normally temporal CPL; `preserveExistingCpl` suppresses repricing only without a source override. Claim is atomic against unbooked, uncancelled, nonduplicate (and non-unmatched Call), returning false on loss without CPL rewrite. Clear removes booked AND cancelled plus threshold flags, with inline sync only when requested. None emits EntityChange itself; callers own that stamp. Prove all four, including claim loss, valid refresh with no save, preserved CPL and clear retaining the Lead.
