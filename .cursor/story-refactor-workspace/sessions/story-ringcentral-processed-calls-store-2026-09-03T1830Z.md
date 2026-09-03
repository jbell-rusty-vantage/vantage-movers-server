# Session story-ringcentral-processed-calls-store-2026-09-03T1830Z

- Date (UTC): 2026-09-03T18:30Z
- Service / module: `ringcentral` / `processed-calls-store.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/137

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 133
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `processed-calls-store.ts`

This checkout booted on `cursor/*`. `origin/docs/story-refactor` already had shadow-call-leads-store recommended and next as `processed-calls-store.ts` (133 recommendations, last session story-ringcentral-shadow-call-leads-store-2026-08-30T0824Z, PR #135). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `processed-calls-store.ts` → [recommendations/ringcentral-processed-calls-store.md](../recommendations/ringcentral-processed-calls-store.md)
- operations named: look up whether this physical call already has a ledger row (`findProcessedCall`); stamp the ledger after create, adopt, shadow, or dry-run (`upsertProcessedCall`, identity prefers telephony session); refuse adoption when the unique session and Call Log fences are missing (`assertProcessedCallAdoptionIndexes` — check, do not create). Skip-if-terminal lives in callers. Dry-run is not terminal. Runtime does not create indexes inside a transaction.
- remaining in this service: `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `call-log-sync.service.ts`

## Messages posted

- 2026-09-03T1830Z next-run

## Ideas parked

- none

## Contradictions

- none
