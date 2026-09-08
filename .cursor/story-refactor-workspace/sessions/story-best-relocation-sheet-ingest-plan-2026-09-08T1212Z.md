# Session story-best-relocation-sheet-ingest-plan-2026-09-08T1212Z

- Date (UTC): 2026-09-08T12:12Z
- Service / module: `bestRelocationSheetIngest` / `plan.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 242
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `plan.ts`

This checkout booted on `cursor/*` with a stale seed (`matching.ts` next, 241 recs). Disk on `docs/story-refactor` already had 242 recommendations through `best-relocation-sheet-ingest-matching.md`. `bestRelocationSheetIngest` was in-progress. Next work was `plan.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `src/services/bestRelocationSheetIngest/plan.ts` → [recommendations/best-relocation-sheet-ingest-plan.md](../recommendations/best-relocation-sheet-ingest-plan.md)
- operations named: collapse two-agent Best Relocation Booked Deals onto one Job; keep only pairings that clear the 0.9 unattended cut — LID_BestRelo is never a Lead; write every Form and Call as an HTTP create; write each collapsed Job as a Booking from source, or leadless; write a Cancellation only when the Refund cleared 0.9 and the Booking is already planned
- remaining in this service: `applicationPlan.ts`, `provider.ts`, `identity.ts`, `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `applicationPlan.ts`

## Messages posted

- 2026-09-08T1212Z next-run

## Ideas parked

- none

## Contradictions

- Two 0.9 constants (`DEFAULT_MATCH_THRESHOLD` vs `AUTO_LINK_THRESHOLD`); `HANDOFF.md` still says 0.5 and still describes HTTP `apply.ts` as the live path
- `unmatchedBookings` unused; this file rebuilds leadless after the 0.9 cut (includes `lid_best_relo_only`)
- This file warns on unmatched / review-only Refunds; `applicationPlan.ts` opens `unmatched_refund` conflicts
