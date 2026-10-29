# Live temporal CPL period

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CplRatePeriod.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

cpl_rate_periods is active authority for resolveCpl and Insights. Immutable source/bounds/amount/business timezone and archive/supersession evidence support schedule commands. America/New_York remains explicit; overlap validation belongs to service.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Name immutable definition versus archive metadata and selected-db adapter. Preserve range indexes/CPL_BUSINESS_TIME_ZONE; do not replace periods with flat CplRate.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CPL_BUSINESS_TIME_ZONE`; `CplRatePeriodDocument`; `CplRatePeriod`; `getCplRatePeriodModel`

## Parity checks for future implementation

Bounds/timezone; required values; immutability; archive; selected DB; declared nonunique range indexes; resolution remains service-owned.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
