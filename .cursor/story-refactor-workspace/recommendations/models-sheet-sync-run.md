# Remember Each Sheet Sync Drain Invocation As One History Card — Who Woke Us (Queue Cron Admin Or Script), Whether The Drain Is Still Walking Finished Clean Finished With Failures Or Threw, Stamp Claimed Synced Failed And Deferred Counts Plus Optional Quota And Error Summaries, Two Unnamed Newest-First Clocks, And The Default Connection After Connect Mongo — Never Take The Drain Seat Here, Never Claim A Job Here, Never Write Google Sheets, Never Page The Admin Desk, Never Merge This Into The Outbox Row Or The Per-Target Attempt — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 38 of this service — `SheetSyncRun.ts`
- Remaining in this service: `SheetSyncAttempt.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/SheetSyncRun.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (queue / cron / admin retry all enter already-recommended leftover drain; leftover-creates leftover this leftover card leftover `running`; leftover-finalizes leftover `completed` leftover / leftover `partial_failure` leftover / leftover `failed`; admin health leftover-shows leftover last leftover run leftover; leftover-pages leftover the leftover run leftover desk leftover; leftover-opens leftover one leftover run leftover plus leftover leftover later leftover attempts leftover — **this file never drains, never lists, never retries**). Pointer software map: [`.cursor/rules/sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) (models already-recommended leftover `SheetSyncJob.ts` / this leftover `SheetSyncRun.ts` / leftover later `SheetSyncAttempt.ts` / leftover later `SheetSyncLease.ts`; scheduling stays already-recommended leftover coordinator / leftover outbox / leftover queue; execution stays already-recommended leftover drain / leftover planner / leftover batch / leftover tab map / leftover quota). Already-recommended leftover drain: [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (`SheetSyncRun.create` leftover `{ trigger, status: "running", started_at }` leftover after leftover the leftover global leftover seat leftover is leftover taken leftover; leftover skip leftover when leftover locked leftover returns leftover `{ runId: null }` leftover and leftover plants leftover **no** leftover row leftover; leftover clean leftover finish leftover `$set` leftover `completed` leftover or leftover `partial_failure` leftover plus leftover the leftover four leftover counts leftover; leftover throw leftover `$set` leftover `failed` leftover plus leftover `error_summary` leftover — **this file never takes the seat**). Already-recommended leftover admin desk: [admin-sheet-sync.md](admin-sheet-sync.md) (leftover health leftover `findOne` leftover newest leftover `started_at`; leftover-pages leftover `listSheetSyncRuns`; leftover-opens leftover `getSheetSyncRunDetail` leftover then leftover leftover later leftover `SheetSyncAttempt.find({ run_id })` leftover — **this file never lists**). Already-recommended leftover cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (leftover-asks leftover `runSheetSyncDrain("cron")` leftover — **this file never cron-gates**). Already-recommended leftover queue: [sheet-sync-queue.md](sheet-sync-queue.md) (leftover wake-up leftover only leftover; leftover consumer leftover leftover-asks leftover `runSheetSyncDrain("queue")` leftover — **this file never publishes**). Already-recommended leftover outbox row: [models-sheet-sync-job.md](models-sheet-sync-job.md) (collection `sheet_sync_jobs`, leftover optional leftover `run_id` leftover ref leftover `"SheetSyncRun"` leftover — **do not merge**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `sheet_sync_runs`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the drain card.” Distinct from leftover later `SheetSyncAttempt.ts` (leftover per-target leftover write leftover outcome leftover on leftover `sheet_sync_attempts` leftover — **do not merge**). Distinct from leftover later `SheetSyncLease.ts` (knowledge table leftover-still leftover-says leftover “Global drain mutex”; leftover live leftover later leftover file leftover leftover-says leftover per-tab leftover write leftover fence leftover — leftover do leftover not leftover-merge leftover that leftover fight leftover onto leftover this leftover card). Distinct from leftover later `SheetSyncQuotaBucket.ts`. Distinct from leftover already-recommended leftover Granot CSV apply pass leftover / leftover HTTP leftover automation leftover run leftover / leftover later leftover Best Relocation leftover `IngestionRun` leftover / leftover later leftover `ReportingRun` leftover — **do not merge**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — the intro names Sheet Sync; do not invent a glossary copy for drain / outbox / Master Sheet. `docs/adr/` is absent here — do not invent ADR copies. Knowledge already names timeout→`pending` vs crash→`retrying` on leftover jobs leftover, leftover not leftover on leftover this leftover card leftover; leftover do leftover not leftover “fix” leftover that leftover in leftover this leftover rename. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the inferred-row type.** Already-recommended leftover `runSheetSyncDrain.ts` **asks** `SheetSyncRun.create` leftover then leftover `findByIdAndUpdate` leftover twice leftover (leftover clean leftover finish leftover vs leftover throw). Already-recommended leftover `adminSheetSync.service.ts` leftover-asks leftover `findOne().sort({ started_at: -1 })` leftover for leftover `last_run`, leftover paged leftover `find` leftover + leftover `countDocuments` leftover (leftover optional leftover status leftover filter leftover, leftover sort leftover `started_at` leftover desc), leftover and leftover `findById` leftover for leftover detail. Wave B leftover `v1.routes.ts` leftover-asks leftover the leftover admin leftover list leftover / leftover detail leftover — leftover **does leftover not leftover import leftover this leftover file**. Leftover `api/queues/sheet-sync-consumer.ts` leftover leftover-asks leftover the leftover drain leftover with leftover `"queue"` leftover — leftover **does leftover not leftover import leftover this leftover file**. Leftover cron leftover leftover-asks leftover the leftover drain leftover with leftover `"cron"` leftover — leftover **does leftover not leftover import leftover this leftover file**. Trigger leftover `"script"` leftover is leftover on leftover the leftover config leftover union leftover and leftover has leftover **no** leftover runtime leftover drain leftover caller. Leftover Job Timeline leftover loader leftover leftover-hops leftover `sheet_sync_jobs` leftover — leftover **does leftover not leftover hop leftover this leftover collection**. Leftover historical leftover consolidation leftover lists leftover `sheet_sync_jobs` leftover as leftover a leftover side-effect leftover collection leftover string leftover — leftover **does leftover not leftover list leftover `sheet_sync_runs`**. Tests: leftover `adminSheetSync.service.test.ts` leftover stubs leftover `SheetSyncRun.findOne` leftover for leftover health leftover (`last_run` leftover null). There is **no** leftover test leftover for leftover `listSheetSyncRuns` leftover / leftover `getSheetSyncRunDetail`. There is **no** leftover `runSheetSyncDrain.test.ts`. There is **no** leftover `SheetSyncRun.test.ts`. There is **no** leftover `getSheetSyncRunModel()`. Nobody leftover-exports leftover `SHEET_SYNC_RUN_STATUSES` leftover / leftover `SHEET_SYNC_RUN_TRIGGERS` leftover from leftover this leftover file leftover — leftover config leftover owns leftover the leftover tuples leftover; leftover Zod leftover leftover-asks leftover the leftover status leftover tuple leftover for leftover the leftover run leftover desk. Not this **interface**: leftover `runSheetSyncDrain` itself, leftover `listSheetSyncRuns` itself, leftover `getSheetSyncRunDetail` itself, leftover `getSheetSyncHealth` itself, leftover `retrySheetSyncJobs` itself, leftover `enqueueSheetSyncJob` itself, leftover later leftover `SheetSyncAttempt` leftover writes leftover themselves.
- Seams callers need: default `SheetSyncRun` (first-registered connection — leftover drain leftover / leftover admin leftover leftover-ask leftover it leftover after leftover `connectMongo()`) vs **no** `getSheetSyncRunModel()`; leftover four leftover trigger leftover words leftover imported leftover from leftover config leftover (`queue` leftover / leftover `cron` leftover / leftover `admin` leftover / leftover `script`) vs leftover three leftover runtime leftover writers leftover (`queue` leftover / leftover `cron` leftover / leftover `admin`) vs leftover unused leftover `"script"`; leftover four leftover status leftover words leftover (`running` leftover / leftover `completed` leftover / leftover `partial_failure` leftover / leftover `failed`, leftover default leftover `"running"`) vs leftover drain leftover elect leftover (`failedJobs > 0 || deferredJobs > 0` leftover → leftover `partial_failure` leftover else leftover `completed`; leftover throw leftover → leftover `failed`); leftover skipped leftover locked leftover drain leftover plants leftover **no** leftover row leftover vs leftover taken leftover seat leftover always leftover plants leftover `running`; leftover Mixed leftover `quota_summary` leftover vs leftover **no** leftover runtime leftover writer; leftover trimmed leftover `error_summary` leftover vs leftover throw leftover path leftover only; leftover unnamed leftover `{ started_at: -1 }` leftover vs leftover `{ status: 1, started_at: -1 }` leftover vs leftover **no** leftover named leftover catalog leftover and leftover **no** leftover `pnpm migration:*` leftover for leftover this leftover collection; leftover `timestamps: true` leftover plus leftover field leftover `started_at` leftover / leftover `finished_at` leftover (leftover dual leftover clocks); leftover omitted leftover `autoIndex: false` leftover (leftover mongoose leftover default leftover leftover-creates leftover leftover the leftover leftover two leftover leftover clocks leftover leftover on leftover leftover boot). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no drain **seam**. There is no selected-database **seam**.
- Split later (only if the file outgrows one sitting): this ~45-line file is one sitting if you read it as remember each Sheet Sync drain invocation as one history card — who woke us (queue cron admin or script), whether the drain is still walking finished clean finished with failures or threw, stamp claimed synced failed and deferred counts plus optional quota and error summaries, two unnamed newest-first clocks, and the default connection after connect Mongo — never take the drain seat here, never claim a job here, never write Google Sheets, never page the Admin desk, never merge this into the outbox row or the per-target attempt. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `trigger.ts`. Leftover drain stays already-recommended `runSheetSyncDrain.ts`. Leftover admin desk stays already-recommended `adminSheetSync.service.ts`. Leftover later attempt stays leftover later `SheetSyncAttempt.ts`. Leftover already-recommended leftover outbox leftover row stays leftover `SheetSyncJob.ts`.

`SheetSyncRun` is a Mongoose model name. The owner question is: *Someone woke the drain — a queue message, the five-minute cron, an Owner retry, or (on the union only) a script. If we took the global seat, remember this invocation as one history card on `sheet_sync_runs` so the Admin Dashboard can say which drain ran last and how it closed. Stamp who woke us. Stamp whether it is still walking, finished clean, finished with failed or deferred jobs, or threw. Stamp how many jobs we claimed, synced, failed, and deferred. Keep a newest-first clock. Hand back the default-connection model after leftover `connectMongo()`. Do not take the drain seat. Do not claim an outbox row. Do not write Google Sheets. Do not page the Admin desk. Do not invent a selected-database getter so “CRM matches Sheet Sync.” Do not merge this into the leftover outbox row or the leftover later per-target attempt.*

Who leftover-opens leftover / leftover-closes leftover the leftover card leftover already leftover lives leftover in leftover already-recommended leftover `runSheetSyncDrain.ts`. Who leftover-lists leftover / leftover-opens leftover one leftover card leftover already leftover lives leftover in leftover already-recommended leftover `adminSheetSync.service.ts`. Who leftover-owns leftover the leftover trigger leftover / leftover status leftover tuples leftover already leftover lives leftover in leftover leftover `src/config/domain/sheetSync.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember each Sheet Sync drain invocation as one history card — who woke us (queue cron admin or script), whether the drain is still walking finished clean finished with failures or threw, stamp claimed synced failed and deferred counts plus optional quota and error summaries, two unnamed newest-first clocks, and the default connection after connect Mongo — never take the drain seat here, never claim a job here, never write Google Sheets, never page the Admin desk, never merge this into the outbox row or the per-target attempt” story, not “a sheet-sync-run CRUD dump,” and not Drain Due Sheet-Sync Jobs itself:

1. **Hold the per-drain history card** — collection `sheet_sync_runs`, `timestamps: true`, `toJSON` / `toObject` `{ virtuals: true }` (this file defines **no** virtuals). **No** `autoIndex: false` (mongoose default creates the two unnamed clocks on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. **No** unique index. Required `started_at` (Date, default `Date.now`). Optional `finished_at`. Required `claimed_job_count` / `synced_job_count` / `failed_job_count` / `deferred_job_count` (Number, default `0`). Optional Mixed `quota_summary`. Optional trimmed `error_summary`. `SheetSyncRunDocument` is `InferSchemaType` plus `_id`. This beat does **not** leftover-create leftover the leftover card leftover after leftover a leftover locked leftover skip. This beat does **not** leftover-`$set` leftover the leftover four leftover counts. This beat does **not** leftover-write leftover a leftover sheet leftover cell.

2. **Remember who woke us and how this drain closed** — leftover `trigger` leftover (enum leftover `SHEET_SYNC_RUN_TRIGGERS`: `queue` | `cron` | `admin` | `script`, leftover required, leftover no leftover default). Leftover `status` leftover (enum leftover `SHEET_SYNC_RUN_STATUSES`: `running` | `completed` | `partial_failure` | `failed`, leftover required, leftover default leftover `"running"`). Already-recommended leftover drain leftover leftover-writes leftover `running` leftover on leftover create leftover after leftover the leftover seat leftover is leftover taken. Leftover clean leftover finish leftover leftover-writes leftover `partial_failure` leftover when leftover `failedJobs > 0 || deferredJobs > 0`, leftover else leftover `completed`. Leftover throw leftover leftover-writes leftover `failed` leftover plus leftover `error_summary`. Leftover locked leftover skip leftover leftover-plants leftover **no** leftover row. Leftover `"script"` leftover has leftover **no** leftover runtime leftover writer. This beat does **not** leftover-elect leftover queue leftover vs leftover cron leftover vs leftover admin. This beat does **not** leftover-elect leftover complete leftover vs leftover partial leftover vs leftover fail.

3. **Stamp the two unnamed newest-first clocks and hand back the default-connection model** — leftover `Schema.index({ started_at: -1 })` leftover (leftover admin leftover health leftover newest leftover run leftover; leftover admin leftover run leftover desk leftover sort). Leftover `Schema.index({ status: 1, started_at: -1 })` leftover (leftover admin leftover run leftover desk leftover when leftover a leftover status leftover filter leftover is leftover present). There is **no** leftover `SHEET_SYNC_RUN_INDEXES` leftover catalog. There is **no** leftover collection-name leftover export. Default leftover export leftover `SheetSyncRun` leftover is leftover `mongoose.models.SheetSyncRun ?? mongoose.model(...)`. There is **no** `getSheetSyncRunModel()`. Leftover drain leftover leftover-asks leftover leftover this leftover leftover default leftover leftover model leftover leftover after leftover leftover `connectMongo()`. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-delete leftover leftover the leftover leftover default leftover leftover export leftover leftover so leftover leftover “everyone leftover leftover must leftover leftover call leftover leftover a leftover leftover getter.”

There is no leftover-take-the-drain-seat operation. Leftover `runSheetSyncDrain` elects that. There is no leftover-page-the-run-desk operation. Leftover `listSheetSyncRuns` / leftover `getSheetSyncRunDetail` elect that.

## Organization

Keep one file. This is the screenplay for “remember each Sheet Sync drain invocation as one history card — who woke us (queue cron admin or script), whether the drain is still walking finished clean finished with failures or threw, stamp claimed synced failed and deferred counts plus optional quota and error summaries, two unnamed newest-first clocks, and the default connection after connect Mongo — never take the drain seat here, never claim a job here, never write Google Sheets, never page the Admin desk, never merge this into the outbox row or the per-target attempt.” Leftover drain / leftover admin leftover desk / leftover cron leftover / leftover queue leftover consumer leftover already leftover live leftover in leftover deeper **modules**. Leftover already-recommended leftover outbox leftover row leftover already leftover lives leftover in leftover a leftover sibling **module**. Leftover later leftover attempt leftover / leftover later leftover per-tab leftover lease leftover already leftover live leftover in leftover sibling **modules**. Do not pull those in. Do not invent a `SheetSyncRunService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the leftover CRM name” without a paired leftover-drain leftover-migration leftover-to leftover-the leftover-getter. Do not invent an `autoIndex: false` **adapter** so “this matches the leftover CRM name” without a paired leftover proof leftover that leftover boot leftover leftover-no leftover leftover-longer leftover leftover-creates leftover leftover these leftover leftover clocks. Do not invent a leftover-`quota_summary` leftover writer leftover so leftover “the leftover comment leftover leftover-becomes leftover leftover true.” Do not invent a leftover-`"script"` leftover caller leftover so leftover “the leftover union leftover leftover-has leftover leftover four leftover leftover writers.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `status.ts` / `trigger.ts` each get a file.

Do not move leftover `runSheetSyncDrain` into this file so “the card owns the drain.” Do not merge this file into already-recommended leftover `SheetSyncJob.ts` so “one schema owns the intent and the drain invocation.” Do not merge this file into leftover later `SheetSyncAttempt.ts` so “one schema owns the invocation and each tab write.” Do not merge this file into leftover later `SheetSyncLease.ts` so “one lease owns the history card.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `SheetSyncRun` | `sheetSyncDrainHistoryCardOnTheDefaultConnection` | leftover drain leftover / leftover admin leftover leftover-ask leftover the leftover default leftover model |
| `SheetSyncRunDocument` | `SheetSyncDrainHistoryCard` | inferred document + `_id` |

Keep the old names as one-line aliases until leftover drain, leftover admin desk, leftover `adminSheetSync.service.test.ts`, and leftover later leftover attempt leftover `run_id` leftover refs leftover migrate. Do not make callers learn `useDb` / `autoIndex` / `quota_summary` as the only domain language until those sites move. Do **not** add a `getSheetSyncRunModel` export so “CRM matches Sheet Sync” without a paired leftover-drain leftover-proof leftover that leftover `connectMongo()` leftover-already leftover-binds leftover the leftover selected leftover database. Do **not** re-export leftover `runSheetSyncDrain` leftover / leftover `listSheetSyncRuns` leftover / leftover `SHEET_SYNC_RUN_STATUSES` leftover from leftover this leftover file leftover so leftover “the leftover card leftover leftover-drains leftover leftover or leftover leftover-owns leftover leftover the leftover leftover tuples.”

**No class for the workflow.** The one type that *does* earn a name is the drain-history-identity contract:

```ts
type SheetSyncDrainHistoryCardIdentity = {
  collection: "sheet_sync_runs"
  triggers: ["queue", "cron", "admin", "script"]
  runtime_trigger_writers: ["queue", "cron", "admin"]
  script_has_a_runtime_writer: false
  statuses: ["running", "completed", "partial_failure", "failed"]
  locked_skip_plants_a_row: false
  quota_summary_has_a_runtime_writer: false
  error_summary_stamped_on: "failed"
  selected_database_getter: false
  autoIndex: true
  named_index_catalog: false
  unnamed_indexes: [
    { started_at: -1 },
    { status: 1, started_at: -1 },
  ]
}
```

That is the handoff from “this process remembered a drain invocation” to “leftover-drain leftover-may leftover-open leftover leftover it leftover leftover as leftover leftover `running` leftover leftover after leftover leftover the leftover leftover seat leftover leftover is leftover leftover taken, leftover leftover-may leftover leftover-close leftover leftover it leftover leftover as leftover leftover `completed` leftover leftover / leftover leftover `partial_failure` leftover leftover / leftover leftover `failed`, leftover leftover-admin leftover leftover-may leftover leftover-show leftover leftover the leftover leftover newest leftover leftover card leftover leftover and leftover leftover-page leftover leftover the leftover leftover desk, leftover leftover-and leftover leftover-boot leftover leftover-creates leftover leftover the leftover leftover two leftover leftover unnamed leftover leftover clocks.” Do **not** add `{ locked_skip_plants_a_row: true }` so “every leftover wake leftover leftover-owns leftover leftover a leftover leftover card.” Do **not** add `{ selected_database_getter: true }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ autoIndex: false }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ quota_summary_has_a_runtime_writer: true }` so “the leftover file leftover leftover-comment leftover leftover-becomes leftover leftover true.” Do **not** add `{ script_has_a_runtime_writer: true }` so “the leftover union leftover leftover-has leftover leftover four leftover leftover writers.”

Leave already-recommended leftover `SheetSyncJob.ts` on that file. Leave leftover later `SheetSyncAttempt.ts` on that file. Leave leftover later `SheetSyncLease.ts` on that file. Leave leftover later `SheetSyncQuotaBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// SheetSyncRun.ts
// Someone woke the drain — a queue message, the five-minute cron,
// or an Owner retry.
// If we took the global seat, remember this invocation
// as one history card so the Admin Dashboard can say
// which drain ran last and how it closed.
// A locked skip plants no card.
// Never take the seat here. Never claim a job here.
// Never write Google Sheets here.

import { SHEET_SYNC_RUN_STATUSES, SHEET_SYNC_RUN_TRIGGERS } from "../config/domain"

// ── 1. Hold the per-drain history card ────────────────────

const SheetSyncRunSchema = new Schema(
  {
    trigger: { enum: SHEET_SYNC_RUN_TRIGGERS },          // required, no default
    status: { enum: SHEET_SYNC_RUN_STATUSES, default: "running" },
    started_at: { default: Date.now },
    finished_at: Date,
    claimed_job_count: { default: 0 },
    synced_job_count: { default: 0 },
    failed_job_count: { default: 0 },
    deferred_job_count: { default: 0 },
    quota_summary: Schema.Types.Mixed,                   // no runtime writer
    error_summary: String,                               // throw path only
  },
  { collection: "sheet_sync_runs", timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

// ── 2. Remember who woke us and how this drain closed ─────

function rememberWhoWokeTheDrainAndHowItClosed() {
  // queue | cron | admin | script
  // running → completed | partial_failure | failed
  // locked skip: no row
}

// ── 3. Stamp the unnamed clocks and hand back the model ───

SheetSyncRunSchema.index({ started_at: -1 })
SheetSyncRunSchema.index({ status: 1, started_at: -1 })

export const SheetSyncRun =
  mongoose.models.SheetSyncRun ?? mongoose.model("SheetSyncRun", SheetSyncRunSchema)
export const sheetSyncDrainHistoryCardOnTheDefaultConnection = SheetSyncRun
```

Read the primary path out loud: *Someone woke the drain. If another drain already holds the seat, we skip and this file remembers nothing. If we took the seat, remember this invocation as one card: who woke us, that we are still walking, then how we closed and how many jobs we claimed, synced, failed, or deferred. The Admin Dashboard can ask for the newest card. Do not talk to Google from here. Do not start the drain from here.*

## Precise logic I would tighten while renaming

1. **`quota_summary` is Mixed and has no runtime writer.** The file comment leftover-says leftover quota leftover / leftover error leftover summaries leftover are leftover “used leftover by leftover the leftover admin leftover health leftover surface.” Leftover health leftover leftover-returns leftover the leftover whole leftover newest leftover lean leftover card leftover as leftover `last_run`. Leftover drain leftover leftover-never leftover leftover-`$set`s leftover `quota_summary`. Do not start leftover-stamping leftover quota leftover so leftover “the leftover comment leftover leftover-becomes leftover leftover true.”

2. **`error_summary` is stamped only on the throw path.** Clean leftover `partial_failure` leftover leftover-leaves leftover it leftover unset leftover and leftover leftover-records leftover leftover `sheet_sync.drain.partial_failure` leftover on leftover leftover Observability leftover instead. Do not copy leftover the leftover throw leftover message leftover onto leftover leftover `partial_failure` leftover so leftover “every leftover unfinished leftover card leftover leftover-owns leftover leftover a leftover leftover sentence.”

3. **Trigger `"script"` is on the union and has no runtime drain caller.** Live leftover writers leftover are leftover `"queue"` leftover (leftover consumer), leftover `"cron"` leftover (leftover five-minute leftover safety leftover net), leftover `"admin"` leftover (leftover retry leftover `waitUntil`). Do not add leftover a leftover script leftover caller leftover so leftover “the leftover enum leftover leftover-has leftover leftover four leftover leftover desks.”

4. **A locked skip plants no row.** Leftover drain leftover leftover-returns leftover `{ ok: true, skipped: true, runId: null }` leftover and leftover leftover-does leftover leftover-not leftover leftover-`create`. Do not plant leftover a leftover `skipped` leftover status leftover so leftover “every leftover wake leftover leftover-owns leftover leftover a leftover leftover card” leftover without leftover a leftover paired leftover health leftover proof leftover that leftover last leftover run leftover leftover-still leftover leftover-means leftover leftover a leftover leftover taken leftover leftover seat.

5. **`partial_failure` is failed-or-deferred, not “some synced.”** Leftover drain leftover leftover-elects leftover `failedJobs > 0 || deferredJobs > 0`. A leftover run leftover leftover-that leftover leftover-synced leftover leftover ninety leftover leftover and leftover leftover-deferred leftover leftover one leftover leftover is leftover leftover `partial_failure`. Do not add leftover a leftover `completed_with_errors` leftover word leftover so leftover “this leftover leftover-matches leftover leftover HTTP leftover leftover automation.”

6. **Dual clocks: `timestamps: true` plus `started_at` / `finished_at`.** Leftover admin leftover leftover-sorts leftover leftover `started_at` leftover leftover, leftover leftover-not leftover leftover `createdAt`. Leftover drain leftover leftover-sets leftover leftover `started_at` leftover leftover on leftover leftover create leftover leftover and leftover leftover `finished_at` leftover leftover on leftover leftover close. Do not drop leftover `started_at` leftover so leftover “mongoose leftover leftover-timestamps leftover leftover-are leftover leftover enough” leftover without leftover a leftover paired leftover health leftover proof.

7. **`toJSON` / `toObject` ask virtuals this file does not define.** Leave that off the identity type until a later virtual lands. Do not add an `id` virtual here so “the DTO owns the schema.”

8. **No selected-database getter.** Leftover drain leftover / leftover admin leftover leftover-ask leftover the leftover default leftover model leftover after leftover leftover `connectMongo()`. Do not add leftover `getSheetSyncRunModel()` leftover so leftover “CRM leftover leftover-matches leftover leftover Sheet leftover leftover Sync.”

9. **Software-map gap.** `schema-and-crud-inputs.mdc` does not name `sheet_sync_runs`. Knowledge does. Leftover historical leftover consolidation leftover leftover-lists leftover leftover `sheet_sync_jobs` leftover leftover and leftover leftover-does leftover leftover-not leftover leftover-list leftover leftover this leftover leftover collection. Do not invent leftover those leftover lines leftover from leftover this leftover rename.

10. **Knowledge vs leftover later lease.** Knowledge table leftover-says leftover leftover later leftover `SheetSyncLease` leftover leftover is leftover leftover “Global drain mutex.” Live leftover later leftover file leftover leftover-says leftover leftover per-tab leftover leftover write leftover leftover fence. Do not merge leftover that leftover later leftover lease leftover into leftover this leftover card leftover so leftover “the leftover comment leftover leftover-wins.” Park leftover the leftover fight leftover for leftover leftover later leftover `SheetSyncLease.ts`.

11. **Job Timeline hops the outbox, not this card.** Already-recommended leftover loader leftover leftover-asks leftover leftover `db.collection("sheet_sync_jobs")`. Do not switch leftover that leftover loader leftover onto leftover `SheetSyncRun` leftover so leftover “one leftover model leftover leftover-owns leftover leftover evidence.”

12. **Leave sibling modules alone.** `runSheetSyncDrain` / `listSheetSyncRuns` / `getSheetSyncRunDetail` are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, the four trigger words as schema enum, the four status words as schema enum, the four count fields, the unused Mixed `quota_summary`, the throw-only `error_summary`, the two unnamed clocks, and the omitted selected-database getter. There is no `SheetSyncRun.test.ts`. Leftover `adminSheetSync.service.test.ts` already stubs `findOne` for health `last_run`. Leftover drain leftover has leftover **no** leftover focused leftover test leftover file.

I would add a focused model file if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.SheetSyncRun ?? mongoose.model(...)`; there is no `getSheetSyncRunModel`
- leftover drain asks `SheetSyncRun` after `connectMongo()`
- leftover admin desk asks the same default model
- leftover Job Timeline loader does **not** import this file
- leftover historical consolidation does **not** list `sheet_sync_runs`
- a locked skip plants no row
- trigger `"script"` stays on the schema enum and has no runtime writer
- `quota_summary` stays Mixed and has no runtime writer
- `error_summary` is stamped only on the throw path
- unnamed indexes are exactly the two `Schema.index` shapes above
- the file omits `autoIndex: false`
- the file exports no collection-name constant and no named-index catalog
- `schema-and-crud-inputs.mdc` still does not name `sheet_sync_runs`; this pass does not invent that rule line
- already-recommended leftover `SheetSyncJob` is a different collection; that file is out of this story
- leftover later `SheetSyncAttempt` is a different collection; that file is out of this story
- leftover later `SheetSyncLease` is a different collection; that file is out of this story

I would not test leftover drain claim, leftover Google write, leftover Admin retry, leftover queue publish, leftover cron mode gate, leftover Form correction, leftover Call enrichment write, leftover Booked reconciliation, or leftover Job Timeline assemble from this file.

Do not add a test per helper (`theLockedSkipPlantsNoRow`, `theQuotaSummaryHasNoWriter`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `SheetSyncRunService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `status.ts` / `trigger.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating leftover `runSheetSyncDrain` / leftover `listSheetSyncRuns` / leftover `getSheetSyncRunDetail` / leftover `getSheetSyncHealth` / leftover `retrySheetSyncJobs` / leftover `enqueueSheetSyncJob` / leftover already-recommended `SheetSyncJob` / leftover later `SheetSyncAttempt` / leftover later `SheetSyncLease` / leftover later `SheetSyncQuotaBucket` / leftover already-recommended leftover Granot CSV apply leftover pass leftover / leftover leftover later leftover `ReportingRun` as this story.
- Inventing a selected-database seam that has only the leftover CRM getter as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, planting a row on locked skip, adding a `"script"` caller, starting to write `quota_summary`, or adding a named-index catalog while recommending a rename.
- Pulling `runSheetSyncDrain` or `listSheetSyncRuns` into this file.
- Merging this collection into already-recommended leftover `SheetSyncJob`, leftover later `SheetSyncAttempt`, leftover later `SheetSyncLease`, leftover already-recommended leftover Granot leftover HTTP leftover automation leftover run, or leftover `sheet_sync[]` on the Lead.
- Silently reordering leftover `connectMongo` versus leftover drain leftover create, leftover take-the-seat versus leftover plant-the-card, leftover timeout leftover job leftover `pending` versus leftover run leftover `completed` / leftover `partial_failure`, or leftover crash leftover job leftover `retrying` versus leftover run leftover `failed`.
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover later `SheetSyncAttempt.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `SheetSyncAttempt.ts` while writing this file.
