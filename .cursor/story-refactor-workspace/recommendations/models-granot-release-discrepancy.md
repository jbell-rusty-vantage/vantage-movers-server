# Live Release identity-conflict binding

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotReleaseDiscrepancy.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/observability.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/release-reconciliation.md`

## Current storage contract

Release identity discrepancies remain live, unlike retired standalone Release cases. Wrapper provides reasons/indexes/collection to factory and selected/default binding. Historical missing-Booking reason stays readable; new missing-Booking Release enters booking intake.

## Remaining naming and organization work

Keep kind-specific wrapper explicit and shared immutability. Do not remove with retired Release-case workflow or invent new cancellation policy.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`RELEASE_DISCREPANCY_REASON_CODES`; `GranotReleaseDiscrepancyReasonCode`; `GranotReleaseDiscrepancyDocument`; `GranotReleaseDiscrepancyEvidence`; `GRANOT_RELEASE_DISCREPANCY_COLLECTION`; `GRANOT_RELEASE_DISCREPANCY_MODEL_NAME`; `GRANOT_RELEASE_DISCREPANCY_INDEXES`; `GranotReleaseDiscrepancy`; `getGranotReleaseDiscrepancyModel`

## Parity checks for future implementation

Reason enum/history; partial open fingerprint unique; append/resolve guards; selected DB; no auto-cancel or new missing-Booking discrepancy.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
