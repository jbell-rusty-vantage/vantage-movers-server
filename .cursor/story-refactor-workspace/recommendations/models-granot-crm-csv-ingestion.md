# Remember Each Granot CSV Download Attempt On The Selected Mongo Database With Who Asked And Whether The Bytes Were New, Keep The Latest-Per-Workspace-Kind Clock And The Same-Hash-Per-Kind Clock, And Hand Back That Database's Ingestion Model — Never Store The Bytes Here, Never Apply A Row, Never Unique The Hash, Never Write Failed, Never Merge This Into The Source Card Or The Sync Run — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 33 of this service — `GranotCrmCsvIngestion.ts`
- Remaining in this service: `GranotCrmSyncRun.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotCrmCsvIngestion.ts`
- Knowledge: there is **no** dedicated Service file in `docs/knowledge/services/` for leftover `granotCrmCsv/` or this collection. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) (`uploadGranotCrmCsv` records each attempt on `granot_crm_csv_ingestions`; apply selects the latest `status: "uploaded"` ingestion per `workspace_slug + csv_kind`; this S3 path is **lower priority** than the extension’s DOM sync because the page shows Job Numbers the CSV often omits). That rule still names `scripts/granot_crm_csv/sync-from-s3.ts`; **that script is not on this checkout** and `package.json` has no `granot*csv*` command — apply lives on already-recommended `sync.service.ts`. Already-recommended leftover store: [granot-crm-csv-upload.md](granot-crm-csv-upload.md) (`Ingestion.create` `skipped_unchanged` or `uploaded` — **this file never hashes bytes**, never puts S3). Already-recommended leftover walk: [granot-crm-csv-sync.md](granot-crm-csv-sync.md) (`find({ status: "uploaded" }).sort({ uploaded_at: -1 })` then keep newest per workspace + kind — **this file never walks rows**). Already-recommended leftover seed / leftover-find: [granot-crm-csv-registry.md](granot-crm-csv-registry.md) (**does not import this file**). Already-recommended leftover card: [models-granot-crm-source.md](models-granot-crm-source.md) (`last_ingestions.*.ingestion_id` refs `"GranotCrmCsvIngestion"` — **do not merge**). Already-recommended leftover judge: [models-granot-crm-source-semantics.md](models-granot-crm-source-semantics.md) (**do not apply the folded-label unique from this pass**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) names the leftover card collection — it does **not** name `granot_crm_csv_ingestions`. Do not rewrite that paragraph from this rename so “the Core Collections list owns download evidence.” Distinct from leftover later `GranotCrmSyncRun.ts` (pass card with `ingestion_ids[]` — **do not merge**). Distinct from leftover Best Relocation `IngestionRun` / leftover WordPress ingress receipt / leftover Granot Observation Receipt — **do not merge**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent a glossary copy for Granot CRM CSV ingestion. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model vs leftover card pointer vs leftover later pass pointer.** Already-recommended leftover `upload.service.ts` **asks** `getGranotCrmCsvIngestionModel()` twice — `Ingestion.create` `status: "skipped_unchanged"` (latest + meta keys only) or `status: "uploaded"` (plus `s3_history_key` / `s3_version_id`). Already-recommended leftover `sync.service.ts` `findLatestIngestions` **asks** the same getter `.find({ status: "uploaded" })` (optional `workspace_slug` / `csv_kind`) `.sort({ uploaded_at: -1 })` then keeps the first row per `workspace_slug:csv_kind` in memory. Already-recommended leftover `GranotCrmSource.ts` `last_ingestions.*.ingestion_id` refs `"GranotCrmCsvIngestion"` — leftover upload stamps that pointer only on store, not on skip. Leftover later `GranotCrmSyncRun.ts` `ingestion_ids[]` refs the same name — leftover sync stamps those ids after the walk. Public v1 `POST /api/v1/granot-crm/csv/uploads` asks leftover `uploadGranotCrmCsv` — **not** this file. Wave B leftover `granotCsv.validation.ts` duplicates `z.enum(["extension", "script", "manual"])` — it does **not** import `GRANOT_CRM_CSV_INGESTION_TRIGGERS`. Nobody imports default `GranotCrmCsvIngestion` except the getter same-db return. Nobody imports `GRANOT_CRM_CSV_INGESTION_STATUSES`. There is **no** `GranotCrmCsvIngestion.test.ts`. There is no named index catalog and no migration script for this collection. Not this **interface**: leftover `uploadGranotCrmCsv` itself, leftover `runGranotCrmCsvSync` itself, leftover `ensureSourceForUpload` itself, leftover `getGranotCrmSourceModel` itself, leftover `putGranotCrmObject` itself.
- Seams callers need: default `GranotCrmCsvIngestion` (first-registered connection — leftover getter same-db return) vs `getGranotCrmCsvIngestionModel()` (selected `getMongoDatabaseName()` — leftover upload create and leftover sync latest find); `status: "uploaded"` (leftover sync may walk `s3_latest_key`) vs `status: "skipped_unchanged"` (the owner can see the attempt; leftover sync ignores it) vs `status: "failed"` (declared enum word; **no runtime writer**); optional `source` ObjectId vs required denormalized `crm_origin` + `workspace_slug` + `csv_kind` (leftover sync latest key is workspace + kind, **not** `source._id`); leftover skip points at latest / meta without history / version vs leftover uploaded carries `s3_history_key` + optional `s3_version_id`; two unnamed compound indexes `{ crm_origin, workspace_slug, csv_kind, uploaded_at: -1 }` and `{ crm_origin, workspace_slug, csv_kind, content_sha256 }` vs field `index: true` on origin / workspace / kind / path / hash / status; mongoose default `autoIndex: true` (this file omits `autoIndex: false`) vs already-recommended leftover card `autoIndex: false`; this file’s trigger tuple vs Zod duplicate `["extension", "script", "manual"]`; `csv_kind` enum from leftover domain `GRANOT_CRM_CSV_KINDS` (`follow_up` | `booked`). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no unique hash **seam**. There is no S3 **seam**. There is no apply **seam**.
- Split later (only if the file outgrows one sitting): this ~115-line file is one sitting if you read it as remember each Granot CSV download attempt on the selected Mongo database with who asked and whether the bytes were new, keep the latest-per-workspace-kind clock and the same-hash-per-kind clock, and hand back that database's ingestion model — never store the bytes here, never apply a row, never unique the hash, never write failed, never merge this into the source card or the sync run. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `s3.ts`. Leftover store stays already-recommended `upload.service.ts`. Leftover walk stays already-recommended `sync.service.ts`. Leftover card stays already-recommended `GranotCrmSource.ts`. Leftover later pass card stays leftover later `GranotCrmSyncRun.ts`.

`GranotCrmCsvIngestion` is a Mongoose model name. The owner question is: *The extension (or a script, or a manual caller) just downloaded a Follow Up or Booked CSV. Remember the attempt on `granot_crm_csv_ingestions`. Say who asked (`extension` / `script` / `manual`). Say whether the bytes were new (`uploaded`) or already the latest for that kind (`skipped_unchanged`). Keep a clock so apply can find the newest uploaded file per workspace + kind. Keep a same-hash clock so the owner can see every identical download without 11000ing. If this process selected a different Mongo database, hand back that database’s ingestion model. Do not put the CSV on S3. Do not correct a Form Lead. Do not refresh a Call Lead. Do not unique the hash so skip fails. Do not write `failed` so “the enum is honest.” Do not merge this into the leftover source card or the leftover later sync run.*

Who leftover-stores the download already lives in already-recommended `upload.service.ts`. Who leftover-walks latest uploaded files already lives in already-recommended `sync.service.ts`. Who leftover-holds the leftover card already lives in already-recommended `GranotCrmSource.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember each Granot CSV download attempt on the selected Mongo database with who asked and whether the bytes were new, keep the latest-per-workspace-kind clock and the same-hash-per-kind clock, and hand back that database's ingestion model — never store the bytes here, never apply a row, never unique the hash, never write failed, never merge this into the source card or the sync run” story, not “a CSV ingestion CRUD dump,” and not Accept The Granot CSV Download / Walk The Latest Uploaded Granot CSVs themselves:

1. **Hold the Granot CSV download attempt** — collection `granot_crm_csv_ingestions`, `timestamps: true`. **No** `autoIndex: false` (mongoose default creates the field indexes and the two compound clocks on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Optional `source` (`ObjectId` ref `"GranotCrmSource"`). Required trimmed indexed `crm_origin` / `workspace_slug` / `csv_path` / `content_sha256`. Required `csv_kind` enum leftover domain `GRANOT_CRM_CSV_KINDS` (`follow_up` | `booked`). Required `byte_size` / `row_count` / `data_row_count` (`min: 0`; counts default `0`). Optional `granot_label` / `fetched_at`. Required `uploaded_at` default `Date.now`. Required `s3_bucket` / `s3_latest_key`. Optional `s3_history_key` / `s3_meta_key` / `s3_version_id` / `error`. `GranotCrmCsvIngestionDocument` is `InferSchemaType` plus `_id`. This beat does **not** hash `csv_text`. This beat does **not** put S3. This beat does **not** stamp `last_ingestions`.

2. **Remember who asked and whether the bytes were new** — `GRANOT_CRM_CSV_INGESTION_TRIGGERS` (`extension` | `script` | `manual`, default `"extension"`). `GRANOT_CRM_CSV_INGESTION_STATUSES` (`uploaded` | `skipped_unchanged` | `failed`, default `"uploaded"`, field indexed). Already-recommended leftover upload writes `uploaded` or `skipped_unchanged`. Already-recommended leftover sync reads **only** `uploaded`. Leftover `failed` is a declared word with **no writer** — leftover upload throws instead of inserting a miss; leftover sync `failed` is a **row outcome**, not this collection. Zod duplicates the trigger tuple and does not import this export. This beat does **not** elect skip vs store. This beat does **not** write `error`.

3. **Bind the selected Mongo database and declare the two compound clocks** — default export `GranotCrmCsvIngestion` is `mongoose.models.GranotCrmCsvIngestion ?? mongoose.model(...)`. `getGranotCrmCsvIngestionModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Two unnamed compound indexes: `{ crm_origin: 1, workspace_slug: 1, csv_kind: 1, uploaded_at: -1 }` (newest attempt per origin / workspace / kind) and `{ crm_origin: 1, workspace_slug: 1, csv_kind: 1, content_sha256: 1 }` (same bytes for that kind — **not unique**). Leftover upload / leftover sync **ask** the getter. This beat does **not** `syncIndexes`. This beat does **not** export a named catalog. This beat does **not** delete the default export so “everyone must call the getter.”

There is no store-the-download operation. Leftover `uploadGranotCrmCsv` elects that. There is no walk-the-latest-files operation. Leftover `runGranotCrmCsvSync` elects that. There is no leftover-record-the-card operation. Leftover `persistGranotCrmSourceInSession` elects that on the already-recommended leftover card.

## Organization

Keep one file. This is the screenplay for “remember each Granot CSV download attempt on the selected Mongo database with who asked and whether the bytes were new, keep the latest-per-workspace-kind clock and the same-hash-per-kind clock, and hand back that database's ingestion model — never store the bytes here, never apply a row, never unique the hash, never write failed, never merge this into the source card or the sync run.” Leftover store / leftover walk / leftover card / leftover S3 put already live in deeper **modules**. Leftover later pass card already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotCrmCsvIngestionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a unique `{ content_sha256: 1 }` **adapter** so “skip 11000s.” Do not invent an `autoIndex: false` **adapter** so “this matches the leftover card” without a paired leftover migration apply path. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `status.ts` each get a file.

Do not move leftover `uploadGranotCrmCsv` into this file so “the row owns the put.” Do not merge this file into already-recommended leftover `GranotCrmSource.ts` so “one schema owns the leftover card and the download evidence.” Do not merge this file into leftover later `GranotCrmSyncRun.ts` so “one file owns attempt and apply pass.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotCrmCsvIngestion` | `granotCsvDownloadAttemptOnTheDefaultConnection` | leftover getter same-db return still imports the default model |
| `getGranotCrmCsvIngestionModel` | `granotCsvDownloadAttemptOnTheSelectedMongoDatabase` | leftover upload create and leftover sync latest find must follow `getMongoDatabaseName()` |
| `GranotCrmCsvIngestionDocument` | `GranotCsvDownloadAttemptRow` | inferred document + `_id` |
| `GRANOT_CRM_CSV_INGESTION_TRIGGERS` | `WhoAskedForThisGranotCsvDownload` | leftover schema enum; leftover Zod currently duplicates the tuple |
| `GRANOT_CRM_CSV_INGESTION_STATUSES` | `WhetherThoseBytesWereNew` | leftover schema enum; leftover sync reads only `uploaded` |

Keep the old names as one-line aliases until leftover upload, leftover sync, leftover card `last_ingestions` ref, leftover later pass `ingestion_ids`, and the leftover getter same-db return migrate. Do not make callers learn `useDb` / `content_sha256` as the only domain language until those sites move. Do **not** delete the default `GranotCrmCsvIngestion` export so “everyone must call the getter” without a paired proof that leftover-getter same-db still returns today’s model leftover-upload leftover-asks through the leftover-getter. Do **not** re-export leftover `uploadGranotCrmCsv` from this file so “the row leftover-puts S3.” Do **not** re-export leftover `runGranotCrmCsvSync` so “the row leftover-applies Leads.”

**No class for the workflow.** The one type that *does* earn a name is the attempt-identity contract:

```ts
type GranotCsvDownloadAttemptIdentity = {
  collection: "granot_crm_csv_ingestions"
  who_asked: "extension" | "script" | "manual"
  whether_bytes_were_new: "uploaded" | "skipped_unchanged" | "failed"
  failed_has_a_runtime_writer: false
  hash_unique: false
  latest_key: "workspace_slug + csv_kind + uploaded_at"
  sync_reads: "uploaded"
  autoIndex: true
}
```

That is the handoff from “this process remembered a download attempt” to “leftover-sync leftover-may leftover-walk only `uploaded`, a second identical hash leftover-inserts again, and leftover-boot leftover-creates the leftover-indexes.” Do **not** add `{ hash_unique: true }` so “skip leftover-11000s.” Do **not** add `{ failed_has_a_runtime_writer: true }` so “the leftover-enum leftover-is leftover-honest.” Do **not** add `{ autoIndex: false }` so “this leftover-matches leftover the leftover-card.”

Leave already-recommended leftover `GranotCrmSource.ts` on that file. Leave leftover later `GranotCrmSyncRun.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotCrmCsvIngestion.ts
// The extension (or a script, or a manual caller) just downloaded
// a Follow Up or Booked CSV from Granot.
// Remember the attempt on granot_crm_csv_ingestions.
// Say who asked. Say whether the bytes were new.
// Keep a clock so apply can find the newest uploaded file
// per workspace + kind.
// Keep a same-hash clock so an identical download is still
// an attempt the owner can see — it must not 11000.
// If this process selected a different Mongo database,
// hand back that database's ingestion model.
// Do not put the CSV on S3.
// Do not correct a Form Lead.
// Do not refresh a Call Lead.
// Do not unique the hash.
// Do not write failed so "the enum is honest."
// Do not merge this into the source card or the later sync run.

export const WhoAskedForThisGranotCsvDownload =
  GRANOT_CRM_CSV_INGESTION_TRIGGERS
export const WhetherThoseBytesWereNew =
  GRANOT_CRM_CSV_INGESTION_STATUSES

export { WhoAskedForThisGranotCsvDownload as GRANOT_CRM_CSV_INGESTION_TRIGGERS }
export { WhetherThoseBytesWereNew as GRANOT_CRM_CSV_INGESTION_STATUSES }

export const granotCsvDownloadAttemptOnTheDefaultConnection =
  GranotCrmCsvIngestion
export function granotCsvDownloadAttemptOnTheSelectedMongoDatabase() {
  return getGranotCrmCsvIngestionModel()
}
export type GranotCsvDownloadAttemptRow = GranotCrmCsvIngestionDocument

export { granotCsvDownloadAttemptOnTheDefaultConnection as GranotCrmCsvIngestion }
export { granotCsvDownloadAttemptOnTheSelectedMongoDatabase as getGranotCrmCsvIngestionModel }
export type { GranotCsvDownloadAttemptRow as GranotCrmCsvIngestionDocument }

// ── 1. Hold the Granot CSV download attempt ───────────────

export const GranotCrmCsvIngestion =
  rememberTheGranotCsvDownloadAttemptOnTheDefaultConnection()

function rememberTheGranotCsvDownloadAttemptOnTheDefaultConnection() {
  return (
    mongoose.models.GranotCrmCsvIngestion ??
    mongoose.model("GranotCrmCsvIngestion", GranotCrmCsvIngestionSchema)
  )
}

function theAttemptPointsAtASourceWhenUploadBoundOne()      // optional source ObjectId
function theAttemptAlwaysCarriesOriginWorkspaceKindPathAndHash()
function theAttemptPointsAtLatestAndMaybeHistory()          // skip: latest+meta; uploaded: +history+version

// ── 2. Remember who asked and whether the bytes were new ─

function whoAskedForThisDownload()                          // extension | script | manual
function whetherThoseBytesWereNew()                         // uploaded | skipped_unchanged | failed
function failedIsADeclaredWordWithNoWriterHere()

// ── 3. Bind the selected Mongo database and declare the two clocks

export function getGranotCrmCsvIngestionModel() {
  return granotCsvDownloadAttemptOnTheSelectedMongoDatabase()
}

function handBackTheSelectedDatabaseIngestionModel()
function keepTheNewestAttemptClockPerOriginWorkspaceAndKind()   // uploaded_at: -1; not unique
function keepTheSameHashClockPerOriginWorkspaceAndKind()        // content_sha256; not unique
```

Read the primary path out loud: a Sales Extension upload or a script store calls `getGranotCrmCsvIngestionModel().create()` after hashing bytes and talking to S3. The row names who asked, whether the bytes were new, the SHA-256, the latest S3 key, and when it uploaded. Sync later lists `uploaded` rows newest first and keeps one per workspace plus kind. Skip never restamps `last_ingestions`. Failed is on the enum and has no runtime writer.

That is the operation. `GranotCrmCsvIngestion` as "a CSV ingestion schema dump" is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **The trigger tuple is typed twice.** This file exports `GRANOT_CRM_CSV_INGESTION_TRIGGERS`. Zod in `src/validation/v1/granotCsv.validation.ts` repeats `z.enum(["extension", "script", "manual"])`. A fourth string can compile here and 400 there. One named who-asked list should feed both. Do not open Wave B in this pass; name the smell and leave Zod for that wave.

2. **Failed is on the enum and has no runtime writer.** Upload writes `uploaded` or `skipped_unchanged`, or it throws. Sync `failed` is a later sync-run row outcome, not this collection. Name `failed_has_a_runtime_writer: false` in the identity type. Do not start writing `failed` rows so the enum looks honest.

3. **The hash clock is not unique.** Two rows can share `content_sha256`. Skip is "latest row for this source plus kind has this hash," not a unique index. Name `hash_unique: false`. Do not unique the hash in this pass.

4. **The two compound clocks have no names.** Newest-first listing and hash lookup sit as anonymous `schema.index(...)` calls. Give them exportable names the way the already-recommended Source card does, and point a later migration at those names. Do not invent the migration in this pass.

5. **Indexes create on boot.** This file does not set `autoIndex: false`. Boot can create the two compounds plus the field indexes. The already-recommended Source card uses `autoIndex: false`. Do not flip this file in the same PR as the rename. Name `autoIndex: true` in the identity type so the two files stay honest about different clocks.

6. **The inferred-row type and the default model share one name.** `export type GranotCrmCsvIngestion` is the plain inferred document. `export const GranotCrmCsvIngestion` is the default-connection model. Keep both as aliases after the story names (`GranotCsvDownloadAttemptRow` vs `granotCsvDownloadAttemptOnTheDefaultConnection`) so a later caller does not import the type when they meant the model.

7. **Nobody imports the default model or the status tuple.** Upload and sync go through the getter and string literals. After the rename, keep the default export as an alias and re-export the status list from the named whether-bytes-were-new constant.

8. **`source` is optional.** A row can exist with no Source card. Upload sets it when a registry row exists. Sync latest-key is `workspace_slug + csv_kind`, not `source._id`. Do not required-index `source` here.

9. **Software-map drift.** `.cursor/rules/granot-crm-csv-s3-sync.mdc` still names a missing `scripts/granot_crm_csv/sync-from-s3.ts`. Apply is `runGranotCrmCsvSync`. Do not invent that script from this model pass.

## Testing

The interface of this file is the selected-DB getter, the default-connection model, the two named tuples, the inferred-row type, the hydrated document type, and the two compound clocks. There is no `GranotCrmCsvIngestion.test.ts` today.

I would add one model-interface test file next to this module (or under `src/__tests__/models/` if that folder is the house style by then). I would not add helper-unit tests.

- constructing the selected-DB model uses `getMongoDatabaseName()` and `useDb`; the default export stays the same collection when the selected name matches the default connection
- the who-asked tuple is exactly `extension | script | manual` and is the same list Zod uses for `POST /api/v1/granot-crm/csv/uploads`
- the whether-bytes-were-new tuple is exactly `uploaded | skipped_unchanged | failed`
- `failed` has no runtime writer in `upload.service.ts` or `sync.service.ts` (those files throw or write a later sync-run row)
- the newest-first compound is `{ crm_origin, workspace_slug, csv_kind, uploaded_at: -1 }` and is not unique
- the hash compound is `{ crm_origin, workspace_slug, csv_kind, content_sha256 }` and is not unique
- `csv_kind` is the domain `GRANOT_CRM_CSV_KINDS` list (`follow_up | booked`), not a local copy
- skip (`skipped_unchanged`) does not stamp `GranotCrmSource.last_ingestions`
- store (`uploaded`) stamps `last_ingestions` and `csv_paths` on the Source card
- sync lists `status: "uploaded"` newest first and keeps the first row per `workspace_slug:csv_kind` in memory
- a later `GranotCrmSyncRun` may list this row's `_id` in `ingestion_ids`; that later file is out of this story
- `schema-and-crud-inputs.mdc` still does not name `granot_crm_csv_ingestions`; this pass does not invent that rule line

I would not test S3, the upload route, or Best Relocation `IngestionRun` from this file.

Do not add a test per helper (`theAttemptPointsAtASourceWhenUploadBoundOne`, `failedIsADeclaredWordWithNoWriterHere`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GranotCrmCsvIngestionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `s3.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating Best Relocation `IngestionRun`, a WordPress receipt, or a Granot Observation Receipt as this story.
- Inventing a unique-hash seam that has only one adapter.
- Silently unique-ing `content_sha256`, writing `failed` rows, applying the folded-label unique, or flipping `autoIndex: false` while recommending a rename.
- Pulling `uploadGranotCrmCsv` or `runGranotCrmCsvSync` into this file.
- Merging this collection into `GranotCrmSource` or the later `GranotCrmSyncRun`.
- Inventing `scripts/granot_crm_csv/sync-from-s3.ts`.
- Silently reordering S3 puts versus Mongo create.
- Dropping the default export or the current getter name in the same PR as the story names.
- Opening Wave B (`src/validation/`) to dedupe the trigger tuple in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `GranotCrmSyncRun.ts` while writing this file.
