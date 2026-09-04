# Session story-operations-registry-source-registry-2026-09-04T0114Z

- Date (UTC): 2026-09-04T01:14Z
- Service / module: `operationsRegistry` / `sourceRegistry.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/144

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 140
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `sourceRegistry.ts`

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`operationsRegistry` unvisited / open and enumerate). `origin/docs/story-refactor` already had `operationsRegistry` in-progress, `catalogRegistry.ts` recommended, next `sourceRegistry.ts` (140 recommendations, last session story-operations-registry-catalog-registry-2026-09-04T0048Z, PR #143 open). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `sourceRegistry.ts` → [recommendations/operations-registry-source-registry.md](../recommendations/operations-registry-source-registry.md)
- operations named: show the Owner source companies and Feeds (default active; get-by-id/slug has no active filter); record or correct a Source Company (created inactive, slug immutable, no defaults on create); record or correct a Source Feed (created inactive, key and company immutable, channel frozen after first activate); archive or restore a Source Company (all Feeds off first); archive or restore a Source Feed (company live + CPL schedule holds + exact identifiers unique + becomes or stays the channel default; deactivate a default only with a replacement or by removing automatic use); attribute a hint (Owner preview vs fail-closed Lead path + Operational Event); count who still depends. Write the Registry Change in the same transaction. Forget source/facet caches only after commit. Never rewrite Lead snapshots. Never write the leftover nested `granularities[]` book.
- remaining in this service: `sourceResolution.ts` (next), `cplSchedule.ts`, `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `sourceResolution.ts`

## Messages posted

- 2026-09-04T0114Z next-run

## Ideas parked

- none

## Contradictions

- none (nested `granularities[]` written `[]` and never updated is already named in Owner-UI notes; this pass does not start writing it)
