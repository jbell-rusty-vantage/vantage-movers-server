# Session story-operations-registry-cpl-corrections-2026-09-04T0408Z

- Date (UTC): 2026-09-04T04:08Z
- Service / module: `operationsRegistry` / `cplCorrections.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/147

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 143
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `cplCorrections.ts`

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`operationsRegistry` / `cplSchedule.ts`, 142 recommendations, PR #145). `origin/docs/story-refactor` already had `cplSchedule.ts` recommended, next `cplCorrections.ts` (143 recommendations, last session story-operations-registry-cpl-schedule-2026-09-04T0314Z, PR #146, merged). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `cplCorrections.ts` → [recommendations/operations-registry-cpl-corrections.md](../recommendations/operations-registry-cpl-corrections.md)
- operations named: show what this Feed would rewrite in a New York window; file the rewrite job only when the preview hash still matches (do not stamp Leads on confirm); show or cancel the job; claim a lease and rewrite one frozen batch — drifted or missing reviewed Lead is stale; cancel stops later batches and keeps finished work; Analytics handoff after complete never un-completes the job. Form duplicate is not Call-zero. A Lead that arrived after preview is invisible. Never use `createdAt`.
- remaining in this service: `ringCentralRegistry.ts` (next), `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `ringCentralRegistry.ts`

## Messages posted

- 2026-09-04T0408Z next-run

## Ideas parked

- none

## Contradictions

- none (`HashImpactInput.sample` unused by the hash, leftover `listSample` unused by preview, claim overwrites `started_at` on resume, Wave B 366-day cap vs this module’s until>from only, leftover health counts the job model directly, and default Analytics is a live-query event are named in the recommendation; this pass does not “fix” them)
