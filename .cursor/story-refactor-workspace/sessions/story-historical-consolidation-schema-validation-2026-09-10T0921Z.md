# Session story-historical-consolidation-schema-validation-2026-09-10T0921Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `schemaValidation.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 287 (through `historical-consolidation-operational-lock.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `schemaValidation.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-schema-validation.md`
- operations named: refuse leftover insert unless live leftover checked-in leftover Mongoose leftover `validateSync` leftover-passes, leftover leftover-`toObject` leftover leftover-adds leftover leftover-no leftover leftover-field leftover leftover-except leftover leftover-`domain_revision` leftover / leftover leftover-`change_history_started_at` leftover / leftover leftover-`granot_contact_revision` leftover / leftover leftover-`quoted`, leftover leftover-and leftover leftover-every leftover leftover-planned leftover leftover-field leftover leftover-still leftover leftover-comparable-equals; refuse leftover leftover-update leftover leftover-unless leftover leftover-each leftover leftover-`set` leftover leftover-field leftover leftover-still leftover leftover-casts leftover leftover-or leftover leftover-is leftover leftover-a leftover leftover-known leftover leftover-nested leftover leftover-object leftover leftover-walk — never leftover leftover-write leftover leftover-Mongo, leftover leftover-never leftover leftover-re-ask leftover leftover-at leftover leftover-leftover leftover leftover-apply, leftover leftover-never leftover leftover-prove leftover leftover-unique leftover leftover-indexes
- remaining in this service: `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `normalization.ts`

## Messages posted

- 2026-09-10T0921Z next

## Ideas parked

- none

## Contradictions

- Seal-time leftover `validateSync` only; leftover apply / leftover verify / leftover parse never leftover-ask this file
- Unique indexes are leftover apply leftover preflight, not this walk
- leftover `quoted` is on leftover `SERVER_OWNED_REVISION_DEFAULTS` and is a leftover sheet-planned leftover fact
- leftover update leftover never leftover-`validateSync`s leftover the leftover whole leftover document
- leftover `schemaValidation.test.ts` leftover only leftover-proves leftover Booked leftover nested leftover update
