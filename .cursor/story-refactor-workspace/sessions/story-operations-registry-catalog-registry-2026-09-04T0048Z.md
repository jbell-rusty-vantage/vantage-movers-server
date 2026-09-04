# Session story-operations-registry-catalog-registry-2026-09-04T0048Z

- Date (UTC): 2026-09-04T00:48Z
- Service / module: `operationsRegistry` / `catalogRegistry.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/143

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 0 / 15
- Recommendations on disk: 139
- Current service / next module (TRAVERSAL): `operationsRegistry` (unvisited) / open and enumerate

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`ringcentral` / `auth.ts`). `origin/docs/story-refactor` already had `ringcentral` visited and next as open `operationsRegistry` (139 recommendations, last session story-ringcentral-auth-2026-09-03T2327Z, PR #142 merged). Checked out that branch before writing.

## This pass

- opened new service?: yes — 27 runtime .ts files enumerated; skipped `catalogNormalization.ts` (username fold), `granotCrmSourceCache.ts` (cache keys), `trustedActorCanonical.ts` (header fold), `snapshotSanitizer.ts` (snapshot fold), `cacheInvalidation.ts` (cache notify), `config.ts` (env toggles), `errors.ts` (error class), `types.ts` (type-only), `index.ts` (barrel)
- path or skip: recommended `catalogRegistry.ts` → [recommendations/operations-registry-catalog-registry.md](../recommendations/operations-registry-catalog-registry.md)
- operations named: show the Owner catalog cards (default active; get-by-id has no active filter); find a card by name/alias or find an Agent by nested Granot username; record or correct an Agent (rename keeps old folded name as alias; username change resets verification); record or correct a Merchant; archive or restore — never delete; count who still depends on this card. Write the Registry Change in the same transaction. Forget agent/merchant/catalog/facet caches only after commit. Never rewrite Booking or Lead snapshots.
- remaining in this service: `sourceRegistry.ts` (next), `sourceResolution.ts`, `cplSchedule.ts`, `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `sourceRegistry.ts`

## Messages posted

- 2026-09-04T0048Z next-run

## Ideas parked

- none

## Contradictions

- none (username find vs uniqueness already in CONTRADICTIONS.md; this pass does not merge)
