# Remember The One-Time Owner Drive Picker Selection Reference As One Row — Unique SHA-256 Reference Hash, Configured Owner Email, Folder-Or-Spreadsheet Flow, Drive-Proven File Id / Mime / Name / Url, Optional Spreadsheet Parent, Expiry Clock Verify Stamps At Fifteen Minutes, Consumed-At Default Null (Keep The Row), Named Created Timestamp Only With Version Key Off, Unnamed Unique Hash Clock Plus Mongo TTL When Expires-At Passes, And The Default Connection After Connect Mongo — Never Mint Or Hash Here, Never Verify The Pick Here, Never Find Or Consume Via The Store Here, Never Fetch Drive Or Write A Destination, Never Merge This Into The Consent Hash Or The Nonce — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 45 of this service — `GooglePickerSelection.ts`
- Remaining in this service: `RingCentralInboundRoute.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GooglePickerSelection.ts`
- Knowledge: none for this file. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks are a **delivery surface**; leftover destination resolve asks already-recommended `consumePickerSelectionReference` after already-recommended verify already wrote this row through the store — **this file never verifies the pick, never hashes, never finds or consumes, never fetches Drive, never writes a destination**). That Service never names `google_picker_selections`, this model, unique `reference_hash`, `flow`, `file_id`, or `consumed_at`. Do **not** rewrite Reporting from this rename so “Reporting owns the Picker selection.” Already-recommended Owner pick: [google-drive-oauth-picker.md](google-drive-oauth-picker.md) (`verifyGooglePickerSelection` asks already-recommended store `create` after nonce consume wins; `consumePickerSelectionReference` finds then spends through the same store after a later Drive get — **this file never talks to Google**). Already-recommended selection store: [google-drive-oauth-picker-selection-store.md](google-drive-oauth-picker-selection-store.md) (`create` / `findOne` / `findOneAndUpdate` after `connectMongo()` — **never owns the schema**). Already-recommended nonce: [models-google-picker-nonce.md](models-google-picker-nonce.md) (`google_picker_nonces` — unique `nonce_hash`, store **does not** filter by `flow`, bootstrap writes the model **itself** — **do not merge**). Already-recommended nonce store: [google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md) — **never this collection**. Already-recommended authorize desk: [routes-google-drive-oauth.md](routes-google-drive-oauth.md) asks bootstrap / verify — **never imports this file**, **never consumes the selection**. Already-recommended signed-owner HTTP gate: [google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) sits in front of bootstrap / verify — **not this export**. Already-recommended leftover hash fold: [reporting-destination-identity.md](reporting-destination-identity.md) (`hashPickerSelectionReference` SHA-256 hex — **this file never hashes**). Already-recommended leftover TTL: Wave B `src/config/domain/reporting.ts` `REPORTING_PICKER_SELECTION_TTL_MS` (fifteen minutes) — **this file only stores `expires_at`**. Already-recommended durable connection: [models-google-drive-connection.md](models-google-drive-connection.md) — **do not merge**. Already-recommended consent hash: [models-google-oauth-state.md](models-google-oauth-state.md) (`google_oauth_states` — consume is `findOneAndDelete`, **no** `flow`, **no** `consumed_at`, **no** file snapshot — **do not merge**). Already-recommended company identity: [google-auth-service-account.md](google-auth-service-account.md) — **do not merge**. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `google_picker_selections`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the Picker selection.” Distinct from already-recommended `GooglePickerNonce.ts`. Distinct from already-recommended `GoogleOAuthState.ts`. Distinct from already-recommended `GoogleDriveConnection.ts`. Distinct from later `ReportingDestination.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for Owner Drive / Picker selection reference. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended `pickerSelectionStore.ts` is the **only** runtime import. Mongo **adapter** asks `GooglePickerSelection` after `connectMongo()`: `create` (record omits `consumed_at`; schema default `null`), `countDocuments` (`expires_at > now` plus `consumed_at: null` — **no** owner / flow filter; `countActive` has **no** runtime caller), `findOne` (`reference_hash` plus `owner_email` plus `flow` plus `expires_at: { $gt: now }` plus `consumed_at: null`) and `findOneAndUpdate` (same filter, `$set: { consumed_at: now }`, `returnDocument: "after"`). Already-recommended `picker.service.ts` asks the store, **not** this file: verify `create`s after leftover `hashPickerSelectionReference(selectionReference)` (`randomBytes(32).toString("base64url")`), leftover `expectedConfiguredOwnerEmail()`, the **consumed nonce’s** `flow`, Drive-proven `file_id` / `mime_type` / `name` / `url`, `parent_folder_id` only when flow is `"spreadsheet"` (`metadata.parentFolderIds[0]`), and `expires_at` now + `REPORTING_PICKER_SELECTION_TTL_MS` = fifteen minutes. Already-recommended consume asks the store find then spend after a later Drive get on stored `file_id` and returns **that** get’s name / url / mime — **not** the stored snapshot. Already-recommended routes / owner gate / leftover destination / live harness ask bootstrap / verify / consume-reference — **not this file**. Tests: `pickerVerification.test.ts` seeds `InMemoryPickerSelectionStore` and locks consume-after-validate / replay / concurrent one-winner / failed-metadata-leaves-`consumed_at`-null / denylist-leaves-the-row on already-recommended consume — **never constructs `GooglePickerSelection`**. `pickerValidation.test.ts` locks leftover `hashPickerSelectionReference` SHA-256 hex determinism — **never imports this model**. There is **no** `GooglePickerSelection.test.ts`. There is **no** `getGooglePickerSelectionModel()`. There is **no** `pnpm migration:*` for this collection. Job Timeline does **not** hop this collection. Historical consolidation does **not** list `google_picker_selections`. Disconnect does **not** delete leftover selections (Mongo TTL plus the app-level `$gt` + `consumed_at: null` + flow filter retire unused ones; spent rows keep `consumed_at` until TTL). Not this **interface**: `verifyGooglePickerSelection` itself, `consumePickerSelectionReference` itself, `hashPickerSelectionReference` itself, already-recommended store create / find / consume themselves, already-recommended `GooglePickerNonce` writes themselves, leftover destination create itself.
- Seams callers need: default `GooglePickerSelection` (first-registered connection — the store `create`s / finds / spends it after `connectMongo()`) vs **no** `getGooglePickerSelectionModel()`; unique required `reference_hash` vs **no** plaintext `selection_reference` column; required trimmed lowercase `owner_email` vs **not** unique (a second verify plants a second selection); required `flow` enum `"folder" | "spreadsheet"` vs store find / consume that **do** filter by flow (leftover destination must spend a folder ticket as a folder and a workbook ticket as a workbook); required Drive snapshot `file_id` / `mime_type` / `name` / `url` vs consume that re-fetches Drive and **does not** return the stored display; optional trimmed `parent_folder_id` vs verify that writes it only when flow is `"spreadsheet"` vs store fold `null → undefined`; required `expires_at` vs leftover-owned fifteen-minute `REPORTING_PICKER_SELECTION_TTL_MS` vs Mongo TTL `{ expires_at: 1 }` `expireAfterSeconds: 0`; `consumed_at` default `null` (keep the row) vs already-recommended consent hash `findOneAndDelete`; verify writes **through the store** vs already-recommended nonce bootstrap that writes the model **itself**; named timestamp `{ createdAt: "created_at", updatedAt: false }` vs `versionKey: false`; unnamed unique `{ reference_hash: 1 }` plus unnamed TTL `{ expires_at: 1 }` vs **no** named catalog and **no** `pnpm migration:*` for this collection; omitted `autoIndex: false` (mongoose default creates both clocks on boot). There is no verify / consume Domain Command **seam**. There is no HTTP **seam**. There is no hash **seam**. There is no selected-database **seam**. There is no company-key **adapter**.
- Split later (only if the file outgrows one sitting): this ~47-line file is one sitting if you read it as remember the one-time Owner Drive Picker selection reference as one row — unique SHA-256 reference hash, configured owner email, folder-or-spreadsheet flow, Drive-proven file id / mime / name / url, optional spreadsheet parent, expiry clock verify stamps at fifteen minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never verify the pick here, never find or consume via the store here, never fetch Drive or write a destination, never merge this into the consent hash or the nonce. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `reference.ts` / `flow.ts` / `file.ts`. Verify / consume stay already-recommended `picker.service.ts`. Hash stays leftover `hashPickerSelectionReference`. Create / find / consume stay already-recommended `pickerSelectionStore.ts`. Already-recommended nonce stays already-recommended `GooglePickerNonce.ts`. Already-recommended consent hash stays already-recommended `GoogleOAuthState.ts`. Later destination stays later `ReportingDestination.ts`.

`GooglePickerSelection` is a Mongoose model name. The owner question is: *Already-recommended verify just proved a folder or spreadsheet against live Drive and spent the one-time nonce. It minted a raw 32-byte selection reference and leftover destination hashed that ticket. Remember only the hash of that one-time reference as one row on `google_picker_selections`. The unique key is the SHA-256 hex. Stamp the configured owner email, whether this ticket is a folder pick or a spreadsheet pick, the Drive-proven file id / mime / name / url, the first parent when the ticket is a workbook, and when the ticket dies. Verify stamps death at now plus fifteen minutes and leaves `consumed_at` null. Hand back the default-connection model after `connectMongo()`. When leftover destination spends the ticket, the store looks up the unused unexpired hash for that owner **and that caller flow** and hands back the stored `file_id` so leftover destination can fetch Drive again. After live Drive says the pick still holds, the store spends the same row once by stamping `consumed_at` — it does not delete the row. Do not mint the reference. Do not hash. Do not store the plaintext ticket. Do not talk to Google. Do not write a destination. Do not invent a selected-database getter so “CRM matches Drive.” Do not unique `owner_email` so “one Picker at a time.” Do not switch consume to `findOneAndDelete` so “selection matches consent.” Do not teach verify to write the model itself so “this matches the nonce bootstrap.” Do not merge this into the ten-minute consent hash or the already-recommended Picker nonce.*

Who verifies / consumes already lives in already-recommended `picker.service.ts`. Who hashes the reference already lives in leftover `hashPickerSelectionReference`. Who creates / finds / consumes already lives in already-recommended `pickerSelectionStore.ts`. Who spent the nonce already lives in already-recommended `GooglePickerNonce.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the one-time Owner Drive Picker selection reference as one row — unique SHA-256 reference hash, configured owner email, folder-or-spreadsheet flow, Drive-proven file id / mime / name / url, optional spreadsheet parent, expiry clock verify stamps at fifteen minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never verify the pick here, never find or consume via the store here, never fetch Drive or write a destination, never merge this into the consent hash or the nonce” story, not “a google-picker-selection CRUD dump,” and not Hand The Owner A One-Time Picker / Persist The Proven Pick itself:

1. **Hold the one-time Owner Drive Picker-selection-reference row** — collection `google_picker_selections`, timestamps `{ createdAt: "created_at", updatedAt: false }`, `versionKey: false`. **No** `autoIndex: false` (mongoose default creates the unique hash clock and the TTL clock on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required `reference_hash` (String). Required trimmed lowercase `owner_email`. Required `flow` enum `"folder" | "spreadsheet"`. Required trimmed `file_id`. Required trimmed `mime_type`. Required trimmed `name`. Required trimmed `url`. Optional trimmed `parent_folder_id`. Required `expires_at` (Date). `consumed_at` (Date, default `null`). `GooglePickerSelectionDocument` is `InferSchemaType` plus `_id`. This beat does **not** `create`. This beat does **not** hash. This beat does **not** mint 32 random bytes.

2. **Remember which unused hash belongs to which configured owner, which pick kind, which Drive-proven file, when it dies, and whether it was already spent** — unique `reference_hash` is the identity. Live writers look up `hashPickerSelectionReference(selection_reference)` (leftover SHA-256 hex). There is **no** plaintext `selection_reference` column. `owner_email` is required and folded lowercase, and it is **not** unique — a second verify plants a second selection for the same owner. `flow` is required and is a **match key**: the store finds / spends with hash + owner + **caller flow**. Already-recommended consume therefore cannot spend a folder ticket as a workbook. Verify stamps `expires_at` at `Date.now() + REPORTING_PICKER_SELECTION_TTL_MS` (fifteen minutes) and leaves `consumed_at` at the default `null`. Verify writes `file_id` / `mime_type` / `name` / `url` from **that** Drive get, and writes `parent_folder_id` only when the consumed nonce’s flow is `"spreadsheet"` (`metadata.parentFolderIds[0]`). The store finds with `findOne({ reference_hash, owner_email, flow, expires_at: { $gt: now }, consumed_at: null })` then spends with `findOneAndUpdate` on the same filter plus `{ $set: { consumed_at: now } }`. Missing / expired / already used / mismatched owner / mismatched flow → already-recommended `picker_invalid_reference`. Stored `name` / `url` / `mime_type` are snapshots; already-recommended consume returns the **later** Drive get. This beat does **not** rewrite `REPORTING_PICKER_SELECTION_TTL_MS`. This beat does **not** unique the owner. This beat does **not** drop `flow` from the store find.

3. **Stamp the unnamed unique hash clock plus Mongo TTL and hand back the default-connection model** — `Schema.index({ reference_hash: 1 }, { unique: true })` and `Schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })`. There is **no** `GOOGLE_PICKER_SELECTION_INDEXES` catalog. There is **no** collection-name export. Default export `GooglePickerSelection` is `mongoose.models.GooglePickerSelection ?? mongoose.model(...)`. There is **no** `getGooglePickerSelectionModel()`. The store `create`s / finds / spends this default model after `connectMongo()`. This beat does **not** `syncIndexes`. This beat does **not** delete the default export so “everyone must call a getter.”

There is no leftover-verify-pick operation. `verifyGooglePickerSelection` writes this row **through the store** after nonce consume wins. There is no leftover-consume-reference operation. `consumePickerSelectionReference` finds then consumes through already-recommended store after a later Drive get. There is no leftover-write-destination operation. Leftover destination resolve asks already-recommended consume, then later `ReportingDestination`. There is no leftover-disconnect-selection-sweep operation. `disconnectGoogleDrive` deletes the durable Drive row and does **not** `deleteMany` leftover selections. There is no leftover-count-active operation. Store `countActive` has **no** runtime caller.

## Organization

Keep one file. This is the screenplay for “remember the one-time Owner Drive Picker selection reference as one row — unique SHA-256 reference hash, configured owner email, folder-or-spreadsheet flow, Drive-proven file id / mime / name / url, optional spreadsheet parent, expiry clock verify stamps at fifteen minutes, consumed-at default null (keep the row), named created timestamp only with version key off, unnamed unique hash clock plus Mongo TTL when expires-at passes, and the default connection after connect Mongo — never mint or hash here, never verify the pick here, never find or consume via the store here, never fetch Drive or write a destination, never merge this into the consent hash or the nonce.” Verify / consume / leftover hash / leftover TTL / authorize desk / owner gate already live in deeper **modules**. Already-recommended picker nonce / already-recommended consent hash / already-recommended durable connection / later destination already live in sibling **modules**. Do not pull those in. Do not invent a `GooglePickerSelectionService` class. Do not invent a verify / consume Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the CRM name” without a paired store migration to the getter. Do not invent an `autoIndex: false` **adapter** so “this matches the CRM name” without a paired proof that boot no longer creates the unique hash clock and the TTL clock. Do not invent a one-Picker-at-a-time **adapter** so “unique owner_email owns verify.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `hash.ts` / `reference.ts` / `flow.ts` / `file.ts` each get a file.

Do not move `verifyGooglePickerSelection` into this file so “the row owns Picker.” Do not move `hashPickerSelectionReference` into this file so “the schema owns the digest.” Do not move `create` / `findActive` / `consumeActive` into this file so “the model is the store.” Do not teach verify to `GooglePickerSelection.create` so “this matches the nonce bootstrap” without a paired verify test on already-recommended picker’s **interface** (injected in-memory stores would miss that write). Do not merge this file into already-recommended `GooglePickerNonce.ts` so “one ticket schema owns the nonce and the selection.” Do not merge this file into already-recommended `GoogleOAuthState.ts` so “one nonce schema owns Drive consent and Picker.” Do not merge this file into already-recommended `GoogleDriveConnection.ts` so “one schema owns the durable connection and the fifteen-minute selection.” Do not merge this file into later `ReportingDestination.ts` so “the destination row is the ticket.” Do not merge this file into already-recommended `serviceAccount.ts` so “one Google identity.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GooglePickerSelection` | `ownerDrivePickerSelectionOnTheDefaultConnection` | the store `create`s / finds / spends the default model after `connectMongo()` |
| `GooglePickerSelectionDocument` | `OwnerDrivePickerSelection` | inferred document + `_id` |

Keep the old names as one-line aliases until the store migrates. Do not make callers learn `useDb` / `autoIndex` / `findOneAndUpdate` as the only domain language until those sites move. Do **not** add a `getGooglePickerSelectionModel` export so “CRM matches Drive” without a paired proof that `connectMongo()` already binds the selected database. Do **not** re-export `verifyGooglePickerSelection` / `consumePickerSelectionReference` / `hashPickerSelectionReference` / `create` / `findActive` / `consumeActive` from this file so “the row verifies the pick, hashes the ticket, or spends the reference.”

**No class for the workflow.** The one type that *does* earn a name is the Owner-Drive-Picker-selection identity contract:

```ts
type OwnerDrivePickerSelectionIdentity = {
  collection: "google_picker_selections"
  reference_hash_unique: true
  owner_email_unique: false
  live_lookup_key: "hashPickerSelectionReference(selection_reference)"
  live_find_filter: ["reference_hash", "owner_email", "flow", "expires_at > now", "consumed_at = null"]
  live_find_filters_by_flow: true
  consume: "findOneAndUpdate consumed_at null → now"
  consume_keeps_the_row: true
  plaintext_reference_field: false
  hash_lives_in_destination_identity: true
  verify_writes_through_the_store: true
  store_owns_create_find_and_consume: true
  verify_ttl_ms: 15 * 60 * 1_000
  flow: ["folder", "spreadsheet"]
  file_snapshot: ["file_id", "mime_type", "name", "url"]
  parent_folder_id_optional: true
  parent_written_only_for_spreadsheet: true
  consume_returns_later_drive_get: true
  timestamps: { created_at: true, updated_at: false }
  versionKey: false
  ttl: { expires_at: 1, expireAfterSeconds: 0 }
  selected_database_getter: false
  autoIndex: true
  named_index_catalog: false
  unnamed_indexes: [
    { reference_hash: 1, unique: true },
    { expires_at: 1, expireAfterSeconds: 0 },
  ]
  disconnect_deletes_leftover_selections: false
  countActive_has_runtime_caller: false
}
```

That is the handoff from “this process remembered the one-time Picker selection” to “the store may create it after verify spent the nonce, leftover destination may find it then spend it by stamping `consumed_at` after a later Drive get, Mongo may drop it after `expires_at`, and boot creates the unique hash clock plus the TTL clock.” Do **not** add `{ selected_database_getter: true }` so “this matches the CRM name.” Do **not** add `{ autoIndex: false }` so “this matches the CRM name.” Do **not** add `{ plaintext_reference_field: true }` so “consume can skip hashing.” Do **not** add `{ owner_email_unique: true }` so “one Picker at a time.” Do **not** add `{ consume: "findOneAndDelete" }` so “this matches the consent hash.” Do **not** add `{ live_find_filters_by_flow: false }` so “this matches the nonce store.” Do **not** add `{ verify_writes_through_the_store: false }` so “verify writes the model itself.” Do **not** add `{ consume_returns_later_drive_get: false }` so “the stored display name wins.” Do **not** add `{ disconnect_deletes_leftover_selections: true }` so “disconnect owns the bag.” Do **not** add `{ verify_ttl_ms: 10 * 60 * 1_000 }` so “selection matches the nonce.” Do **not** add `{ countActive_has_runtime_caller: true }` so “the unused count is a dashboard.”

Leave already-recommended `GooglePickerNonce.ts` on that file. Leave already-recommended `GoogleOAuthState.ts` on that file. Leave already-recommended `GoogleDriveConnection.ts` on that file. Leave later `ReportingDestination.ts` on that file. Leave later `RingCentralInboundRoute.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GooglePickerSelection.ts
// Already-recommended verify just proved
// a folder or spreadsheet against live Drive
// and spent the one-time nonce.
// Remember only the hash of that one-time
// selection reference as one row.
// The unique key is the SHA-256 hex.
// Stamp folder-or-spreadsheet on the ticket.
// Stamp the Drive-proven file snapshot.
// Verify stamps death at fifteen minutes
// and leaves consumed_at null.
// The store spends the row by stamping consumed_at.
// It does not delete the row.

// ── 1. Hold the one-time Owner Drive Picker-selection row ─

const GooglePickerSelectionSchema = new Schema(
  {
    reference_hash: { type: String, required: true },
    owner_email: { type: String, required: true, trim: true, lowercase: true },
    flow: { type: String, required: true, enum: ["folder", "spreadsheet"] },
    file_id: { type: String, required: true, trim: true },
    mime_type: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    parent_folder_id: { type: String, trim: true },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
  },
  {
    collection: "google_picker_selections",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
)

// ── 2. Remember which unused hash belongs to which owner

function rememberWhichUnusedHashBelongsToWhichConfiguredOwnerWhichPickKindWhichDriveProvenFileWhenItDiesAndWhetherItWasAlreadySpent() {
  // unique reference_hash
  // live lookup: hashPickerSelectionReference(plaintext selection_reference)
  // no plaintext reference column
  // owner_email required, not unique — a second verify plants a second selection
  // flow required folder | spreadsheet — store filters by it
  // file_id / mime_type / name / url required — consume re-fetches Drive
  // parent_folder_id optional — verify writes it only for spreadsheet
  // verify stamps expires_at at now + fifteen minutes
  // consumed_at default null — keep the row
  // store create after connectMongo (verify never writes the model itself)
  // store findOne({ reference_hash, owner_email, flow, expires_at > now, consumed_at: null })
  // store findOneAndUpdate same filter → consumed_at = now
}

// ── 3. Stamp the unnamed unique hash clock plus Mongo TTL and hand back the model

GooglePickerSelectionSchema.index({ reference_hash: 1 }, { unique: true })
GooglePickerSelectionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })

export const GooglePickerSelection =
  mongoose.models.GooglePickerSelection ??
  mongoose.model("GooglePickerSelection", GooglePickerSelectionSchema)
export const ownerDrivePickerSelectionOnTheDefaultConnection = GooglePickerSelection
```

Read the primary path out loud: *Already-recommended verify just proved a folder or spreadsheet against live Drive and spent the one-time nonce. Remember only the hash of that one-time selection reference as one row: this SHA-256 hex, the configured owner email, whether the ticket is a folder pick or a spreadsheet pick, the Drive-proven file id / mime / name / url, the first parent when the ticket is a workbook, and when the ticket dies. Verify stamps death at fifteen minutes, leaves `consumed_at` null, and hands leftover destination the plaintext reference. When leftover destination spends the ticket, the store finds the unused unexpired hash for that owner and that caller flow and hands back the stored `file_id`. After live Drive says the file is still fit, the store stamps `consumed_at` on the same row. Two spends at once yield one winner. Failed metadata / denylist leave `consumed_at` null. Leftover unused and already-spent rows die when `expires_at` passes. Do not hash from here. Do not store the plaintext. Do not talk to Google from here. Do not write the destination from here.*

## Precise logic I would tighten while renaming

1. **Reporting knowledge never names this collection.** The Reporting Service talks about destinations and Google workbooks as a delivery surface and never lists `google_picker_selections`. Do not rewrite that Service from this rename so “Reporting owns the Picker selection.” Park the missing sentence for a later knowledge pass.

2. **Core Collections omits this file.** `schema-and-crud-inputs.mdc` does not name `google_picker_selections`. Do not add that rule line from this rename.

3. **Consume keeps the row.** The store uses `findOneAndUpdate` on hash + owner + **flow** + `expires_at > now` + `consumed_at: null`, then stamps `consumed_at`. Already-recommended consent hash uses `findOneAndDelete`. Do not switch this file to `findOneAndDelete` so “selection matches consent” without a paired store + consume proof that replay still reads a spent row as spent (in-memory `get` after success shows `consumed_at !== null`).

4. **Verify writes through the store.** Already-recommended `verifyGooglePickerSelection` still calls `getPickerSelectionStore().create` after nonce consume wins. It does **not** import this model. Already-recommended nonce bootstrap still writes `GooglePickerNonce.create` itself. Do not teach verify to write this model so “one persistence path with the nonce” without a paired verify test on already-recommended picker’s **interface** — injected in-memory stores would miss that write. Do not drop store `create` so “the model owns persist.”

5. **The store filters by flow.** Find / consume match hash + owner + **caller flow**. Already-recommended consume therefore cannot spend a folder ticket as a workbook. Already-recommended nonce store matches hash + owner only and returns the stored `flow`. Do not drop `flow` from this store find so “Picker matches the nonce” without a paired consume proof that a folder ticket spent as `"spreadsheet"` still misses. Do not add `flow` to the nonce store from this rename.

6. **`owner_email` is not unique.** A second verify plants a second selection. Do not unique `owner_email` so “one Picker at a time” without a paired verify proof that a second verify must fail or replace.

7. **Leftover reporting owns the fifteen minutes.** `REPORTING_PICKER_SELECTION_TTL_MS` lives in Wave B `src/config/domain/reporting.ts`. Nonce TTL is ten minutes (`REPORTING_PICKER_NONCE_TTL_MS`). This file only stores `expires_at` and TTL-deletes when that clock is past. Do not hard-code fifteen minutes on the schema so “the model owns the TTL” without a paired verify proof. Do not silently change this to ten minutes so “selection matches the nonce.”

8. **App-level expiry and Mongo TTL are both live.** The store also filters `expires_at: { $gt: now }` and `consumed_at: null`. Mongo TTL `{ expireAfterSeconds: 0 }` is the sweeper, not the only fence. Do not drop the query filter so “TTL is enough” without a paired store proof that an expired-but-not-yet-swept row still misses.

9. **No plaintext reference field.** Hash happens in leftover `hashPickerSelectionReference` (SHA-256 hex). `pickerValidation.test.ts` locks determinism and “not equal to plaintext.” Do not add `selection_reference` so “consume can skip hashing.” Do not silently switch the digest to HMAC with the encryption key so “reference is keyed” without a paired migrate of in-flight rows.

10. **Stored display does not win.** Verify snapshots `name` / `url` / `mime_type` from the first Drive get. Already-recommended consume returns the **later** get. Do not teach consume to return stored `name` / `url` so “we can skip a second Drive get” without a paired consume proof on already-recommended picker’s **interface**.

11. **`parent_folder_id` is optional.** Verify writes it only when the consumed nonce’s flow is `"spreadsheet"`. The store folds `null → undefined`. Folder tickets omit it. Consume’s `expectedParentFolderId` is a later metadata assert, not a store match key. Do not require `parent_folder_id` so “every pick has a parent.” Do not add it to the store find so “the UI can change its mind.”

12. **Failed metadata leaves the row unused.** `pickerVerification.test.ts` locks invalid mime / trash / inaccessible / denylist on already-recommended consume: `consumed_at` stays `null`. Concurrent valid consumes yield one winner (`picker_invalid_reference`). Do not stamp `consumed_at` before the later Drive get so “find already spent it.”

13. **Disconnect does not sweep leftover selections.** `disconnectGoogleDrive` deletes the durable Drive row. Leftover unused and spent selections TTL out. Do not add `deleteMany({ owner_email })` so “disconnect owns the bag” without a paired disconnect proof.

14. **Named created-at only, version key off.** Already-recommended durable connection has `created_at` / `updated_at`. This file sets `updatedAt: false`. Do not add `updated_at` so “Picker matches the durable row.”

15. **No selected-database getter.** The store asks the default model after `connectMongo()`. Do not add `getGooglePickerSelectionModel()` so “CRM matches Drive.”

16. **`countActive` is not an owner operation.** The store implements unused + unexpired count with **no** owner / flow filter and **no** runtime caller. Do not invent a dashboard for it from this rename.

17. **Software-map gap.** Job Timeline does not hop this collection. Historical consolidation does not list it. Admin bootstrap / verify never import this file. There is no `pnpm migration:*` for these clocks. Do not invent those lines from this rename.

18. **Leave sibling modules alone.** `verifyGooglePickerSelection` / `consumePickerSelectionReference` / leftover `hashPickerSelectionReference` / already-recommended store create / find / consume / already-recommended `GooglePickerNonce` create are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the unique required `reference_hash`, the required non-unique `owner_email`, required `flow` enum `"folder" | "spreadsheet"`, required `file_id` / `mime_type` / `name` / `url`, optional `parent_folder_id`, required `expires_at`, `consumed_at` default `null`, named `created_at` only with `versionKey: false`, the unnamed unique `{ reference_hash: 1 }`, the unnamed TTL `{ expires_at: 1, expireAfterSeconds: 0 }`, the omitted selected-database getter, and the omitted plaintext `selection_reference` field. There is no `GooglePickerSelection.test.ts`. `pickerVerification.test.ts` asks the in-memory store through already-recommended verify / consume — **never the model**. `pickerValidation.test.ts` asks leftover `hashPickerSelectionReference` — **never this export**.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GooglePickerSelection ?? mongoose.model(...)`; there is no `getGooglePickerSelectionModel`
- the store asks this default model after `connectMongo()` and `create`s `{ reference_hash: hashPickerSelectionReference(selection_reference), owner_email, flow, file_id, mime_type, name, url, parent_folder_id?, expires_at: now + fifteen minutes }`
- `consumed_at` is left to the schema default `null` on create
- verify asks the store, **not** this export; it does **not** `GooglePickerSelection.create`
- the store finds with `findOne` on hash + owner + **flow** + `expires_at > now` + `consumed_at: null`
- the store consumes with `findOneAndUpdate` on the same filter, `$set: { consumed_at: now }`, `returnDocument: "after"`
- leftover destination / live harness ask already-recommended consume — not this export
- routes / owner gate ask bootstrap / verify — not this export
- Job Timeline does not hop `google_picker_selections`
- historical consolidation does not list `google_picker_selections`
- live writers never persist the plaintext selection reference
- a second verify may plant a second selection for the same owner
- disconnect does not `deleteMany` leftover selections
- unnamed clocks are exactly unique `{ reference_hash: 1 }` plus TTL `{ expires_at: 1, expireAfterSeconds: 0 }`
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- there is no plaintext `selection_reference` field
- `parent_folder_id` is optional; verify writes it only for `"spreadsheet"`
- store `countActive` has no runtime caller
- `schema-and-crud-inputs.mdc` still does not name `google_picker_selections`; this pass does not invent that rule line
- Reporting knowledge still omits this collection row; this pass does not invent that line
- already-recommended `GooglePickerNonce` is a different collection; that file is out of this story
- already-recommended `GoogleOAuthState` is a different collection; that file is out of this story
- already-recommended `GoogleDriveConnection` is a different collection; that file is out of this story
- already-recommended company service account is a different identity; that file is out of this story
- later `ReportingDestination` is a different collection; that file is out of this story
- later `RingCentralInboundRoute` is a different collection; that file is out of this story

I would not test Picker verify, Picker consume, leftover hash fold, live-client construct, destination create, consent begin / complete, company service-account construct, Sheet Sync drain, or Job Timeline assemble from this file.

Do not add a test per helper (`theConsumeStampsConsumedAt`, `theKnowledgeOmitsThisCollection`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GooglePickerSelectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `hash.ts` / `reference.ts` / `flow.ts` / `file.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating `verifyGooglePickerSelection` / `consumePickerSelectionReference` / leftover `hashPickerSelectionReference` / already-recommended store create / find / consume / already-recommended `GooglePickerNonce` / already-recommended `GoogleOAuthState` / already-recommended `GoogleDriveConnection` / already-recommended company service account / later `ReportingDestination` as this story.
- Inventing a selected-database seam that has only the CRM getter as an adapter.
- Inventing a one-Picker-at-a-time seam that has only unique `owner_email` as an adapter.
- Inventing a verify-writes-the-model seam that has only nonce bootstrap as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, adding a plaintext `selection_reference`, uniquing `owner_email`, switching consume to `findOneAndDelete`, dropping `flow` from the store find, teaching verify to write the model itself, teaching consume to return stored `name` / `url`, requiring `parent_folder_id`, adding `updated_at`, rewriting Reporting knowledge, adding a Core Collections line, adding a named-index catalog, promoting `countActive`, or sweeping leftover selections on disconnect while recommending a rename.
- Pulling `verifyGooglePickerSelection`, `hashPickerSelectionReference`, or `create` / `findActive` / `consumeActive` into this file.
- Importing `GooglePickerSelection` into `tokenEncryption.ts` so “the lock owns the collection.”
- Merging this collection into already-recommended `GooglePickerNonce`, already-recommended `GoogleOAuthState`, already-recommended `GoogleDriveConnection`, later `ReportingDestination`, already-recommended company service account, later `IngestionRun`, or later `ReportingRun`.
- Silently reordering `connectMongo` versus store create, find-then-Drive-then-consume versus consume-then-Drive, or revoke-at-Google versus always-delete-local versus this collection.
- Changing consume to delete-the-row so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or later `RingCentralInboundRoute.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `RingCentralInboundRoute.ts` while writing this file.
