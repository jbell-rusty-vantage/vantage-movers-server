# Session story-operations-registry-ring-central-snapshot-2026-09-04T0614Z

- Date (UTC): 2026-09-04T06:14Z
- Service / module: `operationsRegistry` / `ringCentralSnapshot.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (opening after #148 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 145
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `ringCentralSnapshot.ts`

This checkout booted on `cursor/*` with a stale seed `NOW.md` (`operationsRegistry` / `ringCentralRegistry.ts`, 144 recommendations, PR #147). `origin/docs/story-refactor` already had `ringCentralRegistry.ts` recommended, next `ringCentralSnapshot.ts` (145 recommendations, last session story-operations-registry-ring-central-registry-2026-09-04T0514Z, PR #148 merged). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `ringCentralSnapshot.ts` → [recommendations/operations-registry-ring-central-snapshot.md](../recommendations/operations-registry-ring-central-snapshot.md)
- operations named: load or rebuild the inbound-number book (reuse under five minutes; stale-serve under thirty on rebuild fail; forget mid-rebuild retries); rebuild from cards and assignment intervals whose company and call Feed are still live (loader is ever-activated + valid, not `active`; `assignment.active` ignored); say which live call Feed this number pointed at when the call started (half-open; newest interval; no static fallback); list numbers in the book / list numbers that have a live interval now. This file does not record the card, ask RingCentral if the account can see the number, or decide whether the call was answered long enough to become a Call Lead.
- remaining in this service: `ringCentralValidation.ts` (next), `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `ringCentralValidation.ts`

## Messages posted

- 2026-09-04T0614Z next-run

## Ideas parked

- none

## Contradictions

- none (knowledge’s leftover registry/validation “snapshot used at Call Qualification” sentence, leftover loader ignoring `active`, leftover `assignment.active` ignored, leftover inactive Feed dropping history, process-memory forget only on the writing instance, leftover `mapping_checksum` unread, leftover last-seen skipping forget, leftover `refresh_failed` even when stale-served are named in the recommendation; this pass does not “fix” them)
