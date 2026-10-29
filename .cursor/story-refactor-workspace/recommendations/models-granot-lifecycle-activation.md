# Immutable lifecycle activation evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotLifecycleActivation.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/observability.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/projections.md`

## Current storage contract

Single granot_lifecycle key fixes activated_at/version/Actor. autoIndex=false and selected getter remain. Save/query guards prevent mutation/deletion; activation never enables effect flags.

These guards apply to the listed Mongoose document and query operations; they do not establish database-level immutability for raw writes or unlisted operations.

## Remaining naming and organization work

Keep immutable evidence guard distinct from model binding. Preserve key/index/model exports, not another config service.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`GranotLifecycleActivationDocument`; `GRANOT_LIFECYCLE_ACTIVATION_COLLECTION`; `GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME`; `GRANOT_LIFECYCLE_ACTIVATION_INDEXES`; `GranotLifecycleActivation`; `getGranotLifecycleActivationModel`

## Parity checks for future implementation

Actor/key/version; unique key; mutation methods rejected; selected DB; original historical/live boundary; no flag change.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
