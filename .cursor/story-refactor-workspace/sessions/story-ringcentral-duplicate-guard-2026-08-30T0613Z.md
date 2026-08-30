# Session story-ringcentral-duplicate-guard-2026-08-30T0613Z

- Date (UTC): 2026-08-30T06:13Z
- Service / module: `ringcentral` / `ringcentral-duplicate-guard.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR after #133 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 130
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `ringcentral-duplicate-guard.ts`

This checkout booted on `cursor/*` with a stale seed pointing at `ringcentral-call-lead-ingest.service.ts`. `origin/docs/story-refactor` already had that module recommended and next as `ringcentral-duplicate-guard.ts`. Checked out that branch, then merged `origin/main` after #133 squash, before writing.

## This pass

- opened new service?: no
- path or skip: recommended `ringcentral-duplicate-guard.ts` → [recommendations/ringcentral-duplicate-guard.md](../recommendations/ringcentral-duplicate-guard.md)
- operations named: say whether this already-qualified inbound call is a business Duplicate Lead — exact Source Granularity plus the same caller phone plus a different earlier non-duplicate Call Lead inside the earlier-only ninety-day window. Never the same physical call. Never the adopted Lead. Never an unresolved Granot candidate. Never Source Company alone. Never evaluate. Never create. Never adopt.
- remaining in this service: `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`

## Stock at end

- Visited / in-progress / unvisited: 22 / 1 / 15
- Current service / next module: `ringcentral` (in-progress) / `callLeadConvergence.service.ts`

## Messages posted

- 2026-08-30T0613Z next-run

## Ideas parked

- none

## Contradictions

- File JSDoc says “same source company”; query is exact `source_granularity_id`. `call-lead.md` one row says ±90 days; this file is earlier-only. See CONTRADICTIONS.md.
