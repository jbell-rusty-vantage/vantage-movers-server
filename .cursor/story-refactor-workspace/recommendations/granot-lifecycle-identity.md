# Resolve one eligible source-scoped Form or Call Lead

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/identity.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md`, `docs/knowledge/granot-lifecycle/identity.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/granot-lifecycle/source-policy.md`

## Current operation and boundaries

Separate ladders prefer active Record Link, exact Form ref/id or Call job, then scoped contact. Call uses current and ingested phone, not Granot snapshot phone. Ambiguous/Bad/Duplicate restrictions remain. Form/Call sibling mirroring and booking Form preference are separate operations.

## Remaining recommendation

Name ladder stages/conflicts while preserving resolveLeadIdentity and injected store as the deep interface. Do not combine this classifier with mirroring or booking attachment policy.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`SynchronizationMatchMethod`; `LeadIdentityObservation`; `LeadIdentityPolicyFailure`; `LeadIdentityInput`; `LeadIdentityCandidate`; `LeadIdentityAgentSuggestion`; `LeadIdentityBookingContext`; `LeadIdentityResult`; `IdentityContactSnapshot`; `IdentityFormLead`; `IdentityCallLead`; `IdentityRecordLink`; `IdentityBooking`; `IdentityAgent`; `LeadIdentityQueryLog`; `LeadIdentityStore`; `isMongoObjectIdHex`; `createMongoLeadIdentityStore`; `resolveLeadIdentity`; `resolveAgentAssertion`

## Parity proof

Link scope conflict; exact over contact; Duplicate/Bad priority-only eligibility; ambiguous contacts; sparse job match; agent identity conflict; no writes/cross-source fallback.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
