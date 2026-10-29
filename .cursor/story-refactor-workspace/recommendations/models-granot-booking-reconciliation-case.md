# Booking intake evidence and resolution

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotBookingReconciliationCase.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/processor.md`

## Current storage contract

One open job/action=booked case contains Booked OR Release plus historical priority_5. Modes differentiate missing/review/Referral. evidence_revision differs from case_revision; open/sequence uniqueness and immutable resolved rows remain.

Document validation uses remembered persisted state, and specified query hooks require state=open; these are Mongoose operation guards, not raw-write restrictions.

## Remaining naming and organization work

Group identity, suggestion, evidence, pairing and resolution. Name allowed append versus revision-guarded resolve. Keep action_kind=booked with Release evidence; Form preference stays service-owned.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GranotBookingCaseState`; `GranotBookingCaseEvidenceAction`; `GranotBookingCaseNoActionReasonCode`; `GranotBookingCaseEvidence`; `GranotBookingReconciliationCaseDocument`; `GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION`; `GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME`; `GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES`; `GranotBookingReconciliationCase`; `getGranotBookingReconciliationCaseModel`

## Parity checks for future implementation

Both actions; Booked-only pairing; replay; revision separation; resolved immutable; open/sequence indexes; autoIndex=false; no official fact.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
