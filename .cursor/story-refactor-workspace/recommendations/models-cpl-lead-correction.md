# Immutable per-job Lead correction receipt

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CplLeadCorrection.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

Unique job_id+lead_model+lead_id stores immutable before/after and corrected_at. getCplLeadCorrectionModel registers on default connection, unlike selected-db getters elsewhere. Receipt is evidence, not current live price.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Keep snapshot schema local. Preserve default adapter and per-job uniqueness; do not invent another export or silently add useDb semantics.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CplLeadCorrectionDocument`; `getCplLeadCorrectionModel`

## Parity checks for future implementation

Unique tuple; same Lead across jobs; immutable snapshots/date; Form/Call enum; nullable old metadata; default model binding.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
