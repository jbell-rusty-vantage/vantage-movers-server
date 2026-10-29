# Legacy flat CPL compatibility row

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CplRate.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

cpl_rates retains unique label and source/type/local identity plus amount. Lead create uses CplRatePeriod; Insights prices schedule live.

## Remaining naming and organization work

Keep model/export stable and compatibility role explicit. Do not reroute creation, remove periods or silently retire existing compatibility readers.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CplRateDocument`; `CplRate`

## Parity checks for future implementation

Unique label/compound index; type/local validation; amount/defaults; default connection; no Lead repricing or correction.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
