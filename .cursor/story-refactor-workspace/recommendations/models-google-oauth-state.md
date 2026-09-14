# Remember The One-Time Owner Drive Consent Hash As One Row — Unique SHA-256 Nonce Hash, Configured Owner Email, Expiry Clock Login Stamps At Ten Minutes, Named Created Timestamp Only With Version Key Off, Unnamed Unique Hash Clock Plus Mongo TTL When Expires-At Passes, And The Default Connection After Connect Mongo — Never Begin Or Complete Consent Here, Never Hash The Plaintext Here, Never Store The Plaintext State, Never Exchange A Code Or Upsert The Connection Here, Never Merge This Into The Durable Drive Row Or The Later Picker Nonce — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 43 of this service — `GoogleOAuthState.ts`
- Remaining in this service: `GooglePickerNonce.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GoogleOAuthState.ts`
- Knowledge: none for this file. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks are a **delivery surface**; destination create asks already-recommended `requireActiveGoogleConnection` on the durable Drive row — **this file never begins consent, never hashes, never exchanges a code, never writes a destination**). That Service never names `google_oauth_states`, this model, unique `nonce_hash`, or the ten-minute expiry. Do **not** rewrite Reporting from this rename so “Reporting owns the consent hash.” Already-recommended Owner login: [google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (`beginGoogleDriveOAuth` creates this row after `hashOAuthState`; `completeGoogleDriveOAuth` `findOneAndDelete`s an unexpired matching hash — **this file never talks to Google**). Already-recommended authorize desk: [routes-google-drive-oauth.md](routes-google-drive-oauth.md) asks begin / complete — **never imports this file**. Already-recommended signed-owner HTTP gate: [google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) sits in front of authorize — **not the callback, not this export**. Already-recommended public failure: [google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) sanitizes callback logs — **never reads this collection**. Already-recommended durable connection: [models-google-drive-connection.md](models-google-drive-connection.md) (`google_drive_connections` — unique `owner_email`, ciphertext bag, **no TTL** — **do not merge**). Already-recommended company identity: [google-auth-service-account.md](google-auth-service-account.md) — **do not merge**. Already-recommended Picker nonce store: [google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md) asks later `GooglePickerNonce` (`consumed_at`, `flow`) — **do not merge**. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `google_oauth_states`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the ten-minute hash.” Distinct from later `GooglePickerNonce.ts` / later `GooglePickerSelection.ts`. Distinct from already-recommended `GoogleDriveConnection.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for Owner Drive / OAuth state / consent hash. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended `googleDriveOAuth.service.ts` asks `GoogleOAuthState` after `connectMongo()`: `create` (`nonce_hash: hashOAuthState(state)`, `owner_email: config.ownerEmail`, `expires_at` now + `STATE_TTL_MS` = ten minutes), `findOneAndDelete` (`nonce_hash` plus `expires_at: { $gt: new Date() }`). Complete then refuses unless consumed `owner_email` equals `config.ownerEmail`. Already-recommended routes / owner gate / oauth security / picker / destination / live security ask begin / complete / status — **not this file**. Tests: `googleDriveOAuth.test.ts` locks `hashOAuthState` SHA-256 hex determinism — **never constructs `GoogleOAuthState`**. `oauthHardening.test.ts` locks sanitize — **never imports this model**. There is **no** `GoogleOAuthState.test.ts`. There is **no** `getGoogleOAuthStateModel()`. There is **no** `pnpm migration:*` for this collection. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `google_oauth_states`. Disconnect does **not** delete leftover hashes (Mongo TTL plus the app-level `$gt` filter retire them). Not this **interface**: `beginGoogleDriveOAuth` itself, `completeGoogleDriveOAuth` itself, `hashOAuthState` itself, later `GooglePickerNonce` writes themselves, already-recommended `GoogleDriveConnection` upserts themselves.
- Seams callers need: default `GoogleOAuthState` (first-registered connection — login asks it after `connectMongo()`) vs **no** `getGoogleOAuthStateModel()`; unique required `nonce_hash` vs **no** plaintext `state` column; required trimmed lowercase `owner_email` vs **not** unique (a second begin plants a second hash); required `expires_at` vs login-owned ten-minute `STATE_TTL_MS` vs Mongo TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`; consume is `findOneAndDelete` (hard delete) vs later picker nonce `consumed_at`; named timestamp `{ createdAt: "created_at", updatedAt: false }` vs `versionKey: false`; unnamed unique `{ nonce_hash: 1 }` plus unnamed TTL `{ expires_at: 1 }` vs **no** named catalog and **no** `pnpm migration:*` for this collection; omitted `autoIndex: false` (mongoose default creates both clocks on boot). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no hash **seam**. There is no selected-database **seam**. There is no company-key **adapter**.
- Split later (only if the file outgrows one sitting): this ~35-line file is one sitting if you read it as remember the one-time Owner Drive consent hash as one row — unique SHA-256 nonce hash, configured owner email, expiry clock login stamps at ten minutes, named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never begin or complete consent here, never hash the plaintext here, never store the plaintext state, never exchange a code or upsert the connection here, never merge this into the durable Drive row or the later picker nonce. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `state.ts`. Login stays already-recommended `googleDriveOAuth.service.ts`. Hash stays already-recommended `hashOAuthState`. Durable connection stays already-recommended `GoogleDriveConnection.ts`. Later picker nonce stays later `GooglePickerNonce.ts`.

`GoogleOAuthState` is a Mongoose model name. The owner question is: *The Owner started Google consent. Remember only the hash of that one-time nonce as one row on `google_oauth_states`. The unique key is the SHA-256 hex. Stamp the configured owner email and when the ticket dies. Login stamps death at now plus ten minutes. Hand back the default-connection model after `connectMongo()`. When Google comes back, login consumes the unused unexpired hash by deleting the row. Do not begin consent. Do not hash. Do not store the plaintext state. Do not talk to Google. Do not exchange a code. Do not upsert the durable Drive row. Do not invent a selected-database getter so “CRM matches Drive.” Do not unique `owner_email` so “one consent at a time.” Do not merge this into the durable connection or the later picker nonce.*

Who begins / completes already lives in already-recommended `googleDriveOAuth.service.ts`. Who hashes the nonce already lives in already-recommended `hashOAuthState`. Who upserts the durable connection already lives in already-recommended `GoogleDriveConnection.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the one-time Owner Drive consent hash as one row — unique SHA-256 nonce hash, configured owner email, expiry clock login stamps at ten minutes, named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never begin or complete consent here, never hash the plaintext here, never store the plaintext state, never exchange a code or upsert the connection here, never merge this into the durable Drive row or the later picker nonce” story, not “a google-oauth-state CRUD dump,” and not Let The Owner Connect Their Google Account itself:

1. **Hold the one-time Owner Drive consent-hash row** — collection `google_oauth_states`, timestamps `{ createdAt: "created_at", updatedAt: false }`, `versionKey: false`. **No** `autoIndex: false` (mongoose default creates the unique hash clock and the TTL clock on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required `nonce_hash` (String). Required trimmed lowercase `owner_email`. Required `expires_at` (Date). `GoogleOAuthStateDocument` is `InferSchemaType` plus `_id`. This beat does **not** `create`. This beat does **not** hash. This beat does **not** mint 32 random bytes.

2. **Remember which unused hash belongs to which configured owner and when it dies** — unique `nonce_hash` is the identity. Live writers look up `hashOAuthState(state)` (already-recommended SHA-256 hex). There is **no** plaintext `state` column. `owner_email` is required and folded lowercase, and it is **not** unique — a second begin plants a second hash for the same owner. Login stamps `expires_at` at `Date.now() + STATE_TTL_MS` (ten minutes). Complete consumes with `findOneAndDelete({ nonce_hash, expires_at: { $gt: new Date() } })` then refuses unless `owner_email === config.ownerEmail`. Missing / expired / mismatched owner → already-recommended `BadRequestError` (“Start the connection again.”). This beat does **not** rewrite `STATE_TTL_MS`. This beat does **not** unique the owner.

3. **Stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model** — `Schema.index({ nonce_hash: 1 }, { unique: true })` and `Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })`. There is **no** `GOOGLE_OAUTH_STATE_INDEXES` catalog. There is **no** collection-name export. Default export `GoogleOAuthState` is `mongoose.models.GoogleOAuthState ?? mongoose.model(...)`. There is **no** `getGoogleOAuthStateModel()`. Login asks this default model after `connectMongo()`. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call a getter.”

There is no leftover-begin-consent operation. `beginGoogleDriveOAuth` writes this row. There is no leftover-complete-connection operation. `completeGoogleDriveOAuth` consumes this row then upserts already-recommended `GoogleDriveConnection`. There is no leftover-page-the-connection-desk operation. Admin status asks `getGoogleDriveConnectionStatus`, not this export. There is no leftover-disconnect-hash-sweep operation. `disconnectGoogleDrive` deletes the durable Drive row and does **not** `deleteMany` leftover hashes.

## Organization

Keep one file. This is the screenplay for “remember the one-time Owner Drive consent hash as one row — unique SHA-256 nonce hash, configured owner email, expiry clock login stamps at ten minutes, named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never begin or complete consent here, never hash the plaintext here, never store the plaintext state, never exchange a code or upsert the connection here, never merge this into the durable Drive row or the later picker nonce.” Login / hash / authorize desk / owner gate already live in deeper **modules**. Later picker nonce / later picker selection / already-recommended durable connection already live in sibling **modules**. Do not pull those in. Do not invent a `GoogleOAuthStateService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the CRM name” without a paired login migration to the getter. Do not invent an `autoIndex: false` **adapter** so “this matches the CRM name” without a paired proof that boot no longer creates the unique hash clock and the TTL clock. Do not invent a one-consent-at-a-time **adapter** so “unique owner_email owns begin.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `hash.ts` / `state.ts` each get a file.

Do not move `beginGoogleDriveOAuth` into this file so “the row owns consent.” Do not move `hashOAuthState` into this file so “the schema owns the digest.” Do not merge this file into already-recommended `GoogleDriveConnection.ts` so “one schema owns the ten-minute hash and the durable connection.” Do not merge this file into later `GooglePickerNonce.ts` so “one nonce schema owns Drive consent and Picker.” Do not merge this file into already-recommended `serviceAccount.ts` so “one Google identity.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GoogleOAuthState` | `ownerDriveConsentHashOnTheDefaultConnection` | login asks the default model after `connectMongo()` |
| `GoogleOAuthStateDocument` | `OwnerDriveConsentHash` | inferred document + `_id` |

Keep the old names as one-line aliases until login migrates. Do not make callers learn `useDb` / `autoIndex` / `findOneAndDelete` as the only domain language until those sites move. Do **not** add a `getGoogleOAuthStateModel` export so “CRM matches Drive” without a paired proof that `connectMongo()` already binds the selected database. Do **not** re-export `beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / `hashOAuthState` from this file so “the row begins consent or hashes the nonce.”

**No class for the workflow.** The one type that *does* earn a name is the Owner-Drive-consent-hash identity contract:

```ts
type OwnerDriveConsentHashIdentity = {
  collection: "google_oauth_states"
  nonce_hash_unique: true
  owner_email_unique: false
  live_lookup_key: "hashOAuthState(state)"
  consume: "findOneAndDelete"
  consume_also_requires_expires_at_gt_now: true
  owner_must_equal_config_after_consume: true
  plaintext_state_field: false
  hash_lives_in_login: true
  login_ttl_ms: 10 * 60 * 1_000
  timestamps: { created_at: true, updated_at: false }
  versionKey: false
  ttl: { expires_at: 1, expireAfterSeconds: 0 }
  selected_database_getter: false
  autoIndex: true
  named_index_catalog: false
  unnamed_indexes: [
    { nonce_hash: 1, unique: true },
    { expires_at: 1, expireAfterSeconds: 0 },
  ]
  disconnect_deletes_leftover_hashes: false
}
```

That is the handoff from “this process remembered the one-time consent hash” to “login may create it, complete may consume it by delete, Mongo may drop it after `expires_at`, and boot creates the unique hash clock plus the TTL clock.” Do **not** add `{ selected_database_getter: true }` so “this matches the CRM name.” Do **not** add `{ autoIndex: false }` so “this matches the CRM name.” Do **not** add `{ plaintext_state_field: true }` so “the callback can skip hashing.” Do **not** add `{ owner_email_unique: true }` so “one consent at a time.” Do **not** add `{ consume: "consumed_at" }` so “this matches the later picker nonce.” Do **not** add `{ disconnect_deletes_leftover_hashes: true }` so “disconnect sweeps the bag.” Do **not** add `{ login_ttl_ms: 0 }` so “the schema owns ten minutes.”

Leave later `GooglePickerNonce.ts` on that file. Leave later `GooglePickerSelection.ts` on that file. Leave already-recommended `GoogleDriveConnection.ts` on that file. Leave already-recommended `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GoogleOAuthState.ts
// The Owner started Google consent.
// Remember only the hash of that one-time nonce as one row.
// The unique key is the SHA-256 hex.
// Login stamps death at ten minutes.
// Complete consumes the row by deleting it.

// ── 1. Hold the one-time Owner Drive consent-hash row ─────

const GoogleOAuthStateSchema = new Schema(
  {
    nonce_hash: { type: String, required: true },
    owner_email: { type: String, required: true, trim: true, lowercase: true },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "google_oauth_states",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
)

// ── 2. Remember which unused hash belongs to which owner

function rememberWhichUnusedHashBelongsToWhichConfiguredOwnerAndWhenItDies() {
  // unique nonce_hash
  // live lookup: hashOAuthState(plaintext state)
  // no plaintext state column
  // owner_email required, not unique — a second begin plants a second hash
  // login stamps expires_at at now + ten minutes
  // complete findOneAndDelete({ nonce_hash, expires_at: { $gt: now } })
  // then refuses unless owner_email === config.ownerEmail
}

// ── 3. Stamp the unnamed unique hash clock plus Mongo TTL and hand back the model

GoogleOAuthStateSchema.index({ nonce_hash: 1 }, { unique: true })
GoogleOAuthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })

export const GoogleOAuthState =
  mongoose.models.GoogleOAuthState ??
  mongoose.model("GoogleOAuthState", GoogleOAuthStateSchema)
export const ownerDriveConsentHashOnTheDefaultConnection = GoogleOAuthState
```

Read the primary path out loud: *The Owner started Google consent. Remember only the hash of that one-time nonce as one row: this SHA-256 hex, the configured owner email, and when the ticket dies. Login stamps death at ten minutes and sends Google the plaintext state. When Google comes back, login deletes the unused unexpired hash and refuses unless the stored owner is still the configured owner. Leftover unused hashes die when `expires_at` passes. Do not hash from here. Do not store the plaintext. Do not talk to Google from here. Do not upsert the durable Drive row from here.*

## Precise logic I would tighten while renaming

1. **Reporting knowledge never names this collection.** The Reporting Service talks about destinations and Google workbooks as a delivery surface and never lists `google_oauth_states`. Do not rewrite that Service from this rename so “Reporting owns the consent hash.” Park the missing sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `google_oauth_states`. Do not add that rule line from this rename.

3. **Consume is hard delete.** Complete uses `findOneAndDelete` on hash plus `expires_at > now`. Later picker nonce stamps `consumed_at` and keeps the row. Do not switch this file to `consumed_at` so “consent matches Picker” without a paired complete proof.

4. **`owner_email` is not unique.** A second authorize plants a second hash. Do not unique `owner_email` so “one consent at a time” without a paired begin proof that a second authorize must fail or replace.

5. **Login owns the ten minutes.** `STATE_TTL_MS` lives in already-recommended `googleDriveOAuth.service.ts`. This file only stores `expires_at` and TTL-deletes when that clock is past. Do not hard-code ten minutes on the schema so “the model owns the TTL” without a paired begin proof.

6. **App-level expiry and Mongo TTL are both live.** Complete also filters `expires_at: { $gt: new Date() }`. Mongo TTL `{ expireAfterSeconds: 0 }` is the sweeper, not the only fence. Do not drop the query filter so “TTL is enough” without a paired complete proof that an expired-but-not-yet-swept row still 400s.

7. **No plaintext state field.** Hash happens in already-recommended `hashOAuthState` (SHA-256 hex). Tests lock determinism and “not equal to plaintext.” Do not add `state` so “the callback can skip hashing.” Do not silently switch the digest to HMAC with the encryption key so “state is keyed” without a paired migrate of in-flight rows.

8. **Disconnect does not sweep leftover hashes.** `disconnectGoogleDrive` deletes the durable Drive row. Leftover unused hashes TTL out. Do not add `deleteMany({ owner_email })` so “disconnect owns the bag” without a paired disconnect proof.

9. **Named created-at only, version key off.** Already-recommended durable connection has `created_at` / `updated_at`. This file sets `updatedAt: false`. Do not add `updated_at` so “consent matches the durable row.”

10. **No selected-database getter.** Login asks the default model after `connectMongo()`. Do not add `getGoogleOAuthStateModel()` so “CRM matches Drive.”

11. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Admin authorize / callback never import this file. There is no `pnpm migration:*` for these clocks. Do not invent those lines from this rename.

12. **Leave sibling modules alone.** `beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / `hashOAuthState` / already-recommended `GoogleDriveConnection` upsert are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the unique required `nonce_hash`, the required non-unique `owner_email`, required `expires_at`, named `created_at` only with `versionKey: false`, the unnamed unique `{ nonce_hash: 1 }`, the unnamed TTL `{ expires_at: 1, expireAfterSeconds: 0 }`, the omitted selected-database getter, and the omitted plaintext `state` field. There is no `GoogleOAuthState.test.ts`. `googleDriveOAuth.test.ts` asks `hashOAuthState` — **never the model**. `oauthHardening.test.ts` asks sanitize — **never this export**.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GoogleOAuthState ?? mongoose.model(...)`; there is no `getGoogleOAuthStateModel`
- login asks this default model after `connectMongo()`
- begin creates `{ nonce_hash: hashOAuthState(state), owner_email: config.ownerEmail, expires_at: now + ten minutes }`
- complete consumes with `findOneAndDelete` on hash plus `expires_at > now`, then checks `owner_email === config.ownerEmail`
- routes / owner gate / picker / destination / live security ask begin / complete / status — not this export
- Job Timeline does not hop `google_oauth_states`
- historical consolidation does not list `google_oauth_states`
- live writers never persist the plaintext state
- a second begin may plant a second hash for the same owner
- disconnect does not `deleteMany` leftover hashes
- unnamed clocks are exactly unique `{ nonce_hash: 1 }` plus TTL `{ expires_at: 1, expireAfterSeconds: 0 }`
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- there is no plaintext `state` field
- `schema-and-crud-inputs.mdc` still does not name `google_oauth_states`; this pass does not invent that rule line
- Reporting knowledge still omits this collection row; this pass does not invent that line
- later `GooglePickerNonce` is a different collection; that file is out of this story
- already-recommended `GoogleDriveConnection` is a different collection; that file is out of this story
- already-recommended company service account is a different identity; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story

I would not test login consent, token encrypt, live-client construct, destination create, Picker bootstrap, company service-account construct, Sheet Sync drain, or Job Timeline assemble from this file.

Do not add a test per helper (`theConsumeDeletesTheRow`, `theKnowledgeOmitsThisCollection`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GoogleOAuthStateService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `state.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating `beginGoogleDriveOAuth` / `completeGoogleDriveOAuth` / `hashOAuthState` / already-recommended `GoogleDriveConnection` / later `GooglePickerNonce` / later `GooglePickerSelection` / already-recommended company service account / already-recommended `SheetSyncQuotaBucket` as this story.
- Inventing a selected-database seam that has only the CRM getter as an adapter.
- Inventing a one-consent-at-a-time seam that has only unique `owner_email` as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, adding a plaintext `state`, uniquing `owner_email`, switching consume to `consumed_at`, adding `updated_at`, rewriting Reporting knowledge, adding a Core Collections line, adding a named-index catalog, or sweeping leftover hashes on disconnect while recommending a rename.
- Pulling `beginGoogleDriveOAuth` or `hashOAuthState` into this file.
- Importing `GoogleOAuthState` into `tokenEncryption.ts` so “the lock owns the collection.”
- Merging this collection into already-recommended `GoogleDriveConnection`, later `GooglePickerNonce`, later `GooglePickerSelection`, later `ReportingDestination`, already-recommended company service account, already-recommended `SheetSyncQuotaBucket`, later `IngestionRun`, or later `ReportingRun`.
- Silently reordering `connectMongo` versus begin create, consume-then-exchange versus exchange-then-consume, or revoke-at-Google versus always-delete-local versus this collection.
- Changing complete consume to find-then-later-delete so “we can keep the hash after the code exchange fails.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or later `GooglePickerNonce.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `GooglePickerNonce.ts` while writing this file.
