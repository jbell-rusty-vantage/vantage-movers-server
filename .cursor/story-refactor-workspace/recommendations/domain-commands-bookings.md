# Apply Booking Domain Commands

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/bookings.ts`
- Current declared exports: `createBookingFromLead`, `createLeadlessBooking`, `createExistingReferralBooking`, `updateBookedLead`, `updateBooking`, `deleteBookedLead`, `attachBookingToLead`.
- Evidence: `src/services/domainCommands/bookings.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Keep `updateBooking` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Keep booking command wrappers on their existing create, update, delete and attachment paths; preserve expected revision checks, transaction boundaries and the post-commit handoff. Test replay and stale revisions through the command interface.

## Source-verified implementation constraints (2026-10-29)

Keep thin create/update/delete compatibility delegates distinct from the exact `updateBooking` aggregate and `attachBookingToLead`. Exact update validates expected revision/uncancelled Booking, active Agent/Merchant ids, even-cent official allocations and normalized Job CAS; no field diff means no Change/outbox/finalizer, while changed data persists one Booking Change plus booking_chain intent. Attachment loads its reconciliation case, uses expected case revision and same supplied session, records Booking/Lead diffs and finalizes jobs after non-replay commit. External-ingestion attachment additionally proves source ownership using prior command execution and connection key. Prove both exact operations, no-op/replay, lost revision and foreign-ingestion denial; Form sibling preference belongs to the matcher, not these wrappers.
