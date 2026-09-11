# Session story-routes-extension-granot-apply-2026-09-11T1926Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `extension-granot-apply.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 319 (through `routes-extension-users-admin.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `extension-granot-apply.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-extension-granot-apply.md`
- operations named: apply this Owner-approved Form Lead Granot row after the secret (Owner session before connect, URL id, one item, FormLead expected_target must agree with the URL, 200 one answer, no kind filter, no quoted); apply these Owner-approved Follow Up snapshots in the order they sent them (batch 1–100 unique ids, lead_snapshot_apply only, sequential applyItem, 200 array); apply these Owner-approved Booked Jobs rows (booking_action_apply only) — never put this desk before the secret, never admit secret-only or Sales or leftover Employee, never call the leftover CSV writes, never write a quoted patch, never decide identity, never publish the webhook queue
- remaining in this service: `tariff-adjustments.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `tariff-adjustments.routes.ts`

## Messages posted

- 2026-09-11T1926Z next

## Ideas parked

- This desk sits after `/api/v1` secret; leftover extension login / Drive sit before. Do not remount `requireApiSecret`.
- This is Extension Owner session (`hasExtensionRole(roles, "owner")`), not HMAC `requireRegistryOwnerActor`.
- Knowledge still says singular `role === "owner"`.
- Form URL does not filter `operation_kind`; the two Call URLs do.
- Call-path `assertExpectedTarget` id is tautological; Form URL id is the real agreement.
- Sequential batch can apply then throw (partial apply).
- `sendError` rethrows non-Granot / non-Zod (no 500 envelope).
- Success stays 200 even when apply answers `accepted_for_processing`. Do not map onto 202.
- `requestId` prefers `req.id` then `x-request-id`, not `x-vantage-admin-request-id`.
- `buildGranotSyncExpectedFilter` stays on `v1.routes.ts` and is not imported here.
- Folder `v1.routes.test.ts` only locks `PATCH .../granot-sync`.
- Sales Bearer is 403 `"Forbidden"` at `requireApiSecret` before this file; stamped `vantageAuth` Sales is `GRANOT_OWNER_REQUIRED`.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.

## Contradictions

- Knowledge singular `role === "owner"` vs `hasExtensionRole(roles, "owner")`
- Call-path expected_target id is tautological
- `sendError` rethrow vs sibling 500 envelopes
- Wave A “kind filters live on the route” vs Form URL kind-free
- Parent Sales `"Forbidden"` vs this file `GRANOT_OWNER_REQUIRED`
- No HMAC Owner hatch
- Folder test locks only `granot-sync`
