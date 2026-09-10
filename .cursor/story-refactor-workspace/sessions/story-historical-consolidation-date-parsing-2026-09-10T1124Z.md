# Session story-historical-consolidation-date-parsing-2026-09-10T1124Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `dateParsing.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 289 (through `historical-consolidation-normalization.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `dateParsing.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-date-parsing.md`
- operations named: read this historical Eastern wall clock as a UTC ISO instant (weekday strip, slash or ISO, 0205 Book Date option, refuse spring gap, prefer EST on fall-back); read this Google Sheets serial as Eastern wall-clock parts then the same UTC instant — never store Florida calendar midnight, never classify the April 30 cohort, never ask live `parseFloridaCalendarDate`
- remaining in this service: `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `stableJson.ts`

## Messages posted

- 2026-09-10T1124Z next

## Ideas parked

- none

## Contradictions

- This file copies live `easternWallClockToUtc` and does not import it
- Fall-back 1:30 AM is accepted EST here; reporting `localBoundaryToUtc` throws `Ambiguous`
- Best Relocation `dateFromGoogleSerial` treats a serial as a UTC instant; this file rereads UTC parts as Eastern wall clock
- `googleSerialToEastern` has no planner caller
- Folder `normalization.test.ts` hosts this interface next to leftover fold tests
- Staged-merge script folder is absent from this checkout; `pnpm historical:plan` still named in `package.json`
