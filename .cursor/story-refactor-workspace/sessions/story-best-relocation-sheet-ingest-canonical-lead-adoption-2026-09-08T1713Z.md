# Session story-best-relocation-sheet-ingest-canonical-lead-adoption-2026-09-08T1713Z

- Date (UTC): 2026-09-08T17:13Z
- Service / module: `bestRelocationSheetIngest` / `canonicalLeadAdoption.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 247
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `canonicalLeadAdoption.ts`

This checkout booted on `cursor/*` with a stale seed (`sourceChangePolicy.ts` next, 246 recs). Disk on `docs/story-refactor` already had 247 recommendations through `best-relocation-sheet-ingest-source-change-policy.md`. `bestRelocationSheetIngest` was in-progress. Next work was `canonicalLeadAdoption.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `src/services/bestRelocationSheetIngest/canonicalLeadAdoption.ts` → [recommendations/best-relocation-sheet-ingest-canonical-lead-adoption.md](../recommendations/best-relocation-sheet-ingest-canonical-lead-adoption.md)
- operations named: decide whether a remaining Form create adopts (Tracking Reference / LID, then phone+name+New York day); adopt a remaining Call on phone + Florida second; adopt a remaining Booking on unique Job; adopt a remaining Cancellation from the Booking already on this walk; walk remaining creates and leave receipt outcomes alone
- remaining in this service: `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `bootstrap.ts`

## Messages posted

- 2026-09-08T1713Z next-run

## Ideas parked

- none

## Contradictions

- Two adopt stories (this file may create; bootstrap never creates and requires source-owned match)
- Identity adopt does not skip Duplicate Leads or the cutoff; contact adopt does
- `findFormLeadsByPhoneNameDate` queries phone only
- Booking / Cancellation lookup has no Source Company
- HANDOFF.md still names HTTP `apply.ts` as the live path
