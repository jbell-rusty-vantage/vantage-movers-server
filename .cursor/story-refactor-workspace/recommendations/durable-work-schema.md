# Hand The Nest That Lets A Run Remember Its Fence, Cursor, Clocks, And Failure — And Hand The Four Columns That Let A Named Scope Remember Its Fence — Never Persist, Never Claim A Run, Never Write The Worker Bag — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 6 of this service — `schema.ts`
- Remaining in this service: `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/schema.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (`IngestionRun` spreads this nest; the worker writes `checkpoint` / `attempt_count` / `failure` itself and never **asks** this file to persist), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (`GranotAutomationRun` stores the immutable plan, approval, lease, checkpoint, and per-action receipts — knowledge never names `durableRunControlFields`), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (source read-through under the active lease owner/epoch; leftover Stage 4 repository writes a **closed** failure envelope, not this typed `class` / `phase` nest), [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (`sheet_sync_leases` unique `scope`; Wave B `SheetSyncLease` **copies** the four fence columns and never **asks** `fencedLeaseFields`). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope store; **asks** an injected model — never builds these fields). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; no nest). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (names who is speaking; no nest). Distinct from already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md) (proves a cursor; does **not** declare `checkpoint`). Distinct from already-recommended [durable-work-capability.md](durable-work-capability.md) (unused three-gate AND; no capability field here). Distinct from later `providerRetry.ts` (`ProviderFailureClass` is Google / checksum, **not** `structural | row | provider | lease | cancelled`). Distinct from later `runTransitions.ts` (status graph + persist under the lease; **asks** prove-cursor, **does not import** this file). Distinct from later `testing.ts` (in-memory fake; no mongoose). Distinct from skipped `types.ts` `DurableRunControl` / `DurableCheckpoint` / `StructuredRunFailure` / `LeaseToken` (this file **declares** those columns; it does not name the TypeScript). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) / [ingestion-repository.md](ingestion-repository.md) (claim / fail / stamp clocks on `IngestionRun`). Distinct from already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (account lease, then write `failure.class` `provider` or `structural`). Distinct from already-recommended [reporting-run-repository.md](reporting-run-repository.md) (strips this `failure` nest; Mixed + leftover `reportingFailure`). Distinct from leftover Wave B `src/models/IngestionRun.ts` / `ReportingRun.ts` / `GranotAutomationRun.ts` / `SheetSyncLease.ts` (the three spreads + the unused copy). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Run Control” / “Fenced Lease Fields” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **three Wave B run models, and no named-scope model.** Leftover `IngestionRun` spreads `...durableRunControlFields()` next to its own typed `counters`. Leftover `GranotAutomationRun` spreads the same nest next to Mixed `counters`. Leftover `ReportingRun` **asks** the export, then `const { failure: _durableFailure, ...reportingRunControlFields } = durableRunControlFields()` and keeps leftover `failure: Schema.Types.Mixed` — the typed nest is thrown away. Barrel `durableWork/index.ts` re-exports this file. Folder test `durableWork.test.ts` never imports these names — it **asks** leftover `SheetSyncLease.schema` for `lease_epoch` and unique `scope`, not `fencedLeaseFields`. `fencedLeaseFields` has **no caller**. Wave B `SheetSyncLease` writes the same four columns by hand. Later `runTransitions.ts` / later `testing.ts` / already-recommended `leases.ts` do **not** import this file. Not this **interface**: leftover `reportingFailure`, leftover `assertSafeReportingFailure`, leftover `persistWorkerCheckpoint`, leftover Granot `checkpoint()`, leftover `MongoLeaseStore`, leftover `MongoDurableRunStore.transition`.
- Seams callers need: shared run nest vs Reporting’s stripped Mixed failure; typed `failure.class` / top-level `phase` vs leftover `{ code, summary, retryable, metadata }`; unused `fencedLeaseFields` vs leftover `SheetSyncLease` copy; mongoose field bag vs later persist that never **asks** this file. There is no begin / complete Domain Command **seam**. There is no Mongo **adapter**. There is no per-workflow **adapter**. There is no “write the worker bag” **adapter**.
- Split later (only if the file outgrows one sitting): this ~60-line file is one sitting if you read it as hand the nest that lets a run remember its fence, cursor, clocks, and failure. If it later splits: `handTheNestThatLetsARunRememberItsFenceCursorClocksAndFailure.ts`, `handTheFourColumnsThatLetANamedScopeRememberItsFence.ts` — never `fields.ts` / `create.ts` / `update.ts` / `delete.ts`. Later persist, already-recommended lease store, leftover Reporting safe envelope, and leftover Sheet Sync copy stay siblings / other services.

`durableRunControlFields` / `fencedLeaseFields` are executor mechanics. The owner question is: *Three run collections need the same columns so a worker can hold the document, remember how far it got, count attempts, stamp when it started and finished, and name why it failed. Hand those mongoose fields — owner, clock, epoch, cursor nest, attempt counters, start / last-attempt / completed clocks, and a typed failure nest. A named-scope lease collection needs only the four fence columns — unique scope, owner, clock, epoch — without a cursor or a failure. Hand those too. This file does not persist. This file does not claim a run. This file does not write a cursor. Reporting throws away the typed failure nest and keeps Mixed, because its closed envelope has `metadata` instead of `class` and a top-level `phase`. Sheet Sync copies the four fence columns itself and never asks.*

Who claims the run, who proves the cursor, who writes a closed Reporting sentence, and who holds `sheet-sync:drain` already live in other **modules**. Do not pull those in.

## What this file actually does

One “hand the nest that lets a run remember its fence, cursor, clocks, and failure” story with two owner operations, not “a schema helper,” and not Claim The Next Best Relocation Run / Persist This Reporting Failure / Hold This Named Scope Until The Clock:

1. **Hand the nest that lets a run remember its fence, cursor, clocks, and failure** — `durableRunControlFields`. Return the mongoose field bag: `lease_owner` (indexed, default null), `leased_until` (indexed, default null), `lease_epoch` (required, default 0, min 0), `checkpoint` (nested, `_id: false`, default null: `version` min 1, trimmed `phase`, Mixed `cursor`, `completed_units` min 0, `updated_at`), `attempt_count` (required, default 0, min 0), `last_attempt_at` / `started_at` / `completed_at` (default null), `failure` (nested, `_id: false`, default null: trimmed `code`, `class` enum `structural | row | provider | lease | cancelled`, `retryable`, trimmed `summary`, trimmed `phase`, optional `provider_status`). This beat does **not** persist. This beat does **not** claim. This beat does **not** include `status` or `counters` — those stay on each model.

2. **Hand the four columns that let a named scope remember its fence** — `fencedLeaseFields`. Return `scope` (required, trimmed, unique), `lease_owner` (trimmed, default null), `leased_until` (indexed, default null), `lease_epoch` (required, default 0, min 0). This beat has **no caller today**. Leftover `SheetSyncLease` writes the same four columns by hand and adds a schema-level `{ leased_until: 1 }` index instead of `index: true` on the field. This beat does **not** persist. This beat does **not** construct `MongoLeaseStore`.

There is no third mutate operation. Re-export through the barrel is convenience for the three run models, not a second story.

## Organization

Keep one file. This is the screenplay for “hand the nest that lets a run remember its fence, cursor, clocks, and failure.” `DurableRunControl` / `DurableCheckpoint` / `StructuredRunFailure` already live on skipped `types.ts`. Later persist already lives on later `runTransitions.ts`. Already-recommended `leases.ts` already **asks** an injected model. Leftover Reporting’s closed envelope already lives on already-recommended `reporting-run-repository.md`. Leftover Sheet Sync’s copy already lives on leftover Wave B `SheetSyncLease`. Do not pull those in. Do not invent a `DurableSchemaService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only `IngestionRun` as an **adapter**. Do not invent a Mongo **seam** beside a returned field bag. Do not invent a CRUD folder so “each nest gets a file.”

Do not move leftover `ReportingRun` Mixed `failure` here so “one nest owns every envelope.” Do not move leftover `SheetSyncLease` here so “one helper owns the collection.” Do not move later `transition` here so “declare and persist share a file.” Do not add `effective_enabled` so “the run owns the gate.” Do not split `fields.ts` / `lease.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `durableRunControlFields` | `handTheNestThatLetsARunRememberItsFenceCursorClocksAndFailure` | leftover `IngestionRun` / `GranotAutomationRun` spread; leftover `ReportingRun` spreads then strips `failure` |
| `fencedLeaseFields` | `handTheFourColumnsThatLetANamedScopeRememberItsFence` | unused; leftover `SheetSyncLease` is the copy |

Keep the old names as one-line aliases until the three run models — and a later named-scope caller, if any — migrate. Do not make callers learn `new Schema({…}, { _id: false })` / `enum: ["structural", …]` as the domain language. Do **not** rename persisted field names (`lease_owner`, `leased_until`, `lease_epoch`, `checkpoint.*`, `attempt_count`, `last_attempt_at`, `started_at`, `completed_at`, `failure.*`, `scope`) — the three run models and leftover `SheetSyncLease` already store those names.

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type HowThisRunRemembersItsFenceAndHowFarItGot = {
  lease_owner: string | null
  leased_until: Date | null
  lease_epoch: number
  checkpoint: {
    version: number
    phase: string
    cursor: Record<string, string | number | boolean | null>
    completed_units: number
    updated_at: Date
  } | null
  attempt_count: number
  last_attempt_at: Date | null
  started_at: Date | null
  completed_at: Date | null
  failure: {
    code: string
    class: "structural" | "row" | "provider" | "lease" | "cancelled"
    retryable: boolean
    summary: string
    phase: string
    provider_status?: number
  } | null
}
```

That is today’s `DurableRunControl` — the handoff from “three collections share a nest” to “mongoose can store it.” Do **not** add `status` here so “this file owns the graph.” Do **not** add `counters` here so “Best Relocation owns the nest.” Do **not** add `effective_enabled` here so “the unused AND finds a home.”

Leave `DurableRunControl` on skipped `types.ts`. Leave persist on later `runTransitions.ts`. Leave leftover Reporting Mixed + leftover `reportingFailure` on already-recommended `reportingRunRepository.ts`. Leave leftover `SheetSyncLease` on Wave B.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// schema.ts
// Three run collections need the same columns so a worker can
// hold the document, remember how far it got, count attempts,
// and name why it failed. Hand those mongoose fields.
// A named-scope lease collection needs only the four fence columns.
// Do not persist. Do not claim a run. Do not write the worker bag.

// ── 1. Hand the nest that lets a run remember its fence, cursor, clocks, and failure

export function handTheNestThatLetsARunRememberItsFenceCursorClocksAndFailure() {
  return {
    lease_owner: { type: String, default: null, index: true },
    leased_until: { type: Date, default: null, index: true },
    lease_epoch: { type: Number, required: true, default: 0, min: 0 },
    checkpoint: {
      type: new Schema(
        {
          version: { type: Number, required: true, min: 1 },
          phase: { type: String, required: true, trim: true },
          cursor: { type: Schema.Types.Mixed, required: true },
          completed_units: { type: Number, required: true, min: 0 },
          updated_at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    attempt_count: { type: Number, required: true, default: 0, min: 0 },
    last_attempt_at: { type: Date, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    failure: {
      type: new Schema(
        {
          code: { type: String, required: true, trim: true },
          class: {
            type: String,
            required: true,
            enum: ["structural", "row", "provider", "lease", "cancelled"],
          },
          retryable: { type: Boolean, required: true },
          summary: { type: String, required: true, trim: true },
          phase: { type: String, required: true, trim: true },
          provider_status: { type: Number },
        },
        { _id: false },
      ),
      default: null,
    },
  } as const
}

// ── 2. Hand the four columns that let a named scope remember its fence

export function handTheFourColumnsThatLetANamedScopeRememberItsFence() {
  return {
    scope: { type: String, required: true, trim: true, unique: true },
    lease_owner: { type: String, default: null, trim: true },
    leased_until: { type: Date, default: null, index: true },
    lease_epoch: { type: Number, required: true, default: 0, min: 0 },
  } as const
}

export const durableRunControlFields =
  handTheNestThatLetsARunRememberItsFenceCursorClocksAndFailure
export const fencedLeaseFields =
  handTheFourColumnsThatLetANamedScopeRememberItsFence
```

Read the primary path out loud: *Best Relocation, Granot HTTP, and Reporting each store a run. They need the same columns so a worker can hold that document, remember the cursor, count attempts, and name a failure. Hand those mongoose fields. A named-scope lease needs only scope, owner, clock, and epoch. Hand those too. This file never writes Mongo. Reporting throws away the typed failure nest because its closed sentence is `{ code, summary, retryable, metadata }` — no `class`, no top-level `phase`. Sheet Sync copies the four fence columns onto `sheet_sync_leases` and never asks. Later persist builds its own filter and never imports this file.*

That is the operation. `durableRunControlFields` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Reporting strips the typed failure nest on purpose.** Leftover `ReportingRun` destructures `failure` out and stores leftover `Schema.Types.Mixed`. Leftover `reportingFailure` writes `{ code, summary, retryable, metadata }` — extra keys throw, `summary` / `retryable` are catalog-fixed, `phase` lives under `metadata` and may only be `querying | writing | verifying | promoting`. This nest **requires** `class` and a top-level `phase`. If Reporting spread the nest as-is, mongoose would refuse the closed envelope it actually persists. Do not silently stop the strip so “one nest owns every run” — leftover Stage 4 would start throwing. Do not silently add `class` onto leftover `reportingFailure` so “the unused enum finds a home.” Do not silently relax this nest’s required `class` so “Mixed can live here.”

2. **`fencedLeaseFields` has no caller; leftover `SheetSyncLease` is a copy.** Same four columns. Leftover model puts unique on `scope` the same way, but indexes `leased_until` at schema level and does not set `index: true` on `lease_owner`. Folder test **asks** leftover `SheetSyncLease.schema`, not this export. Do not silently switch leftover `SheetSyncLease` onto this helper in the same pass without an **interface** proof of the unique-scope + epoch indexes. Do not delete the unused export so “nothing imports it.”

3. **`checkpoint.cursor` is Mixed here and a primitive record on skipped `types.ts`.** This file accepts any JSON. Skipped `DurableCheckpoint.cursor` is `Record<string, string | number | boolean | null>`. Already-recommended Best Relocation writes `cursor.action_index`. Leftover reporting maps `ReportingStreamCheckpointV1` onto this shape. Do not silently narrow Mixed to that record so “the type wins” — a later worker bag with a nested object would fail schema. Do not silently widen the TypeScript so “Mixed wins” in this pass without an **interface** proof.

4. **This nest does not own `status` or `counters`.** Leftover `IngestionRun` has its own status enum and typed `CounterSchema`. Leftover `GranotAutomationRun` has Mixed `counters`. Leftover `ReportingRun` has Mixed `counters` plus leftover delivery-fence columns. Later `runTransitions.ts` `$set`s `status`, `checkpoint`, `failure`, and `counters.*` — it never imports this file. Do not add `status` here so “one graph owns every run.” Do not add `counters` here so “one bag owns Best Relocation counts.”

5. **Later persist never asks this file; live workers write the columns themselves.** Already-recommended leftover `ingestion/repository.ts` `$inc`s `attempt_count` and stamps `started_at` / `last_attempt_at` / `completed_at`. Already-recommended leftover `ingestion/worker.ts` writes `failure.class: "structural"`. Already-recommended leftover Granot `runWorkflow.ts` writes `class: "provider"` (retry queued, `attempt_count < 3`) or `class: "structural"`. Leftover reporting repository writes leftover `reportingFailure`. Do not silently wrap those writes with later `MongoDurableRunStore` so “the unused store becomes true.” Leave later persist for the later pass.

6. **`failure.class` is not later `ProviderFailureClass`.** This enum is `structural | row | provider | lease | cancelled`. Later `providerRetry.ts` classifies Google / checksum into `retryable_rate_limit | retryable_transient | authentication | authorization | not_found | invalid_request | structural | unknown`. Do not silently merge the two lists so “one class owns every refuse.” Leave later `providerRetry.ts` for the later pass.

7. **The folder test never asks this file.** The unique-scope / `lease_epoch` proof walks leftover `SheetSyncLease`, not `fencedLeaseFields`. There is no proof that leftover `IngestionRun` / `GranotAutomationRun` still have the typed `failure` nest, or that leftover `ReportingRun` still dropped it. Add **interface** proofs of this file; do not treat the leftover Sheet Sync index test as this **interface**.

8. **Leave sibling modules alone.** Skipped `types.ts` owns the TypeScript. Later `runTransitions.ts` owns persist. Already-recommended leftover `leases.ts` owns the named-scope store. Already-recommended leftover `reportingRunRepository.ts` owns the closed envelope. Leftover Wave B models own the spreads. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `handTheNestThatLetsARunRememberItsFenceCursorClocksAndFailure` and `handTheFourColumnsThatLetANamedScopeRememberItsFence`.

Today’s folder test never **asks** either export. That is not enough for a story that claims three run collections share a nest and a fourth collection copies the fence.

Add tests that name the operation:

**Hand the nest that lets a run remember its fence, cursor, clocks, and failure**
- The bag names `lease_owner`, `leased_until`, `lease_epoch`, `checkpoint`, `attempt_count`, `last_attempt_at`, `started_at`, `completed_at`, `failure`.
- `checkpoint` is a nested schema with `_id: false`, required `version` / `phase` / `cursor` / `completed_units` / `updated_at`, default null.
- `failure` is a nested schema with `_id: false`, required `code` / `class` / `retryable` / `summary` / `phase`, optional `provider_status`, `class` enum exactly `structural | row | provider | lease | cancelled`, default null.
- `lease_epoch` and `attempt_count` default 0 and refuse a negative min.
- The bag does **not** name `status`, `counters`, or `effective_enabled`.
- Spreading leftover `IngestionRun` / leftover `GranotAutomationRun` still sees the typed `failure` path.
- Leftover `ReportingRun` still compiles after stripping `failure` — the closed Mixed envelope is **not** this nest. A test that constructs leftover `{ code, summary, retryable, metadata }` against this nested schema is testing past this **interface** unless it is proving the strip is load-bearing.

**Hand the four columns that let a named scope remember its fence**
- The bag names only `scope`, `lease_owner`, `leased_until`, `lease_epoch`.
- `scope` is required and unique. `lease_epoch` defaults 0.
- The bag does **not** name `checkpoint` or `failure`.
- This export still has no runtime caller. Do not silently construct leftover `SheetSyncLease` from it in the test so “the unused helper becomes true.”

**Out of scope for this interface**
- This file does not import leftover `IngestionRun` / `ReportingRun` / `GranotAutomationRun` / `SheetSyncLease`.
- This file does not claim a named-scope lease.
- This file does not **ask** `assertCheckpointAdvance`.
- This file does not write leftover `reportingFailure`.
- This file does not classify a Google 429.

Do **not** add a test per mongoose `index: true`. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The two exports stay exported because shared run nest vs Reporting strip, and unused fence bag vs leftover Sheet Sync copy, are the **interface**, not a test leak. There is no third **adapter** until leftover `SheetSyncLease` **asks** the second export.

## What I would not do

- A `DurableSchemaService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the same field bag.
- Moving this into a CRUD folder (`fields.ts` / `create.ts`) for cleanliness.
- Breaking the Reporting strip **seam**. Leftover Stage 4 persists `{ code, summary, retryable, metadata }`, not this typed `class` / top-level `phase`.
- Treating leftover `reportingFailure`, leftover `MongoLeaseStore`, leftover `persistWorkerCheckpoint`, leftover Granot `checkpoint()`, or later `transition` as this story.
- Inventing a per-workflow **seam** that has only leftover `IngestionRun` as an **adapter**.
- Silently spreading the typed `failure` nest onto leftover `ReportingRun`, silently switching leftover `SheetSyncLease` onto `fencedLeaseFields`, silently adding `status` / `counters` / `effective_enabled` to the nest, or silently merging `failure.class` with later `ProviderFailureClass`.
- Jumping to `providerRetry.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
