# Remember The One Best Relocation Workbook Connection On The Default Mongo Connection — Unique Key best_relocation, Env-Name Pointers Not Spreadsheet Ids, Masked Resolved Books, Application Off Until Bootstrap And The Env Gate, Cadence Twenty-Four Or Forty-Eight, Named Scheduler And Health Clocks The Boot Creates, Default-Connection Model Only — Never Resolve Workbooks Here, Never Claim Cadence Here, Never Inspect Or Apply Here, Never Store A Raw Spreadsheet Id, Never Add A Selected-Database Getter From This Rename — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 55 of this service — `ExternalDataConnection.ts`
- Remaining in this service: `IngestionRun.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/ExternalDataConnection.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (System of Record is Mongo domain documents written only through canonical commands; Best Relocation workbooks are the external evidence source; `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [Booking](../../../../CONTEXT.md) authority — **this file never inspects sheets, never queues a run, never claims cadence, never applies a plan, never writes a Lead**). HTTP / cron: `GET|PATCH /api/v1/admin/ingestion/connections/best-relocation`; `BEST_RELOCATION_INGEST_ENABLED` must be true before `application_enabled=true`, non-bootstrap apply, or retry; `application_enabled` also requires completed bootstrap (`bootstrap_completed_at`); cadence is 24 or 48 hours. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); it does **not** define External Data Connection / Best Relocation connection; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR-0001 copies. Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections names Form / Call / Booking / WordPress receipt / Granot / `DomainCommandExecution` / `LeadMessage` and does **not** name `external_data_connections`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the Best Relocation workbook.” Already-recommended plant / cadence claim: [ingestion-repository.md](ingestion-repository.md) (`ensureBestRelocationConnection` **asks** default `ExternalDataConnection.findOneAndUpdate` `{ key: "best_relocation" }`; `claimDueBestRelocationConnection` **asks** enabled + non-null `application_enabled_actor` + due `next_due_at` then CAS `$set` `next_due_at` / `last_checked_at` — **this file never upserts, never claims**). Already-recommended inspect / apply stamp: [ingestion-worker.md](ingestion-worker.md) (`updateOne` inspect health / `resolved_workbooks`; `applyApprovedClaim` is the only path that stamps `bootstrap_completed_at`; schedule after plan lock fails `BOOTSTRAP_NOT_COMPLETED` when that clock is missing — **this file never inspects, never applies**). Already-recommended HTTP desk: [routes-ingestion.md](routes-ingestion.md) (GET `findOne` **does not** ensure; miss paints a synthetic off connection; PATCH ensure then `$set`; approve `exists` `application_enabled: true` — **never import a getter**). Already-recommended heartbeat: [routes-best-relocation-ingestion-cron.md](routes-best-relocation-ingestion-cron.md) (ensure, then env gate, then 30-hour stale `last_successful_run_at`, then claim due — **this file never publishes wakeup**). Already-recommended sheet inspect: [best-relocation-sheet-ingest-sheets.md](best-relocation-sheet-ingest-sheets.md) / [best-relocation-sheet-ingest-bootstrap.md](best-relocation-sheet-ingest-bootstrap.md) (resolve workbook ids from env; worker stamps `bootstrap_completed_at` after a completed bootstrap apply — **not this file**). Already-recommended Owner Drive row: [models-google-drive-connection.md](models-google-drive-connection.md) (ciphertext refresh token, unique owner email — **do not merge**). Already-recommended Sheets minute budget: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) — **do not merge**. Already-recommended durable Command: [models-domain-command-execution.md](models-domain-command-execution.md) (Best Relocation ownership `$elemMatch` top-level `entity_refs` BookedLead — **do not merge**; this connection is not a Command). Already-recommended append-only Change: [models-entity-change.md](models-entity-change.md) — **do not merge**. Already-recommended public throttle: [models-public-submission-throttle-bucket.md](models-public-submission-throttle-bucket.md) — **do not merge**. Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (**does not** hop `external_data_connections`). Already-recommended historical apply: [historical-consolidation-apply.md](historical-consolidation-apply.md) (`SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** this name). Distinct from leftover next run: leftover next `IngestionRun.ts` (`connection_id` refs `"ExternalDataConnection"` — **do not merge**). This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model is the write and read interface. There is no selected-database getter.** Already-recommended `ingestion/repository.ts` **asks** `ExternalDataConnection.findOneAndUpdate` `{ key: BEST_RELOCATION_CONNECTION_KEY }` (`ensureBestRelocationConnection`: `$setOnInsert` key / `google_sheets` / env-name pointers / `application_enabled: false` / `cadence_hours: 24` / `created_actor`, `$set` `updated_actor`) and `findOne` + CAS `findOneAndUpdate` (`claimDueBestRelocationConnection`). Already-recommended `ingestion/worker.ts` **asks** `updateOne` after inspect (`last_checked_at` / `resolved_workbooks` / `health`), `findById` `bootstrap_completed_at` before a fresh schedule apply, `updateOne` after a completed or completed-with-errors walk (`last_successful_run_at` only on `completed`; `bootstrap_completed_at` only on leftover `applyApprovedClaim` when trigger is `bootstrap` and status is `completed`), and `findOne` `{ _id, application_enabled: true }` (`isConnectionApplicationEnabled`). Already-recommended `ingestion.routes.ts` **asks** GET `findOne({ key: "best_relocation" })` (no ensure; `safeConnection` strips `workbook_env_keys` / `created_actor` / `updated_actor`), PATCH `ensure` then `findOneAndUpdate` (enable requires `{ bootstrap_completed_at: { $type: "date" } }`; disable nulls `application_enabled_actor`; cadence-only `$set`s `next_due_at` to now plus hours), approve `exists({ _id: candidate.connection_id, application_enabled: true })`. Already-recommended heartbeat **asks** `ensureBestRelocationConnection` then reads `application_enabled` / `last_successful_run_at` for the 30-hour stale letter, then leftover `claimDueBestRelocationConnection`. Leftover CLI `scripts/best-relocation-sheet-ingest.ts` **asks** `findOne({ key })` `.select("_id")` so dry-run can apply receipt skip — **never upserts**. Already-recommended `applyPlan.ts` / leftover Domain Commands **never import this file**. Tests: there is **no** `ExternalDataConnection.test.ts`. `ingestion.test.ts` “persistence schemas enforce receipt uniqueness” **asks** leftover `SourceRowReceipt` / leftover `IngestionConflict` / leftover `SourceRowState` / leftover `IngestionRun` indexes and **does not** ask this schema; “heartbeat gates skip before source reads” **asks** leftover `ingestionHeartbeatSkipReason` with a fixture `application_enabled` boolean — **never this model**. Not this **interface**: `ensureBestRelocationConnection` itself, `claimDueBestRelocationConnection` itself, leftover `connectionHealthFromInspection` itself, leftover `resolveWorkbookIds` itself, leftover next `IngestionRun` itself.
- Seams callers need: default `ExternalDataConnection` (first-registered connection — plant, claim, inspect stamp, GET, PATCH, approve exists, CLI find, worker gate; there is **no** selected-database getter) vs mongoose `findOneAndUpdate` upsert (ensure) vs CAS `findOneAndUpdate` (claim due) vs `updateOne` (worker stamps) vs GET `findOne` that **does not** ensure vs **no** `new` + `save`; unique `key` (`unique: true` on the field — live plant writes the literal `"best_relocation"`) vs leftover next run `connection_id` ObjectId ref; required `workbook_env_keys.leads` / `.booked` (env **names** `BEST_RELOCATION_SYNC_SHEET_ID` / `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`, not spreadsheet ids) vs `resolved_workbooks.*.masked_id` (inspect stamps titles + masks; HTTP GET keeps those and strips the env-name bag); required `application_enabled` default `false` plus Mixed `application_enabled_actor` vs leftover env `BEST_RELOCATION_INGEST_ENABLED` vs `bootstrap_completed_at` Date-or-null; required `cadence_hours` enum `24 | 48` default `24`; named `external_connection_scheduler` `{ application_enabled: 1, next_due_at: 1 }` plus named `external_connection_health` `{ last_successful_run_at: 1 }` vs unnamed unique `key`; `timestamps: true` camelCase `createdAt` / `updatedAt`; default `__v`; unused `toJSON` / `toObject` `{ virtuals: true }`; omitted `autoIndex: false` (boot creates the unique key plus the two named clocks — there is **no** named catalog export and **no** `pnpm migration:*` for this collection). There is no persist-helper **adapter**. There is no selected-database **adapter**. There is no Domain Command **seam**. There is no HTTP **seam**. There is no resolve-workbook **adapter**. There is no raw-spreadsheet-id **adapter**.
- Split later (only if the file outgrows one sitting): this ~89-line file is one sitting if you read it as remember the one Best Relocation workbook connection on the default Mongo connection — unique key `best_relocation`, env-name pointers not spreadsheet ids, masked resolved books, application off until bootstrap and the env gate, cadence twenty-four or forty-eight, named scheduler and health clocks the boot creates, default-connection model only — never resolve workbooks here, never claim cadence here, never inspect or apply here, never store a raw spreadsheet id, never add a selected-database getter from this rename. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `health.ts` / `cadence.ts` / `connection.ts`. Plant / claim stay already-recommended `ingestion/repository.ts`. Inspect / apply stamp stay already-recommended `ingestion/worker.ts`. HTTP / cron stay already-recommended routes. Leftover next run stays leftover next `IngestionRun.ts`.

`ExternalDataConnection` is a Mongoose model name. The owner question is: *Someone already named the Best Relocation workbooks in env. Hold the one connection on `external_data_connections`. That row is key `best_relocation` — one key cannot have two rows. Remember the env var names for the leads book and the booked book, not the spreadsheet ids. After inspect, remember the last masked titles. Keep application off until bootstrap finished and the env gate is on. Remember cadence 24 or 48. Remember four health facets. Boot creates the unique key plus the named scheduler and health clocks. There is no selected-database getter. Do not resolve workbooks. Do not claim cadence. Do not inspect. Do not apply. Do not store a raw spreadsheet id. Do not invent a getter so “this matches the Change.” Do not merge this into leftover next Ingestion Run.*

Who plant / claim already lives in already-recommended `ingestion/repository.ts`. Who inspect / stamp health / stamp bootstrap-completed already lives in already-recommended `ingestion/worker.ts`. Who enable after bootstrap already lives in already-recommended `ingestion.routes.ts`. Who resolve workbook ids from env already lives in already-recommended `bestRelocationSheetIngest`. Do not pull those in.

## What this file actually does

Three operations of one “remember the one Best Relocation workbook connection on the default Mongo connection — unique key `best_relocation`, env-name pointers not spreadsheet ids, masked resolved books, application off until bootstrap and the env gate, cadence twenty-four or forty-eight, named scheduler and health clocks the boot creates, default-connection model only — never resolve workbooks here, never claim cadence here, never inspect or apply here, never store a raw spreadsheet id, never add a selected-database getter from this rename” story, not “an external-data-connection CRUD dump,” and not Inspect Or Apply Best Relocation itself:

1. **Hold the one Best Relocation workbook connection** — collection `external_data_connections`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`). **No** `minimize: false`. Unused `toJSON` / `toObject` `{ virtuals: true }`. **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Default ObjectId `_id`. Required trimmed unique `key`. Required `provider` enum `["google_sheets"]` default `"google_sheets"`. Required nested `workbook_env_keys` `{ leads, booked }` trimmed strings. Nested `resolved_workbooks` `{ leads|booked: { title, masked_id } }` defaults null. Required `application_enabled` Boolean default `false`. Optional Mixed `application_enabled_actor` default `null`. Required `cadence_hours` Number enum `[24, 48]` default `24`. Optional Date `next_due_at` / `last_checked_at` / `last_successful_run_at` / `bootstrap_completed_at` default `null`. Nested `health` `{ connection, schema, formula, identity_column }` each a `{ status enum unknown|healthy|degraded|unhealthy default unknown, checked_at, summary, details Mixed }` `{ _id: false }`. Required Mixed `created_actor` / `updated_actor`. `ExternalDataConnectionDocument` is `InferSchemaType` plus `_id`. This beat does **not** upsert. This beat does **not** `$set` `next_due_at`. This beat does **not** call Google.

2. **Remember which key this is — env-name pointers, masked books, application off until bootstrap and the env gate** — unique `key` is the identity. Live plant writes the literal `"best_relocation"`. There is **no** unique `{ provider }`. `workbook_env_keys` stores env **names**, not spreadsheet ids; leftover `resolveWorkbookIds` reads those names next door. `resolved_workbooks` stores title + `masked_id` after inspect — leftover `safeConnection` keeps those and strips the env-name bag plus both actors. `application_enabled` defaults `false`. Owner PATCH enable requires leftover env on **and** `{ bootstrap_completed_at: { $type: "date" } }` or 409. Claim due also requires `application_enabled_actor` `{ $ne: null }`. Disable nulls that actor. `cadence_hours` accepts only 24 or 48. This beat does **not** store a raw spreadsheet id. This beat does **not** compare `BEST_RELOCATION_INGEST_ENABLED`. This beat does **not** stamp `bootstrap_completed_at`.

3. **Stamp the unique key plus the named scheduler and health clocks and bind the default-connection model** — field `unique: true` on `key` plus named `external_connection_scheduler` `{ application_enabled: 1, next_due_at: 1 }` plus named `external_connection_health` `{ last_successful_run_at: 1 }`. There is **no** `EXTERNAL_DATA_CONNECTION_INDEXES` catalog. There is **no** collection-name export. There is **no** `createExternalDataConnection`. Default export `ExternalDataConnection` is `mongoose.models.ExternalDataConnection ?? mongoose.model(...)`. There is **no** `getExternalDataConnectionModel`. Plant / GET / PATCH / worker / CLI ask that default after `connectMongo()`. Boot creates the unique key plus the two named clocks. This beat does **not** `useDb`. This beat does **not** invent a selected-database getter from this rename. This beat does **not** flip `autoIndex: false` so “boot matches the Change.”

There is no plant operation. `ensureBestRelocationConnection` upserts next door. There is no claim-cadence operation. `claimDueBestRelocationConnection` CAS-es `next_due_at` next door. There is no inspect operation. Leftover worker stamps health after leftover `adapter.inspect`. There is no apply operation. Leftover `applyBestRelocationPlan` walks leftover next `IngestionRun`. There is no HTTP list of many connections. GET paints one key, or a synthetic off row when the plant has not run.

## Organization

Keep one file. This is the screenplay for “remember the one Best Relocation workbook connection on the default Mongo connection — unique key `best_relocation`, env-name pointers not spreadsheet ids, masked resolved books, application off until bootstrap and the env gate, cadence twenty-four or forty-eight, named scheduler and health clocks the boot creates, default-connection model only — never resolve workbooks here, never claim cadence here, never inspect or apply here, never store a raw spreadsheet id, never add a selected-database getter from this rename.” Plant / claim already live in already-recommended `ingestion/repository.ts`. Inspect / apply stamp already live in already-recommended `ingestion/worker.ts`. HTTP / cron already live in already-recommended routes. Workbook id resolve already lives in already-recommended `bestRelocationSheetIngest`. Already-recommended Command / Change / Owner Drive / Sheets minute budget / public throttle already live in sibling **modules**. Leftover next run already lives in a sibling **module**. Do not pull those in. Do not invent an `ExternalDataConnectionService` class. Do not invent a begin / complete Domain Command **seam** on this file. Do not invent a selected-database **adapter** beside today’s default export so “this matches the Change” without a paired plant selected-database proof. Do not invent an `autoIndex: false` **adapter** so “boot matches the Change” without a paired proof that uniqueness still exists before the first heartbeat. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `health.ts` / `cadence.ts` / `connection.ts` each get a file.

Do not move `ensureBestRelocationConnection` into this file so “the model plants the row.” Do not move `claimDueBestRelocationConnection` into this file so “the model owns cadence.” Do not move `connectionHealthFromInspection` into this file so “the model inspects.” Do not move `resolveWorkbookIds` into this file so “the model owns spreadsheet ids.” Do not merge this file into leftover next `IngestionRun.ts` so “one row owns the connection and the run.” Do not merge this file into already-recommended `DomainCommandExecution.ts` so “one row owns the workbook and the Command.” Do not merge this file into already-recommended `GoogleDriveConnection.ts` so “one Google login owns Drive and Best Relocation.” Do not merge this file into already-recommended `SheetSyncQuotaBucket.ts` so “one bag owns Sheets drain and ingest cadence.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ExternalDataConnection` | `bestRelocationWorkbookConnectionOnTheDefaultConnection` | plant, claim, inspect stamp, GET, PATCH, approve exists, CLI find, and worker gate **ask** the first-registered connection |
| `ExternalDataConnectionDocument` | `BestRelocationWorkbookConnection` | inferred row + `_id` |

Keep the old names as one-line aliases until already-recommended repository / worker / HTTP / cron / CLI migrate. Do not make callers learn `external_connection_scheduler` / `workbook_env_keys` as the only domain language until those sites move. Do **not** add `getExternalDataConnectionModel` so “this matches the Change” without a paired proof that plant still writes the selected database. Do **not** add `createExternalDataConnection` so “SMS save matches the connection.” Do **not** re-export `ensureBestRelocationConnection` / `claimDueBestRelocationConnection` / `resolveWorkbookIds` from this file so “the model plants, claims, or resolves ids.” Do **not** export a named index catalog that does not exist on disk.

**No class for the workflow.** The one type that *does* earn a name is the Best Relocation workbook-connection identity contract:

```ts
type BestRelocationWorkbookConnectionIdentity = {
  collection: "external_data_connections"
  unique_key: true
  live_key: "best_relocation"
  provider: "google_sheets"
  stores_raw_spreadsheet_id: false
  stores_env_name_pointers: true
  stores_masked_resolved_books: true
  application_enabled_default: false
  enable_requires_env_gate: true
  enable_requires_bootstrap_completed_at: true
  claim_requires_application_enabled_actor: true
  cadence_hours: [24, 48]
  health_facets: ["connection", "schema", "formula", "identity_column"]
  bootstrap_completed_stamped_only_on_approved_bootstrap_apply: true
  last_successful_run_at_only_on_completed: true
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  object_id: true
  selected_database_getter: false
  save_through_getter: false
  autoIndex: true
  named_index_catalog: false
  named_clocks: ["external_connection_scheduler", "external_connection_health"]
  boot_creates_clocks: true
  model_test: false
  core_collections_names_this: false
  historical_side_effect: false
  job_timeline_hops_this: false
}
```

That is the handoff from “this process remembered the one Best Relocation workbook connection” to “identity is unique key `best_relocation`, env-name pointers not spreadsheet ids, application stays off until bootstrap and the env gate, boot creates those clocks, and there is no selected-database getter.” Do **not** add `{ selected_database_getter: true }` so “this matches the Change.” Do **not** add `{ stores_raw_spreadsheet_id: true }` so “inspect can skip env.” Do **not** add `{ autoIndex: false }` so “this matches Form Lead.” Do **not** add `{ live_key: "best_relocation_leads" }` so “the conflict source-company key owns the connection.”

Leave already-recommended `ingestion/repository.ts` on that file. Leave already-recommended `ingestion/worker.ts` on that file. Leave leftover next `IngestionRun.ts` on that file. Leave already-recommended `DomainCommandExecution.ts` on that file. Leave already-recommended `GoogleDriveConnection.ts` on that file. Leave already-recommended `BookedLead.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ExternalDataConnection.ts
// Someone already named the Best Relocation workbooks in env.
// Hold the one connection on external_data_connections.
// That row is key best_relocation — one key cannot have two rows.
// Remember the env var names for the leads book and the booked book,
// not the spreadsheet ids.
// After inspect, remember the last masked titles.
// Keep application off until bootstrap finished and the env gate is on.
// Remember cadence 24 or 48.
// Remember four health facets.
// Boot creates the unique key plus the named scheduler and health clocks.
// There is no selected-database getter.
// Do not resolve workbooks.
// Do not claim cadence.
// Do not inspect.
// Do not apply.
// Do not store a raw spreadsheet id.

// ── 1. Hold the one Best Relocation workbook connection ──

const HealthSchema = new Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["unknown", "healthy", "degraded", "unhealthy"],
      default: "unknown",
    },
    checked_at: { type: Date, default: null },
    summary: { type: String, trim: true, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
)

const ExternalDataConnectionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, unique: true },
    provider: {
      type: String,
      required: true,
      enum: ["google_sheets"],
      default: "google_sheets",
    },
    workbook_env_keys: {
      leads: { type: String, required: true, trim: true },
      booked: { type: String, required: true, trim: true },
    },
    resolved_workbooks: {
      leads: { title: String, masked_id: String },
      booked: { title: String, masked_id: String },
    },
    application_enabled: { type: Boolean, required: true, default: false },
    application_enabled_actor: { type: Schema.Types.Mixed, default: null },
    cadence_hours: {
      type: Number,
      required: true,
      enum: [24, 48],
      default: 24,
    },
    next_due_at: { type: Date, default: null },
    last_checked_at: { type: Date, default: null },
    last_successful_run_at: { type: Date, default: null },
    bootstrap_completed_at: { type: Date, default: null },
    health: {
      connection: { type: HealthSchema, default: () => ({}) },
      schema: { type: HealthSchema, default: () => ({}) },
      formula: { type: HealthSchema, default: () => ({}) },
      identity_column: { type: HealthSchema, default: () => ({}) },
    },
    created_actor: { type: Schema.Types.Mixed, required: true },
    updated_actor: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "external_data_connections", timestamps: true },
)

// ── 2. Remember which key this is — env-name pointers,
// masked books, application off until bootstrap and the env gate

function rememberWhichKeyAndThatApplicationStaysOffUntilBootstrap() {
  // unique key is the identity
  // live plant writes "best_relocation"
  // workbook_env_keys are env names, not spreadsheet ids
  // resolved_workbooks are title + masked_id
  // application_enabled defaults false
  // PATCH enable needs env + bootstrap_completed_at date
  // claim due also needs application_enabled_actor
  // cadence_hours is 24 or 48
}

// ── 3. Stamp the unique key plus the named scheduler
// and health clocks and bind the default-connection model

ExternalDataConnectionSchema.index(
  { application_enabled: 1, next_due_at: 1 },
  { name: "external_connection_scheduler" },
)
ExternalDataConnectionSchema.index(
  { last_successful_run_at: 1 },
  { name: "external_connection_health" },
)

export const bestRelocationWorkbookConnectionOnTheDefaultConnection =
  mongoose.models.ExternalDataConnection ??
  mongoose.model("ExternalDataConnection", ExternalDataConnectionSchema)

export {
  bestRelocationWorkbookConnectionOnTheDefaultConnection as ExternalDataConnection,
}
```

Read the primary path out loud: *The owner opened Best Relocation ingest. GET asked the default model for key `best_relocation` after `connectMongo()` and did not plant a row — a miss painted an off connection with cadence 24. Heartbeat later planted that same key with env-name pointers and `application_enabled: false`. Bootstrap apply finished next door and stamped `bootstrap_completed_at`. Owner PATCH then turned application on because the env gate was true and that clock was a date, and wrote `application_enabled_actor`. Heartbeat claimed the row when `next_due_at` was due, pushed the clock forward by 24 or 48 hours, and queued leftover next Ingestion Run. Inspect stamped masked titles and four health facets. A completed walk stamped `last_successful_run_at`. Do not resolve workbooks from here. Do not store a raw spreadsheet id from here. Do not merge this into leftover next Ingestion Run or the already-recommended Command.*

## Precise logic I would tighten while renaming

1. **GET does not plant.** Already-recommended GET `findOne({ key: "best_relocation" })` and paints a synthetic off row on miss. Heartbeat / PATCH / preview **ask** leftover `ensureBestRelocationConnection`. Do not teach GET to upsert so “one read owns the key” without a paired HTTP proof. Do not delete the synthetic miss so “the desk 404s until cron runs.”

2. **Env-name pointers, not spreadsheet ids.** Plant `$setOnInsert`s `BEST_RELOCATION_SYNC_SHEET_ID` / `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`. Leftover `resolveWorkbookIds` reads those names next door. Inspect stamps `resolved_workbooks.*.masked_id`. HTTP `safeConnection` strips `workbook_env_keys`. Do not persist a raw spreadsheet id so “inspect can skip env.” Do not move `resolveWorkbookIds` into this file so “the model owns the books.”

3. **Application stays off until bootstrap and the env gate.** Plant inserts `application_enabled: false`. PATCH enable + leftover env off is 409. PATCH enable without `{ bootstrap_completed_at: { $type: "date" } }` is 409 `"Bootstrap adoption must complete before scheduling is enabled."` Approve of a non-bootstrap run `exists` `application_enabled: true`. Do not default `application_enabled` true so “cron can start tonight.” Do not drop the bootstrap date filter so “enable is only the env flag.”

4. **Claim due also requires `application_enabled_actor`.** Leftover `claimDueBestRelocationConnection` filters `application_enabled: true` **and** `application_enabled_actor: { $ne: null }` **and** `next_due_at` null / missing / `<= now`, then CAS-es `next_due_at` to `now + cadence_hours`. PATCH disable nulls that actor. Do not claim on `application_enabled` alone so “a leftover true flag without an actor still schedules.” Do not drop the CAS so “two heartbeats queue two runs.”

5. **`bootstrap_completed_at` is stamped on one apply path.** Already-recommended leftover `applyApprovedClaim` stamps it only when trigger is `bootstrap` and the walk is `completed`. The fresh schedule-after-plan-lock path **asks** that clock and `failRun`s `BOOTSTRAP_NOT_COMPLETED` when it is missing — it does **not** stamp it. Do not stamp bootstrap-completed from the schedule finalize so “one apply owns the gate.” Do not stamp it from this file so “the model finished bootstrap.”

6. **`last_successful_run_at` is only `completed`.** Worker `$set`s it when `finalStatus === "completed"`. `completed_with_errors` updates `last_checked_at` and paints `health.connection` `degraded` and does **not** move that success clock. Heartbeat errors when application is on and that clock is missing or older than 30 hours. Do not stamp success on `completed_with_errors` so “a row failure still looks fresh.” Do not move the 30-hour letter into this file so “the model owns stale.”

7. **Cadence is 24 or 48, not a free number.** Schema enum and PATCH Zod agree. Cadence-only PATCH `$set`s `next_due_at` to now plus those hours without touching `application_enabled`. Do not accept 12 so “we can run twice a day” without a paired PATCH + claim proof. Do not unique `next_due_at`.

8. **Four health facets, one inspect stamp.** Leftover `connectionHealthFromInspection` writes `connection` / `schema` / `formula` / `identity_column`. Schema default is `unknown`. Do not add a fifth facet from this rename so “formula owns identity.” Do not compute `healthy` on the schema so “the model inspects.”

9. **Named scheduler and health clocks plus unnamed unique `key`.** Field `unique: true` creates the identity clock. The two named indexes are not exported as a catalog. There is no leftover `pnpm migration:*` for this collection. Already-recommended Change is `autoIndex: false` plus a named catalog the migration applies. Do not flip `autoIndex: false` so “boot matches the Change” without a paired proof that uniqueness still exists before the first heartbeat. Do not add `EXTERNAL_DATA_CONNECTION_INDEXES` so “this matches the Command” without a paired migration.

10. **Default export is the only runtime import.** There is no getter. Routes `connectMongo()` first. Do not add `getExternalDataConnectionModel` so “this matches the Change” without a paired plant selected-database proof. Do not delete the default so “everyone must call a getter that does not exist.”

11. **Unused `toJSON` / `toObject` virtuals.** There are no virtuals. Already-recommended Change omits both. Do not add virtuals so “the flags become true.” Do not drop the flags from this rename as a cleanup unless a later pass proves no caller relies on `toJSON()`.

12. **CamelCase timestamps plus `__v`.** Already-recommended Owner Drive uses named `created_at` and `versionKey: false`. Already-recommended public throttle uses this same camelCase plus `__v`. Do not rename `createdAt` so “ingest matches Drive.” Do not drop `__v` so “this matches the nonce.”

13. **Provider is only `google_sheets`.** Do not add `csv` / `granot` so “one connection owns every ingest.” Do not merge this into already-recommended `GranotCrmCsvIngestion` so “one row owns the workbook and the CSV.”

14. **CLI dry-run finds and never plants.** Leftover `scripts/best-relocation-sheet-ingest.ts` `findOne({ key })` so receipt skip can run when the connection already exists. Live CLI apply is retired. Do not teach the CLI to upsert so “dry-run owns the key.”

15. **Core Collections, historical apply, and Job Timeline omit this collection.** `schema-and-crud-inputs.mdc` does **not** name `external_data_connections`. Historical `SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and omits this name. Job Timeline does not hop this name. Do not add this collection to those lists from this rename so “the connection is a side-effect of apply.” Do not teach apply to import this model.

16. **There is no model test.** Leftover `ingestion.test.ts` asks leftover run / receipt / conflict / row-state indexes and leftover heartbeat skip fixtures. Do not add a live Mongo connection test on this file so “the schema owns cadence 24.”

17. **Leftover next run points here.** Leftover next `IngestionRun.connection_id` refs `"ExternalDataConnection"`. Plant returns `_id` so preview / heartbeat can queue. Do not unique `connection_id` on this file. Do not merge the collections so “one document owns the workbook and the walk.”

18. **Leave sibling modules alone.** `ensureBestRelocationConnection` / leftover worker inspect stamp / leftover next `IngestionRun` writes are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the inferred-row type, required trimmed unique `key`, `provider` enum `google_sheets`, required env-name `workbook_env_keys`, masked `resolved_workbooks`, `application_enabled` default `false`, Mixed `application_enabled_actor`, `cadence_hours` enum `24 | 48`, Date-or-null `next_due_at` / `last_checked_at` / `last_successful_run_at` / `bootstrap_completed_at`, four health facets, camelCase timestamps, default `__v`, default ObjectId `_id`, unnamed unique `key`, named `external_connection_scheduler` and `external_connection_health`, omitted `autoIndex: false`, omitted selected-database getter, and the omitted save helper. There is no model test today. Leftover `ingestion.test.ts` asks leftover sibling indexes and leftover skip fixtures, not this export.

I would keep a later focused model file on that interface. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.ExternalDataConnection ?? mongoose.model(...)`
- there is **no** `getExternalDataConnectionModel`
- plant **asks** the default `findOneAndUpdate` `{ key: "best_relocation" }` after `connectMongo()` — **not** `new` + `save`
- unique `key` refuses a second Best Relocation row
- `workbook_env_keys` stores env names; raw spreadsheet ids are **not** stored
- GET miss paints a synthetic off connection and **does not** plant
- PATCH enable without leftover env or without `bootstrap_completed_at` is 409
- claim due requires `application_enabled` **and** `application_enabled_actor` **and** a due `next_due_at`, then CAS-es the next clock
- leftover `applyApprovedClaim` stamps `bootstrap_completed_at` only on a completed bootstrap walk
- `last_successful_run_at` is stamped only on `completed`
- leftover CLI `findOne` never upserts
- HTTP desks ask already-recommended GET / PATCH / leftover repository / leftover worker — GET strips `workbook_env_keys` and actors
- historical apply / verify omit `external_data_connections`
- Job Timeline does **not** hop this collection
- `schema-and-crud-inputs.mdc` does **not** name this collection; this pass does not rewrite that paragraph
- leftover next `IngestionRun` is a different collection; that file is out of this story
- already-recommended `DomainCommandExecution` is a different collection; that file is out of this story
- already-recommended `GoogleDriveConnection` is a different collection; that file is out of this story
- already-recommended `SheetSyncQuotaBucket` is a different collection; that file is out of this story

I would not test inspect / plan / adopt / apply, leftover `resolveWorkbookIds`, leftover env-gate parse, leftover 30-hour stale letter, leftover wakeup publish, or leftover Domain Command apply from this file.

Do not add a test per helper (`theKeyIsBestRelocation`, `envNamesAreNotSpreadsheetIds`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- An `ExternalDataConnectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `health.ts` / `cadence.ts` / `connection.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (already-recommended Domain Commands own the Lead / Booking write; leftover worker stamps this row after inspect or after a completed walk; this file only holds the connection).
- Treating `ensureBestRelocationConnection` / `claimDueBestRelocationConnection` / leftover `connectionHealthFromInspection` / leftover `resolveWorkbookIds` / leftover next `IngestionRun` / already-recommended Command / already-recommended Owner Drive as this story.
- Inventing a selected-database seam that has only the Change’s getter as an adapter.
- Inventing a raw-spreadsheet-id seam that has only inspect as an adapter.
- Silently storing a raw spreadsheet id, adding a getter, deleting the default export, flipping `autoIndex: false`, adding a named-index catalog, adding `createExternalDataConnection`, defaulting `application_enabled` true, teaching GET to upsert, stamping `bootstrap_completed_at` from the schedule finalize, stamping `last_successful_run_at` on `completed_with_errors`, rewriting Core Collections, or teaching historical apply to list this collection while recommending a rename.
- Pulling `ensureBestRelocationConnection` or `resolveWorkbookIds` into this file.
- Merging this collection into leftover next `IngestionRun`, already-recommended `DomainCommandExecution`, already-recommended `EntityChange`, already-recommended `GoogleDriveConnection`, already-recommended `SheetSyncQuotaBucket`, already-recommended `PublicSubmissionThrottleBucket`, already-recommended Owner case, or already-recommended Form / Call / Booking.
- Silently reordering plant-then-PATCH versus inspect-then-apply, or claim-due CAS versus leftover wakeup publish.
- Changing plant to `deleteOne` so “we can re-bootstrap from a clean row.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `IngestionRun.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `IngestionRun.ts` while writing this file.
