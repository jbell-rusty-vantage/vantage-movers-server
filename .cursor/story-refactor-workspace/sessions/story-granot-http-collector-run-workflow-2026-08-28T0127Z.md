# Session story-granot-http-collector-run-workflow-2026-08-28T0127Z

- Date (UTC): 2026-08-28T0127Z
- Service / module: `granotHttpCollector` / `runWorkflow.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/81

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 12 / 1 / 25
- Recommendations on disk: 77
- Current service / next module (TRAVERSAL): `granotHttpCollector` (in-progress) / `runWorkflow.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotHttpCollector/runWorkflow.ts` → [recommendations/granot-http-collector-run-workflow.md](../recommendations/granot-http-collector-run-workflow.md)
- operations named: queue a durable Granot automation run; collect the tables and lock the sealed plan; approve selected actions on the sealed apply plan; walk selected actions into lifecycle capture; claim the account, wake leftover queued work, and show a redacted run
- remaining in this service: none (`errors.ts` already skipped)

## Stock at end

- Visited / in-progress / unvisited: 13 / 0 / 24
- Current service / next module: `granotHttpCollector` (visited) / open `granotCrmCsv` (enumerate first)

## Messages posted

- 2026-08-28T0127Z next

## Ideas parked

- none

## Contradictions

- HANDOFF still describes the old Form/Call write
- Knowledge `automation-apply.md` Primary code lists this file beside capture
- Checksum envelope `schema_version: 1` over a sealed schema-2 plan
- Label-only `createGranotRun` skips resolve
- `buildFormExpectedFilter` leftover, test-only
- recover / continue reprint the leftover-work query
- `formWorkflow.test.ts` locks `granotApplyEnabled` from this file
- This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel
