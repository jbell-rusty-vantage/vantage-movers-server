# Session story-best-relocation-sheet-ingest-application-plan-2026-09-08T1308Z

- Date (UTC): 2026-09-08T13:08Z
- Service / module: `bestRelocationSheetIngest` / `applicationPlan.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 243
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `applicationPlan.ts`

This checkout booted on `cursor/*` with a stale seed (`plan.ts` next, 242 recs). Disk on `docs/story-refactor` already had 243 recommendations through `best-relocation-sheet-ingest-plan.md`. `bestRelocationSheetIngest` was in-progress. Next work was `applicationPlan.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `src/services/bestRelocationSheetIngest/applicationPlan.ts` → [recommendations/best-relocation-sheet-ingest-application-plan.md](../recommendations/best-relocation-sheet-ingest-application-plan.md)
- operations named: drop Refunds outside the window, refuse invalid rows, and poison a Job when any Booked Deal row is invalid; remap each HTTP mutation onto a checksum-bound action at the 0.9 cut; open a blocking unmatched-refund for every Refund the play did not cancel; open a warning leadless reconciliation conflict for every leadless Booking; order Form / Call, Booking, conflict, Cancellation, then checksum the locked play
- remaining in this service: `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `provider.ts`

## Messages posted

- 2026-09-08T1308Z next-run

## Ideas parked

- none

## Contradictions

- This file’s checksum is dropped by `adapter.plan`; worker recomputes after later remaps
- `unchangedEvidence` unused at runtime; worker remaps `unchanged` after the plan
- Unused `SOURCE_COMPANY` import; two 0.9 constants; `HANDOFF.md` still says 0.5 / HTTP live apply
