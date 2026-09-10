# Session story-historical-consolidation-stable-json-2026-09-10T1220Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `stableJson.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 290 (through `historical-consolidation-date-parsing.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `stableJson.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-stable-json.md`
- operations named: fold this historical bag into one stable string (drop undefined, localeCompare keys, refuse Infinity); stamp SHA-256 of the raw string or the fold; mint a 24-hex ObjectId from namespace + NUL + natural key; prove the sealed manifest body still hashes to `manifest_hash` — never seal a durable-work envelope, never write Mongo, never plan a Booking
- remaining in this service: `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `mongoValues.ts`

## Messages posted

- 2026-09-10T1220Z next

## Ideas parked

- none

## Contradictions

- This fold drops `undefined`; durable-work `canonicalJson` refuses it
- Key sort is locale-default `localeCompare`; durable-work uses UTF-16 `Object.keys().sort()`
- Domain Command `existingWriteContext` is a near copy that does not throw on Infinity
- `sha256` string passthrough vs folded bag; Form/Call identity is 64 hex, insert `_id` is 24 hex
- `assertArtifactHash` echoes both hexes and is not timing-safe
- There is no `stableJson.test.ts`
- Staged-merge script folder is absent from this checkout; `pnpm historical:plan` still named in `package.json`
