# Session story-operations-registry-owner-granot-names-2026-09-04T1926Z

- Date (UTC): 2026-09-04T19:26Z
- Service / module: `operationsRegistry` / `ownerGranotNames.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/163

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 158
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `ownerGranotNames.ts`

This checkout booted on `cursor/vantage-server-story-refactor-362e` with a stale seed (NOW pointed at `labelMappings.ts`, 157 recs, PR #160). Disk on `docs/story-refactor` already had `operations-registry-label-mappings.md` (158 recs, next `ownerGranotNames.ts`, PR #162, already merged). Checked out `docs/story-refactor` before choosing the module. NOW.md held the lock for this session id.

Checklist already listed leftover `leadSourceSetup.ts` and `queries/leadSourceProjection.ts` after leftover Granot create. Runtime `.ts` files in `src/services/operationsRegistry/` matched the row. No files added this pass.

## This pass

- opened new service?: no
- path or skip: recommended `ownerGranotNames.ts` → [recommendations/operations-registry-owner-granot-names.md](../recommendations/operations-registry-owner-granot-names.md)
- operations named: hang this Granot spelling from Owner intent; assemble this Granot spelling for a known Feed; say whether this Granot spelling is still free. This file does not correct an existing name, resolve a live observation, send a text, or invent a second Granot write.
- remaining in this service: `leadSourceSetup.ts` (next), `queries/leadSourceProjection.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `leadSourceSetup.ts`

## Messages posted

- 2026-09-04T1926Z next-run

## Ideas parked

- none

## Contradictions

- none (hang duplicates `assertGranotNameAvailable` instead of asking it; hang inlines `assembleOneFeedRoutes`; sibling defaults `enabled: true` when omitted; `choosing_create_if_missing_does_not_make_texting_live` is a constant; inactive Feed/company is a legal draft; hang’s duplicate checks run outside the sibling transaction; assemble cannot hang referral or watch-only; Owner POST returns this card while sibling PATCH re-reads projection; named in the recommendation; this pass does not “fix” them)
