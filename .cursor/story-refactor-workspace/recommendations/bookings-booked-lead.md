# Book This Lead

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/bookedLead.service.ts`
- Current declared exports: `createBookedLead`, `createBookedLeadInTransaction`, `persistBookedLeadCreateInTransaction`, `finalizeBookedLeadCreateAfterCommit`, `updateBookedLeadInTransaction`, `updateBookedLead`, `findAllBookedLeads`, `deleteBookedLead`, `deleteBookedLeadInTransaction`, `populateBookedLead`.
- Evidence: `src/services/bookings/bookedLead.service.ts`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `createBookedLead` to `bookThisLead` if the live callers still benefit; keep `createBookedLead` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Further parity:** Resolve allocations and active merchant before booking creation; preserve binder calculation and warnings, linked-Lead mirror, transaction and Sheet Sync finalization. Booking deletion must preserve Record Link claim release and its cancellation/lead cascade; do not collapse the public compatibility path into the transactional command path without proving parity.

## Source-verified implementation constraints (2026-10-29)

The module also owns update, list, delete and population; a create-only rename is insufficient guidance. Keep create preparation outside persistence, same-submission no-write duplicate versus different-submission upsert, and after-commit finalization. Public update always saves/mirrors; transactional update can return a semantic no-op with no Change/outbox. Referral/Leadless public update stays 409. List remains newest 200. Delete requires cascade for an attached Cancellation, deletes its Cancellation but never the Lead, clears Lead flags and releases live Granot Booking claims before removing the Booking. Preserve queued tombstone-before-delete versus legacy inline-sheet order and the existing release CAS failure. Prove duplicate/upsert separately, both update modes, cancelled cascade and Record Link/open-case release, including failure rollback.

Also preserve Form-only local requirement (Call may omit it), source display-label precedence rather than source-assignment policy, and update warnings based on the incoming resolved allocations rather than the patch-merged list. Prove an omitted zero-binder existing allocation stays silent under patch mode, and a Call Booking without local remains allowed.
