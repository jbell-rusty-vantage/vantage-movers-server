# Session story-operations-registry-label-mappings-2026-09-04T1816Z

- Date (UTC): 2026-09-04T18:16Z
- Service / module: `operationsRegistry` / `labelMappings.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/162

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 157
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `labelMappings.ts`

This checkout booted on `cursor/vantage-server-story-refactor-f5e2` with a stale seed (NOW pointed at `queries/changes.ts`, 156 recs, PR #159). Disk on `docs/story-refactor` already had `operations-registry-queries-changes.md` (157 recs, next `labelMappings.ts`, PR #160, already merged). Checked out `docs/story-refactor` before choosing the module. NOW.md held the lock for this session id. This pass opened https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/162.

Checklist already listed leftover `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts` after leftover label mappings. Runtime `.ts` files in `src/services/operationsRegistry/` matched the row. No files added this pass.

## This pass

- opened new service?: no
- path or skip: recommended `labelMappings.ts` → [recommendations/operations-registry-label-mappings.md](../recommendations/operations-registry-label-mappings.md)
- operations named: hang a sheet or leftover API spelling on one live Feed; archive or restore the hung spelling (never edit the destination); show the hung spellings; ask the collection which Feed this spelling points at; fall back to leftover `SOURCE_LABEL_TO_COMPANY` only on miss and fail closed on clash or dead Feed. This file does not walk the leftover hint ladder, write a leftover health finding, or decide who may speak.
- remaining in this service: `ownerGranotNames.ts` (next), `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `ownerGranotNames.ts`

## Messages posted

- 2026-09-04T1816Z next-run

## Ideas parked

- none

## Contradictions

- none (hang does not require `company.active` while resolve treats inactive company as `inactive_destination`; `inactive_destination` shares Event key / telemetry kind with `not_found`; leftover `sheet_legacy_resolution` is kept on health and dropped on overview; collection-first tests live in `sourceResolution.test.ts`; leftover sheet / CRM / recon / analytics still walk `SOURCE_LABEL_TO_COMPANY` directly; named in the recommendation; this pass does not “fix” them)
