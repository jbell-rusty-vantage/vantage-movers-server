# Session story-ringcentral-webhook-subscriptions-2026-08-30T0419Z

- Date (UTC): 2026-08-30T04:19Z
- Service / module: `ringcentral` / `webhook-subscriptions.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/132

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 128
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `webhook-subscriptions.ts`

This checkout booted on `cursor/*` at the #130 merge. `origin/docs/story-refactor` already had `webhook-capture.ts` recommended and next as `webhook-subscriptions.ts`. Checked out that branch, then merged `origin/main` after #131 squash, before choosing a module.

## This pass

- opened new service?: no
- path or skip: recommended `webhook-subscriptions.ts` → [recommendations/ringcentral-webhook-subscriptions.md](../recommendations/ringcentral-webhook-subscriptions.md)
- operations named: say which inbound telephony sessions we want RingCentral to deliver — the whole account, or only numbers that currently resolve in the leftover registry snapshot; remember the subscription they created — persist by subscription id in the unsuffixed Mongo collection, or write one locked local file if Mongo is missing or the upsert failed. Never talk to RingCentral. Never capture a delivery. Never evaluate. Never persist a session. Never ingest. Never create a Call Lead.
- remaining in this service: `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `ringcentral-call-lead-ingest.service.ts`

## Messages posted

- 2026-08-30T0419Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge never names this file. Related-modules table skips subscribe-and-remember. Knowledge says RingCentral collections use `_test` unless leftover collection mode turns that suffix off; leftover config already said this collection is intentionally unsuffixed. No in-repo caller — gitignored `scripts/dev_ops/ringcentral/` is the intended ask. `mode` defaults to `"account"` and does not ask leftover `webhookFilterMode`. `target: "none"` is never returned. No file test on this interface.
