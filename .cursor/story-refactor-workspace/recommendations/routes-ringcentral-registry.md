# Let The Signed Owner Record An Inactive Inbound Number After The Secret, Ask RingCentral If This Account Can See It, Turn It On Or Move It Onto A Live Call Feed, Then Archive Never Delete — Never Put This Desk Before The Secret, Never Stamp Last-Seen Here, Never Decide Which Incoming Call Becomes A Call Lead, Never Delete The Card — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 4 of this service — `ringcentral-registry.routes.ts`
- Remaining in this service: `granot-lifecycle-admin.routes.ts`, `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/ringcentral-registry.routes.ts`
- Knowledge: no dedicated routes Service. Closest: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (inbound-route HTTP is still listed as living on leftover `v1.routes.ts`; mutations need a signed Owner; approved signed dashboard roles may read; **dependency preview no longer returns `can_deactivate`** — that sentence is current on already-recommended `previewRingCentralRouteDependencies`). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(ringCentralRegistryRoutes)` **after** `/api/v1` secret — this file **is** that mount; the desk does **not** parse inbound numbers). Distinct from already-recommended unguarded desks: [routes-extension-auth.md](routes-extension-auth.md) and [routes-google-drive-oauth.md](routes-google-drive-oauth.md) (those sit **before** the secret; this file never does). Distinct from already-recommended Owner inbound-number card: [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (`list` / `get` / `createOrUpdate` / `validate` / `activate` / `reassign` / `deactivate` / `preview` / leftover `recordRingCentralRouteObservation` — this file **asks** the first eight; it does **not** stamp last-seen, open a transaction, or forget leftover `RINGCENTRAL_ROUTE_CACHE_KEY`). Distinct from already-recommended snapshot resolve: [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (Call Qualification **asks** leftover `resolveRingCentralInboundRoute` — this file never does). Distinct from already-recommended account inventory: [operations-registry-ring-central-validation.md](operations-registry-ring-central-validation.md) (leftover `validateRingCentralNumberAgainstAccount` — already-recommended `/validate` **asks** that through leftover `validateRingCentralRoute`; this file does **not** import it). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryReadActor` / `requireRegistryOwnerActor` — this file **asks** those; an extension Owner Bearer may **not** mutate these paths). Distinct from already-recommended Call Lead ingest: [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) and leftover Call Qualification (this desk never decides which incoming call becomes a Call Lead). Distinct from leftover Wave B Zod: `src/validation/v1/operationsRegistry.validation.ts` (`ringCentralRouteListQuerySchema` / `Create` / `Update` / `Reason` / `Assignment` — this file **asks** those via leftover `v1.validation.ts`). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it; this file does **not** remount it). Distinct from leftover Wave B cron / webhook: next `ringcentral-cron.routes.ts` / `ringcentral-webhook.routes.ts` (those **ask** leftover last-seen; this file never does). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does not define inbound number / inbound route; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(ringCentralRegistryRoutes)` on line 291, **after** `router.use("/api/v1", requireApiSecret)`). Leftover `src/app.ts` mounts the public v1 desk, not this file. Folder `v1.routes.test.ts` imports this module only to prove seven registered methods (`GET` list / `GET` id / `POST` / `PATCH` / `POST` activate / reassign / deactivate). It does **not** name `/validate` or `/dependencies`. Already-recommended `ringCentralRegistry.test.ts` proves leftover activate / reassign refuse (form Feed / inactive Feed) and leftover `can_deactivate` **gone** through the service **interface** — it never boots this router. Already-recommended `trustedActor.test.ts` proves HMAC / preview / extension-Owner-Agent paths and never hits `/admin/ringcentral/*`. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists all nine paths. Not this **interface**: leftover `createOrUpdateRingCentralRoute` itself, leftover `validateRingCentralNumberAgainstAccount`, leftover `resolveRingCentralInboundRoute`, leftover `recordRingCentralRouteObservation`, leftover `withRegistryMutation`, leftover Call Qualification, leftover M5 migration.
- Seams callers need: after `/api/v1` secret (parent mount) vs Drive / extension desks **before**; leftover `requireRegistryReadActor` (list / get / dependencies) vs leftover `requireRegistryOwnerActor` (record / ask / turn-on / move / archive); leftover POST (no id, **201**) vs leftover PATCH (id, **200**) as two HTTP **adapters** for leftover `createOrUpdateRingCentralRoute`; leftover `/activate` vs leftover `/reassign` as two HTTP **adapters** for leftover `mutateAssignment` (this file’s leftover `assignmentHandler` hides that fork behind `"activate" | "reassign"`); leftover Zod `400` `{ ok: false, error: "Invalid request", issues }` vs leftover `isRegistryError` → `toHttpBody()` (`ok` / `error` / `registry_code` / optional `remediation`) vs unknown throw (rethrow — no 500 JSON, no leftover operational event); leftover `routeId` empty `ZodError([])` vs leftover `v1.routes` `"Invalid Mongo ObjectId"`. There is no begin / complete Domain Command **seam**. There is no last-seen **seam**. There is no Call-Lead-create **seam**. There is no delete **seam**. There is no `can_deactivate` **seam** (the field is gone).
- Split later (only if the file outgrows one sitting): this ~190-line file is one sitting if you read it as let the signed Owner record an inactive inbound number after the secret, ask RingCentral if this account can see it, turn it on or move it onto a live call Feed, then archive never delete — never put this desk before the secret, never stamp last-seen here, never decide which incoming call becomes a Call Lead, never delete the card. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `activate.ts`. Card write / ask-RingCentral / close-and-open / archive stay already-recommended `ringCentralRegistry.ts`. Snapshot resolve stays already-recommended `ringCentralSnapshot.ts`. Speaking gate stays already-recommended `trustedActor.ts`. Last-seen stays leftover Call Log / webhook.

`router.get("/inbound-routes")` / `router.post("/inbound-routes")` / `router.post("/:id/activate")` are HTTP verbs. The owner question is: *The Owner wants incoming RingCentral numbers filed under a live call Feed. Someone already passed the API secret. Let a signed Admin or Owner see the cards. Let only a signed Owner record a number inactive, unlocked, and unvalidated. Let them ask this RingCentral account whether it can see that number. Only a stamp that is still valid and younger than the window lets them turn it on or move it onto a live call Feed — that write locks the number forever. Archiving closes the assignment and keeps the card. Do not put this desk before the secret. Do not stamp last-seen here — leftover Call Log and leftover webhook already do that without Owner. Do not decide which incoming call becomes a Call Lead — leftover snapshot does that. Do not delete the card. Do not let an extension Owner Bearer mutate these paths. Do not put a `can_deactivate` gate back onto the count.*

Who records the card, asks RingCentral, turns it on, moves it, and archives already lives in already-recommended `ringCentralRegistry.ts`. Who says who is speaking already lives in already-recommended `trustedActor.ts`. Who resolves an incoming call already lives in already-recommended `ringCentralSnapshot.ts`. Do not pull those in.

## What this file actually does

Six operations for the inbound-number **desk**, not “a RingCentral route CRUD dump,” and not Record An Inactive Inbound Number / Ask RingCentral If This Account Can See This Number themselves:

1. **Show the inbound-number cards** — `GET /api/v1/admin/ringcentral/inbound-routes` and `GET .../:id`. `connectMongo`. **Ask** leftover `requireRegistryReadActor(req, auth(req))` (signed Owner or Admin, leftover unsigned preview when that hatch is on — not Sales, not Employee). List parses leftover `ringCentralRouteListQuerySchema` (`include_inactive` / `include_history` as `"true"` / `"false"` strings) and **asks** leftover `listRingCentralInboundRoutes`. Detail **asks** leftover `getRingCentralInboundRoute` (no active filter; **always** history). Answer `{ ok: true, data }`. This beat does **not** require Owner. This beat does **not** flatten. This beat does **not** resolve an incoming call.

2. **Record or correct an inbound number — start inactive** — `POST /api/v1/admin/ringcentral/inbound-routes` and `PATCH .../:id`. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor` (signed dashboard Owner only — leftover extension Owner Bearer is **not** enough; leftover unsigned preview never writes). POST parses leftover `ringCentralRouteCreateSchema` (`phone_number` 8–32, `display_label`, optional `created_from`, optional `reason`) and **asks** leftover `createOrUpdateRingCentralRoute(command, actor)` with **no** id. Answer **201**. PATCH parses leftover `routeId` plus leftover `ringCentralRouteUpdateSchema` (at least one of `phone_number` / `display_label` / `reason`) and **asks** the same leftover write with `{ id, ...command }`. Answer **200**. This beat does **not** ask RingCentral. This beat does **not** write an assignment. This beat does **not** activate.

3. **Ask RingCentral if this account can see this number** — `POST .../:id/validate`. Same Owner gate. Parse leftover `ringCentralRouteReasonSchema` against `req.body ?? {}` (missing body is an empty object; `reason` is optional). **Ask** leftover `validateRingCentralRoute({ id, reason }, actor)`. Answer 200 `{ ok, data }`. This beat does **not** import leftover `validateRingCentralNumberAgainstAccount`. This beat does **not** turn the number on. This beat does **not** lock the number.

4. **Turn the number on for a live call Feed — or move it** — `POST .../:id/activate` and `POST .../:id/reassign`. Both **ask** leftover `assignmentHandler("activate" | "reassign")`. Same Owner gate. Parse leftover `ringCentralRouteAssignmentSchema` (`source_granularity_id` + optional `reason`). **Ask** leftover `activateRingCentralRoute` or leftover `reassignRingCentralRoute` with `{ id, source_granularity_id, reason }`. Answer 200. This beat does **not** activate the Feed. This beat does **not** invent a company. This beat does **not** decide which incoming call becomes a Call Lead.

5. **Archive the inbound number — never delete** — `POST .../:id/deactivate`. Same Owner gate. Same leftover reason schema against `req.body ?? {}`. **Ask** leftover `deactivateRingCentralRoute({ id, reason }, actor)`. Answer 200. There is no `DELETE` path. This beat does **not** count Call Leads first. This beat does **not** unlock the phone. This beat does **not** rewrite Call Lead `ringcentral.route_id`.

6. **Count who still depends** — `GET .../:id/dependencies`. Read actor, not Owner. **Ask** leftover `previewRingCentralRouteDependencies(id)`. Answer `{ ok, data }` with leftover `route_id` / `active_assignment_count` / `assignment_history_count` / `call_lead_count`. **`can_deactivate` is not on the bag.** This beat does **not** archive. This beat does **not** refuse archive.

`auth` / `routeId` / `sendError` / leftover `assignmentHandler` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `routeId` refuses a non-24-hex `:id` by throwing `new ZodError([])`. `sendError` is leftover `isRegistryError` → `error.statusCode` + leftover `toHttpBody()`, leftover `ZodError` → `400` `{ ok: false, error: "Invalid request", issues }`, else **rethrow**. They are private.

There is no seventh last-seen operation. There is no leftover snapshot-build operation. There is no Domain Command operation. Leftover POST and leftover PATCH are two HTTP **adapters** for operation 2. Leftover `/activate` and leftover `/reassign` are two HTTP **adapters** for operation 4. Leftover M5 is a script **adapter** on the service, not this desk.

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed reader see the inbound-number cards; let only a signed Owner record one inactive, ask RingCentral, turn it on or move it, then archive — never delete, never stamp last-seen, never decide which incoming call becomes a Call Lead.” Already-recommended card write / ask-RingCentral / close-and-open / archive / leftover speaking gate / leftover snapshot / leftover account inventory already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralRegistryRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a last-seen HTTP **adapter** so “the desk can prove the number rang.” Do not invent a delete path so “archive is REST.” Do not invent a CRUD folder so `create.ts` / `update.ts` / `activate.ts` each get a file.

Do not move leftover `createOrUpdateRingCentralRoute` into this file so “the route owns the card.” Do not mount this router before leftover `requireApiSecret` so “it matches Drive.” Do not merge this router into `v1.routes.ts` so “knowledge listed inbound-route HTTP there.” Do not teach leftover extension Owner Bearer to mutate these paths so “the extension can run Registry.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ownerInboundNumberDesk` | already-recommended public v1 desk mounts it **after** the secret |
| `GET .../inbound-routes` (today unexported handler) | `showTheInboundNumberCardsOverHttp` | signed read; default active; optional history |
| `GET .../:id` (today unexported handler) | `showOneInboundNumberCardOverHttp` | signed read; leftover writes re-read; always history |
| `POST .../inbound-routes` (today unexported handler) | `recordAnInactiveInboundNumberOverHttp` | Owner; no id; **201**; starts inactive |
| `PATCH .../:id` (today unexported handler) | `correctAnInboundNumberCardOverHttp` | Owner; same leftover write with id; **200** |
| `POST .../:id/validate` (today unexported handler) | `askRingCentralIfThisAccountCanSeeThisNumberOverHttp` | Owner; does not turn on |
| `POST .../:id/activate` (today unexported handler) | `turnTheInboundNumberOnForALiveCallFeedOverHttp` | Owner; leftover `assignmentHandler("activate")` |
| `POST .../:id/reassign` (today unexported handler) | `moveTheInboundNumberToAnotherLiveCallFeedOverHttp` | Owner; leftover `assignmentHandler("reassign")` |
| `POST .../:id/deactivate` (today unexported handler) | `archiveTheInboundNumberOverHttp` | Owner; never delete |
| `GET .../:id/dependencies` (today unexported handler) | `countWhoStillDependsOnThisInboundNumberOverHttp` | signed read; no `can_deactivate` |

Keep the default export as the one-line alias until `v1.routes.ts` migrates. Do not make callers learn `assignmentHandler` / `routeId` / `sendError` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`createOrUpdateRingCentralRoute` / `activateRingCentralRoute` / `previewRingCentralRouteDependencies`) here — those stay already-recommended Wave A. Do **not** add `DELETE .../:id` so “archive is REST.” Do **not** add `POST .../:id/observe` so “last-seen has a desk.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover POST / PATCH already paint after leftover `createOrUpdateRingCentralRoute` returns:

```ts
type OwnerInboundNumberCardResponse = {
  ok: true
  data: RingCentralRouteItem // already-recommended OwnerInboundNumberCard
}
```

That is the handoff from “already-recommended card write landed” to “the Admin Dashboard may show the lock, the validation stamp, and the current assignment.” Do **not** add leftover `can_deactivate` onto that bag. Do **not** add leftover last-seen write fields so “the desk can stamp a ring.” Do **not** add a Mongo `ClientSession` so “the route owns leftover `withRegistryMutation`.”

Leave card write / ask / turn-on / archive on already-recommended `ringCentralRegistry.ts`. Leave the speaking gate on already-recommended `trustedActor.ts`. Leave snapshot resolve on already-recommended `ringCentralSnapshot.ts`. Leave last-seen on leftover Call Log / webhook. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-registry.routes.ts
// Someone already passed the API secret.
// Let a signed reader see the inbound-number cards.
// Let only a signed Owner record one inactive, ask RingCentral,
// turn it on or move it, then archive — never delete.

const ownerInboundNumberDesk = Router()

// ── 1. Show the inbound-number cards ──────────────────────

ownerInboundNumberDesk.get(
  "/api/v1/admin/ringcentral/inbound-routes",
  showTheInboundNumberCardsOverHttp,           // read actor; include_inactive / include_history
)

ownerInboundNumberDesk.get(
  "/api/v1/admin/ringcentral/inbound-routes/:id",
  showOneInboundNumberCardOverHttp,            // read actor; always history
)

// ── 2. Record or correct — start inactive ─────────────────

ownerInboundNumberDesk.post(
  "/api/v1/admin/ringcentral/inbound-routes",
  recordAnInactiveInboundNumberOverHttp,       // Owner; 201; no id
)

ownerInboundNumberDesk.patch(
  "/api/v1/admin/ringcentral/inbound-routes/:id",
  correctAnInboundNumberCardOverHttp,          // Owner; 200; same leftover write
)

// ── 3. Ask RingCentral if this account can see it ─────────

ownerInboundNumberDesk.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/validate",
  askRingCentralIfThisAccountCanSeeThisNumberOverHttp,
)

// ── 4. Turn on — or move — only with a fresh valid stamp ──

ownerInboundNumberDesk.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/activate",
  turnTheInboundNumberOnForALiveCallFeedOverHttp,
)

ownerInboundNumberDesk.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/reassign",
  moveTheInboundNumberToAnotherLiveCallFeedOverHttp,
)

// ── 5. Archive — never delete ─────────────────────────────

ownerInboundNumberDesk.post(
  "/api/v1/admin/ringcentral/inbound-routes/:id/deactivate",
  archiveTheInboundNumberOverHttp,             // no DELETE
)

// ── 6. Count dependents — do not gate archive ─────────────

ownerInboundNumberDesk.get(
  "/api/v1/admin/ringcentral/inbound-routes/:id/dependencies",
  countWhoStillDependsOnThisInboundNumberOverHttp, // no can_deactivate
)

export default ownerInboundNumberDesk

async function showTheInboundNumberCardsOverHttp(req, res) {
  await connectMongo()
  refuseThisRegistryReadUnlessTheyMaySpeak(req, whoTheSecretAlreadyAdmitted(req))
  const query = ringCentralRouteListQuerySchema.parse(req.query)
  const data = await showTheOwnerInboundNumbers({
    includeInactive: query.include_inactive,
    includeHistory: query.include_history,
  })
  return res.json({ ok: true, data })
}

async function recordAnInactiveInboundNumberOverHttp(req, res) {
  await connectMongo()
  const actor = refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking(
    req,
    whoTheSecretAlreadyAdmitted(req),
  )
  const command = ringCentralRouteCreateSchema.parse(req.body)
  const data = await recordOrCorrectAnInboundNumber(command, actor)
  return res.status(201).json({ ok: true, data })
}

async function turnTheInboundNumberOnForALiveCallFeedOverHttp(req, res) {
  return closeAndOpenTheAssignmentOverHttp(req, res, "activate")
}

async function moveTheInboundNumberToAnotherLiveCallFeedOverHttp(req, res) {
  return closeAndOpenTheAssignmentOverHttp(req, res, "reassign")
}

function refuseABadInboundNumberId(req) {
  const value = req.params.id
  if (typeof value !== "string" || !isObjectIdString(value)) {
    throw new ZodError([])                      // empty issues — do not silently invent ObjectId text
  }
  return value
}

function refuseThisInboundNumberRequest(res, error) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody())
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request",                 // not leftover v1 "Invalid request payload"
      issues: error.issues,
    })
  }
  throw error                                   // no 500 JSON; no leftover operational event
}
```

Read the record-then-turn-on path out loud: *Someone already passed the API secret. A signed Owner posts a phone number and a display label. Parse the body. Ask already-recommended record-or-correct with no id. Answer 201 — the card is inactive, unlocked, and unvalidated. Then they post validate with an optional reason. Ask already-recommended ask-RingCentral. Then they post activate with a live call Feed id. Ask already-recommended turn-on. Answer 200 with the locked card and the open assignment. Do not stamp last-seen. Do not decide which incoming call becomes a Call Lead. Do not put this path before the secret.*

That is the operation. `router.post("/inbound-routes")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Drive and extension login do not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. That is load-bearing: leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Registry can run without a secret.”

2. **`assignmentHandler` hides two owner stories behind a string.** Already-recommended leftover `mutateAssignment` already shares the write. Activate refuses a live card with an open assignment; reassign refuses anything else. One leftover helper, two HTTP **adapters**. Do not split them into `activate.ts` / `reassign.ts` so “each verb owns a file.” Do not collapse them to one path so “close-and-open is REST `PUT`.” Rename the two mounts; keep the shared parse.

3. **POST and PATCH are two HTTP adapters for one leftover write.** Leftover `createOrUpdateRingCentralRoute` already forks on `id`. POST answers **201** and never sends an id. PATCH answers **200** and always sends one. Do not silently make PATCH call a second leftover function so “update is its own export” — already-recommended Wave A already refused that split. Do not silently answer 200 on POST so “every write is the same.”

4. **`can_deactivate` is gone. Wave A still says it is always `true`.** Already-recommended [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) testing still names leftover `can_deactivate: true`. Current leftover `previewRingCentralRouteDependencies` returns four count fields only. Already-recommended `ringCentralRegistry.test.ts` locks `"can_deactivate" in preview === false`. Knowledge already says the field is gone. Do not silently put `can_deactivate: true` back so “the Wave A test list wins.” Do not silently refuse archive when `call_lead_count > 0` so “we protect Call Leads.” Do not rewrite the Wave A file in this pass.

5. **Folder path-presence misses `/validate` and `/dependencies`.** Leftover `v1.routes.test.ts` title is “complete lifecycle CRUD surfaces” and asserts seven methods on this router. Operator skill and leftover host rule list nine. Do not drop leftover `/validate` so “the folder test wins.” Do not treat that CRUD-named test as this desk’s **interface**.

6. **Bad `:id` throws an empty ZodError.** Leftover `routeId` uses leftover `isObjectIdString` then `throw new ZodError([])`. The client sees `400` `"Invalid request"` with `issues: []`. Already-recommended public v1 leftover `getValidObjectId` says `"Invalid Mongo ObjectId"`. Do not silently import leftover `V1ServiceError` so “one ObjectId refuse owns every router” without a paired route test. Do not silently invent an issue path so “empty issues look finished.”

7. **This refuse is not public v1 and not Drive.** This desk’s Zod is `{ ok: false, error: "Invalid request", issues }` — no `code`, and not leftover `"Invalid request payload"`. Leftover registry errors use leftover `toHttpBody()` (`registry_code` + optional `remediation`). Unknown errors **rethrow** — no 500 JSON, no leftover `recordOperationalEvent`. Do not silently import leftover `v1.routes` `sendError` so “one refuse owns every router.” Do not silently swallow a leftover Mongo throw into `{ ok: false }` so “the desk never 500s.”

8. **Extension Owner Bearer cannot mutate these paths.** Already-recommended leftover `requireRegistryOwnerActor` lets that Bearer through only on leftover `POST/PATCH /admin/agents`. These nine paths are not that hatch. Signed Admin may read. Only a signed dashboard Owner may write. Do not silently widen leftover `isExtensionOwnerCatalogMutationPath` so “the Granot extension can file inbound numbers.”

9. **Last-seen is not on this desk.** Already-recommended leftover `recordRingCentralRouteObservation` is leftover Call Log sync and leftover webhook enrich. This file does not import it. Do not add an observe route so “the Owner can stamp a ring.” Do not wrap leftover last-seen in leftover `requireRegistryOwnerActor` so “every write is Owner.”

10. **Knowledge still says inbound-route HTTP lives on `v1.routes.ts`.** The handlers left. Do not move them back so “the knowledge sentence becomes true.” Do not edit that Service file in this rename.

11. **Leave sibling modules alone.** Already-recommended leftover `createOrUpdateRingCentralRoute` / leftover `validateRingCentralRoute` / leftover `activateRingCentralRoute` / leftover `requireRegistryOwnerActor` / leftover `resolveRingCentralInboundRoute` are already the right **depth**. This file orchestrates the HTTP **adapters**.

## Testing

The **interface** is the test surface: the default `ownerInboundNumberDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `showTheInboundNumberCardsOverHttp` / `recordAnInactiveInboundNumberOverHttp` / `askRingCentralIfThisAccountCanSeeThisNumberOverHttp` / `turnTheInboundNumberOnForALiveCallFeedOverHttp` / `moveTheInboundNumberToAnotherLiveCallFeedOverHttp` / `archiveTheInboundNumberOverHttp` / `countWhoStillDependsOnThisInboundNumberOverHttp`.

Today there is **no** `ringcentral-registry.routes.test.ts`. Leftover `v1.routes.test.ts` proves seven registered methods and misses `/validate` plus `/dependencies`. Already-recommended `ringCentralRegistry.test.ts` proves leftover activate / reassign refuse and leftover `can_deactivate` gone through the service — not this desk.

Add a route test that names the operation (inject leftover list / record / validate / activate / archive / preview; mint leftover HMAC with leftover `computeAdminActorSignature`; do not boot RingCentral or leftover `withRegistryMutation` in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route leftover `requireApiSecret`.
- List / get / dependencies **ask** leftover `requireRegistryReadActor`. Signed Admin **200**. Sales / Employee leftover `FORBIDDEN`.
- POST / PATCH / validate / activate / reassign / deactivate **ask** leftover `requireRegistryOwnerActor`. Signed Admin leftover `FORBIDDEN`. Extension Owner Bearer leftover `FORBIDDEN` (not leftover Agent catalog).

**Record / ask / turn-on / move / archive**
- POST **asks** leftover `createOrUpdateRingCentralRoute` with no `id` and answers **201** `{ ok, data }`.
- PATCH **asks** the same leftover write with `{ id, ...command }` and answers **200**.
- Validate **asks** leftover `validateRingCentralRoute({ id, reason })`. Missing body is `{}`.
- Activate **asks** leftover `activateRingCentralRoute`; reassign **asks** leftover `reassignRingCentralRoute`; both parse leftover `source_granularity_id`.
- Deactivate **asks** leftover `deactivateRingCentralRoute`. There is no `DELETE`.
- Leftover `RegistryError` → leftover status + leftover `toHttpBody()` (`registry_code` present).
- Zod fail → `400` `"Invalid request"` + `issues` (not leftover `"Invalid request payload"`, no leftover `code: "invalid_request"`).
- Bad `:id` → `400` `"Invalid request"` with empty `issues`.

**Show / count**
- List forwards leftover `include_inactive` / `include_history` (string `"true"` / `"false"`).
- Get **asks** leftover `getRingCentralInboundRoute` (always history).
- Dependencies **asks** leftover `previewRingCentralRouteDependencies` and the JSON has **no** `can_deactivate`.
- All nine paths are registered (`/validate` and `/dependencies` included).

**Not this file**
- Inactive insert / phone lock / fresh-stamp window / close-and-open / archive-never-delete stay on already-recommended [operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md).
- HMAC / preview hatch / extension-Owner-Agent stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Snapshot resolve / Call Qualification stay on already-recommended [operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) + [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md).
- Account inventory stays on already-recommended [operations-registry-ring-central-validation.md](operations-registry-ring-central-validation.md).
- Last-seen stays on leftover Call Log / leftover webhook.
- Unguarded login / Drive callback stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md) / [routes-google-drive-oauth.md](routes-google-drive-oauth.md).

Do **not** add a test per helper (`whoTheSecretAlreadyAdmitted`, `refuseABadInboundNumberId`, `closeAndOpenTheAssignmentOverHttp`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `RingCentralRegistryRoutesService` class with `create` / `update` / `delete` / `activate`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `activate.ts` / `reassign.ts` / `validate.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put inbound-number writes in front of `x-api-secret`.
- Treating leftover `createOrUpdateRingCentralRoute`, leftover `validateRingCentralNumberAgainstAccount`, leftover `resolveRingCentralInboundRoute`, leftover last-seen, leftover Call Qualification, leftover M5, or leftover Drive / extension desks as this story.
- Inventing a last-seen, delete, or `can_deactivate` **adapter** that has only one caller in this pass.
- Silently remounting leftover `requireApiSecret`, putting `can_deactivate: true` back, widening leftover extension Owner Bearer to these paths, importing leftover v1 `sendError`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
