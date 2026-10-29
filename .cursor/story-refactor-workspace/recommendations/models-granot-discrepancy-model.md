# Shared discrepancy schema with guarded evidence updates

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/granotDiscrepancyModel.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`

## Current storage contract

Factory accepts kind/reasons/collection/index contract for booking/release wrappers. Open rows allow guarded evidence append and resolution; listed query hooks guard selected identity and evidence updates, and document validation rejects a loaded resolved row. It is storage validation, not business classifier.

The document pre-validation and listed query hooks guard selected mutations and state filters; they are not database-wide immutability.

## Remaining naming and organization work

Name evidence/resolution/mutation-check beats. Retain thin kind-specific wrappers and query guards; no generic schema framework.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`GranotDiscrepancyKind`; `GranotDiscrepancyEvidence`; `GranotDiscrepancyDocument`; `GranotDiscrepancyIndexContract`; `createGranotDiscrepancyModel`

## Parity checks for future implementation

Kind/reason enums; open append; listed update and replacement guards; do not assume deletion is blocked by this factory; revision-guarded resolve; resolved immutability; partial filters; no official write.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
