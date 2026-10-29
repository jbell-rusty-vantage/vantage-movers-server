# Source Company and embedded compatibility evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/LeadSourceCompany.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

Immutable unique slug, labels/defaults/projection/lifecycle plus embedded granularities remain. Live feeds belong to first-class LeadSourceGranularity; embedded records are migration/compatibility evidence. Schema active default differs from Owner-create policy.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Separate company identity versus compatibility block; keep getter/defaults. No migration/delete or duplicated Registry authority.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`LeadSourceGranularity`; `LeadSourceCompanyDocument`; `LeadSourceCompany`; `getLeadSourceCompanyModel`

## Parity checks for future implementation

Immutable unique slug; embedded nonunique indexes; labels/defaults/projection; selected DB; no Lead assignment/CPL resolution.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
