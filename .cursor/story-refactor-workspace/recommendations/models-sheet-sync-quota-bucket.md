# Per-minute Sheets budget evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SheetSyncQuotaBucket.ts`
- Knowledge: `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Unique scope+read/write+window, spent count and TTL3600 from window_start. Runtime user scope does not authorize adding project scope to match an old comment.

## Remaining naming and organization work

Keep small row/key/TTL; reservation/sleep/Google remain services.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SheetSyncQuotaBucketDocument`; `SheetSyncQuotaBucket`

## Parity checks for future implementation

Unique triple; op enum; counter/default; TTL on window_start; default binding; no reservation/policy change.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
