# Show The Signed Owner Every Extension User Login Newest First After The Secret, Issue An Extension User Login So They Can Open The Granot Extension, Correct Email Password Or Roles And Kick Their Tokens When Something Actually Changed, Then Revoke The Login So The Email Can Be Issued Again — Never Put This Desk Before The Secret, Never Authenticate, Never Create An Agent, Never Deactivate, Never Store Employee, Never Return The Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 8 of this service — `extension-users-admin.routes.ts`
- Remaining in this service: `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/extension-users-admin.routes.ts`
- Knowledge: [`docs/knowledge/services/extension-users.md`](../../../docs/knowledge/services/extension-users.md) (Owner-only Admin Dashboard create, list, edit, and delete for Extension User email, password, and `roles[]`; leftover Employee dual-reads as Sales plus Customer Service; credential or roles-set change increments access-token `token_version`; this router is mounted from `v1.routes.ts` after the `/api/v1` guard; Admin Dashboard Admin → `403`; does **not** authenticate the Granot browser extension; does **not** create an Agent; does **not** deactivate). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(extensionUsersAdminRoutes)` on line 295, **after** `/api/v1` secret and after leftover conversations desk — this file **is** that mount). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (`router.use(extensionAuthRoutes)` **before** the secret — **does not import** this file; this file **does not import** that file). Distinct from already-recommended Drive callback: [routes-google-drive-oauth.md](routes-google-drive-oauth.md) (also before the secret). Distinct from already-recommended sibling after-secret desks: [routes-ringcentral-registry.md](routes-ringcentral-registry.md), [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md), [routes-job-number-timeline-admin.md](routes-job-number-timeline-admin.md), [routes-conversations-admin.md](routes-conversations-admin.md) (none of those issue or revoke an Extension User login). Distinct from already-recommended Wave A issue / show / correct / revoke: [extension-users-extension-users.md](extension-users-extension-users.md) (`listExtensionUsers` / `createExtensionUser` / `updateExtensionUser` / `deleteExtensionUser` — this file **asks** those; it does **not** hash, fold email, bump `token_version`, or dual-read leftover Employee). Distinct from leftover Wave B session: `src/auth/extension/` (`authenticateExtensionUser` / `hashPassword` / `getExtensionUserFromAccessToken` — **does not import** this file). Distinct from leftover Wave B Zod: `src/validation/v1/extensionUsers.validation.ts` (`createExtensionUserSchema` / `updateExtensionUserSchema` / `extensionUserIdParamSchema` — this file **asks** those; it does **not** preprocess empty password). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` — this file **asks** it on **all four** paths; signed Admin is **403**; an extension Owner Bearer may **not** run these paths). Distinct from leftover Admin browse: [admin-browse.md](admin-browse.md) has **no** `extension-users` resource. Distinct from leftover catalog: [catalog-catalog.md](catalog-catalog.md) (Registry Agents / Merchants — **not** an Extension User). Distinct from leftover Owner apply after login: [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) (next sibling `extension-granot-apply.routes.ts` — **not** this desk). Distinct from leftover operator upsert: `scripts/dev_ops/upsert-extension-user.ts` (can flip `active` outside this HTTP desk). Distinct from leftover role persist: `pnpm migration:extension-user-roles-array` / `pnpm migration:extension-user-roles-sales-backfill`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md), [Admin Dashboard](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename. The always-applied API host rule and `.cursor/skills/hit-vantage-api/SKILL.md` still list only `GET` / `POST`; this file already mounts leftover `PATCH` / leftover `DELETE`. Project-organization and `schema-and-crud-inputs.mdc` still describe create body as leftover `{ email, password, role }` singular; leftover Zod and this desk parse leftover `{ email, password, roles }`.
- Callers: **one runtime mount plus one focused route test plus a folder mount proof.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(extensionUsersAdminRoutes)` on line 295, **after** `router.use("/api/v1", requireApiSecret)` and after leftover conversations). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `extension-users-admin.routes.test.ts` (injects leftover `createExtensionUsersAdminRouter` deps; signs leftover HMAC; names Owner list without leftover `role` / leftover `password_hash`, Admin **403** on all four with leftover `created` / leftover `updated` / leftover `deleted` staying empty, Owner create **201** with leftover `roles[]` and no leftover `password`, leftover empty `roles` / leftover `employee` **400** `"Invalid request payload"`, leftover invalid payload **400**, leftover taken email **409**, Owner leftover PATCH / leftover DELETE **200**, leftover empty-password-only **400** then leftover empty password plus email **200**, leftover unknown id **404**, leftover junk ObjectId **400**). It does **not** name unsigned / missing-HMAC refuse body. It does **not** name leftover `500` leftover `error.message`. It does **not** name leftover Zod leftover `issues` on the body. It does **not** name leftover PATCH leftover `employee` / leftover empty `roles`. It does **not** prove leftover `token_version` (injected update never returns it). Folder `v1.routes.test.ts` only proves leftover `GET /api/v1/admin/extension-users` is mounted — it does **not** name leftover POST / leftover PATCH / leftover DELETE. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists leftover GET / leftover POST and **misses** leftover PATCH / leftover DELETE. Already-recommended Wave A `extensionUsers.service.test.ts` proves leftover issue / leftover show / leftover correct / leftover revoke through the service, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/extension-users*`. Wave B `session.test.ts` never hits this desk. Not this **interface**: leftover `createExtensionUser` itself, leftover `hashPassword`, leftover `normalizeExtensionRoles`, leftover `toAdminExtensionUser`, leftover `authenticateExtensionUser`, leftover `getExtensionUserFromAccessToken`, leftover `browseAdminResource`.
- Seams callers need: after `/api/v1` secret (parent mount) vs leftover Drive / leftover extension login **before**; leftover `requireRegistryOwnerActor` on **all four** paths (no leftover read-actor hatch — signed Admin is **403**); leftover Zod then leftover service (empty leftover `password` is omitted **before** this file; leftover `employee` / leftover empty `roles` never reach leftover `create`); leftover `201` issue vs leftover `200` show / leftover correct / leftover revoke; leftover factory `createExtensionUsersAdminRouter(deps)` (test injection) vs default export (live mount); leftover `sendError` leftover `isRegistryError` → `{ ok: false, code: registryCode, error: message, request_id }` vs leftover `ZodError` → `400` `"Invalid request payload"` **with** leftover `issues` vs leftover `AppError` → leftover `error.statusCode` + leftover `error.message` + leftover `request_id` (leftover `409` leftover taken email, leftover `404` leftover missing id) vs unhandled → `500` `{ error: error.message }` (**does** echo leftover `error.message`, unlike already-recommended Job Number timeline leftover `"Internal error"`). There is no begin / complete Domain Command **seam** in this file. There is no login **seam**. There is no hash **seam**. There is no `token_version` **seam**. There is no Agent-create **seam**. There is no deactivate **seam**.
- Split later (only if the file outgrows one sitting): this ~136-line file is one sitting if you read it as show the signed Owner every Extension User login newest first after the secret, issue an Extension User login so they can open the Granot extension, correct email password or roles and kick their tokens when something actually changed, then revoke the login so the email can be issued again — never put this desk before the secret, never authenticate, never create an Agent, never deactivate, never store Employee, never return the secret. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `list.ts`. Issue / show / correct / revoke stay already-recommended `extensionUsers.service.ts`. Hash / leftover Employee dual-read stay Wave B `auth/extension/`. Owner gate stays already-recommended `trustedActor.ts`. Zod preprocess stays leftover `extensionUsers.validation.ts`. Login stays already-recommended `extension-auth.routes.ts`.

`router.get("/api/v1/admin/extension-users")` / `router.post("/api/v1/admin/extension-users")` / `router.patch("/api/v1/admin/extension-users/:id")` / `router.delete("/api/v1/admin/extension-users/:id")` are HTTP verbs. The owner question is: *The Owner opened the Extension Users desk. Someone already passed the API secret. First show every login newest first — leftover Employee still paints as Sales plus Customer Service on the card, but this desk does not persist that conversion. Then issue a new login with email, password, and roles so they can open the Granot extension. When they correct email, password, or roles, ask the already-recommended service to kick every token only when something actually changed. When they revoke one, hard-remove it so that email can be issued again. Admin is 403 on all four. Do not put this desk before the secret. Do not log them in. Do not create an Agent. Do not deactivate. Do not store Employee. Do not return the secret.*

Who hashes the password, folds the email, dual-reads leftover Employee, and bumps `token_version` already lives in already-recommended `extensionUsers.service.ts`. Who admits the Granot extension without the secret already lives in already-recommended `extension-auth.routes.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Who turns leftover `""` password into omitted already lives in leftover `updateExtensionUserSchema`. Do not pull those in.

## What this file actually does

Four operations for the Extension User **desk**, not “an extension-user CRUD dump,” and not Issue An Extension User Login / Correct The Login themselves:

1. **Show the signed Owner every Extension User login newest first** — `GET /api/v1/admin/extension-users`. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor(req, auth(req))`. **Ask** leftover `list` (injected, or leftover `listExtensionUsers`). Answer **200** `{ ok: true, data }`. This beat does **not** parse a query. This beat does **not** remount leftover `requireApiSecret`. This beat does **not** hide leftover `active: false`. This beat does **not** persist leftover Employee.

2. **Issue an Extension User login so they can open the Granot extension** — `POST /api/v1/admin/extension-users`. Same connect + leftover Owner gate. Parse leftover `createExtensionUserSchema` (`email`, leftover `password` min 8, leftover `roles` non-empty leftover `owner` | leftover `sales` | leftover `customer_service`). **Ask** leftover `create` (injected, or leftover `createExtensionUser`). Answer **201** `{ ok: true, data }`. Leftover empty `roles` / leftover `employee` / leftover short password / leftover junk email stop at Zod and never reach leftover `create`. Leftover taken email is leftover `ConflictError` → leftover `409`. This beat does **not** return leftover `password` or leftover `password_hash`. This beat does **not** mint an access token. This beat does **not** create an Agent.

3. **Correct email, password, or roles and kick their tokens when something actually changed** — `PATCH /api/v1/admin/extension-users/:id`. Same connect + leftover Owner gate. Parse leftover `extensionUserIdParamSchema` then leftover `updateExtensionUserSchema`. Leftover `""` password is already omitted by leftover Zod preprocess; leftover password-only-empty fails leftover “at least one of email, password, or roles.” **Ask** leftover `update`. Answer **200** `{ ok: true, data }`. Leftover junk ObjectId is leftover `400` `"Invalid request payload"`. Leftover missing id is leftover `NotFoundError` → leftover `404` `"Extension User not found."` Leftover taken email is the same leftover `409` as issue. This beat does **not** decide leftover `token_version` — leftover `updateExtensionUser` does. This beat does **not** deactivate.

4. **Revoke the login so the email can be issued again** — `DELETE /api/v1/admin/extension-users/:id`. Same connect + leftover Owner gate. Parse leftover `extensionUserIdParamSchema`. **Ask** leftover `remove` (injected `deps.delete`, or leftover `deleteExtensionUser`). Answer **200** `{ ok: true, data: { id } }`. Leftover missing id is leftover `404`. This beat does **not** bump leftover `token_version`. This beat does **not** refuse the last Owner. This beat does **not** deactivate.

`auth` / `requestId` / leftover `sendError` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `requestId` prefers leftover `x-vantage-admin-request-id`, else leftover `x-request-id`. Leftover `sendError` is leftover `isRegistryError` → leftover `error.statusCode` + leftover `code: registryCode` + leftover `request_id`; leftover `ZodError` → **400** `{ ok: false, error: "Invalid request payload", issues, request_id }`; leftover `AppError` → leftover `error.statusCode` + leftover `error.message` + leftover `request_id`; else **500** `{ ok: false, error: error.message }` (**does** echo leftover `Error.message`; a non-Error becomes leftover `"Internal error"`). They are private. Leftover `sendError` does **not** log.

There is no fifth login or Agent operation. Leftover list / leftover issue / leftover correct / leftover revoke are four HTTP **adapters** on one factory. Leftover `409` and leftover `404` are leftover `AppError` **adapters** — do not collapse them so “one missing owns the desk.”

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed Owner see every Extension User login newest first, issue a new login so they can open the Granot extension, correct email password or roles so the service can kick tokens when something actually changed, then revoke the login so the email can be issued again — never authenticate, never create an Agent, never deactivate, never store Employee, never return the secret.” Already-recommended leftover issue / leftover show / leftover correct / leftover revoke / leftover speaking gate / leftover hash / leftover session already live in deeper **modules**. Do not pull those in. Do not invent an `ExtensionUsersAdminRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a login **adapter** so “create can return a Bearer token.” Do not invent a deactivate **adapter** so “delete can keep the row.” Do not invent a CRUD folder so `list.ts` / `create.ts` / `update.ts` / `delete.ts` each get a file.

Do not move leftover `createExtensionUser` into this file so “the route owns the hash.” Do not mount this router before leftover `requireApiSecret` so “it matches leftover extension login.” Do not merge this router into leftover `extension-auth.routes.ts` so “one file owns every Extension User path.” Do not merge this router into leftover `v1.routes.ts` so “one file owns every admin path.” Do not teach leftover `browseAdminResource` an `extension-users` resource. Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createExtensionUsersAdminRouter` | `createOwnerExtensionUserDesk` | leftover factory injects connect / list / create / update / delete for the route test |
| `default` router | `ownerExtensionUserDesk` | already-recommended public v1 desk mounts the zero-arg instance **after** the secret |
| `GET .../extension-users` (today unexported handler) | `showTheSignedOwnerEveryExtensionUserLoginNewestFirstOverHttp` | Owner desk list; never leftover `create` |
| `POST .../extension-users` (today unexported handler) | `issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtensionOverHttp` | Owner issue; leftover Zod then leftover `create`; leftover `201`; never leftover token |
| `PATCH .../extension-users/:id` (today unexported handler) | `correctEmailPasswordOrRolesAndKickTheirTokensWhenSomethingActuallyChangedOverHttp` | Owner correct; leftover id Zod then leftover body Zod then leftover `update`; leftover empty password already omitted |
| `DELETE .../extension-users/:id` (today unexported handler) | `revokeTheLoginSoTheEmailCanBeIssuedAgainOverHttp` | Owner revoke; leftover id Zod then leftover `remove`; leftover `{ id }` |
| `ExtensionUsersAdminDeps` | `OwnerExtensionUserDeskDeps` | test injection bag — connect / list / create / update / delete |

Keep the default export and the factory as one-line aliases until `v1.routes.ts` and the route test migrate. Do not make callers learn `createExtensionUserSchema` / `sendError` / `auth` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`listExtensionUsers` / `createExtensionUser` / `updateExtensionUser` / `deleteExtensionUser`) here — those stay already-recommended Wave A. Do **not** add leftover `POST .../login` so “issue can also admit them.” Do **not** add leftover `PATCH .../deactivate` so “HTTP can flip `active`.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover revoke already paints after leftover `deleteExtensionUser` returns:

```ts
type OwnerRevokedExtensionUserLoginResponse = {
  ok: true
  data: { id: string }
}
```

That is the handoff from “the login is gone” to “the Admin Dashboard may issue that email again.” Do **not** add leftover `email` onto that bag. Do **not** add leftover `token_version` onto that bag. Do **not** add leftover `active: false` onto that bag — leftover revoke is hard-remove.

A second named bag already exists for the desk card (already-recommended leftover `AdminExtensionUser` / leftover `ExtensionUserDeskCard`). Do **not** re-declare it here. Leave leftover `toAdminExtensionUser` on already-recommended `extensionUsers.service.ts`.

Leave leftover `listExtensionUsers` / leftover `createExtensionUser` / leftover `updateExtensionUser` / leftover `deleteExtensionUser` on already-recommended `extensionUsers.service.ts`. Leave leftover hash / leftover Employee dual-read on Wave B `auth/extension`. Leave leftover speaking gate on already-recommended `trustedActor.ts`. Leave leftover login on already-recommended `extension-auth.routes.ts`. Leave leftover empty-password omit on leftover `updateExtensionUserSchema`. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// extension-users-admin.routes.ts
// Someone already passed the API secret.
// Let a signed Owner see every Extension User login newest first.
// Let them issue a new login so that person can open the Granot extension.
// Let them correct email, password, or roles.
// The service kicks every token only when something actually changed.
// Let them revoke one so that email can be issued again.
// Do not put this desk before the secret.
// Do not log them in.
// Do not create an Agent.
// Do not deactivate.
// Do not store Employee.
// Do not return the secret.

export function createOwnerExtensionUserDesk(deps = {}) {
  const ownerExtensionUserDesk = Router()
  const connect = deps.connect ?? connectMongo
  const showEveryLogin = deps.list ?? listExtensionUsers
  const issueTheLogin = deps.create ?? createExtensionUser
  const correctTheLogin = deps.update ?? updateExtensionUser
  const revokeTheLogin = deps.delete ?? deleteExtensionUser

  // ── 1. Show the signed Owner every Extension User login newest first ─

  ownerExtensionUserDesk.get(
    "/api/v1/admin/extension-users",
    showTheSignedOwnerEveryExtensionUserLoginNewestFirstOverHttp,
  )

  // ── 2. Issue an Extension User login so they can open the Granot extension ─

  ownerExtensionUserDesk.post(
    "/api/v1/admin/extension-users",
    issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtensionOverHttp,
  )

  // ── 3. Correct email, password, or roles and kick their tokens when something actually changed ─

  ownerExtensionUserDesk.patch(
    "/api/v1/admin/extension-users/:id",
    correctEmailPasswordOrRolesAndKickTheirTokensWhenSomethingActuallyChangedOverHttp,
  )

  // ── 4. Revoke the login so the email can be issued again ─

  ownerExtensionUserDesk.delete(
    "/api/v1/admin/extension-users/:id",
    revokeTheLoginSoTheEmailCanBeIssuedAgainOverHttp,
  )

  return ownerExtensionUserDesk
}

async function showTheSignedOwnerEveryExtensionUserLoginNewestFirstOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const data = await showEveryLogin()
  return res.status(200).json({ ok: true, data })
}

async function issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtensionOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const parsed = parseTheIssuedLogin(req.body)        // leftover createExtensionUserSchema
  const data = await issueTheLogin(parsed)            // never returns password
  return res.status(201).json({ ok: true, data })
}

async function correctEmailPasswordOrRolesAndKickTheirTokensWhenSomethingActuallyChangedOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const { id } = parseTheLoginId(req.params)          // leftover objectIdSchema
  const parsed = parseTheLoginCorrection(req.body)    // leftover "" password already omitted
  const data = await correctTheLogin(id, parsed)      // service decides token_version
  return res.status(200).json({ ok: true, data })
}

async function revokeTheLoginSoTheEmailCanBeIssuedAgainOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const { id } = parseTheLoginId(req.params)
  const data = await revokeTheLogin(id)               // { id }; hard-remove
  return res.status(200).json({ ok: true, data })
}

function refuseTheDesk(res, error, requestId) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestId ?? null,
    })
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
      request_id: requestId ?? null,
    })
  }
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
      request_id: requestId ?? null,
    })
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
    request_id: requestId ?? null,
  })
}
```

Read the desk path out loud: *Someone already passed the API secret. A signed Owner opens the desk. Show every login newest first. When they issue one, parse email, password, and roles, refuse leftover Employee at Zod, then ask the service and answer 201 without the secret. When they correct one, parse the id and the patch — leftover empty password is already omitted — then ask the service to kick tokens only when something actually changed. When they revoke one, parse the id and hard-remove it. Admin is 403 on all four. Do not log them in. Do not create an Agent.*

That is the operation. `router.post("/api/v1/admin/extension-users")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Leftover extension login does not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. Leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Owner can issue a login without a secret.” Do not merge this router into already-recommended leftover `extension-auth.routes.ts` so “one Extension User file owns login and issue.”

2. **Leftover Zod owns leftover Employee and leftover empty password. This file only parses.** Leftover `createExtensionUserSchema` refuses leftover `employee`, leftover empty `roles`, leftover short password, leftover junk email. Leftover `updateExtensionUserSchema` turns leftover `""` into leftover `undefined` and then requires leftover email / leftover password / leftover roles. Already-recommended Wave A rec already says do not add leftover `if (password === "")` on the service. Do not copy that preprocess into this file so “the route matches Zod.” Do not move leftover schemas onto this file so “the desk owns the contract” — leave that for the validation pass.

3. **Project-organization and leftover `schema-and-crud-inputs.mdc` still say leftover `{ email, password, role }` singular.** Leftover Zod and this desk parse leftover `{ email, password, roles }`. The route test already posts leftover `roles: ["sales", "customer_service"]`. Do not silently accept leftover singular `role` so “the rule wins.” Do not edit those rule files in this rename.

4. **Operator skill and the host rule miss leftover PATCH and leftover DELETE.** Knowledge and this file already mount them. Folder `v1.routes.test.ts` only locks leftover `GET /api/v1/admin/extension-users`. Already-recommended Wave A rec already parked this. Do not drop leftover PATCH / leftover DELETE so “the host rule wins.” Do not edit the host rule or the skill in this rename. Do not treat the skill as this desk’s **interface**.

5. **Leftover `sendError` has leftover `AppError`. Sibling Owner desks do not.** Already-recommended leftover conversations leftover `sendError` is leftover registry / leftover Zod / leftover 500. Already-recommended leftover Job Number leftover `sendError` is leftover registry / leftover Zod / leftover logged `"Internal error"`. This desk maps leftover `ConflictError` / leftover `NotFoundError` through leftover `AppError` so leftover `409` / leftover `404` keep leftover `error.message` and do **not** grow leftover `code`. Do not silently import leftover Job Number leftover `sendError` so “one refuse owns every Owner desk.” Do not silently map leftover `AppError` onto leftover `isRegistryError` so “every refuse has leftover `registryCode`.”

6. **Unhandled `500` echoes leftover `error.message`.** Already-recommended Job Number timeline leftover `sendError` maps unhandled to leftover `"Internal error"` and logs leftover `job-number-timeline.admin.unhandled`. This desk echoes leftover `Error.message` and does **not** log (same as leftover conversations). A leftover `"Mongo is not connected"` would leave the body. Do not silently swallow leftover throws into leftover `"Internal error"` in this rename — park the gap.

7. **Every leftover `ZodError` becomes leftover `"Invalid request payload"` with leftover `issues`.** Leftover conversations leftover `"invalid_conversation_query"` has **no** leftover `issues`. Leftover Job Number leftover `"invalid_job_number"` has **no** leftover `issues`. This desk matches leftover extension-auth leftover Zod. Do not silently drop leftover `issues` so “it matches leftover conversations.” Do not silently rename the string to leftover `"invalid_extension_user"` so “Owner desks rhyme.”

8. **Admin is not a reader here.** Sibling leftover Granot cases **ask** leftover `requireRegistryReadActor` (signed Admin may see the intake queue). This desk **asks** leftover Owner on **all four** paths. The route test locks Admin **403** on leftover list / leftover issue / leftover correct / leftover revoke and leftover `created.length === 0`. Do not silently switch leftover list to leftover read-actor so “Admin can see who has a login.” Do not teach leftover extension Owner Bearer to run these paths so “the extension can issue a coworker.”

9. **This file does not hash, does not bump leftover `token_version`, and does not dual-read leftover Employee.** Already-recommended Wave A rec already names those as service beats. Injected leftover `update` in the route test never returns leftover `token_version`. Do not import leftover `hashPassword` so “POST is extra safe.” Do not import leftover `rolesSetsEqual` so “the route can skip a no-op PATCH.” Do not persist leftover Employee from leftover list so “the desk write matches the paint” — that persist is the migration.

10. **Leftover issue answers leftover `201`. Leftover show / leftover correct / leftover revoke answer leftover `200`.** Do not silently answer leftover `200` on leftover POST so “every write is the same.” Do not silently answer leftover `204` on leftover DELETE so “revoke has no body” — leftover `{ id }` is the handoff.

11. **Leftover revoke is hard-remove, not deactivate.** Leftover `upsert-extension-user.ts` can still flip leftover `active` outside this desk. Knowledge: these routes do not deactivate or reactivate. Do not invent leftover `PATCH .../deactivate` so “CRUD can soft-delete.” Do not bump leftover `token_version` on leftover DELETE so “stale tokens fail closed” — the row is gone.

12. **There is no last-Owner refuse.** Revoking the only leftover `owner` login is allowed. Do not add “keep one Owner” in this rename.

13. **Leftover junk ObjectId is leftover `400`, leftover unknown hex is leftover `404`.** Leftover `extensionUserIdParamSchema` **asks** leftover `objectIdSchema` (`/^[a-f\d]{24}$/i`). Leftover conversations leftover by-lead junk id is leftover `[]`. Do not silently 404 leftover `not-an-id` so “bad ids look like missing.” Do not silently 400 leftover unknown hex so “one invalid owns PATCH.”

14. **Leave sibling modules alone.** Leftover `listExtensionUsers` / leftover `createExtensionUser` / leftover `updateExtensionUser` / leftover `deleteExtensionUser` / leftover `requireRegistryOwnerActor` / leftover `createExtensionUserSchema` are already the right **depth**. This file orchestrates the HTTP **adapters**.

15. **Do not treat leftover catalog, leftover Admin browse, leftover Tariff, or leftover Owner apply as this story.** Already-recommended catalog is Registry Agents / Merchants. `browseAdminResource` has no `extension-users` resource. Next leftover `extension-granot-apply.routes.ts` is Owner apply after login. Next leftover `tariff-adjustments.routes.ts` is leftover Binding Estimate Fee after login. Do not teach this file leftover `database_scope`.

16. **Do not silently add login or Agent create.** Knowledge: this desk does not authenticate the Granot browser extension and does not create an Agent. Do not return leftover `{ accessToken }` from leftover issue, and do not call leftover catalog create so “a Sales login is also an Agent.”

## Testing

The **interface** is the test surface: leftover `createOwnerExtensionUserDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `showTheSignedOwnerEveryExtensionUserLoginNewestFirstOverHttp` / `issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtensionOverHttp` / `correctEmailPasswordOrRolesAndKickTheirTokensWhenSomethingActuallyChangedOverHttp` / `revokeTheLoginSoTheEmailCanBeIssuedAgainOverHttp`.

Today `extension-users-admin.routes.test.ts` already names Owner list without leftover `role` / leftover `password_hash`, Admin **403** on all four with no leftover write, Owner leftover issue **201** leftover `roles[]` without leftover `password`, leftover empty `roles` / leftover `employee` **400**, leftover invalid payload **400**, leftover taken email **409**, Owner leftover PATCH / leftover DELETE **200**, leftover empty-password-only **400** then leftover empty password plus email **200**, leftover unknown id **404**, leftover junk ObjectId **400**. It misses unsigned HMAC, leftover `500` leftover `error.message`, leftover Zod leftover `issues` on the body, leftover PATCH leftover `employee`, leftover POST leftover `role` singular, leftover `201` vs leftover `200` as named operations, and leftover PATCH / leftover DELETE mount on leftover `v1.routes.test.ts`. Already-recommended Wave A files prove leftover hash / leftover `token_version` / leftover Employee paint through the service — not this desk.

Keep the inject-and-sign style. Add the missing operations (do not boot leftover Mongo hop, leftover hash, leftover JWT, leftover Agent catalog, or leftover `upsert-extension-user.ts` in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route leftover `requireApiSecret`.
- All four paths **ask** leftover `requireRegistryOwnerActor`. Signed Admin **403**. Sales / Employee leftover `FORBIDDEN`. Extension Owner Bearer leftover `FORBIDDEN`.
- Unsigned / missing HMAC is leftover `isRegistryError` with leftover `code` + leftover `request_id` (not leftover Granot `OWNER_REQUIRED` remap, not leftover v1 `registry_code`).

**Newest first**
- Owner leftover `GET .../extension-users` **asks** leftover `list` and does **not** **ask** leftover `create`.
- Response has leftover `roles` and does **not** own leftover `role` or leftover `password_hash`.
- This beat does **not** parse a query and does **not** hide leftover `active: false`.

**Issue so they can open the Granot extension**
- Owner leftover `POST` **asks** leftover `create` and answers leftover **201**.
- Leftover `roles: ["sales", "customer_service"]` reaches leftover `create` as leftover `roles`, not leftover singular `role`.
- Leftover `roles: []` / leftover `roles: ["employee"]` / leftover `{ role: "sales" }` answer leftover **400** `"Invalid request payload"` and do **not** **ask** leftover `create`.
- Injected leftover `ConflictError` answers leftover **409** `"An Extension User already uses this email."`
- Desk card has no leftover `password`, no leftover `password_hash`. This beat does **not** mint a token. This beat does **not** create an Agent.

**Correct and kick only when something actually changed**
- Owner leftover `PATCH` **asks** leftover `update` after leftover id Zod and leftover body Zod.
- Leftover `{ password: "" }` answers leftover **400** and does **not** **ask** leftover `update`.
- Leftover `{ email, password: "" }` **asks** leftover `update` with leftover password omitted.
- Leftover `roles: ["employee"]` on leftover PATCH answers leftover **400**.
- Injected leftover `NotFoundError` answers leftover **404** `"Extension User not found."`
- Leftover `not-an-id` answers leftover **400** `"Invalid request payload"`.
- This beat does **not** **ask** leftover `rolesSetsEqual` / leftover `hashPassword`.

**Revoke so the email can be issued again**
- Owner leftover `DELETE` **asks** leftover `remove` and answers leftover **200** `{ data: { id } }`.
- Injected leftover `NotFoundError` answers leftover **404**.
- Leftover junk ObjectId answers leftover **400** and does **not** **ask** leftover `remove`.
- This beat does **not** deactivate. This beat does **not** refuse the last Owner.

**Mount**
- Folder `v1.routes.test.ts` should name leftover GET / leftover POST / leftover PATCH `/:id` / leftover DELETE `/:id`, not leftover GET alone.

**Not this file**
- Leftover hash / leftover `token_version` / leftover Employee paint / leftover email reuse stay on already-recommended [extension-users-extension-users.md](extension-users-extension-users.md).
- Leftover login / leftover refresh / leftover logout stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md).
- HMAC / preview hatch stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Leftover empty-password omit / leftover `roles` enum stay on leftover `extensionUsers.validation.ts` (Wave B validation pass).
- Leftover catalog Agents stay on already-recommended [catalog-catalog.md](catalog-catalog.md).
- Leftover Admin browse stays on already-recommended [admin-browse.md](admin-browse.md).
- Leftover conversations leftover listen / leftover Job Number leftover sample stay on already-recommended [routes-conversations-admin.md](routes-conversations-admin.md) / [routes-job-number-timeline-admin.md](routes-job-number-timeline-admin.md).

Do **not** add a test per helper (`whoTheSecretAlreadyAdmitted`, `parseTheIssuedLogin`, `parseTheLoginCorrection`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- An `ExtensionUsersAdminRoutesService` class with `create` / `update` / `delete` / `list`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `list.ts` / `post.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Owner issue in front of `x-api-secret`.
- Breaking the leftover Zod-then-service **seam**: do not hash or bump leftover `token_version` in this file.
- Treating leftover `createExtensionUser`, leftover `authenticateExtensionUser`, leftover `hashPassword`, leftover Drive / leftover extension login desks, leftover conversations desk, leftover Job Number desk, leftover inbound-number desk, leftover webhook / cron routers, leftover Admin browse, or leftover catalog as this story.
- Inventing a login / deactivate / Agent-create **adapter** that has only one caller in this pass.
- Silently remounting leftover `requireApiSecret`, accepting leftover singular `role`, dropping leftover PATCH / leftover DELETE so the host rule “wins,” returning leftover `{ accessToken }` from leftover issue, importing leftover `hashPassword` so “POST is extra safe,” adding leftover `PATCH .../deactivate`, editing the host rule / operator skill / project-organization leftover singular `role`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
