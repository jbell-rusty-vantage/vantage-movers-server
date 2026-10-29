# First-class live Source Granularity

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/LeadSourceGranularity.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

Immutable company/key, globally unique key, channel/Move Type/attribution, active state and schedule revision. Label/sites indexes are nonunique; CPL periods remain separate.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Group feed identity, attribution hints and schedule concurrency. Preserve getter/defaults; no embedded authority or duplicate inbound assignments.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`LeadSourceGranularityDocument`; `LeadSourceGranularity`; `getLeadSourceGranularityModel`

## Parity checks for future implementation

Key/company immutable; key unique; channel/local; labels/sites nonunique; revision default; selected DB; no rate writes/source resolution.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
