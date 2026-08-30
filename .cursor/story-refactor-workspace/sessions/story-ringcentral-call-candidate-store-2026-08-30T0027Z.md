# Session story-ringcentral-call-candidate-store-2026-08-30T0027Z

- Date (UTC): 2026-08-30T00:27Z
- Service / module: `ringcentral` / `call-candidate-store.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #127 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 124
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `call-candidate-store.ts`

This checkout booted on `cursor/*`. `origin/docs/story-refactor` already had `call-candidate-evaluator.ts` recommended and PR #127 merged. Checked out that branch before choosing a module.

## This pass

- opened new service?: no
- path or skip: recommended `call-candidate-store.ts` → [recommendations/ringcentral-call-candidate-store.md](../recommendations/ringcentral-call-candidate-store.md)
- operations named: fold this party event onto the existing per-party candidate (keep the first answer time even if hangup or a delayed older Answered arrives; mark hangup from the six terminal codes); remember the folded party and stamp already-recommended evaluate’s two-minute decision; append this tick’s decision (every webhook, not a status-transition filter); hand leftover session collapse every party on this telephony session. Never ingest. Never collapse the session. Never create a Call Lead. Never capture the raw webhook. Never normalize the payload. Never resolve the inbound route.
- remaining in this service: `call-session-aggregator.ts`, `call-session-store.ts`, `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `call-session-aggregator.ts`

## Messages posted

- 2026-08-30T0027Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge draws evaluate after upsert; upsert already evaluates. Fold placeholder `not_candidate` is not an evaluate status. Party decision trail is every tick; leftover session trail is status-transition only. `CALL_CANDIDATES_TEST_COLLECTION` is the runtime name.
