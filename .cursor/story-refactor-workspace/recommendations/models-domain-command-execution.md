# Remember The Durable Applied Command Result On The Default Mongo Connection — Unique Origin Plus Idempotency Key And Unique Command Id, Nested Applied Result Plus Compatibility Top-Level Refs, Legacy Rows Derive Without Rewrite, Named Clocks Boot And Migration Both Apply, Default-Connection Model Only — Never Apply Or Replay Here, Never Store Already-Applied, Never Finalize Sheets, Never Add A Selected-Database Getter From This Rename — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 54 of this service — `DomainCommandExecution.ts`
- Remaining in this service: `ExternalDataConnection.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/DomainCommandExecution.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) sections **Executor sequence** and **Stored result vs compatibility adapter** (System of Record is Mongo; the executor owns one transaction, the durable Command, append-only `EntityChange` rows, aggregate revision stamps, and queued Sheet Sync intent — **this file never applies a named command, never replays, never checksums, never finalizes sheets**). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections **does** name `DomainCommandExecution` (`domain_command_executions`) as the durable idempotent command result; origins `external_sheet_ingestion | vantage_admin | granot_lifecycle | ringcentral`; new rows store nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings`; unique indexes remain `(origin, idempotency_key)` and `command_id`; legacy rows without `result` are read by derivation and are not rewritten; the executor owns the transaction; Sheet Sync does not persist commands. Do not rewrite that paragraph from this rename so “the Core Collections list invented stored `already_applied`.” This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [System of Record](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Entity Change](../../../../CONTEXT.md); it does **not** define Domain Command Execution here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR-0001 copies. Already-recommended writer: [domain-commands-idempotency.md](domain-commands-idempotency.md) (`mongooseExecutionStore.find` / `persist` **asks** default `DomainCommandExecution.findOne({ origin, idempotency_key })` and `new DomainCommandExecution({ _id: execution_id })` + `save({ session })` — **this file never elects replay, never 11000s, never records `domain_command.applied`**). Already-recommended append-only mutation evidence: [models-entity-change.md](models-entity-change.md) / [domain-commands-entity-change.md](domain-commands-entity-change.md) (collection `entity_changes`, selected-database getter, `autoIndex: false` — **do not merge**; persist writes `command_execution_id` pointing at this row’s `_id`). Already-recommended public employee-submit window bag: [models-public-submission-throttle-bucket.md](models-public-submission-throttle-bucket.md) (default-connection only, unnamed TTL — **do not merge**). Already-recommended confirmation-SMS capacity: [models-lead-message-rate-limit.md](models-lead-message-rate-limit.md) — **do not merge**. Already-recommended Sheets minute budget: [models-sheet-sync-quota-bucket.md](models-sheet-sync-quota-bucket.md) — **do not merge**. Already-recommended Owner case: [models-booking-lead-reconciliation-case.md](models-booking-lead-reconciliation-case.md) — **do not merge**. Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (**does not** hop `domain_command_executions`; hops raw `entity_changes`). Already-recommended historical apply: [historical-consolidation-apply.md](historical-consolidation-apply.md) (`SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** this name). Already-recommended Sheet Sync coordinator: [sheet-sync-coordinator.md](sheet-sync-coordinator.md) (finalize after a successful **non-replay** commit — **never persist a Command**). Distinct from leftover next Best Relocation connection: leftover next `ExternalDataConnection.ts` — **do not merge**. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model is the write, reload, and ownership-check interface. There is no selected-database getter.** Already-recommended `domainCommands/idempotency.ts` is the **only** runtime persist: `mongooseExecutionStore.find` **asks** `DomainCommandExecution.findOne({ origin, idempotency_key })` (session-scoped inside the transaction; no session after a 11000 race), then `readStoredCanonicalCommandResult`. `persist` **asks** `new DomainCommandExecution({ _id: execution_id, …, result, entity_refs, warnings, applied_at })` + `save({ session })`. Already-recommended after-commit reload **asks** `findOne({ origin, command_name, idempotency_key }).select({ _id: 1 })`: leftover `bookingConfirmation.ts` / leftover `referralBooking.ts` (`granot_lifecycle`), leftover `connectBookingToLead.ts` (`vantage_admin`) — they never persist. Already-recommended Best Relocation ownership **asks** `findOne({ origin: "external_sheet_ingestion", command_name: "createLeadlessBooking", "provenance.source_connection_key", entity_refs $elemMatch BookedLead })`: leftover `cancelledLead.service.ts` (cancel guard) and already-recommended `bookings.ts` `attachBookingToLead` — they never persist. Already-recommended `existingWrites.ts` / leftover Granot create / sync / Owner Booking / Release / discrepancy / leftover RingCentral adopt **ask** the executor — **they never import this file**. Leftover `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `DOMAIN_COMMAND_EXECUTION_INDEXES` (report-first; non-unique creates first, then unique `command_id` and `{ origin, idempotency_key }`). Leftover `granot-lifecycle-indexes.lib.ts` **re-declares** `DOMAIN_COMMAND_EXECUTION_COLLECTION = "domain_command_executions"` and does **not** import this file’s collection export. Tests: `DomainCommandExecution.test.ts` AC-21 / AC-32 **asks** default `DomainCommandExecution.schema.indexes()` (unique origin+key, named unique `command_id`) plus origin enum plus nested `result.status` enum `["applied"]` plus `readStoredCanonicalCommandResult` (legacy top-level derives; nested wins). Already-recommended `domainCommands.test.ts` AC-21 unique origin+key. Already-recommended `idempotency.integration.test.ts` / `entityChange.integration.test.ts` opt-in replica **asks** default `DomainCommandExecution.find`. Leftover Granot / RingCentral replica tests **ask** default `countDocuments` / `find` / `deleteMany`. Not this **interface**: `executeIdempotentCanonicalCommand` itself, `toCompatibilityCanonicalCommandResult` itself, `assertCommandContext` itself, leftover next `ExternalDataConnection` itself, already-recommended `persistEntityChangeMutations` itself.
- Seams callers need: default `DomainCommandExecution` (first-registered connection — persist, reload, ownership, model tests, replica counts; there is **no** selected-database getter) vs mongoose `findOne({ origin, idempotency_key })` (executor replay) vs `new` + `save({ session })` (executor persist) vs **no** `findOneAndUpdate`; unique `{ origin, idempotency_key }` plus unique `{ command_id }` vs already-recommended Change unique `{ entity.model, entity.id, revision_after }`; nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings` vs `readStoredCanonicalCommandResult` (nested wins; legacy without `result` derives; never rewrites); required Mixed `actor` / `initiator` / `provenance` vs already-recommended sibling `assertCommandContext` (this file does not validate Mixed); required `applied_at` plus `timestamps: true` camelCase `createdAt` / `updatedAt`; default `__v`; default ObjectId `_id` that persist preallocates from the caller’s ObjectId-hex `command_id` (otherwise mints `_id` and still stores the caller’s `command_id` string); omitted `autoIndex: false` (boot creates the four named clocks) vs leftover `pnpm migration:granot-lifecycle:indexes` that **also** applies non-unique first. There is no persist-helper **adapter** on this file. There is no selected-database **adapter**. There is no HTTP **seam**. There is no apply-or-replay **seam**. There is no `already_applied` **adapter**.
- Split later (only if the file outgrows one sitting): this ~131-line file is one sitting if you read it as remember the durable applied command result on the default Mongo connection — unique origin plus idempotency key and unique command id, nested applied result plus compatibility top-level refs, legacy rows derive without rewrite, named clocks boot and migration both apply, default-connection model only — never apply or replay here, never store already-applied, never finalize sheets, never add a selected-database getter from this rename. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `replay.ts` / `result.ts`. Apply-once stays already-recommended `domainCommands/idempotency.ts`. Already-recommended Change stays `EntityChange.ts`. Leftover next Best Relocation connection stays leftover next `ExternalDataConnection.ts`.

`DomainCommandExecution` is a Mongoose model name. The owner question is: *Someone already named the command, already built a trusted context, and already ran or replayed that command once. Hold one durable applied result on `domain_command_executions`. That row is this origin plus this idempotency key — one pair cannot have two rows. That row is also this command id — one command id cannot have two rows. Remember the command name and the payload checksum so a later ask with a different name or checksum can refuse next door. Store applied. Never store already-applied. New rows nest `result.status: "applied"` and still copy entity refs and warnings to the top-level columns the old rows used. A legacy row without `result` still reads as applied from those top-level columns. Do not rewrite that legacy row. There is no selected-database getter. Named clocks live on the schema. Boot creates them. The reviewed migration also applies non-unique first, then the unique keys. Do not apply the named command. Do not replay. Do not finalize sheets. Do not invent a getter so “this matches the Change.” Do not store `already_applied` so “replay is visible in Mongo.” Do not merge this into the leftover next Best Relocation connection or the already-recommended Change.*

Who apply / replay / 11000 / finalize already lives in already-recommended `domainCommands/idempotency.ts`. Who append the Change already lives in already-recommended `domainCommands/entityChange.ts`. Who may speak already lives in already-recommended `commandContext.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the durable applied command result on the default Mongo connection — unique origin plus idempotency key and unique command id, nested applied result plus compatibility top-level refs, legacy rows derive without rewrite, named clocks boot and migration both apply, default-connection model only — never apply or replay here, never store already-applied, never finalize sheets, never add a selected-database getter from this rename” story, not “a command-execution CRUD dump,” and not Apply This Named Command Once itself:

1. **Hold the durable applied command result** — collection `domain_command_executions`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`). **No** `minimize: false`. Unused `toJSON` / `toObject` `{ virtuals: true }`. **No** `autoIndex: false`. **No** `versionKey: false` (default `__v`). **No** hooks. **No** `immutable`. Default ObjectId `_id`. Required `origin` enum `COMMAND_ORIGINS` (`external_sheet_ingestion` | `vantage_admin` | `granot_lifecycle` | `ringcentral`). Required trimmed `idempotency_key`. Required trimmed `command_id`. Required trimmed `command_name`. Required trimmed `payload_checksum`. Required Mixed `actor` / `initiator` / `provenance`. Optional nested `result` `{ status enum ["applied"], entity_refs[], warnings[] }` `{ _id: false }`. Required top-level `entity_refs` / `warnings` default `[]`. Required `applied_at` Date. `DomainCommandExecutionDocument` is `InferSchemaType` plus `_id`. This beat does **not** lowercase the checksum. This beat does **not** open a transaction. This beat does **not** call `operation`.

2. **Remember which origin-plus-key and which command id this is — and derive applied from nested or legacy top-level** — unique `{ origin, idempotency_key }` is one identity. Unique `{ command_id }` is the other. There is **no** unique `{ command_name, idempotency_key }` without origin. Nested `result.status` accepts only `"applied"`. `readStoredCanonicalCommandResult` returns `{ status: "applied", entity_refs, warnings }`: if `document.result?.status === "applied"`, copy the nested arrays; otherwise copy the top-level arrays. A nested applied result **wins** over leftover top-level columns. A document with `result` whose status is missing or not `"applied"` falls through to top-level. The function does **not** `$set` `result`. The function does **not** return `already_applied`. This beat does **not** compare command name or checksum (already-recommended `findExisting` does that next door). This beat does **not** unique `applied_at`.

3. **Stamp the named clocks and bind the default-connection model** — `DOMAIN_COMMAND_EXECUTION_INDEXES` declares four named clocks: `domain_command_origin` `{ origin: 1 }`, unique `domain_command_command_id_unique` `{ command_id: 1 }`, unique `domain_command_origin_idempotency_unique` `{ origin: 1, idempotency_key: 1 }`, `domain_command_applied_at` `{ applied_at: -1 }`. The schema loop stamps them. `DOMAIN_COMMAND_EXECUTION_COLLECTION` is `"domain_command_executions"`. Default export `DomainCommandExecution` is `mongoose.models.DomainCommandExecution ?? mongoose.model(...)`. There is **no** `getDomainCommandExecutionModel`. There is **no** `createDomainCommandExecution`. Persist asks that default after `connectMongo()`. Boot creates the four named clocks. Leftover `pnpm migration:granot-lifecycle:indexes` **also** applies non-unique first, then the two unique keys after collision inventory. This beat does **not** `useDb`. This beat does **not** invent a selected-database getter from this rename. This beat does **not** flip `autoIndex: false` so “boot matches the Change.”

There is no apply operation. `executeIdempotentCanonicalCommand` elects replay / conflict / persist next door. There is no finalize operation. `executeCanonicalCommandWithPostCommit` runs sheets after a first successful apply next door. There is no HTTP list. Nobody pages these rows.

## Organization

Keep one file. This is the screenplay for “remember the durable applied command result on the default Mongo connection — unique origin plus idempotency key and unique command id, nested applied result plus compatibility top-level refs, legacy rows derive without rewrite, named clocks boot and migration both apply, default-connection model only — never apply or replay here, never store already-applied, never finalize sheets, never add a selected-database getter from this rename.” Apply-once already lives in already-recommended `domainCommands/idempotency.ts`. Who may speak already lives in already-recommended `commandContext.ts`. Compatibility `already_applied` already lives on already-recommended sibling `types.ts`. Append-only Change already lives in already-recommended `EntityChange.ts`. Sheet Sync finalize already lives on already-recommended `sheetSync`. Leftover next Best Relocation connection already lives in a sibling **module**. Already-recommended public throttle / SMS capacity / Sheets minute budget / Owner case already live in sibling **modules**. Do not pull those in. Do not invent a `DomainCommandExecutionService` class. Do not invent a begin / complete Domain Command **seam** on this file. Do not invent a selected-database **adapter** beside today’s default export so “this matches the Change” without a paired persist selected-database proof. Do not invent an `autoIndex: false` **adapter** so “boot matches the Change” without a paired proof that persist still sees uniqueness. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `replay.ts` / `result.ts` each get a file.

Do not move `executeIdempotentCanonicalCommand` into this file so “the model applies the command.” Do not move `toCompatibilityCanonicalCommandResult` into this file so “stored status can be already_applied.” Do not move `persistEntityChangeMutations` into this file so “one row owns the Command and the Change.” Do not merge this file into already-recommended `EntityChange.ts` so “one collection owns apply and the mutation evidence.” Do not merge this file into leftover next `ExternalDataConnection.ts` so “one row owns the Command and the Best Relocation workbook.” Do not merge this file into already-recommended `PublicSubmissionThrottleBucket.ts` so “one bag owns throttle and the Command.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `DomainCommandExecution` | `durableAppliedCommandResultOnTheDefaultConnection` | persist, after-commit reload, Best Relocation ownership, model tests, and replica counts **ask** the first-registered connection |
| `readStoredCanonicalCommandResult` | `deriveTheStoredAppliedResult` | nested `result.status === "applied"` wins; legacy top-level refs/warnings still read as applied; never rewrite |
| `DOMAIN_COMMAND_EXECUTION_COLLECTION` | `theDurableCommandResultCollectionName` | leftover migration hops the string `domain_command_executions` (lib also re-declares this literal) |
| `DOMAIN_COMMAND_EXECUTION_INDEXES` | `theNamedDurableCommandResultClocks` | leftover migration applies non-unique first, then unique `command_id` and `{ origin, idempotency_key }` |
| `DomainCommandExecutionDocument` | `ThisDurableAppliedCommandResult` | inferred row + `_id` |

Keep the old names as one-line aliases until already-recommended persist, leftover Granot reload / ownership, leftover migration, and model tests migrate. Do not make callers learn `idempotency_key` / `result.status` as the only domain language until those sites move. Do **not** add `getDomainCommandExecutionModel` so “this matches the Change” without a paired proof that persist still writes the selected database. Do **not** add `createDomainCommandExecution` so “SMS save matches the Command.” Do **not** re-export `executeIdempotentCanonicalCommand` / `toCompatibilityCanonicalCommandResult` from this file so “the model applies or stores already_applied.” Do **not** drop `readStoredCanonicalCommandResult` so “every caller reads nested only” — legacy rows without `result` still exist.

**No class for the workflow.** The one type that *does* earn a name is the durable applied-command identity contract:

```ts
type DurableAppliedCommandResultIdentity = {
  collection: "domain_command_executions"
  unique_origin_plus_idempotency_key: true
  unique_command_id: true
  stored_status_always_applied: true
  stores_already_applied: false
  nested_result_plus_top_level_compatibility: true
  legacy_without_result_derives: true
  legacy_rows_rewritten: false
  origins: ["external_sheet_ingestion", "vantage_admin", "granot_lifecycle", "ringcentral"]
  browser_extension_is_not_an_origin: true
  timestamps: { createdAt: true, updatedAt: true }
  applied_at_required: true
  versionKey: true
  object_id: true
  persist_preallocates_id: true
  command_id_is_string: true
  selected_database_getter: false
  save_through_default: true
  autoIndex: true
  named_index_catalog: true
  boot_creates_clocks: true
  migration: "pnpm migration:granot-lifecycle:indexes"
  migration_also_applies: true
  model_test: true
  core_collections_names_this: true
  historical_side_effect: false
  job_timeline_hops_this: false
}
```

That is the handoff from “this process remembered a durable applied command result” to “identity is origin plus idempotency key and also command id, stored status is always applied, legacy rows derive without rewrite, boot and the migration both own the clocks, and there is no selected-database getter.” Do **not** add `{ stores_already_applied: true }` so “replay is visible in Mongo.” Do **not** add `{ selected_database_getter: true }` so “this matches the Change.” Do **not** add `{ autoIndex: false }` so “boot matches the Change.” Do **not** add `{ origins: [..., "browser_extension"] }` so “the Observation Channel is a Command origin.”

Leave already-recommended `domainCommands/idempotency.ts` on that file. Leave already-recommended `EntityChange.ts` on that file. Leave leftover next `ExternalDataConnection.ts` on that file. Leave already-recommended `PublicSubmissionThrottleBucket.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// DomainCommandExecution.ts
// Someone already named the command and already ran or replayed it once.
// Hold one durable applied result on domain_command_executions.
// That row is this origin plus this idempotency key.
// That row is also this command id.
// Store applied. Never store already-applied.
// New rows nest result.status applied and still copy
// entity refs and warnings onto the old top-level columns.
// A legacy row without result still reads as applied.
// Do not rewrite that legacy row.
// There is no selected-database getter.
// Named clocks live on the schema.
// Boot creates them. The reviewed migration also applies them.
// Do not apply the named command.
// Do not replay.
// Do not finalize sheets.

// ── 1. Hold the durable applied command result ────────────

const COMMAND_ORIGINS = [
  "external_sheet_ingestion",
  "vantage_admin",
  "granot_lifecycle",
  "ringcentral",
] as const

const DomainCommandExecutionSchema = new Schema(
  {
    origin: { type: String, required: true, enum: COMMAND_ORIGINS },
    idempotency_key: { type: String, required: true, trim: true },
    command_id: { type: String, required: true, trim: true },
    command_name: { type: String, required: true, trim: true },
    payload_checksum: { type: String, required: true, trim: true },
    actor: { type: Schema.Types.Mixed, required: true },
    initiator: { type: Schema.Types.Mixed, required: true },
    provenance: { type: Schema.Types.Mixed, required: true },
    result: { type: StoredCommandResultSchema, required: false },
    entity_refs: { type: [EntityReferenceSchema], required: true, default: [] },
    warnings: { type: [String], required: true, default: [] },
    applied_at: { type: Date, required: true },
  },
  {
    collection: "domain_command_executions",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// ── 2. Remember which origin-plus-key and which command id this is —
// and derive applied from nested or legacy top-level

export function deriveTheStoredAppliedResult(document) {
  // nested result.status === "applied" wins
  // else copy top-level entity_refs / warnings
  // always return status: "applied"
  // never $set the document
}

// ── 3. Stamp the named clocks and bind the default-connection model

export const theNamedDurableCommandResultClocks = [
  { name: "domain_command_origin", key: { origin: 1 } },
  { name: "domain_command_command_id_unique", key: { command_id: 1 }, unique: true },
  { name: "domain_command_origin_idempotency_unique", key: { origin: 1, idempotency_key: 1 }, unique: true },
  { name: "domain_command_applied_at", key: { applied_at: -1 } },
]

export const durableAppliedCommandResultOnTheDefaultConnection =
  mongoose.models.DomainCommandExecution ??
  mongoose.model("DomainCommandExecution", DomainCommandExecutionSchema)

export {
  durableAppliedCommandResultOnTheDefaultConnection as DomainCommandExecution,
  deriveTheStoredAppliedResult as readStoredCanonicalCommandResult,
}
```

Read the primary path out loud: *A named command already passed the speaker gate. The executor already allocated `now` and an execution `_id`. Inside one Mongo write it looked up this origin plus this idempotency key. No row yet, so the operation ran, then this default-connection model saved one `domain_command_executions` row whose stored status is applied, whose nested result and top-level refs say the same Form Lead, and whose `command_id` is the caller’s string. Unique origin plus key refuses a second apply. Unique `command_id` refuses a second id. A later ask with the same key and the same checksum reads the nested applied result and does not run the operation again. A legacy row that never got a nested `result` still reads as applied from the top-level columns. Sheets finalize next door, after commit, and only on a first apply. Do not store already-applied from here. Do not invent a selected-database getter from here. Do not merge this into the already-recommended Change.*

## Precise logic I would tighten while renaming

1. **This file does not apply and does not replay.** Already-recommended `executeIdempotentCanonicalCommand` refuses a bad speaker, lowercases the checksum, session-reads `(origin, idempotency_key)`, conflicts on name/checksum drift, persists through this default, and treats duplicate-key 11000 as reload-or-conflict. Do not move apply into this file so “the model owns once.” Do not `$set` `result.status` from a post-save hook so “one save owns replay.”

2. **Nested applied plus duplicated top-level refs is load-bearing.** Persist writes `result` **and** copies `entity_refs` / `warnings` to the top-level columns. `readStoredCanonicalCommandResult` prefers nested when `status === "applied"` and otherwise derives. Core Collections already says legacy rows are not rewritten. Do not drop the top-level columns so “one copy is enough” without a paired proof that leftover Best Relocation `$elemMatch` on top-level `entity_refs` still finds the leadless Booking. Do not backfill nested `result` onto legacy rows from this rename.

3. **Stored status is always `applied`.** Sibling `toCompatibilityCanonicalCommandResult` is the one-way HTTP/ingestion adapter that still counts `already_applied` on replay. The schema enum is `["applied"]` only. Do not add `"already_applied"` to `result.status` so “replay is visible in Mongo.” Do not teach `readStoredCanonicalCommandResult` to return `already_applied` when the caller is a replay.

4. **No selected-database getter — unlike already-recommended Change.** Persist, reload, and ownership **ask** default `DomainCommandExecution` after `connectMongo()`. Already-recommended `getEntityChangeModel()` exists because persist and Granot timeline write a selected database. Do not add `getDomainCommandExecutionModel` so “this matches the Change” without a paired persist selected-database proof. Do not delete the default export so “everyone must call a getter that does not exist.”

5. **`autoIndex` stays on — boot creates the four named clocks, and the migration also applies them.** Already-recommended Change sets `autoIndex: false` and lets leftover `pnpm migration:granot-lifecycle:indexes` own apply. This file omits that flag. Do not flip `autoIndex: false` so “boot matches the Change” without a paired proof that uniqueness still exists before the first persist. Do not delete the named catalog so “boot’s unnamed clocks are enough.” Do not call `createIndexes()` from this file so “the model applies itself twice.”

6. **Two clocks: `applied_at` and camelCase timestamps.** Persist copies the executor’s `now` onto required `applied_at`. Mongoose also stamps `createdAt` / `updatedAt`. Already-recommended Change is `timestamps: false` with `applied_at` only. Do not drop `applied_at` so “createdAt is enough” — leftover `domain_command_applied_at` and persist both name `applied_at`. Do not set `timestamps: false` so “this matches the Change.”

7. **`command_id` is a unique string; `_id` is a preallocated ObjectId.** Persist sets `_id: execution_id` from the caller’s ObjectId-hex `command_id` when it is hex; otherwise it mints `_id` and still stores the caller’s `command_id` string. Unique is on the string, not `_id`. Do not unique `_id` only so “Mongo already has uniqueness.” Do not switch persist to let Mongo mint `_id` when the caller sent hex — leftover Granot reload returns `command_execution_id: String(execution._id)` and Change rows store that same ObjectId.

8. **Actor, initiator, and provenance are Mixed.** This file does not validate `source_system`, receipt ids, or RingCentral telephony. Already-recommended `assertCommandContext` already refused a bad speaker. Do not nest a strict provenance schema from this rename so “Mixed becomes a second writer.” Do not require `observation_id` so “every Command has an Observation” — `vantage_admin` and `external_sheet_ingestion` often have none. `browser_extension` is an Observation Channel, not a `CommandOrigin`. Do not add it to `COMMAND_ORIGINS`.

9. **Unused `toJSON` / `toObject` virtuals.** There are no virtuals. Already-recommended Change omits both. Do not add virtuals so “the flags become true.” Do not drop the flags from this rename as a cleanup unless a later pass proves no caller relies on `toJSON()`.

10. **Leftover migration lib re-declares the collection name.** `granot-lifecycle-indexes.lib.ts` exports its own `DOMAIN_COMMAND_EXECUTION_COLLECTION = "domain_command_executions"` and does not import this file’s collection export. It **does** import `DOMAIN_COMMAND_EXECUTION_INDEXES`. Do not delete this file’s collection export so “lib already has the string.” Do not silently merge the two constants from this rename — leftover migration is out of this sitting.

11. **Best Relocation ownership reads top-level `entity_refs`, not nested `result.entity_refs`.** Cancel and attach `$elemMatch` `entity_refs` on the stored document. Persist copies both, so live rows match. A future persist that writes nested only would hide those Bookings. Do not change that query from this file. Do not add a virtual that mirrors nested onto top-level so “one write is enough” without a paired attach/cancel proof.

12. **Job Timeline does not hop this collection.** Already-recommended loader hops raw `entity_changes` and never imports this file. Do not teach the loader to find `domain_command_executions` so “the timeline can show the Command.” Do not add this name to historical `SIDE_EFFECT_COLLECTIONS`.

13. **Core Collections already names this collection.** Do not rewrite that paragraph from this rename. Do not add stored-`already_applied` language there so “replay is a second status.”

14. **Leave sibling modules alone.** Already-recommended `idempotency.ts` / already-recommended `EntityChange.ts` / leftover next `ExternalDataConnection` are already the right **depth**.

## Testing

The interface of this file is the default-connection model, `readStoredCanonicalCommandResult`, `DOMAIN_COMMAND_EXECUTION_COLLECTION`, `DOMAIN_COMMAND_EXECUTION_INDEXES`, the four-origin enum, nested `result.status` enum `["applied"]`, unique `{ origin, idempotency_key }` plus unique `{ command_id }`, omitted selected-database getter, omitted `autoIndex: false`, `timestamps: true` plus required `applied_at`, default `__v`, and the omitted persist helper. `DomainCommandExecution.test.ts` already names AC-21 unique origin+key / named unique `command_id`, AC-32 four origins plus nested applied enum, and AC-21 legacy top-level derive versus nested win.

I would keep a later focused model file on that interface. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.DomainCommandExecution ?? mongoose.model(...)`
- there is **no** `getDomainCommandExecutionModel`
- persist **asks** the default, `new DomainCommandExecution({ _id: execution_id })`, `save({ session })` — **not** `findOneAndUpdate`
- unique `{ origin, idempotency_key }` refuses a second row for the same ask
- unique `{ command_id }` refuses a second id
- `result.status` accepts only `"applied"`
- `readStoredCanonicalCommandResult` on a legacy document without `result` returns `{ status: "applied", entity_refs, warnings }` from the top-level columns
- `readStoredCanonicalCommandResult` on a nested applied result ignores leftover top-level refs/warnings
- `readStoredCanonicalCommandResult` never returns `already_applied` and never writes the document
- leftover migration **asks** `DOMAIN_COMMAND_EXECUTION_INDEXES` and applies non-unique first
- already-recommended persist / leftover Granot reload / leftover Best Relocation ownership **ask** the default export
- already-recommended Job Timeline **does not** hop `domain_command_executions`
- historical apply / verify omit `domain_command_executions`
- `schema-and-crud-inputs.mdc` already names this collection; this pass does not rewrite that paragraph
- leftover next `ExternalDataConnection` is a different collection; that file is out of this story
- already-recommended `EntityChange` is a different collection; that file is out of this story
- already-recommended `PublicSubmissionThrottleBucket` is a different collection; that file is out of this story

I would not test apply-or-replay, checksum conflict, 11000 race, Sheet Sync after commit, leftover Granot confirm, or leftover Best Relocation cancel from this file.

Do not add a test per helper (`nestedAppliedWins`, `legacyTopLevelDerives`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `DomainCommandExecutionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `invalidate`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `replay.ts` / `result.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (already-recommended persist stays inside `operation({ session })` then this `save({ session })`; Sheet Sync finalize stays after a successful **non-replay** commit; this file only holds the applied row and derives it).
- Treating `executeIdempotentCanonicalCommand` / `toCompatibilityCanonicalCommandResult` / already-recommended `persistEntityChangeMutations` / leftover next `ExternalDataConnection` / already-recommended public throttle as this story.
- Inventing a selected-database seam that has only “the Change has a getter” as an adapter.
- Inventing an `already_applied` seam that has only the compatibility adapter as a stored status.
- Silently storing `already_applied`, adding a getter, flipping `autoIndex: false`, dropping top-level `entity_refs`, backfilling nested `result`, adding `browser_extension` to `COMMAND_ORIGINS`, teaching Job Timeline to hop this collection, adding `domain_command_executions` to historical `SIDE_EFFECT_COLLECTIONS`, or rewriting Core Collections while recommending a rename.
- Pulling `executeIdempotentCanonicalCommand` or `readStoredCanonicalCommandResult`’s callers into this file.
- Merging this collection into already-recommended `EntityChange`, leftover next `ExternalDataConnection`, already-recommended `PublicSubmissionThrottleBucket`, already-recommended `LeadMessageRateLimit`, already-recommended `SheetSyncQuotaBucket`, already-recommended Owner case, or already-recommended Form / Call / Booking.
- Silently reordering persist-then-commit versus Sheet-Sync-after-commit, or unique-index apply versus collision inventory.
- Changing persist to `findOneAndUpdate` so “a retry can patch the stored result.”
- Dropping the default export or adding a getter in the same PR as the story names.
- Opening `validation/` or leftover next `ExternalDataConnection.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `ExternalDataConnection.ts` while writing this file.
