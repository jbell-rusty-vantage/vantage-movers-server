# Let The Owner Connect Their Google Account So Vantage Can Act As Them In Drive And Sheets — Begin A One-Time Consent (Store Only The State Hash), Complete Only If The Verified Email Is The Configured Owner And Google Returned Offline Access, Then Later Hand A Live Client, Prove The Token Still Refreshes, Or Disconnect (Revoke Best-Effort, Always Delete Local) — Never Invent The Company Service Account — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 1 of this service — `googleDriveOAuth.service.ts`
- Remaining in this service: `tokenEncryption.ts`, `oauthScopes.ts`, `oauthSecurity.ts`, `ownerAuth.ts`, `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open)
- Target: `src/services/googleDriveOAuth/googleDriveOAuth.service.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this connection file; leftover reporting adapters **ask** this file for a live client). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md) (that file picks how this **process** talks to Google **as the company**; leftover live reporting **refuses** that identity and requires this Owner login). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (Master / Source Company reporting rows via the service account — not the Owner’s Drive). Distinct from leftover reporting live reject: `reporting/live/liveTestSecurity.ts` `rejectServiceAccountCredentialsForLiveTest` / `assertLiveTestOAuthPrincipal` (**asks** status + health + client here after it refuses the company key). Distinct from leftover reporting adapters: `reporting/google/reportingSheetsAdapter.ts` / `reportingDriveAdapter.ts` / `live/liveTestOAuthAdapters.ts` / `live/liveGoogleOrchestration.ts` (they **use** the connected Owner; they do not begin or complete consent). Distinct from later siblings this file already orchestrates: `tokenEncryption.ts` (AES-GCM + owner AAD), `oauthScopes.ts` (openid / email / `drive.file` allowlist), later `ownerAuth.ts` (signed Owner **HTTP** gate — not the Google email check), later `oauthSecurity.ts` (public error categories), later `picker.service.ts` (asks status + health, then hands Picker a short-lived access token), later `spreadsheet.service.ts` / `driveMetadata.service.ts` / `managedTab.service.ts` (ask the live client, then talk to Drive/Sheets). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (env-var **names**, owner email, client id/secret, redirect, encryption key — this file **asks** `getGoogleDriveOAuthConfig`). Distinct from Wave B `routes/google-drive-oauth.routes.ts` (authorize / status / disconnect behind secret + later owner gate; **unguarded** callback is the complete **seam**). Distinct from skipped barrel `index.ts` (re-exports). This checkout’s `CONTEXT.md` does not define a Drive OAuth / Owner Google login term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **authorize / callback / status / disconnect routes, then everyone who must act as the Owner.** Wave B `routes/google-drive-oauth.routes.ts` — `POST .../oauth/authorize` asks `beginGoogleDriveOAuth`; unguarded `GET .../oauth/callback` asks `completeGoogleDriveOAuth`; `GET .../status` asks `getGoogleDriveConnectionStatus` then `sanitizeGoogleDriveConnectionStatus`; `DELETE .../connection` asks `disconnectGoogleDrive`. Later Picker: `picker.service.ts` asks status + `getGoogleDriveAccessTokenHealth` (does **not** ask the live client). Later Drive/Sheets siblings: `spreadsheet.service.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` ask `getConnectedGoogleOAuthClient`. Leftover reporting: `reportingSheetsAdapter.ts` / `reportingDriveAdapter.ts` / `liveTestOAuthAdapters.ts` ask the live client; `liveTestSecurity.ts` asks status + health + client; `liveGoogleOrchestration.ts` asks health. Barrel: `index.ts` re-exports the public names. Tests: `googleDriveOAuth.test.ts` locks only `hashOAuthState`; `oauthHardening.test.ts` locks sanitize + `assertGoogleDriveSecretsRedacted` (and Wave B public config). Not this **interface**: later owner HTTP gate, later scope allowlist math, later encrypt/decrypt, later folder/spreadsheet create, later Picker bootstrap, leftover reporting destination writes, company service-account construct.
- Seams callers need: begin consent vs complete connection (owner-gated authorize vs unguarded callback); internal status vs sanitized admin JSON; live OAuth client vs access-token health (Drive/Sheets adapters vs Picker / live harness); revoke-at-Google vs always-delete-local
- Split later (only if the file outgrows one sitting): this ~419-line file is one sitting if you read it as let the Owner connect their Google account so Vantage can act as them in Drive and Sheets, begin a one-time consent (store only the state hash), complete only if the verified email is the configured owner and Google returned offline access, then later hand a live client, prove the token still refreshes, or disconnect (revoke best-effort, always delete local), never invent the company service account. If it later splits: `beginOwnerDriveConsent.ts` / `completeOwnerDriveConnection.ts` / `readWhetherOwnerDriveIsConnected.ts` / `disconnectOwnerDrive.ts` / `handCallersALiveOwnerOAuthClient.ts` / `proveTheOwnerTokenStillRefreshes.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `auth.ts`, and never merge later token encryption, later scope allowlist, later owner HTTP gate, later Picker, later folder create, leftover reporting adapters, or already-recommended company service account into this file

`beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / `getConnectedGoogleOAuthClient` are executor mechanics. The owner question is: *The Owner wants Vantage to open Drive and write reporting workbooks as the Owner, not as the company service account. Start a one-time Google consent. Remember only the hash of the nonce, for ten minutes, for the configured owner email. When Google comes back to the unguarded callback, consume that unused unexpired hash. Exchange the code. The verified Google email must be the configured owner. The granted scopes must be exactly openid + email + drive.file. Google must return a refresh token (offline access). Encrypt that token bound to the owner email, upsert the connection, and forget last-used. Later, Picker and the live harness may ask whether the token still refreshes. Later, Drive and Sheets adapters may ask for a live client. The Owner may disconnect: try to revoke at Google, then always delete the local row even if Google is down. Do not invent the company key. Do not return the refresh token to the admin JSON. Do not skip the email check because authorize already had a login hint.*

Later token encryption, later scope allowlist, later owner HTTP gate, later Picker, later folder / metadata / managed-tab, leftover reporting adapters, and already-recommended company identity already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “let the Owner connect their Google account so Vantage can act as them in Drive and Sheets — begin a one-time consent (store only the state hash), complete only if the verified email is the configured owner and Google returned offline access, then later hand a live client, prove the token still refreshes, or disconnect (revoke best-effort, always delete local) — never invent the company service account” story, not “an OAuth CRUD helper,” and not the company service account / the Picker / the folder create:

1. **Begin Owner Drive consent** — `beginGoogleDriveOAuth`. Ask Wave B `getGoogleDriveOAuthConfig`. Connect Mongo. Mint 32 random bytes as base64url `state`. Persist `GoogleOAuthState` with `nonce_hash: hashOAuthState(state)`, `owner_email: config.ownerEmail`, `expires_at` now + 10 minutes. Build `OAuth2Client` from client id / secret / redirect. Return `generateAuthUrl` with `access_type: "offline"`, `prompt: "consent"`, `login_hint: config.ownerEmail`, the allowed scopes, and the **plaintext** state (Google will echo it). This beat does not talk to Google’s token endpoint. This beat does not store the plaintext state. This beat does not check later `ownerAuth` — the route does.

2. **Complete Owner Drive connection** — `completeGoogleDriveOAuth(code, state)`. Connect Mongo. `findOneAndDelete` an unexpired state whose hash matches and whose `owner_email` equals the configured owner. Missing / mismatched / expired → `BadRequestError` (start again). Exchange `code` via `getToken`; Google failure → `IntegrationError` (start again). Require `id_token`. `verifyIdToken` against `config.clientId`. Require a trimmed lowercased email with `email_verified === true`. That email must equal `config.ownerEmail` or `UnauthorizedError` 403 (“not authorized for reporting”). Normalize granted scopes and `assertAllowedOAuthScopes(..., "oauth_callback")`. Missing `refresh_token` → `IntegrationError` (revoke in Google Account permissions and connect again). Encrypt the refresh token with later `encryptGoogleRefreshToken` bound to the owner email. Upsert `GoogleDriveConnection` on `owner_email`: set google email, ciphertext + iv + auth tag + encryption version, scopes, `connected_at` now; **unset** `last_used_at`. Return operation 3. This beat does not return the refresh token. This beat does not create a folder. This beat does not call Picker.

3. **Read whether Owner Drive is connected** — `getGoogleDriveConnectionStatus`. No row → `{ connected: false, owner_email }`. Row → `assertAllowedOAuthScopes(connection.scopes, "stored_connection")` then the connected bag (google email, scopes, connected_at, updated_at, optional last_used_at). This beat does not decrypt. This beat does not refresh. `sanitizeGoogleDriveConnectionStatus` is the admin-JSON **seam**: drop `owner_email`; never include ciphertext. `assertGoogleDriveSecretsRedacted` walks a payload and throws if forbidden key names appear (client secret, refresh token, encryption key, env names). Those two are not a fourth owner operation.

4. **Disconnect Owner Drive** — `disconnectGoogleDrive`. No row → `{ disconnected: false, google_revoked: false }` (not a 404). Else decrypt, `revokeToken` (catch → `google_revoked: false`; comment says local deletion is still required), `deleteOne` the connection, `{ disconnected: true, google_revoked }`. This beat does not leave the row because Google revoke failed. This beat does not require the token to still refresh.

5. **Hand callers a live OAuth client as the Owner** — `getConnectedGoogleOAuthClient`. No row → `NotFoundError` (“Complete the owner authorization first.”). Else assert stored scopes (`"oauth_client"`), decrypt, `setCredentials({ refresh_token })`, stamp `last_used_at`, return the client. This beat does not call `getAccessToken`. This beat does not return the refresh token string. Spreadsheet / metadata / managed-tab / leftover reporting adapters ask this **seam**.

6. **Prove the Owner token still refreshes** — `getGoogleDriveAccessTokenHealth`. No row → `{ healthy: false, reason: "not_connected" }`. Scope assert failure → `{ healthy: false, reason: "scope_violation", google_email }` (does **not** throw). Else decrypt, `getAccessToken`. Missing token or thrown refresh → `{ healthy: false, reason: "refresh_failed", google_email }`. Success → stamp `last_used_at`, `{ healthy: true, access_token, expires_at, google_email }` (`expiry_date` or now + 1 hour). Picker bootstrap and leftover live harness ask this **seam**. This beat does not create Drive clients.

There is no company-key operation. There is no Picker nonce operation. There is no folder-create operation. Later encrypt/decrypt, later scope math, later owner HTTP gate, and Wave B env names already live in other files.

## Organization

Keep one file as the screenplay for “let the Owner connect their Google account so Vantage can act as them in Drive and Sheets — begin a one-time consent (store only the state hash), complete only if the verified email is the configured owner and Google returned offline access, then later hand a live client, prove the token still refreshes, or disconnect (revoke best-effort, always delete local) — never invent the company service account.” Later `tokenEncryption.ts`, later `oauthScopes.ts`, later `ownerAuth.ts`, later `oauthSecurity.ts`, later Picker / folder / metadata / managed-tab, leftover reporting adapters, and already-recommended `serviceAccount.ts` already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleDriveOAuthService` class. Do not invent a persist / finalize **seam** that pretends this is a domain command — the consume-state-then-upsert order is this file’s own before/after. Do not invent a company-key **adapter** beside already-recommended `createGoogleServiceAccountAuth`. Do not invent a second Picker **adapter** beside later `bootstrapGooglePicker`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `auth.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleAuth/serviceAccount.ts` so “we already have Google.” Do not move this into `reporting/google/reportingSheetsAdapter.ts` so “reporting already asks for a client.” Do not move this into Wave B `config/domain/googleDriveOAuth.ts` so “the names file can also talk to Google.” Do not move this into later `ownerAuth.ts` so “owner access can also complete the callback.” Do not silently teach leftover reporting to construct `GoogleAuth` from the company key so “one Google login.”

**External interface** stays small (this is the test surface). Consent, complete, status, disconnect, live client, and token health are one story’s Owner login, not six CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `beginGoogleDriveOAuth` | `beginOwnerDriveConsent` | owner-gated authorize route needs the URL + expiry without exchanging a code |
| `completeGoogleDriveOAuth` | `completeOwnerDriveConnection` | unguarded callback needs consume-state → identity → encrypt → upsert |
| `getGoogleDriveConnectionStatus` | `readWhetherOwnerDriveIsConnected` | status route, Picker, leftover live principal all need the raw bag (including `owner_email`) |
| `sanitizeGoogleDriveConnectionStatus` | `showTheOwnerDriveConnectionWithoutSecrets` | admin JSON must drop `owner_email` and never grow ciphertext |
| `disconnectGoogleDrive` | `disconnectOwnerDrive` | delete route; revoke may fail and local delete must still happen |
| `getConnectedGoogleOAuthClient` | `handCallersALiveOwnerOAuthClient` | Drive/Sheets siblings and leftover reporting adapters need a client, not an access-token string |
| `getGoogleDriveAccessTokenHealth` | `proveTheOwnerTokenStillRefreshes` | Picker and leftover live harness need healthy / not_connected / refresh_failed / scope_violation (and the short-lived token when healthy) |
| `hashOAuthState` | `hashTheOneTimeConsentNonce` | tests and begin/complete share SHA-256 hex; do not persist plaintext |
| `assertGoogleDriveSecretsRedacted` | `refuseAPayloadThatLeakedOwnerDriveSecrets` | hardening tests + public-config assert |
| `GoogleDriveConnectionStatus` | `OwnerDriveConnection` | discriminated connected / not |
| `GoogleDriveAccessTokenHealth` | `OwnerDriveTokenHealth` | discriminated healthy / reason |

Keep the old names as one-line aliases until the authorize route, callback, status route, disconnect route, later Picker, later Drive/Sheets siblings, and leftover reporting adapters migrate. Do not make callers learn `findOneAndDelete` / `getToken` / `encryptGoogleRefreshToken` as the domain language.

**Principle: old exports stay as aliases.** `beginGoogleDriveOAuth` remains the imported name until the authorize route points at the story name. `getConnectedGoogleOAuthClient` remains the imported name until spreadsheet / metadata / managed-tab / leftover reporting migrate.

**No class for the workflow.** The type that *does* earn a name is the pending consent the callback must consume:

```ts
type OwnerDriveConsentInProgress = {
  nonce_hash: string
  owner_email: string
  expires_at: Date
}
```

That is the handoff from “the Owner started Google consent” to “Google came back with a code.” Do **not** add `refresh_token` onto this type so “consent already has the token,” do **not** add `access_token` so “begin can skip complete,” and do **not** add `spreadsheetId` so “this file can write reporting.”

`hashOAuthState` stays exported because the file test already locks the digest. It is not a second public operation. Do not add `createOAuthClient` as a public **seam** so “reporting can build its own OAuth2.” Do not add `encryptGoogleRefreshToken` as a public **seam** on this file — later `tokenEncryption.ts` already owns it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// googleDriveOAuth.service.ts
// The Owner wants Vantage to open Drive
// and write reporting workbooks as the Owner,
// not as the company service account.
// Start a one-time Google consent.
// Remember only the hash of the nonce,
// for ten minutes, for the configured owner email.
// When Google comes back to the unguarded callback,
// consume that unused unexpired hash.
// The verified Google email must be the configured owner.
// Google must return a refresh token.
// Encrypt it bound to the owner email.
// Later, Picker may ask whether the token still refreshes.
// Later, Drive and Sheets may ask for a live client.
// The Owner may disconnect:
// try to revoke at Google, then always delete the local row.
// Do not invent the company key.
// Do not return the refresh token to the admin JSON.
// Do not skip the email check because authorize already had a login hint.

// ── 1. Begin Owner Drive consent ──────────────────────────

export async function beginOwnerDriveConsent()
  : Promise<{ authorization_url: string; expires_at: Date }>

function mintAOneTimeConsentNonce()            // 32 bytes base64url — never persist plaintext
export function hashTheOneTimeConsentNonce(state)
function rememberOnlyTheNonceHashForTenMinutes(hash, ownerEmail)
function askGoogleForOfflineConsentAsThisOwner(state)  // login_hint is a hint, not enforcement

// ── 2. Complete Owner Drive connection ────────────────────

export async function completeOwnerDriveConnection(code, state)
  : Promise<OwnerDriveConnection>

function consumeTheUnusedUnexpiredConsent(state, ownerEmail)  // findOneAndDelete
function exchangeTheCodeOrTellTheOwnerToStartAgain(code)
function refuseUnlessTheVerifiedGoogleEmailIsTheConfiguredOwner(idToken)
function refuseUnlessGoogleGrantedExactlyTheAllowedScopes(tokens, "oauth_callback")
function refuseUnlessGoogleReturnedOfflineAccess(tokens)
function encryptTheRefreshTokenBoundToThisOwner(refreshToken)
function upsertTheOwnerDriveConnectionAndForgetLastUsed(encrypted)

// ── 3. Read whether Owner Drive is connected ──────────────

export async function readWhetherOwnerDriveIsConnected()
  : Promise<OwnerDriveConnection>

export function showTheOwnerDriveConnectionWithoutSecrets(status)
export function refuseAPayloadThatLeakedOwnerDriveSecrets(payload)

function refuseStoredScopesThatAreNoLongerAllowed(scopes, "stored_connection")

// ── 4. Disconnect Owner Drive ─────────────────────────────

export async function disconnectOwnerDrive()
  : Promise<{ disconnected: boolean; google_revoked: boolean }>

function tryToRevokeAtGoogleThenAlwaysDeleteLocal(refreshToken)

// ── 5. Hand callers a live OAuth client as the Owner ──────

export async function handCallersALiveOwnerOAuthClient()
  : Promise<Auth.OAuth2Client>

function decryptTheRefreshTokenOrRefuseUnsupportedVersion(connection)
function stampLastUsedNow()

// ── 6. Prove the Owner token still refreshes ──────────────

export async function proveTheOwnerTokenStillRefreshes()
  : Promise<OwnerDriveTokenHealth>
  // not_connected | scope_violation | refresh_failed | healthy + access_token
```

Read the primary path out loud: *The Owner hits authorize. We mint a nonce, store only its hash for ten minutes under the configured owner email, and send them to Google with offline + consent + a login hint. Google comes back to the unguarded callback with a code and the nonce. We consume that unused unexpired hash. If it is gone, start again. We exchange the code. If Google did not return a verifiable, verified email that is exactly the configured owner, refuse. If the scopes are not exactly the allowlist, refuse. If there is no refresh token, tell the Owner to revoke the old grant and start again. We encrypt the refresh token bound to the owner email, upsert the connection, and forget last-used. The admin status JSON may see connected + google email + scopes, never the owner email field, never the ciphertext. Later Picker asks whether the token still refreshes and takes the short-lived access token when it does. Later Drive and Sheets ask for a live client. If the Owner disconnects, we try to revoke at Google and we still delete the local row if Google is down. We never construct the company service account here.*

That is the operation. `beginGoogleDriveOAuth` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` are executor mechanics.** The owner story is “begin Owner Drive consent” / “complete Owner Drive connection.” Keep the old names as aliases. Do not grow a `GoogleDriveOAuthService` with `create` / `update` / `delete`.

2. **Consume-state happens before `getToken`.** `findOneAndDelete` wins even when Google later fails the exchange. The Owner must start again. That is load-bearing one-time-ness on an unguarded callback. Do not silently swap to “exchange first, then consume” so “a Google blip can retry” — that would let a captured code be replayed if consume failed. Do not silently leave the state row on `getToken` failure so “the Owner can refresh” without an owner decision that a ten-minute nonce may be reused after a failed exchange.

3. **`login_hint` is not enforcement.** Begin sends `login_hint: config.ownerEmail`. Complete is the **seam** that refuses a different verified email. Do not silently drop the complete email check so “Google already saw the hint.” Do not silently skip `email_verified` so “the hint was enough.”

4. **Missing refresh token is a known Google trap.** `prompt: "consent"` + `access_type: "offline"` is why complete can demand `refresh_token`. Do not silently drop `prompt: "consent"` so “returning users skip the screen” — Google then often omits the refresh token and complete already throws. Do not silently store an access token only so “we can still write today.”

5. **Live client and token health both decrypt and `setCredentials`.** Two **adapters** of “use the stored refresh token”: adapters want `OAuth2Client`; Picker / live harness want a short-lived access token plus a reason. Align by story later. Do not silently make Picker call `handCallersALiveOwnerOAuthClient` so “one decrypt” if that drops `not_connected` / `refresh_failed` / `scope_violation` as values. Do not silently make leftover reporting call `getAccessToken` here so “one health.” Do not return the refresh token string from either export.

6. **`last_used_at` is stamped in two places and cleared on complete.** Complete `$unset`s it. Client and health `$set` it. Status may show it. Do not silently stamp last-used on status reads so “the dashboard counts as use.” Do not silently keep last-used across reconnect so “the old session is still warm.”

7. **Disconnect swallows revoke failure.** The comment is the invariant: local delete still prevents Vantage from using the token. Do not silently keep the row when `revokeToken` throws so “we can retry revoke.” Do not silently skip revoke so “delete is cheaper.” Return `google_revoked` either way; do not hide it.

8. **Health maps scope failure to a reason; the live client throws.** Same later `assertAllowedOAuthScopes`, two shapes. Picker needs a reason. Adapters need a hard fail. Do not silently make health throw so “one assert.” Do not silently make the live client return `null` so “callers can branch.”

9. **Sanitize drops `owner_email` even on the connected bag.** Tests lock that. The raw status still has `owner_email` for leftover live principal (`assertLiveTestOAuthPrincipal` compares `connection.google_email` to `config.ownerEmail`, not the sanitized bag). Do not silently put `owner_email` back on the admin JSON so “the Owner can see who we expected.” Do not silently drop `google_email` from the connected sanitize.

10. **`assertGoogleDriveSecretsRedacted` is a walk of key names, not encryption.** It is the hardening **seam** for public config + sanitized status. It does not prove the refresh token is absent from Mongo. Do not silently call it inside complete so “upsert is safe” — that would throw on a document that must store `encrypted_refresh_token`. Do not log the forbidden values when it fires.

11. **`hashOAuthState` is SHA-256 hex.** Tests lock determinism and “not equal to plaintext.” Do not persist plaintext state. Do not silently switch to HMAC with the encryption key so “state is keyed” without a paired migrate of existing `GoogleOAuthState` rows (ten-minute TTL makes that tempting — still a behavior change, not this rename).

12. **Unsupported `encryption_version` throws.** `encryptedTokenFromConnection` and later decrypt both refuse `!== 1`. Do not silently accept version 2 so “we can rotate” without a later encryption pass. Do not pull later `tokenEncryption.ts` into this file so “the service owns AES.”

13. **This file does not cache the OAuth client.** Every caller builds a new `OAuth2Client` and decrypts again. Do not add a module-level client cache so “Sheets and Picker share a token” — health must be allowed to fail independently, and leftover live tests must be allowed to refuse the company key on every call.

14. **Company service account is a different person.** Already-recommended `serviceAccount.ts` is the process identity. Leftover `rejectServiceAccountCredentialsForLiveTest` throws when any company-key indicator is present, then asks **this** file. Do not read `GOOGLE_SERVICE_ACCOUNT_*` here so “we already have Google.” Do not write a refresh token from a service-account JWT so “Drive can skip the Owner.”

15. **Later owner HTTP gate is a different Owner check.** Later `requireGoogleDriveOwnerActor` compares the signed admin email to `config.ownerEmail` and rejects scoped keys. The callback is unguarded on purpose; the nonce + Google email are the auth. Do not silently put `enforceGoogleDriveOwnerAccess` on the callback so “every Drive route is owner-gated” — Google cannot send those headers. Do not silently skip the Google email check because the authorize route already passed the HTTP gate.

16. **Wave B owns the env-var names.** `getGoogleDriveOAuthConfig` stays in `config/domain/googleDriveOAuth.ts`. Do not copy client secret / encryption key literals into this file so “the service owns its env.” Do not open Wave B in this pass.

17. **Complete re-reads status after upsert.** It could return the upserted document. Today it calls operation 3 (which re-asserts scopes). Do not silently return the upsert result so “one less read” if that skips the stored-scope assert. Do not skip the post-upsert read so “complete is faster.”

18. **Leave sibling modules alone.** Later encrypt/decrypt, later scope allowlist, later owner HTTP gate, later error categories, later Picker, later folder / metadata / managed-tab, leftover reporting adapters, and already-recommended company identity stay where they are. This file orchestrates begin → complete → status / client / health / disconnect.

## Testing

The **interface** is the test surface: the nine exports (story names, old names as aliases). Begin-hash-not-plaintext, consume-once, owner-email refuse, missing refresh token, sanitize, disconnect-deletes-even-when-revoke-fails, live-client vs health shapes, and the forbidden identities are part of that **interface**. Do not boot Google. Do not boot Drive. Do not boot Picker. Stub `OAuth2Client` / Mongo and assert URL / throw / upsert / delete.

Today `googleDriveOAuth.test.ts` only locks `hashOAuthState` (plus later encryption and later folder-id tests that do **not** belong on this **interface**). `oauthHardening.test.ts` locks sanitize + secrets-redacted. There is no begin / complete / disconnect / client / health test. Add file tests that name the operation:

**Begin Owner Drive consent**
- Persists `nonce_hash` (64 hex), not the plaintext state.
- `expires_at` is ~10 minutes from now.
- Authorization URL includes `access_type=offline`, `prompt=consent`, `login_hint` = configured owner, and the plaintext state.
- Does not call `getToken`.
- Does not write `GoogleDriveConnection`.

**Complete Owner Drive connection**
- Unknown / expired / wrong-owner hash → `BadRequestError`; no connection upsert.
- State row is gone after a failed `getToken` (today’s consume-first). Do not “fix” that to leave the row in this rename.
- Missing `id_token` / unverified email / email ≠ configured owner → `UnauthorizedError`; no upsert.
- Granted extra scope (e.g. full `drive`) → scope violation; no upsert.
- Missing `refresh_token` → `IntegrationError` mentioning revoke-and-reconnect; no upsert.
- Happy path: encrypt bound to owner email, upsert on `owner_email`, `$unset last_used_at`, return `connected: true` with `google_email`.
- Happy path does not return `refresh_token` / `encrypted_refresh_token` / `client_secret`.

**Read whether Owner Drive is connected**
- No row → `{ connected: false, owner_email }`.
- Stored scopes no longer allowed → throw (status path), not a health reason.
- `sanitizeGoogleDriveConnectionStatus` drops `owner_email` when disconnected and when connected.
- Sanitized connected bag still has `google_email` + `scopes`.
- `assertGoogleDriveSecretsRedacted` throws on `refresh_token` / `encrypted_refresh_token` / `GOOGLE_OAUTH_CLIENT_SECRET` and does **not** throw on `{ connected: true, google_email, scopes }`.

**Disconnect Owner Drive**
- No row → `{ disconnected: false, google_revoked: false }` (not `NotFoundError`).
- `revokeToken` throws → still `deleteOne`; `{ disconnected: true, google_revoked: false }`.
- `revokeToken` succeeds → `{ disconnected: true, google_revoked: true }`; row gone.

**Hand callers a live OAuth client as the Owner**
- No row → `NotFoundError`.
- Scope violation throws (does not return a health reason).
- Sets `refresh_token` credentials (assert options; do not call Google).
- Stamps `last_used_at`.
- Does not return the refresh token string.

**Prove the Owner token still refreshes**
- No row → `{ healthy: false, reason: "not_connected" }` (not a throw).
- Scope violation → `{ healthy: false, reason: "scope_violation" }` (not a throw).
- `getAccessToken` throws / empty token → `{ healthy: false, reason: "refresh_failed", google_email }`.
- Success → `{ healthy: true, access_token, expires_at, google_email }` and stamps `last_used_at`.

**Not this interface**
- AES-GCM / owner AAD stay on later `tokenEncryption.ts` (existing encrypt tests may stay there; do not move them onto this export except as “complete called encrypt”).
- Allowlist math / `userinfo.email` alias stay on later `oauthScopes.ts` (existing `oauthScopes.test.ts`).
- Signed admin proxy / scoped-key 403 stay on later `ownerAuth.ts` (existing `ownerAuth.test.ts`).
- Public error categories stay on later `oauthSecurity.ts`.
- Picker nonce / selection / bootstrap allowlist stay on later `picker.service.ts`.
- Folder URL parse / test spreadsheet stay on later `spreadsheet.service.ts`.
- Company JSON / TEST_MODE file fence stay on already-recommended `serviceAccount.ts`.
- Leftover `rejectServiceAccountCredentialsForLiveTest` stays on leftover `liveTestSecurity.ts`.
- Env-var **names** stay on Wave B `config/domain/googleDriveOAuth.ts`.

Do **not** add a test per helper (`mintAOneTimeConsentNonce`, `consumeTheUnusedUnexpiredConsent`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file returns `refresh_token` on status or complete — it must not. Do not add a test that begin persists plaintext state — it must not. Do not add a test that complete accepts a different Google email when `login_hint` was set — it must not. Do not add a test that disconnect keeps the row when revoke fails — it must not. Do not add a test that the callback route now requires `enforceGoogleDriveOwnerAccess` — it must not, in this rename. Do not add a test that leftover reporting now constructs the company `GoogleAuth` — it must not. Do not add a test that Picker now asks `getConnectedGoogleOAuthClient` — it must not, in this rename. Do not add a test that health throws on scope violation — it must not (today it returns a reason). Do not add a test that this file creates a Drive folder — it must not.

## What I would not do

- A `GoogleDriveOAuthService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `connectMongo`.
- Moving this into a CRUD folder, or into `googleAuth/serviceAccount.ts` / `reporting/google/reportingSheetsAdapter.ts` / `config/domain/googleDriveOAuth.ts` / later `ownerAuth.ts` “for cleanliness.”
- Breaking the consume-state-before-exchange **seam**, the verified-owner-email **seam**, the offline-refresh-token **seam**, the revoke-then-always-delete **seam**, or the client-vs-health **seam**.
- Treating later `tokenEncryption.ts` / later `oauthScopes.ts` / later `ownerAuth.ts` / later `picker.service.ts` / later `spreadsheet.service.ts` / leftover reporting adapters / already-recommended `serviceAccount.ts` as this story.
- Inventing a company-key **seam** that has only one **adapter** here, or a Picker-bootstrap **seam** that has only one **adapter** here, or a folder-create **seam** that has only one **adapter** here.
- Silently exchanging the code before consuming state, or silently accepting a non-owner Google email, or silently dropping `prompt: "consent"`, or silently keeping the connection when revoke fails, or silently putting `owner_email` / `refresh_token` on the admin JSON, or silently constructing the company service account from this file, or silently gating the callback with later `enforceGoogleDriveOwnerAccess`, or silently teaching Picker to ask the live client, or silently teaching leftover reporting to use the company key.
- Writing a whole-folder recommendation that pretends later Picker / folder / managed-tab / leftover reporting are this module.
- Opening `tokenEncryption.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `beginOwnerDriveConsent`.
