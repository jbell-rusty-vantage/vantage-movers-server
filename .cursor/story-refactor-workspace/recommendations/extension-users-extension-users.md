# Issue An Extension User Login So They Can Open The Granot Extension, Show The Owner Every Login Newest First Including Leftover Employee As Sales Plus Customer Service, Correct Email Password Or Roles And Kick Their Tokens When Something Actually Changed, Then Revoke The Login So The Email Can Be Issued Again — Never Authenticate, Never Create An Agent, Never Deactivate, Never Store Employee — operational story

- Status: recommended
- Service: `extensionUsers` (Wave A, visited)
- Pass: 1 of this service — `extensionUsers.service.ts`
- Remaining in this service: none
- Target: `src/services/extensionUsers/extensionUsers.service.ts`
- Knowledge: [`docs/knowledge/services/extension-users.md`](../../../docs/knowledge/services/extension-users.md) (Owner-only Admin Dashboard create, list, edit, and delete for Extension User email, password, and `roles[]`; leftover Employee dual-reads as Sales plus Customer Service; credential or roles-set change increments access-token `token_version`). Distinct from leftover Granot extension login: Wave B `src/auth/extension/` (`POST /api/v1/extension/auth/login` — **does not import** this file). Distinct from leftover Agent / Merchant catalog: already-recommended [catalog-catalog.md](catalog-catalog.md) (Operations Registry cards — **not** an Extension User). Distinct from leftover Admin Dashboard desks: already-recommended [admin-browse.md](admin-browse.md) (`form-leads` / `call-leads` / `booked-leads` / `cancelled-leads` / `customers` / `agents` — **not** `extension-users`). Distinct from leftover Owner apply after login: already-recommended [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md). Distinct from leftover Tariff Adjustment Submit after login: unlisted Wave A `src/services/tariff/` (next services after this folder). Distinct from leftover role fold: Wave B `src/auth/extension/roles.ts` (`normalizeExtensionRoles` / `resolveStoredExtensionRoles` / `rolesSetsEqual` — this file **asks** those; it does not own them). Distinct from leftover Owner-actor gate: already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` sits on the route, not here). Operator `scripts/dev_ops/upsert-extension-user.ts` can still change password, roles, and `active` outside this HTTP service. Migrations `pnpm migration:extension-user-roles-array` and `pnpm migration:extension-user-roles-sales-backfill` persist leftover `role` → `roles[]`; they are not this **interface**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Extension User Service file in this rename. The always-applied API host rule still lists only `GET` / `POST /api/v1/admin/extension-users`; the router already mounts `PATCH` and `DELETE`.
- Callers: **one runtime import site.** Wave B `src/routes/extension-users-admin.routes.ts` **asks** `listExtensionUsers`, `createExtensionUser`, `updateExtensionUser`, `deleteExtensionUser` (defaults; the route factory may inject stubs). Owner gate is `requireRegistryOwnerActor` on that router — Admin Dashboard Admin is `403` before this file runs. Barrel: `extensionUsers/index.ts` (re-exports the four writes/reads **and** leftover `toAdminExtensionUser`). Tests: `extensionUsers.service.test.ts` (memory `ExtensionUserStore`; create folds email + canonical role order and never returns the secret; create 409 on taken email; list dual-reads leftover `role: employee`; leftover `toAdminExtensionUser` as a painted helper; update bumps `token_version` only on a real email / password / roles-set change; update 409 uses the create message; update / delete 404; delete then create reuses the email). Route tests stub the four exports and never **ask** this file. `v1.service.ts` does **not** re-export this file. `adminBrowse.service.ts` does **not** import this file. Wave B `src/auth/extension/` does **not** import this file. Not this **interface**: `hashPassword`, `normalizeEmail`, `normalizeExtensionRoles`, `resolveStoredExtensionRoles`, `rolesSetsEqual`, `requireRegistryOwnerActor`, leftover `getExtensionUserFromAccessToken`, leftover `formatTariffActorRole`, leftover `upsert-extension-user.ts`.
- Seams callers need: Owner desk card vs stored hash (password never leaves); memory store vs Mongo store (tests inject `ExtensionUserStore` + `hashPassword`); no-op PATCH vs actual email / password / roles-set change (`token_version` increments only on the latter; roles-set compare is membership, not array order); leftover singular `role` dual-read vs persist (`roles[]` + `$unset role` on a real write). There is no begin / complete Domain Command **seam**. There is no login **seam**. There is no deactivate **seam**. There is no Agent-create **seam**. There is no Sheet Sync **seam**. There is no Owner-actor **seam** inside this file (the route owns it).
- Split later (only if the file outgrows one sitting): this ~315-line file is one sitting if you read it as issue an Extension User login so they can open the Granot extension — show the owner every login newest first — correct email, password, or roles and kick their tokens when something actually changed — revoke the login so the email can be issued again. If it later splits by **story**: `issueAnExtensionUserLogin.ts` / `correctTheLoginAndKickTheirTokens.ts` — never `create.ts` / `update.ts` / `delete.ts`. Login / token verify stay Wave B `auth/extension/`. Role fold stays Wave B `roles.ts`. Owner gate stays the route.

`listExtensionUsers` / `createExtensionUser` / `updateExtensionUser` / `deleteExtensionUser` are executor mechanics. The owner question is: *I need to issue Granot-extension logins from the Admin Dashboard. Show me who has one, newest first — leftover Employee still paints as Sales plus Customer Service. Let me change their email, password, or roles. If I actually change something, kick every token they are holding. A PATCH that only restates the same email or the same roles set does not kick them. Let me revoke one so that email can be issued again. The desk card never shows the password or the hash. This file does not log them in. This file does not create an Agent. This file does not deactivate. This file does not store Employee.*

Who hashes the password and folds the email already live in Wave B `src/auth/extension/`. Who decides leftover Employee → Sales plus Customer Service already lives in Wave B `roles.ts`. Who refuses a non-Owner actor already lives on `extension-users-admin.routes.ts`. Who verifies `{ sub, email, roles, token_version }` already lives in leftover `getExtensionUserFromAccessToken`. Do not pull those in.

## What this file actually does

Four “keep the Extension User logins the Granot extension will later present” stories in one sitting, not “an extension-user CRUD service,” and not Log This Person Into The Granot Extension:

1. **Issue an Extension User login so they can open the Granot extension** — `createExtensionUser`. Fold the email (trim + lowercase). **Ask** leftover `normalizeExtensionRoles` and refuse `employee`, empty, or unknown. Refuse a second row for that email (`ConflictError` `"An Extension User already uses this email."`) before the write **and** again if Mongo `11000`s. Hash the password through leftover `hashPassword` (or the injected hasher). Persist `active: true`, `token_version: 0`, `password_changed_at` now. Writes store `roles[]` in canonical order (`owner`, `sales`, `customer_service`) and never store `employee`. Paint the desk card. This beat does **not** return `password` or `password_hash`. This beat does **not** create an Agent. This beat does **not** mint an access token.

2. **Show the owner every Extension User login, newest first** — `listExtensionUsers`. Sort `created_at` desc. No `active` filter — inactive rows stay on the desk. Dual-read leftover singular `role`: leftover Employee → `["sales", "customer_service"]`; leftover current role → `[role]`. The card is `id`, `email`, `roles`, `active`, `created_at`, `last_login_at`. This beat does **not** persist the leftover conversion. This beat does **not** hide inactive. This beat does **not** write Mongo.

3. **Correct the login and kick their tokens when something actually changed** — `updateExtensionUser`. Load by id or 404 `"Extension User not found."` Resolve stored roles or `BadRequestError` `"Extension User roles are invalid."` Fold a provided email. Fold a provided roles array (same refuse as issue). A password string means the secret changed. Roles-set compare is membership, not array order (`["customer_service", "sales"]` equals `["sales", "customer_service"]`). Same folded email plus same roles set plus no password → return the painted card and **do not** increment `token_version`. A real email / password / roles-set change: refuse a taken email (same 409 message as issue), hash a new password when present, `$set` `roles` (even when only email or password changed), `$unset` leftover `role`, increment `token_version`, and set `password_changed_at` only when the password changed. Missing id after the write → 404. Mongo `11000` → the same 409. This beat does **not** deactivate. This beat does **not** mint a replacement token.

4. **Revoke the login so the email can be issued again** — `deleteExtensionUser`. Hard-remove the Mongo document. Missing id → 404 `"Extension User not found."` This beat does **not** increment `token_version` — the user is gone. This beat does **not** deactivate. This beat does **not** refuse the last Owner.

There is no fifth login or Agent operation. `toAdminExtensionUser` is a paint beat inside stories 1–3. It is exported today only because the test file and the barrel treat it as the **interface** — that is a leak, not a fifth owner story. `mongoStore` is the default **adapter** of `ExtensionUserStore`; tests inject memory.

## Organization

Keep one file. This is the screenplay for “issue an Extension User login so they can open the Granot extension, then keep that login honest when the owner corrects or revokes it.” Password hash / email fold already live in Wave B `src/auth/extension/`. Leftover Employee dual-read already lives in Wave B `roles.ts`. Owner-actor already lives on the admin router. Access-token verify already lives in leftover `getExtensionUserFromAccessToken`. Zod already lives in Wave B `extensionUsers.validation.ts`. The leftover `role` → `roles[]` persist already lives on the migration scripts. Do not pull those in. Do not invent an `ExtensionUserService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a login **adapter** so “create can return a Bearer token.” Do not invent a deactivate **adapter** so “delete can keep the row.” Do not invent an Owner-actor **seam** this file does not have. Do not invent a CRUD folder so “list / create / update / delete each get a file.”

Do not move `normalizeExtensionRoles` into this file so “one service owns roles.” Do not teach `adminBrowse.service.ts` an `extension-users` resource so “one desk owns every collection.” Do not merge leftover `upsert-extension-user.ts` so “HTTP can also flip `active`.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createExtensionUser` | `issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtension` | Owner POST; unique email; never returns the secret |
| `listExtensionUsers` | `showTheOwnerEveryExtensionUserLoginNewestFirst` | Owner GET; leftover Employee paints Sales plus Customer Service |
| `updateExtensionUser` | `correctTheLoginAndKickTheirTokensWhenSomethingActuallyChanged` | Owner PATCH; no-op does not bump `token_version` |
| `deleteExtensionUser` | `revokeTheLoginSoTheEmailCanBeIssuedAgain` | Owner DELETE; hard-remove; email may be reused |
| `AdminExtensionUser` | `ExtensionUserDeskCard` | `id` / `email` / `roles` / `active` / timestamps — never hash, never singular `role` |
| `ExtensionUserStore` | store **adapter** | memory vs Mongo; tests inject it |
| `toAdminExtensionUser` | leftover paint leak | tests + barrel only — unexport after the test names the four stories |

Keep the old names as one-line aliases until Wave B `extension-users-admin.routes.ts`, `extensionUsers/index.ts`, and `extensionUsers.service.test.ts` migrate. Do not make callers learn `$unset` / `token_version` / `11000` as the domain language. Do **not** keep `toAdminExtensionUser` as a public **seam** after the test moves onto the four stories. Do **not** put these exports onto leftover `v1.service.ts` so “every admin write lives on the barrel.” Do **not** rename persisted `token_version` / `password_changed_at` / `roles`.

**No workflow class.** The one type that *does* earn a name is the desk card the owner already paints:

```ts
type ExtensionUserDeskCard = {
  id: string
  email: string
  roles: Array<"owner" | "sales" | "customer_service">
  active: boolean
  created_at: string
  last_login_at: string | null
}

type LoginCorrectionInProgress = {
  emailChanged: boolean
  passwordChanged: boolean
  rolesChanged: boolean
  nextEmail: string
  nextRoles: Array<"owner" | "sales" | "customer_service">
}
```

That is the handoff from “we folded the next email and the next roles set” to “kick every token only when one of those three actually moved.” Do **not** add `password` or `password_hash` onto `ExtensionUserDeskCard` so “admin can copy the secret.” Do **not** add a Bearer token onto `issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtension` so “create logs them in.”

Leave hash / email fold / leftover Employee dual-read on Wave B `auth/extension`. Leave Owner-actor on the route.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// extensionUsers.service.ts
// The owner needs Granot-extension logins.
// Issue one with an email, a password, and roles.
// Show every login, newest first.
// Leftover Employee still paints as Sales plus Customer Service.
// Correct email, password, or roles.
// If something actually changed, kick their tokens.
// A PATCH that restates the same email or the same roles set does not.
// Revoke one so that email can be issued again.
// Never return the secret.
// Never log them in.
// Never create an Agent.
// Never deactivate.
// Never store Employee.

// ── 1. Issue an Extension User login so they can open the Granot extension ──

export async function issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtension(input, deps)

function foldTheLoginEmail(email)                    // leftover normalizeEmail
function requireCurrentRolesOrRefuseEmployee(roles)  // leftover normalizeExtensionRoles; 400
async function refuseASecondLoginForThisEmail(email) // 409 before write
async function hideThePassword(password)             // leftover hashPassword
async function writeTheNewLogin(email, hash, roles)  // active true, token_version 0
function treatAMongoDuplicateAsTheSameConflict(error)

// ── 2. Show the owner every Extension User login, newest first ──

export async function showTheOwnerEveryExtensionUserLoginNewestFirst(deps)

function paintTheDeskCard(user)                      // leftover toAdmin leak today
function dualReadLeftoverEmployeeAsSalesPlusCustomerService(user)

// ── 3. Correct the login and kick their tokens when something actually changed ──

export async function correctTheLoginAndKickTheirTokensWhenSomethingActuallyChanged(id, patch, deps)

async function loadTheLoginOrSayItIsMissing(id)      // 404
function decideWhatActuallyChanged(user, patch)      // email / password / roles-set
function sameEmailAndSameRolesSetIsANoOp(decision)   // do not bump token_version
async function refuseATakenEmailOnSomeoneElse(id, email)
async function persistTheCorrectionAndInvalidateHeldTokens(id, decision)
function unsetLeftoverSingularRoleOnARealWrite()     // $unset role; $set roles[]

// ── 4. Revoke the login so the email can be issued again ──

export async function revokeTheLoginSoTheEmailCanBeIssuedAgain(id, deps)
  // hard-remove; 404 if missing; do not bump token_version

export function toAdminExtensionUser(user)           // leftover — unexport after tests move
```

Read the correct path out loud: *Load the login or say it is missing. Fold the next email. Fold the next roles or keep the dual-read set. A password string means the secret changed. If the folded email, the roles membership, and the password are all the same, hand back the desk card and leave every token alive. If the email moved, refuse a second login for that address. Hash a new password when they sent one. Write the next roles, clear leftover singular `role`, bump `token_version`, and stamp `password_changed_at` only when the secret changed.*

That is the operation. `updateExtensionUser` is not a different story. `toAdminExtensionUser` is not the **interface**.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Same-set roles PATCH on leftover Employee is a no-op and leaves singular `role`.** `resolveStoredExtensionRoles({ role: "employee" })` is already `["sales", "customer_service"]`. `PATCH { roles: ["sales", "customer_service"] }` therefore takes the no-op return and never `$unset`s `role`. An email or password change on that same row **does** `$set roles` and `$unset role`. Do **not** “fix” the no-op so every roles PATCH persists the conversion, and do **not** persist leftover Employee from list so “the desk write matches the paint.” The leftover persist is the migration.

2. **A real write always `$set`s `roles` and `$unset`s leftover `role`, even when only email or password moved.** That is leftover cleanup riding a credential change. Do not skip the `$set` when `rolesChanged` is false so “only the dirty field writes,” unless a later product path says leftover `role` must survive an email change.

3. **Issue and correct copy the duplicate-email 409.** One story, two **adapters** (POST vs PATCH). Shared beats: fold email, refuse a taken address, treat Mongo `11000` as the same message. Only “self id is allowed on correct” differs. Do not split them into `create.ts` / `updateEmail.ts`.

4. **`toAdminExtensionUser` is a test leak.** Runtime callers are issue / list / correct / the Mongo **adapter**. The dedicated leftover-employee paint test **asks** the helper, not `showTheOwnerEveryExtensionUserLoginNewestFirst`. Unexport it after the test names the four stories. Do not add a fifth HTTP route that accepts a raw Mongoose document.

5. **The service has no Owner gate.** `requireRegistryOwnerActor` sits on the route. Injected route deps can call these exports with no actor. Do not import leftover trusted-actor so “the service can refuse Admin,” and do not drop the route gate so “the service owns auth.”

6. **List has no `active` filter.** Knowledge says so. An `active: false` row (written only by leftover `upsert-extension-user.ts`) still paints. Do not default `{ active: true }` so “the desk hides deactivated logins,” and do not add deactivate / reactivate exports so “HTTP can flip `active`.”

7. **Revoke is hard-remove, not deactivate.** Delete does not bump `token_version`. The email may be issued again. Do not invent `deactivateThisLogin` so “CRUD can soft-delete,” and do not bump version on delete so “stale tokens fail closed” — the row is gone and leftover `getExtensionUserFromAccessToken` already misses it.

8. **There is no last-Owner refuse.** Revoking the only `owner` login is allowed. Do not add “keep one Owner” in this rename.

9. **No-op reconstructs the desk card with a fake `_id`.** It does not go back through the store. Dual-read leftover Employee still paints. Do not persist from that return path.

10. **Memory store does not stamp `password_changed_at`.** Mongo `update` does when `set_password_changed_at` is true. Today’s update test asserts `token_version` and the hash, not the timestamp. Lock `password_changed_at` on the Mongo **adapter** or on an integration proof — do not treat the memory bump as timestamp proof.

11. **Create always starts `token_version` at 0 and `active` at true.** The desk cannot issue an inactive login. Do not accept `active` on issue so “ops can pre-disable,” and do not start `token_version` at 1 so “create already invalidates.”

12. **Canonical persist order is `owner`, `sales`, `customer_service`.** Leftover `normalizeExtensionRoles` unique-sets, then filters that order. Create tests already lock `["customer_service", "sales"]` → `["sales", "customer_service"]`. Do not persist request order so “the array matches the form.”

13. **Zod empty password is omitted before this file.** Wave B preprocess turns `""` into `undefined`. The service treats any provided password string as a change. Do not add `if (password === "")` here so “the service matches Zod.”

14. **Leave login, role fold, and Owner-actor alone.** `hashPassword`, `normalizeEmail`, `getExtensionUserFromAccessToken`, and leftover `formatTariffActorRole` are Wave B. This file never mints a token. Wave B stays locked. Do not write a whole-folder recommendation for `auth/extension`.

15. **Do not treat Agent catalog, Admin Dashboard desks, or Tariff as this story.** Already-recommended catalog is Registry Agents / Merchants. `browseAdminResource` has no `extension-users` resource. `GET /api/v1/admin/extension-users` is this file, not `GET /api/v1/admin/{resource}`. Unlisted `tariff/` is the next Wave A row after `jobNumberTimeline`. Do not teach this file `database_scope`.

16. **Do not silently add login or Agent create.** Knowledge: this desk does not authenticate the Granot browser extension and does not create an Agent. Do not return `{ token }` from issue, and do not call leftover catalog create so “a Sales login is also an Agent.”

17. **The always-applied API host rule omits PATCH and DELETE.** The router and the knowledge file already have them. Do not drop those routes so “the host rule wins,” and do not edit that host-rule file in this rename.

## Testing

The **interface** is the test surface: `issueAnExtensionUserLoginSoTheyCanOpenTheGranotExtension`, `showTheOwnerEveryExtensionUserLoginNewestFirst`, `correctTheLoginAndKickTheirTokensWhenSomethingActuallyChanged`, `revokeTheLoginSoTheEmailCanBeIssuedAgain`. The desk card, 409 / 404, leftover Employee paint, no-op vs `token_version` bump, and email reuse after revoke are part of that **interface**.

Today’s `extensionUsers.service.test.ts` already names most of those beats against a memory store. It still treats leftover `toAdminExtensionUser` as a first-class export, and it never proves `password_changed_at` or “same-set roles on leftover Employee leaves `role`.” That is not enough for the leftover-cleanup story.

Replace the helper-as-interface test with tests that name the operation:

**Issue an Extension User login so they can open the Granot extension**
- `"  Rep@Vantage.com "` + `["customer_service", "sales"]` → email `"rep@vantage.com"`, roles `["sales", "customer_service"]`.
- Desk card has no `password`, no `password_hash`, no singular `role`.
- Taken email (any case) → 409 `"An Extension User already uses this email."` and no write.
- `employee` in `roles` → 400 `"Invalid request payload"`.
- Does not mint a token. Does not create an Agent.

**Show the owner every Extension User login, newest first**
- Leftover `{ role: "employee" }` paints `["sales", "customer_service"]` and does **not** persist `roles[]`.
- `"employee"` is not a value on the card.
- Inactive rows stay in. Do not “fix” list so the assertion can expect `{ active: true }`.
- Sort is `created_at` desc.

**Correct the login and kick their tokens when something actually changed**
- `roles: ["customer_service", "sales"]` on a row that already holds that set → same card, `token_version` unchanged.
- Same-set roles PATCH on leftover `{ role: "employee" }` stays a no-op and **leaves** singular `role`. Do not persist the conversion so the assertion can expect `$unset`.
- Folded same email (`"Rep@Vantage.com"`) does not bump.
- New email bumps `token_version` and writes the new address.
- New password bumps `token_version`, writes the hash, and (on Mongo) sets `password_changed_at`.
- New roles set (`["owner"]`) bumps `token_version` and `$unset`s leftover `role`.
- Taken email → 409 with the issue message.
- Missing id → 404 `"Extension User not found."`
- Invalid stored roles → 400 `"Extension User roles are invalid."`

**Revoke the login so the email can be issued again**
- Deleted id is gone; a later issue with that email succeeds.
- Missing id → 404 `"Extension User not found."`
- Does not bump `token_version`.
- Does not refuse the last Owner.

Do **not** add a test per helper (`foldTheLoginEmail`, `decideWhatActuallyChanged`, `sameEmailAndSameRolesSetIsANoOp`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover `normalizeExtensionRoles` / `hashPassword` / `requireRegistryOwnerActor` here. Do not add Zod unknown-key tests in the service file — that gap lives on the schema. Do not re-test `browseAdminResource`, leftover catalog Agents, or leftover `getExtensionUserFromAccessToken`.

## What I would not do

- An `ExtensionUserService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `ExtensionUser.find` or `create`.
- Moving this into a CRUD folder, or into `admin/` “because the owner desk lists things,” or into Wave B `auth/extension/` “because login reads the row.”
- Returning a Bearer token from issue so “create logs them in.”
- Teaching `adminBrowse.service.ts` an `extension-users` resource, or teaching this file `database_scope`.
- Inventing a before-commit / after-commit **seam**, a deactivate write, or a Sheet Sync / Agent-create job this desk does not have.
- Pulling `roles.ts` (leftover Employee dual-read) or leftover `getExtensionUserFromAccessToken` into this file.
- Persisting leftover Employee from list, or treating a same-set roles PATCH as leftover cleanup, without a separate product path.
- Dropping PATCH / DELETE so the always-applied API host rule “wins.”
- Writing a whole-folder recommendation for Wave B `auth/extension`, or opening `jobNumberTimeline` / `tariff` while this file was still unchecked.
