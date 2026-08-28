# Accept The Granot CSV Download, Skip S3 When The Bytes Have Not Changed, Otherwise Store Latest Plus History And Remember The Ingestion — Never Write A Lead From Here — operational story

- Status: recommended
- Service: `granotCrmCsv` (Wave A, in-progress)
- Pass: 1 of this service — `upload.service.ts`
- Remaining in this service: `sync.service.ts`, `registry.ts`, `parser.ts`
- Target: `src/services/granotCrmCsv/upload.service.ts`
- Knowledge: none as a dedicated Service file. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) — the server-side CSV path stores a Granot download in S3 through `uploadGranotCrmCsv`, records each attempt in `granot_crm_csv_ingestions`, and treats this store as **lower priority** than the extension’s DOM-based manual/auto sync (the page shows Job Numbers the CSV often omits). That rule still names `scripts/granot_crm_csv/sync-from-s3.ts`; **that script is not on this checkout** and `package.json` has no `granot*csv*` command — apply lives on later `sync.service.ts`. Distinct from leftover CSV source seed/list/ensure: later `registry.ts`. Distinct from Owner Registry Granot CRM Source write / lifecycle / outbound SMS: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) + admin `/api/v1/admin/granot-crm-sources*` (`operationsRegistry/granotCrmSources.ts`). Distinct from HTTP session collect (live tables, Job Numbers on the page): [recommendations/granot-http-collector-index.md](granot-http-collector-index.md). Distinct from durable HTTP automation run / approved apply: [recommendations/granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) + [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from Form Lead Correction write: [recommendations/form-lead.md](form-lead.md). Distinct from Follow Up refresh / Booked Call reconciliation write: [recommendations/enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Distinct from later CSV apply (latest `uploaded` ingestion → parse → Form/Call writes): later `sync.service.ts`. This checkout’s `CONTEXT.md` does not define Granot CRM CSV ingestion / S3 latest object — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one runtime import site. No test file for this module.** Public v1 (behind `x-api-secret`): `routes/v1.routes.ts` `POST /api/v1/granot-crm/csv/uploads` → Zod `uploadGranotCrmCsvSchema` → `uploadGranotCrmCsv` → HTTP **201** when `status === "uploaded"`, **200** when `skipped_unchanged`. Barrel: `granotCrmCsv/index.ts`. Not callers: `GET /api/v1/granot-crm/csv/sources` (sibling `seed` / `list`), admin Granot CRM Source routes, `sync.service.ts` (reads ingestions this file already wrote), `parser.ts` / `keys.ts` / `storage.ts` / `registry.ts` (this file imports them), public Form/Call write, `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`, HTTP automation collect/apply. Tests that exist in the folder lock parse and S3 key folds only (`parser.test.ts`, `keys.test.ts`) — they do not import this file.
- Seams callers need: new bytes (`uploaded` + S3 history/latest/meta + `last_ingestions` stamp) vs same hash (`skipped_unchanged`, no S3 put, no restamp); HTTP 201 vs 200 (route reads `status`); caller-supplied `row_count` / `data_row_count` vs parsed counts; leftover CSV catalog ensure (sibling) vs Owner Registry Granot CRM Source write (not this folder); store-the-file (this file) vs apply-the-latest-file (later `sync.service.ts`); this S3 path vs extension DOM sync (Job Numbers on the page)
- Split later (only if the file outgrows one sitting): keep one file — this ~180-line module is one screenplay for “accept the Granot CSV download, skip S3 when the bytes have not changed, otherwise store latest plus history and remember the ingestion.” If it later splits: `bindThisGranotCsvDownloadToAWorkspaceSource.ts` / `recordThatThisGranotCsvHasNotChanged.ts` / `storeTheChangedGranotCsvAsLatestPlusHistoryAndRememberTheIngestion.ts` — story files, never `create.ts` / `upload.ts` / `skip.ts` / `update.ts` / `delete.ts`, and never merge parse, key fold, S3 send, leftover catalog ensure, or Lead apply into this file

`uploadGranotCrmCsv` is executor mechanics. The owner question is: *The extension (or a script, or a manual caller) just downloaded a Follow Up or Booked CSV from Granot. Hash the bytes. Bind the file to a workspace source. If we already stored this exact file for that kind, remember a skipped attempt and leave S3 alone. If the bytes are new, write history, overwrite latest, write the sidecar meta, remember an uploaded ingestion, and stamp the source so the next identical download can skip. This file does not write a Lead. This file does not preview enrichment. This file does not apply booked reconciliation. This file does not equal the extension’s DOM sync.*

Leftover catalog ensure, CSV parse / row identity, S3 key fold, S3 send, and later apply already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “accept the download, skip when unchanged, otherwise store latest plus history” story, not “an upload CRUD service,” and not the later apply:

1. **Bind this Granot CSV download to a workspace source** — fold origin and CSV path. SHA-256 the raw text. Parse only to count rows (sibling). Ask the leftover catalog to find or auto-create the source for this origin / workspace / Granot label / path / kind (`follow_up` | `booked`). An unmapped upload still gets a source — the sibling creates it **disabled** with a review note; this file does not flip `enabled`. Build the latest / meta / history keys from origin host, workspace slug, kind, fetched-at, and the hash prefix. This function does not put an object. This function does not write a Lead.

2. **Record that this Granot CSV has not changed** — compare the hash to `source.last_ingestions[csv_kind].content_sha256`. When they match, insert a `skipped_unchanged` `granot_crm_csv_ingestions` row that still points at the existing latest and meta keys, return that card, and **do not** call S3. **Do not** restamp `last_ingestions`. A skip is still an ingestion the owner can see. This function does not overwrite latest.

3. **Store the changed file as latest plus history, then remember the ingestion** — put the CSV at the dated history key first, put the same bytes at `latest.csv`, put `latest.meta.json` (origin, workspace, label, kind, path, hash, sizes, counts, fetched/uploaded clocks, trigger, history key). Then insert `status: "uploaded"` with the history version id when S3 returned one. Then stamp `last_ingestions[csv_kind]` (hash, ingestion id, latest key, imported-at) and `csv_paths[csv_kind]` on the source. Return the uploaded card. This function does not apply the rows. This function does not write `status: "failed"` — a thrown S3 or Mongo error leaves no failed row.

There is no fourth mutate operation. `sha256` / `s3Metadata` are folds (workspace slashes become hyphens on S3 metadata only). `frame_url` and `byte_length` arrive on the Zod body and are ignored here; stored `byte_size` is always `Buffer.byteLength` of `csv_text`.

## Organization

Keep one file as the screenplay for “accept the Granot CSV download, skip S3 when the bytes have not changed, otherwise store latest plus history and remember the ingestion.” Parse, leftover catalog ensure, key fold, and S3 send already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmCsvUploadService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — there is no Domain Command and no Mongo transaction across S3. Do not invent a second S3 **adapter** beside `putGranotCrmObject`. Do not invent a second ensure **adapter** beside `ensureSourceForUpload`.

Do not move this into `sync.service.ts` so “store and apply are one sitting.” Do not move this into `registry.ts` so “the catalog owns last_ingestions.” Do not move this into `storage.ts` so “S3 owns the ingestion row.” Do not split `skip.ts` / `upload.ts` / `create.ts`. Do not silently add the missing `sync-from-s3.ts` script so the software rule “wins.” Do not silently persist `frame_url` / `byte_length` so the Zod fields “work.” Do not silently write Mongo before S3, or wrap S3+Mongo in a transaction, so “latest cannot get ahead of last_ingestions.”

**External interface** stays small (this is the test surface). Bind, skip, and store are one story’s accept-the-download, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `uploadGranotCrmCsv` | `acceptThisGranotCsvDownloadAndStoreItUnlessTheBytesHaveNotChanged` | public POST `/api/v1/granot-crm/csv/uploads`; 201 vs 200 is the route |

Keep the old name as a one-line alias until the v1 upload handler and the barrel migrate. Do not make callers learn `last_ingestions` / `putGranotCrmObject` / `content_sha256` as the domain language.

**Principle: old exports stay as aliases.** `uploadGranotCrmCsv` remains the imported name until the public route points at the story name.

**No class for the workflow.** The type that *does* earn a name is the bound download we hand from bind to skip-or-store:

```ts
type GranotCsvDownloadBoundToASource = {
  source: GranotCrmSourceDocument
  keys: { latestKey: string; metaKey: string; historyKey: string }
  contentSha256: string
  byteSize: number
  rowCount: number
  dataRowCount: number
  fetchedAt: Date
  uploadedAt: Date
}
```

That is the handoff from “we know which workspace and what the bytes hash to” to “skip S3 or write history, latest, and meta.” Do **not** put `csv_text` on a leftover object after the puts so “ops can replay the body,” do **not** add a `failed` return so “the model enum is fully used,” and do **not** add an apply flag so “upload can also refresh Leads.”

`GranotCrmUploadInput` / `GranotCrmUploadResult` stay on sibling `types.ts` until that module’s pass. Do not move those types here “so the upload owns its card.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// upload.service.ts
// The extension (or a script, or a manual caller) downloaded
// a Follow Up or Booked CSV from Granot.
// Hash the bytes. Bind them to a workspace source.
// If we already stored this exact file for that kind,
// remember a skipped attempt and leave S3 alone.
// If the bytes are new, write history, overwrite latest,
// write the sidecar meta, remember an uploaded ingestion,
// and stamp the source so the next identical download can skip.
// This file does not write a Lead.
// This file does not apply Follow Up or Booked rows.
// This file is not the extension's DOM sync.

// ── 1. Bind this Granot CSV download to a workspace source ─

export async function acceptThisGranotCsvDownloadAndStoreItUnlessTheBytesHaveNotChanged(input)

async function bindThisGranotCsvDownloadToAWorkspaceSource(input)
function hashTheDownloadedBytes(csvText)
function countTheRowsUnlessTheCallerAlreadyDid(input, parsed)  // caller row_count wins
async function askTheLeftoverCatalogForTheWorkspaceSource(input) // sibling ensure
function nameTheLatestMetaAndHistoryKeys(bound)

// ── 2. Record that this Granot CSV has not changed ────────

function thisExactFileIsAlreadyTheLatestForThisKind(source, csvKind, hash)
async function rememberASkippedUnchangedIngestion(bound)       // no S3 put

// ── 3. Store latest plus history, then remember the ingestion

async function storeTheChangedGranotCsvAsLatestPlusHistory(bound, csvText)
  // history first, then latest.csv, then latest.meta.json
async function rememberTheUploadedIngestionAndStampTheSource(bound, history)
```

Read the primary path out loud: *Hash the downloaded CSV. Bind it to a workspace source — auto-create a disabled unmapped source if we have to. If this exact file is already the latest for Follow Up or Booked, remember a skipped ingestion and do not touch S3. If the bytes are new, write the dated history object, overwrite latest, write the sidecar meta, remember an uploaded ingestion, and stamp the source hash so the next identical download can skip. Then stop. Do not correct a Form Lead. Do not refresh a Call Lead. Do not book from a Booked row.*

That is the operation. `uploadGranotCrmCsv` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Skip and store reprint the same ingestion bag.** Both branches copy origin / workspace / label / kind / path / hash / sizes / counts / clocks / trigger / latest / meta into `Ingestion.create` and the return card. One story, two outcomes. Shared beat: `rememberTheIngestion`. Only “put S3 + stamp last_ingestions + history key / version id” differs. Collapse the bag; do not invent a second collection.

2. **Zod accepts fields this file ignores.** `frame_url` and `byte_length` are on `uploadGranotCrmCsvSchema` and never read. Stored `byte_size` is always `Buffer.byteLength(csv_text)`. Do not start persisting `frame_url` or trusting `byte_length` so “the body fields work.”

3. **`failed` exists on the model and is unreachable here.** `GRANOT_CRM_CSV_INGESTION_STATUSES` includes `failed`. This file either returns `uploaded` / `skipped_unchanged` or throws. Do not start writing a failed row on S3 errors so “the enum is honest.” Leave that to a later, tested change if the owner wants a durable miss.

4. **S3 then Mongo, no rollback.** Order is history put → latest put → meta put → ingestion insert → source `last_ingestions` / `csv_paths` save. If Mongo fails after latest is overwritten, S3 is ahead of the skip hash. Do not silently write Mongo first, and do not invent a two-phase commit, in this rename. Name the order (`storeTheChangedGranotCsvAsLatestPlusHistory` then `rememberTheUploadedIngestionAndStampTheSource`) so the seam stays visible.

5. **Skip points at latest keys it did not write this time.** That is correct only because skip is gated on `last_ingestions` from a prior store. Do not Head-Object the latest key on skip so “we prove S3 still exists.”

6. **Parse always runs, even when we will skip.** Counts are the only use, and the caller may already have sent them. Do not skip parse “for speed” in this pass — the sibling’s row-identity rules are not this file’s to bypass.

7. **No test imports this file.** `parser.test.ts` and `keys.test.ts` lock children. The public POST is untested at this **interface**. Do not treat key-path tests as upload proof.

8. **The software rule still names a missing script.** `.cursor/rules/granot-crm-csv-s3-sync.mdc` says apply is `scripts/granot_crm_csv/sync-from-s3.ts`. That path is not on this checkout. Apply is `runGranotCrmCsvSync`. Do not invent the script so the rule “wins,” and do not call apply from upload so “one HTTP hit stores and writes Leads.”

9. **Leave sibling modules alone.** `parseGranotCsv`, `ensureSourceForUpload`, `buildGranotCrmCsvObjectKeys`, `putGranotCrmObject` are already the right **depth**. This file orchestrates them. Owner Registry `createOrUpdateGranotCrmSource` is a different write.

## Testing

The **interface** is the test surface: `acceptThisGranotCsvDownloadAndStoreItUnlessTheBytesHaveNotChanged` (today `uploadGranotCrmCsv`).

There is no `upload.service.test.ts`. Replace “we tested the key strings” with tests that name the operation:

**Bind**
- Origin and CSV path are folded before ensure and before keys.
- An unmapped workspace still returns a `source_id` (sibling may create a **disabled** source). This file does not set `enabled: true`.
- `follow_up` and `booked` use different latest keys and different `last_ingestions` slots. Same bytes for the other kind still store.

**Skip when unchanged**
- Second call with the same `csv_text` for the same source + kind returns `skipped_unchanged`, creates an ingestion row, and does **not** call `putGranotCrmObject`.
- `last_ingestions[csv_kind].content_sha256` is unchanged on skip.
- The route may map that status to HTTP 200 — that assertion belongs on the route test, not a helper test.

**Store when the bytes are new**
- Puts happen in order: history CSV, `latest.csv`, `latest.meta.json`.
- Ingestion `status` is `uploaded` and carries `s3_history_key` plus optional `s3_version_id` from the history put.
- Source `last_ingestions[csv_kind]` and `csv_paths[csv_kind]` are stamped after the ingestion insert.
- Caller `row_count` / `data_row_count` win over parsed counts; omitted counts use the parse.
- `byte_size` is `Buffer.byteLength`, not `byte_length` from the body.

**What this file must not do**
- Does not import or call `updateFormLead`, `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, or `runGranotCrmCsvSync`.
- Does not write `status: "failed"`.
- Does not persist `frame_url`.

Do **not** add a test per helper (`hashTheDownloadedBytes`, `s3Metadata`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

There is no second public **adapter**. The HTTP 201/200 split stays on the route.

## What I would not do

- A `GranotCrmCsvUploadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `putGranotCrmObject` or `Ingestion.create`.
- Moving this into a CRUD folder (`create.ts` / `upload.ts` / `skip.ts`) for cleanliness.
- Breaking the S3-then-Mongo **seam** (history, latest, meta, then ingestion, then source stamp) or silently “fixing” a failed latest overwrite.
- Treating `runGranotCrmCsvSync`, Form Lead Correction, Follow Up refresh, Booked reconciliation, HTTP collect, or Owner Registry Granot CRM Source write as this story.
- Inventing a Domain Command `begin` / `complete` **seam** that has only one **adapter**.
- Inventing a second S3 **adapter** beside `putGranotCrmObject`.
- Presenting this S3 store as equivalent to the extension’s DOM sync while Follow Up / Booked CSVs can omit `job_no`.
- Inventing `scripts/granot_crm_csv/sync-from-s3.ts` so the software rule matches disk.
- Jumping to `crm` while `sync.service.ts`, `registry.ts`, or `parser.ts` are unchecked.
- Writing a whole-folder recommendation for `granotCrmCsv`.
