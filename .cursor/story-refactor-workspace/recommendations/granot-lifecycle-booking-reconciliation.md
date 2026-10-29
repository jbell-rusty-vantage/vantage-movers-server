# Open or refresh intake from Booked or Release

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/bookingReconciliation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/processor.md`

## Current operation and boundaries

Actual Booked AND Release enter one booking-case workflow. Priority 5 alone never opens a case. Case plus causal Decision commit together; evidence_revision and case_revision have distinct meanings. Ambiguous Leads can yield create-missing work without attachment; shared-job intake prefers Form.

## Remaining recommendation

Keep the already-landed Booked/Release booking-intake routing. Organize classification, candidate browsing and transactional open/refresh as named beats. Keep injected store, bounded race retry, employee pending reconciliation, official Granot Leadless and Referral distinctions.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`BookingReconciliationCurrentContext`; `BookingLeadSuggestion`; `BookingLeadCandidateProjection`; `BookingCandidateBrowserPolicy`; `BookingReconciliationNoCaseReason`; `BookingReconciliationClassification`; `PreparedBookingReconciliationDecision`; `CaseEffectResult`; `BookingCaseRefreshInput`; `BookingReconciliationPersistenceStore`; `GranotBookingReconciliation`; `createGranotBookingReconciliation`; `reconcileBookingCaseAfterDiscrepancy`; `createMongoBookingReconciliationStore`; `isBookingCandidateRefreshEligible`; `projectBookingLeadCandidates`; `searchBookingLeadCandidates`; `projectBookingCandidateBrowserPolicy`; `classifyBookingReconciliation`; `toBookingLeadSuggestion`

## Parity proof

For valid-job nonconflicting source-scoped intake, missing Booking opens create-missing on either action; Referral selects create_referral_booking; active Booking reviews; cancelled+Release already-current and cancelled+Booked discrepancy; identity conflicts; employee delegation; Form preference; exact evidence replay and resolved next sequence.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
