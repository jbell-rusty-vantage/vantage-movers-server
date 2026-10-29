# Reviewed source configuration

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotCrmSource.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/source-policy.md`, `docs/knowledge/services/lead-messaging.md`, `docs/knowledge/services/operations-registry.md`

## Current storage contract

Stores normalized label, CSV compatibility, lifecycle disposition/routes/policy/version and separate outbound_sms. Prevalidation delegates structural semantics without loaded refs. Selected getter/autoIndex=false retain index ownership.

The model pre-validation calls validateGranotCrmSourceSemantics without refs; contextual company/feed checks only run when a caller separately supplies loaded references.

## Remaining naming and organization work

Group CSV compatibility/current routing/SMS; preserve same-spelling type/value exports and guards. No texting enablement or fourth policy.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_CRM_CHANNELS`; `GRANOT_CRM_SOURCE_COLLECTION`; `GRANOT_CRM_SOURCE_MODEL_NAME`; `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES`; `GranotCrmSource`; `GranotCrmSourceDocument`; `getGranotCrmSourceModel`

## Parity checks for future implementation

crm_origin+workspace_slug uniqueness; normalized index; route/disposition; inactive defaults; SMS retention; selected DB; no type-based effect.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
