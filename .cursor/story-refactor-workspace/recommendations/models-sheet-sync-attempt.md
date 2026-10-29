# Per-target Sheet attempt with retention

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SheetSyncAttempt.ts`
- Knowledge: `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Run/job refs, action/status and safe provider/quota summary. Current named createdAt TTL export (90 days) supplements run/job/status indexes; old brief omitted retention.

## Remaining naming and organization work

Group attempt identity/outcome; preserve retention constants/index/default model, distinct from run/job/lease.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SHEET_SYNC_ATTEMPT_RETENTION_SECONDS`; `SHEET_SYNC_ATTEMPT_TTL_INDEX`; `SheetSyncAttemptDocument`; `SheetSyncAttempt`

## Parity checks for future implementation

Action/status; run required/job optional; clocks/read indexes; exact TTL; no Google write/drain/admin query.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
