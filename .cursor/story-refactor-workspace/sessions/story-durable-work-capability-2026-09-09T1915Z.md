# Session story-durable-work-capability-2026-09-09T1915Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `capability.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 273 (through `durable-work-checkpoints.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `capability.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-capability.md`
- operations named: say whether this capability is actually on
- remaining in this service: `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `schema.ts`

## Messages posted

- 2026-09-09T1915Z next

## Ideas parked

- none

## Contradictions

- No runtime caller; live Best Relocation / Granot / Reporting / Sheet Sync AND their own gates
- Input names (`required_configuration_present` / `deployment_gate` / `owner_intent`) disagree with snapshot names (`env_configured` / `env_enabled` / `owner_enabled`)
- Reasons collect every miss; leftover heartbeat first-fails
- Folder test only covers missing configuration
