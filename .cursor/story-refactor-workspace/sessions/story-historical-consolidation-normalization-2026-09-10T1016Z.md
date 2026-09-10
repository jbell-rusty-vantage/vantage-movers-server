# Session story-historical-consolidation-normalization-2026-09-10T1016Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `normalization.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 288 (through `historical-consolidation-schema-validation.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `normalization.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-normalization.md`
- operations named: fold this historical sheet cell so two labels can match (NFKC / trim / collapse / English lower); fold it so we can print it (no lower); read this Agent cell on `/` only after stripping terminal Split and percent; keep this Customer cell as one display (flags do not quarantine); turn this money cell into integer cents or say empty / invalid — never coerce blank to zero; give remainder cents to the earliest distinct Agent ids — never resolve the catalog, never plan a Booking, never ask `splitBinderEvenly`
- remaining in this service: `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `dateParsing.ts`

## Messages posted

- 2026-09-10T1016Z next

## Ideas parked

- none

## Contradictions

- This fold does not resolve catalog Agents; leftover `planner.ts` asks `catalog.agent` after tokenize
- Live `splitBinderEvenly` is 1-or-2 Agents in dollars; this `allocateCents` is N Agents in integer cents
- Leftover `dateParsing.ts` reuses `ParseResult` only — Eastern wall clock is not this file
- Folder `normalization.test.ts` also asks leftover `parseEasternDate` / leftover `googleSerialToEastern` — those are not this interface
- Staged-merge script folder is absent from this checkout; `pnpm historical:plan` still named in `package.json`
