# Booking-conflict model binding

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotBookingDiscrepancy.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/observability.md`, `docs/knowledge/granot-lifecycle/processor.md`

## Current storage contract

Wrapper supplies booking reasons/collection/model/index contract to shared discrepancy factory and default/selected binding. Work evidence is not an official Booking.

## Remaining naming and organization work

Keep thin wrapper and kind-specific catalog; do not duplicate guards or merge release collection.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`BOOKING_DISCREPANCY_REASON_CODES`; `GranotBookingDiscrepancyReasonCode`; `GranotBookingDiscrepancyDocument`; `GranotBookingDiscrepancyEvidence`; `GRANOT_BOOKING_DISCREPANCY_COLLECTION`; `GRANOT_BOOKING_DISCREPANCY_MODEL_NAME`; `GRANOT_BOOKING_DISCREPANCY_INDEXES`; `GranotBookingDiscrepancy`; `getGranotBookingDiscrepancyModel`

## Parity checks for future implementation

Reason enum; partial open fingerprint unique; selected DB; factory immutability; no case opening or official write.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
