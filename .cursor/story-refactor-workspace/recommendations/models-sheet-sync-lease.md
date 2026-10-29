# Shared owner and epoch scope fences

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SheetSyncLease.ts`
- Knowledge: `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Unique scope, owner/until/epoch; live drain/automation/rematch callers share storage. Old per-tab comment is not runtime scope authority; external ingest caller can be leftover non-live code.

## Remaining naming and organization work

Clarify named-scope evidence without changing strings/acquisition. Keep default model/expiry read index; no TTL or invented tab scope.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SheetSyncLeaseDocument`; `SheetSyncLease`

## Parity checks for future implementation

Unique scope; owner/until/epoch defaults; expiry index; reuse; no acquire/renew/steal here.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
