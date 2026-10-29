# Immutable label destination and active history

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/LeadSourceLabelMapping.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

Namespace/raw label/folded key and company/feed destination are immutable. Partial unique active namespace+key permits historical reuse; correction is deactivate/create. Service stamps normalization.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Name guard and history contract; preserve namespaces/getter. Do not auto-normalize in hook or make archived labels unique.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`LABEL_MAPPING_NAMESPACES`; `LabelMappingNamespace`; `LeadSourceLabelMappingDocument`; `LeadSourceLabelMapping`; `getLeadSourceLabelMappingModel`

## Parity checks for future implementation

Enums/immutable destination; partial index; archived reuse; clocks/selected DB; no Registry lookup in model.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
