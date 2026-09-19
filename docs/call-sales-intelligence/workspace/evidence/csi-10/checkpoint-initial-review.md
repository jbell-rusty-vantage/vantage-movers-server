## Review findings

1. **High — browser Owner commands cannot be sent cross-origin**

   - Failure scenario: the Admin Dashboard on `vantagequotes.com` sends any new CSI mutation (for example `POST /api/v1/admin/sales-intelligence/numbers/:id/rebuild`) with its required `Idempotency-Key`. The browser’s CORS preflight requests that header, but the API only allows `Authorization`, `Content-Type`, and `x-api-secret`, so the browser blocks the request before it reaches the Owner/auth checks.
   - Paths: [src/app.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789766173173-f7635836/workspace/src/app.ts:41); required by [sales-intelligence-admin.routes.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789766173173-f7635836/workspace/src/routes/sales-intelligence-admin.routes.ts:174).
   - Smallest fix: add `Idempotency-Key` to `corsOptions.allowedHeaders`, with an OPTIONS/preflight regression test for a CSI command endpoint.

2. **Medium — repeated speech-restriction application silently advances the Contact Number revision**

   - Failure scenario: a later analysis run reaches the same `pause_channel` evidence for an interaction already represented by a restriction. `applySpokenRestriction` increments the Contact Number revision before detecting the existing restriction, then returns `no_change`. This creates an un-audited revision change with no domain change, unnecessarily invalidating clients’ optimistic-concurrency fences.
   - Path: [restrictions.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789766173173-f7635836/workspace/src/services/salesIntelligence/review/restrictions.ts:12).
   - Smallest fix: preserve/revert the number revision on the existing-restriction path, or check under the serialized number lock and only increment when creating/updating the restriction. Add a replay test asserting no Contact Number revision change.

No additional concrete correctness, authorization, or dependency-boundary regressions found in the reviewed flows.