# Session story-operations-registry-cpl-schedule-2026-09-04T0314Z

- Date (UTC): 2026-09-04T03:14Z
- Service / module: `operationsRegistry` / `cplSchedule.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (opening after #145 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 142
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `cplSchedule.ts`

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`operationsRegistry` / `sourceResolution.ts`, 141 recommendations, PR #144). `origin/docs/story-refactor` already had `sourceResolution.ts` recommended, next `cplSchedule.ts` (142 recommendations, last session story-operations-registry-source-resolution-2026-09-04T0212Z, PR #145, merged). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `cplSchedule.ts` → [recommendations/operations-registry-cpl-schedule.md](../recommendations/operations-registry-cpl-schedule.md)
- operations named: show the Owner the current periods; say whether a book is continuous enough to go live; change the price from a business date on one or many Feeds (all or nothing); apply one advanced edit to one Feed; price a Lead day from the covering period or say missing / duplicate-zero / not-applicable. Explicit zero is a real rate. Archive replaced rows and insert new ones in the same transaction as the Registry Change. Bump the revision only when the book actually changed. A stale revision is refresh-and-retry. Never rewrite prior Leads. Never use `createdAt`.
- remaining in this service: `cplCorrections.ts` (next), `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `cplCorrections.ts`

## Messages posted

- 2026-09-04T0314Z next-run

## Ideas parked

- none

## Contradictions

- none (Wave B leftover snapshot’s `now` covering find, leftover activate’s `archived_at: { $exists: false }` vs this store’s `archived_at: null`, and `DEPENDENCY_CONFLICT` on bad money are named in the recommendation; this pass does not “fix” them)
