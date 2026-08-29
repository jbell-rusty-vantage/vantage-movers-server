# Refuse This Drive Admin Call Unless The Caller Is The Signed Configured Drive Owner — Scoped Keys And Missing Auth Fail Closed, A Registry Owner Whose Email Is Not The Configured Owner Fails Closed, Stop The HTTP Request With The Canned 403 Or The Registry Body — Never Gate The Unguarded Callback, Never Talk To Google, Never Compare The Connected Google Email — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 5 of this service — `ownerAuth.ts`
- Remaining in this service: `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` already recommended)
- Target: `src/services/googleDriveOAuth/ownerAuth.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this HTTP gate; leftover reporting adapters **ask** already-recommended `googleDriveOAuth.service.ts` for a live client after Wave B routes already passed this file). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — it checks the **Google** verified email against `config.ownerEmail` on complete; this file checks the **signed admin** email; the unguarded callback is **not** this file). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — that file binds ciphertext to the same configured email; it has **no** HTTP). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md) (fold + exact-set refuse — this file never looks at scopes). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (canned 403 + JSON sanitize + callback log — this file **asks** the canned 403 and the JSON sanitizer; it does **not** own the category table). Distinct from later Picker / folder / metadata / managed-tab (Wave B puts this middleware **in front** of those routes; they do **not** import this file). Distinct from leftover `operationsRegistry/trustedActor.ts` `requireRegistryOwnerActor` (HMAC Owner / Admin role / replay window — this file **asks** that **adapter** then adds the Drive-owner-email check; it does **not** verify HMAC). Distinct from Wave B `routes/google-drive-oauth.routes.ts` (authorize / status / Picker / folder / disconnect / test-spreadsheet mount this middleware after `requireApiSecret`; **unguarded** callback does **not**). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (env-var **names**, `ownerEmail` already `trim().toLowerCase()` — this file **asks** `getGoogleDriveOAuthConfig().ownerEmail`). Distinct from Wave B `middleware/requireApiSecret` (`secret` / `scoped_key` / `user` — this file **refuses** `scoped_key` and missing `vantageAuth` before registry). Distinct from skipped barrel `index.ts` (re-exports `enforceGoogleDriveOwnerAccess` / `requireGoogleDriveOwnerActor`; does **not** re-export the typed error). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md). This checkout’s `CONTEXT.md` does not define a Drive OAuth / signed-Drive-owner-gate term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **one runtime import site plus the barrel. Tests live on this file.** Wave B `routes/google-drive-oauth.routes.ts` — `POST .../oauth/authorize`, `GET .../status`, `POST .../picker/bootstrap`, `POST .../picker/selections/verify`, `POST .../folders`, `DELETE .../connection`, `POST .../test-spreadsheet` all mount `enforceGoogleDriveOwnerAccess` after `requireApiSecret`. Unguarded `GET .../oauth/callback` does **not**. Nobody calls `requireGoogleDriveOwnerActor` outside this file and its tests — `enforce` asks it and **discards** the returned actor. Barrel `index.ts` re-exports `enforceGoogleDriveOwnerAccess` / `requireGoogleDriveOwnerActor` (not `GoogleDriveOwnerAccessRequiredError`). Tests: `ownerAuth.test.ts` locks `secret` + signed owner proxy → `actorLabel` is the configured email; `user` + signed owner proxy → same; `scoped_key` + signed headers still throws `GoogleDriveOwnerAccessRequiredError`. The same file also hosts already-recommended sanitizer tests (UnauthorizedError 403 without `owner@example.com` / callback log) — those belong on already-recommended `oauthSecurity.ts`, not this **interface**. Not this **interface**: already-recommended begin / complete / status / client / health (they never import this file), already-recommended AES lock, already-recommended fold / refuse, already-recommended canned 403 / JSON sanitize, later Picker bootstrap, leftover reporting adapters, leftover HMAC verify, Wave B `requireApiSecret`.
- Seams callers need: decision (return actor / throw typed miss) vs HTTP stop (middleware writes the 403 and does not `next`); this file’s typed miss (scoped key / missing auth / email mismatch) vs leftover registry HMAC / role miss (registry HTTP body, not the canned 403); signed registry Owner vs configured Drive owner email (this file’s extra check); HTTP signed admin email vs already-recommended complete’s Google email
- Split later (only if the file outgrows one sitting): this ~57-line file is one sitting if you read it as refuse this Drive admin call unless the caller is the signed configured Drive Owner, scoped keys and missing auth fail closed, a registry Owner whose email is not the configured owner fails closed, stop the HTTP request with the canned 403 or the registry body, never gate the unguarded callback, never talk to Google, never compare the connected Google email. If it later splits: `refuseUnlessThisRequestIsTheSignedConfiguredDriveOwner.ts` / `stopTheDriveAdminCallUnlessTheSignedConfiguredOwner.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `auth.ts` / `middleware.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, already-recommended `oauthSecurity.ts`, later Picker, leftover `trustedActor.ts`, or Wave B routes into this file

`requireGoogleDriveOwnerActor` / `enforceGoogleDriveOwnerAccess` are executor mechanics. The owner question is: *Someone just hit an owner-gated Drive admin route. This process may only continue if the caller is the signed Owner whose email is exactly the configured Drive owner. A scoped API key fails even when the HMAC headers are perfect. Missing `vantageAuth` fails. Leftover registry then proves the HMAC Owner (or throws its own signature / role error). After that, a signed Owner whose `actorLabel` is not `GOOGLE_OAUTH_OWNER_EMAIL` still fails. Stop the HTTP request with the canned 403, or with the leftover registry body, or with already-recommended JSON sanitize for anything else. The unguarded Google callback is a different person — Google’s verified email is the auth there. Do not persist. Do not talk to Google. Do not fold scopes. Do not compare `connection.google_email`. Do not invent the company service account.*

Already-recommended Owner login, already-recommended token lock, already-recommended grant allowlist, already-recommended public failure, later Picker / folder / metadata / managed-tab, leftover HMAC verify, leftover reporting adapters, and Wave B `requireApiSecret` already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “refuse this Drive admin call unless the caller is the signed configured Drive Owner — scoped keys and missing auth fail closed, a registry Owner whose email is not the configured owner fails closed, stop the HTTP request with the canned 403 or the registry body — never gate the unguarded callback, never talk to Google, never compare the connected Google email” story, not “an auth CRUD helper,” and not the Owner login / the public 403 table / leftover HMAC verify:

1. **Refuse unless this request is the signed configured Drive Owner** — `requireGoogleDriveOwnerActor(req)`. Read `req.vantageAuth`. Missing, or `kind === "scoped_key"` → throw `GoogleDriveOwnerAccessRequiredError`. `kind === "secret"` and `kind === "user"` both continue. Ask leftover `requireRegistryOwnerActor(req, auth)` (`requireOwner: true` — HMAC Owner, not Admin, not unsigned preview, not extension-Bearer catalog mutation). Then `getGoogleDriveOAuthConfig().ownerEmail` (already `trim().toLowerCase()`). `actor.actorLabel !==` that email → throw the same typed error. Else return the leftover `RegistryActorContext`. This beat does not write HTTP. This beat does not persist. This beat does not talk to Google. This beat does not look at `connection.google_email`. Today only `enforce` and the tests ask this **seam**; `enforce` discards the actor.

2. **Stop the Drive admin HTTP call when they are not** — `enforceGoogleDriveOwnerAccess(req, res, next)`. Try operation 1. Typed miss → already-recommended `googleDriveOwnerAccessRequiredResponse()` (403 + `owner_access_required` + “Signed owner dashboard access is required.”). Leftover `RegistryError` → `error.toHttpBody()` at `error.statusCode` (`registry_code`, optional `remediation` — not the canned code). Anything else → already-recommended `sanitizeGoogleDriveApiError` (missing Drive env from `getGoogleDriveOAuthConfig` is a raw `Error` → 500 `google_drive_unavailable`). Happy path → `next()`. This beat does not attach the actor to `req`. Wave B mounts this **adapter** on the seven owner-gated Drive routes.

There is no persist operation. There is no Google-email operation. There is no HMAC-verify operation. There is no public-category-table operation. Already-recommended complete’s Google identity check, leftover `verifySignedActor`, and already-recommended canned 403 already live in other files.

`GoogleDriveOwnerAccessRequiredError` is the typed miss those two operations share, not a third owner operation. Its message is the canned sentence; already-recommended sanitizer never `instanceof` this class — only operation 2 does.

## Organization

Keep one file as the screenplay for “refuse this Drive admin call unless the caller is the signed configured Drive Owner — scoped keys and missing auth fail closed, a registry Owner whose email is not the configured owner fails closed, stop the HTTP request with the canned 403 or the registry body — never gate the unguarded callback, never talk to Google, never compare the connected Google email.” Already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, already-recommended `oauthSecurity.ts`, later Picker / folder / metadata / managed-tab, leftover `trustedActor.ts`, leftover reporting adapters, and Wave B `requireApiSecret` already live in deeper **modules**. Do not pull those in. Do not invent an `OwnerAuthService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent an HMAC **adapter** beside leftover `requireRegistryOwnerActor`. Do not invent a Google-email **adapter** beside already-recommended complete. Do not invent a public-category **adapter** beside already-recommended `sanitizeGoogleDriveApiError`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `auth.ts` / `middleware.ts`. Those are HTTP verbs / framework nouns, not the owner story. Do not move this into `oauthSecurity.ts` so “the 403 file can also decide who.” Do not move this into leftover `trustedActor.ts` so “registry Owner is enough.” Do not move this into already-recommended `googleDriveOAuth.service.ts` so “the login can also gate HTTP.” Do not move this onto the unguarded callback so “every Drive route is owner-gated.” Do not silently let a scoped key through when HMAC is valid so “integrations can reconnect Drive.”

**External interface** stays small (this is the test surface). Decision and HTTP stop are one story’s signed Drive-owner gate, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `requireGoogleDriveOwnerActor` | `refuseUnlessThisRequestIsTheSignedConfiguredDriveOwner` | tests and any later non-HTTP caller need the actor / typed throw without writing `res` |
| `enforceGoogleDriveOwnerAccess` | `stopTheDriveAdminCallUnlessTheSignedConfiguredOwner` | Wave B routes need Express `next` vs written 403 / registry body / sanitized JSON |
| `GoogleDriveOwnerAccessRequiredError` | `ThisCallerIsNotTheSignedConfiguredDriveOwner` | tests lock `scoped_key`; operation 2 `instanceof` this class before leftover registry / sanitize |

Keep the old names as one-line aliases until Wave B routes and the tests migrate. Do not make callers learn `vantageAuth.kind` / `actorLabel` / `requireRegistryOwnerActor` as the domain language.

**Principle: old exports stay as aliases.** `enforceGoogleDriveOwnerAccess` remains the imported name until Wave B authorize points at the story name. `requireGoogleDriveOwnerActor` remains the imported name until the tests migrate.

**No class for the workflow.** The type that *does* earn a name is the leftover actor this file hands back after the Drive-owner-email check:

```ts
type SignedConfiguredDriveOwner = {
  actorType: "owner"
  actorId: string
  actorLabel: string // already normalizeAdminEmail; must equal config.ownerEmail
  actorRole: "owner"
  requestId: string
}
```

That is the handoff from “leftover registry proved an HMAC Owner” to “this process may continue this Drive admin call.” Do **not** add `kind: "scoped_key"` onto this type so “integrations can reconnect,” do **not** add `google_email` so “the connected Google account is the person,” and do **not** store this bag on `req` in this rename — `enforce` discards it.

The typed error stays a class because operation 2 `instanceof` it. Do not add `requireRegistryOwnerActor` as a public **seam** on this file — leftover `trustedActor.ts` already owns HMAC. Do not add `googleDriveOwnerAccessRequiredResponse` as a public **seam** on this file — already-recommended `oauthSecurity.ts` already owns the canned 403.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ownerAuth.ts
// Someone just hit an owner-gated Drive admin route.
// This process may only continue if the caller is the signed Owner
// whose email is exactly the configured Drive owner.
// A scoped API key fails even when the HMAC headers are perfect.
// Missing vantageAuth fails.
// Leftover registry then proves the HMAC Owner
// (or throws its own signature / role error).
// After that, a signed Owner whose actorLabel
// is not GOOGLE_OAUTH_OWNER_EMAIL still fails.
// Stop the HTTP request with the canned 403,
// or with the leftover registry body,
// or with already-recommended JSON sanitize for anything else.
// The unguarded Google callback is a different person —
// Google's verified email is the auth there.
// Do not persist.
// Do not talk to Google.
// Do not fold scopes.
// Do not compare connection.google_email.

// ── 1. Refuse unless this request is the signed configured Drive Owner ──

export function refuseUnlessThisRequestIsTheSignedConfiguredDriveOwner(
  req: Request,
): SignedConfiguredDriveOwner

function thisCallHasNoVantageAuthOrIsAScopedKey(auth)
function askLeftoverRegistryForTheHmacOwner(req, auth)
function thisHmacOwnerIsNotTheConfiguredDriveOwner(actorLabel, ownerEmail)
function refuseThisCaller() // GoogleDriveOwnerAccessRequiredError

// ── 2. Stop the Drive admin HTTP call when they are not ──

export function stopTheDriveAdminCallUnlessTheSignedConfiguredOwner(
  req,
  res,
  next,
): void

function handTheCannedSignedOwnerMissing403(res)      // already-recommended
function handTheLeftoverRegistryBody(res, error)
function handTheSanitizedDriveFailure(res, error)     // already-recommended
```

Read the primary path out loud: *The Owner dashboard just called authorize (or status, or Picker, or folder, or disconnect, or test-spreadsheet). The route already passed the API secret. Ask this file to refuse unless the caller is the signed configured Drive Owner. A scoped key stops here. Leftover registry then proves the HMAC Owner. If that Owner’s email is not the configured Drive owner, stop here too. Write the canned 403 and do not continue. If leftover registry says the signature is missing or the role is Admin, write the registry body instead. The unguarded callback never asks this file — already-recommended complete checks Google’s verified email there. This file never writes Mongo. This file never talks to Google. The connected Google email is a different person.*

That is the operation. `requireGoogleDriveOwnerActor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`requireGoogleDriveOwnerActor` / `enforceGoogleDriveOwnerAccess` are executor mechanics.** The owner story is “refuse unless this request is the signed configured Drive Owner” / “stop the Drive admin HTTP call when they are not.” Keep the old names as aliases. Do not grow an `OwnerAuthService` with `require` / `enforce` / `authorize`.

2. **Scoped key fails before leftover registry.** `kind === "scoped_key"` throws the typed miss even when `signedOwnerRequest()` HMAC headers are present (test). Do not silently drop that check so “a signed integration can reconnect Drive.” Do not silently treat `scoped_key` as `secret` so “the secret already passed.” Wave B `requireApiSecret` already accepted the scoped key; this file is the extra Drive refuse.

3. **Two 403 languages.** Typed miss → canned `{ ok: false, code: "owner_access_required", error: "Signed owner dashboard access is required." }`. Leftover `RegistryError` → `{ ok: false, error, registry_code, remediation? }` at 403 for `FORBIDDEN` / `ACTOR_SIGNATURE_*`. Do not silently run registry errors through already-recommended sanitize so “one JSON shape” — leftover remediation (`Configure VANTAGE_ADMIN_PROXY_SIGNING_SECRET`, header names) is a leftover **adapter**. Do not silently throw the typed miss when HMAC is missing so “Drive never speaks registry.”

4. **Registry Owner is not enough.** Leftover `requireRegistryOwnerActor` accepts any HMAC Owner. This file then compares `actor.actorLabel` to `config.ownerEmail`. A signed Owner who is not the configured Drive owner gets the canned 403, not leftover `FORBIDDEN`. Do not silently skip the email check so “Owner is Owner.” Do not silently throw leftover `FORBIDDEN` so “one registry code.”

5. **HTTP signed email ≠ Google verified email.** Already-recommended complete refuses when Google’s `email_verified` address is not `config.ownerEmail`. This file refuses when the **HMAC** (or leftover actor) email is not that same config. The callback is unguarded on purpose — Google cannot send `x-vantage-admin-*`. Do not silently mount operation 2 on the callback so “every Drive route is owner-gated.” Do not silently compare `connection.google_email` so “the connected Google account is the person.” Do not silently skip complete’s Google check because authorize already passed this file.

6. **`secret` and `user` both continue; leftover HMAC still runs.** Tests lock both kinds with signed proxy headers. Extension-owner Bearer without HMAC is **not** a Drive path: leftover `isExtensionOwnerCatalogMutationPath` is only `POST/PATCH /api/v1/admin/agents`. `requireOwner: true` then calls `verifySignedActor`. Do not silently return leftover `extensionOwnerActor` here so “an Owner Bearer can reconnect Drive.” Do not silently skip leftover registry when `kind === "user"` so “the JWT is enough.”

7. **`enforce` discards the actor.** Operation 1 returns leftover `RegistryActorContext`. Operation 2 calls it and `next()`s. Wave B never reads `actorLabel`. Do not silently attach the actor to `req` so “routes can log who” without a redaction pass. Do not silently log `actorLabel` from this file so “ops can see the miss” — that is the configured owner email.

8. **Config throw is not a typed miss.** `getGoogleDriveOAuthConfig()` also requires client id / secret / encryption key / trusted origin. A missing env is a raw `Error`. Operation 2 maps that through already-recommended sanitize → 500 `google_drive_unavailable`. Do not silently catch config errors as `GoogleDriveOwnerAccessRequiredError` so “env looks like a 403.” Do not silently import only `ownerEmail` from env here so “this file can skip the key.”

9. **Both sides of the email check are already folded.** Leftover `normalizeAdminEmail` is `trim().toLowerCase()`. Wave B `ownerEmail` is `requiredEnv(...).toLowerCase()` (trim inside `requiredEnv`). This file uses `!==`. Do not silently fold again so “we can skip leftover.” Do not silently compare `vantageAuth.email` for `kind === "user"` — signed-actor `actorLabel` comes from the HMAC header, not the Bearer email.

10. **Canned 403 lives next door.** Already-recommended `googleDriveOwnerAccessRequiredResponse` is the only producer of `owner_access_required`. This file asks it. Already-recommended sanitize never returns that code. Do not copy the JSON literal into this file so “we can skip the import.” Do not throw `UnauthorizedError` 403 so “sanitize can say identity rejected.”

11. **Leave sibling modules alone.** Already-recommended begin / complete / status / client / health, already-recommended lock / unlock, already-recommended fold / refuse, already-recommended canned 403 / JSON sanitize, later Picker / folder / metadata / managed-tab, leftover HMAC verify, leftover reporting adapters, and Wave B `requireApiSecret` stay where they are. This file orchestrates scoped-key/missing-auth refuse → leftover HMAC Owner → configured-email refuse → HTTP stop.

## Testing

The **interface** is the test surface: the decision / HTTP-stop / typed-error exports (story names, old names as aliases). Scoped-key refuse, signed-owner accept, configured-email mismatch, leftover registry body vs canned 403, and the forbidden identities (callback gate, Google email, scoped-key pass) are part of that **interface**. Do not boot Google. Do not boot Mongo. Do not boot Drive.

Today `ownerAuth.test.ts` locks `secret` + signed owner proxy → `actorLabel === owner@example.com`, `user` + signed owner proxy → same, and `scoped_key` + signed headers → `GoogleDriveOwnerAccessRequiredError`. Those tests belong on this **interface**. The two sanitizer tests in the same file belong on already-recommended `oauthSecurity.ts`. Add (or keep) file tests that name the operation:

**Refuse unless this request is the signed configured Drive Owner**
- `secret` + signed owner proxy whose HMAC email is the configured owner returns that actor (today).
- `user` + signed owner proxy whose HMAC email is the configured owner returns that actor (today).
- `scoped_key` + signed owner headers throws `GoogleDriveOwnerAccessRequiredError` (today).
- Missing `vantageAuth` throws the same typed error.
- Signed HMAC Owner whose email is **not** `GOOGLE_OAUTH_OWNER_EMAIL` throws the same typed error (no test today).
- Leftover registry signature-missing / Admin-role still throws leftover `RegistryError`, not the typed miss.

**Stop the Drive admin HTTP call when they are not**
- Typed miss writes 403 + `owner_access_required` + “Signed owner dashboard access is required.” and does not `next`.
- Leftover `RegistryError` writes `error.toHttpBody()` at `error.statusCode` (has `registry_code`, no `code: "owner_access_required"`).
- Raw `Error` from missing Drive env writes already-recommended 500 `google_drive_unavailable`.
- Happy path calls `next()` and does not write `res`.

**Not this interface**
- Consume-state / Google-email 403 / missing refresh token stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Exact-set refuse / `userinfo.email` fold stay on already-recommended `oauthScopes.ts`.
- Canned-403 helper / JSON sanitize / callback log stay on already-recommended `oauthSecurity.ts` (move the two sanitizer tests there when implementing).
- Picker bootstrap / folder create stay on later siblings.
- HMAC payload / replay window stay on leftover `trustedActor.ts`.
- Wave B `requireApiSecret` 401 stays on the middleware.

Do **not** add a test per helper (`thisCallHasNoVantageAuthOrIsAScopedKey`, `thisHmacOwnerIsNotTheConfiguredDriveOwner`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file reads `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` except as a config prerequisite it already asks through Wave B — it must not decode it. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that a scoped key now passes when HMAC is valid — it must not. Do not add a test that extension-owner Bearer without HMAC now passes Drive — it must not. Do not add a test that the callback route now mounts this middleware — it must not, in this rename. Do not add a test that this file compares `connection.google_email` — it must not. Do not add a test that this file constructs `OAuth2Client` — it must not. Do not add a test that leftover registry errors now return `owner_access_required` — they must not, in this rename. Do not add a test that `enforce` now sets `req.driveOwner` — it must not, in this rename.

## What I would not do

- An `OwnerAuthService` class with `require` / `enforce` / `authorize`.
- Thirty two-line functions that only wrap `vantageAuth.kind`.
- Moving this into a CRUD folder, or into `oauthSecurity.ts` / `trustedActor.ts` / `googleDriveOAuth.service.ts` / Wave B routes “for cleanliness.”
- Breaking the scoped-key-fails-first **seam**, the registry-Owner-plus-configured-email **seam**, the canned-403-vs-registry-body **seam**, or the unguarded-callback-is-not-this-file **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / already-recommended `tokenEncryption.ts` / already-recommended `oauthScopes.ts` / already-recommended `oauthSecurity.ts` / later `picker.service.ts` / leftover `requireRegistryOwnerActor` / Wave B `requireApiSecret` as this story.
- Inventing an HMAC **seam** that has only one **adapter** here, or a Google-email **seam** that has only one **adapter** here, or a persist **seam** that has only one **adapter** here.
- Silently letting a scoped key through, or silently mounting this on the callback, or silently comparing `connection.google_email`, or silently skipping leftover HMAC for `kind === "user"`, or silently collapsing registry errors into the canned 403, or silently attaching the actor to `req`, or silently constructing the company service account from this file.
- Writing a whole-folder recommendation that pretends later Picker / folder / managed-tab / leftover reporting are this module.
- Opening `spreadsheet.service.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `refuseUnlessThisRequestIsTheSignedConfiguredDriveOwner`.
