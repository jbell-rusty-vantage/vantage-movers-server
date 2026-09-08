# Session story-best-relocation-sheet-ingest-bootstrap-2026-09-08T1810Z

- Date (UTC): 2026-09-08T18:10Z
- Service / module: `bestRelocationSheetIngest` / `bootstrap.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 248
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `bootstrap.ts`

This checkout booted on `cursor/*` with a stale seed (`canonicalLeadAdoption.ts` next, 247 recs). Disk on `docs/story-refactor` already had 248 recommendations through `best-relocation-sheet-ingest-canonical-lead-adoption.md`. `bestRelocationSheetIngest` was in-progress. Next work was `bootstrap.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `src/services/bestRelocationSheetIngest/bootstrap.ts` → [recommendations/best-relocation-sheet-ingest-bootstrap.md](../recommendations/best-relocation-sheet-ingest-bootstrap.md)
- operations named: refuse any plan that is not first-run bootstrap; adopt a unique Form on Tracking Reference / LID when source-owned values already match; adopt a unique Call on phone + Florida second when source-owned values already match; adopt a unique Booking on Job when money, merchant, book date, source, and ownership already match; adopt a unique Cancellation from this walk’s Booking when refund facts already match; walk creates — unique match adopts (keep the body), zero or two block, then stamp financial reconciliation
- remaining in this service: `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `updatePolicy.ts`

## Messages posted

- 2026-09-08T1810Z next-run

## Ideas parked

- none

## Contradictions

- Two adopt stories (bootstrap never creates, requires source-owned match, keeps the body; recurring may create, ignores field equality, drops the body)
- Worker feeds the unmapped snapshot; recurring uses `withEvidence`
- Form identity does not skip Duplicate Leads or the cutoff; Call query skips duplicates
- Booking / Cancellation lookup has no Source Company
- CLI never asks this file
- The “remaps creates” test never calls `planBootstrapAdoption`
- HANDOFF.md still names HTTP `apply.ts` as the live path
