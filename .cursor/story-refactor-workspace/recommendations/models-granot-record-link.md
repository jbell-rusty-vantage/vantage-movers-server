# Durable job association and evidence refresh

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotRecordLink.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/identity.md`, `docs/knowledge/granot-lifecycle/observability.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/projections.md`, `docs/knowledge/services/bookings.md`

## Current storage contract

Active provider+normalized job has partial unique reservation. Link may be job-only/Lead/Booking-associated under command rules. Ordinary updates allow bounded refresh only; command-owned CAS performs association/correction. autoIndex=false/timestamps=false.

## Remaining naming and organization work

Clarify refresh allowlist versus privileged command CAS. Preserve exports/disputed evidence/snapshots; no Lead job uniqueness or sibling mirror in model.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`GranotRecordLinkState`; `GranotRecordLinkLeadRef`; `GranotRecordLinkSourceScope`; `GranotRecordLinkDocument`; `GRANOT_RECORD_LINK_COLLECTION`; `GRANOT_RECORD_LINK_MODEL_NAME`; `GRANOT_RECORD_LINK_INDEXES`; `assertAllowlistedRecordLinkRefreshUpdate`; `GranotRecordLink`; `getGranotRecordLinkModel`

## Parity checks for future implementation

Job validation; unique active reservation; allowed operators; ordinary association/replace/delete denied; command CAS unchanged; selected DB; historical job-only valid.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
