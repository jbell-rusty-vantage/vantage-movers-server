# Session story-models-entity-change-2026-09-14T2009Z

- Date (UTC): 2026-09-14
- Service / module: `models` / `EntityChange.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 391
- Current service / next module (TRAVERSAL): `models` / `EntityChange.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-entity-change.md`
- operations named: hold the append-only mutation evidence row; remember which aggregate revision this is and hide contact, delete, and forbidden raw paths; refuse rewrite, stamp the named clocks, and bind the selected-database getter
- remaining in this service: `DomainCommandExecution.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `DomainCommandExecution.ts`

## Messages posted

- 2026-09-14T2009Z next-run

## Ideas parked

- none

## Contradictions

- none (existing CONTRADICTIONS row already names the copied `CONTACT_OR_ADDRESS_PATH` plus `FORBIDDEN_RAW_PATH` only on this file)
