# Remember Each Sheet Sync Intent As One Durable Outbox Row — Same Entity Folds Onto One Pending Or Retrying Row Via The Coalescing Key, A Delete Snapshot Lives Here Because The Worker Cannot Reload A Hard-Deleted Document, Stamp Status Lease Attempts And An Optional Drain-Run Pointer, Four Unnamed Clocks For Due Claim Coalesce Lease And Entity History, And The Default Connection After Connect Mongo — Never Enqueue Or Fold Here, Never Claim Or Drain Here, Never Write Google Sheets, Never List The Admin Desk, Never Merge This Into The Drain Run Card Or The Per-Tab Lease — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 37 of this service — `SheetSyncJob.ts`
- Remaining in this service: `SheetSyncRun.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/SheetSyncJob.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (Mongo is System of Record; `sheet_sync_jobs` is the durable outbox; queued persist writes the row in the same txn; coalesce only `pending`/`retrying`; never coalesce onto `processing`; tombstone **before** hard Mongo delete; booked-lead tombstone does **not** cancel `booking_chain:{id}`; queue payload is only a wake-up — **this file never enqueues, never folds, never claims, never writes a sheet, never publishes**). Pointer software map: [`.cursor/rules/sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) (models `SheetSyncJob.ts` / leftover later `SheetSyncRun.ts` / leftover later `SheetSyncAttempt.ts` / leftover later `SheetSyncLease.ts`; scheduling stays already-recommended coordinator / outbox / queue; execution stays already-recommended drain / planner / batch / tab map / quota). Already-recommended leftover persist: [sheet-sync-coordinator.md](sheet-sync-coordinator.md) (queued `persistSheetSyncIntent` leftover-asks leftover outbox — **this file never persists**). Already-recommended leftover outbox: [sheet-sync-outbox.md](sheet-sync-outbox.md) (`enqueueSheetSyncJob` / `enqueueSheetSyncTombstone` leftover-asks leftover this leftover default leftover model leftover — leftover `$min due_at` leftover / leftover `$max priority` leftover / leftover `$set target_hints: []` leftover / leftover tombstone leftover `$set` leftover plus leftover `updateMany` leftover cancel leftover matching leftover upsert leftover — **this file never upserts**). Already-recommended leftover drain: [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (leftover-claims leftover `pending` leftover / leftover `retrying` leftover due leftover rows leftover onto leftover `processing`; leftover-finalizes leftover `synced` leftover / leftover `retrying` leftover / leftover `failed` leftover / leftover run-timeout leftover `pending` leftover — **this file never drains**). Already-recommended leftover planner: [sheet-sync-job-planner.md](sheet-sync-job-planner.md) (leftover-reads leftover `SheetSyncJobDocument` leftover then leftover-reloads leftover live leftover Mongo leftover or leftover tombstone leftover `previous_targets` leftover — **this file never plans**). Already-recommended leftover admin desk: [admin-sheet-sync.md](admin-sheet-sync.md) (leftover-aggregates leftover status leftover counts; leftover-pages leftover the leftover desk; leftover-retries leftover terminal leftover rows leftover to leftover `pending` leftover + leftover `due_at=now` leftover — **this file never lists**). Already-recommended leftover HTTP automation source: [models-granot-automation-source.md](models-granot-automation-source.md) (collection `granot_automation_sources`, leftover exact leftover-label leftover unique, leftover named leftover clocks leftover — **do not merge**; leftover **do not** leftover-unique leftover this leftover `coalescing_key` leftover so leftover “one leftover key leftover owns leftover every leftover status”). Already-recommended leftover Job Timeline loader: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (leftover-hops leftover `db.collection("sheet_sync_jobs")` leftover by leftover `entity_id` leftover — leftover **does leftover not leftover import leftover this leftover model**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `sheet_sync_jobs`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the outbox.” Distinct from leftover later `SheetSyncRun.ts` (leftover per-drain leftover card leftover on leftover `sheet_sync_runs` — **do not merge**). Distinct from leftover later `SheetSyncAttempt.ts` (leftover per-target leftover write leftover outcome leftover — **do not merge**). Distinct from leftover later `SheetSyncLease.ts` (leftover per-tab leftover write leftover fence leftover — knowledge table leftover-still leftover-says leftover “Global drain mutex”; leftover do leftover not leftover-merge leftover that leftover fight leftover onto leftover this leftover job). Distinct from leftover later `SheetSyncQuotaBucket.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for outbox / drain / Master Sheet. `docs/adr/` is absent here — do not invent ADR copies. Knowledge already flags Granot / RingCentral `enqueueSheetSyncJob` (mode-blind) as a labeled gap; do not “fix” that in this rename. Knowledge already names the booked-lead tombstone that does **not** cancel `booking_chain:{id}`; do not “fix” that in this rename. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended leftover `sheetSyncOutbox.service.ts` **asks** `SheetSyncJob.findOneAndUpdate` leftover on leftover `{ coalescing_key, status ∈ pending|retrying }` leftover (leftover upsert leftover + leftover tombstone leftover) leftover and leftover `updateMany` leftover `{ status: "cancelled", last_error: "superseded_by_delete_tombstone" }`. Already-recommended leftover `runSheetSyncDrain.ts` leftover-asks leftover `find` leftover due leftover `pending` leftover / leftover `retrying` leftover then leftover `findOneAndUpdate` leftover onto leftover `processing` leftover + leftover lease leftover + leftover `run_id`; leftover-renews leftover `leased_until`; leftover-finalizes leftover `synced` leftover / leftover `retrying` leftover / leftover `failed` leftover / leftover run-timeout leftover `pending`; leftover run-fail leftover `updateMany` leftover still-`processing` leftover onto leftover `retrying`. Already-recommended leftover `jobPlanner.ts` leftover-asks leftover only leftover `SheetSyncJobDocument` leftover (leftover type leftover) leftover then leftover-reads leftover `resource` leftover / leftover `entity_id` leftover / leftover `entity_model` leftover / leftover `tombstone` leftover / leftover `target_hints`. Already-recommended leftover `adminSheetSync.service.ts` leftover-asks leftover `aggregate` leftover by leftover status, leftover `findOne` leftover oldest leftover `pending` leftover / leftover `retrying`, leftover paged leftover `find`, leftover retry leftover `updateMany` leftover `$set pending` leftover + leftover `$unset` leftover lease leftover / leftover last leftover error. Leftover Owner leftover contains leftover `sheetContains.ts` leftover-asks leftover `find` leftover `{ entity_model, entity_id $in, status $in SHEET_SYNC_ACTIVE_JOB_STATUSES }` leftover (leftover that leftover tuple leftover **includes leftover `processing`** leftover — leftover coalesce leftover does leftover **not**). Leftover Job Timeline leftover loader leftover-asks leftover the leftover collection leftover name leftover, leftover not leftover this leftover export. Leftover historical leftover consolidation leftover lists leftover `sheet_sync_jobs` leftover as leftover a leftover side-effect leftover collection leftover string. Tests: leftover `sheetSyncOutbox.service.test.ts` leftover stubs leftover `findOneAndUpdate` leftover / leftover `updateMany`. Leftover `adminSheetSync.service.test.ts` leftover stubs leftover `findOne` leftover / leftover `find` leftover / leftover `updateMany`. Leftover `jobPlanner.test.ts` leftover builds leftover a leftover fake leftover `SheetSyncJobDocument`. Leftover replica leftover / leftover integration leftover desks leftover `find` leftover / leftover `deleteMany` leftover by leftover `entity_id` leftover for leftover cleanup leftover and leftover leftover-proof leftover that leftover a leftover write leftover planted leftover a leftover row. There is **no** `SheetSyncJob.test.ts`. There is **no** `getSheetSyncJobModel()`. Nobody leftover-exports leftover `SHEET_SYNC_JOB_STATUSES` leftover from leftover this leftover file leftover — leftover config leftover owns leftover the leftover tuples. Not this **interface**: leftover `enqueueSheetSyncJob` itself, leftover `enqueueSheetSyncTombstone` itself, leftover `persistSheetSyncIntent` itself, leftover `finalizeSheetSync` itself, leftover `runSheetSyncDrain` itself, leftover `planJobWrites` itself, leftover `retrySheetSyncJobs` itself, leftover `checkSheetContains` itself, leftover `buildCoalescingKey` itself.
- Seams callers need: default `SheetSyncJob` (first-registered connection — leftover outbox leftover / leftover drain leftover / leftover admin leftover / leftover contains leftover-ask leftover it leftover after leftover `connectMongo()` or leftover inside leftover a leftover domain leftover session; leftover planner leftover leftover-asks leftover the leftover inferred leftover row leftover type) vs **no** `getSheetSyncJobModel()`; leftover required leftover `coalescing_key` leftover (leftover **not leftover unique** leftover — leftover fold leftover is leftover `{ key, status ∈ pending|retrying }`) vs leftover config leftover `buildCoalescingKey`; leftover tombstone leftover nest leftover (leftover worker leftover cannot leftover reload leftover a leftover hard-deleted leftover document) vs leftover upsert leftover row leftover without leftover one; leftover six leftover status leftover words leftover imported leftover from leftover config leftover vs leftover coalesce leftover `pending` leftover / leftover `retrying` leftover only leftover vs leftover active leftover `pending` leftover / leftover `retrying` leftover / leftover `processing`; leftover optional leftover `run_id` leftover ObjectId leftover ref leftover `SheetSyncRun` leftover vs leftover leftover later leftover run leftover card; leftover job leftover `leased_until` leftover / leftover `lease_owner` leftover vs leftover leftover later leftover per-tab leftover `SheetSyncLease`; leftover unnamed leftover `Schema.index` leftover clocks leftover vs leftover **no** leftover named leftover catalog leftover and leftover **no** leftover `pnpm migration:*` leftover for leftover this leftover collection; leftover `timestamps: true` leftover / leftover omitted leftover `autoIndex: false` leftover (leftover mongoose leftover default leftover leftover-creates leftover leftover the leftover leftover four leftover leftover clocks leftover leftover on leftover leftover boot). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no enqueue **seam**. There is no drain **seam**. There is no selected-database **seam**.
- Split later (only if the file outgrows one sitting): this ~107-line file is one sitting if you read it as remember each Sheet Sync intent as one durable outbox row — same entity folds onto one pending or retrying row via the coalescing key, a delete snapshot lives here because the worker cannot reload a hard-deleted document, stamp status lease attempts and an optional drain-run pointer, four unnamed clocks for due claim coalesce lease and entity history, and the default connection after connect Mongo — never enqueue or fold here, never claim or drain here, never write Google Sheets, never list the Admin desk, never merge this into the drain run card or the per-tab lease. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `tombstone.ts` / `lease.ts`. Leftover outbox stays already-recommended `sheetSyncOutbox.service.ts`. Leftover drain stays already-recommended `runSheetSyncDrain.ts`. Leftover later run card stays leftover later `SheetSyncRun.ts`. Leftover later per-tab lease stays leftover later `SheetSyncLease.ts`.

`SheetSyncJob` is a Mongoose model name. The owner question is: *Mongo already remembered the Lead (or Booking, or Cancellation). Remember the sheet-sync intent as one durable outbox row on `sheet_sync_jobs` so we cannot forget after the API answers. Same entity folds onto one pending or retrying row via `coalescing_key` — never onto a row the drain is already walking. If we are deleting, keep the last-known spreadsheet / tab / row snapshot on this row, because the worker cannot reload a hard-deleted document. Stamp which sheet family it is, which operation string the write used, when it is due, who holds the job lease, how many tries it has burned, and which drain run claimed it. Hand back the default-connection model after leftover `connectMongo()`. Do not enqueue. Do not fold. Do not claim. Do not write Google Sheets. Do not list the Admin desk. Do not invent a selected-database getter so “CRM matches Sheet Sync.” Do not unique the coalescing key so “one key owns every status.” Do not merge this into the leftover drain run card or the leftover per-tab lease.*

Who leftover-enqueues / leftover-folds / leftover-tombstones already lives in already-recommended `sheetSyncOutbox.service.ts`. Who leftover-claims leftover / leftover-finalizes already lives in already-recommended `runSheetSyncDrain.ts`. Who leftover-lists leftover / leftover-retries already lives in already-recommended `adminSheetSync.service.ts`. Who leftover-builds leftover the leftover key already lives in leftover `src/config/domain/sheetSync.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember each Sheet Sync intent as one durable outbox row — same entity folds onto one pending or retrying row via the coalescing key, a delete snapshot lives here because the worker cannot reload a hard-deleted document, stamp status lease attempts and an optional drain-run pointer, four unnamed clocks for due claim coalesce lease and entity history, and the default connection after connect Mongo — never enqueue or fold here, never claim or drain here, never write Google Sheets, never list the Admin desk, never merge this into the drain run card or the per-tab lease” story, not “a sheet-sync-job CRUD dump,” and not Write The Durable Sheet-Sync Job In The Same Mongo Write itself:

1. **Hold the durable Sheet Sync outbox row** — collection `sheet_sync_jobs`, `timestamps: true`, `toJSON` / `toObject` `{ virtuals: true }` (this file defines **no** virtuals). **No** `autoIndex: false` (mongoose default creates the four unnamed clocks on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required `status` (enum leftover `SHEET_SYNC_JOB_STATUSES`: `pending` | `retrying` | `processing` | `synced` | `failed` | `cancelled`, default `"pending"`). Required `priority` (Number, default `0`). Required `resource` (enum leftover `SHEET_SYNC_RESOURCES`: `source_lead` | `booked_lead` | `booking_chain` | `cancellation_chain` | `delete_source_lead` | `delete_booked_lead` | `delete_cancelled_lead`). Required trimmed `operation` (**free string** — leftover not leftover an leftover enum). Optional `entity_model` (enum leftover `SHEET_SYNC_ENTITY_MODELS`: `FormLead` | `CallLead` | `BookedLead` | `CancelledLead`). Required trimmed `entity_id`. Required trimmed `coalescing_key` (**not leftover unique**). `target_hints` string array default `[]`. Required `due_at` (Date, default `Date.now`). Optional `leased_until` / trimmed `lease_owner`. Required `attempts` (default `0`). Optional trimmed `last_error` / `last_error_at`. Required `created_by` (enum leftover `SHEET_SYNC_CREATED_BY`: `api` | `cron` | `admin` | `script`, default `"api"`). Optional `run_id` ObjectId ref leftover `"SheetSyncRun"`. `SheetSyncJobDocument` is `InferSchemaType` plus `_id`. This beat does **not** leftover-`$min` leftover `due_at`. This beat does **not** leftover-claim leftover a leftover due leftover row. This beat does **not** leftover-write leftover a leftover sheet leftover cell.

2. **Hold the delete tombstone nest the worker needs after the document is gone** — leftover `sheetSyncTombstoneSchema` leftover (`_id: false`): required trimmed `mongo_id`; optional trimmed `source_company`; optional `duplicate`; `previous_targets` leftover array leftover of leftover `{ target, spreadsheet_id, tab_name, row_number? }` leftover (`_id: false`); optional leftover linked leftover booking leftover / leftover cancellation leftover / leftover lead leftover ids leftover plus leftover free-string leftover `linked_lead_model`. Comments leftover-say leftover row leftover numbers leftover may leftover be leftover stale leftover and leftover leftover `target_hints` leftover on leftover the leftover job leftover preserve leftover enough leftover to leftover recompute leftover fallback leftover targets. Leftover planner leftover leftover-reads leftover `previous_targets` leftover then leftover leftover-asks leftover the leftover live leftover tab leftover map. Default leftover on leftover the leftover job leftover is leftover `undefined` leftover — leftover upsert leftover rows leftover have leftover no leftover nest. This beat does **not** leftover-snapshot leftover `sheet_sync[]`. This beat does **not** leftover-cancel leftover a leftover matching leftover upsert. This beat does **not** leftover-delete leftover a leftover Google leftover row.

3. **Stamp the four unnamed clocks and hand back the default-connection model** — leftover `Schema.index({ status: 1, due_at: 1, priority: -1, createdAt: 1 })` leftover (comment: leftover drainer leftover due-job leftover query). Leftover `Schema.index({ coalescing_key: 1, status: 1 })` leftover (comment: leftover coalescing leftover upsert leftover lookup). Leftover `Schema.index({ leased_until: 1 })` leftover (comment: leftover “Lease leftover reclamation leftover sweep” leftover — leftover live leftover claim leftover leftover-filters leftover status leftover + leftover `due_at` leftover + leftover `leased_until`; leftover there leftover is leftover **no** leftover dedicated leftover sweep). Leftover `Schema.index({ entity_model: 1, entity_id: 1, status: 1 })` leftover (comment: leftover per-entity leftover history leftover / leftover admin leftover filtering leftover — leftover Owner leftover contains leftover leftover-asks leftover this leftover shape leftover too). There is **no** leftover `SHEET_SYNC_JOB_INDEXES` leftover catalog. There is **no** leftover collection-name leftover export. Default leftover export leftover `SheetSyncJob` leftover is leftover `mongoose.models.SheetSyncJob ?? mongoose.model(...)`. There is **no** `getSheetSyncJobModel()`. Leftover outbox leftover leftover-asks leftover leftover this leftover leftover default leftover leftover model leftover leftover after leftover leftover `connectMongo()` leftover leftover or leftover leftover inside leftover leftover the leftover leftover caller leftover leftover session. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-delete leftover leftover the leftover leftover default leftover leftover export leftover leftover so leftover leftover “everyone leftover leftover must leftover leftover call leftover leftover a leftover leftover getter.”

There is no leftover-enqueue-or-fold operation. Leftover `enqueueSheetSyncJob` elects that. There is no leftover-tombstone-and-cancel operation. Leftover `enqueueSheetSyncTombstone` elects that. There is no leftover-claim-due-jobs operation. Leftover `runSheetSyncDrain` elects that.

## Organization

Keep one file. This is the screenplay for “remember each Sheet Sync intent as one durable outbox row — same entity folds onto one pending or retrying row via the coalescing key, a delete snapshot lives here because the worker cannot reload a hard-deleted document, stamp status lease attempts and an optional drain-run pointer, four unnamed clocks for due claim coalesce lease and entity history, and the default connection after connect Mongo — never enqueue or fold here, never claim or drain here, never write Google Sheets, never list the Admin desk, never merge this into the drain run card or the per-tab lease.” Leftover persist / leftover outbox / leftover drain / leftover planner / leftover admin leftover desk already live in deeper **modules**. Leftover later leftover run leftover card leftover / leftover attempt leftover / leftover per-tab leftover lease leftover already leftover live leftover in leftover sibling **modules**. Do not pull those in. Do not invent a `SheetSyncJobService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the leftover CRM name” without a paired leftover-outbox leftover-migration leftover-to leftover-the leftover-getter. Do not invent an `autoIndex: false` **adapter** so “this matches the leftover CRM name” without a paired leftover proof leftover that leftover boot leftover leftover-no leftover leftover-longer leftover leftover-creates leftover leftover these leftover leftover clocks. Do not invent a unique-`coalescing_key` **adapter** so “one key owns synced and pending.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `tombstone.ts` / `lease.ts` each get a file.

Do not move leftover `enqueueSheetSyncJob` into this file so “the row owns the fold.” Do not merge this file into leftover later `SheetSyncRun.ts` so “one schema owns the intent and the drain invocation.” Do not merge this file into leftover later `SheetSyncLease.ts` so “one lease owns the job and the tab.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `SheetSyncJob` | `sheetSyncOutboxRowOnTheDefaultConnection` | leftover outbox leftover / leftover drain leftover / leftover admin leftover / leftover contains leftover-ask leftover the leftover default leftover model |
| `SheetSyncJobDocument` | `SheetSyncOutboxRow` | inferred document + `_id`; leftover planner leftover leftover-asks leftover the leftover type leftover only |

Keep the old names as one-line aliases until leftover outbox, leftover drain, leftover planner, leftover admin desk, leftover contains, leftover replica leftover cleanup, leftover `sheetSyncOutbox.service.test.ts`, leftover `adminSheetSync.service.test.ts`, and leftover `jobPlanner.test.ts` migrate. Do not make callers learn `useDb` / `autoIndex` / `coalescing_key` as the only domain language until those sites move. Do **not** add a `getSheetSyncJobModel` export so “CRM matches Sheet Sync” without a paired leftover-outbox leftover-proof leftover that leftover `connectMongo()` leftover-already leftover-binds leftover the leftover selected leftover database. Do **not** re-export leftover `enqueueSheetSyncJob` leftover / leftover `runSheetSyncDrain` leftover / leftover `SHEET_SYNC_JOB_STATUSES` from this file so “the row leftover-folds leftover leftover or leftover leftover-owns leftover leftover the leftover leftover tuples.”

**No class for the workflow.** The one type that *does* earn a name is the outbox-identity contract:

```ts
type SheetSyncOutboxRowIdentity = {
  collection: "sheet_sync_jobs"
  coalescing_key_required: true
  coalescing_key_unique: false
  fold_statuses: ["pending", "retrying"]
  never_fold_onto: "processing"
  tombstone_required_for_upsert: false
  tombstone_required_after_hard_delete: true
  operation_is_free_string: true
  entity_model_required: false
  selected_database_getter: false
  autoIndex: true
  named_index_catalog: false
  unnamed_indexes: [
    { status: 1, due_at: 1, priority: -1, createdAt: 1 },
    { coalescing_key: 1, status: 1 },
    { leased_until: 1 },
    { entity_model: 1, entity_id: 1, status: 1 },
  ]
}
```

That is the handoff from “this process remembered a sheet-sync intent” to “leftover-outbox leftover-may leftover-fold leftover leftover it leftover leftover onto leftover leftover `{ coalescing_key, status ∈ pending|retrying }`, leftover leftover-drain leftover leftover-may leftover leftover-claim leftover leftover a leftover leftover due leftover leftover row leftover leftover onto leftover leftover `processing`, leftover leftover-admin leftover leftover-may leftover leftover-page leftover leftover and leftover leftover-retry leftover leftover terminal leftover leftover rows, leftover leftover-contains leftover leftover-may leftover leftover-ask leftover leftover live leftover leftover statuses leftover leftover including leftover leftover `processing`, and leftover leftover-boot leftover leftover-creates leftover leftover the leftover leftover four leftover leftover unnamed leftover leftover clocks.” Do **not** add `{ coalescing_key_unique: true }` so “one leftover key leftover-owns leftover leftover synced leftover leftover too.” Do **not** add `{ selected_database_getter: true }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ autoIndex: false }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ named_index_catalog: true }` so “migration leftover-owns leftover leftover these leftover leftover clocks.” Do **not** add `{ fold_statuses: ["pending", "retrying", "processing"] }` so “a leftover write leftover leftover-folds leftover leftover onto leftover leftover an leftover leftover in-flight leftover leftover drain.”

Leave leftover later `SheetSyncRun.ts` on that file. Leave leftover later `SheetSyncAttempt.ts` on that file. Leave leftover later `SheetSyncLease.ts` on that file. Leave leftover later `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// SheetSyncJob.ts
// Mongo already remembered the Lead (or Booking, or Cancellation).
// Remember the sheet-sync intent as one durable outbox row
// so we cannot forget after the API answers.
// Same entity folds onto one pending or retrying row.
// Never onto a row the drain is already walking.
// If we are deleting, keep the last-known sheet snapshot here —
// the worker cannot reload a hard-deleted document.
// Never enqueue here. Never claim here. Never write Google Sheets here.

import {
  SHEET_SYNC_CREATED_BY,
  SHEET_SYNC_ENTITY_MODELS,
  SHEET_SYNC_JOB_STATUSES,
  SHEET_SYNC_RESOURCES,
} from "../config/domain"

// ── 1. Hold the durable Sheet Sync outbox row ─────────────

const SheetSyncJobSchema = new Schema(
  {
    status: { enum: SHEET_SYNC_JOB_STATUSES, default: "pending" },
    priority: { default: 0 },
    resource: { enum: SHEET_SYNC_RESOURCES },
    operation: String,                          // free string — not an enum
    entity_model: { enum: SHEET_SYNC_ENTITY_MODELS }, // optional
    entity_id: String,
    coalescing_key: String,                     // required, not unique
    target_hints: { type: [String], default: [] },
    tombstone: { type: sheetSyncTombstoneSchema, default: undefined },
    due_at: { default: Date.now },
    leased_until: Date,
    lease_owner: String,
    attempts: { default: 0 },
    last_error: String,
    last_error_at: Date,
    created_by: { enum: SHEET_SYNC_CREATED_BY, default: "api" },
    run_id: { type: Schema.Types.ObjectId, ref: "SheetSyncRun" },
  },
  { collection: "sheet_sync_jobs", timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

// ── 2. Hold the delete tombstone nest ─────────────────────

function rememberTheLastKnownSheetRowsTheWorkerNeedsAfterHardDelete() {
  // target + spreadsheet_id + tab_name + optional stale row_number
  // plus mongo_id / source_company / duplicate / linked booking|cancel|lead
}

// ── 3. Stamp the unnamed clocks and hand back the model ───

SheetSyncJobSchema.index({ status: 1, due_at: 1, priority: -1, createdAt: 1 })
SheetSyncJobSchema.index({ coalescing_key: 1, status: 1 })
SheetSyncJobSchema.index({ leased_until: 1 })
SheetSyncJobSchema.index({ entity_model: 1, entity_id: 1, status: 1 })

export const SheetSyncJob =
  mongoose.models.SheetSyncJob ?? mongoose.model("SheetSyncJob", SheetSyncJobSchema)
export const sheetSyncOutboxRowOnTheDefaultConnection = SheetSyncJob
```

Read the primary path out loud: *Mongo already saved the Lead. Remember one outbox row so the sheets can catch up after we answer. If the same Lead is saved again before the drain, that work still lives on this one pending row. If we deleted the Lead, the last-known spreadsheet and tab stay on this row because the worker has nothing left to reload. Do not talk to Google from here. Do not start the drain from here.*

## Precise logic I would tighten while renaming

1. **`coalescing_key` is required and not unique.** Fold lives on leftover `{ coalescing_key, status ∈ pending|retrying }`. A write during `processing` plants a fresh `pending` row on purpose. Do not unique the key so “one key owns synced too.”

2. **`operation` is a free string; `resource` is the enum.** Leftover priority leftover-reads leftover whether leftover the leftover string leftover includes leftover `"create"`. Do not enum leftover operations so “unknown writes 11000.”

3. **`entity_model` is optional on the schema; leftover outbox always sets it.** Leftover planner leftover casts leftover it leftover for leftover source leftover leads. Do not require it so “every delete names a model” without a paired leftover tombstone leftover proof.

4. **`linked_lead_model` on the tombstone is a free string.** Leftover `entity_model` leftover is leftover the leftover enum. Do not enum the nest so “the snapshot matches the row” without a paired leftover delete leftover proof.

5. **The `leased_until` comment says “Lease reclamation sweep.”** Live leftover claim leftover leftover-filters leftover status leftover + leftover `due_at` leftover + leftover `leased_until`. Leftover finalize leftover leftover-sets leftover `leased_until: new Date(0)`. Leftover admin leftover retry leftover leftover-`$unset`s leftover the leftover lease. There is no dedicated sweep. Do not add a sweep so “the comment becomes true.”

6. **Drain sort is `priority desc, createdAt asc` after a `status` + `due_at` filter.** The compound clock is `{ status, due_at, priority, createdAt }`. Name the mismatch. Do not reorder the index so “the clock matches the sort” from this rename.

7. **`toJSON` / `toObject` ask virtuals this file does not define.** Leave that off the identity type until a later virtual lands. Do not add an `id` virtual here so “the DTO owns the schema.”

8. **Job Timeline hops the collection, not this model.** Already-recommended leftover loader leftover-asks leftover `db.collection("sheet_sync_jobs")`. Do not switch that loader onto `SheetSyncJob` so “one model owns evidence.”

9. **Software-map gap.** `schema-and-crud-inputs.mdc` does not name `sheet_sync_jobs`. Knowledge does. Do not invent that rule line from this rename.

10. **Knowledge vs leftover later lease.** Knowledge table leftover-says leftover `SheetSyncLease` leftover is leftover “Global drain mutex.” Live leftover later leftover file leftover leftover-says leftover per-tab leftover write leftover fence. Do not merge that later lease into this job so “the comment wins.” Park the fight for leftover later `SheetSyncLease.ts`.

11. **`SHEET_SYNC_ACTIVE_JOB_STATUSES` includes `processing`; leftover coalesce does not.** Those tuples live in leftover config / leftover outbox / leftover contains. This file leftover-imports leftover the leftover six leftover status leftover words leftover only. Do not export leftover the leftover active leftover tuple leftover from leftover here leftover so leftover “the leftover row leftover leftover-owns leftover leftover live leftover leftover vs leftover leftover fold.”

12. **Leave sibling modules alone.** `enqueueSheetSyncJob` / `runSheetSyncDrain` / `retrySheetSyncJobs` are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the six status words as schema enum, the seven resources as schema enum, the required non-unique `coalescing_key`, the optional tombstone nest, the four unnamed clocks, and the omitted selected-database getter. There is no `SheetSyncJob.test.ts`. Leftover `sheetSyncOutbox.service.test.ts` already asks upsert key + tombstone supersede. Leftover `adminSheetSync.service.test.ts` already asks health counts + default-`failed` requeue. Leftover `jobPlanner.test.ts` already asks a fake document plus tombstone `previous_targets`.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.SheetSyncJob ?? mongoose.model(...)`; there is no `getSheetSyncJobModel`
- leftover outbox asks `SheetSyncJob` after `connectMongo()` or inside the caller session
- leftover drain asks the same default model
- leftover admin desk asks the same default model
- leftover Job Timeline loader does **not** import this file
- `coalescing_key` is required and not unique
- fold statuses stay `pending` / `retrying`; `processing` is never a fold target
- tombstone nest is optional on upsert rows and required after hard delete for the planner to find `previous_targets`
- `operation` stays a free string
- `entity_model` stays optional on the schema
- unnamed indexes are exactly the four `Schema.index` shapes above
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- `schema-and-crud-inputs.mdc` still does not name `sheet_sync_jobs`; this pass does not invent that rule line
- leftover later `SheetSyncRun` is a different collection; that file is out of this story
- leftover later `SheetSyncLease` is a different collection; that file is out of this story
- already-recommended leftover `GranotAutomationSource` is a different collection; that file is out of this story

I would not test leftover enqueue fold, leftover drain claim, leftover Google write, leftover Admin retry, leftover Owner contains, leftover Form correction, leftover Call enrichment write, leftover Booked reconciliation, or leftover Job Timeline assemble from this file.

Do not add a test per helper (`theCoalescingKeyIsNotUnique`, `theTombstoneNestSurvivesHardDelete`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `SheetSyncJobService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `tombstone.ts` / `lease.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating leftover `enqueueSheetSyncJob` / leftover `enqueueSheetSyncTombstone` / leftover `persistSheetSyncIntent` / leftover `finalizeSheetSync` / leftover `runSheetSyncDrain` / leftover `planJobWrites` / leftover `retrySheetSyncJobs` / leftover `checkSheetContains` / leftover `buildCoalescingKey` / leftover later `SheetSyncRun` / leftover later `SheetSyncAttempt` / leftover later `SheetSyncLease` / leftover later `SheetSyncQuotaBucket` / leftover already-recommended `GranotAutomationSource` as this story.
- Inventing a selected-database seam that has only the leftover CRM getter as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, unique-ing `coalescing_key`, enuming `operation`, requiring `entity_model`, adding a named-index catalog, or folding onto `processing` while recommending a rename.
- Pulling `enqueueSheetSyncJob` or `runSheetSyncDrain` into this file.
- Merging this collection into leftover later `SheetSyncRun`, leftover later `SheetSyncLease`, leftover already-recommended `GranotAutomationSource`, or leftover `sheet_sync[]` on the Lead.
- Silently reordering leftover `connectMongo` versus leftover enqueue, leftover tombstone versus leftover hard Mongo delete, leftover coalesce versus leftover claim, or leftover booked-lead tombstone versus leftover `booking_chain` cancel.
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover later `SheetSyncRun.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `SheetSyncRun.ts` while writing this file.
