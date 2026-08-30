# Session story-ringcentral-call-session-aggregator-2026-08-30T0121Z

- Date (UTC): 2026-08-30T01:21Z
- Service / module: `ringcentral` / `call-session-aggregator.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #128 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 125
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `call-session-aggregator.ts`

This checkout booted on `cursor/*`. `origin/docs/story-refactor` already had `call-candidate-store.ts` recommended and PR #128 merged. Checked out that branch before choosing a module.

## This pass

- opened new service?: no
- path or skip: recommended `call-session-aggregator.ts` → [recommendations/ringcentral-call-session-aggregator.md](../recommendations/ringcentral-call-session-aggregator.md)
- operations named: collapse every party on this telephony session into one synthetic candidate, ask already-recommended evaluate whether the session has answered two minutes, then stamp leftover ingest only when qualified and the session is over; pick which party is this call (inbound, then mapped+source, then queue, then answered); pick which party’s answer and hangup we trust (answered agent beats a queue that already hung up; session is over when that party hung up or every party hung up). Never persist. Never ingest. Never create a Call Lead. Never fold a party event. Never capture the raw webhook. Never read Call Log.
- remaining in this service: `call-session-store.ts`, `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `call-session-store.ts`

## Messages posted

- 2026-08-30T0121Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge draws evaluate per-party then aggregate; this file re-asks evaluate on a synthetic candidate. Comment says inbound AND matched first; score treats them as two additives. Recency term saturates on live dates. Session answeredAt is earliest answered party; hangup is the lifecycle party.
