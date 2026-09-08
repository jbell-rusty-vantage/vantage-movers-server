# Session story-best-relocation-sheet-ingest-update-policy-2026-09-08T1912Z

- Date (UTC): 2026-09-08
- Service / module: `bestRelocationSheetIngest` / `updatePolicy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 249 (through `best-relocation-sheet-ingest-bootstrap.md`)
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `updatePolicy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/best-relocation-sheet-ingest-update-policy.md`
- operations named: name the Form fields vs the Call fields Best Relocation still owns; compare last receipt, today’s sheet, and Mongo for each changed path; collapse to unchanged, a safe patch, or an all-or-nothing conflict; list the source-owned paths for callers that select or bag them
- remaining in this service: `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `apply.ts`

## Messages posted

- 2026-09-08T1912Z next

## Ideas parked

- none

## Contradictions

- Two uses of one decide (receipt skip patches; bootstrap equality-only)
- `originated_from_best_relocation` always true at runtime
- Compare fold vs write fold (name/city case)
- Form `destination_zip` vs Call `delivery_zip`
- Knowledge / HANDOFF never name this file
