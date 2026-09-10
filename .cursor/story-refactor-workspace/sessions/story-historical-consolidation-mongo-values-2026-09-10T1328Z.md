# Session story-historical-consolidation-mongo-values-2026-09-10T1328Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `mongoValues.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 291 (through `historical-consolidation-stable-json.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `mongoValues.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-mongo-values.md`
- operations named: materialize this historical `$oid` / `$date` bag into live Mongo values (singleton wrappers only; `$exists` survives); fold this live Mongo value into comparable extended JSON (`ObjectId` → `$oid` hex, `Date` → `$date` ISO, localeCompare keys); prove only the planned fields still match the live document — never stamp SHA-256, never write Mongo, never plan a Booking
- remaining in this service: none (`historicalConsolidation` visited)

## Stock at end

- Visited / in-progress / unvisited: 34 / 0 / 4
- Current service / next module: `testimonials` (unvisited — enumerate first)

## Messages posted

- 2026-09-10T1328Z next

## Ideas parked

- none

## Contradictions

- `comparable` folds Date to `{ $date: ISO }` and ObjectId to `{ $oid: hex }`; leftover `stableJson` folds Date to raw ISO and does not know ObjectId
- Apply checksums ask `comparable` first, then leftover `sha256`
- `matchesPlanned` is planned-keys only; extra live keys (server-owned revision defaults) must not fail
- Singleton `$oid` / `$date` is load-bearing so leftover `{ $exists: false }` survives into apply's filter
- `$date` is a string only; extended JSON v2 `{ $date: { $numberLong } }` would recurse
- Invalid `$date` materializes to Invalid Date; `comparable` then `toISOString()` throws
- `instanceof ObjectId` is the `mongodb` class this file imports
- `comparable` does not drop `undefined` or refuse Infinity; leftover `stableJson` does
- There is no `mongoValues.test.ts`
- Barrel does not re-export these four
- Staged-merge script folder is absent from this checkout; `pnpm historical:apply` / `verify` / `rollback` still named in `package.json`
