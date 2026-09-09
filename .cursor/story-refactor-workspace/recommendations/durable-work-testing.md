# Hold This Named Scope In Memory Until The Clock — And Write This Seeded Run's Next Status In Memory Only While This Owner Still Holds The Fence — Release Forgets The Seat Instead Of Setting The Clock To Now; A Failed Counter Prove Can Leave A Half-Written Cursor; There Is No Second Writer And No Re-Read — Never Talk To Mongo, Never Pick A Best Relocation Action, Never Stamp Started Or Completed Clocks — operational story

- Status: recommended
- Service: `durableWork` (Wave A, visited)
- Pass: 9 of this service — `testing.ts`
- Remaining in this service: none (`durableWork` visited)
- Target: `src/services/durableWork/testing.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (Best Relocation apply **asks** injected `LeaseStore.assertHeld` before each mutation; `ingestion.test.ts` constructs this file’s `InMemoryLeaseStore`, claims `ingestion:best_relocation:apply`, and hands the token + store to leftover `applyBestRelocationPlan` — knowledge never names `InMemoryLeaseStore` / `InMemoryDurableRunStore` / `InMemoryRun`), [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (global drain mutex `sheet-sync:drain` on already-recommended `MongoLeaseStore` — live drain never **asks** this fake), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (45-minute `granot:automation:account` on the Mongo store — never this fake), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-designed, checksum-bound reports; leftover Stage 4 **asks** leftover `transitionReportingRun` — knowledge never names this fake). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (Mongo **adapter** of `LeaseStore`; this file is the in-memory **adapter**). Distinct from already-recommended [durable-work-run-transitions.md](durable-work-run-transitions.md) (unused Mongo **adapter** of `DurableRunStore`; this file is the in-memory **adapter** that **asks** the same graph refuse + the same two proves, then clones / mutates — no Mongo filter, no re-read). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; no store). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (who is speaking; no store). Distinct from already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md) (proves the cursor / leftover unused CAS; this file **asks** prove-cursor and prove-counters, then writes in place — does **not** **ask** `buildCheckpointCompareAndSet`). Distinct from already-recommended [durable-work-capability.md](durable-work-capability.md) (unused three-gate AND; no store). Distinct from already-recommended [durable-work-schema.md](durable-work-schema.md) (mongoose nest; this file **never imports** it). Distinct from already-recommended [durable-work-provider-retry.md](durable-work-provider-retry.md) (classifies a throw; this file does **not** classify). Distinct from skipped `types.ts` `LeaseStore` / `DurableRunStore` / `LeaseToken` / `RunTransitionInput` / `RunTransitionResult` (this file **implements** both stores; it does not name the TypeScript). Distinct from already-recommended [ingestion-apply-plan.md](ingestion-apply-plan.md) / [ingestion-worker.md](ingestion-worker.md) (live worker constructs `MongoLeaseStore`; tests **ask** this fake). Distinct from already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) / [reporting-run-repository.md](reporting-run-repository.md) (own writes; never this fake). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “In-Memory Lease Store” / “In-Memory Durable Run Store” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **one leftover apply test family, plus the folder test.** Already-recommended `ingestion.test.ts` imports `InMemoryLeaseStore` from `durableWork/testing` (not the barrel) and constructs it five times: four leftover `applyBestRelocationPlan` walks (resume / adopt / failed dep / checksum) **ask** `acquire` then inject `lease` + `leaseStore`; one concurrent-acquire proof **asks** two `acquire`s on `ingestion:best_relocation:apply` and expects the second `null`. Folder test `durableWork.test.ts` **asks** `InMemoryLeaseStore` once (live holder → `null`; expired reclaim bumps epoch; stale `assertHeld` is `false`) and `InMemoryDurableRunStore` once (`queued` → `running`, version 1, `read` status). Barrel `durableWork/index.ts` re-exports this file. `InMemoryDurableRunStore` has **no caller outside the folder test**. Neither class has a runtime constructor. Not this **interface**: leftover `MongoLeaseStore`, leftover unused `MongoDurableRunStore`, leftover `failRun`, leftover `persistWorkerCheckpoint`, leftover `transitionReportingRun`, leftover Granot `checkpoint()`, leftover `buildCheckpointCompareAndSet`.
- Seams callers need: `LeaseStore` interface vs already-recommended Mongo **adapter** vs this in-memory **adapter**; `DurableRunStore` interface vs unused Mongo **adapter** vs this in-memory **adapter**; claim miss (`null` = busy) vs token; give-back delete (forget the seat) vs Mongo `$set leased_until: now`; in-process mutate vs Mongo CAS + re-read; `seed` / `read` test helpers vs `DurableRunStore.transition` only; nested `InMemoryRun.lease` vs Mongo top-level `lease_owner` / `lease_epoch` / `leased_until`; graph refuse (throw) vs soft miss (`applied: false`). There is no begin / complete Domain Command **seam**. There is no named-scope Mongo **adapter**. There is no “stamp the clocks” **adapter**. There is no second-writer **adapter**.
- Split later (only if the file outgrows one sitting): this ~140-line file is one sitting if you read it as hold this named scope in memory until the clock, and write this seeded run's next status in memory only while this owner still holds the fence. If it later splits: `holdThisNamedScopeInMemoryUntilTheClock.ts`, `writeThisSeededRunsNextStatusInMemoryOnlyWhileThisOwnerStillHoldsTheFence.ts` — never `acquire.ts` / `transition.ts` / `create.ts` / `update.ts` / `delete.ts`. Already-recommended Mongo adapters, leftover Best Relocation fail, leftover Reporting Stage 4, leftover Granot HTTP writes, and unused checkpoint CAS stay siblings / other services.

`InMemoryLeaseStore.acquire` / `renew` / `release` / `assertHeld` and `InMemoryDurableRunStore.transition` / `seed` / `read` are executor mechanics. The owner question is: *A test needs the same two seats the unused Mongo stores promise, without talking to Mongo. Someone named a scope and a worker. If nobody in this process still holds that scope past now, this worker takes it and bumps the epoch. If another worker in this process still holds it, return empty. While you hold the same owner and the same epoch and the clock is still ahead, you may push the clock forward or prove you still hold it. When you are done, forget the seat — do not leave a clock set to now. A stale token cannot renew, release, or prove hold. Separately, a test puts a run on the table with a nested lease, a cursor, leftover counters, and a failure bag. Someone already holds that run and wants the next status. If the run is gone, say so. If the status is not one we expected, say so. If the graph does not allow this hop, refuse. If this owner, this epoch, and a clock still ahead of now do not hold the nested fence, say the lease is gone. If a next cursor arrived, prove it only moves forward, then write it. If leftover counters arrived, prove they only stay or climb, then write them. Then write status. There is no second writer and no re-read. This file does not talk to Mongo. This file does not pick which Best Relocation action, reporting page, or Granot source to work. This file does not stamp `started_at` / `completed_at` / `attempt_count`.*

Who claims the live named scope, who writes leftover `failRun`, who stamps Reporting clocks, and who writes leftover Granot `checkpoint()` already live in other **modules**. Do not pull those in.

## What this file actually does

Two “in-memory seat” stories in one sitting, not “a test helper dump,” and not Claim The Next Best Relocation Run / Advance This Reporting Graph / Collect The Next Granot Source:

1. **Claim this named scope in memory until the clock** — `InMemoryLeaseStore.acquire`. If the map still has a token whose `leased_until > now`, return `null`. Else bump the per-scope epoch (`0` → `1` on first claim) and store `{ scope, owner, epoch, leased_until: now + ttl }`. Return a copied token (`copyToken` clones the Date). This beat does **not** refuse a blank scope, blank owner, or non-positive `ttl_ms` — already-recommended Mongo `assertLeaseInput` does. This beat does **not** upsert a row. This beat does **not** catch duplicate-key `11000`.

2. **Keep this named scope alive, prove the hold, or forget the seat** — `renew` / `assertHeld` / `release`. Shared in-memory fence (`isHeld`): stored owner + epoch match the token, and `leased_until > now`. Renew match → push `leased_until` to `now + ttl`, same epoch, return a copied token; miss → `null`. Prove match → `true`; miss → `false`. Release match → `this.leases.delete(scope)` → `true`; miss → `false`. Release does **not** `$set lease_owner: null` and does **not** set `leased_until: now`. The epoch map stays, so the next claim still bumps. This beat does **not** validate scope / owner / ttl.

3. **Put a run on the table, or read the clone** — `InMemoryDurableRunStore.seed` / `read`. `seed` `structuredClone`s `{ id, status, lease, checkpoint, counters, failure }` under `id`. `read` returns a clone or `undefined`. These two names are **not** on `DurableRunStore`. Unused Mongo has no seed — leftover tests never construct it. This beat does **not** claim a named scope. This beat does **not** hop status.

4. **Write this seeded run's next status in memory only while this owner still holds the fence** — `InMemoryDurableRunStore.transition`. Missing id → `{ applied: false, reason: "run_missing" }`. Current `status` not in `expected_statuses` → `status_mismatch`. Graph hop refuse **asks** already-recommended `InvalidRunTransitionError` / `StatusGraph` (throw). Nested fence miss (owner / epoch / `leased_until.getTime() <= now`) → `lease_lost`. Optional next cursor → **ask** already-recommended `assertCheckpointAdvance`, then `structuredClone` onto the stored run. Optional leftover counters → **ask** already-recommended `assertMonotonicCounters`, then `Object.assign`. Optional `failure` (including `null`) clones or clears. Then `status = next_status`. `{ applied: true }`. This beat does **not** `updateOne`. This beat does **not** re-read. This beat does **not** require `instanceof Date` (the nest is already a Date). This beat does **not** `$set` `started_at` / `completed_at` / `attempt_count`. This beat does **not** **ask** `buildCheckpointCompareAndSet`. If the leftover-counter prove throws after the cursor clone, the stored run already has the new cursor.

There is no fifth mutate operation. `copyToken` is the Date-clone beat of operations 1–2, not a second story. `isHeld` is the shared fence those three later lease beats **ask**. Re-export through the barrel is convenience for the folder test; leftover apply tests import this file directly.

## Organization

Keep one file. This is the screenplay for “hold this named scope in memory until the clock, and write this seeded run's next status in memory only while this owner still holds the fence.” `LeaseStore` / `DurableRunStore` / `LeaseToken` / `RunTransitionInput` / `RunTransitionResult` already live on skipped `types.ts`. Already-recommended Mongo adapters already live on `leases.ts` and `runTransitions.ts`. Prove-cursor already lives on already-recommended `checkpoints.ts`. Live worker writes already live on already-recommended ingestion / Granot HTTP / reporting **modules**. Do not pull those in. Do not invent a `DurableWorkTestingService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only `queued → running` as an **adapter**. Do not invent a CRUD folder so “lease fake and run fake each get a file named create/update.”

Do not merge this into already-recommended `leases.ts` so “one class owns test and prod.” Do not merge this into already-recommended `runTransitions.ts` so “one persist owns both adapters.” Do not move leftover `applyBestRelocationPlan` here so “the fake owns Best Relocation.” Do not move leftover `transitionReportingRun` here so “one graph owns every run.” Do not route this mutate through already-recommended `buildCheckpointCompareAndSet` so “one CAS owns the fake.” Do not split `acquire.ts` / `transition.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `InMemoryLeaseStore.acquire` | `claimThisNamedScopeInMemoryUntilTheClock` | leftover apply tests + folder reclaim proof |
| `InMemoryLeaseStore.renew` | `keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt` | `LeaseStore` contract; no leftover test **asks** it today |
| `InMemoryLeaseStore.release` | `forgetThisNamedScope` | `LeaseStore` contract; leftover worker `finally` **asks** Mongo, not this |
| `InMemoryLeaseStore.assertHeld` | `proveThisOwnerStillHoldsThisNamedScope` | leftover `applyBestRelocationPlan` before each mutation; folder stale-token proof |
| `InMemoryLeaseStore` | `InMemoryLeaseStore` | the in-memory **adapter** of `LeaseStore`; keep the class |
| `InMemoryDurableRunStore.seed` | `putThisRunOnTheTable` | folder test must plant the nest; unused Mongo has no seed |
| `InMemoryDurableRunStore.read` | `readTheClonedRun` | folder test asserts `status === "running"` |
| `InMemoryDurableRunStore.transition` | `writeThisSeededRunsNextStatusInMemoryOnlyWhileThisOwnerStillHoldsTheFence` | same `DurableRunStore` **interface** as unused Mongo |
| `InMemoryDurableRunStore` | `InMemoryDurableRunStore` | the in-memory **adapter** of `DurableRunStore`; keep the class |
| `InMemoryRun` | `theSeededRunOnTheTable` | the nest a test plants; not a Mongo document |

Keep the old names as one-line aliases / the same class methods until leftover `ingestion.test.ts` and the folder test migrate. Do not make callers learn `Map#get` / `structuredClone` / `Object.assign` as the domain language. Do **not** rename persisted field names (`status`, `checkpoint.*`, `counters.*`, `failure`) — already-recommended `schema.ts` and the three run models already store those names. Do **not** rename `RunTransitionResult.reason` strings (`status_mismatch`, `lease_lost`, `run_missing`) — unused Mongo returns the same three. Do **not** rename `LeaseToken` fields (`scope`, `owner`, `epoch`, `leased_until`).

**No workflow class besides the two store adapters.** `InMemoryLeaseStore` and `InMemoryDurableRunStore` are the in-memory **adapters**, not a `*Service`. The two types that *do* earn a name already live on skipped `types.ts`, plus this file’s seed nest:

```ts
type ThisNamedScopeUntilTheClock = {
  scope: string
  owner: string
  epoch: number
  leased_until: Date
}

type WhetherThisHopApplied =
  | { applied: true }
  | {
      applied: false
      reason: "status_mismatch" | "lease_lost" | "run_missing"
    }

type TheSeededRunOnTheTable<TStatus extends string> = {
  id: string
  status: TStatus
  lease: ThisNamedScopeUntilTheClock
  checkpoint: DurableCheckpoint | null
  counters: Record<string, number>
  failure: StructuredRunFailure | null
}
```

That is today’s `LeaseToken` + `RunTransitionResult` + `InMemoryRun` — the handoff from “the test planted a seat” to “claim it, or hop the run.” Do **not** add `recovered` here so “we match Call Log.” Do **not** add `started_at` / `completed_at` here so “Reporting clocks live on the fake.” Do **not** add `checkpoint_mismatch` here so “the unused reason becomes true” without an **interface** proof that unused Mongo still returns only three reasons. Do **not** add `scope` onto the run hop so “one token owns both fences.”

Leave `LeaseStore` / `DurableRunStore` on skipped `types.ts`. Leave already-recommended `MongoLeaseStore` on `leases.ts`. Leave unused `MongoDurableRunStore` on already-recommended `runTransitions.ts`. Leave leftover Reporting Stage 4 on already-recommended `reportingRunRepository.ts`. Leave leftover `failRun` / leftover `persistWorkerCheckpoint` on already-recommended `ingestion/worker.ts`. Leave leftover Granot writes on already-recommended `runWorkflow.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// testing.ts
// A test needs the same two seats the unused Mongo stores promise.
// Hold a named scope in this process until the clock, or forget it.
// Put a run on the table. Hop its status only while this owner still holds the nested fence.
// Do not talk to Mongo.
// Do not pick the next action.
// Do not stamp started or completed clocks.

export class InMemoryLeaseStore implements LeaseStore {
  // ── 1. Claim this named scope in memory until the clock ─

  async claimThisNamedScopeInMemoryUntilTheClock(input): Promise<ThisNamedScopeUntilTheClock | null> {
    const current = this.leases.get(input.scope)
    if (current && current.leased_until.getTime() > input.now.getTime()) {
      return null
    }
    const epoch = (this.epochs.get(input.scope) ?? 0) + 1
    const token = {
      scope: input.scope,
      owner: input.owner,
      epoch,
      leased_until: new Date(input.now.getTime() + input.ttl_ms),
    }
    this.epochs.set(input.scope, epoch)
    this.leases.set(input.scope, token)
    return copyTheTokenAndTheClock(token)
  }

  // ── 2. Keep this named scope alive, prove the hold, or forget the seat

  async keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt(input) {
    if (!this.proveThisOwnerStillHoldsThisNamedScope(input.token, input.now)) {
      return null
    }
    const renewed = {
      ...input.token,
      leased_until: new Date(input.now.getTime() + input.ttl_ms),
    }
    this.leases.set(input.token.scope, renewed)
    return copyTheTokenAndTheClock(renewed)
  }

  async forgetThisNamedScope(input) {
    if (!this.proveThisOwnerStillHoldsThisNamedScope(input.token, input.now)) {
      return false
    }
    this.leases.delete(input.token.scope)
    return true
  }

  async proveThisOwnerStillHoldsThisNamedScope(input) {
    return this.theLiveFenceForThisToken(input.token, input.now)
  }

  private theLiveFenceForThisToken(token, now) {
    const current = this.leases.get(token.scope)
    return (
      current?.owner === token.owner &&
      current.epoch === token.epoch &&
      current.leased_until.getTime() > now.getTime()
    )
  }
}

export class InMemoryDurableRunStore<TStatus extends string>
  implements DurableRunStore<TStatus>
{
  constructor(private readonly graph: theAllowedHopsFromEachStatus<TStatus>) {}

  // ── 3. Put a run on the table, or read the clone ────────

  putThisRunOnTheTable(run: TheSeededRunOnTheTable<TStatus>) {
    this.runs.set(run.id, structuredClone(run))
  }

  readTheClonedRun(runId: string) {
    const run = this.runs.get(runId)
    return run ? structuredClone(run) : undefined
  }

  // ── 4. Write this seeded run's next status in memory only while this owner still holds the fence

  async writeThisSeededRunsNextStatusInMemoryOnlyWhileThisOwnerStillHoldsTheFence(
    input: RunTransitionInput<TStatus>,
  ): Promise<WhetherThisHopApplied> {
    const run = this.runs.get(input.run_id)
    if (!run) return { applied: false, reason: "run_missing" }
    if (!input.expected_statuses.includes(run.status)) {
      return { applied: false, reason: "status_mismatch" }
    }
    if (!(this.graph[run.status] ?? []).includes(input.next_status)) {
      throw new thisHopIsNotAllowed(run.status, input.next_status)
    }
    if (
      run.lease.owner !== input.lease.owner ||
      run.lease.epoch !== input.lease.epoch ||
      run.lease.leased_until.getTime() <= input.now.getTime()
    ) {
      return { applied: false, reason: "lease_lost" }
    }
    if (input.checkpoint) {
      assertCheckpointAdvance(run.checkpoint, input.checkpoint)
      run.checkpoint = structuredClone(input.checkpoint)
    }
    if (input.counters) {
      assertMonotonicCounters(run.counters, input.counters)
      Object.assign(run.counters, input.counters)
    }
    if (input.failure !== undefined) {
      run.failure = input.failure ? structuredClone(input.failure) : null
    }
    run.status = input.next_status
    return { applied: true }
  }

  async transition(input: RunTransitionInput<TStatus>) {
    return this.writeThisSeededRunsNextStatusInMemoryOnlyWhileThisOwnerStillHoldsTheFence(input)
  }
}

function copyTheTokenAndTheClock(token): ThisNamedScopeUntilTheClock

export const InMemoryLeaseStore = InMemoryLeaseStore
export const InMemoryDurableRunStore = InMemoryDurableRunStore
export type InMemoryRun<TStatus extends string> = TheSeededRunOnTheTable<TStatus>
```

Read the leftover apply path out loud: *A Best Relocation apply test names `ingestion:best_relocation:apply` and a worker. Claim that scope in this process until the clock. Hand the token and this store to leftover `applyBestRelocationPlan`. Before each mutation, leftover apply **asks** prove this owner still holds it. A second claim on the same scope at the same now returns empty. This file never talks to `SheetSyncLease`. This file never picks `cursor.action_index`. This file never stamps Reporting `started_at`.*

Read the folder hop out loud: *Plant a `queued` run with a nested lease. Ask for `running` under that lease and a first cursor version 1. The graph allows the hop. The nested clock is still ahead. Prove the cursor only moves forward. Write the cursor, leftover counters, and status in place. Read the clone — it says `running`. There is no `updateOne`. There is no re-read. A leftover-counter prove that throws after the cursor clone has already changed the planted run.*

That is the operation. `acquire` / `transition` are not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Release forgets the seat; Mongo sets the clock to now.** Already-recommended `MongoLeaseStore.release` `$set`s `lease_owner: null` and `leased_until: now` so the next claim uses `$lte now`. This fake `delete`s the map entry and keeps the epoch map. Next claim still bumps. Do not silently make this fake write `now` so “both adapters match” without an **interface** proof that leftover apply tests still treat a forgotten seat as free. Do not silently make Mongo delete the row so “empty means free.” Leave that on already-recommended [durable-work-leases.md](durable-work-leases.md).

2. **This fake does not refuse a blank scope, blank owner, or non-positive `ttl_ms`.** Already-recommended Mongo throws `TypeError` before the upsert. Leftover apply tests always pass a named scope and a positive ttl. Do not silently add `assertLeaseInput` here so “one guard owns both adapters” without an **interface** proof. Do not silently drop Mongo’s guard so “the fake becomes the contract.”

3. **A failed leftover-counter prove can leave a half-written cursor.** Unused Mongo **asks** both proves **before** `updateOne`. This fake clones the cursor, then proves counters. If `assertMonotonicCounters` throws, `run.checkpoint` is already the next bag and `status` has not moved. Do not silently reorder to “proves first, then mutate” in this rename without an **interface** proof — that would hide today’s half-write. Do not silently wrap the mutate in a clone-and-swap so “the unused atomicity becomes true.”

4. **There is no second writer and no re-read.** Unused Mongo names a cursor / leftover-counter CAS miss `lease_lost` after `modifiedCount !== 1`. This fake never returns that lie from a concurrent hop — it mutates the one planted object. Do not silently add a re-read so “both adapters match.” Do not silently add `checkpoint_mismatch` so “the unused reason becomes true.”

5. **The run nest is a `LeaseToken`; Mongo stores top-level fence columns.** `InMemoryRun.lease` is `{ scope, owner, epoch, leased_until }`. Unused Mongo reads `lease_owner` / `lease_epoch` / `leased_until` and ignores `LeaseToken.scope`. Do not silently flatten the nest so “the schema wins.” Do not add `scope` to unused Mongo’s filter so “one token owns both fences.”

6. **`instanceof Date` lives only on unused Mongo.** Already-recommended `leaseMatches` refuses a string clock before `updateOne`. This fake calls `getTime()` on the planted Date. Do not silently add `instanceof` here so “the two fences match” without an **interface** proof. A planted non-Date would throw, not return `lease_lost`.

7. **`InMemoryDurableRunStore` has no leftover apply caller.** Leftover `ingestion.test.ts` **asks** only the lease fake. The one folder hop (`queued` → `running`) is the entire run-fake **interface** today. Graph refuse, `run_missing`, `status_mismatch`, `lease_lost`, leftover-counter throw-after-cursor, and `failure: null` are unproven. Add **interface** proofs of this file; do not treat the one happy hop as enough.

8. **Leave sibling modules alone.** Skipped `types.ts` owns the interfaces. Already-recommended `leases.ts` owns the Mongo named-scope **adapter**. Already-recommended `runTransitions.ts` owns the unused Mongo hop. Already-recommended `checkpoints.ts` owns prove-cursor. Leftover apply owns which scope to name. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `claimThisNamedScopeInMemoryUntilTheClock`, `keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt`, `forgetThisNamedScope`, `proveThisOwnerStillHoldsThisNamedScope`, `putThisRunOnTheTable`, `readTheClonedRun`, `writeThisSeededRunsNextStatusInMemoryOnlyWhileThisOwnerStillHoldsTheFence`.

Today’s folder test proves live-holder miss, expired reclaim + epoch bump, stale `assertHeld`, and one `queued` → `running` hop. Leftover `ingestion.test.ts` proves concurrent acquire and leftover apply under a live token. That is not enough for both **adapters**.

Add tests that name the operation:

**Hold this named scope in memory until the clock**
- Free / expired seat → token, `epoch` is previous + 1 (or 1 on first claim).
- Live holder → `null`, epoch unchanged.
- After `forgetThisNamedScope`, a later claim still bumps the kept epoch map.
- Matching owner + epoch + live clock → renew pushes `leased_until`, same epoch; prove `true`; forget `true` and `read` of that scope is gone.
- Stale owner, stale epoch, or expired clock → renew `null`, prove `false`, forget `false`.
- A stale token cannot forget a successor who already claimed the next epoch.
- Blank scope / blank owner / `ttl_ms <= 0` stay unguarded today. Prove the current miss. Do not silently add Mongo’s `TypeError` in the test so “the unused guard becomes true.”

**Write this seeded run's next status in memory only while this owner still holds the fence**
- Planted run, expected status, allowed hop, live nested clock, first cursor version 1 → `{ applied: true }` and `readTheClonedRun` shows the next status + cloned cursor.
- Missing id → `{ applied: false, reason: "run_missing" }` and no mutate.
- Current status not in `expected_statuses` → `status_mismatch`.
- Owner / epoch mismatch, or nested clock `<= now` → `lease_lost`.
- `queued → completed` when the graph only allows `queued → running` throws already-recommended `thisHopIsNotAllowed` / `INVALID_RUN_TRANSITION`.
- Next cursor that does not climb → already-recommended `NonMonotonicCheckpointError` and status unchanged.
- Leftover counter that shrinks **after** a legal cursor → today’s leftover half-write: cursor already cloned, status unchanged, prove throws. Prove that order. Do not silently swap it in the test so “the unused atomicity becomes true.”
- `input.failure === null` clears the planted failure. `undefined` leaves it.
- `readTheClonedRun` does not hand out the stored object — mutating the clone must not change the next `read`.
- The hop does **not** stamp `started_at`, `completed_at`, or `attempt_count` on the nest.

**Out of scope for this interface**
- This file does not import leftover `IngestionRun` / `ReportingRun` / `GranotAutomationRun` / `SheetSyncLease`.
- This file does not **ask** `MongoLeaseStore.acquire`.
- This file does not construct `MongoDurableRunStore`.
- This file does not **ask** `buildCheckpointCompareAndSet`.
- This file does not **ask** `classifyGoogleFailure`.
- This file does not write leftover `INGESTION_WORKER_FAILED` or leftover `reportingFailure`.
- This file does not stamp leftover Reporting `started_at`.

Do **not** add a test per `copyToken` / `isHeld` branch constant. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The two classes and `InMemoryRun` stay exported because in-memory **adapter** vs Mongo **adapter**, and seed/read vs `transition`, are the **interface**, not a test leak. There is no third **adapter** until a live worker constructs either fake.

## What I would not do

- A `DurableWorkTestingService` / `InMemoryLeaseService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Map#get`.
- Moving this into a CRUD folder (`acquire.ts` / `transition.ts` / `create.ts`) for cleanliness.
- Breaking the graph-refuse **seam**. An illegal hop throws. A lost fence returns `applied: false`. Do not silently turn the throw into `status_mismatch`.
- Treating leftover `MongoLeaseStore`, leftover unused `MongoDurableRunStore`, leftover `failRun`, leftover `persistWorkerCheckpoint`, leftover `transitionReportingRun`, leftover `checkpointReportingRun`, leftover Granot `checkpoint()`, or leftover `buildCheckpointCompareAndSet` as this story.
- Inventing a per-workflow **seam** that has only `queued → running` as an **adapter**.
- Silently merging this into `leases.ts` / `runTransitions.ts`, silently making release write `now`, silently adding Mongo’s input guard, silently reordering prove-then-mutate, silently adding `checkpoint_mismatch`, or silently adding `instanceof Date`.
- Jumping to `historicalConsolidation` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
