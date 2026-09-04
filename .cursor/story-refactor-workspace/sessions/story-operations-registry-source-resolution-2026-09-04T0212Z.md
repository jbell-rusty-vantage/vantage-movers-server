# Session story-operations-registry-source-resolution-2026-09-04T0212Z

- Date (UTC): 2026-09-04T02:12Z
- Service / module: `operationsRegistry` / `sourceResolution.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/145

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 141
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `sourceResolution.ts`

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`operationsRegistry` / `sourceRegistry.ts`, 140 recommendations, PR #143). `origin/docs/story-refactor` already had `sourceRegistry.ts` recommended, next `sourceResolution.ts` (141 recommendations, last session story-operations-registry-source-registry-2026-09-04T0114Z, PR #144). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `sourceResolution.ts` → [recommendations/operations-registry-source-resolution.md](../recommendations/operations-registry-source-resolution.md)
- operations named: pick the company from the hint or leave the field open; walk the live-Feed ladder (first typed exact identifier, then local or long distance, then leftover alias by unique highest priority, then the company channel default); stamp the attribution or say missing / ambiguous. Never invent a company. Never pick the first of two equal-priority leftover aliases. Inactive cards are invisible. Never load Mongo. Never throw. Never write an Operational Event.
- remaining in this service: `cplSchedule.ts` (next), `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `cplSchedule.ts`

## Messages posted

- 2026-09-04T0212Z next-run

## Ideas parked

- none

## Contradictions

- none (`local` stamped as `match_kind: "exact"` is a lying stored value named in the recommendation; this pass does not re-label it)
