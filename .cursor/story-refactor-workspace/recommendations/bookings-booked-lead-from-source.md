# Book From The Source Form

- Status: reviewed starter, 2026-10-29
- Target: `src/services/bookings/bookedLeadFromSource.service.ts`
- Current declared exports: `FromSourceAttachPlan`, `resolveFromSourceAttach`, `createBookedLeadFromSourceInTransaction`, `createBookedLeadFromSource`.
- Evidence: `src/services/bookings/bookedLeadFromSource.service.ts`, `docs/knowledge/services/bookings.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `createBookedLeadFromSource` to `bookFromTheSourceForm` if the live callers still benefit; keep `createBookedLeadFromSource` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: Form Lead + id attaches with booking_origin owner_booking and no case; Owner Call Lead unique job attaches with booking_origin owner_booking; Owner Call Lead with no Call Lead row is pending owner_booking no_match. See `src/services/bookings/bookedLeadFromSource.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep `resolveFromSourceAttach`, transactional persistence and public finalization separate. Form ID selection attaches directly. Owner Call submissions use exact-job matching and live eligibility, with shared-job Form preference; misses create an Owner pending Leadless Booking plus case, never a phone-created stub. The inactive import compatibility branch still uses its resolver and source guard. Preserve source-override assignment/CPL save before booking, display-label precedence, inactive-agent import allowance, receiver attribution and warnings after commit. Prove Owner miss does not call the stub resolver, shared-job anchor and pending-case response, plus rollback in the supplied-session adapter.
