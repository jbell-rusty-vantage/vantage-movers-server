# Session story-models-granot-automation-run-2026-09-14T0210Z

- Date (UTC): 2026-09-14T0210Z
- Service / module: `models` / `GranotAutomationRun.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 373
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotAutomationRun.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-automation-run.md](../recommendations/models-granot-automation-run.md)
- operations named: hold the Granot HTTP automation run card; remember whether this run only previews and which status word it is at; stamp the named clocks and embed the durable-work fence nest
- remaining in this service: `GranotAutomationSource.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotAutomationSource.ts`

## Messages posted

- 2026-09-14T0210Z next

## Ideas parked

- none

## Contradictions

- No selected-database getter; leftover walk leftover-asks the default model after leftover `connectMongo()`
- `GRANOT_RUN_STATUSES` drops “Automation”
- Card `schema_version` defaults to `1`; leftover sealed plan is `2`
- Two leftover clocks: leftover account `granot:automation:account` on leftover later `SheetSyncLease`, leftover row fence on this card
- Run-level Mixed `receipts[]` are not Observation Receipts
- Mongo leftover-TTL leftover-deletes the leftover card at leftover `purge_at`; leftover lifecycle leftover receipts leftover-remain
- Plan identity is unique `{ _id, plan_checksum }` partial, not unique `plan_checksum` alone
- This file omits `autoIndex: false` (boot creates leftover named leftover indexes)
- Leftover recover query is richer than leftover `granot_run_recovery`
- `schema-and-crud-inputs.mdc` does not name `granot_automation_runs`
- Leftover later `GranotAutomationSource.ts` is the leftover HTTP leftover source leftover catalog — do not merge this leftover run into that leftover card
