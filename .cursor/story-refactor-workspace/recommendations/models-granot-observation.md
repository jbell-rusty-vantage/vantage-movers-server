# Immutable normalized Observation evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotObservation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/projections.md`

## Current storage contract

granot_observations stores schema_version1 identity/contact/move/priority/action/issues and unique receipt. Display money is not official command input; mutations/replace/delete are guarded. Selected getter preserves TEST_MODE.

Save and listed query middleware reject mutations; raw Mongo writes are outside those guards.

## Remaining naming and organization work

Group normalized sections/issues and keep guards/index catalog. No mutable Lead status or official Booking fields.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`GranotObservationIssueSeverity`; `GranotObservationIssue`; `GranotObservationIdentity`; `GranotObservationContact`; `GranotObservationLocation`; `GranotObservationMove`; `GranotObservationPriority`; `GranotObservationBookingAction`; `GranotObservationDisplayMoneyAmount`; `GranotObservationDisplayMoney`; `GranotObservationDocument`; `GRANOT_OBSERVATION_COLLECTION`; `GRANOT_OBSERVATION_MODEL_NAME`; `GRANOT_OBSERVATION_INDEXES`; `GranotObservation`; `getGranotObservationModel`

## Parity checks for future implementation

Receipt unique; result/issues; Booked/Release; immutable methods; optional money; selected DB; no normalization/matching/action in schema.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
