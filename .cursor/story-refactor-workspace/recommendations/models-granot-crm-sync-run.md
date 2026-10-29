# Legacy Granot CSV sync-run evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotCrmSyncRun.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md`, `.cursor/rules/granot-crm-csv-s3-sync.mdc` (related live CSV contract; no dedicated model Service exists).

## Current storage contract

Mode/status, timing and counts use selected database; distinct from automation run and lifecycle receipt.

## Remaining naming and organization work

Keep catalogs/getter; clarify evidence versus workflow execution. Do not merge collections because both say sync.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_CRM_SYNC_RUN_MODES`; `GRANOT_CRM_SYNC_RUN_STATUSES`; `GranotCrmSyncRun`; `GranotCrmSyncRunDocument`; `getGranotCrmSyncRunModel`

## Parity checks for future implementation

Modes/statuses; clocks/counts; newest index; selected DB; no fetch or domain action.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
