# Remember The One-Time Owner Drive Picker Nonce As One Row — Unique SHA-256 Nonce Hash, Configured Owner Email, Folder-Or-Spreadsheet Flow, Expiry Clock Bootstrap Stamps At Ten Minutes, Consumed-At Default Null (Keep The Row), Named Created Timestamp Only With Version Key Off, Unnamed Unique Hash Clock Plus Mongo TTL When Expires-At Passes, And The Default Connection After Connect Mongo — Never Mint Or Hash Here, Never Bootstrap The Picker Here, Never Find Or Consume Via The Store Here, Never Fetch Drive Or Write A Selection Reference, Never Merge This Into The Consent Hash Or The Later Selection — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 44 of this service — `GooglePickerNonce.ts`
- Remaining in this service: `GooglePickerSelection.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GooglePickerNonce.ts`
- Knowledge: none for this file. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks are a **delivery surface**; leftover destination resolve asks already-recommended `consumePickerSelectionReference` after verify already spent this nonce — **this file never bootstraps Picker, never hashes, never finds or consumes, never fetches Drive, never writes a destination**). That Service never names `google_picker_nonces`, this model, unique `nonce_hash`, `flow`, or `consumed_at`. Do **not** rewrite Reporting from this rename so “Reporting owns the Picker nonce.” Already-recommended Owner pick: [google-drive-oauth-picker.md](google-drive-oauth-picker.md) (`bootstrapGooglePicker` `create`s this row after `hashPickerNonce`; `verifyGooglePickerSelection` finds then consumes through already-recommended store — **this file never talks to Google**). Already-recommended nonce store: [google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md) (`findOne` / `findOneAndUpdate` after `connectMongo()` — **never owns the schema**). Already-recommended authorize desk: [routes-google-drive-oauth.md](routes-google-drive-oauth.md) asks bootstrap / verify — **never imports this file**. Already-recommended signed-owner HTTP gate: [google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) sits in front of bootstrap / verify — **not this export**. Already-recommended leftover hash fold: [reporting-destination-identity.md](reporting-destination-identity.md) (`hashPickerNonce` SHA-256 hex — **this file never hashes**). Already-recommended leftover TTL: Wave B `src/config/domain/reporting.ts` `REPORTING_PICKER_NONCE_TTL_MS` (ten minutes) — **this file only stores `expires_at`**. Already-recommended durable connection: [models-google-drive-connection.md](models-google-drive-connection.md) — **do not merge**. Already-recommended consent hash: [models-google-oauth-state.md](models-google-oauth-state.md) (`google_oauth_states` — consume is `findOneAndDelete`, **no** `flow`, **no** `consumed_at` — **do not merge**). Already-recommended company identity: [google-auth-service-account.md](google-auth-service-account.md) — **do not merge**. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `google_picker_nonces`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the Picker nonce.” Distinct from later `GooglePickerSelection.ts`. Distinct from already-recommended `GoogleOAuthState.ts`. Distinct from already-recommended `GoogleDriveConnection.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for Owner Drive / Picker nonce / selection reference. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended `picker.service.ts` asks `GooglePickerNonce` after `connectMongo()` on bootstrap only: `create` (`nonce_hash: hashPickerNonce(selectionNonce)`, `owner_email: expectedConfiguredOwnerEmail()`, `flow`, `expires_at` now + `REPORTING_PICKER_NONCE_TTL_MS` = ten minutes). `consumed_at` is left to the schema default `null`. Already-recommended `pickerNonceStore.ts` asks the same default model after `connectMongo()`: `findOne` (`nonce_hash` plus `owner_email` plus `expires_at: { $gt: now }` plus `consumed_at: null`) and `findOneAndUpdate` (same filter, `$set: { consumed_at: now }`, `returnDocument: "after"`). Already-recommended verify asks the store, **not** this file. Already-recommended routes / owner gate / destination / live harness ask bootstrap / verify / consume-reference — **not this file**. Tests: `pickerVerification.test.ts` seeds `InMemoryPickerNonceStore` and locks consume-after-validate / replay / concurrent one-winner on already-recommended verify — **never constructs `GooglePickerNonce`**. `pickerValidation.test.ts` locks leftover `hashPickerNonce` SHA-256 hex determinism — **never imports this model**. There is **no** `GooglePickerNonce.test.ts`. There is **no** `getGooglePickerNonceModel()`. There is **no** `pnpm migration:*` for this collection. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `google_picker_nonces`. Disconnect does **not** delete leftover nonces (Mongo TTL plus the app-level `$gt` + `consumed_at: null` filter retire unused ones; spent rows keep `consumed_at` until TTL). Not this **interface**: `bootstrapGooglePicker` itself, `verifyGooglePickerSelection` itself, `hashPickerNonce` itself, already-recommended store find / consume themselves, later `GooglePickerSelection` writes themselves, already-recommended `GoogleOAuthState` create / delete themselves.
- Seams callers need: default `GooglePickerNonce` (first-registered connection — bootstrap `create`s it after `connectMongo()`; the store finds / spends it after `connectMongo()`) vs **no** `getGooglePickerNonceModel()`; unique required `nonce_hash` vs **no** plaintext `selection_nonce` column; required trimmed lowercase `owner_email` vs **not** unique (a second bootstrap plants a second nonce); required `flow` enum `"folder" | "spreadsheet"` vs store find / consume that **do not** filter by flow (stored `flow` rides on the row so verify can prove mime against the ticket); required `expires_at` vs leftover-owned ten-minute `REPORTING_PICKER_NONCE_TTL_MS` vs Mongo TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`; `consumed_at` default `null` (keep the row) vs already-recommended consent hash `findOneAndDelete`; bootstrap writes the model **itself** vs store-only find / consume; named timestamp `{ createdAt: "created_at", updatedAt: false }` vs `versionKey: false`; unnamed unique `{ nonce_hash: 1 }` plus unnamed TTL `{ expires_at: 1 }` vs **no** named catalog and **no** `pnpm migration:*` for this collection; omitted `autoIndex: false` (mongoose default creates both clocks on boot). There is no bootstrap / verify Domain Command **seam**. There is no HTTP **seam**. There is no hash **seam**. There is no selected-database **seam**. There is no company-key **adapter**.
- Split later (only if the file outgrows one sitting): this ~41-line file is one sitting if you read it as remember the one-time Owner Drive Picker nonce as one row — unique SHA-256 nonce hash, configured owner email, folder-or-spreadsheet flow, expiry clock bootstrap stamps at ten minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never bootstrap the Picker here, never find or consume via the store here, never fetch Drive or write a selection reference, never merge this into the consent hash or the later selection. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `nonce.ts` / `flow.ts`. Bootstrap stays already-recommended `picker.service.ts`. Hash stays leftover `hashPickerNonce`. Find / consume stay already-recommended `pickerNonceStore.ts`. Later selection stays later `GooglePickerSelection.ts`. Already-recommended consent hash stays already-recommended `GoogleOAuthState.ts`.

`GooglePickerNonce` is a Mongoose model name. The owner question is: *The Owner opened Google Picker to point a reporting destination at an existing folder or spreadsheet. Remember only the hash of that one-time nonce as one row on `google_picker_nonces`. The unique key is the SHA-256 hex. Stamp the configured owner email, whether this ticket is a folder pick or a spreadsheet pick, and when the ticket dies. Bootstrap stamps death at now plus ten minutes and leaves `consumed_at` null. Hand back the default-connection model after `connectMongo()`. When the Owner picks, the store looks up the unused unexpired hash for that owner and hands back the stored flow. After live Drive says the pick is fit, the store spends the same row once by stamping `consumed_at` — it does not delete the row. Do not mint the nonce. Do not hash. Do not store the plaintext ticket. Do not talk to Google. Do not fetch a file. Do not write a selection reference. Do not invent a selected-database getter so “CRM matches Drive.” Do not unique `owner_email` so “one Picker at a time.” Do not switch consume to `findOneAndDelete` so “Picker matches consent.” Do not merge this into the ten-minute consent hash or the later selection reference.*

Who bootstraps / verifies already lives in already-recommended `picker.service.ts`. Who hashes the nonce already lives in leftover `hashPickerNonce`. Who finds / consumes already lives in already-recommended `pickerNonceStore.ts`. Who writes the later selection already lives in later `GooglePickerSelection.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the one-time Owner Drive Picker nonce as one row — unique SHA-256 nonce hash, configured owner email, folder-or-spreadsheet flow, expiry clock bootstrap stamps at ten minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never bootstrap the Picker here, never find or consume via the store here, never fetch Drive or write a selection reference, never merge this into the consent hash or the later selection” story, not “a google-picker-nonce CRUD dump,” and not Hand The Owner A One-Time Picker itself:

1. **Hold the one-time Owner Drive Picker-nonce row** — collection `google_picker_nonces`, timestamps `{ createdAt: "created_at", updatedAt: false }`, `versionKey: false`. **No** `autoIndex: false` (mongoose default creates the unique hash clock and the TTL clock on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required `nonce_hash` (String). Required trimmed lowercase `owner_email`. Required `flow` enum `"folder" | "spreadsheet"`. Required `expires_at` (Date). `consumed_at` (Date, default `null`). `GooglePickerNonceDocument` is `InferSchemaType` plus `_id`. This beat does **not** `create`. This beat does **not** hash. This beat does **not** mint 32 random bytes.

2. **Remember which unused hash belongs to which configured owner, which pick kind, when it dies, and whether it was already spent** — unique `nonce_hash` is the identity. Live writers look up `hashPickerNonce(selectionNonce)` (leftover SHA-256 hex). There is **no** plaintext `selection_nonce` column. `owner_email` is required and folded lowercase, and it is **not** unique — a second bootstrap plants a second nonce for the same owner. `flow` is required and is the ticket’s pick kind; the store matches hash + owner only and returns the stored `flow` so already-recommended verify can prove mime against the **ticket**, not against the UI. Bootstrap stamps `expires_at` at `Date.now() + REPORTING_PICKER_NONCE_TTL_MS` (ten minutes) and leaves `consumed_at` at the default `null`. The store finds with `findOne({ nonce_hash, owner_email, expires_at: { $gt: now }, consumed_at: null })` then spends with `findOneAndUpdate` on the same filter plus `{ $set: { consumed_at: now } }`. Missing / expired / already used / mismatched owner → already-recommended `picker_invalid_nonce`. This beat does **not** rewrite `REPORTING_PICKER_NONCE_TTL_MS`. This beat does **not** unique the owner. This beat does **not** filter find / consume by `flow`.

3. **Stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model** — `Schema.index({ nonce_hash: 1 }, { unique: true })` and `Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })`. There is **no** `GOOGLE_PICKER_NONCE_INDEXES` catalog. There is **no** collection-name export. Default export `GooglePickerNonce` is `mongoose.models.GooglePickerNonce ?? mongoose.model(...)`. There is **no** `getGooglePickerNonceModel()`. Bootstrap `create`s on this default model after `connectMongo()`. The store finds / spends this default model after `connectMongo()`. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call a getter.”

There is no leftover-bootstrap-picker operation. `bootstrapGooglePicker` writes this row **itself** and does **not** ask the store. There is no leftover-verify-pick operation. `verifyGooglePickerSelection` finds then consumes through already-recommended store. There is no leftover-write-selection operation. Later `pickerSelectionStore.create` writes later `GooglePickerSelection`. There is no leftover-disconnect-nonce-sweep operation. `disconnectGoogleDrive` deletes the durable Drive row and does **not** `deleteMany` leftover nonces.

## Organization

Keep one file. This is the screenplay for “remember the one-time Owner Drive Picker nonce as one row — unique SHA-256 nonce hash, configured owner email, folder-or-spreadsheet flow, expiry clock bootstrap stamps at ten minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never bootstrap the Picker here, never find or consume via the store here, never fetch Drive or write a selection reference, never merge this into the consent hash or the later selection.” Bootstrap / verify / leftover hash / leftover TTL / authorize desk / owner gate already live in deeper **modules**. Later picker selection / already-recommended consent hash / already-recommended durable connection already live in sibling **modules**. Do not pull those in. Do not invent a `GooglePickerNonceService` class. Do not invent a bootstrap / verify Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the CRM name” without a paired bootstrap + store migration to the getter. Do not invent an `autoIndex: false` **adapter** so “this matches the CRM name” without a paired proof that boot no longer creates the unique hash clock and the TTL clock. Do not invent a one-Picker-at-a-time **adapter** so “unique owner_email owns bootstrap.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `hash.ts` / `nonce.ts` / `flow.ts` each get a file.

Do not move `bootstrapGooglePicker` into this file so “the row owns Picker.” Do not move `hashPickerNonce` into this file so “the schema owns the digest.” Do not move `findActive` / `consumeActive` into this file so “the model is the store.” Do not merge this file into already-recommended `GoogleOAuthState.ts` so “one nonce schema owns Drive consent and Picker.” Do not merge this file into later `GooglePickerSelection.ts` so “one ticket schema owns the nonce and the selection.” Do not merge this file into already-recommended `GoogleDriveConnection.ts` so “one schema owns the durable connection and the ten-minute Picker ticket.” Do not merge this file into already-recommended `serviceAccount.ts` so “one Google identity.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GooglePickerNonce` | `ownerDrivePickerNonceOnTheDefaultConnection` | bootstrap `create`s the default model after `connectMongo()`; the store finds / spends the same model |
| `GooglePickerNonceDocument` | `OwnerDrivePickerNonce` | inferred document + `_id` |

Keep the old names as one-line aliases until bootstrap and the store migrate. Do not make callers learn `useDb` / `autoIndex` / `findOneAndUpdate` as the only domain language until those sites move. Do **not** add a `getGooglePickerNonceModel` export so “CRM matches Drive” without a paired proof that `connectMongo()` already binds the selected database. Do **not** re-export `bootstrapGooglePicker` / `verifyGooglePickerSelection` / `hashPickerNonce` / `findActive` / `consumeActive` from this file so “the row bootstraps Picker, hashes the nonce, or spends the ticket.”

**No class for the workflow.** The one type that *does* earn a name is the Owner-Drive-Picker-nonce identity contract:

```ts
type OwnerDrivePickerNonceIdentity = {
  collection: "google_picker_nonces"
  nonce_hash_unique: true
  owner_email_unique: false
  live_lookup_key: "hashPickerNonce(selectionNonce)"
  live_find_filter: ["nonce_hash", "owner_email", "expires_at > now", "consumed_at = null"]
  live_find_filters_by_flow: false
  consume: "findOneAndUpdate consumed_at null → now"
  consume_keeps_the_row: true
  plaintext_nonce_field: false
  hash_lives_in_destination_identity: true
  bootstrap_writes_the_model_itself: true
  store_owns_find_and_consume: true
  bootstrap_ttl_ms: 10 * 60 * 1_000
  flow: ["folder", "spreadsheet"]
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
  disconnect_deletes_leftover_nonces: false
}
```

That is the handoff from “this process remembered the one-time Picker nonce” to “bootstrap may create it, the store may find it then spend it by stamping `consumed_at`, Mongo may drop it after `expires_at`, and boot creates the unique hash clock plus the TTL clock.” Do **not** add `{ selected_database_getter: true }` so “this matches the CRM name.” Do **not** add `{ autoIndex: false }` so “this matches the CRM name.” Do **not** add `{ plaintext_nonce_field: true }` so “verify can skip hashing.” Do **not** add `{ owner_email_unique: true }` so “one Picker at a time.” Do **not** add `{ consume: "findOneAndDelete" }` so “this matches the consent hash.” Do **not** add `{ live_find_filters_by_flow: true }` so “the UI can change its mind.” Do **not** add `{ bootstrap_writes_the_model_itself: false }` so “the store owns create.” Do **not** add `{ disconnect_deletes_leftover_nonces: true }` so “disconnect owns the bag.” Do **not** add `{ bootstrap_ttl_ms: 0 }` so “the schema owns ten minutes.” Do **not** add `{ file_id: true }` so “verify can skip Drive.”

Leave later `GooglePickerSelection.ts` on that file. Leave already-recommended `GoogleOAuthState.ts` on that file. Leave already-recommended `GoogleDriveConnection.ts` on that file. Leave already-recommended `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GooglePickerNonce.ts
// The Owner opened Google Picker
// to point a reporting destination
// at an existing folder or spreadsheet.
// Remember only the hash of that one-time nonce as one row.
// The unique key is the SHA-256 hex.
// Stamp folder-or-spreadsheet on the ticket.
// Bootstrap stamps death at ten minutes
// and leaves consumed_at null.
// The store spends the row by stamping consumed_at.
// It does not delete the row.

// ── 1. Hold the one-time Owner Drive Picker-nonce row ─────

const GooglePickerNonceSchema = new Schema(
  {
    nonce_hash: { type: String, required: true },
    owner_email: { type: String, required: true, trim: true, lowercase: true },
    flow: { type: String, required: true, enum: ["folder", "spreadsheet"] },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
  },
  {
    collection: "google_picker_nonces",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
)

// ── 2. Remember which unused hash belongs to which owner

function rememberWhichUnusedHashBelongsToWhichConfiguredOwnerWhichPickKindWhenItDiesAndWhetherItWasAlreadySpent() {
  // unique nonce_hash
  // live lookup: hashPickerNonce(plaintext selection_nonce)
  // no plaintext nonce column
  // owner_email required, not unique — a second bootstrap plants a second nonce
  // flow required folder | spreadsheet — store does not filter by it
  // bootstrap stamps expires_at at now + ten minutes
  // consumed_at default null — keep the row
  // store findOne({ nonce_hash, owner_email, expires_at > now, consumed_at: null })
  // store findOneAndUpdate same filter → consumed_at = now
}

// ── 3. Stamp the unnamed unique hash clock plus Mongo TTL and hand back the model

GooglePickerNonceSchema.index({ nonce_hash: 1 }, { unique: true })
GooglePickerNonceSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })

export const GooglePickerNonce =
  mongoose.models.GooglePickerNonce ??
  mongoose.model("GooglePickerNonce", GooglePickerNonceSchema)
export const ownerDrivePickerNonceOnTheDefaultConnection = GooglePickerNonce
```

Read the primary path out loud: *The Owner opened Google Picker to point a reporting destination at an existing folder or spreadsheet. Remember only the hash of that one-time nonce as one row: this SHA-256 hex, the configured owner email, whether the ticket is a folder pick or a spreadsheet pick, and when the ticket dies. Bootstrap stamps death at ten minutes, leaves `consumed_at` null, and hands the UI the plaintext nonce. When the Owner picks, the store finds the unused unexpired hash for that owner and hands back the stored flow. After live Drive says the file is fit, the store stamps `consumed_at` on the same row. Two spends at once yield one winner. Leftover unused and already-spent rows die when `expires_at` passes. Do not hash from here. Do not store the plaintext. Do not talk to Google from here. Do not write the selection reference from here.*

## Precise logic I would tighten while renaming

1. **Reporting knowledge never names this collection.** The Reporting Service talks about destinations and Google workbooks as a delivery surface and never lists `google_picker_nonces`. Do not rewrite that Service from this rename so “Reporting owns the Picker nonce.” Park the missing sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `google_picker_nonces`. Do not add that rule line from this rename.

3. **Consume keeps the row.** The store uses `findOneAndUpdate` on hash + owner + `expires_at > now` + `consumed_at: null`, then stamps `consumed_at`. Already-recommended consent hash uses `findOneAndDelete`. Do not switch this file to `findOneAndDelete` so “Picker matches consent” without a paired store + verify proof that replay still reads a spent row as spent (in-memory `get` after success shows `consumed_at !== null`).

4. **Bootstrap writes the model itself.** Already-recommended `bootstrapGooglePicker` still calls `GooglePickerNonce.create` after `connectMongo()`. The store has no `create`. Injected in-memory stores therefore cannot cover bootstrap — the already-recommended picker and nonce-store passes already named that write/read split load-bearing. Do not add `create` to the store so “one persistence path” without a bootstrap test on already-recommended picker’s **interface**. Do not teach bootstrap to ask the store in this rename.

5. **The store does not filter by flow.** Find / consume match hash + owner only and return the stored `flow`. Already-recommended verify uses the **nonce’s** flow, not a caller-supplied flow. Later selection store requires caller `flow`. Do not add `flow` to the store find so “the UI can change its mind.” Do not drop `flow` from this schema so “Picker already filtered views.”

6. **`owner_email` is not unique.** A second bootstrap plants a second nonce. Do not unique `owner_email` so “one Picker at a time” without a paired bootstrap proof that a second bootstrap must fail or replace.

7. **Leftover reporting owns the ten minutes.** `REPORTING_PICKER_NONCE_TTL_MS` lives in Wave B `src/config/domain/reporting.ts`. This file only stores `expires_at` and TTL-deletes when that clock is past. Do not hard-code ten minutes on the schema so “the model owns the TTL” without a paired bootstrap proof.

8. **App-level expiry and Mongo TTL are both live.** The store also filters `expires_at: { $gt: now }` and `consumed_at: null`. Mongo TTL `{ expireAfterSeconds: 0 }` is the sweeper, not the only fence. Do not drop the query filter so “TTL is enough” without a paired store proof that an expired-but-not-yet-swept row still misses.

9. **No plaintext nonce field.** Hash happens in leftover `hashPickerNonce` (SHA-256 hex). `pickerValidation.test.ts` locks determinism and “not equal to plaintext.” Do not add `selection_nonce` so “verify can skip hashing.” Do not silently switch the digest to HMAC with the encryption key so “nonce is keyed” without a paired migrate of in-flight rows.

10. **Disconnect does not sweep leftover nonces.** `disconnectGoogleDrive` deletes the durable Drive row. Leftover unused and spent nonces TTL out. Do not add `deleteMany({ owner_email })` so “disconnect owns the bag” without a paired disconnect proof.

11. **Named created-at only, version key off.** Already-recommended durable connection has `created_at` / `updated_at`. This file sets `updatedAt: false`. Do not add `updated_at` so “Picker matches the durable row.”

12. **No selected-database getter.** Bootstrap and the store ask the default model after `connectMongo()`. Do not add `getGooglePickerNonceModel()` so “CRM matches Drive.”

13. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Admin bootstrap / verify never import this file. There is no `pnpm migration:*` for these clocks. Do not invent those lines from this rename.

14. **Leave sibling modules alone.** `bootstrapGooglePicker` / `verifyGooglePickerSelection` / leftover `hashPickerNonce` / already-recommended store find / consume / later `GooglePickerSelection` create are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the unique required `nonce_hash`, the required non-unique `owner_email`, required `flow` enum `"folder" | "spreadsheet"`, required `expires_at`, `consumed_at` default `null`, named `created_at` only with `versionKey: false`, the unnamed unique `{ nonce_hash: 1 }`, the unnamed TTL `{ expires_at: 1, expireAfterSeconds: 0 }`, the omitted selected-database getter, and the omitted plaintext `selection_nonce` field. There is no `GooglePickerNonce.test.ts`. `pickerVerification.test.ts` asks the in-memory store through already-recommended verify — **never the model**. `pickerValidation.test.ts` asks leftover `hashPickerNonce` — **never this export**.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GooglePickerNonce ?? mongoose.model(...)`; there is no `getGooglePickerNonceModel`
- bootstrap asks this default model after `connectMongo()` and `create`s `{ nonce_hash: hashPickerNonce(selectionNonce), owner_email, flow, expires_at: now + ten minutes }`
- `consumed_at` is left to the schema default `null` on bootstrap
- the store finds with `findOne` on hash + owner + `expires_at > now` + `consumed_at: null` and does **not** filter by `flow`
- the store consumes with `findOneAndUpdate` on the same filter, `$set: { consumed_at: now }`, `returnDocument: "after"`
- routes / owner gate / destination / live harness ask bootstrap / verify / consume-reference — not this export
- Job Timeline does not hop `google_picker_nonces`
- historical consolidation does not list `google_picker_nonces`
- live writers never persist the plaintext nonce
- a second bootstrap may plant a second nonce for the same owner
- disconnect does not `deleteMany` leftover nonces
- unnamed clocks are exactly unique `{ nonce_hash: 1 }` plus TTL `{ expires_at: 1, expireAfterSeconds: 0 }`
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- there is no plaintext `selection_nonce` field
- there is no `file_id` field
- `schema-and-crud-inputs.mdc` still does not name `google_picker_nonces`; this pass does not invent that rule line
- Reporting knowledge still omits this collection row; this pass does not invent that line
- later `GooglePickerSelection` is a different collection; that file is out of this story
- already-recommended `GoogleOAuthState` is a different collection; that file is out of this story
- already-recommended `GoogleDriveConnection` is a different collection; that file is out of this story
- already-recommended company service account is a different identity; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story

I would not test Picker bootstrap, Picker verify, leftover hash fold, live-client construct, destination create, consent begin / complete, company service-account construct, Sheet Sync drain, or Job Timeline assemble from this file.

Do not add a test per helper (`theConsumeStampsConsumedAt`, `theKnowledgeOmitsThisCollection`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GooglePickerNonceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `nonce.ts` / `flow.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating `bootstrapGooglePicker` / `verifyGooglePickerSelection` / leftover `hashPickerNonce` / already-recommended store find / consume / later `GooglePickerSelection` / already-recommended `GoogleOAuthState` / already-recommended `GoogleDriveConnection` / already-recommended company service account / already-recommended `SheetSyncQuotaBucket` as this story.
- Inventing a selected-database seam that has only the CRM getter as an adapter.
- Inventing a one-Picker-at-a-time seam that has only unique `owner_email` as an adapter.
- Inventing a store-create seam that has only bootstrap as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, adding a plaintext `selection_nonce`, uniquing `owner_email`, switching consume to `findOneAndDelete`, adding `flow` to the store find, adding `file_id`, adding `updated_at`, rewriting Reporting knowledge, adding a Core Collections line, adding a named-index catalog, teaching bootstrap to ask the store, or sweeping leftover nonces on disconnect while recommending a rename.
- Pulling `bootstrapGooglePicker`, `hashPickerNonce`, or `findActive` / `consumeActive` into this file.
- Importing `GooglePickerNonce` into `tokenEncryption.ts` so “the lock owns the collection.”
- Merging this collection into already-recommended `GoogleOAuthState`, later `GooglePickerSelection`, already-recommended `GoogleDriveConnection`, later `ReportingDestination`, already-recommended company service account, already-recommended `SheetSyncQuotaBucket`, later `IngestionRun`, or later `ReportingRun`.
- Silently reordering `connectMongo` versus bootstrap create, find-then-Drive-then-consume versus consume-then-Drive, or revoke-at-Google versus always-delete-local versus this collection.
- Changing consume to delete-the-row so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or later `GooglePickerSelection.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `GooglePickerSelection.ts` while writing this file.
