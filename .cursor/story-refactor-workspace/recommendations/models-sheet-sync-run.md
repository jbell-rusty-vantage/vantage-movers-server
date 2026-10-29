# Drain-run history and retention

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SheetSyncRun.ts`
- Knowledge: `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Trigger/status/times and claimed/synced/failed/deferred counters plus optional errors/quota. Current named started_at TTL (90 days) supplements newest/status indexes. History is distinct from durable intent/attempt.

## Remaining naming and organization work

Group invocation/result; preserve retention constants/index/default model. No drain ownership authority from history row.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SHEET_SYNC_RUN_RETENTION_SECONDS`; `SHEET_SYNC_RUN_TTL_INDEX`; `SheetSyncRunDocument`; `SheetSyncRun`

## Parity checks for future implementation

Trigger/status; counters/clocks; newest/status/TTL exact; reuse; no claim/Google write.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
