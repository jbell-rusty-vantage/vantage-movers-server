# Shared field contracts and Sheet row hints

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/schemaHelpers.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/google-sheets.md`, `docs/knowledge/services/sheet-sync.md`

## Current storage contract

Source/local/Lead-model fields and sheet_sync subdocument plus pure remove/merge by target. Deleted is not persisted status; last write wins per target. Required/optional local differ.

## Remaining naming and organization work

Keep value/schema contracts together; name target removal/merge clearly. No source enum/unified Lead or global required Lead-model change overriding Booking optionality.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`sourceCompanyField`; `localField`; `optionalLocalField`; `leadModelField`; `sheetSyncSchema`; `SheetSyncEntry`; `removeSheetSyncEntries`; `mergeSheetSyncEntries`

## Parity checks for future implementation

Required/enums; optional local; duplicate-target last wins; removed targets; row hints preserved by caller; no enqueue/Google write.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
