# Session story-operations-registry-queries-changes-2026-09-04T1723Z

- Date (UTC): 2026-09-04T17:23Z
- Service / module: `operationsRegistry` / `queries/changes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (opens after #159 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 156
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `queries/changes.ts`

This checkout booted on `cursor/vantage-server-story-refactor-6752` with a stale seed (NOW pointed at `queries/health.ts`, 155 recs, PR #158). Disk on `docs/story-refactor` already had `operations-registry-queries-health.md` (156 recs, next `queries/changes.ts`, PR #159, already merged). Checked out `docs/story-refactor` before choosing the module. NOW.md held the lock for this session id.

Checklist already listed leftover `labelMappings.ts`, `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts` after the query trio. Runtime `.ts` files in `src/services/operationsRegistry/` matched the row. No files added this pass.

## This pass

- opened new service?: no
- path or skip: recommended `queries/changes.ts` → [recommendations/operations-registry-queries-changes.md](../recommendations/operations-registry-queries-changes.md)
- operations named: show the successful Registry Change cards (filter + page + newest first); flatten secrets on the way out again. This file does not stamp a card, count the shelf, write a finding, decide who may speak, or mix leftover Operational Events / leftover `EntityChange` into the list.
- remaining in this service: `labelMappings.ts` (next), `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `labelMappings.ts`

## Messages posted

- 2026-09-04T1723Z next-run

## Ideas parked

- none

## Contradictions

- none (`page` is not clamped while `limit` is; `from` after `to` returns empty; flatten runs on stamp and on read; leftover health uses leftover `actor_id` regex for leftover migration cards while this list is exact match; named in the recommendation; this pass does not “fix” them)
