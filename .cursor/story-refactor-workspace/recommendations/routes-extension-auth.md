# Admit This Granot Extension User To A Session Without The API Secret, Renew It From The Refresh Token, Show Who This Access Token Is, Then Acknowledge Logout Without Revoking — Never Put This Desk Behind The Secret, Never Hash Here, Never Kick Tokens On Logout, Never Issue An Admin Login — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 2 of this service — `extension-auth.routes.ts`
- Remaining in this service: `google-drive-oauth.routes.ts`, `ringcentral-registry.routes.ts`, `granot-lifecycle-admin.routes.ts`, `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/extension-auth.routes.ts`
- Knowledge: no dedicated routes Service. Session notes live on already-recommended [`docs/knowledge/services/extension-users.md`](../../../docs/knowledge/services/extension-users.md) (Owner-only Admin Dashboard create / list / edit / delete; **does not authenticate** the Granot browser extension; access tokens are `{ sub, email, roles, token_version }`; credential or roles-set change increments `token_version`; `getExtensionUserFromAccessToken` requires matching email, roles set, and `token_version`). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(extensionAuthRoutes)` **before** `/api/v1` secret — this file **is** that unguarded mount; the desk does **not** parse login). Distinct from already-recommended Owner issue / revoke: [extension-users-extension-users.md](extension-users-extension-users.md) (`createExtensionUser` / `deleteExtensionUser` — **does not import** this file; this file **does not import** that file). Distinct from already-recommended Owner apply after login: [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) (next sibling `extension-granot-apply.routes.ts` — **not** this desk). Distinct from leftover Wave B session: `src/auth/extension/session.ts` (`authenticateExtensionUser` / `refreshExtensionSession` / `getExtensionUserFromAccessToken` — this file **asks** those; it does **not** hash, sign, or match `token_version`). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (`readBearerToken` + Owner vs Sales 403 vs Customer Service tariff-only — **after** this desk; this file never sets `req.vantageAuth`). Distinct from leftover Wave B Drive callback: next `google-drive-oauth.routes.ts` (also unguarded; **not** an Extension User session). Distinct from leftover Wave B Owner admin router: next `extension-users-admin.routes.ts` (behind the secret + `requireRegistryOwnerActor`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(extensionAuthRoutes)` on line 288, before Drive and before `requireApiSecret`). Leftover `src/app.ts` mounts the public v1 desk, not this file. Folder `v1.routes.test.ts` does **not** name `/extension/auth/*`. Wave B `session.test.ts` **asks** leftover `getExtensionUserFromAccessToken` / `issueTokens` / matchers — not this router. Wave B `requireApiSecret.test.ts` **asks** leftover `vantageAuthLookups.getExtensionUserFromAccessToken` on protected routes — not this desk. Next `extension-users-admin.routes.ts` stubs Owner create/list and never hits login. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists the four paths as unguarded. Not this **interface**: `authenticateExtensionUser` itself, leftover `hashPassword` / `signAccessToken`, leftover `createExtensionUser`, leftover `requireVantageAuth` role gate, leftover Drive OAuth.
- Seams callers need: unguarded login / refresh / me / logout **before** `/api/v1` secret vs every data route **after**; password admit vs refresh-token admit vs Bearer identify; `401` `"Invalid email or password"` vs `"Invalid refresh token"` vs `"Unauthorized"` (do not unify); Zod `400` `{ error: "Invalid request payload", issues }` vs null session `401` vs `500` `{ error: message }`; login/refresh `{ ok, data: { user, accessToken, refreshToken } }` vs logout `{ ok: true }` with no `data`; this file’s `readBearerUser` vs Wave B `requireApiSecret.readBearerToken` (same slice, different **adapter** — identify vs gated admit). There is no begin / complete Domain Command **seam**. There is no Owner-actor **seam**. There is no `token_version` revoke **seam**. There is no role-route **seam** (Sales may still receive tokens here). There is no webhook **seam**.
- Split later (only if the file outgrows one sitting): this ~106-line file is one sitting if you read it as admit the Granot extension user without the secret — renew from the refresh token — show who this access token is — acknowledge logout without revoking. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `login.ts` / `logout.ts`. Hash / JWT / `token_version` stay Wave B `auth/extension/`. Owner issue / revoke stays already-recommended `extensionUsers`. Role gate stays next `requireApiSecret.ts`.

`router.post("/login")` / `router.post("/refresh")` / `router.get("/me")` / `router.post("/logout")` are HTTP verbs. The owner question is: *Someone opened the Granot browser extension. They do not have `x-api-secret`. Let them in with email and password. Hand back the public user card plus an access token and a refresh token. Let them renew from the refresh token without typing the password again. Let them ask who this access token is. If they hit logout, say ok — do not kick the tokens. Owner PATCH that actually changes email, password, or roles is what kicks every token, and that write does not live here. Do not put this desk behind the secret. Do not hash here. Do not issue an Admin Dashboard login. Do not pretend logout revoked anything.*

Who hashes the password and signs `{ sub, email, roles, token_version }` already lives in leftover `src/auth/extension/`. Who issues / corrects / revokes the login already lives in already-recommended `extensionUsers.service.ts`. Who refuses Sales on a protected data route already lives in leftover `requireApiSecret`. Do not pull those in.

## What this file actually does

Four operations for the unguarded Granot-extension session **desk**, not “an auth CRUD dump,” and not Issue An Extension User Login / Apply An Owner Snapshot / Admit The Public V1 Secret:

1. **Admit this Granot extension user to a session** — `POST /api/v1/extension/auth/login`. Parse `{ email, password }` with inline `loginSchema` (email + non-empty password). **Ask** leftover `authenticateExtensionUser`. `null` (unknown email, inactive, bad password, or unreadable roles) → `401` `{ ok: false, error: "Invalid email or password" }`. Success flattens leftover `{ user, tokens }` into `{ ok: true, data: { user, accessToken, refreshToken } }` at `200`. Zod and unexpected throws go through `sendAuthError`. This beat does **not** hash. This beat does **not** stamp `last_login_at` (leftover session does). This beat does **not** set `req.vantageAuth`. This beat does **not** require `x-api-secret`.

2. **Renew this extension session from the refresh token** — `POST /api/v1/extension/auth/refresh`. Parse `{ refreshToken }` with inline `refreshSchema` (non-empty string). **Ask** leftover `refreshExtensionSession`. `null` (bad JWT, bad `sub`, inactive, `token_version` drift, or unreadable roles) → `401` `{ ok: false, error: "Invalid refresh token" }`. Success uses the same flatten as admit. This beat does **not** stamp `last_login_at`. This beat does **not** accept a password. This beat does **not** blacklist the old refresh token — leftover session mints a new pair when the stored version still matches.

3. **Show who this access token is** — `GET /api/v1/extension/auth/me`. Read `Authorization: Bearer …` through `readBearerUser`. Missing / blank / leftover `getExtensionUserFromAccessToken` `null` → `401` `{ ok: false, error: "Unauthorized" }`. Success is `{ ok: true, data: { user } }` with leftover `PublicExtensionUser` (`id`, `email`, `roles`) — never hash, never `token_version`, never `last_login_at`. This beat does **not** use `sendAuthError`. This beat does **not** apply Sales / Customer Service route rules.

4. **Acknowledge logout without revoking** — `POST /api/v1/extension/auth/logout`. Ignore the body and the Bearer. Answer `{ ok: true }` with no `data`. This beat does **not** call leftover session. This beat does **not** increment `token_version`. This beat does **not** blacklist a refresh token. This beat does **not** deactivate the [Extension User](../../../../CONTEXT.md).

`sendAuthError` / `readBearerUser` / the two inline Zod objects are beats inside these operations, not extra owner stories. `sendAuthError` is Zod `400` `"Invalid request payload"` + `issues`, else `500` `{ ok: false, error: message }`. It is private.

## Organization

Keep one file. This is the screenplay for “admit the Granot extension without the secret, then let them renew or ask who they are, and treat logout as a polite goodbye.” Hash / JWT / `token_version` match already live in leftover `src/auth/extension/`. Owner issue / revoke already live in already-recommended `extensionUsers.service.ts`. Public v1 secret already lives on leftover `requireApiSecret`. Drive callback already lives on the next sibling router. Do not pull those in. Do not invent an `ExtensionAuthService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a revoke **adapter** so “logout can kick tokens.” Do not invent a role-route **seam** so “Sales cannot log in.” Do not invent a CRUD folder so `login.ts` / `refresh.ts` / `logout.ts` each get a file.

Do not move `authenticateExtensionUser` into this file so “the route owns the hash.” Do not mount these four paths after `requireApiSecret` so “every `/api/v1` path is guarded.” Do not teach already-recommended `createExtensionUser` to return tokens so “issue logs them in.” Do not merge this router into `v1.routes.ts` so “one desk owns login.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `granotExtensionSessionDesk` | already-recommended public v1 desk mounts it **before** the secret |
| `POST .../login` (today unexported handler) | `admitThisGranotExtensionUserToASession` | password admit; `401` does not distinguish unknown vs bad vs inactive |
| `POST .../refresh` (today unexported handler) | `renewThisExtensionSessionFromTheRefreshToken` | refresh-token admit; different `401` string |
| `GET .../me` (today unexported handler) | `showWhoThisAccessTokenIs` | Bearer identify; `401` `"Unauthorized"` |
| `POST .../logout` (today unexported handler) | `acknowledgeLogoutWithoutRevoking` | polite `{ ok: true }` — not a kick |

Keep the default export as the one-line alias until `v1.routes.ts` migrates. Do not make callers learn `sendAuthError` / `readBearerUser` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export `loginSchema` / `refreshSchema` onto Wave B `v1.validation.ts` in this rename — leave that for the validation pass. Do **not** put `req.vantageAuth` onto this desk so “login is the same as the secret.” Do **not** rename leftover session exports (`authenticateExtensionUser` / `refreshExtensionSession` / `getExtensionUserFromAccessToken`) here — those stay Wave B `auth/extension/`.

**No class for the workflow.** The one type that *does* earn a name is the flattened session card login and refresh already paint:

```ts
type GranotExtensionSessionCard = {
  user: PublicExtensionUser
  accessToken: string
  refreshToken: string
}
```

That is the handoff from “leftover session returned `{ user, tokens }`” to “the extension stores two strings.” Do **not** add `token_version` or `password_hash` onto that card. Do **not** add a Mongo `ClientSession` so “the route owns the write.” Do **not** add `last_login_at` so “me can show when they signed in.”

Leave hash / sign / match on Wave B `auth/extension`. Leave Owner issue / revoke on already-recommended `extensionUsers`. Leave role-route refuse on Wave B `requireApiSecret`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// extension-auth.routes.ts
// Someone opened the Granot extension.
// They do not have the API secret. Admit them. Then let them renew or ask who they are.

const granotExtensionSessionDesk = Router()

// ── 1. Admit this Granot extension user to a session ──────

granotExtensionSessionDesk.post(
  "/api/v1/extension/auth/login",
  admitThisGranotExtensionUserToASession,
)

async function admitThisGranotExtensionUserToASession(req, res) {
  try {
    const parsed = loginSchema.parse(req.body)
    const session = await authenticateExtensionUser(parsed.email, parsed.password)
    if (!session) {
      return refuseUnknownOrBadPassword(res) // 401 "Invalid email or password"
    }
    return handTheSessionCard(res, session)
  } catch (error) {
    return refuseThisExtensionSessionRequest(res, error)
  }
}

function handTheSessionCard(res, session) {
  return res.json({
    ok: true,
    data: {
      user: session.user,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
    },
  })
}

// ── 2. Renew this extension session from the refresh token ─

granotExtensionSessionDesk.post(
  "/api/v1/extension/auth/refresh",
  renewThisExtensionSessionFromTheRefreshToken,
)

async function renewThisExtensionSessionFromTheRefreshToken(req, res) {
  try {
    const parsed = refreshSchema.parse(req.body)
    const session = await refreshExtensionSession(parsed.refreshToken)
    if (!session) {
      return refuseInvalidRefreshToken(res) // 401 "Invalid refresh token"
    }
    return handTheSessionCard(res, session)
  } catch (error) {
    return refuseThisExtensionSessionRequest(res, error)
  }
}

// ── 3. Show who this access token is ──────────────────────

granotExtensionSessionDesk.get(
  "/api/v1/extension/auth/me",
  showWhoThisAccessTokenIs,
)

async function showWhoThisAccessTokenIs(req, res) {
  const user = await readWhoThisBearerIs(req)
  if (!user) {
    return res.status(401).json({ ok: false, error: "Unauthorized" })
  }
  return res.json({ ok: true, data: { user } })
}

async function readWhoThisBearerIs(req) {
  const token = sliceTheBearerToken(req) // same slice as Wave B requireApiSecret
  if (!token) return null
  return getExtensionUserFromAccessToken(token)
}

// ── 4. Acknowledge logout without revoking ────────────────

granotExtensionSessionDesk.post(
  "/api/v1/extension/auth/logout",
  acknowledgeLogoutWithoutRevoking,
)

function acknowledgeLogoutWithoutRevoking(_req, res) {
  return res.json({ ok: true })
}

function refuseThisExtensionSessionRequest(res, error) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    })
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Extension auth failed",
  })
}

export default granotExtensionSessionDesk
```

Read the admit path out loud: *Someone opened the Granot extension without the API secret. Parse email and password. Ask leftover authenticate. If the row is missing, inactive, the password is wrong, or roles cannot be read, say invalid email or password — do not say which. Flatten the public card and the two tokens. If the body is not an email plus a password, say invalid request payload. Do not hash here. Do not stamp last login here. Do not put this route behind the secret. Do not kick tokens when they later hit logout.*

That is the operation. `router.post("/login")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Login and refresh are the same admit adapter.** Both parse, ask leftover session, `401` on `null`, flatten `{ user, tokens }`, and refuse through `sendAuthError`. Shared beats: parse, ask, refuse-null, hand the card. Only the Zod object, the asked function, and the `401` string differ. Extract `handTheSessionCard`. Keep both parents deep. Do not silently shove refresh into login so “one handler owns every admit.”

2. **`logout` lies.** It does not revoke, blacklist, increment `token_version`, or deactivate. Already-recommended Owner PATCH that actually changes email / password / roles is the kick. Name it `acknowledgeLogoutWithoutRevoking`. Do not invent a token denylist in this pass so “logout can be real,” and do not bump `token_version` from this desk so “stale tokens fail closed” — that write lives on already-recommended `updateExtensionUser`.

3. **`sendAuthError` 500 echoes `error.message`.** Already-recommended public v1 `sendError` classifies leftover `AppError` / registry `toHttpBody()` / optional 5xx events. This copy does not. Do not silently import `sendError` so “one refuse owns every router,” and do not drop the message so “auth never leaks” until a test names the leak. Lock `{ ok: false, error: message }`.

4. **`me` has no refuse wrapper.** Leftover `getExtensionUserFromAccessToken` swallows a bad JWT as `null`. An unexpected throw becomes Express’s bare 500, not `{ ok: false }`. Do not silently wrap `me` in `sendAuthError` so “every path looks the same” unless a test proves the throw. Lock the `401` `"Unauthorized"` string — it is not the login string.

5. **`readBearerUser` copies Wave B `readBearerToken`.** Same `Authorization` slice. Different **adapter**: this file identifies; leftover `requireApiSecret` then applies Owner / Sales 403 / Customer Service tariff-only and sets `req.vantageAuth`. Do not invent a shared Bearer **adapter** in this pass so “one helper owns every token,” and do not set `vantageAuth` here so “login is already admitted to the data desk.”

6. **Inline Zod is not the v1 barrel.** `loginSchema` / `refreshSchema` live in this file. Wave B `src/validation/v1/` has no extension-auth schema. Do not silently move them onto `v1.validation.ts` in this rename. Leave that for the validation pass.

7. **401 strings must stay distinct.** Login `"Invalid email or password"` hides unknown vs inactive vs bad password vs unreadable roles (leftover session returns `null` for all four). Refresh `"Invalid refresh token"` hides JWT vs `token_version` drift. `me` `"Unauthorized"` hides missing header vs stale access token. Do not unify them so “auth errors are consistent.”

8. **Sales may still receive tokens here.** Leftover `requireApiSecret` later 403s Sales on every protected route and limits Customer Service to `POST /tariff-adjustments`. This desk does not know that. Do not silently refuse Sales at login so “they cannot get a token.”

9. **Leave sibling modules alone.** `authenticateExtensionUser`, `refreshExtensionSession`, `getExtensionUserFromAccessToken`, `createExtensionUser`, `requireApiSecret`, and next Drive OAuth are already the right **depth**. This file orchestrates unguarded admit / renew / identify / goodbye.

## Testing

The **interface** is the test surface: the default `granotExtensionSessionDesk` (mounted on already-recommended `publicV1Desk` **before** the secret) and `admitThisGranotExtensionUserToASession` / `renewThisExtensionSessionFromTheRefreshToken` / `showWhoThisAccessTokenIs` / `acknowledgeLogoutWithoutRevoking`.

Today there is **no** `extension-auth.routes.test.ts`. `v1.routes.test.ts` does not name `/extension/auth/*`. Wave B `session.test.ts` proves leftover matchers and `getExtensionUserFromAccessToken` through an injected lookup. That is not this desk.

Add a route test that names the operation (inject leftover session; do not boot JWT secrets in the route file):

**Admit / renew**
- `POST /api/v1/extension/auth/login` **asks** `authenticateExtensionUser` with the parsed email and password and answers `200 { ok, data: { user, accessToken, refreshToken } }`.
- Leftover `null` → `401` `"Invalid email or password"` — unknown, inactive, and bad password stay the same string.
- Zod fail (missing password, not-an-email) → `400` `"Invalid request payload"` + `issues`.
- `POST .../refresh` **asks** `refreshExtensionSession` and uses the same card flatten; leftover `null` → `401` `"Invalid refresh token"`.
- This desk is registered on `publicV1Desk` **before** `router.use("/api/v1", requireApiSecret)`.

**Identify / goodbye**
- `GET .../me` without Bearer, or leftover `getExtensionUserFromAccessToken` `null` → `401` `"Unauthorized"`.
- Valid Bearer **asks** leftover `getExtensionUserFromAccessToken` and answers `{ ok: true, data: { user } }` with `id` / `email` / `roles` only.
- `POST .../logout` answers `{ ok: true }` and does **not** call leftover session.

**Not this file**
- Hash / `last_login_at` / JWT sign / `token_version` match stay on leftover `src/auth/extension/session.ts`.
- Owner create / PATCH kick / hard-remove stay on already-recommended [extension-users-extension-users.md](extension-users-extension-users.md).
- Sales 403 / Customer Service tariff-only / `req.vantageAuth` stay on next `requireApiSecret.ts`.
- Drive callback stays on next `google-drive-oauth.routes.ts`.
- Owner apply after login stays on next `extension-granot-apply.routes.ts`.

Do **not** add a test per helper (`handTheSessionCard`, `sliceTheBearerToken`, `refuseUnknownOrBadPassword`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendAuthError` so “the test can unit the refuse.”

## What I would not do

- An `ExtensionAuthService` class with `create` / `update` / `delete` / `login` / `logout`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `login.ts` / `refresh.ts` / `logout.ts` “for cleanliness.”
- Breaking the unguarded **seam**: these four paths stay before `/api/v1` secret; do not put login behind `x-api-secret`.
- Treating Owner `createExtensionUser`, leftover `authenticateExtensionUser` itself, Drive OAuth, Owner Granot-sync apply, or `requireApiSecret` role gates as this story.
- Inventing a shared Bearer or `sendError` **adapter** that has only one caller in this pass.
- Silently revoking on logout, bumping `token_version` from this desk, refusing Sales at login, wrapping `me` in `sendAuthError`, or moving Zod onto `v1.validation.ts` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
