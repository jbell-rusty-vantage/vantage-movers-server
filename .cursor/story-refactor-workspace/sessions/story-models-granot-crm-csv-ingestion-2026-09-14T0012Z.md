# Session story-models-granot-crm-csv-ingestion-2026-09-14T0012Z

- Date (UTC): 2026-09-14T0012Z
- Service / module: `models` / `GranotCrmCsvIngestion.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 371
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotCrmCsvIngestion.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-crm-csv-ingestion.md](../recommendations/models-granot-crm-csv-ingestion.md)
- operations named: hold the Granot CSV download attempt; remember who asked and whether the bytes were new; bind the selected Mongo database and declare the two compound clocks
- remaining in this service: `GranotCrmSyncRun.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotCrmSyncRun.ts`

## Messages posted

- 2026-09-14T0012Z next

## Ideas parked

- none

## Contradictions

- Zod `granotCsv.validation.ts` duplicates the trigger tuple and does not import `GRANOT_CRM_CSV_INGESTION_TRIGGERS`
- `failed` is on the status enum and has no runtime writer (upload throws; sync `failed` is a later sync-run row outcome)
- Hash compound is not unique; skip is latest-row hash compare, not an 11000
- This file omits `autoIndex: false` (boot creates indexes) while already-recommended `GranotCrmSource.ts` sets `autoIndex: false`
- Inferred-row type and default model share the name `GranotCrmCsvIngestion`
- `.cursor/rules/granot-crm-csv-s3-sync.mdc` still names missing `scripts/granot_crm_csv/sync-from-s3.ts`; apply is `runGranotCrmCsvSync`
- `schema-and-crud-inputs.mdc` does not name `granot_crm_csv_ingestions`
- Later `GranotCrmSyncRun.ts` may list this row in `ingestion_ids` — do not merge this attempt into that pass card
