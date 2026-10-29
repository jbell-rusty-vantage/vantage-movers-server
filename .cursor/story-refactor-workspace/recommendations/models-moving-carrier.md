# Carrier regulatory identity and Granot code

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/MovingCarrier.ts`
- Knowledge: `docs/knowledge/services/tariff.md`

## Current storage contract

DOT and MC individually unique plus compound identity; nonempty Granot code partial unique. Active/name browse does not imply normalized-name uniqueness. Tariff service owns display resolution.

## Remaining naming and organization work

Group regulatory ids/Granot linkage/display; preserve exact default model/index filters. Do not remove individual uniques to mimic service heuristic.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`MovingCarrierDocument`; `MovingCarrier`

## Parity checks for future implementation

DOT/MC/index declarations; partial code uniqueness/optional code; defaults/browse; no tariff append/provider query/getter invented.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
