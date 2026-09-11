# Finish The Owner's Drive Login When Google Comes Back Without The Secret, Then Let The Signed Drive Owner Start Consent, See Whether Drive Is Connected, Open Picker, Verify A Pick, Put A Folder, Prove A Test Workbook, Or Cut The Connection — Never Put The Callback Behind The Secret, Never Hash Tokens Here, Never Consume A Picker Reference Here, Never Invent The Company Service Account — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 3 of this service — `google-drive-oauth.routes.ts`
- Remaining in this service: `ringcentral-registry.routes.ts`, `granot-lifecycle-admin.routes.ts`, `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/google-drive-oauth.routes.ts`
- Knowledge: no dedicated routes Service. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this HTTP desk; leftover reporting adapters **ask** already-recommended live client after this file already finished consent). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(googleDriveOAuthRoutes)` **before** `/api/v1` secret — this file **is** that Drive mount; the desk does **not** parse callback). Distinct from already-recommended unguarded extension session: [routes-extension-auth.md](routes-extension-auth.md) (login / refresh / me / logout — also unguarded; **not** a Drive callback; this file never hashes a password). Distinct from already-recommended Owner login: [google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (`beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / status / sanitize / disconnect — this file **asks** those; it does **not** mint the nonce, exchange the code, or encrypt the refresh token). Distinct from already-recommended public failure: [google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (JSON sanitize / callback log / public sentence — this file **asks** those and **remaps** callback HTTP to 400 / 500). Distinct from already-recommended signed Drive-owner gate: [google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (seven owner-gated paths mount `enforceGoogleDriveOwnerAccess` after per-route `requireApiSecret`; unguarded callback does **not**). Distinct from already-recommended Picker: [google-drive-oauth-picker.md](google-drive-oauth-picker.md) (bootstrap / verify — this file **asks** those; leftover destination **consumes** the selection reference; there is **no** consume HTTP route here). Distinct from already-recommended Owner Drive write: [google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md) (folder / test-shaped workbook — this file **asks** those). Distinct from already-recommended reporting tell: [reporting-reporting-observability.md](reporting-reporting-observability.md) (`emitReportingOAuthHealthFailure` — this file **asks** it from callback plus authorize / status / Picker bootstrap; leftover persist never throws). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (this file mounts it **per owner-gated path** because the router itself sits **before** the global `/api/v1` guard). Distinct from leftover Wave B config: `src/config/domain/googleDriveOAuth.ts` (`getGoogleDriveOAuthConfig` / `getGoogleDriveOAuthPublicConfig` / trusted completion URL — this file **asks** the public bag on status and appends `google_drive=connected|error` on the redirect). Distinct from leftover Wave B Zod: `src/validation/v1/googleDriveOAuth.validation.ts` (callback / error query / folder / test spreadsheet) and leftover `reportingDestination.validation.ts` (Picker bootstrap / verify — display fields unused). Distinct from leftover Wave B reporting desk: next `reporting.routes.ts` (destination create spends the selection reference). Distinct from already-recommended company identity: [google-auth-service-account.md](google-auth-service-account.md). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does not define a Drive OAuth / Owner Google login term; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(googleDriveOAuthRoutes)` on line 289, after extension auth and **before** `requireApiSecret`). Leftover `src/app.ts` mounts the public v1 desk, not this file. Folder `v1.routes.test.ts` does **not** name `/admin/google-drive/*`. Already-recommended `ownerAuth.test.ts` signs HMAC against `GET /api/v1/admin/google-drive/status` and **asks** leftover `requireGoogleDriveOwnerActor` — it never boots this router. Already-recommended `googleDriveOAuth.test.ts` / `oauthHardening.test.ts` / `pickerVerification.test.ts` lock leftover begin / hash / sanitize / Picker stores — not this desk. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists the callback as unguarded and the seven owner-gated paths as Drive admin. Not this **interface**: leftover `beginGoogleDriveOAuth` itself, leftover `completeGoogleDriveOAuth`, leftover `enforceGoogleDriveOwnerAccess`, leftover `bootstrapGooglePicker` / `verifyGooglePickerSelection` / `consumePickerSelectionReference`, leftover `createGoogleDriveFolder` / `createOAuthTestSpreadsheet`, leftover company service account, leftover destination create.
- Seams callers need: unguarded Google callback **before** `/api/v1` secret vs seven owner-gated Drive admin paths **after** per-route secret + leftover owner gate; begin consent vs complete connection (already-recommended service **seam**; this desk is the HTTP **adapter**); HTML / 303 completion page vs JSON `{ ok, data }`; JSON sanitize (status from leftover oauthSecurity) vs callback remap (500 only when category is `google_drive_unavailable`, else **400**, including a scope violation leftover JSON would keep at 403); leftover health emit on authorize / status / Picker bootstrap / callback vs verify / folder / disconnect / test-spreadsheet that skip it; Picker bootstrap vs Picker verify vs leftover destination consume (**no** HTTP consume). There is no begin / complete Domain Command **seam**. There is no company-key **seam**. There is no consume-Picker-reference **seam**.
- Split later (only if the file outgrows one sitting): this ~302-line file is one sitting if you read it as finish the Owner's Drive login when Google comes back without the secret, then let the signed Drive owner start consent, see whether Drive is connected, open Picker, verify a pick, put a folder, prove a test workbook, or cut the connection — never put the callback behind the secret, never hash tokens here, never consume a Picker reference here, never invent the company service account. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `callback.ts` / `authorize.ts`. Begin / complete / encrypt stay already-recommended `googleDriveOAuth.service.ts`. Owner HTTP gate stays already-recommended `ownerAuth.ts`. Picker consume stays leftover destination.

`router.get("/oauth/callback")` / `router.post("/oauth/authorize")` / `router.get("/status")` are HTTP verbs. The owner question is: *The Owner wants Vantage to act as them in Drive and Sheets, not as the company service account. From the admin desk they start Google consent — that path needs the API secret and the signed configured Drive owner. Google then redirects to this process with a code. Google cannot send the secret, so that callback stays unguarded. Finish the login, then show a close-this-window page or 303 back to the trusted admin origin with `google_drive=connected`. After that, the same signed owner may see whether Drive is connected (never the refresh token), open a one-time Picker, verify a pick into a one-time selection reference, put a folder, prove a test-shaped workbook, or cut the connection. Do not put the callback behind the secret. Do not hash or encrypt here. Do not spend the selection reference here — leftover destination create does that. Do not invent the company key. Do not issue an Extension User session.*

Who mints the nonce and encrypts the refresh token already lives in already-recommended `googleDriveOAuth.service.ts`. Who stops a non-owner admin call already lives in already-recommended `ownerAuth.ts`. Who names a public failure without leaking Google already lives in already-recommended `oauthSecurity.ts`. Who consumes the Picker reference already lives in leftover `reportingDestination.service.ts`. Do not pull those in.

## What this file actually does

Seven operations for the Drive **desk**, not “an OAuth CRUD dump,” and not Begin Owner Drive Consent / Hand The Owner A OneTime Picker / Put A Folder In The Owner Drive themselves:

1. **Finish the Owner's Drive login from Google's unguarded redirect** — `GET /api/v1/admin/google-drive/oauth/callback`. No secret. No leftover owner gate. If leftover `googleOAuthErrorQuerySchema` matches (`error=` on the query), log `google_drive.oauth.denied` as `oauth_provider_error` and show the public sentence — do not throw, do not emit leftover health. Else parse leftover `googleOAuthCallbackQuerySchema` (`code` + `state` 32–256). **Ask** already-recommended `completeGoogleDriveOAuth`. If the returned status is not `connected`, throw `"Google Drive connection was not persisted"` (complete upserts then re-reads; a miss is fail-closed). Success logs `google_drive.oauth.connected` and shows the close-this-window sentence (or 303). Catch **asks** already-recommended `sanitizeGoogleDriveCallbackLog`, leftover `emitReportingOAuthHealthFailure({ reason: category })` (swallow the tell), logs only category + `errorName`, and shows the public sentence at **500** only when the category is `google_drive_unavailable`, else **400**. This beat does **not** return JSON. This beat does **not** return the refresh token. This beat does **not** set `req.vantageAuth`.

2. **Start the Owner's Drive consent** — `POST .../oauth/authorize`. Per-route leftover `requireApiSecret` then already-recommended `enforceGoogleDriveOwnerAccess`. **Ask** already-recommended `beginGoogleDriveOAuth`. Answer `{ ok: true, data }` (authorization URL + expiry). Zod / leftover throw → leftover health emit (skip Zod) then leftover JSON sanitize. This beat does **not** exchange a code.

3. **Show whether Drive is connected, without secrets** — `GET .../status`. Same secret + owner gate. Parallel leftover `getGoogleDriveConnectionStatus` + leftover `getGoogleDriveOAuthPublicConfig`. Spread already-recommended `sanitizeGoogleDriveConnectionStatus` (drops `owner_email`, never ciphertext) plus `config` (client id, redirect, booleans for owner / export folder / Picker / trusted origin / reporting delivery — never the client secret). Leftover health emit on non-Zod throw. This beat does **not** decrypt. This beat does **not** refresh.

4. **Hand a one-time Picker, then verify the pick** — `POST .../picker/bootstrap` and `POST .../picker/selections/verify`. Same secret + owner gate. Bootstrap parses leftover `googlePickerBootstrapSchema` (`flow: folder | spreadsheet`) and **asks** already-recommended `bootstrapGooglePicker`. Verify parses leftover `googlePickerSelectionVerifySchema` and **asks** already-recommended `verifyGooglePickerSelection` (`selectionNonce`, `fileId`, plus unused `displayName` / `displayUrl` / `parentFolderId`). Bootstrap emits leftover health on non-Zod throw. Verify does **not**. This beat does **not** consume the selection reference. This beat does **not** create a file.

5. **Put a folder in the Owner's Drive** — `POST .../folders`. Same secret + owner gate. Parse leftover `googleDriveCreateFolderSchema`. **Ask** already-recommended `createGoogleDriveFolder`. Answer **201** `{ ok, data }`. No leftover health emit. This beat does **not** stamp tabs.

6. **Cut the Drive connection** — `DELETE .../connection`. Same secret + owner gate. **Ask** already-recommended `disconnectGoogleDrive` (revoke best-effort, always delete local; no-row is `{ disconnected: false }`, not 404). Answer 200. No leftover health emit.

7. **Prove the connection can write a test-shaped workbook** — `POST .../test-spreadsheet`. Same secret + owner gate. Parse leftover `googleDriveTestSpreadsheetSchema`. **Ask** already-recommended `createOAuthTestSpreadsheet`. Answer **201**. No leftover health emit. This beat does **not** create a reporting destination.

`sendApiError` / `recordOAuthHealthFailure` / `sendCompletionPage` / `completionRedirectUrl` / `escapeHtml` are beats inside these operations, not extra owner stories. `sendApiError` is leftover Zod `400` `{ ok: false, code: "invalid_request", error: "Invalid request", issues }` else leftover `sanitizeGoogleDriveApiError` (log 5xx category only). `sendCompletionPage` prefers 303 to leftover `completionRedirectUrl` + `google_drive=connected|error`; else HTML with escaped message. Invalid configured redirect swallows to HTML. They are private.

## Organization

Keep one file. This is the screenplay for “finish the Owner's Drive login when Google comes back without the secret, then let the signed owner start consent, see status, pick, write, or disconnect.” Already-recommended begin / complete / sanitize / owner gate / Picker / folder / leftover health tell already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleDriveOAuthRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a consume-Picker **adapter** so “the desk can finish destination create.” Do not invent a company-key **adapter** beside already-recommended `createGoogleServiceAccountAuth`. Do not invent a CRUD folder so `callback.ts` / `authorize.ts` / `status.ts` each get a file.

Do not move leftover `completeGoogleDriveOAuth` into this file so “the route owns the exchange.” Do not mount the callback after leftover `requireApiSecret` so “every `/api/v1` path is guarded.” Do not merge this router into `v1.routes.ts` so “one desk owns Drive.” Do not teach leftover extension login to connect Drive so “one unguarded auth.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ownerDriveDesk` | already-recommended public v1 desk mounts it **before** the secret so Google can finish login |
| `GET .../oauth/callback` (today unexported `handleOAuthCallback`) | `finishTheOwnersDriveLoginFromGooglesUnguardedRedirect` | Google cannot send the secret; HTML / 303, never JSON |
| `POST .../oauth/authorize` (today unexported handler) | `startTheOwnersDriveConsentOverHttp` | signed owner needs the URL without exchanging a code |
| `GET .../status` (today unexported handler) | `showWhetherDriveIsConnectedWithoutSecrets` | admin JSON + public config; never ciphertext |
| `POST .../picker/bootstrap` (today unexported handler) | `handTheOwnerAOneTimePickerOverHttp` | short-lived access token + nonce; leftover health emit |
| `POST .../picker/selections/verify` (today unexported handler) | `verifyThePickAndIssueAOneTimeSelectionReferenceOverHttp` | leftover destination later spends the reference; this desk does not |
| `POST .../folders` (today unexported handler) | `putAFolderInTheOwnerDriveOverHttp` | 201 create **adapter** |
| `DELETE .../connection` (today unexported handler) | `cutTheOwnerDriveConnectionOverHttp` | revoke may fail; local delete still happens |
| `POST .../test-spreadsheet` (today unexported handler) | `proveTheConnectionWithATestShapedWorkbookOverHttp` | 201 probe tabs; not a destination |

Keep the default export as the one-line alias until `v1.routes.ts` migrates. Do not make callers learn `sendApiError` / `sendCompletionPage` / `recordOAuthHealthFailure` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / `bootstrapGooglePicker`) here — those stay already-recommended Wave A. Do **not** add a consume route so “Picker can finish here.”

**No class for the workflow.** The one type that *does* earn a name is the completion handoff the unguarded callback already paints:

```ts
type OwnerDriveLoginFinishedForTheBrowser = {
  ok: boolean
  message: string
  redirectUrl?: string // trusted origin + google_drive=connected|error
}
```

That is the handoff from “already-recommended complete returned connected” to “the Owner closes the Google window or lands back on admin.” Do **not** add `refresh_token` onto that bag. Do **not** add `accessToken` so “callback can skip Picker health.” Do **not** add a Mongo `ClientSession` so “the route owns the upsert.”

Leave begin / complete / encrypt on already-recommended `googleDriveOAuth.service.ts`. Leave the signed-owner stop on already-recommended `ownerAuth.ts`. Leave Picker consume on leftover destination. Leave the global `/api/v1` secret on leftover `requireApiSecret`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// google-drive-oauth.routes.ts
// The Owner wants Vantage to act as them in Drive.
// Google will come back without the API secret. Finish that login.
// Then let the signed Drive owner start consent, see status,
// pick, write, or disconnect.

const ownerDriveDesk = Router()

// ── 1. Finish the Owner's Drive login from Google's redirect ─

ownerDriveDesk.get(
  "/api/v1/admin/google-drive/oauth/callback",
  finishTheOwnersDriveLoginFromGooglesUnguardedRedirect,
)

async function finishTheOwnersDriveLoginFromGooglesUnguardedRedirect(req, res) {
  if (googleDeniedThisConsent(req)) {
    return showTheOwnerTheDriveLoginFinished(res, {
      ok: false,
      message: publicMessageForCategory("oauth_provider_error"),
    })
  }
  try {
    const query = googleOAuthCallbackQuerySchema.parse(req.query)
    const status = await completeGoogleDriveOAuth(query.code, query.state)
    if (!status.connected) {
      throw new Error("Google Drive connection was not persisted")
    }
    return showTheOwnerTheDriveLoginFinished(res, {
      ok: true,
      message: "Google Drive is connected. You can close this window and return to Vantage.",
    })
  } catch (error) {
    return refuseTheUnguardedDriveCallbackWithoutLeakingGoogle(res, error)
  }
}

function showTheOwnerTheDriveLoginFinished(res, finished) {
  const redirectUrl = trustedAdminReturnWithGoogleDriveFlag(finished.ok)
  if (redirectUrl) return res.redirect(303, redirectUrl)
  return sendTheCloseThisWindowPage(res, finished)
}

// ── 2. Start the Owner's Drive consent ────────────────────

ownerDriveDesk.post(
  "/api/v1/admin/google-drive/oauth/authorize",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  startTheOwnersDriveConsentOverHttp,
)

async function startTheOwnersDriveConsentOverHttp(_req, res) {
  try {
    return res.json({ ok: true, data: await beginGoogleDriveOAuth() })
  } catch (error) {
    await tellReportingOauthHealthFailedUnlessZod(error)
    return refuseThisOwnerDriveAdminCall(res, error)
  }
}

// ── 3. Show whether Drive is connected, without secrets ───

ownerDriveDesk.get(
  "/api/v1/admin/google-drive/status",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  showWhetherDriveIsConnectedWithoutSecrets,
)

async function showWhetherDriveIsConnectedWithoutSecrets(_req, res) {
  try {
    const [status, publicConfig] = await Promise.all([
      getGoogleDriveConnectionStatus(),
      Promise.resolve(getGoogleDriveOAuthPublicConfig()),
    ])
    return res.json({
      ok: true,
      data: {
        ...sanitizeGoogleDriveConnectionStatus(status),
        config: publicConfig,
      },
    })
  } catch (error) {
    await tellReportingOauthHealthFailedUnlessZod(error)
    return refuseThisOwnerDriveAdminCall(res, error)
  }
}

// ── 4. Hand a one-time Picker, then verify the pick ───────

ownerDriveDesk.post(
  "/api/v1/admin/google-drive/picker/bootstrap",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  handTheOwnerAOneTimePickerOverHttp,
)

ownerDriveDesk.post(
  "/api/v1/admin/google-drive/picker/selections/verify",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  verifyThePickAndIssueAOneTimeSelectionReferenceOverHttp,
)

// ── 5–7. Put a folder / cut the connection / prove a workbook

ownerDriveDesk.post(
  "/api/v1/admin/google-drive/folders",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  putAFolderInTheOwnerDriveOverHttp,           // 201
)

ownerDriveDesk.delete(
  "/api/v1/admin/google-drive/connection",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  cutTheOwnerDriveConnectionOverHttp,
)

ownerDriveDesk.post(
  "/api/v1/admin/google-drive/test-spreadsheet",
  requireApiSecret,
  enforceGoogleDriveOwnerAccess,
  proveTheConnectionWithATestShapedWorkbookOverHttp, // 201
)

export default ownerDriveDesk
```

Read the finish-login path out loud: *Google came back to this process without the API secret. If Google said the owner denied consent, show the public provider-error sentence and do not emit leftover health. Otherwise parse code and state. Ask already-recommended complete. If the re-read is not connected, treat it as a persist miss. Show a close-this-window page, or 303 to the trusted admin origin with google_drive=connected. If complete failed, log only the category and the error class, tell leftover reporting health, and show the public sentence — 500 only when Drive is unavailable, otherwise 400. Do not return JSON. Do not return the refresh token. Do not put this path behind the secret.*

That is the operation. `router.get("/oauth/callback")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The global `/api/v1` secret does not cover this router.** Already-recommended public v1 desk mounts this file **before** `router.use("/api/v1", requireApiSecret)`. The seven owner-gated paths therefore attach leftover `requireApiSecret` themselves. That is load-bearing: the callback must stay unguarded, and authorize must still fail closed without a secret. Do not silently drop the per-route secret so “the global guard already ran.” Do not silently mount the callback after the global guard so “every `/api/v1` path is guarded” — Google cannot send `x-api-secret`.

2. **Callback remaps leftover JSON statuses.** Already-recommended `sanitizeGoogleDriveApiError` would keep a scope violation at 403. This desk remaps every callback failure except `google_drive_unavailable` to **400**. Denied Google query never throws and never emits leftover health. Do not silently import leftover `sendApiError` onto the callback so “one refuse owns every path.” Do not silently emit leftover health on deny so “every fail is an incident.”

3. **Leftover health emit is only on four paths.** Authorize, status, Picker bootstrap, and the callback catch **ask** leftover `emitReportingOAuthHealthFailure`. Picker verify, folder, disconnect, and test-spreadsheet skip it. Zod is skipped on the emit. The tell is swallowed. Do not silently add the emit to every owner-gated path so “observability is consistent” unless a test names the missing tell. Do not silently fail the HTTP call when leftover persist is down — leftover emit already never throws, and this desk already `.catch(() => undefined)`.

4. **`!status.connected` after complete is a persist re-read, not a second owner story.** Already-recommended complete upserts then **asks** leftover `getGoogleDriveConnectionStatus`. A missing row becomes this desk’s raw `Error` → leftover callback category `google_drive_unavailable` → 500 HTML. Do not silently drop the check so “complete already succeeded.” Do not silently treat it as 400 so “the Owner can retry without a 500.”

5. **`Promise.resolve(getGoogleDriveOAuthPublicConfig())` is a no-op.** Public config is sync. Parallel `Promise.all` still waits on leftover status. Do not silently make public config async so “the wrapper looks earned.” Leave the parallel read; drop the `Promise.resolve` when renaming if a test still names both fields.

6. **Picker verify accepts display fields and leftover Picker ignores them.** Leftover `verifyGooglePickerSelection` takes `displayName` / `displayUrl` / `parentFolderId` and trusts Drive metadata. Do not silently stop parsing them so “the route only sends what verify uses” until leftover Zod / leftover Picker migrate together. Do not silently trust the UI name so “we can skip a Drive get.”

7. **There is no consume HTTP route.** Leftover destination create spends the selection reference. Do not add `POST .../picker/selections/consume` so “the desk owns the ticket.” Do not move leftover `consumePickerSelectionReference` into this file.

8. **JSON Zod shape is not the public v1 refuse.** This desk’s Zod is `{ ok: false, code: "invalid_request", error: "Invalid request", issues }`. Already-recommended public v1 `sendError` and already-recommended extension-auth `sendAuthError` say `"Invalid request payload"` and do not set `code`. Do not silently import leftover `sendError` so “one refuse owns every router.”

9. **303 vs HTML is this desk’s browser seam.** Leftover config already asserts the completion URL against the trusted admin origin at load. This file appends `google_drive=connected|error` and swallows a bad `new URL` to HTML. Do not silently skip the query flag so “the admin origin is enough.” Do not silently 302 so “browsers keep the Google query.”

10. **Leave sibling modules alone.** Already-recommended begin / complete / sanitize / owner gate / Picker / folder / leftover health tell are already the right **depth**. This file orchestrates the unguarded finish and the seven owner-gated HTTP **adapters**.

## Testing

The **interface** is the test surface: the default `ownerDriveDesk` (mounted on already-recommended `publicV1Desk` **before** the secret) and `finishTheOwnersDriveLoginFromGooglesUnguardedRedirect` / `startTheOwnersDriveConsentOverHttp` / `showWhetherDriveIsConnectedWithoutSecrets` / the Picker pair / folder / disconnect / test-workbook.

Today there is **no** `google-drive-oauth.routes.test.ts`. `v1.routes.test.ts` does not name `/admin/google-drive/*`. Already-recommended `ownerAuth.test.ts` proves leftover HMAC against the status **path string**, not this router.

Add a route test that names the operation (inject leftover begin / complete / Picker / folder; do not boot Google or encrypt in the route file):

**Unguarded finish**
- `GET /api/v1/admin/google-drive/oauth/callback?error=access_denied` shows the public provider-error sentence (HTML or 303 `google_drive=error`) and does **not** **ask** leftover complete or leftover health.
- `?code&state` **asks** leftover `completeGoogleDriveOAuth` and shows the connected sentence (or 303 `google_drive=connected`) when status is `connected: true`.
- Leftover complete throw → leftover callback log bag (category + `errorName` only) + leftover health `reason: category` + HTML/303; HTTP 500 only for `google_drive_unavailable`.
- This path is registered on `publicV1Desk` **before** `router.use("/api/v1", requireApiSecret)` and has **no** leftover owner gate.

**Owner-gated admin**
- Authorize / status / Picker / folder / disconnect / test-spreadsheet each run leftover `requireApiSecret` then leftover `enforceGoogleDriveOwnerAccess`.
- Authorize **asks** leftover `beginGoogleDriveOAuth` and answers `{ ok, data }`.
- Status spreads leftover sanitize + leftover public config; `owner_email` and ciphertext stay off the JSON.
- Picker bootstrap **asks** leftover `bootstrapGooglePicker(flow)` and emits leftover health on non-Zod throw; verify **asks** leftover `verifyGooglePickerSelection` and does **not** emit.
- Folder and test-spreadsheet answer **201**. Disconnect **asks** leftover `disconnectGoogleDrive` (no-row is not 404).
- Zod fail → `400` `invalid_request` + `issues`, no leftover health.

**Not this file**
- Nonce hash / code exchange / encrypt / email check stay on already-recommended [google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md).
- Signed-owner 403 / scoped-key refuse stay on already-recommended [google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md).
- Public category table stays on already-recommended [google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md).
- Picker consume / denylist stay on already-recommended [google-drive-oauth-picker.md](google-drive-oauth-picker.md) + leftover destination.
- Folder / probe-tab create stay on already-recommended [google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md).
- Extension login stays on already-recommended [routes-extension-auth.md](routes-extension-auth.md).

Do **not** add a test per helper (`escapeHtml`, `completionRedirectUrl`, `recordOAuthHealthFailure`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendApiError` so “the test can unit the refuse.”

## What I would not do

- A `GoogleDriveOAuthRoutesService` class with `create` / `update` / `delete` / `authorize` / `callback`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `callback.ts` / `authorize.ts` / `status.ts` “for cleanliness.”
- Breaking the unguarded **seam**: the callback stays before `/api/v1` secret; do not put Google’s redirect behind `x-api-secret`.
- Treating leftover `completeGoogleDriveOAuth`, leftover `bootstrapGooglePicker`, leftover destination consume, leftover company service account, or leftover extension login as this story.
- Inventing a consume-Picker or company-key **adapter** that has only one caller in this pass.
- Silently adding leftover health emit to verify / folder / disconnect / test-spreadsheet, wrapping the callback in leftover `sendApiError`, mounting the callback after the global secret, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
