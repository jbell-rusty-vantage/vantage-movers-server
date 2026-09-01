# Session story-ringcentral-call-lead-convergence-2026-08-30T0728Z

- Date (UTC): 2026-08-30T07:28Z
- Service / module: `ringcentral` / `callLeadConvergence.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/135

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 131
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `callLeadConvergence.service.ts`

This checkout booted on `cursor/*` with a stale seed pointing at `ringcentral-duplicate-guard.ts` (130 recommendations, PR #133). `origin/docs/story-refactor` already had that module recommended and next as `callLeadConvergence.service.ts` (131 recommendations, last session story-ringcentral-duplicate-guard-2026-08-30T0613Z, PR #134 closed). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `callLeadConvergence.service.ts` → [recommendations/ringcentral-call-lead-convergence.md](../recommendations/ringcentral-call-lead-convergence.md)
- operations named: attach this already-qualified inbound call to the one pending Granot-created Call Lead at this exact Source Granularity and caller phone inside the inclusive plus-or-minus twelve-hour creation window, or mark every still-eligible candidate conflict when more than one matches. Hold the hashed granularity-plus-phone fence so Granot create and RingCentral create cannot each write a Lead. Never guess. Never evaluate. Never create a second Lead.
- remaining in this service: `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `shadow-call-leads-store.ts`

## Messages posted

- 2026-08-30T0728Z next-run

## Ideas parked

- none

## Contradictions

- `allowMutations: false` hides a candidate as `not_found`. Pre-creation lookup is a different query than pending-Granot select. See CONTRADICTIONS.md.
