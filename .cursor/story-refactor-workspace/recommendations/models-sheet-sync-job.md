# Durable coalescible Sheet intent

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SheetSyncJob.ts`
- Knowledge: `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Resource/entity/operation, due/status/priority/attempts/lease and tombstone snapshot survive document deletion. coalescing_key/status index supports service logic but is not unique. Default adapter remains.

## Remaining naming and organization work

Group intent/tombstone/scheduling/attempts. Keep coalescing policy in service; schema alone does not deduplicate pending jobs.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SheetSyncJobDocument`; `SheetSyncJob`

## Parity checks for future implementation

Fields/statuses; due/coalesce/lease/entity indexes; delete snapshot; reuse; no enqueue/claim/Google write.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
