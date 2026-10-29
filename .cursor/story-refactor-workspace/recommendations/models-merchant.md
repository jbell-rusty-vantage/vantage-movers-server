# Merchant catalog identity and aliases

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/Merchant.ts`
- Knowledge: `docs/knowledge/services/catalog.md`, `docs/knowledge/services/operations-registry.md`

## Current storage contract

Name/normalized_name with active/alias lifecycle; normalized name unique, aliases indexed but nonunique. Default model and service-owned resolution preserve Booking snapshots.

## Remaining naming and organization work

Keep row together and clarify alias versus identity. No invented getter or snapshot rewrite.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`MerchantDocument`; `Merchant`

## Parity checks for future implementation

Unique name; aliases nonunique; defaults/model reuse; no resolve/upsert/snapshot mutation.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
