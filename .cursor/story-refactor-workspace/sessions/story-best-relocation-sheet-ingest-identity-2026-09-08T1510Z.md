# Session story-best-relocation-sheet-ingest-identity-2026-09-08T1510Z

- Date (UTC): 2026-09-08T15:10Z
- Service / module: `bestRelocationSheetIngest` / `identity.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 29 / 1 / 8
- Recommendations on disk: 245
- Current service / next module (TRAVERSAL): `bestRelocationSheetIngest` (in-progress) / `identity.ts`

This checkout booted on `cursor/*` with a stale seed (`provider.ts` next, 244 recs). Disk on `docs/story-refactor` already had 245 recommendations through `best-relocation-sheet-ingest-provider.md`. `bestRelocationSheetIngest` was in-progress. Next work was `identity.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `src/services/bestRelocationSheetIngest/identity.ts` → [recommendations/best-relocation-sheet-ingest-identity.md](../recommendations/best-relocation-sheet-ingest-identity.md)
- operations named: mint and validate a vantage: UUID v4; name the stable source row id (lead: / vantage: / booking:); refuse a copied identity except two-agent Booked Deals; checksum what the sheet owns for this row
- remaining in this service: `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`

## Stock at end

- Visited / in-progress / unvisited: 29 / 1 / 8
- Current service / next module: `bestRelocationSheetIngest` (in-progress) / `sourceChangePolicy.ts`

## Messages posted

- 2026-09-08T1510Z next-run

## Ideas parked

- none

## Contradictions

- Two vantage validators (strict UUID v4 vs loose 36 hex/dash)
- HTTP `plan.sourceLeadKey` still falls back to sheet row; this file throws
- Unused `canonicalSourceValues`; `HANDOFF.md` still names Call as phone + date/time
