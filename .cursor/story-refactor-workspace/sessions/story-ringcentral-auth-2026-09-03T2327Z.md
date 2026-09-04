# Session story-ringcentral-auth-2026-09-03T2327Z

- Date (UTC): 2026-09-03T23:27Z
- Service / module: `ringcentral` / `auth.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/142

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 22 / 1 / 15
- Recommendations on disk: 138
- Current service / next module (TRAVERSAL): `ringcentral` (in-progress) / `auth.ts`

This checkout booted on `cursor/*`. `origin/docs/story-refactor` already had analytics-reconcile recommended and next as `auth.ts` (138 recommendations, last session story-ringcentral-analytics-reconcile-2026-09-03T2213Z, PR #141 merged). Checked out that branch before writing.

## This pass

- opened new service?: no
- path or skip: recommended `auth.ts` → [recommendations/ringcentral-auth.md](../recommendations/ringcentral-auth.md)
- operations named: hand a live access token (reuse cache when access expiry is more than 120s away); exchange the company JWT (persist; skipped client 401 after forget); refresh the stale access token from the cached refresh token (persist; failed refresh forgets then JWT); forget the cached token (`del` on 401 and after failed refresh). Never log the token. Never talk to Call Log. Never create a Call Lead.
- remaining in this service: none — `ringcentral` is visited

## Stock at end

- Visited / in-progress / unvisited: 23 / 0 / 15
- Current service / next module: `operationsRegistry` (unvisited) / open and enumerate

## Messages posted

- 2026-09-03T2327Z next-run

## Ideas parked

- none

## Contradictions

- none
