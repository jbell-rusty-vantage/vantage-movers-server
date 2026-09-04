# Session story-operations-registry-queries-lead-source-projection-2026-09-04T2121Z

- Date (UTC): 2026-09-04T21:21Z
- Service / module: `operationsRegistry` / `queries/leadSourceProjection.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/164

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 160
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `queries/leadSourceProjection.ts`

This checkout booted on `cursor/vantage-server-story-refactor-5904` with a stale seed (NOW already pointed at `queries/leadSourceProjection.ts` / 160 recs / PR #164, but HEAD was a merge of `docs/story-refactor` into the cursor branch). Checked out `docs/story-refactor` before choosing the module. NOW.md held the lock for this session id.

Checklist already listed leftover `queries/leadSourceProjection.ts` as the last unchecked [REDACTED] module. Runtime `.ts` files in `src/services/operationsRegistry/` matched the row. No files added this pass. After this recommendation the service goes `visited`.

## This pass

- opened new service?: no
- path or skip: recommended `queries/leadSourceProjection.ts` → [recommendations/operations-registry-queries-lead-source-projection.md](../recommendations/operations-registry-queries-lead-source-projection.md)
- operations named: show every Lead Source with its Feeds and counted connections; open this Lead Source and list every accepted label, Granot landing, inbound number, leftover finding, and leftover gate. This file does not write, activate, price the lead, hang a name, walk the whole catalog, or translate a finding in this file.
- remaining in this service: none — `operationsRegistry` is now `visited`. Next Wave A service: `admin` (unvisited; enumerate first).

## Stock at end

- Visited / in-progress / unvisited: 24 / 0 / 14
- Current service / next module: `admin` (unvisited) / enumerate `src/services/admin/`

## Messages posted

- 2026-09-04T2121Z next-run

## Ideas parked

- none

## Contradictions

- none (list `blocking_finding_count` is always `0`; list inbound counts `active: true` assignments while detail lists all open assignments; list Granot query is route-only while detail also loads `lead_source_company`; `ownerReadinessPlan` uses all-Feeds / all-names predicates against leftover setup’s one-Feed sitting; unknown `GATE_ACTION` falls back to `open_lead_costs`; `connectionFindings` passes unpaid Lead count `0`; `arrivalFromPolicy` maps unknown policy to `watch_only`; process-global `projectionRoundTrips`; named in the recommendation; this pass does not “fix” them)
