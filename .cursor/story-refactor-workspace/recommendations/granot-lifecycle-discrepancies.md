# Persist deduplicated identity conflicts

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/discrepancies.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`

## Current operation and boundaries

Kind-specific stores and reason fingerprints open/refresh booking or release discrepancies with causal Decisions. They never correct links or create official facts. Missing-Booking Release is booking intake, not a new release_without_vantage_booking discrepancy.

## Remaining recommendation

Keep fingerprinting, prepared classification and transactional persistence explicit. Preserve separate booking/release models, immutable resolved rows and bounded duplicate/open-sequence retry.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`DiscrepancyFingerprintInput`; `createDiscrepancyFingerprint`; `DiscrepancyCurrentContext`; `PreparedDiscrepancyDecision`; `DiscrepancyEffectResult`; `DiscrepancyPersistenceStore`; `GranotDiscrepancies`; `createGranotDiscrepancies`; `createMongoDiscrepancyStore`

## Parity proof

Same evidence replay; distinct fingerprint; open refresh versus resolved next sequence; Decision/work atomicity; duplicate-key retry bound; no official Lead/Booking/Cancellation effect.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
