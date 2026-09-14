# Session story-models-granot-automation-source-2026-09-14T0308Z

- Date (UTC): 2026-09-14T0308Z
- Service / module: `models` / `GranotAutomationSource.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 374
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotAutomationSource.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-automation-source.md](../recommendations/models-granot-automation-source.md)
- operations named: hold the Granot HTTP automation source card; refuse an illegal exact label and remember which Lead workflows it supports plus who planted it; stamp the named clocks and hand back the default-connection model
- remaining in this service: `SheetSyncJob.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `SheetSyncJob.ts`

## Messages posted

- 2026-09-14T0308Z next

## Ideas parked

- none

## Contradictions

- No selected-database getter; leftover catalog leftover-asks the default model after leftover `connectMongo()`
- Leftover pointer leftover-asks this default model and leftover `getGranotCrmSourceModel()` for the leftover CRM row
- Exact leftover `label` unique lives on the field, not in leftover `GRANOT_AUTOMATION_SOURCE_INDEXES` (migration unique count is 0)
- Label is exact, not folded; leftover CRM name leftover-folds elsewhere
- `supported_operations` is list/create compatibility, not apply authority
- File omits `autoIndex: false` (boot creates leftover named leftover clocks); leftover `pnpm migration:granot-lifecycle:indexes` leftover-stamps the same named leftover clocks as non-unique
- Optional leftover `granot_crm_source`; leftover CRM leftover clock leftover-is not unique (AC-38)
- `schema-and-crud-inputs.mdc` does not name `granot_automation_sources`
- Leftover later `SheetSyncJob.ts` is the leftover durable leftover Sheet leftover Sync leftover outbox — do not merge this leftover source into that leftover job
