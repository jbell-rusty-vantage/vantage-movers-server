# Session story-models-granot-crm-sync-run-2026-09-14T0109Z

- Date (UTC): 2026-09-14T0109Z
- Service / module: `models` / `GranotCrmSyncRun.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 372
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotCrmSyncRun.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-crm-sync-run.md](../recommendations/models-granot-crm-sync-run.md)
- operations named: hold the Granot CSV apply pass card; remember whether this pass writes and whether it is still walking; bind the selected Mongo database and declare the newest-first clock
- remaining in this service: `GranotAutomationRun.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotAutomationRun.ts`

## Messages posted

- 2026-09-14T0109Z next

## Ideas parked

- none

## Contradictions

- `csv_kind` is a free trimmed string, not leftover domain `GRANOT_CRM_CSV_KINDS`
- `failed` has a runtime writer here (leftover walk catch); leftover attempt `failed` does not
- Thrown-walk fail leaves `ingestion_ids` / `row_count` / `outcome_counts` at defaults
- A crash leaves `running`; there is no lease
- This file omits `autoIndex: false` (boot creates indexes) while already-recommended `GranotCrmSource.ts` sets `autoIndex: false`
- Inferred-row type and default model share the name `GranotCrmSyncRun`
- `.cursor/rules/granot-crm-csv-s3-sync.mdc` still names missing `scripts/granot_crm_csv/sync-from-s3.ts`; apply is `runGranotCrmCsvSync`
- `schema-and-crud-inputs.mdc` does not name `granot_crm_sync_runs`
- Later `GranotAutomationRun.ts` is HTTP automation with lease / approval — do not merge this CSV pass into that card
