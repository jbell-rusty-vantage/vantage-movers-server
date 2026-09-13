# Remember The Extension User Login Row On The Default Mongo Connection, Unique-Index One Login Per Folded Email, And Index Active Without Uniqueness — Never Authenticate Here, Never Issue A Login Here, Never Hash The Password, Never Dual-Read Leftover Employee, Never Invent A Selected-Database Getter, Never Copy Booking AutoIndex-False Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 16 of this service — `ExtensionUser.ts`
- Remaining in this service: `Testimonial.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/ExtensionUser.ts`
- Knowledge: [`docs/knowledge/services/extension-users.md`](../../../docs/knowledge/services/extension-users.md) (Owner-only Admin Dashboard create, list, edit, and delete for Extension User email, password, and `roles[]`; leftover Employee dual-reads as Sales plus Customer Service; credential or roles-set change increments access-token `token_version`; unique email; Admin DTO never returns password or hash; **does not authenticate** the Granot browser extension; **does not create an Agent**; **does not deactivate**). Schema-and-CRUD rule still names leftover singular `role` as the persisted field — **this file holds both** current `roles[]` (`owner` | `sales` | `customer_service`) **and** leftover singular `role` (`owner` | `sales` | `customer_service` | leftover `employee`). Already-recommended Owner desk: [extension-users-extension-users.md](extension-users-extension-users.md) (`createExtensionUser` / `listExtensionUsers` / `updateExtensionUser` / `deleteExtensionUser` **ask** default `ExtensionUser` — **this file never issues**, never paints the desk card, never `$inc`s `token_version`). Already-recommended Owner HTTP: [routes-extension-users-admin.md](routes-extension-users-admin.md) (Owner gate is the route — **this file never 403s**). Already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (`authenticateExtensionUser` **asks** `{ email, active: true }` — **this file never verifies a password**). Distinct from leftover role fold: Wave B `src/auth/extension/roles.ts` (`CURRENT_EXTENSION_ROLES` / `resolveStoredExtensionRoles` leftover Employee → `["sales", "customer_service"]` — **this file re-exports** `EXTENSION_ROLES = CURRENT_EXTENSION_ROLES` for Zod; **it does not dual-read**). Distinct from leftover session: Wave B `src/auth/extension/session.ts` (`normalizeEmail` / `verifyPassword` / `issueTokens` / `getExtensionUserFromAccessToken` — **this file never mints a JWT**). Distinct from leftover password hash: Wave B `src/auth/extension/password.ts`. Distinct from leftover Agent row: already-recommended [models-agent.md](models-agent.md) (unique folded name — **not an email login**). Distinct from leftover next review: next `Testimonial.ts` (unique `{ source, content_fingerprint }` — **not an email**). Distinct from leftover prior carrier: already-recommended [models-moving-carrier.md](models-moving-carrier.md) (unique DOT / MC / Granot Carrier Code — **do not copy that unique here**). Distinct from historical relax: this checkout has **no** `historical/ExtensionUser.ts` — leftover historical-consolidation **does not** `validateSync` this collection. Distinct from leftover overview / leftover health / leftover Registry: those files **do not** count `extension_users`. Knowledge names `scripts/dev_ops/upsert-extension-user.ts` as the leftover `active` flip; **that script is absent in this checkout** — do not invent it. Operator `pnpm migration:extension-user-roles-array` **asks** default `ExtensionUser.find({})` then (only with `--apply`) `$set roles` / `$unset role` / `$inc token_version`. `pnpm migration:extension-user-roles-sales-backfill` **asks** the same default model. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Extension User](../../../../CONTEXT.md), [Owner](../../../../CONTEXT.md), [Sales](../../../../CONTEXT.md), [Customer Service](../../../../CONTEXT.md), [Employee](../../../../CONTEXT.md); this checkout does **not** define them — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus role-enum re-exports — there is no `getExtensionUserModel`.** Already-recommended `extensionUsers.service.ts` **asks** default `ExtensionUser` for `findOne({ email })` / `findById` / `create` / `findByIdAndUpdate` / `findByIdAndDelete` / `find()` newest `created_at`. Wave B `session.ts` **asks** `ExtensionUser.findOne({ email, active: true })` on login, `findOne({ _id, active: true })` on refresh, and the same `_id` + `active: true` lookup inside leftover `getExtensionUserFromAccessToken`. Wave B `extensionUsers.validation.ts` **asks** leftover `EXTENSION_ROLES` for Zod `roles[]` — **not** leftover `CURRENT_EXTENSION_ROLES` from `roles.ts`. Operator `scripts/migrations/extension-user-roles-array.ts` and `extension-user-roles-sales-backfill.ts` **ask** default `ExtensionUser.find({})` / `updateOne({ email })`. Tests on the desk **interface**: `extensionUsers.service.test.ts` injects a memory store and never hits this model. `session.test.ts` injects leftover `getExtensionUserFromAccessToken` lookup and never hits this model. Route tests stub the four desk exports and leftover Bearer lookup. There is no `ExtensionUser.test.ts`. Nobody leftover-inspects leftover `ExtensionUser.schema.indexes()`. Leftover overview / leftover health / leftover historical-consolidation / leftover Registry / leftover `adminBrowse.service.ts` **do not** import this file. `LEGACY_EXTENSION_ROLES` and `STORED_EXTENSION_ROLES` have **no** runtime import site outside this file. Not this **interface**: `createExtensionUser` itself, `authenticateExtensionUser` itself, leftover `hashPassword` / leftover `resolveStoredExtensionRoles` / leftover `getExtensionUserFromAccessToken` itself, leftover `classifyExtensionUserRolesArray` itself.
- Seams callers need: default `ExtensionUser` (first-registered connection — Owner desk write / login active-email find / refresh active-id find / token active-id find / migration load / migration `--apply` stamp) vs already-recommended Merchant / Moving Carrier same default-export pattern vs already-recommended evidence `getCplLeadCorrectionModel` (**no default export**) vs Form selected-database getter; unique `{ email: 1 }` vs desk pre-check plus Mongo `11000` `"An Extension User already uses this email."`; schema `lowercase` + `trim` on `email` **when that path is set** vs leftover `normalizeEmail` (trim + lowercase, **no** extra fold); `roles[]` enum `EXTENSION_ROLES` (current only — **cannot** store leftover `employee`) vs leftover singular `role` enum `STORED_EXTENSION_ROLES` (includes leftover `employee`); login / refresh / token find `{ active: true }` vs Owner list **no** `active` filter; `pre("save")` stamps `updated_at` vs Owner `findByIdAndUpdate` that `$set`s `updated_at` itself (the hook does **not** run) vs migration `updateOne` that **does not** touch `updated_at`; `token_version` default `0` vs desk / migration `$inc` (this file never increments); `versionKey: false` vs Form `__v` unused lifecycle; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no login **seam**. There is no hash **seam**. There is no leftover-Employee dual-read **seam**. There is no selected-database getter **seam**. There is no deactivate **seam**. There is no Agent-create **seam**.
- Split later (only if the file outgrows one sitting): this ~50-line file is one sitting if you read it as remember the Extension User login row on the default Mongo connection, unique-index one login per folded email, and index active without uniqueness — never authenticate here, never issue a login here, never hash the password, never dual-read leftover Employee, never invent a selected-database getter, never copy Booking autoIndex-false without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `roles.ts` / `email.ts` / `token.ts`. Owner desk write stays `extensionUsers.service.ts`. Login / token verify stay Wave B `session.ts`. Leftover Employee dual-read stays Wave B `roles.ts`. Zod stays Wave B `extensionUsers.validation.ts`. Migration `--apply` stays the scripts. Next review stays `Testimonial.ts`.

`ExtensionUser` is a Mongoose model name. The owner question is: *Owner just issued this Granot-extension login — or this person is about to sign in. Hold the row on `extension_users`. Keep folded email unique so a second login 409s. Store the hash, not the password. Keep leftover singular `role` readable so a leftover Employee row still signs in as Sales plus Customer Service. Index `active` so login can hide a deactivated row without uniqueness. Today’s live callers still use the default connection — do not invent a getter in this rename. Do not verify a password. Do not mint a token. Do not issue the desk card. Do not dual-read leftover Employee. Do not `$inc` `token_version`. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who issue / list / correct / revoke already lives in already-recommended `extensionUsers.service.ts`. Who authenticate / refresh / match `{ sub, email, roles, token_version }` already lives in Wave B `session.ts`. Who leftover Employee → Sales plus Customer Service already lives in Wave B `roles.ts`. Who convert leftover `role` → `roles[]` already lives on `pnpm migration:extension-user-roles-array`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Extension User login row, unique-index one login per folded email, and index active without uniqueness” story, not “an Extension User model CRUD dump,” and not Issue A Login / Authenticate This Person / Dual-Read Leftover Employee themselves:

1. **Hold the Extension User as the Granot-extension login row** — collection `extension_users`, `versionKey: false`, **no** mongoose `timestamps: true` (manual `created_at` / `updated_at`). **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** inverse Agent / Lead virtuals. Declares required `email` (trim, schema `lowercase`), required `password_hash` (no min length here), optional `roles[]` whose items enum `EXTENSION_ROLES` (`owner` | `sales` | `customer_service` — **not** leftover `employee`), optional leftover singular `role` whose enum `STORED_EXTENSION_ROLES` includes leftover `employee`, required `active` (default `true`, indexed), required `token_version` (default `0`), required `created_at` / `updated_at` (default `Date.now`), optional `last_login_at`, required `password_changed_at` (default `Date.now`). `pre("save")` stamps `updated_at` to now. This beat does **not** invent `roles[]` from leftover `role`. This beat does **not** refuse leftover `employee` on the singular path. This beat does **not** hash a password. This beat does **not** mint `{ sub, email, roles, token_version }`. A second folded email still `11000`s.

2. **Keep one login per folded email — and index active without uniqueness** — unique `{ email: 1 }`. Non-unique `{ active: 1 }`. Neither compound is named. There is no unique `{ token_version }`. There is no unique `{ roles }`. There is no partial unique. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Login / refresh / token lookup leftover-find `{ active: true }`. Owner list leftover-finds every row. Owner desk never `$set`s `active`. This beat does **not** deactivate. This beat does **not** `$inc` `token_version`.

3. **Bind the default Mongo connection — and re-export the current-role tuple Zod already imports** — default export `ExtensionUser` is `mongoose.models.ExtensionUser ?? mongoose.model(...)`. There is **no** `getExtensionUserModel`. There is **no** `getMongoDatabaseName()`. There is **no** `useDb`. Owner desk write / login active-email find / refresh active-id find / token active-id find / migration load / migration `--apply` stamp **ask** the default export. `EXTENSION_ROLES` is a one-line alias of leftover `CURRENT_EXTENSION_ROLES`. `LEGACY_EXTENSION_ROLES` is `["employee"]`. `STORED_EXTENSION_ROLES` is current plus leftover Employee — used only to type leftover singular `role`. `ExtensionRole` is leftover `CurrentExtensionRole`. This beat does **not** open `vantagemovershistorical`. This beat does **not** dual-read leftover Employee. This beat does **not** invent `getExtensionUserModel` so “login matches Form.” This beat does **not** delete the default export so “login matches evidence.”

`ExtensionUserDocument` is the inferred row type. There is no status enum export. There is no named-index export.

There is no issue-this-login operation. `createExtensionUser` elects that. There is no authenticate-this-person operation. `authenticateExtensionUser` elects that. There is no leftover-Employee dual-read operation. `resolveStoredExtensionRoles` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Extension User login row on the default Mongo connection, unique-index one login per folded email, and index active without uniqueness — never authenticate here, never issue a login here, never hash the password, never dual-read leftover Employee, never invent a selected-database getter, never copy Booking autoIndex-false without a migration.” Owner desk write / login / leftover Employee dual-read / Zod / migration `--apply` already live in deeper **modules**. Do not pull those in. Do not invent an `ExtensionUserModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getExtensionUserModel` **adapter** so “login matches Form” without a paired proof that Owner desk write, login active-email find, refresh active-id find, token active-id find, and both migrations still read the same `extension_users`. Do not invent an `autoIndex: false` **adapter** so “login matches Booking” without a reviewed index migration. Do not invent a unique `{ token_version: 1 }` **adapter** so “one version owns the row.” Do not invent a `pre("validate")` that stamps `roles[]` from leftover `role` so “hand insert matches the migration.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `email.ts` / `roles.ts` / `token.ts` each get a file.

Do not move leftover `CURRENT_EXTENSION_ROLES` into this file so “the row owns the tuple.” Do not move leftover `resolveStoredExtensionRoles` into this file so “the row dual-reads Employee.” Do not merge this file into already-recommended `Agent.ts` so “one unique folded name owns logins and receivers.” Do not merge this file into next `Testimonial.ts` so “one default catalog owns reviews and logins.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ExtensionUser` | `extensionUserOnTheDefaultConnection` | Owner desk write, login active-email find, refresh / token active-id find, and both migrations still import the default model |
| `ExtensionUserDocument` | `ExtensionUserRow` | inferred document + `_id` |
| `EXTENSION_ROLES` | `currentExtensionRolesAlias` | Wave B Zod `roles[]` already imports this name, not leftover `CURRENT_EXTENSION_ROLES` |
| `LEGACY_EXTENSION_ROLES` | `leftoverEmployeeOnly` | leftover singular `role` enum includes `employee` |
| `STORED_EXTENSION_ROLES` | `leftoverSingularRoleEnum` | current plus leftover Employee — schema `role` only |
| `ExtensionRole` | leftover current-role alias | same as Wave B `CurrentExtensionRole` |

Keep the old names as one-line aliases until `extensionUsers.service.ts`, `session.ts`, `extensionUsers.validation.ts`, and both migration scripts migrate. Do not make callers learn `email` / `token_version` as the only language. Do **not** add `getExtensionUserModel` so “every aggregate has a getter” — live writes already share one default **adapter**. Do **not** delete the default `ExtensionUser` export so “everyone must call a getter that does not exist.” Do **not** unexport `EXTENSION_ROLES` so “Zod should import `roles.ts`” in this models pass — Wave B `validation/` is still locked. Do **not** export a named unique-email catalog that this schema does not name. Do **not** keep `LEGACY_EXTENSION_ROLES` / `STORED_EXTENSION_ROLES` as a public **seam** after the schema can name the leftover singular enum inline — they have no other runtime import site.

**No class for the workflow.** The one type that *does* earn a name is the pending login-identity contract:

```ts
type ExtensionUserLoginIdentity = {
  email: { unique: true; lowercase: true; trim: true }
  roles: Array<"owner" | "sales" | "customer_service">
  leftover_role?: "owner" | "sales" | "customer_service" | "employee"
  token_version: number
  active: { unique: false; indexed: true }
}
```

That is the handoff from “this process remembered a Granot-extension login” to “a second folded email 11000s, leftover Employee still sits on singular `role`, and `active` stays a login filter without uniqueness.” Do **not** add leftover `employee` onto `roles` so “the array can store what the singular field stores.” Do **not** drop leftover `leftover_role` so “schema matches knowledge `roles[]`” without a paired proof leftover Employee rows still sign in. Do **not** add `{ token_version: { unique: true } }` so “one version owns the login.”

Leave already-recommended `MovingCarrier.ts` on that file. Leave next `Testimonial.ts` on that file. Leave Owner desk write on `extensionUsers.service.ts`. Leave authenticate on `session.ts`. Leave leftover Employee dual-read on `roles.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ExtensionUser.ts
// Owner just issued this Granot-extension login
// — or this person is about to sign in.
// Hold the row on extension_users.
// Keep folded email unique so a second login 409s.
// Store the hash, not the password.
// Keep leftover singular role readable
// so a leftover Employee row still signs in
// as Sales plus Customer Service.
// Index active so login can hide a deactivated row
// without uniqueness.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not verify a password.
// Do not mint a token.
// Do not issue the desk card.
// Do not dual-read leftover Employee.
// Do not increment token_version.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const extensionUserOnTheDefaultConnection =
  mongoose.models.ExtensionUser ?? mongoose.model("ExtensionUser", extensionUserSchema)

export { extensionUserOnTheDefaultConnection as ExtensionUser }
export { CURRENT_EXTENSION_ROLES as EXTENSION_ROLES }

// ── 1. Hold the Extension User as the Granot-extension login row ─

const extensionUserSchema = rememberTheExtensionUserLoginRow() // collection extension_users; versionKey false; default autoIndex

function rememberTheExtensionUserLoginRow() {
  const schema = new Schema(
    {
      email: requiredFoldedEmailUnique(),           // trim + lowercase when set
      password_hash: requiredHashWithNoMinHere(),   // hash lives on leftover hashPassword
      roles: optionalCurrentRolesArray(),           // items enum owner / sales / customer_service — not employee
      role: optionalLeftoverSingularRole(),         // enum includes leftover employee
      active: requiredActiveDefaultTrueIndexed(),
      token_version: requiredTokenVersionDefaultZero(),
      created_at: requiredNow(),
      updated_at: requiredNow(),                    // pre("save") restamps; findByIdAndUpdate does not run that hook
      last_login_at: optionalLastLogin(),
      password_changed_at: requiredNow(),
    },
    { collection: "extension_users", versionKey: false },
  )
  stampUpdatedAtOnDocumentSave(schema)
  keepOneLoginPerFoldedEmailAndIndexActiveWithoutUniqueness(schema)
  return schema
}

function stampUpdatedAtOnDocumentSave(schema) {
  // today's pre("save") — login user.save() after last_login_at hits this
  // Owner findByIdAndUpdate $sets updated_at itself
  // migration updateOne does not touch updated_at
}

// ── 2. One login per folded email ─────────────────────────

function keepOneLoginPerFoldedEmailAndIndexActiveWithoutUniqueness(schema) {
  // today's unique { email: 1 }
  // today's non-unique { active: 1 }
  // neither named
}

// ── 3. Default Mongo connection ───────────────────────────

// extensionUserOnTheDefaultConnection above
```

Read the primary path out loud: *hold the Extension User on `extension_users` with a required folded email, a required password hash, optional current `roles[]`, leftover singular `role` that may still say Employee, `token_version` default 0, and `active` default true. Do not invent `roles[]` from leftover `role` on validate. Keep folded email unique so a second login 409s. Index `active` so login can hide a deactivated row without uniqueness. Login find does hide an inactive row. Owner list does not. If this process already sits on the first-registered connection, that is the model Owner desk write, login, and both migrations already import. Do not verify a password here. Do not issue the desk card. Do not dual-read leftover Employee. Do not invent a getter.*

That is the operation. An unnamed schema dump is not. `createExtensionUser` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The schema unique-indexes folded email. Desk also pre-checks then maps `11000`.** Schema `lowercase` + `trim` fold the path when a caller set it. Leftover `normalizeEmail` does the same trim + lowercase and nothing else. Owner create leftover-folds before `findOne({ email })` and again if Mongo `11000`s. Login leftover-folds then leftover-finds `{ email, active: true }`. Do not drop the unique so “the service pre-check is enough.” Do not add a second unique on leftover raw casing so “hand insert `Pat@` and desk `pat@` can coexist.” Do not teach this file to call leftover `normalizeEmail` so “the row owns the fold.”

2. **`roles[]` cannot store leftover Employee. Singular `role` can.** Items enum is leftover `EXTENSION_ROLES`. Leftover `role` enum is leftover `STORED_EXTENSION_ROLES`. Knowledge says writes never store `employee` on `roles[]`. Leftover `resolveStoredExtensionRoles` reads `roles[]` first when the array has length, else leftover `employee` → `["sales", "customer_service"]`, else leftover current singular. An empty `roles: []` falls through to leftover `role` — that is today’s contract, not a missing required array. Do not add leftover `employee` onto `roles[]` so “the array can store what the singular field stores.” Do not drop leftover `role` so “schema matches knowledge `roles[]`” without a paired proof leftover Employee rows still sign in. Do not add `pre("validate")` `stampRolesFromLeftoverRole` so “hand insert matches the migration” — a silent stamp would kick tokens the next time login leftover-reads `roles[]` and the migration’s `$inc` never ran.

3. **Login filters `active`. Owner list does not.** `authenticateExtensionUser` / `refreshExtensionSession` / leftover `mongoAccessTokenLookup` leftover-find `{ active: true }`. Owner `listExtensionUsers` leftover-finds every row. Owner desk never `$set`s `active`. Knowledge names leftover `upsert-extension-user.ts` as the `active` flip; **that script is absent in this checkout**. Do not add `{ active: true }` onto Owner list from this rename so “the desk hides deactivated logins.” That list lives on already-recommended `extensionUsers.service.ts`. Do not invent a deactivate path on this file so “CRUD can soft-delete.”

4. **`pre("save")` and `findByIdAndUpdate` disagree on who stamps `updated_at`.** Login `user.save()` after `last_login_at` hits the hook. Owner create uses `ExtensionUser.create` (a save) **and** also sets `updated_at`. Owner correct leftover-`$set`s `updated_at` because the hook does not run. Migration `updateOne` leftover-`$set`s `roles` / leftover-`$unset`s `role` / leftover-`$inc`s `token_version` and **does not** touch `updated_at`. Do not delete the hook so “every writer already `$set`s.” Do not teach `findByIdAndUpdate` to run the hook from this file so “Owner correct matches login.” Do not add `updated_at` onto the migration from this rename so “apply matches the hook.”

5. **There is no selected-database getter — and that is today’s contract, not a missing Form copy and not a missing evidence copy.** Owner desk write, login, refresh, token lookup, and both migrations **ask** default `ExtensionUser`. Already-recommended evidence **asks** `getCplLeadCorrectionModel` with **no** default export. Already-recommended Merchant / Moving Carrier **ask** the default export and have no getter. Do not invent `getExtensionUserModel` so “login matches Form.” Do not delete the default `ExtensionUser` export so “login matches evidence.”

6. **`EXTENSION_ROLES` is a pass-through of leftover `CURRENT_EXTENSION_ROLES`.** Wave B Zod leftover-imports the alias from this file. Wave B `roles.ts` is the tuple source. `LEGACY_EXTENSION_ROLES` / `STORED_EXTENSION_ROLES` have no other runtime import site. Do not move the tuple into this file so “the row owns current roles.” Do not unexport `EXTENSION_ROLES` in this models pass so “Zod should import `roles.ts`” — Wave B `validation/` is still locked. Do not export leftover `resolveStoredExtensionRoles` from this file so “the model dual-reads Employee.”

7. **`token_version` is a number this file defaults to 0. Increment lives elsewhere.** Owner correct leftover-`$inc`s only on a real email / password / roles-set change. Migration `--apply` leftover-`$inc`s only on converted rows. Delete does not bump — the row is gone. This file never increments. Do not unique-index `token_version` so “one version owns the login.” Do not add `pre("save")` `$inc` so “every save kicks tokens” — login `save()` after `last_login_at` would kick the session it just minted.

8. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. These indexes are not named. Do not silently set `autoIndex: false` so “login matches Booking” without a paired report that boot still creates the unique email **or** that a migration will. Do not invent `pnpm migration:extension-user-indexes` in this rename.

9. **Overview does not count this collection — historical-consolidation does not validate it.** Already-recommended Merchant is the opposite (overview counts / historical validates). Do not add overview counts so “login matches Merchant.” Do not invent `historical/ExtensionUser.ts` so “every login row has a historical relax.” Do not teach leftover Registry catalog or leftover `adminBrowse` this collection so “one desk owns payees and logins.” Do not create an Agent from this file so “the login is a receiver.”

10. **Schema-and-CRUD still describes leftover singular `role` as the persisted field.** Knowledge and Owner desk persist `roles[]` and `$unset` leftover `role` on a real write. This file holds both. Do not drop leftover `role` so “the rule wins,” and do not edit that rule in the rename. See CONTRADICTIONS.

11. **Leave sibling modules alone.** Owner desk write, login / token verify, leftover Employee dual-read, Zod, both migrations, already-recommended Moving Carrier unique DOT / MC / code, next `Testimonial.ts`, and already-recommended Form / Call / Booking are already the right **depth**. This file holds the Extension User login row. `createExtensionUser` / `authenticateExtensionUser` / `resolveStoredExtensionRoles` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `ExtensionUser` validate, the unique folded-email index, the non-unique active index, the current-only `roles[]` enum, the leftover singular `role` enum.

There is no `ExtensionUser.test.ts`. Today’s proofs sit on callers. `extensionUsers.service.test.ts` already names unique email, leftover Employee paint, and `token_version` increment through a memory store. `session.test.ts` already names leftover `{ sub, email, roles, token_version }` match through an injected lookup. Route tests stub the four desk exports and leftover Bearer lookup. `extension-user-roles-array.lib.test.ts` already names leftover `role` → `roles[]` without this model. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Extension User requires `email` and `password_hash`.
- Validate folds `" Pat@X.COM "` to `"pat@x.com"` on `email` and does **not** invent `roles[]` from leftover `role`.
- `roles[]` items refuse leftover `"employee"`.
- Leftover singular `role` accepts leftover `"employee"`.
- Empty `roles: []` is allowed.
- `password_hash` has no min length on this schema.
- `token_version` defaults to `0`.
- `active` defaults to `true`.
- `password_changed_at` defaults to now.
- There is no Agent / Lead virtual.
- There is no `getExtensionUserModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.
- `schema.options.versionKey` is `false`.
- `pre("save")` stamps `updated_at`.

**Login identity uniques**
- `email` is unique.
- `active` is indexed and **not** unique.
- There is no unique `{ token_version: 1 }`.
- There is no unique `{ roles: 1 }`.
- Neither index is named.
- There is no named unique-email catalog export.

**Default connection and role aliases**
- `ExtensionUser` remains exported as the default model.
- The getter `getExtensionUserModel` does not exist.
- The default export is `mongoose.models.ExtensionUser ?? mongoose.model(...)`.
- The default export does not call `getMongoDatabaseName()` or `useDb`.
- `EXTENSION_ROLES` stays the current-role tuple Zod already imports.

Do **not** add a test per helper (`requiredFoldedEmailUnique`, `keepOneLoginPerFoldedEmailAndIndexActiveWithoutUniqueness`). Those names exist so the parent reads. Do **not** issue an Extension User from this file’s tests. Do **not** authenticate from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique index.”

There is no named index export to keep for a second migration **adapter**.

## What I would not do

- An `ExtensionUserModelService` / `ExtensionUserService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `email.ts` / `roles.ts` / `token.ts` split for cleanliness.
- Inventing leftover `employee` on `roles[]` so “the array can store what the singular field stores.”
- Dropping leftover singular `role` so “schema matches knowledge `roles[]`” without a paired proof leftover Employee rows still sign in.
- Breaking the default-connection **seam** by inventing `getExtensionUserModel` without a paired proof. Today’s Owner desk write and login already use the default, not a getter.
- Deleting the default `ExtensionUser` export so “login matches evidence” without a paired proof that Owner desk write still asks the default model.
- Treating `createExtensionUser` / `updateExtensionUser` / `deleteExtensionUser` as this story. Those functions own the desk write and the 409 / `token_version` mapping.
- Treating `authenticateExtensionUser` / `getExtensionUserFromAccessToken` as this story. Those functions verify the password and the token.
- Treating leftover `resolveStoredExtensionRoles` as this story. That function leftover Employee → Sales plus Customer Service.
- Treating `pnpm migration:extension-user-roles-array` as this story. That script owns the leftover `role` → `roles[]` persist and the `--apply` `$inc`.
- Treating already-recommended `MovingCarrier.ts` as this story. That unique is DOT / MC / Granot Carrier Code.
- Treating next `Testimonial.ts` as this story. That unique is `{ source, content_fingerprint }`.
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database find **adapter** that has only one live home.
- Silently stamping `roles[]` from leftover `role` on validate so “hand insert matches the migration.”
- Silently adding `{ active: true }` onto Owner list so “the desk hides deactivated logins.”
- Silently `$inc`ing `token_version` on `pre("save")` so “every save kicks tokens.”
- Silently “fixing” leftover schema-and-crud singular `role` while recommending a rename. Do not edit that rule in this pass.
- Inventing `scripts/dev_ops/upsert-extension-user.ts` so “knowledge has a home.” That script is absent in this checkout.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
