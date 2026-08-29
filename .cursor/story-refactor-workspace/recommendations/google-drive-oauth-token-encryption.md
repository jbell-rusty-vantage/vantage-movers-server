# Lock The Owner's Google Refresh Token To This Process And This Owner Email — AES-256-GCM With A Fresh Twelve-Byte IV, Associated Data Bound To The Trimmed Lowercased Owner Email, Version 1 Only — Fail Closed If The Key Is Not Thirty-Two Bytes, The Version Is Not 1, Or The Owner Email Does Not Match — Never Store The Plaintext Token, Never Invent The Company Service Account Key — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 2 of this service — `tokenEncryption.ts`
- Remaining in this service: `oauthScopes.ts`, `oauthSecurity.ts`, `ownerAuth.ts`, `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` already recommended)
- Target: `src/services/googleDriveOAuth/tokenEncryption.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this encryption file; leftover reporting adapters **ask** already-recommended `googleDriveOAuth.service.ts` for a live client, which **asks** this file to unlock). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — it **asks** this file to lock on complete and unlock on disconnect / client / health; it does **not** own AES). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md) (that file picks how this **process** talks to Google **as the company**; leftover live reporting **refuses** that identity; this file never reads a service-account JSON). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (Master / Source Company reporting rows via the service account — not the Owner’s refresh token). Distinct from later `oauthScopes.ts` (openid / email / `drive.file` allowlist — this file does not look at scopes). Distinct from later `ownerAuth.ts` (signed Owner **HTTP** gate — not the AAD email bind). Distinct from later `oauthSecurity.ts` (public error categories — this file throws raw `Error`). Distinct from later Picker / folder / metadata / managed-tab (they never import this file; they ask the already-recommended connection **module**). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (`decodeEncryptionKey` already refuses a non-32-byte / non-canonical-base64 `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — this file **re-asserts** 32 bytes on the Buffer it is handed; it does **not** read the env name). Distinct from Wave B `models/GoogleDriveConnection.ts` (stores the four ciphertext fields this file returns; it does **not** encrypt). Distinct from skipped barrel `index.ts` (does **not** re-export this file — callers go through the connection **module**). This checkout’s `CONTEXT.md` does not define a Drive OAuth / Owner refresh-token-at-rest term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **one runtime import site. Tests live on a sibling file.** Already-recommended `googleDriveOAuth.service.ts` — `completeGoogleDriveOAuth` asks `encryptGoogleRefreshToken(refresh_token, config.tokenEncryptionKey, config.ownerEmail)` then spreads the bag onto `GoogleDriveConnection`; `disconnectGoogleDrive` / `getConnectedGoogleOAuthClient` / `getGoogleDriveAccessTokenHealth` ask sibling `encryptedTokenFromConnection` then `decryptGoogleRefreshToken(..., config.tokenEncryptionKey, config.ownerEmail)`. Tests: `googleDriveOAuth.test.ts` locks round-trip (ciphertext ≠ plaintext; decrypt equals the input) and owner-identity AAD bind (decrypt with a different email throws). Not this **interface**: Wave B `decodeEncryptionKey` (env shape only), later scope allowlist, later owner HTTP gate, later Picker bootstrap, later folder create, leftover reporting adapters, already-recommended company service account, sibling `assertGoogleDriveSecretsRedacted` (key-name walk, not AES). Sibling `oauthHardening.test.ts` / `ownerAuth.test.ts` / `pickerVerification.test.ts` set `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` so Wave B config can boot — they do **not** import this file.
- Seams callers need: lock-for-storage vs unlock-for-this-process; persistable ciphertext bag vs plaintext refresh token; owner-email AAD bind (same folded email must encrypt and decrypt); version-1 refuse (this file **and** sibling `encryptedTokenFromConnection`); 32-byte key assert (this file **and** Wave B `decodeEncryptionKey`)
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as lock the Owner’s Google refresh token to this process and this owner email, AES-256-GCM with a fresh twelve-byte IV, associated data bound to the trimmed lowercased owner email, version 1 only, fail closed if the key is not thirty-two bytes, the version is not 1, or the owner email does not match, never store the plaintext token, never invent the company service account key. If it later splits: `lockTheOwnerRefreshTokenForStorage.ts` / `unlockTheOwnerRefreshTokenForThisProcess.ts` — story files, never `create.ts` / `encrypt.ts` / `decrypt.ts` / `update.ts` / `delete.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, later `oauthScopes.ts`, later `ownerAuth.ts`, Wave B `decodeEncryptionKey`, leftover reporting adapters, or already-recommended company service account into this file

`encryptGoogleRefreshToken` / `decryptGoogleRefreshToken` are executor mechanics. The owner question is: *Google just handed this process a refresh token because the Owner completed Drive consent. Mongo must not store that string. Lock it with AES-256-GCM, a fresh twelve-byte IV, and associated data bound to the configured owner email (trimmed, lowercased, prefixed `vantage-google-drive-oauth:v1:`). Hand back ciphertext, IV, auth tag, and version 1 so the connection row can persist those four fields. Later, when disconnect, the live client, or token health needs the refresh token, unlock with the same 32-byte key and the same owner email. A different email, a wrong key, a tampered tag, or any version other than 1 must fail closed. Do not invent the company service-account JSON. Do not read the env-var name. Do not return the plaintext token to admin JSON. Do not talk to Google.*

Already-recommended Owner login, later scope allowlist, later owner HTTP gate, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended company identity, and Wave B env-key decode already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “lock the Owner’s Google refresh token to this process and this owner email — AES-256-GCM with a fresh twelve-byte IV, associated data bound to the trimmed lowercased owner email, version 1 only — fail closed if the key is not thirty-two bytes, the version is not 1, or the owner email does not match — never store the plaintext token, never invent the company service account key” story, not “an encrypt CRUD helper,” and not the Owner login / the company service account / the Picker:

1. **Lock the Owner refresh token for storage** — `encryptGoogleRefreshToken(refreshToken, key, ownerEmail)`. `assertKey`: `key.length !== 32` → throw (`Google OAuth token encryption key must be 32 bytes`). Mint `randomBytes(12)` as the IV. `createCipheriv("aes-256-gcm", key, iv)`. `setAAD` from `associatedData(ownerEmail)`: UTF-8 `vantage-google-drive-oauth:v1:` + `ownerEmail.trim().toLowerCase()`. Encrypt the refresh token as UTF-8. Return `{ encrypted_refresh_token, refresh_token_iv, refresh_token_auth_tag }` as base64 plus `encryption_version: 1`. This beat does not persist. This beat does not read env. This beat does not talk to Google. This beat does not look at scopes.

2. **Unlock the Owner refresh token for this process** — `decryptGoogleRefreshToken(encrypted, key, ownerEmail)`. Same 32-byte key assert. `encryption_version !== 1` → throw (`Unsupported Google OAuth token encryption version: …`). `createDecipheriv` with the stored IV (base64 → Buffer). Same AAD bind. `setAuthTag` from the stored tag. Concatenate `update` + `final` of the stored ciphertext and return UTF-8. Wrong owner email, wrong key, or tampered tag fail inside `final` (auth-tag mismatch). This beat does not persist. This beat does not stamp `last_used_at`. This beat does not revoke at Google.

There is no third rotate operation. There is no env-decode operation. There is no persist / finalize **seam**. Already-recommended complete / disconnect / live client / health, later scope math, later owner HTTP gate, and Wave B key decode already live in other files.

## Organization

Keep one file as the screenplay for “lock the Owner’s Google refresh token to this process and this owner email — AES-256-GCM with a fresh twelve-byte IV, associated data bound to the trimmed lowercased owner email, version 1 only — fail closed if the key is not thirty-two bytes, the version is not 1, or the owner email does not match — never store the plaintext token, never invent the company service account key.” Already-recommended `googleDriveOAuth.service.ts`, later `oauthScopes.ts`, later `ownerAuth.ts`, later `oauthSecurity.ts`, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended `serviceAccount.ts`, and Wave B `decodeEncryptionKey` already live in deeper **modules**. Do not pull those in. Do not invent a `TokenEncryptionService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a company-key **adapter** beside already-recommended `createGoogleServiceAccountAuth`. Do not invent a second connection **adapter** beside already-recommended `completeGoogleDriveOAuth`.

Do not split this into `create.ts` / `encrypt.ts` / `decrypt.ts` / `update.ts` / `delete.ts`. Those are HTTP verbs / crypto verbs, not the owner story. Do not move this into `googleDriveOAuth.service.ts` so “the login already encrypts.” Do not move this into `config/domain/googleDriveOAuth.ts` so “the names file can also AES.” Do not move this into already-recommended `serviceAccount.ts` so “we already have a Google key.” Do not silently teach leftover reporting to construct `GoogleAuth` from the company key so “one Google login.” Do not add these exports to skipped `index.ts` so “the barrel should export everything” — callers go through the connection **module** on purpose.

**External interface** stays small (this is the test surface). Lock and unlock are one story’s at-rest token, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `encryptGoogleRefreshToken` | `lockTheOwnerRefreshTokenForStorage` | already-recommended complete needs the persistable bag before upsert; tests need ciphertext ≠ plaintext without Mongo |
| `decryptGoogleRefreshToken` | `unlockTheOwnerRefreshTokenForThisProcess` | already-recommended disconnect / live client / health need the plaintext refresh token; tests need the AAD refuse without Google |
| `EncryptedGoogleToken` | `OwnerRefreshTokenAtRest` | the four fields `GoogleDriveConnection` already stores; sibling `encryptedTokenFromConnection` already builds this bag |

Keep the old names as one-line aliases until already-recommended complete / disconnect / live client / health migrate. Do not make callers learn `createCipheriv` / `setAAD` / `randomBytes` as the domain language.

**Principle: old exports stay as aliases.** `encryptGoogleRefreshToken` remains the imported name until already-recommended complete points at the story name. `decryptGoogleRefreshToken` remains the imported name until disconnect / live client / health migrate.

**No class for the workflow.** The type that *does* earn a name is the persistable bag complete already spreads onto the connection row:

```ts
type OwnerRefreshTokenAtRest = {
  encrypted_refresh_token: string
  refresh_token_iv: string
  refresh_token_auth_tag: string
  encryption_version: 1
}
```

That is the handoff from “Google handed us a refresh token” to “Mongo may store these four fields.” Do **not** add `refresh_token` onto this type so “the bag can skip unlock,” do **not** add `owner_email` so “the document can decrypt itself” (AAD is derived at lock/unlock time from the configured owner email, not stored on the bag), and do **not** add `key` so “the ciphertext carries the key.”

`associatedData` and `assertKey` stay unexported. They are beats, not a second public operation. Do not add `decodeEncryptionKey` as a public **seam** on this file — Wave B already owns the env shape. Do not add `encryptedTokenFromConnection` as a public **seam** on this file — already-recommended `googleDriveOAuth.service.ts` already owns the document-to-bag fold.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// tokenEncryption.ts
// Google just handed this process a refresh token
// because the Owner completed Drive consent.
// Mongo must not store that string.
// Lock it with AES-256-GCM,
// a fresh twelve-byte IV,
// and associated data bound to the configured owner email
// (trimmed, lowercased, prefixed vantage-google-drive-oauth:v1:).
// Hand back ciphertext, IV, auth tag, and version 1
// so the connection row can persist those four fields.
// Later, when disconnect, the live client, or token health
// needs the refresh token,
// unlock with the same 32-byte key and the same owner email.
// A different email, a wrong key, a tampered tag,
// or any version other than 1 must fail closed.
// Do not invent the company service-account JSON.
// Do not read the env-var name.
// Do not return the plaintext token to admin JSON.
// Do not talk to Google.

// ── 1. Lock the Owner refresh token for storage ───────────

export function lockTheOwnerRefreshTokenForStorage(
  refreshToken: string,
  key: Buffer,
  ownerEmail: string,
): OwnerRefreshTokenAtRest

function refuseUnlessTheKeyIsThirtyTwoBytes(key)
function mintAFreshTwelveByteIv()
function bindTheCipherToTheOwnerEmail(ownerEmail)   // trim + lowercase + prefix
function encodeTheLockedBag(encrypted, iv, authTag) // base64 + version 1

// ── 2. Unlock the Owner refresh token for this process ────

export function unlockTheOwnerRefreshTokenForThisProcess(
  locked: OwnerRefreshTokenAtRest,
  key: Buffer,
  ownerEmail: string,
): string

function refuseAnUnsupportedEncryptionVersion(version) // !== 1
function bindTheDecipherToTheSameOwnerEmail(ownerEmail)
function refuseIfTheAuthTagDoesNotMatch()             // wrong email / wrong key / tamper
```

Read the primary path out loud: *The Owner finished Google consent. Complete already has a refresh token. Ask this file to lock it: the key must be thirty-two bytes, mint a fresh twelve-byte IV, bind AES-256-GCM associated data to the trimmed lowercased owner email under the `vantage-google-drive-oauth:v1:` prefix, and return ciphertext / IV / auth tag / version 1. Complete spreads that bag onto the connection row. Later disconnect, the live client, or token health asks this file to unlock: same key, same owner email, version must still be 1. A different email fails closed. A wrong key fails closed. A tampered tag fails closed. The plaintext never sits on admin JSON. The company service-account JSON is a different person. This file never talks to Google.*

That is the operation. `encryptGoogleRefreshToken` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`encryptGoogleRefreshToken` / `decryptGoogleRefreshToken` are executor mechanics.** The owner story is “lock the Owner refresh token for storage” / “unlock the Owner refresh token for this process.” Keep the old names as aliases. Do not grow a `TokenEncryptionService` with `encrypt` / `decrypt` / `rotate`.

2. **Version refuse is duplicated.** Sibling `encryptedTokenFromConnection` throws on `encryption_version !== 1`, then this file throws again. One story, two **adapters** (document-to-bag vs bag-to-plaintext). Align by story later. Do not silently delete the sibling check so “decrypt already refuses” without keeping a typed `encryption_version: 1` bag for the three unlock callers. Do not silently accept version 2 so “we can rotate” without a later encryption pass and a paired migrate of existing `google_drive_connections` rows.

3. **Key-length refuse is duplicated.** Wave B `decodeEncryptionKey` already requires exactly 32 random bytes as canonical base64 before anyone calls this file. This file re-asserts `key.length !== 32`. That is defense in depth for a raw Buffer (tests already pass `randomBytes(32)` and never go through Wave B). Do not silently drop `assertKey` so “config already validated.” Do not silently pull `decodeEncryptionKey` into this file so “the locker owns the env name.” Do not open Wave B in this pass.

4. **AAD prefix is load-bearing.** `vantage-google-drive-oauth:v1:` + folded owner email is why a ciphertext cannot be unlocked for a different owner, and why a version-2 prefix would orphan every live connection. Do not silently drop the prefix so “email is enough.” Do not silently change `v1` to `v2` in the string while leaving `encryption_version: 1` so “the label can catch up.” Do not store the AAD string on `GoogleDriveConnection` so “the document can decrypt itself.”

5. **Owner-email fold is this file’s bind, not later `ownerAuth`.** `trim().toLowerCase()` here matches Wave B `ownerEmail` (already lowercased) and the model’s trim/lowercase `owner_email`. Complete and the three unlock callers all pass `config.ownerEmail`, not `connection.google_email`. Do not silently bind AAD to `google_email` so “the connected Google account is the person” — reconnect with the same configured owner is the **seam**. Do not silently skip the fold so “the config is already lower.” Do not silently put later `enforceGoogleDriveOwnerAccess` inside unlock so “every decrypt is owner-gated” — this file has no HTTP.

6. **IV is fresh every lock.** Two locks of the same token must not produce the same ciphertext. Tests today only assert ciphertext ≠ plaintext. Do not silently reuse a stored IV so “reconnect is stable.” Do not silently switch to a deterministic IV from the owner email so “we can find the row.”

7. **This file does not persist.** Complete upserts. Disconnect deletes. This file returns a bag / a string. Do not import `GoogleDriveConnection` so “encrypt can write.” Do not import `getGoogleDriveOAuthConfig` so “decrypt can load the key.” Callers already pass key + email.

8. **This file does not talk to Google.** It never constructs `OAuth2Client`, never calls `revokeToken`, never calls `getAccessToken`. Do not call already-recommended `getConnectedGoogleOAuthClient` so “unlock can prove the token.” Do not import later Picker so “the locker can bootstrap.”

9. **Company service account is a different person.** Already-recommended `serviceAccount.ts` is the process identity. This file locks a **user** refresh token. Do not read `GOOGLE_SERVICE_ACCOUNT_*` here so “we already have a key.” Do not encrypt a service-account private key so “one locker.” Do not write a refresh token from a service-account JWT so “Drive can skip the Owner.”

10. **Sibling secrets-redacted is not encryption.** Already-recommended `assertGoogleDriveSecretsRedacted` walks key names (`encrypted_refresh_token`, `refresh_token_iv`, `tokenEncryptionKey`, …). It does not prove AES. Do not silently call it inside lock so “the bag is safe to return” — the bag **is** those forbidden keys, and complete must persist them. Do not log the plaintext token or the key when unlock throws.

11. **Barrel does not re-export this file.** Skipped `index.ts` exports the connection / Picker / owner-gate names. Tests and the connection **module** import `./tokenEncryption` directly. Do not add these exports to the barrel so “reporting can lock its own token.” Leftover reporting must keep asking the live client.

12. **Leave sibling modules alone.** Already-recommended complete / disconnect / client / health, sibling `encryptedTokenFromConnection`, later scope allowlist, later owner HTTP gate, later error categories, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended company identity, and Wave B key decode stay where they are. This file orchestrates lock → persistable bag → unlock.

## Testing

The **interface** is the test surface: the two exports (story names, old names as aliases) plus the persistable bag type. Round-trip, owner-email AAD refuse, version refuse, key-length refuse, and the forbidden identities are part of that **interface**. Do not boot Google. Do not boot Mongo. Do not boot Drive. Pass a `randomBytes(32)` key and assert bag / throw / plaintext.

Today `googleDriveOAuth.test.ts` locks only round-trip (ciphertext ≠ plaintext; decrypt equals the input) and AAD bind (a different email throws). Those two tests belong on this **interface**; they do not belong on already-recommended `hashOAuthState` or later folder-id tests that share the same file. Add (or move) file tests that name the operation:

**Lock the Owner refresh token for storage**
- Returned `encrypted_refresh_token` is not the plaintext.
- Returned bag has `encryption_version: 1` and base64 `refresh_token_iv` / `refresh_token_auth_tag`.
- Two locks of the same token + same key + same email produce different ciphertext (fresh IV).
- `key.length !== 32` throws (`must be 32 bytes`).
- Owner email is folded: lock with `Owner@Example.com` unlocks with `owner@example.com`.
- Does not read `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`.
- Does not import `GoogleDriveConnection`.

**Unlock the Owner refresh token for this process**
- Happy path returns the original refresh token string.
- Different owner email throws (today’s AAD test).
- Same email, different 32-byte key throws.
- Tampered `refresh_token_auth_tag` throws.
- `encryption_version: 2` throws (`Unsupported Google OAuth token encryption version`).
- Wrong key length throws before AES.

**Not this interface**
- Consume-state / owner-email 403 / missing refresh token stay on already-recommended `googleDriveOAuth.service.ts` (existing `hashOAuthState` test may stay there; do not move AES assertions onto that export except as “complete called lock”).
- Sibling `encryptedTokenFromConnection` version refuse stays on already-recommended `googleDriveOAuth.service.ts`.
- Env-key canonical-base64 refuse stays on Wave B `decodeEncryptionKey`.
- Allowlist math stays on later `oauthScopes.ts`.
- Signed admin proxy / scoped-key 403 stay on later `ownerAuth.ts`.
- Public error categories stay on later `oauthSecurity.ts`.
- Folder URL parse stays on later `spreadsheet.service.ts`.
- Company JSON / TEST_MODE file fence stay on already-recommended `serviceAccount.ts`.
- Leftover `rejectServiceAccountCredentialsForLiveTest` stays on leftover `liveTestSecurity.ts`.

Do **not** add a test per helper (`mintAFreshTwelveByteIv`, `bindTheCipherToTheOwnerEmail`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file reads `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — it must not. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that this file returns the plaintext token from lock — it must not. Do not add a test that unlock accepts version 2 — it must not. Do not add a test that unlock succeeds for a different owner email — it must not. Do not add a test that two locks of the same token share an IV — they must not. Do not add a test that leftover reporting now imports this file — it must not, in this rename. Do not add a test that skipped `index.ts` now re-exports lock/unlock — it must not, in this rename. Do not add a test that this file constructs `OAuth2Client` — it must not.

## What I would not do

- A `TokenEncryptionService` class with `encrypt` / `decrypt` / `rotate`.
- Thirty two-line functions that only wrap `createCipheriv`.
- Moving this into a CRUD folder, or into `googleDriveOAuth.service.ts` / `config/domain/googleDriveOAuth.ts` / `googleAuth/serviceAccount.ts` / leftover reporting adapters “for cleanliness.”
- Breaking the owner-email AAD **seam**, the version-1 **seam**, the 32-byte key **seam**, or the lock-does-not-persist **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / later `oauthScopes.ts` / later `ownerAuth.ts` / later `picker.service.ts` / leftover reporting adapters / already-recommended `serviceAccount.ts` / Wave B `decodeEncryptionKey` as this story.
- Inventing a company-key **seam** that has only one **adapter** here, or a connection-upsert **seam** that has only one **adapter** here, or a rotate-to-v2 **seam** that has only one **adapter** here.
- Silently accepting version 2, or silently binding AAD to `google_email`, or silently dropping the `vantage-google-drive-oauth:v1:` prefix, or silently pulling Wave B env decode into this file, or silently adding these exports to skipped `index.ts`, or silently teaching leftover reporting to lock its own token, or silently constructing the company service account from this file, or silently writing Mongo from lock.
- Writing a whole-folder recommendation that pretends later Picker / folder / managed-tab / leftover reporting are this module.
- Opening `oauthScopes.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `lockTheOwnerRefreshTokenForStorage`.
