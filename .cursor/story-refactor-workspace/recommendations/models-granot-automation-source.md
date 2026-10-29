# Exact report label and Registry link

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotAutomationSource.ts`
- Knowledge: `docs/knowledge/services/granot-http-collector.md`, `docs/knowledge/services/operations-registry.md`

## Current storage contract

Case-sensitive Granot report label, operations and optional reviewed GranotCrmSource link. Unsafe control/bidi labels rejected; report label is not Source Company identity or policy authority.

## Remaining naming and organization work

Keep label constants/guards adjacent; name exact label versus Registry link. Preserve enum/indexes and Owner service ownership.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN`; `GRANOT_AUTOMATION_OPERATIONS`; `GRANOT_AUTOMATION_SOURCE_COLLECTION`; `GRANOT_AUTOMATION_SOURCE_INDEXES`; `GranotAutomationSourceDocument`; `GranotAutomationSource`

## Parity checks for future implementation

Unsafe/exact labels; uniqueness; operations/link; seed/admin; no collect/policy/apply.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
