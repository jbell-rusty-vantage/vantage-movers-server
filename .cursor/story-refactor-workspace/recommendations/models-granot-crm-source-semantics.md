# Pure reviewed source semantics validation

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/granotCrmSourceSemantics.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/source-policy.md`, `docs/knowledge/services/operations-registry.md`

## Current storage contract

Validates dispositions, creation policy, model/move routes and loaded company/feed consistency. Existing three policies remain; provider type grants no classification authority.

## Remaining naming and organization work

Keep one deep validator; name route/disposition rules and use exported contracts without a parallel policy model.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_LIFECYCLE_DISPOSITIONS`; `GRANOT_LEAD_CREATED_POLICIES`; `GRANOT_LIFECYCLE_LEAD_MODELS`; `GRANOT_LIFECYCLE_MOVE_TYPES`; `GranotLifecycleMoveType`; `GranotCrmSourceRouteInput`; `GranotCrmSourceSemanticsInput`; `LoadedSourceCompanyRef`; `LoadedGranularityRef`; `GranotCrmSourceSemanticsRefs`; `GranotCrmSourceSemanticsResult`; `validateGranotCrmSourceSemantics`

## Parity checks for future implementation

Scoped/referral/deferred shapes; wrong company/channel; route ambiguity/locality; exact issues; no query/write.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
