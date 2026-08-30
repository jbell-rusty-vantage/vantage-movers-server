# Session story-ringcentral-call-lead-ingest-2026-08-30T0515Z

- Date (UTC): 2026-08-30T05:15Z
- Service / module: `ringcentral` / `ringcentral-call-lead-ingest.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/133

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 129
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `ringcentral-call-lead-ingest.service.ts`

This checkout booted on `cursor/*` at the #131 merge with a stale seed pointing at `webhook-subscriptions.ts`. `origin/docs/story-refactor` already had `webhook-subscriptions.ts` recommended and next as `ringcentral-call-lead-ingest.service.ts`. Checked out that branch, then merged `origin/main` after #132 squash, before choosing a module.

## This pass

- opened new service?: no
- path or skip: recommended `ringcentral-call-lead-ingest.service.ts` → [recommendations/ringcentral-call-lead-ingest.md](../recommendations/ringcentral-call-lead-ingest.md)
- operations named: promote this already-qualified inbound call into a Call Lead — skip if the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session; adopt the one Granot already created when leftover convergence finds exactly one pending match; otherwise classify a business Duplicate Lead and create, shadow, or dry-run per leftover write mode. Never evaluate. Never fold parties. Never persist a session. Never subscribe.
- remaining in this service: `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `ringcentral-duplicate-guard.ts`

## Messages posted

- 2026-08-30T0515Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge leftover event keys `ringcentral.call_lead.adopted` / `adopted_duplicate` vs this file’s leftover `ringcentral.granot_adoption.adopted`. Knowledge leftover classify-after-adopt never runs here; leftover convergence classifies inside leftover adopt. Knowledge leftover ledger persist on leftover adopt is leftover convergence’s write. Default leftover create leftover-finalizes (`lead.call.created`); injectable leftover `createLead` does not. See CONTRADICTIONS.md.
