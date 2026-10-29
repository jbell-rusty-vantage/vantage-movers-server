# Granot CSV ingestion receipt

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotCrmCsvIngestion.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md`, `.cursor/rules/granot-crm-csv-s3-sync.mdc` (related live CSV contract; no dedicated model Service exists).

## Current storage contract

Source/kind/trigger/status and artifact metadata/summaries use selected database. Granot CSV ingest differs from retired Best Relocation external sheet ingest.

## Remaining naming and organization work

Name artifact, attempt and result groups; retain catalogs/getter. Do not delete because filename says ingestion or duplicate lifecycle normalization.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_CRM_CSV_INGESTION_TRIGGERS`; `GRANOT_CRM_CSV_INGESTION_STATUSES`; `GranotCrmCsvIngestion`; `GranotCrmCsvIngestionDocument`; `getGranotCrmCsvIngestionModel`

## Parity checks for future implementation

Kinds/triggers/statuses; count/time defaults; read indexes; selected DB; no fetch/parse/domain execution.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
