# Write This Run's Next Status Only While This Owner Still Holds The Fence — Current Status Must Be One We Expected, The Graph Must Allow The Hop, The Cursor Must Only Move Forward, And Leftover Counters Must Only Stay Or Climb — If Mongo Writes Zero Rows, Re-Read And Say Whether The Run Vanished, The Status Moved, Or The Lease Is Gone — Never Claim A Named Scope, Never Pick The Next Best Relocation Action, Never Stamp Started Or Completed Clocks — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 8 of this service — `runTransitions.ts`
- Remaining in this service: `testing.ts`
- Target: `src/services/durableWork/runTransitions.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (Best Relocation worker writes `IngestionRun.status` / `checkpoint` / `failure.class: "structural"` itself — leftover `failRun` + leftover `persistWorkerCheckpoint` + leftover repository hops; knowledge never names `MongoDurableRunStore` / `transition` / `StatusGraph` / `INVALID_RUN_TRANSITION`), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-designed, checksum-bound reports; leftover Stage 4 **asks** leftover `transitionReportingRun` / leftover `checkpointReportingRun` — knowledge never names this store), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (`GranotAutomationRun` stores the immutable plan, approval, lease, checkpoint, and per-action receipts — leftover `runWorkflow.ts` writes status + local `checkpoint(phase, completed)` `version: 1`; knowledge never names this store). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never writes a run status). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; no persist). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (who is speaking; no persist). Distinct from already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md) (proves the cursor / leftover unused CAS; this file **asks** prove-cursor and prove-counters, then builds its **own** filter — does **not** **ask** `buildCheckpointCompareAndSet`). Distinct from already-recommended [durable-work-capability.md](durable-work-capability.md) (unused three-gate AND; no persist). Distinct from already-recommended [durable-work-schema.md](durable-work-schema.md) (mongoose nest; this file **never imports** it). Distinct from already-recommended [durable-work-provider-retry.md](durable-work-provider-retry.md) (classifies a throw; this file does **not** classify). Distinct from later `testing.ts` `InMemoryDurableRunStore` (in-memory **adapter** that **asks** the same graph refuse + the same two proves, then clones — no Mongo filter, no re-read). Distinct from skipped `types.ts` `DurableRunStore` / `RunTransitionInput` / `RunTransitionResult` / `LeaseToken` (this file **implements** the store; it does not name the TypeScript). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) / [ingestion-repository.md](ingestion-repository.md) (claim / fail / stamp clocks on `IngestionRun`). Distinct from already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (account lease, then write status + `version: 1`). Distinct from already-recommended [reporting-run-repository.md](reporting-run-repository.md) (own `STATUS_GRAPH`, single `expectedStatus`, no cursor CAS, stamps `started_at` / `completed_at`, leftover Mixed failure). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Run Store” / “Run Transition” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **one later folder module, and no live worker.** Later `testing.ts` `InMemoryDurableRunStore` **asks** `InvalidRunTransitionError` + `StatusGraph`, then clones the bag. Barrel `durableWork/index.ts` re-exports this file. Folder test `durableWork.test.ts` never constructs `MongoDurableRunStore` — it **asks** later `InMemoryDurableRunStore` once (`queued` → `running`, version 1). `MongoDurableRunStore` itself has **no runtime constructor**. Not this **interface**: leftover `failRun`, leftover `persistWorkerCheckpoint`, leftover `transitionReportingRun`, leftover `checkpointReportingRun`, leftover Granot `checkpoint("collect"|"plan"|"apply"|…)`, leftover `MongoLeaseStore`, leftover `buildCheckpointCompareAndSet`.
- Seams callers need: `DurableRunStore` interface vs this unused Mongo **adapter** vs later in-memory **adapter**; graph refuse (throw) vs soft miss (`applied: false`); in-memory lease prove (`instanceof Date`) vs Mongo fence (`leased_until > now`); this filter (`$or` checkpoint null / missing + counter CAS) vs unused `buildCheckpointCompareAndSet` (`checkpoint.version` `$in [null, 0]`) vs live workers (lease + status only); after a zero-row write, `run_missing` / `status_mismatch` / leftover `lease_lost` (checkpoint and counter misses share that last reason). There is no begin / complete Domain Command **seam**. There is no named-scope **adapter**. There is no per-workflow **adapter**. There is no “stamp the clocks” **adapter**.
- Split later (only if the file outgrows one sitting): this ~139-line file is one sitting if you read it as write this run's next status only while this owner still holds the fence. If it later splits: `writeThisRunsNextStatusOnlyWhileThisOwnerStillHoldsTheFence.ts`, `refuseAHopTheGraphDoesNotAllow.ts` — never `transition.ts` / `update.ts` / `create.ts` / `delete.ts`. Later in-memory fake, leftover Best Relocation fail, leftover Reporting Stage 4, leftover Granot HTTP writes, and unused checkpoint CAS stay siblings / other services.

`MongoDurableRunStore.transition` / `InvalidRunTransitionError` / `StatusGraph` are executor mechanics. The owner question is: *Someone already holds a run and wants to move it to the next status. Load the document. If it is gone, say so. If the status is not one we expected, say so. If the graph does not allow this hop, refuse. If this owner, this epoch, and a Date clock still ahead of now do not hold the fence, say the lease is gone. If a next cursor arrived, prove it only moves forward. If leftover counters arrived, prove they only stay or climb. Then write status — and only then the optional cursor, optional failure, and leftover counters — under a filter that still sees the expected statuses, this owner, this epoch, a clock still ahead of now, the stored cursor version we just read (or no cursor at all), and each leftover counter still at the value we just read (or missing / zero). If Mongo writes one row, the hop applied. If Mongo writes zero rows, load again: gone, status moved, or we call it a lost lease — even when the miss was the cursor or a leftover counter. This file does not claim a named scope. This file does not pick the next Best Relocation action, reporting page, or Granot source. This file does not stamp `started_at` / `completed_at` / `attempt_count`. Live workers write the same columns without asking.*

Who claims the named scope, who picks the next action, who stamps Reporting clocks, and who writes leftover `failRun` already live in other **modules**. Do not pull those in.

## What this file actually does

One “write this run's next status only while this owner still holds the fence” story with three owner operations, not “a transition helper,” and not Claim The Next Best Relocation Run / Advance This Reporting Graph / Collect The Next Granot Source:

1. **Write this run's next status only while this owner still holds the fence** — `MongoDurableRunStore.transition`. `findById(run_id)`. Missing → `{ applied: false, reason: "run_missing" }`. Current `status` not in `expected_statuses` → `status_mismatch`. Graph hop refuse is operation 2. In-memory fence (`lease_owner` / `lease_epoch` / `leased_until instanceof Date` and `> now`) miss → `lease_lost`. Optional next cursor → **ask** already-recommended `assertCheckpointAdvance`. Optional leftover counters → **ask** already-recommended `assertMonotonicCounters`. Then `updateOne`: filter is `_id` + `status: { $in: expected_statuses }` + `lease_owner` / `lease_epoch` + `leased_until > now` + either `"checkpoint.version": current.version` or `$or` checkpoint null / missing + leftover counter CAS (`counters.K` equals the value just read, or `$or` 0 / missing when the key was absent). `$set` is `status`, optional `checkpoint`, optional `failure` (including `null`), and each `counters.K`. `modifiedCount === 1` → `{ applied: true }`. Else operation 3. This beat does **not** `$set` `started_at` / `completed_at` / `attempt_count` / `leased_until`. This beat does **not** **ask** `buildCheckpointCompareAndSet`. This beat does **not** import already-recommended `schema.ts`.

2. **Refuse a hop the graph does not allow** — `InvalidRunTransitionError` (`code: "INVALID_RUN_TRANSITION"`, `name` matches the class). `StatusGraph` is the injected `from → allowed to[]`. Missing `from` key → empty list → refuse. Message is `Run status transition ${from} -> ${to} is not allowed.` This beat **throws**. It does not return `applied: false`. Later `testing.ts` **asks** the same class. Leftover Reporting throws a generic `Error` with a similar sentence and never **asks** this file.

3. **After a missed write, say whether the run vanished, the status moved, or the lease is gone** — the re-read after `modifiedCount !== 1`. Missing → `run_missing`. Latest status not in `expected_statuses` → `status_mismatch`. Else `lease_lost`. There is no `checkpoint_mismatch` / `counter_mismatch` reason. A cursor CAS miss or leftover-counter CAS miss that left status and fence looking fine is **named** `lease_lost`. This beat does **not** compare checkpoint versions on the re-read. This beat does **not** compare leftover counters on the re-read.

There is no fourth mutate operation. `leaseMatches` is the in-memory fence beat of operation 1, not a second story. `MongoDurableRunModel` is the injected `findById` / `updateOne` shape. Re-export through the barrel is convenience for later `testing.ts`, not a live worker.

## Organization

Keep one file. This is the screenplay for “write this run's next status only while this owner still holds the fence.” `DurableRunStore` / `RunTransitionInput` / `RunTransitionResult` / `LeaseToken` already live on skipped `types.ts`. Later in-memory fake already lives on later `testing.ts`. Prove-cursor already lives on already-recommended `checkpoints.ts`. The mongoose nest already lives on already-recommended `schema.ts`. Live worker writes already live on already-recommended ingestion / Granot HTTP / reporting **modules**. Do not pull those in. Do not invent a `DurableRunTransitionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only `queued → running` as an **adapter**. Do not invent a named-scope **seam** beside the run-document fence. Do not invent a CRUD folder so “each hop gets a file.”

Do not move leftover `transitionReportingRun` here so “one graph owns every run.” Do not move leftover `failRun` here so “one persist owns Best Relocation.” Do not move leftover Granot `checkpoint()` here so “one helper owns every cursor.” Do not merge later `InMemoryDurableRunStore` into this file so “one class owns test and prod.” Do not route this filter through already-recommended `buildCheckpointCompareAndSet` so “one CAS owns the run.” Do not split `transition.ts` / `graph.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `MongoDurableRunStore.transition` | `writeThisRunsNextStatusOnlyWhileThisOwnerStillHoldsTheFence` | unused Mongo **adapter**; later fake implements the same interface |
| `InvalidRunTransitionError` | `thisHopIsNotAllowed` | shared refuse; later fake **asks** it; leftover Reporting does not |
| `StatusGraph` | `theAllowedHopsFromEachStatus` | injected allow-list; this file does not own Best Relocation / Reporting / Granot graphs |
| `MongoDurableRunStore` | `MongoDurableRunStore` | the Mongo **adapter** of `DurableRunStore`; keep the class |
| `MongoDurableRunModel` | `theCollectionThisStoreTalksTo` | injected `findById` / `updateOne`; no runtime caller passes a model |

Keep the old names as one-line aliases / the same class methods until later `testing.ts` and tests migrate. Do not make callers learn `$or: [{ checkpoint: null }]` / `modifiedCount === 1` as the domain language. Do **not** rename persisted field names (`status`, `lease_owner`, `lease_epoch`, `leased_until`, `checkpoint.*`, `counters.*`, `failure`) — already-recommended `schema.ts` and the three run models already store those names. Do **not** rename `RunTransitionResult.reason` strings (`status_mismatch`, `lease_lost`, `run_missing`) — later fake returns the same three.

**No workflow class besides the store adapter.** `MongoDurableRunStore` is the Mongo **adapter** of `DurableRunStore`, not a `*Service`. The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type WhetherThisHopApplied =
  | { applied: true }
  | {
      applied: false
      reason: "status_mismatch" | "lease_lost" | "run_missing"
    }
```

That is today’s `RunTransitionResult` — the handoff from “we tried to move the run” to “the caller can stop, reload, or treat the fence as gone.” Do **not** add `checkpoint_mismatch` here so “the unused reason becomes true” without an **interface** proof. Do **not** add `started_at` / `completed_at` here so “Reporting clocks live on the store.” Do **not** add `scope` to the Mongo filter so “the named-scope token owns the run.”

Leave `DurableRunStore` on skipped `types.ts`. Leave later `InMemoryDurableRunStore` on later `testing.ts`. Leave leftover Reporting Stage 4 on already-recommended `reportingRunRepository.ts`. Leave leftover `failRun` / leftover `persistWorkerCheckpoint` on already-recommended `ingestion/worker.ts`. Leave leftover Granot writes on already-recommended `runWorkflow.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// runTransitions.ts
// Someone already holds a run and wants the next status.
// Current status must be one we expected.
// The graph must allow the hop.
// The cursor must only move forward.
// Leftover counters must only stay or climb.
// Write only while this owner, this epoch, and this clock still hold the fence.
// If Mongo writes zero rows, load again:
// the run vanished, the status moved, or we call it a lost lease.
// Do not claim a named scope.
// Do not pick the next action.
// Do not stamp started or completed clocks.

export type theAllowedHopsFromEachStatus<TStatus extends string> = Readonly<
  Record<TStatus, readonly TStatus[]>
>

export class thisHopIsNotAllowed extends Error {
  readonly code = "INVALID_RUN_TRANSITION"
  constructor(from: string, to: string) {
    super(`Run status transition ${from} -> ${to} is not allowed.`)
    this.name = "InvalidRunTransitionError"
  }
}

export class MongoDurableRunStore<TStatus extends string>
  implements DurableRunStore<TStatus>
{
  constructor(
    private readonly model: theCollectionThisStoreTalksTo<TStatus>,
    private readonly graph: theAllowedHopsFromEachStatus<TStatus>,
  ) {}

  // ── 1. Write this run's next status only while this owner still holds the fence

  async writeThisRunsNextStatusOnlyWhileThisOwnerStillHoldsTheFence(
    input: RunTransitionInput<TStatus>,
  ): Promise<WhetherThisHopApplied> {
    const current = await this.model.findById(input.run_id)
    if (!current) return { applied: false, reason: "run_missing" }
    if (!input.expected_statuses.includes(current.status)) {
      return { applied: false, reason: "status_mismatch" }
    }
    if (!(this.graph[current.status] ?? []).includes(input.next_status)) {
      throw new thisHopIsNotAllowed(current.status, input.next_status)
    }
    if (!proveThisOwnerStillHoldsThisRunsFence(current, input)) {
      return { applied: false, reason: "lease_lost" }
    }
    if (input.checkpoint) {
      assertCheckpointAdvance(current.checkpoint, input.checkpoint)
    }
    if (input.counters) {
      assertMonotonicCounters(current.counters ?? {}, input.counters)
    }

    const result = await this.model.updateOne(
      filterThatStillSeesThisStatusThisFenceThisCursorAndTheseCounters(current, input),
      {
        $set: {
          status: input.next_status,
          ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
          ...(input.failure !== undefined ? { failure: input.failure } : {}),
          ...Object.fromEntries(
            Object.entries(input.counters ?? {}).map(([key, value]) => [
              `counters.${key}`,
              value,
            ]),
          ),
        },
      },
    )
    if (result.modifiedCount === 1) return { applied: true }

    // ── 3. After a missed write, say whether the run vanished, the status moved, or the lease is gone
    return sayWhetherTheRunVanishedTheStatusMovedOrTheLeaseIsGone(this.model, input)
  }

  async transition(input: RunTransitionInput<TStatus>) {
    return this.writeThisRunsNextStatusOnlyWhileThisOwnerStillHoldsTheFence(input)
  }
}

function proveThisOwnerStillHoldsThisRunsFence(current, input) {
  // owner + epoch match
  // leased_until must be a Date (string clocks fail here)
  // that Date must be ahead of now
}

function filterThatStillSeesThisStatusThisFenceThisCursorAndTheseCounters(current, input) {
  // _id + status $in expected
  // lease_owner / lease_epoch / leased_until > now
  // checkpoint.version = current.version
  //   or $or checkpoint null / missing
  // each leftover counter equals the value just read
  //   or $or 0 / missing when the key was absent
}

async function sayWhetherTheRunVanishedTheStatusMovedOrTheLeaseIsGone(model, input) {
  const latest = await model.findById(input.run_id)
  if (!latest) return { applied: false, reason: "run_missing" }
  if (!input.expected_statuses.includes(latest.status)) {
    return { applied: false, reason: "status_mismatch" }
  }
  return { applied: false, reason: "lease_lost" }
}

export const InvalidRunTransitionError = thisHopIsNotAllowed
export type StatusGraph<TStatus extends string> = theAllowedHopsFromEachStatus<TStatus>
```

Read the unused Mongo path out loud: *Load the run. If it is gone, say so. If the status is not one we expected, say so. If the graph does not allow this hop, refuse. If this owner’s Date clock is not still ahead of now, say the lease is gone. Prove the next cursor only moves forward. Prove leftover counters only stay or climb. Write status under a filter that still sees those expected statuses, this fence, the cursor we just read (or no cursor), and each leftover counter we just read. One modified row means the hop applied. Zero rows means load again — vanished, status moved, or we call it a lost lease even when the miss was the cursor. This file never claims `sheet-sync:drain`. This file never picks `cursor.action_index`. This file never stamps Reporting `started_at`. Live Best Relocation, Reporting, and Granot HTTP workers write the same columns without walking through here.*

That is the operation. `transition` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`MongoDurableRunStore` has no runtime constructor.** Already-recommended leftover `failRun` filters live ingest statuses and `$set`s `failed` + `completed_at` + `failure.class: "structural"`. Already-recommended leftover `persistWorkerCheckpoint` renews the named-scope lease, then `$set`s `checkpoint.version = action_index` under `status: "applying"` with no cursor CAS. Already-recommended leftover `transitionReportingRun` has its own `STATUS_GRAPH`, a single `expectedStatus`, no cursor / leftover-counter CAS, leftover `assertSafeReportingFailure`, `queued → querying` `started_at`, and terminal `completed_at`. Already-recommended leftover Granot `runWorkflow.ts` writes status + `checkpoint(phase, completed)` `version: 1`. Do not silently wrap those writes with this store so “the unused adapter becomes true” — Granot’s second collect/plan/apply stamp would throw already-recommended `NonMonotonicCheckpointError`; Reporting would lose clock stamps and the Mixed-failure assert; Best Relocation would lose `completed_at` and the named-scope renew. Leave leftover workers where they are.

2. **After a missed write, a cursor or leftover-counter CAS miss is named `lease_lost`.** Operation 3 only re-checks existence and `expected_statuses`. A second writer who advanced `checkpoint.version` and left status + fence alone still returns `lease_lost`. Do not silently add `checkpoint_mismatch` so “the unused reason becomes true” without an **interface** proof that later fake still returns only three reasons. Do not silently treat every miss as `status_mismatch` so “the lie goes away.”

3. **The in-memory fence requires `instanceof Date`; the Mongo filter does not.** `proveThisOwnerStillHoldsThisRunsFence` refuses a string / number clock before `updateOne`. Mongo `$gt` would accept a BSON Date the driver already cast. A `findById` that returns an ISO string fails closed as `lease_lost` and never writes. Do not silently drop the `instanceof` check so “the two fences match” without an **interface** proof. Do not silently cast in `findById` so “the unused store becomes true.”

4. **This filter disagrees with unused `buildCheckpointCompareAndSet`.** Already-recommended leftover builder treats a null current as `"checkpoint.version": { $in: [null, 0] }` and only `$set`s `checkpoint`. This persist treats a missing cursor as `$or` null / missing, includes status + leftover-counter CAS, and `$set`s the whole hop. A stored version `0` would match the unused builder and miss this persist. Do not silently route this write through that builder so “one CAS owns the run.” Do not delete the unused builder so “nothing imports it.” Leave that on already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md).

5. **This persist never stamps the clocks the nest already declares.** Already-recommended `durableRunControlFields` hands `started_at` / `last_attempt_at` / `completed_at` / `attempt_count`. Leftover Reporting stamps `started_at` on `queued → querying` and `completed_at` on terminal. Leftover `failRun` stamps `completed_at`. This `$set` never touches those keys. Do not silently add clock stamps so “the nest wins” — a later constructor would start writing clocks Best Relocation already writes itself.

6. **`LeaseToken.scope` is unused.** The fence is run-document `lease_owner` / `lease_epoch` / `leased_until`. Already-recommended `MongoLeaseStore` fences a named-scope row. Do not add `scope` to this filter so “one token owns both fences.” Do not start claiming `ingestion:best_relocation:apply` here so “persist owns the seat.”

7. **`_id: input.run_id` is a string; leftover Reporting casts `ObjectId`.** Leftover Stage 4 uses `ReportingRun.collection.updateOne` because mongoose hooks throw on an existing-row `updateOne`. This injected model is a bare `findById` / `updateOne`. Do not silently wrap leftover `ReportingRun` so “one store owns Stage 4” — the hooks would refuse the write, and a string `_id` can miss the native collection.

8. **The folder test never asks this file.** One later-fake `queued` → `running` stamp is not this **interface**. `MongoDurableRunStore` is never constructed. Graph refuse, `run_missing`, `status_mismatch`, `instanceof Date` miss, leftover-counter CAS, and the re-read lie are unproven. Add **interface** proofs of this file; do not treat the one fake transition as this **interface**.

9. **Leave sibling modules alone.** Skipped `types.ts` owns the interface. Later `testing.ts` owns the in-memory **adapter**. Already-recommended `checkpoints.ts` owns prove-cursor. Already-recommended `schema.ts` owns the nest. Already-recommended leftover workers own which status to name. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `writeThisRunsNextStatusOnlyWhileThisOwnerStillHoldsTheFence`, `thisHopIsNotAllowed`, and `theAllowedHopsFromEachStatus`.

Today’s folder test never constructs `MongoDurableRunStore`. One later-fake `queued` → `running` stamp is not this **interface**.

Add tests that name the operation:

**Write this run's next status only while this owner still holds the fence**
- Seeded run, expected status, allowed hop, live Date fence, first cursor version 1 → `{ applied: true }` and `$set` status + checkpoint.
- Missing `findById` → `{ applied: false, reason: "run_missing" }` and no `updateOne`.
- Current status not in `expected_statuses` → `status_mismatch` and no `updateOne`.
- Owner / epoch mismatch, or `leased_until` not a Date, or Date `<= now` → `lease_lost` and no `updateOne`.
- Next cursor that does not climb → already-recommended `NonMonotonicCheckpointError` and no `updateOne`.
- Leftover counter that shrinks → the same refuse and no `updateOne`.
- `updateOne` filter still names `status: { $in: expected_statuses }`, this owner / epoch, `leased_until > now`, and either `checkpoint.version` or `$or` null / missing.
- A leftover counter that already exists compares equal to the value just read. A missing key compares `$or` 0 / missing.
- `modifiedCount === 1` → `{ applied: true }`.
- The `$set` does **not** name `started_at`, `completed_at`, `attempt_count`, or `leased_until`.
- `input.failure === null` `$set`s `failure: null`. `undefined` leaves `failure` off the `$set`.
- The function does **not** import leftover `IngestionRun` / `ReportingRun` / `GranotAutomationRun`. A test that constructs those models is testing past this **interface**.

**Refuse a hop the graph does not allow**
- `queued → completed` when the graph only allows `queued → running` throws `thisHopIsNotAllowed` / `INVALID_RUN_TRANSITION` and does not write.
- A `from` status missing from the graph is an empty list and also throws.
- Leftover Reporting’s generic `Error` is **not** this class. Do not silently construct leftover `transitionReportingRun` in this test so “one refuse owns both graphs.”

**After a missed write, say whether the run vanished, the status moved, or the lease is gone**
- `modifiedCount !== 1` then missing re-read → `run_missing`.
- Re-read status no longer in `expected_statuses` → `status_mismatch`.
- Re-read still expected, fence still looking fine → `lease_lost` (today’s leftover lie when the miss was cursor / leftover-counter CAS). Prove the current three reasons. Do not silently add a fourth reason in the test so “the unused name becomes true.”

**Out of scope for this interface**
- This file does not import leftover `IngestionRun` / `ReportingRun` / `GranotAutomationRun` / `SheetSyncLease`.
- This file does not **ask** `MongoLeaseStore.acquire`.
- This file does not **ask** `buildCheckpointCompareAndSet`.
- This file does not **ask** `classifyGoogleFailure`.
- This file does not write leftover `INGESTION_WORKER_FAILED` or leftover `reportingFailure`.
- This file does not stamp leftover Reporting `started_at`.

Do **not** add a test per `$or` branch constant. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The class and the refuse stay exported because unused Mongo **adapter** vs later in-memory **adapter**, and throw vs soft miss, are the **interface**, not a test leak. There is no third **adapter** until a live worker constructs `MongoDurableRunStore`.

## What I would not do

- A `DurableRunTransitionService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the same `updateOne`.
- Moving this into a CRUD folder (`transition.ts` / `update.ts` / `create.ts`) for cleanliness.
- Breaking the graph-refuse **seam**. An illegal hop throws. A lost fence returns `applied: false`. Do not silently turn the throw into `status_mismatch`.
- Treating leftover `failRun`, leftover `persistWorkerCheckpoint`, leftover `transitionReportingRun`, leftover `checkpointReportingRun`, leftover Granot `checkpoint()`, leftover `MongoLeaseStore`, or later `InMemoryDurableRunStore` as this story.
- Inventing a per-workflow **seam** that has only `queued → running` as an **adapter**.
- Silently wrapping leftover workers with this store, silently routing the filter through `buildCheckpointCompareAndSet`, silently adding `started_at` / `completed_at`, silently adding `checkpoint_mismatch`, or silently dropping the `instanceof Date` check.
- Jumping to `testing.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
