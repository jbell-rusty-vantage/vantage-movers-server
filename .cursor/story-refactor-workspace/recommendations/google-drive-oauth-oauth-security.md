# Tell The Owner Why Drive Failed Without Leaking Google, The Owner Email, Or The Token — Map A Typed Scope Violation To Public 403, Replace Any AppError Message With A Stable Category Sentence, Map Unknown Errors To 500 Unavailable, And For The Unguarded Callback Log Only The Category And Error Name — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 4 of this service — `oauthSecurity.ts`
- Remaining in this service: `ownerAuth.ts`, `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` already recommended)
- Target: `src/services/googleDriveOAuth/oauthSecurity.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this sanitizer; leftover reporting **asks** Wave B `emitReportingOAuthHealthFailure` with a reason this file already named). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — it **throws** `BadRequestError` / `UnauthorizedError` / `IntegrationError` / `NotFoundError` / raw `Error`; this file **replaces** those messages). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — that file throws raw `Error`; this file maps unknown `Error` to 500 `google_drive_unavailable` and never unlocks). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md) (fold + exact-set refuse — that file throws `OAuthScopeViolationError`; this file `instanceof` that class and **drops** the context string). Distinct from later `ownerAuth.ts` (signed Owner **HTTP** gate — it **asks** this file for the canned 403 and the JSON sanitizer; it does **not** own the category table). Distinct from later Picker (hardcodes “Reconnect owner OAuth” from already-recommended health `scope_violation` / `refresh_failed` — it does **not** import this file). Distinct from leftover `reporting/reportingObservability.ts` `emitReportingOAuthHealthFailure` (writes the reason this file already named; it does **not** pick the category). Distinct from Wave B `routes/google-drive-oauth.routes.ts` (authorize / status / Picker / folder / disconnect / test-spreadsheet ask the JSON sanitizer; unguarded callback asks the log bag + public sentence and **remaps** HTTP to 400 / 500). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (env-var **names** — this file never reads them). Distinct from skipped barrel `index.ts` (re-exports sanitize / callback-log / public sentence; does **not** re-export the canned 403 or `categorizeOAuthCallbackFailure`). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md). This checkout’s `CONTEXT.md` does not define a Drive OAuth / public-failure-category term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **two runtime import sites. Tests live on a later sibling file.** Wave B `routes/google-drive-oauth.routes.ts` — denied Google query asks `publicMessageForCategory("oauth_provider_error")` with no throw; `handleOAuthCallback` catch asks `sanitizeGoogleDriveCallbackLog` (category + `errorName` into the log and leftover health emit) then `publicMessageForCategory(sanitized.category)` on the HTML page, and remaps HTTP to 500 only when the category is `google_drive_unavailable` else 400; `sendApiError` / `recordOAuthHealthFailure` ask `sanitizeGoogleDriveApiError` (Zod stays in the route). Later `ownerAuth.ts` — `GoogleDriveOwnerAccessRequiredError` asks `googleDriveOwnerAccessRequiredResponse()`; unexpected throw asks `sanitizeGoogleDriveApiError`. Barrel `index.ts` re-exports `sanitizeGoogleDriveApiError` / `sanitizeGoogleDriveCallbackLog` / `publicMessageForCategory` (not the canned 403, not `categorizeOAuthCallbackFailure`, not the category type). Tests: `ownerAuth.test.ts` locks `UnauthorizedError` 403 → `oauth_identity_rejected` without `owner@example.com` / `jbell@`, and callback log `{ category, errorName: "UnauthorizedError" }`. Not this **interface**: already-recommended begin / complete / status / client / health (they throw; they do not sanitize), already-recommended AES lock, already-recommended fold / refuse, later signed-owner gate math, later Picker reconnect copy, leftover health emit, Wave B Zod 400.
- Seams callers need: canned signed-owner 403 vs thrown-error JSON; owner-gated API JSON (status from this file) vs unguarded callback HTML (Wave B remaps 400 / 500); category vs public sentence (denied query has a category and no throw); log bag is category + `error.name` only (never `error.message`)
- Split later (only if the file outgrows one sitting): this ~119-line file is one sitting if you read it as tell the Owner why Drive failed without leaking Google, the owner email, or the token, map a typed scope violation to public 403, replace any AppError message with a stable category sentence, map unknown errors to 500 unavailable, and for the unguarded callback log only the category and error name. If it later splits: `refuseUnlessTheCallerIsTheSignedOwner.ts` / `tellTheOwnerWhyThisDriveCallFailed.ts` / `nameTheCallbackFailureWithoutLeakingGoogle.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `error.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, later `ownerAuth.ts`, later Picker, leftover reporting observability, or Wave B routes into this file

`sanitizeGoogleDriveApiError` / `categorizeOAuthCallbackFailure` / `publicMessageForCategory` are executor mechanics. The owner question is: *A Drive call just failed. The Owner may see a JSON body on an owner-gated admin route, or an HTML sentence on the unguarded Google callback. They must not see the configured owner email, a refresh token, Google’s provider text, or the scope-context string already-recommended refuse put on the typed error. If later ownerAuth already knows the caller is not the signed Owner, hand the canned 403. If already-recommended refuse threw `OAuthScopeViolationError`, say scopes are not permitted and keep 403. If the throw is an AppError, keep that HTTP status, name a stable category from the status (and a narrow code check), and replace the message with the public sentence for that category. Anything else is temporarily unavailable at 500. For the callback, name the same category, log only the category and the error class name, and let Wave B pick 400 or 500. Do not persist. Do not talk to Google. Do not fold scopes. Do not decide who the signed Owner is.*

Already-recommended Owner login, already-recommended token lock, already-recommended grant allowlist, later signed-owner HTTP gate, later Picker reconnect copy, leftover health emit, and Wave B routes already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “tell the Owner why Drive failed without leaking Google, the owner email, or the token — map a typed scope violation to public 403, replace any AppError message with a stable category sentence, map unknown errors to 500 unavailable, and for the unguarded callback log only the category and error name” story, not “an error CRUD helper,” and not the Owner login / the grant allowlist / the signed-owner gate:

1. **Hand the signed-owner-missing 403** — `googleDriveOwnerAccessRequiredResponse()`. Always `{ status: 403, body: { ok: false, code: "owner_access_required", error: "Signed owner dashboard access is required." } }`. This beat does not inspect `req`. This beat does not read the configured owner email. Later `ownerAuth.ts` asks this **seam** after it already threw `GoogleDriveOwnerAccessRequiredError` (scoped key, missing auth, or actor email ≠ configured owner). `sanitizeGoogleDriveApiError` never produces this code — only this canned helper does.

2. **Tell the Owner why this Drive call failed** — `sanitizeGoogleDriveApiError(error)`. `OAuthScopeViolationError` → 403 + `oauth_scope_violation` + “Google Drive authorization scopes are not permitted.” (drops the `(oauth_callback)` / `stored_connection` / `oauth_client` / `access_token_health` context). `AppError` → keep `error.statusCode`, name a category via `categorizeAppError`, replace `error.message` with `publicMessageForCategory(category)`. Anything else → 500 + `google_drive_unavailable` + “Google Drive integration is temporarily unavailable.” This beat does not persist. This beat does not talk to Google. Wave B `sendApiError` and later `ownerAuth` unexpected-throw both ask this **seam**. Leftover health emit on authorize / status / Picker bootstrap reads `serialized.body.code`.

3. **Name the unguarded callback failure without leaking Google** — `categorizeOAuthCallbackFailure` + `sanitizeGoogleDriveCallbackLog` + `publicMessageForCategory`. Same typed-scope / AppError / unknown tree as operation 2, but the return is a category (and, for the log bag, `error.name` or `"UnknownError"`). Wave B callback catch logs `{ category, errorName }`, emits leftover health with `reason: category`, shows `publicMessageForCategory(category)` on the HTML page, and remaps HTTP to 500 only when the category is `google_drive_unavailable` else **400** — including a scope violation that operation 2 would have kept at 403. Denied Google query (`error=` on the callback URL) never throws; the route asks `publicMessageForCategory("oauth_provider_error")` directly. This beat does not write HTML. This beat does not pick 400 vs 500.

There is no persist operation. There is no fold/refuse operation. There is no signed-owner math operation. Already-recommended complete / status / client / health, already-recommended lock / unlock, already-recommended allowlist, later `ownerAuth.ts`, later Picker, and Wave B HTML already live in other files.

The nine-code `GoogleDriveErrorCategory` union is the policy those three operations share, not a fourth owner operation. Two of the nine (`oauth_session_invalid`, `oauth_refresh_failed`) have public sentences today and **no assigner** in `categorizeAppError` — do not silently wire them in this rename.

## Organization

Keep one file as the screenplay for “tell the Owner why Drive failed without leaking Google, the owner email, or the token — map a typed scope violation to public 403, replace any AppError message with a stable category sentence, map unknown errors to 500 unavailable, and for the unguarded callback log only the category and error name.” Already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, later `ownerAuth.ts`, later Picker / folder / metadata / managed-tab, leftover reporting observability, and Wave B routes already live in deeper **modules**. Do not pull those in. Do not invent an `OAuthSecurityService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a fold/refuse **adapter** beside already-recommended `assertAllowedOAuthScopes`. Do not invent a signed-owner **adapter** beside later `requireGoogleDriveOwnerActor`. Do not invent a Picker-reconnect **adapter** beside later `bootstrapGooglePicker`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `error.ts`. Those are HTTP verbs / checker verbs, not the owner story. Do not move this into `oauthScopes.ts` so “the refuse already 403s.” Do not move this into later `ownerAuth.ts` so “the gate can also sanitize.” Do not move this into already-recommended `googleDriveOAuth.service.ts` so “the login can also speak HTTP.” Do not move this into Wave B routes so “the HTML page can own the table.” Do not silently echo `AppError.message` so “the Owner can see the real reason.”

**External interface** stays small (this is the test surface). Canned 403, JSON sanitize, and callback name/log/sentence are one story’s public Drive failure, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `googleDriveOwnerAccessRequiredResponse` | `refuseUnlessTheCallerIsTheSignedOwner` | later `ownerAuth` needs the canned 403 without going through `AppError` |
| `sanitizeGoogleDriveApiError` | `tellTheOwnerWhyThisDriveCallFailed` | owner-gated routes and later `ownerAuth` fallback need `{ status, body: { ok, code, error } }` |
| `categorizeOAuthCallbackFailure` | `nameTheCallbackFailureWithoutLeakingGoogle` | unguarded callback needs a category before Wave B picks 400 vs 500 |
| `sanitizeGoogleDriveCallbackLog` | `logTheCallbackFailureWithoutProviderText` | callback logs category + `error.name` only; leftover health emit uses the category |
| `publicMessageForCategory` | `sayThePublicSentenceForThisDriveFailure` | denied Google query has no throw; callback HTML needs the sentence after the category |
| `GoogleDriveErrorCategory` | `OwnerDrivePublicFailure` | the nine codes admin JSON / logs / leftover health may see |

Keep the old names as one-line aliases until Wave B routes and later `ownerAuth.ts` migrate. Do not make callers learn `categorizeAppError` / `error.statusCode` / `error.code.includes("scope")` as the domain language.

**Principle: old exports stay as aliases.** `sanitizeGoogleDriveApiError` remains the imported name until Wave B `sendApiError` points at the story name. `googleDriveOwnerAccessRequiredResponse` remains the imported name until later `ownerAuth` migrates.

**No class for the workflow.** The type that *does* earn a name is the nine-code public failure the Owner and the log may see:

```ts
type OwnerDrivePublicFailure =
  | "invalid_request"
  | "owner_access_required"
  | "oauth_not_connected"
  | "oauth_scope_violation"
  | "oauth_identity_rejected"
  | "oauth_session_invalid"
  | "oauth_provider_error"
  | "oauth_refresh_failed"
  | "google_drive_unavailable"
```

That is the handoff from “a Drive throw just happened” to “the Owner sees one of these codes and a sentence that never names the owner email.” Do **not** add `scope_violation` as a tenth code so “Picker health can skip its own reason,” do **not** add `app.unauthorized` so “AppError codes can leak,” and do **not** drop `oauth_session_invalid` / `oauth_refresh_failed` in this rename because they are unused assigners — the sentences are already the owner language already-recommended complete and later Picker speak.

`categorizeAppError` stays unexported. It is a beat, not a second public operation. Do not add `assertAllowedOAuthScopes` as a public **seam** on this file — already-recommended `oauthScopes.ts` already owns refuse. Do not add `requireGoogleDriveOwnerActor` as a public **seam** on this file — later `ownerAuth.ts` already owns the gate.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// oauthSecurity.ts
// A Drive call just failed.
// The Owner may see a JSON body on an owner-gated admin route,
// or an HTML sentence on the unguarded Google callback.
// They must not see the configured owner email,
// a refresh token, Google's provider text,
// or the scope-context string already-recommended refuse put on the typed error.
// If later ownerAuth already knows the caller is not the signed Owner,
// hand the canned 403.
// If already-recommended refuse threw OAuthScopeViolationError,
// say scopes are not permitted and keep 403.
// If the throw is an AppError, keep that HTTP status,
// name a stable category from the status,
// and replace the message with the public sentence for that category.
// Anything else is temporarily unavailable at 500.
// For the callback, name the same category,
// log only the category and the error class name,
// and let Wave B pick 400 or 500.
// Do not persist.
// Do not talk to Google.
// Do not fold scopes.
// Do not decide who the signed Owner is.

type OwnerDrivePublicFailure =
  | "invalid_request"
  | "owner_access_required"
  | "oauth_not_connected"
  | "oauth_scope_violation"
  | "oauth_identity_rejected"
  | "oauth_session_invalid"
  | "oauth_provider_error"
  | "oauth_refresh_failed"
  | "google_drive_unavailable"

// ── 1. Hand the signed-owner-missing 403 ──────────────────

export function refuseUnlessTheCallerIsTheSignedOwner(): {
  status: 403
  body: { ok: false; code: "owner_access_required"; error: string }
}

// ── 2. Tell the Owner why this Drive call failed ──────────

export function tellTheOwnerWhyThisDriveCallFailed(error: unknown): {
  status: number
  body: { ok: false; code: OwnerDrivePublicFailure; error: string }
}

function thisIsTheTypedOwnerDriveGrantRefuse(error) // instanceof OAuthScopeViolationError
function keepTheAppErrorStatusAndReplaceTheMessage(error)
function thisDriveFailureIsTemporarilyUnavailable()

function nameTheAppErrorWithoutLeakingTheMessage(error: AppError)
// 400 → invalid_request
// 401 + code includes "unauthorized" → oauth_identity_rejected
// 403 + code includes "scope" → oauth_scope_violation
// 403 else → oauth_identity_rejected
// 404 → oauth_not_connected
// 502 / 503 → oauth_provider_error
// >= 500 → google_drive_unavailable
// else → invalid_request
// never returns owner_access_required / oauth_session_invalid / oauth_refresh_failed

// ── 3. Name the unguarded callback failure without leaking Google

export function nameTheCallbackFailureWithoutLeakingGoogle(
  error: unknown,
): OwnerDrivePublicFailure

export function logTheCallbackFailureWithoutProviderText(error: unknown): {
  category: OwnerDrivePublicFailure
  errorName: string
}

export function sayThePublicSentenceForThisDriveFailure(
  category: OwnerDrivePublicFailure,
): string
```

Read the primary path out loud: *The unguarded callback just threw. Ask this file to name the failure: typed scope refuse becomes oauth_scope_violation; an AppError keeps its status and becomes a category; anything else is google_drive_unavailable. Log only that category and the error class name. Show the public sentence for the category. Wave B will send 400 unless the category is unavailable, then 500. On an owner-gated route the same typed scope refuse stays 403 JSON. A signed-owner miss never enters the sanitizer — later ownerAuth already asked for the canned 403. This file never writes Mongo. This file never talks to Google. The owner email does not appear in the sentence.*

That is the operation. `sanitizeGoogleDriveApiError` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`sanitizeGoogleDriveApiError` / `categorizeOAuthCallbackFailure` / `publicMessageForCategory` are executor mechanics.** The owner story is “tell the Owner why this Drive call failed” / “name the callback failure without leaking Google” / “say the public sentence.” Keep the old names as aliases. Do not grow an `OAuthSecurityService` with `sanitize` / `categorize` / `format`.

2. **Two unused categories already speak the owner language.** `oauth_session_invalid` → “Google authorization session is invalid or expired. Start the connection again.” — that is already-recommended complete’s `BadRequestError` message. `categorizeAppError` maps every 400 to `invalid_request`, so the callback HTML shows “The Google Drive request is invalid.” `oauth_refresh_failed` → “Google Drive access token refresh failed. Reconnect owner OAuth.” — that is later Picker’s `refresh_failed` copy; health never throws through this file. Do **not** silently remap 400 → `oauth_session_invalid` so “the sentence matches complete” without a callback-page test. Do **not** silently teach health to throw so “refresh_failed can use this table.” Do **not** drop the two codes so “the union matches assigners.”

3. **API 403 vs callback 400 for the same typed refuse.** Operation 2 keeps `OAuthScopeViolationError` at 403. Wave B callback remaps every named category except `google_drive_unavailable` to **400**. Do not silently make the callback send 403 so “one status” — that remap is a Wave B **seam**, not this file’s. Do not silently make operation 2 return 400 so “the HTML can stay.”

4. **Canned 403 is a different adapter from thrown-error JSON.** Later `ownerAuth` catches `GoogleDriveOwnerAccessRequiredError` and asks operation 1. `sanitizeGoogleDriveApiError` never returns `owner_access_required`. A raw `Error` with that message would become 500 `google_drive_unavailable`. Do not silently `instanceof` the later owner-auth error in this file so “one sanitizer” — later `ownerAuth` already owns that catch. Do not silently throw `UnauthorizedError` 403 from later `ownerAuth` so “operation 2 can say identity rejected.”

5. **The 403 + `code.includes("scope")` branch is dead beside the typed class.** Already-recommended refuse throws `OAuthScopeViolationError` (`code: "google_oauth_scope_violation"`), which is **not** an `AppError`. Operation 2 handles it first. No current AppError uses a code containing `"scope"`. Do not silently make `OAuthScopeViolationError` extend `AppError` so “one hierarchy.” Do not silently delete the string check so “dead code” without a test that an AppError 403 with `code: "…scope…"` still maps.

6. **`AppError.message` is dropped on purpose.** The test locks `UnauthorizedError("The connected Google account is not authorized for reporting.", { statusCode: 403 })` → public `oauth_identity_rejected` sentence, and forbids `owner@example.com` / `jbell@`. Already-recommended complete’s missing-id-token / unverified-email / wrong-email messages never leave this file. Do not silently pass `error.message` through so “the Owner can see the real reason.” Do not silently interpolate `config.ownerEmail` so “ops can see who was expected.”

7. **Callback log is class name, not message.** `sanitizeGoogleDriveCallbackLog` returns `{ category, errorName }`. Wave B logs those two fields. Do not silently add `error.message` so “ops can debug Google.” Do not silently add granted scopes so “ops can see the overgrant.” Already-recommended refuse’s context string is already dropped in operation 2.

8. **Denied query has no throw.** Wave B `googleOAuthErrorQuerySchema` success asks `publicMessageForCategory("oauth_provider_error")` and logs `category: "oauth_provider_error"`. Keep `publicMessageForCategory` exported. Do not silently invent a fake `IntegrationError` in the route so “everything goes through sanitize.” Do not silently move the denied-query sentence into Wave B so “this file only handles throws.”

9. **404 is “not connected,” not “missing folder.”** `NotFoundError` from already-recommended live client (“Complete the owner authorization first.”) becomes `oauth_not_connected`. Later folder / spreadsheet 404s that throw `NotFoundError` would get the same category. Do not silently invent a `drive_file_missing` code in this rename. Do not silently map 404 to `invalid_request` so “Picker can distinguish.”

10. **502 / 503 are provider error, including missing offline access.** Already-recommended complete throws `IntegrationError` (502) for Google `getToken` failure **and** for a missing `refresh_token`. Both become `oauth_provider_error` / “Google could not complete authorization. Start the connection again.” The missing-refresh sentence (“Revoke the existing Vantage authorization…”) is dropped. Do not silently remap missing-refresh to `oauth_refresh_failed` so “the sentence matches Picker” without a dedicated typed error. Do not silently keep `IntegrationError.message` so “offline access can show.”

11. **Unknown `Error` is 500, including AES and “not persisted.”** Already-recommended lock / unlock throw raw `Error`. Wave B callback throws `new Error("Google Drive connection was not persisted")` if complete returned disconnected. Both become `google_drive_unavailable`. Do not silently make AES throw `AppError` so “decrypt can be 400.” Do not silently map every `Error` to 400 so “the HTML can stay 400.”

12. **Leave sibling modules alone.** Already-recommended begin / complete / status / client / health, already-recommended lock / unlock, already-recommended fold / refuse, later signed-owner gate, later Picker reconnect copy, leftover health emit, and Wave B 400/500 remap stay where they are. This file orchestrates canned 403 → thrown-error JSON → callback name/log/sentence.

## Testing

The **interface** is the test surface: the canned 403 / JSON sanitize / callback name / callback log / public-sentence exports (story names, old names as aliases) plus the category union. Typed-scope 403, AppError status-keep + message-replace, unknown 500, identity-rejected without owner email, callback log without provider text, and the unused-category “do not silently wire” rules are part of that **interface**. Do not boot Google. Do not boot Mongo. Do not boot Drive.

Today `ownerAuth.test.ts` locks `UnauthorizedError` 403 → `oauth_identity_rejected` without `owner@example.com` / `jbell@`, and callback log `{ category: "oauth_identity_rejected", errorName: "UnauthorizedError" }`. Those tests belong on this **interface** (they already import this file). Add (or keep) file tests that name the operation:

**Hand the signed-owner-missing 403**
- Always 403 + `owner_access_required` + “Signed owner dashboard access is required.”
- Does not read env. Does not inspect a request.

**Tell the Owner why this Drive call failed**
- `OAuthScopeViolationError("oauth_callback")` → 403 + `oauth_scope_violation` + “Google Drive authorization scopes are not permitted.” Message does **not** include `oauth_callback`.
- `UnauthorizedError` 403 (wrong Google email) → `oauth_identity_rejected` without the owner email (today).
- `UnauthorizedError` default 401 (missing id_token / unverified email) → 401 + `oauth_identity_rejected` + the identity sentence, not the AppError message.
- `BadRequestError` (expired state) → 400 + `invalid_request` + “The Google Drive request is invalid.” — **not** `oauth_session_invalid` until a dedicated change.
- `NotFoundError` (live client, no row) → 404 + `oauth_not_connected`.
- `IntegrationError` (getToken or missing refresh) → 502 + `oauth_provider_error` + “Google could not complete authorization. Start the connection again.” — not the missing-refresh sentence.
- Raw `Error` / AES throw → 500 + `google_drive_unavailable`.
- `sanitizeGoogleDriveApiError` never returns `owner_access_required`.

**Name the unguarded callback failure without leaking Google**
- Same category tree as JSON sanitize.
- Log bag is `{ category, errorName }` only (today).
- `publicMessageForCategory("oauth_provider_error")` is the denied-query sentence.
- Do **not** assert Wave B’s 400-vs-500 remap here — that is the route.

**Not this interface**
- Consume-state / owner-email 403 / missing refresh token stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Exact-set refuse / `userinfo.email` fold stay on already-recommended `oauthScopes.ts`.
- Signed admin proxy / scoped-key 403 stay on later `ownerAuth.ts`.
- Picker “Reconnect owner OAuth” stay on later `picker.service.ts`.
- Leftover `emitReportingOAuthHealthFailure` stays on leftover `reportingObservability.ts`.
- Wave B Zod `{ code: "invalid_request", error: "Invalid request", issues }` stays on the route.

Do **not** add a test per helper (`thisIsTheTypedOwnerDriveGrantRefuse`, `nameTheAppErrorWithoutLeakingTheMessage`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_OAUTH_OWNER_EMAIL` — it must not. Do not add a test that this file reads `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — it must not. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that `BadRequestError` now maps to `oauth_session_invalid` — it must not, in this rename. Do not add a test that health `refresh_failed` now throws through this file — it must not. Do not add a test that callback HTML is now 403 for scope — that is Wave B. Do not add a test that `AppError.message` is returned — it must not. Do not add a test that later Picker now imports this file — it must not, in this rename. Do not add a test that this file constructs `OAuth2Client` — it must not. Do not add a test that this file folds scopes — it must not.

## What I would not do

- An `OAuthSecurityService` class with `sanitize` / `categorize` / `format`.
- Thirty two-line functions that only wrap a `switch`.
- Moving this into a CRUD folder, or into `oauthScopes.ts` / `ownerAuth.ts` / `googleDriveOAuth.service.ts` / Wave B routes / leftover reporting observability “for cleanliness.”
- Breaking the drop-`AppError.message` **seam**, the typed-scope-is-403-on-JSON **seam**, the canned-403-is-not-sanitize **seam**, or the callback-log-is-name-only **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / already-recommended `tokenEncryption.ts` / already-recommended `oauthScopes.ts` / later `ownerAuth.ts` / later `picker.service.ts` / leftover `emitReportingOAuthHealthFailure` / Wave B 400/500 remap as this story.
- Inventing a persist **seam** that has only one **adapter** here, or a fold/refuse **seam** that has only one **adapter** here, or a signed-owner-math **seam** that has only one **adapter** here.
- Silently remapping 400 to `oauth_session_invalid`, or silently remapping missing-refresh to `oauth_refresh_failed`, or silently echoing `AppError.message`, or silently making the callback send 403, or silently `instanceof` later `GoogleDriveOwnerAccessRequiredError` here, or silently teaching later Picker to import this file, or silently writing Mongo from sanitize.
- Writing a whole-folder recommendation that pretends later Picker / folder / managed-tab / leftover reporting are this module.
- Opening `ownerAuth.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `tellTheOwnerWhyThisDriveCallFailed`.
