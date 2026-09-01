# Session story-ringcentral-webhook-capture-2026-08-30T0317Z

- Date (UTC): 2026-08-30T03:17Z
- Service / module: `ringcentral` / `webhook-capture.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/131

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 127
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `webhook-capture.ts`

This checkout booted on `cursor/*`. `origin/docs/story-refactor` already had `call-session-store.ts` recommended and PR #130 merged. Checked out that branch before choosing a module.

## This pass

- opened new service?: no
- path or skip: recommended `webhook-capture.ts` → [recommendations/ringcentral-webhook-capture.md](../recommendations/ringcentral-webhook-capture.md)
- operations named: keep this raw RingCentral telephony delivery as an audit row — strip secrets from headers, preview only the first party so we can find the session later, insert it, acknowledge a duplicate uuid without inventing a second row, and if Mongo is missing log a redacted copy then still let Wave B say 200; show recent raw deliveries on the debug board without the raw body or headers. Never fold parties. Never evaluate. Never persist a session. Never ingest. Never create a Call Lead. Never subscribe. Never write a local file.
- remaining in this service: `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `webhook-subscriptions.ts`

## Messages posted

- 2026-08-30T0317Z next-run

## Ideas parked

- none

## Contradictions

- Knowledge draws capture as step 1 then jumps the pipeline drawing to leftover normalize. Related-modules table does not name this file. Preview is parties[0] only; leftover normalize maps every party. Header strip is a denylist; already-recommended Granot keep is an allowlist. `WEBHOOK_EVENTS_TEST_COLLECTION` is an import-time snapshot. `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` is unused. No file test on this interface.
