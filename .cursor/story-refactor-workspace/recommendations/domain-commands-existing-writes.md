# Apply Existing Writes Through Domain Commands

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/existingWrites.ts`
- Current declared exports (local declarations; re-exports are additional): `runExistingCreateFormLead`, `runExistingCreateCallLead`, `runExistingUpdateSourceOwnedLead`, `runExistingCreateBookingFromLead`, `runExistingCreateLeadlessBooking`, `runExistingCreateReferralBooking`, `runExistingCreateCancellation`, `runExistingUpdateBookedLead`, `runExistingUpdateCancelledLead`, `runExistingCreateBookedLeadFromSource`, `runExistingDeleteFormLead`, `runExistingDeleteCallLead`, `runExistingDeleteBookedLead`, `runExistingDeleteCancelledLead`.
- Evidence: `src/services/domainCommands/existingWrites.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `runExistingCreateFormLead` to `applyThisPublicFormLeadIngestion` if the live callers still benefit; keep `runExistingCreateFormLead` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** Keep transaction work separate from post-commit effects and preserve each entry point’s existing context, replay and result mapping. Exercise an idempotent replay and a failed mutation without a second effect.

**Further parity:** Form create derives ingestion origin from trusted command provenance and starts ingestion inside the command transaction. A reused submission emits no new EntityChange and wakes no lead-link job; a fresh submission persists the change before commit and completes ingestion and wakes the lead link afterwards. Preserve this ordering and idempotent replay.

## Source-verified implementation constraints (2026-10-29)

Retain per-operation adapters across Lead create/update/delete, Booking create/from-source/update/delete, Referral/Leadless creation and Cancellation create/update/delete. Do not collapse their mutation lists or finalizers into one generic CRUD handler. Form create reused-submission skips Lead Change/wake; Call create retains its origin-derived create semantics. Update empty diffs omit pending, Change and outbox; Booking same-submission duplicate still runs its existing after-commit response hook on non-replay. All adapters use supplied-session primitives, preallocated Change ids and executor-owned transaction. Prove no-op versus duplicate versus exact replay separately and preserve Lead-link wake/fact hooks only after commit.
