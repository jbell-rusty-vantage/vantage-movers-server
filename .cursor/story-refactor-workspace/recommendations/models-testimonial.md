# Curated review evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/Testimonial.ts`
- Knowledge: `docs/knowledge/services/testimonial.md`

## Current storage contract

Source/fingerprint identity, review/publication metadata and optional Customer/source refs. Unique source+fingerprint differs from published browse; normalized reviewer/customer not unique.

## Remaining naming and organization work

Keep model/indexes together; service owns fingerprint/ingest/upsert/public reads. Default connection remains.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`TestimonialDocument`; `Testimonial`

## Parity checks for future implementation

Uniqueness; publication/date index; optional refs/defaults; reuse; no fingerprint/provider/new getter.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
