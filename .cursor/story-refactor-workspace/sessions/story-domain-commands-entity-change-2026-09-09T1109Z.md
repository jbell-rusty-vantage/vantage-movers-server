# Session story-domain-commands-entity-change-2026-09-09T1109Z

- Date (UTC): 2026-09-09
- Service / module: `domainCommands` / `entityChange.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 31 / 1 / 6
- Recommendations on disk: 265 (through `domain-commands-ringcentral-provenance.md`)
- Current service / next module (TRAVERSAL): `domainCommands` (in-progress) / `entityChange.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/domain-commands-entity-change.md`
- operations named: name what changed without writing contact; append the Change and stamp the surviving aggregate (skip stamp on delete)
- remaining in this service: `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`

## Stock at end

- Visited / in-progress / unvisited: 31 / 1 / 6
- Current service / next module: `domainCommands` (in-progress) / `existingWriteContext.ts`

## Messages posted

- 2026-09-09T1109Z next

## Ideas parked

- none

## Contradictions

- Two CAS primitives (`$inc` return vs `$set` throw)
- Contact regex copied on the model; hashed unused
- Non-ObjectId RingCentral receipts dropped from Change provenance
- Sheet ingestion and Vantage Admin share `source_system: vantage`
