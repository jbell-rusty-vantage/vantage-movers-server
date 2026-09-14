# Remember The Owner Drive Connection As One Row — Unique Configured Owner Email, Verified Google Email, Ciphertext Plus IV Plus Auth Tag Plus Encryption Version One, Granted Scopes, Connected Clock And Optional Last-Used Clock, Named Created And Updated Timestamps With Version Key Off, Unnamed Unique Owner Clock, And The Default Connection After Connect Mongo — Never Begin Or Complete Consent Here, Never Encrypt Or Decrypt Here, Never Hand A Live Client Or Refresh Here, Never Point A Reporting Destination Here, Never Merge This Into The Ten-Minute State Hash Or The Company Service Account — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 42 of this service — `GoogleDriveConnection.ts`
- Remaining in this service: `GoogleOAuthState.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GoogleDriveConnection.ts`
- Knowledge: none for this file. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks are a **delivery surface**; destination create asks `requireActiveGoogleConnection`, which asks this default model after `connectMongo()` — **this file never begins consent, never encrypts, never hands a live client, never writes a destination**). That Service never names `google_drive_connections`, this model, or unique `owner_email`. Do **not** rewrite Reporting from this rename so “Reporting owns the connection row.” Already-recommended Owner login: [google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (`completeGoogleDriveOAuth` upserts this row; `getGoogleDriveConnectionStatus` / `disconnectGoogleDrive` / `getConnectedGoogleOAuthClient` / `getGoogleDriveAccessTokenHealth` ask it — **this file never talks to Google**). Already-recommended token lock: [google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-GCM plus owner AAD returns the four fields this row stores — **this file never encrypts**). Already-recommended scope allowlist: [google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md) (`openid` / `email` / `drive.file` — this file does **not** import `ALLOWED_GOOGLE_OAUTH_SCOPES`). Already-recommended authorize desk: [routes-google-drive-oauth.md](routes-google-drive-oauth.md) asks status / complete / disconnect — **never imports this file**. Already-recommended destination: [reporting-destination.md](reporting-destination.md) (`requireActiveGoogleConnection` finds by `owner_email` then stamps `drive_connection_id: connection._id` — **does not populate**). Already-recommended live principal: [reporting-live-test-security.md](reporting-live-test-security.md) asks status plus health — **not this export**. Already-recommended company identity: [google-auth-service-account.md](google-auth-service-account.md) — **do not merge**. Already-recommended quota bucket: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) — **do not merge**. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `google_drive_connections`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the Owner Drive row.” Distinct from later `GoogleOAuthState.ts` (ten-minute consent hash). Distinct from later `GooglePickerNonce.ts` / later `GooglePickerSelection.ts`. Distinct from later `ReportingDestination.ts` (required `drive_connection_id` refs `"GoogleDriveConnection"` — **do not merge**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for Owner Drive / OAuth / reporting destination. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended `googleDriveOAuth.service.ts` asks `GoogleDriveConnection` after `connectMongo()`: `findOneAndUpdate` on `owner_email` (complete upsert), `findOne` (status / disconnect / live client / token health), `deleteOne` (disconnect), `updateOne` `$set last_used_at` (live client and health). Already-recommended `reportingDestination.service.ts` finds `{ owner_email }` then stamps `drive_connection_id`. Already-recommended routes / picker / live security ask `getGoogleDriveConnectionStatus` — **not this file**. Tests: `googleDriveOAuth.test.ts` locks encrypt round-trip — **never constructs `GoogleDriveConnection`**. `oauthHardening.test.ts` locks sanitize — **never imports this model**. There is **no** `GoogleDriveConnection.test.ts`. There is **no** `getGoogleDriveConnectionModel()`. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `google_drive_connections`. Not this **interface**: `completeGoogleDriveOAuth` itself, `encryptGoogleRefreshToken` itself, `getConnectedGoogleOAuthClient` itself, `createReportingDestination` itself, later `GoogleOAuthState` writes themselves.
- Seams callers need: default `GoogleDriveConnection` (first-registered connection — login / destination ask it after `connectMongo()`) vs **no** `getGoogleDriveConnectionModel()`; unique required trimmed lowercase `owner_email` vs live writer key `config.ownerEmail`; required trimmed lowercase `google_email` vs complete refusing unless they match; required ciphertext bag (`encrypted_refresh_token` / `refresh_token_iv` / `refresh_token_auth_tag` / `encryption_version` default `1`) vs **no** plaintext `refresh_token`; required `scopes` (`[String]`, default `[]`) vs **no** `ALLOWED_GOOGLE_OAUTH_SCOPES` import; required `connected_at` (default `Date.now`, reset on every complete) vs optional `last_used_at` (unset on complete; stamped on live client and health); named timestamps `{ createdAt: "created_at", updatedAt: "updated_at" }` vs `versionKey: false`; unnamed unique `{ owner_email: 1 }` vs **no** named catalog and **no** `pnpm migration:*` for this collection; omitted `autoIndex: false` (mongoose default creates the unique owner clock on boot); **no** TTL (this row is durable — later state / picker nonce expire). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no encrypt **seam**. There is no selected-database **seam**. There is no company-key **adapter**.
- Split later (only if the file outgrows one sitting): this ~45-line file is one sitting if you read it as remember the Owner Drive connection as one row — unique configured owner email, verified Google email, ciphertext plus IV plus auth tag plus encryption version one, granted scopes, connected clock and optional last-used clock, named created and updated timestamps with version key off, unnamed unique owner clock, and the default connection after connect Mongo — never begin or complete consent here, never encrypt or decrypt here, never hand a live client or refresh here, never point a reporting destination here, never merge this into the ten-minute state hash or the company service account. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `token.ts` / `connect.ts`. Login stays already-recommended `googleDriveOAuth.service.ts`. Token lock stays already-recommended `tokenEncryption.ts`. Destination stays already-recommended `reportingDestination.service.ts`. Later ten-minute state stays later `GoogleOAuthState.ts`. Later destination pointer stays later `ReportingDestination.ts`.

`GoogleDriveConnection` is a Mongoose model name. The owner question is: *The Owner finished Google consent. Remember that this configured owner can act in Drive as one row on `google_drive_connections`. The unique key is the configured owner email. Stamp the verified Google email, the locked refresh-token bag, the granted scopes, and when we connected. Forget last-used on every reconnect so a new consent does not look recently used. Hand back the default-connection model after `connectMongo()`. Do not begin consent. Do not encrypt. Do not talk to Google. Do not hand a live client. Do not write a reporting destination. Do not invent a selected-database getter so “CRM matches Drive.” Do not store a plaintext refresh token so “the row can refresh itself.” Do not merge this into the ten-minute state hash or the company service account.*

Who begins / completes already lives in already-recommended `googleDriveOAuth.service.ts`. Who locks / unlocks the refresh token already lives in already-recommended `tokenEncryption.ts`. Who points a destination at this `_id` already lives in already-recommended `reportingDestination.service.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Owner Drive connection as one row — unique configured owner email, verified Google email, ciphertext plus IV plus auth tag plus encryption version one, granted scopes, connected clock and optional last-used clock, named created and updated timestamps with version key off, unnamed unique owner clock, and the default connection after connect Mongo — never begin or complete consent here, never encrypt or decrypt here, never hand a live client or refresh here, never point a reporting destination here, never merge this into the ten-minute state hash or the company service account” story, not “a google-drive-connection CRUD dump,” and not Let The Owner Connect Their Google Account itself:

1. **Hold the Owner Drive connection row** — collection `google_drive_connections`, timestamps `{ createdAt: "created_at", updatedAt: "updated_at" }`, `versionKey: false`. **No** `autoIndex: false` (mongoose default creates the unique owner clock on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. **No** TTL. Required trimmed lowercase `owner_email`. Required trimmed lowercase `google_email`. Required `encrypted_refresh_token`, `refresh_token_iv`, `refresh_token_auth_tag`. Required `encryption_version` (Number, default `1`). Required `scopes` (`[String]`, default `[]`). Required `connected_at` (Date, default `Date.now`). Optional `last_used_at` (Date). `GoogleDriveConnectionDocument` is `InferSchemaType` plus `_id`. This beat does **not** `findOneAndUpdate`. This beat does **not** encrypt. This beat does **not** verify an id token.

2. **Remember which configured owner this ciphertext belongs to** — unique `owner_email` is the identity. Live writers look up exactly one string: `getGoogleDriveOAuthConfig().ownerEmail`. Complete refuses unless verified `google_email` equals that owner. The ciphertext bag is four fields (`encrypted_refresh_token`, `refresh_token_iv`, `refresh_token_auth_tag`, `encryption_version`). There is **no** plaintext `refresh_token` column. `scopes` is a free string array — this file does **not** import `ALLOWED_GOOGLE_OAUTH_SCOPES`. `connected_at` is reset on every complete upsert. `last_used_at` is unset on complete and stamped later by live client / token health. This beat does **not** rewrite the AAD prefix. This beat does **not** mint a second owner row.

3. **Stamp the unnamed unique owner clock and hand back the default-connection model** — `Schema.index({ owner_email: 1 }, { unique: true })`. There is **no** `GOOGLE_DRIVE_CONNECTION_INDEXES` catalog. There is **no** collection-name export. Default export `GoogleDriveConnection` is `mongoose.models.GoogleDriveConnection ?? mongoose.model(...)`. There is **no** `getGoogleDriveConnectionModel()`. Login and destination ask this default model after `connectMongo()`. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call a getter.”

There is no leftover-begin-consent operation. `beginGoogleDriveOAuth` writes later `GoogleOAuthState`. There is no leftover-hand-a-live-client operation. `getConnectedGoogleOAuthClient` asks this row then decrypts elsewhere. There is no leftover-page-the-connection-desk operation. Admin status asks `getGoogleDriveConnectionStatus`, not this export.

## Organization

Keep one file. This is the screenplay for “remember the Owner Drive connection as one row — unique configured owner email, verified Google email, ciphertext plus IV plus auth tag plus encryption version one, granted scopes, connected clock and optional last-used clock, named created and updated timestamps with version key off, unnamed unique owner clock, and the default connection after connect Mongo — never begin or complete consent here, never encrypt or decrypt here, never hand a live client or refresh here, never point a reporting destination here, never merge this into the ten-minute state hash or the company service account.” Login / token lock / scope allowlist / destination create already live in deeper **modules**. Later ten-minute state / later picker nonce / later picker selection / later destination pointer already live in sibling **modules**. Do not pull those in. Do not invent a `GoogleDriveConnectionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the CRM name” without a paired login-and-destination migration to the getter. Do not invent an `autoIndex: false` **adapter** so “this matches the CRM name” without a paired proof that boot no longer creates the unique owner clock. Do not invent a company-key **adapter** so “one Google login owns Drive and Master Sheet.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `token.ts` / `connect.ts` each get a file.

Do not move `completeGoogleDriveOAuth` into this file so “the row owns consent.” Do not import `GoogleDriveConnection` from `tokenEncryption.ts` so “the lock owns the collection.” Do not merge this file into later `GoogleOAuthState.ts` so “one schema owns the ten-minute hash and the durable connection.” Do not merge this file into later `ReportingDestination.ts` so “one destination owns the token bag.” Do not merge this file into already-recommended `serviceAccount.ts` so “one Google identity.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GoogleDriveConnection` | `ownerDriveConnectionOnTheDefaultConnection` | login / destination ask the default model after `connectMongo()` |
| `GoogleDriveConnectionDocument` | `OwnerDriveConnection` | inferred document + `_id` |

Keep the old names as one-line aliases until login, destination create, and later destination pointer refs migrate. Do not make callers learn `useDb` / `autoIndex` / `populate` as the only domain language until those sites move. Do **not** add a `getGoogleDriveConnectionModel` export so “CRM matches Drive” without a paired proof that `connectMongo()` already binds the selected database. Do **not** re-export `completeGoogleDriveOAuth` / `encryptGoogleRefreshToken` / `getConnectedGoogleOAuthClient` from this file so “the row begins consent or unlocks the token.”

**No class for the workflow.** The one type that *does* earn a name is the Owner-Drive-connection identity contract:

```ts
type OwnerDriveConnectionIdentity = {
  collection: "google_drive_connections"
  owner_email_unique: true
  live_lookup_key: "config.ownerEmail"
  google_email_must_equal_owner_at_complete: true
  plaintext_refresh_token_field: false
  ciphertext_fields: [
    "encrypted_refresh_token",
    "refresh_token_iv",
    "refresh_token_auth_tag",
    "encryption_version",
  ]
  encryption_version_default: 1
  imports_ALLOWED_GOOGLE_OAUTH_SCOPES: false
  timestamps: { created_at: true, updated_at: true }
  versionKey: false
  ttl: false
  selected_database_getter: false
  autoIndex: true
  named_index_catalog: false
  unnamed_indexes: [{ owner_email: 1, unique: true }]
  upsert_preserves_id_for_destination_pointer: true
}
```

That is the handoff from “this process remembered the Owner Drive connection” to “login may upsert it, destination may stamp `_id`, live client / health may stamp `last_used_at`, and boot creates the unique owner clock.” Do **not** add `{ selected_database_getter: true }` so “this matches the CRM name.” Do **not** add `{ autoIndex: false }` so “this matches the CRM name.” Do **not** add `{ plaintext_refresh_token_field: true }` so “the row can refresh itself.” Do **not** add `{ ttl: true }` so “this matches the ten-minute state.” Do **not** add `{ upsert_preserves_id_for_destination_pointer: false }` so “reconnect mints a new `_id`.”

Leave later `GoogleOAuthState.ts` on that file. Leave later `GooglePickerNonce.ts` on that file. Leave later `GooglePickerSelection.ts` on that file. Leave later `ReportingDestination.ts` on that file. Leave already-recommended `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GoogleDriveConnection.ts
// The Owner finished Google consent.
// Remember that this configured owner can act in Drive as one row.
// The unique key is the configured owner email.
// Store ciphertext, never a plaintext refresh token.
// Forget last-used on every reconnect.

// ── 1. Hold the Owner Drive connection row ────────────────

const GoogleDriveConnectionSchema = new Schema(
  {
    owner_email: { type: String, required: true, trim: true, lowercase: true },
    google_email: { type: String, required: true, trim: true, lowercase: true },
    encrypted_refresh_token: { type: String, required: true },
    refresh_token_iv: { type: String, required: true },
    refresh_token_auth_tag: { type: String, required: true },
    encryption_version: { type: Number, required: true, default: 1 },
    scopes: { type: [String], required: true, default: [] },
    connected_at: { type: Date, required: true, default: Date.now },
    last_used_at: { type: Date },
  },
  {
    collection: "google_drive_connections",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  },
)

// ── 2. Remember which configured owner this ciphertext is for

function rememberWhichConfiguredOwnerThisCiphertextBelongsTo() {
  // unique owner_email
  // live lookup: config.ownerEmail
  // complete refuses unless google_email === owner_email
  // four ciphertext fields, no plaintext refresh_token
  // scopes: free string array — this file does not import the allowlist
  // complete resets connected_at and unsets last_used_at
}

// ── 3. Stamp the unnamed unique owner clock and hand back the model

GoogleDriveConnectionSchema.index({ owner_email: 1 }, { unique: true })

export const GoogleDriveConnection =
  mongoose.models.GoogleDriveConnection ??
  mongoose.model("GoogleDriveConnection", GoogleDriveConnectionSchema)
export const ownerDriveConnectionOnTheDefaultConnection = GoogleDriveConnection
```

Read the primary path out loud: *The Owner finished Google consent. Remember that connection as one row: this configured owner email, the verified Google email, the locked refresh-token bag, the granted scopes, and when we connected. A reconnect upserts the same unique owner so destination pointers at `_id` stay valid, and it forgets last-used. Login may later stamp last-used when it hands a live client or proves the token still refreshes. Do not talk to Google from here. Do not encrypt from here. Do not write a destination from here.*

## Precise logic I would tighten while renaming

1. **Reporting knowledge never names this collection.** The Reporting Service talks about destinations and Google workbooks as a delivery surface and never lists `google_drive_connections`. Do not rewrite that Service from this rename so “Reporting owns the connection row.” Park the missing sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `google_drive_connections`. Do not add that rule line from this rename.

3. **Upsert preserves `_id`.** Complete uses `findOneAndUpdate` on `owner_email` with `upsert: true`. Destination create stamps `drive_connection_id: connection._id`. A reconnect must not become delete-then-insert so “a new consent is a new row” without a paired destination-pointer migrate.

4. **Destination existence is not token health.** `requireActiveGoogleConnection` finds by `owner_email` and returns the lean row. It does **not** decrypt. It does **not** call `getGoogleDriveAccessTokenHealth`. It does **not** populate. Do not start wiring health here so “active means the token still refreshes” without a paired destination-create proof.

5. **`google_email` and `owner_email` are two columns.** Complete refuses unless they match. The schema does **not** enforce equality. Do not add a same-email validator so “the schema owns the 403” without a paired complete proof.

6. **`scopes` is a free string array.** Already-recommended allowlist owns `openid` / `email` / `drive.file`. This file does **not** import it. Do not import the tuple so “one allowlist owns the schema” without a paired complete-and-status proof.

7. **`encryption_version` default is `1`.** Login and token lock both throw on any other version. Do not accept version `2` so “we can rotate” without a paired migrate of existing rows and an AAD-prefix pass.

8. **No plaintext refresh token field.** Decrypt happens in already-recommended token lock after login reads the four fields. Do not add `refresh_token` so “the row can refresh itself.”

9. **Named timestamps, version key off, no TTL.** Later `GoogleOAuthState` expires. This row does not. Do not add `expireAfterSeconds` so “Drive connections match the ten-minute hash.”

10. **No selected-database getter.** Login and destination ask the default model after `connectMongo()`. Do not add `getGoogleDriveConnectionModel()` so “CRM matches Drive.”

11. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Admin status never imports this file. Do not invent those lines from this rename.

12. **Leave sibling modules alone.** `completeGoogleDriveOAuth` / `encryptGoogleRefreshToken` / `getConnectedGoogleOAuthClient` / `createReportingDestination` are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the unique required `owner_email`, the required `google_email`, the four ciphertext fields plus `encryption_version` default `1`, the free-string `scopes` array, `connected_at` / optional `last_used_at`, named `created_at` / `updated_at` with `versionKey: false`, the unnamed unique `{ owner_email: 1 }`, the omitted selected-database getter, and the omitted `ALLOWED_GOOGLE_OAUTH_SCOPES` import. There is no `GoogleDriveConnection.test.ts`. `googleDriveOAuth.test.ts` asks encrypt round-trip — **never the model**. `oauthHardening.test.ts` asks sanitize — **never this export**.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GoogleDriveConnection ?? mongoose.model(...)`; there is no `getGoogleDriveConnectionModel`
- login asks this default model after `connectMongo()`
- complete upserts on `owner_email` and unsets `last_used_at`
- destination finds by `owner_email` then stamps `drive_connection_id` — it does not populate
- routes / picker / live security ask `getGoogleDriveConnectionStatus` — not this export
- Job Timeline does not hop `google_drive_connections`
- historical consolidation does not list `google_drive_connections`
- live writers never mint a second `owner_email`
- this file does **not** import `ALLOWED_GOOGLE_OAUTH_SCOPES`
- unnamed clock is exactly unique `{ owner_email: 1 }`
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- there is no plaintext `refresh_token` field
- `schema-and-crud-inputs.mdc` still does not name `google_drive_connections`; this pass does not invent that rule line
- Reporting knowledge still omits this collection row; this pass does not invent that line
- later `GoogleOAuthState` is a different collection; that file is out of this story
- later `ReportingDestination` is a different collection; that file is out of this story
- already-recommended company service account is a different identity; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story

I would not test login consent, token encrypt, live-client construct, destination create, Picker bootstrap, company service-account construct, Sheet Sync drain, or Job Timeline assemble from this file.

Do not add a test per helper (`theUpsertPreservesId`, `theKnowledgeOmitsThisCollection`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GoogleDriveConnectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `token.ts` / `connect.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating `completeGoogleDriveOAuth` / `encryptGoogleRefreshToken` / `getConnectedGoogleOAuthClient` / `createReportingDestination` / later `GoogleOAuthState` / later `ReportingDestination` / already-recommended company service account / already-recommended `SheetSyncQuotaBucket` as this story.
- Inventing a selected-database seam that has only the CRM getter as an adapter.
- Inventing a company-key seam that has only “one Google login” as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, importing `ALLOWED_GOOGLE_OAUTH_SCOPES`, adding a plaintext `refresh_token`, adding TTL, rewriting Reporting knowledge, adding a Core Collections line, uniquing `google_email`, or adding a named-index catalog while recommending a rename.
- Pulling `completeGoogleDriveOAuth` or `encryptGoogleRefreshToken` into this file.
- Importing `GoogleDriveConnection` into `tokenEncryption.ts` so “the lock owns the collection.”
- Merging this collection into later `GoogleOAuthState`, later `GooglePickerNonce`, later `GooglePickerSelection`, later `ReportingDestination`, already-recommended company service account, already-recommended `SheetSyncQuotaBucket`, later `IngestionRun`, or later `ReportingRun`.
- Silently reordering `connectMongo` versus complete upsert, destination existence versus token health, or revoke-at-Google versus always-delete-local versus this collection.
- Changing complete upsert to delete-then-insert so “reconnect mints a new `_id`.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or later `GoogleOAuthState.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `GoogleOAuthState.ts` while writing this file.
