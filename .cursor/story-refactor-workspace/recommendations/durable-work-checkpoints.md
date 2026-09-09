# Prove This Cursor Only Moves Forward — Version Must Climb, Completed Units Must Not Shrink, And The Phase Must Be Named; Then Hand The Compare-And-Set That Writes The Next Cursor Only While This Owner Still Holds The Run; Prove Leftover Counters Only Stay Or Climb — Refuse A Blank Phase Or A Non-Positive Version — Never Claim A Run, Never Pick The Next Action, Never Write The Worker Bag — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 4 of this service — `checkpoints.ts`
- Remaining in this service: `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/checkpoints.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (Best Relocation worker writes an `IngestionRun.checkpoint` bag and resumes from `cursor.action_index` / `completed_units` — it never **asks** this file), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (`GranotAutomationRun` stores a checkpoint; the local helper always stamps `version: 1`), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (stream checkpoint is `ReportingStreamCheckpointV1`; leftover `reportingCheckpoint` maps it onto this shape and leftover `checkpointReportingRun` writes under the lease, not this compare-and-set). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never names a cursor). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; never names a cursor). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (names who is speaking; never names a cursor). Distinct from later `runTransitions.ts` (status graph + persist; **asks** prove-cursor and prove-counters; builds its **own** filter — does **not** **ask** `buildCheckpointCompareAndSet`). Distinct from later `schema.ts` `durableRunControlFields` (the persisted nest Wave B `IngestionRun` / `ReportingRun` / `GranotAutomationRun` spread). Distinct from later `testing.ts` `InMemoryDurableRunStore` (the in-memory **adapter** that **asks** this file). Distinct from skipped `types.ts` `DurableCheckpoint` (this file **proves** that shape; it does not name it). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) / [ingestion-apply-plan.md](ingestion-apply-plan.md) (write / resume the worker bag). Distinct from already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (local `checkpoint(phase, completed)`). Distinct from already-recommended [reporting-run-repository.md](reporting-run-repository.md) / [reporting-execution-stream.md](reporting-execution-stream.md) (page stream → mapped nest). Distinct from later `providerRetry.ts` (does **not** classify `NON_MONOTONIC_CHECKPOINT`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Checkpoint” / “Cursor” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **two later folder modules, and no live worker.** Later `runTransitions.ts` `MongoDurableRunStore.transition` **asks** `assertCheckpointAdvance` / `assertMonotonicCounters` after the in-memory lease prove, then builds a different Mongo filter. Later `testing.ts` `InMemoryDurableRunStore.transition` **asks** the same two proves, then clones the bag. Barrel `durableWork/index.ts` re-exports this file. Folder test `durableWork.test.ts` never imports these names — it **asks** the in-memory store once (`queued` → `running`, version 1). `MongoDurableRunStore` itself has **no runtime constructor**. `buildCheckpointCompareAndSet` has **no caller**. Not this **interface**: `persistWorkerCheckpoint`, Granot `checkpoint("collect"|"plan"|"apply"|…)`, `checkpointReportingRun`, `reportingCheckpoint`, later `transition`.
- Seams callers need: first stamp (`current` missing) vs later advance (`version` must climb, `completed_units` must not shrink); prove-the-cursor vs hand-the-unused-CAS vs prove-counters; this filter (`checkpoint.version` `$in [null, 0]` when the caller said null) vs later `runTransitions` (`$or` checkpoint null / missing) vs live workers (lease + status only). There is no begin / complete Domain Command **seam**. There is no Mongo **adapter**. There is no per-workflow **adapter**. There is no “write the worker bag” **adapter**.
- Split later (only if the file outgrows one sitting): this ~90-line file is one sitting if you read it as prove this cursor only moves forward. If it later splits: `proveThisCursorOnlyMovesForward.ts`, `handTheCompareAndSetThatWritesTheNextCursor.ts` — never `assert.ts` / `build.ts` / `create.ts` / `update.ts` / `delete.ts`. Later persist, later schema fields, and every worker’s own bag stay siblings / other services.

`assertCheckpointAdvance` / `buildCheckpointCompareAndSet` / `assertMonotonicCounters` are executor mechanics. The owner question is: *Someone already holds a run and wants to remember how far they got. The next cursor must name a phase. Its version must be a positive integer and must climb if a cursor is already there. Completed units must be a non-negative integer and must not shrink. Leftover counters may appear or climb, never fall, and must stay finite and non-negative. Then, if a later store wants a compare-and-set, hand a filter that writes the next cursor only while this owner, this epoch, and this clock still hold the run and the stored version is still the one they read. This file does not claim the run. This file does not pick the next Best Relocation action, reporting page, or Granot source. This file does not persist. Live workers write the same nest without asking.*

Who claims the run, who picks the next action, who maps a reporting page onto this nest, and who persists under a lease already live in other **modules**. Do not pull those in.

## What this file actually does

One “prove this cursor only moves forward” story with three owner operations, not “a checkpoint helper,” and not Claim The Next Best Relocation Run / Write The Next Reporting Page / Collect The Next Granot Source:

1. **Prove this cursor only moves forward** — `assertCheckpointAdvance`. Refuse a next `version` that is not a positive integer. Refuse `completed_units` that is not a non-negative integer. Refuse a blank or whitespace-only `phase`. If a current cursor exists: next `version` must be strictly greater; next `completed_units` must be greater or equal. Missing current → first stamp, no climb check. This beat does **not** look at `cursor` keys. This beat does **not** look at `updated_at`. This beat does **not** persist.

2. **Hand the compare-and-set that writes the next cursor only while this owner still holds the run** — `buildCheckpointCompareAndSet`. Filter is run id + live lease fence (`lease_owner`, `lease_epoch`, `leased_until > now`) + expected `checkpoint.version`. Caller `current_version === null` → `{ $in: [null, 0] }`. Non-null current that is not behind next `version` → `NonMonotonicCheckpointError`. Update is only `{ $set: { checkpoint: next } }`. This beat does **not** **ask** prove-cursor (no phase / units prove). This beat does **not** include status. This beat does **not** include counters. This beat has **no caller today**.

3. **Prove leftover counters only stay or climb** — `assertMonotonicCounters`. Every key on `next` must be a non-negative finite number (not necessarily an integer). A key may not be less than `current[key] ?? 0`. Keys only on `current` may disappear. New keys are allowed. This beat does **not** persist.

There is no fourth mutate operation. `NonMonotonicCheckpointError` (`code: "NON_MONOTONIC_CHECKPOINT"`) is the shared refuse. Re-export through the barrel is convenience for later siblings, not a second story.

## Organization

Keep one file. This is the screenplay for “prove this cursor only moves forward.” `DurableCheckpoint` already lives on skipped `types.ts`. Later persist already lives on later `runTransitions.ts`. The persisted nest already lives on later `schema.ts`. Live worker bags already live on already-recommended ingestion / Granot HTTP / reporting **modules**. Do not pull those in. Do not invent a `DurableCheckpointService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only `phase: "applying"` as an **adapter**. Do not invent a Mongo **seam** beside a returned filter object. Do not invent a CRUD folder so “assert / build each get a file.”

Do not move later `transition` here so “prove and persist share a file.” Do not move `persistWorkerCheckpoint` here so “one cursor owns Best Relocation.” Do not move Granot `checkpoint()` here so “one helper owns every run.” Do not split `assert.ts` / `build.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assertCheckpointAdvance` | `proveThisCursorOnlyMovesForward` | later Mongo store and later in-memory fake |
| `buildCheckpointCompareAndSet` | `handTheCompareAndSetThatWritesTheNextCursor` | unused filter builder; later persist does not **ask** it |
| `assertMonotonicCounters` | `proveLeftoverCountersOnlyStayOrClimb` | later stores; live reporting has its own `TypeError` |
| `NonMonotonicCheckpointError` | `thisCursorWentBackward` | shared refuse; later `providerRetry` does **not** match this code |

Keep the old names as one-line aliases until later `runTransitions.ts`, later `testing.ts`, and tests migrate. Do not make callers learn `$in: [null, 0]` / `completed_units` field copies as the domain language. Do **not** rename persisted nest fields (`checkpoint.version`, `phase`, `cursor`, `completed_units`, `updated_at`) — later `schema.ts` and the three run models already store those names.

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type HowFarThisRunHasGotten = {
  version: number
  phase: string
  cursor: Record<string, string | number | boolean | null>
  completed_units: number
  updated_at: Date
}
```

That is today’s `DurableCheckpoint` — the handoff from “the worker remembers a cursor” to “prove it only moved forward.” Do **not** add `action_index` here so “Best Relocation owns the nest.” Do **not** add `page_number` here so “reporting owns the nest.” Do **not** add `status` here so “this file owns the graph.”

Leave `DurableCheckpoint` on skipped `types.ts`. Leave persist on later `runTransitions.ts`. Leave the nest on later `schema.ts`. Leave every worker’s write where it is.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// checkpoints.ts
// Someone already holds a run and wants to remember how far they got.
// The next cursor must climb. Completed units must not shrink.
// The phase must be named. Then, if a later store wants a write,
// hand a filter that only matches while this owner still holds the run.
// Do not claim the run. Do not pick the next action.

// ── 1. Prove this cursor only moves forward ───────────────

export function proveThisCursorOnlyMovesForward(
  current: HowFarThisRunHasGotten | null | undefined,
  next: HowFarThisRunHasGotten,
): void {
  if (!Number.isInteger(next.version) || next.version < 1) {
    throw new thisCursorWentBackward("Checkpoint version must be a positive integer.")
  }
  if (!Number.isInteger(next.completed_units) || next.completed_units < 0) {
    throw new thisCursorWentBackward(
      "Checkpoint completed_units must be a non-negative integer.",
    )
  }
  if (!next.phase.trim()) {
    throw new thisCursorWentBackward("Checkpoint phase is required.")
  }
  if (current && next.version <= current.version) {
    throw new thisCursorWentBackward("Checkpoint version must strictly increase.")
  }
  if (current && next.completed_units < current.completed_units) {
    throw new thisCursorWentBackward("Checkpoint completed_units cannot decrease.")
  }
}

// ── 2. Hand the compare-and-set ───────────────────────────

export function handTheCompareAndSetThatWritesTheNextCursor(input: {
  run_id: string
  lease: LeaseToken
  current_version: number | null
  next: HowFarThisRunHasGotten
  now: Date
}): { filter: Record<string, unknown>; update: Record<string, unknown> } {
  if (input.current_version !== null && input.next.version <= input.current_version) {
    throw new thisCursorWentBackward("Checkpoint version must strictly increase.")
  }
  return {
    filter: {
      _id: input.run_id,
      lease_owner: input.lease.owner,
      lease_epoch: input.lease.epoch,
      leased_until: { $gt: input.now },
      "checkpoint.version":
        input.current_version === null ? { $in: [null, 0] } : input.current_version,
    },
    update: { $set: { checkpoint: input.next } },
  }
}

// ── 3. Prove leftover counters only stay or climb ─────────

export function proveLeftoverCountersOnlyStayOrClimb(
  current: Record<string, number>,
  next: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(next)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new thisCursorWentBackward(`Counter ${key} must be a non-negative finite number.`)
    }
    if (value < (current[key] ?? 0)) {
      throw new thisCursorWentBackward(`Counter ${key} cannot decrease.`)
    }
  }
}

export class thisCursorWentBackward extends Error {
  readonly code = "NON_MONOTONIC_CHECKPOINT"
}
```

Read the later-store path out loud: *The later Mongo store already loaded the run and already proved this owner still holds it. Prove the next cursor only moves forward — name a phase, climb the version, do not shrink completed units. Prove leftover counters only stay or climb. Then that later store writes status, cursor, failure, and counters under its own filter. This file never runs that write. This file never claims the run. Live Best Relocation, reporting, and Granot HTTP workers write the same nest without walking through here.*

That is the operation. `assertCheckpointAdvance` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`handTheCompareAndSetThatWritesTheNextCursor` has no caller and disagrees with later persist.** Later `runTransitions.ts` treats a missing cursor as `$or: [{ checkpoint: null }, { checkpoint: { $exists: false } }]`, includes `status` and counter CAS, and `$set`s the whole transition. This builder treats a null current as `"checkpoint.version": { $in: [null, 0] }` and only `$set`s `checkpoint`. A stored version `0` would match this filter and miss later persist. Do not silently route later `transition` through this builder so “one CAS owns the run” without an **interface** proof. Do not delete the export so “nothing imports it.”

2. **Live workers write the nest and never ask this file.** Already-recommended `persistWorkerCheckpoint` uses `version: action_index` under a lease + `applying` filter. Already-recommended `checkpointReportingRun` maps `pageNumber + 1` under lease + status and never proves climb. Already-recommended Granot `checkpoint(phase, completed)` always writes `version: 1`. Do not silently wrap those writes with `proveThisCursorOnlyMovesForward` so “one cursor owns the company” — Granot’s second collect/plan/apply stamp would throw. Do not change Granot to bump `version` so “the helper becomes true.”

3. **The in-memory fake is the only proof, and it is one happy stamp.** `durableWork.test.ts` seeds `checkpoint: null` and writes version 1. It never proves a climb refuse, a units shrink, a blank phase, a non-integer version, or this unused filter. Later `MongoDurableRunStore` is never constructed. Add **interface** proofs of this file; do not treat the one fake transition as this **interface**.

4. **Prove-cursor and the unused CAS do not share a prove.** The CAS only re-checks version climb when `current_version !== null`. A caller can hand a blank phase or shrinking units to the filter builder and get a write object. Do not silently call prove-cursor inside the builder so “one refuse owns both” without an **interface** proof that later persist still does not import it.

5. **Counters are a weaker rule than completed units.** Units must be integers. Counters may be any finite number. Keys only on `current` may vanish. Already-recommended reporting throws `TypeError` for a bad counter and never **asks** this file. Do not silently route reporting through this prove so “one counter rule owns both.” Do not require integers here so “both proves match.”

6. **`NON_MONOTONIC_CHECKPOINT` is not a later structural code.** Later `providerRetry.ts` matches `CHECKSUM_MISMATCH` by code and `ChecksumMismatchError` by name. This error is `unknown` if a worker classified it. Do not silently add the code there so “one structural list owns every refuse.” Leave that for the later pass.

7. **`cursor` contents are untyped Mixed at persist and unproven here.** Skipped `types.ts` allows `string | number | boolean | null` values. Later schema is `Schema.Types.Mixed`. Ingestion stores arrays (`failed_action_keys`) inside `cursor`. This file never looks. Do not add an array refuse here so “the type wins.”

8. **Leave sibling modules alone.** Skipped `types.ts` owns the nest type. Later `runTransitions.ts` owns persist. Later `schema.ts` owns the fields. Already-recommended workers own which phase to name. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `proveThisCursorOnlyMovesForward`, `handTheCompareAndSetThatWritesTheNextCursor`, `proveLeftoverCountersOnlyStayOrClimb`.

Today’s folder test never imports those names. One in-memory `queued` → `running` stamp is not this **interface**.

Add tests that name the operation:

**Prove the cursor**
- Missing current + version 1 + named phase + `completed_units: 0` → ok.
- Current version 2, next version 3, units equal → ok.
- Next version 0, `1.5`, or missing integer → `thisCursorWentBackward`.
- Next units `-1` or `1.5` → refuse.
- Blank / whitespace phase → refuse.
- Next version `<=` current → refuse.
- Next units `<` current → refuse even when version climbed.
- `cursor` keys and `updated_at` going backward do not refuse.

**Hand the compare-and-set**
- `current_version: null` → filter `"checkpoint.version": { $in: [null, 0] }`, update `$set.checkpoint` is `next`.
- `current_version: 2`, next version 3 → filter version is `2`.
- `current_version: 2`, next version 2 → throw, no filter.
- Filter includes live lease fence and run id. Filter does **not** include `status` or `counters.*`.
- Blank phase still returns a filter (today’s builder does not prove-cursor). Name that gap; do not silently close it in the test rename.

**Prove counters**
- `{ read: 1 }` → `{ read: 1 }` or `{ read: 2, failures: 0 }` → ok.
- `{ read: 2 }` → `{ read: 1 }` → refuse.
- `{ read: Infinity }` or `{ read: -1 }` → refuse.
- Key only on current may be omitted on next.

**Out of scope for this interface**
- This file does not construct `MongoDurableRunStore`.
- This file does not import `IngestionRun` / `ReportingRun` / `GranotAutomationRun`.
- This file does not claim a named-scope lease.
- This file does not pick `action_index`, `pageNumber`, or a Granot source label.

Do **not** add a test per message string. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The three exports stay exported because prove-cursor vs unused CAS vs counters are a real **adapter** seam (later persist asks the first and third; nobody asks the second), not a test leak.

## What I would not do

- A `DurableCheckpointService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the same integer checks.
- Moving this into a CRUD folder (`assert.ts` / `build.ts` / `create.ts`) for cleanliness.
- Breaking the climb **seam**. A later cursor must not keep or lower `version` when a current cursor exists.
- Treating `persistWorkerCheckpoint`, Granot `checkpoint()`, `checkpointReportingRun`, or later `transition` as this story.
- Inventing a per-workflow **seam** that has only `phase: "applying"` as an **adapter**.
- Silently wrapping live worker writes with this prove, silently routing later persist through the unused CAS, or silently bumping Granot’s frozen `version: 1`.
- Jumping to `capability.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
