# routes-ringcentral-registry

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/ringcentral-registry.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **Show the inbound-number cards** — `GET /api/v1/admin/ringcentral/inbound-routes` and `GET .../:id`. `connectMongo`. **Ask** leftover `requireRegistryReadActor(req, auth(req))` (signed Owner or Admin, leftover unsigned preview when that hatch is on — not Sales, not Employee). List parses leftover `ringCentralRouteListQuerySchema` (`include_inactive` / `include_history` as `"true"` / `"false"` strings) and **asks** leftover `listRingCentralInboundRoutes`. Detail **asks** leftover `getRingCentralInboundRoute` (no active filter; **always** history). Answer `{ ok: true, data }`. This beat does **not** require Owner. This beat does **not** flatten. This beat does **not** resolve an incoming call.

2. **Record or correct an inbound number — start inactive** — `POST /api/v1/admin/ringcentral/inbound-routes` and `PATCH .../:id`. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor` (signed dashboard Owner only — leftover extension Owner Bearer is **not** enough; leftover unsigned preview never writes). POST parses leftover `ringCentralRouteCreateSchema` (`phone_number` 8–32, `display_label`, optional `created_from`, optional `reason`) and **asks** leftover `createOrUpdateRingCentralRoute(command, actor)` with **no** id. Answer **201**. PATCH parses leftover `routeId` plus leftover `ringCentralRouteUpdateSchema` (at least one of `phone_number` / `display_label` / `reason`) and **asks** the same leftover write with `{ id, ...command }`. Answer **200**. This beat does **not** ask RingCentral. This beat does **not** write an assignment. This beat does **not** activate.

3. **Ask RingCentral if this account can see this number** — `POST .../:id/validate`. Same Owner gate. Parse leftover `ringCentralRouteReasonSchema` against `req.body ?? {}` (missing body is an empty object; `reason` is optional). **Ask** leftover `validateRingCentralRoute({ id, reason }, actor)`. Answer 200 `{ ok, data }`. This beat does **not** import leftover `validateRingCentralNumberAgainstAccount`. This beat does **not** turn the number on. This beat does **not** lock the number.

4. **Turn the number on for a live call Feed — or move it** — `POST .../:id/activate` and `POST .../:id/reassign`. Both **ask** leftover `assignmentHandler("activate" | "reassign")`. Same Owner gate. Parse leftover `ringCentralRouteAssignmentSchema` (`source_granularity_id` + optional `reason`). **Ask** leftover `activateRingCentralRoute` or leftover `reassignRingCentralRoute` with `{ id, source_granularity_id, reason }`. Answer 200. This beat does **not** activate the Feed. This beat does **not** invent a company. This beat does **not** decide which incoming call becomes a Call Lead.

6. **Count who still depends** — `GET .../:id/dependencies`. Read actor, not Owner. **Ask** leftover `previewRingCentralRouteDependencies(id)`. Answer `{ ok, data }` with leftover `route_id` / `active_assignment_count` / `assignment_history_count` / `call_lead_count`. **`can_deactivate` is not on the bag.** This beat does **not** archive. This beat does **not** refuse archive.

`auth` / `routeId` / `sendError` / leftover `assignmentHandler` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `routeId` refuses a non-24-hex `:id` by throwing `new ZodError([])`. `sendError` is leftover `isRegistryError` → `error.statusCode` + leftover `toHttpBody()`, leftover `ZodError` → `400` `{ ok: false, error: "Invalid request", issues }`, else **rethrow**. They are private.

There is no seventh last-seen operation. There is no leftover snapshot-build operation. There is no Domain Command operation. Leftover POST and leftover PATCH are two HTTP **adapters** for operation 2. Leftover `/activate` and leftover `/reassign` are two HTTP **adapters** for operation 4. Leftover M5 is a script **adapter** on the service, not this desk.

1. **This desk sits after the secret. Drive and extension login do not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. That is load-bearing: leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Registry can run without a secret.”

2. **`assignmentHandler` hides two owner stories behind a string.** Already-recommended leftover `mutateAssignment` already shares the write. Activate refuses a live card with an open assignment; reassign refuses anything else. One leftover helper, two HTTP **adapters**. Do not split them into `activate.ts` / `reassign.ts` so “each verb owns a file.” Do not collapse them to one path so “close-and-open is REST `PUT`.” Rename the two mounts; keep the shared parse.

## Current endpoint contract restored

The retained route list must also include POST `/api/v1/admin/ringcentral/inbound-routes/:id/deactivate`: connect, requireRegistryOwnerActor, parse optional reason, delegate deactivateRingCentralRoute, return 200. It closes assignment history through the service; dependency preview is not an authorization to archive. Routes are mounted after v1's credential guard and retain their separate Registry actor gate.

This is source inspection, not evidence that HTTP/provider tests ran. Preserve the existing error punctuation and status when migrating callers.
