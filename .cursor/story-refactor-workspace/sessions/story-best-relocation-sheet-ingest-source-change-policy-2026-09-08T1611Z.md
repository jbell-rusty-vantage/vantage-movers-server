# Session story-best-relocation-sheet-ingest-source-change-policy-2026-09-08T1611Z

- Date (UTC): 2026-09-08
- Service / module: `bestRelocationSheetIngest` / `sourceChangePolicy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 246
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` / `sourceChangePolicy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/best-relocation-sheet-ingest-source-change-policy.md`
- operations named: classify the last successful receipt against this row; receipt-skip the same sheet or re-adopt a vanished-then-returned row; ask the three-way update instead of minting a second Lead; refuse every other change as a protected-field conflict; rewrite depends_on onto revision keys and recount
- remaining in this service: `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `canonicalLeadAdoption.ts`

## Messages posted

- 2026-09-08T1611Z next-run

## Ideas parked

- none

## Contradictions

- none
