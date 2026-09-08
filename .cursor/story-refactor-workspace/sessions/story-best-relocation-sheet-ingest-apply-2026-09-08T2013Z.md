# Session story-best-relocation-sheet-ingest-apply-2026-09-08T2013Z

- Date (UTC): 2026-09-08
- Service / module: `bestRelocationSheetIngest` / `apply.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 250 (through `best-relocation-sheet-ingest-update-policy.md`)
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `apply.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/best-relocation-sheet-ingest-apply.md`
- operations named: refuse unless confirmed, pinned, version-1 Best Relocation; skip mutations already on the checkpoint; preflight an existing Form, Call, Booking, or Cancellation; POST the public v1 path, bind earlier ids, stop on the first failed POST
- remaining in this service: `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `dryRun.ts`

## Messages posted

- 2026-09-08T2013Z next

## Ideas parked

- none

## Contradictions

- Two apply walks (HTTP `applyIngestPlan` vs leftover command `applyBestRelocationPlan`)
- Dead CLI `applyReviewedPlan` still imports this file; `main` throws `--apply`
- `plan.mode` is always `dry-run` on a live walk
- Cancellation Job from `idempotency_key.split(":").at(-2)`
- HANDOFF still describes HTTP `apply.ts` as the live path and `0.5`
