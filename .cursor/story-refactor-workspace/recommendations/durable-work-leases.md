# Hold This Named Scope Until The Clock — If Nobody Still Holds It, Take It And Bump The Epoch; If Another Worker Still Holds It, Return Empty; While You Hold The Same Owner And Epoch, Push The Clock Forward Or Prove You Still Hold It; When Done, Clear The Owner And Set The Clock To Now — A Stale Token Writes Nothing — Never Pick A Run, Never Write A Lead, Never Import The Sheet-Sync Collection — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 1 of this service — `leases.ts`
- Remaining in this service: `checksum.ts`, `actors.ts`, `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/leases.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (global drain mutex `sheet-sync:drain` on `sheet_sync_leases`), [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (five-minute `ingestion:best_relocation:apply`), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (45-minute `granot:automation:account`), [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (60-second rematch drain via the skipped Sheet Sync wrapper). Distinct from later checksum / actors / checkpoints / capability / schema / provider retry / run transition / in-memory fake. Distinct from skipped `sheetSync/drainer/leases.ts` (thin wrapper that **asks** this store). Distinct from already-recommended [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (takes the seat, then claims jobs). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) (claims the apply scope, then claims a run). Distinct from already-recommended [ingestion-apply-plan.md](ingestion-apply-plan.md) and [best-relocation-sheet-ingest-provider.md](best-relocation-sheet-ingest-provider.md) (**ask** `assertHeld` on an injected `LeaseStore`). Distinct from already-recommended Granot HTTP `runWorkflow.ts` (account lease, then plan/apply). Distinct from already-recommended [employee-bookings-reconciliation-rematch.md](employee-bookings-reconciliation-rematch.md) (**asks** the wrapper, not this file). Distinct from already-recommended [ringcentral-call-log-sync-state-store.md](ringcentral-call-log-sync-state-store.md) (own singleton row; never imports this file). Distinct from already-recommended [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) (receipt `processing.*`). Distinct from already-recommended [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (60s sending lease on `LeadMessage`). Distinct from later `schema.ts` `durableRunControlFields` on `IngestionRun` / `ReportingRun` / `GranotAutomationRun` (embedded run fence, not this named-scope row). Distinct from skipped `types.ts` `LeaseStore` / `LeaseToken` (this file **implements** the interface). Distinct from later `testing.ts` `InMemoryLeaseStore`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Work” / “Fenced Lease” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **three runtime constructors, plus the skipped wrapper and two `assertHeld` walks.** Skipped `sheetSync/drainer/leases.ts` constructs `new MongoLeaseStore(SheetSyncLease)` and re-exports `acquire` / `renew` / `release` / `assertHeld`. Already-recommended `runSheetSyncDrain` **asks** that wrapper for `sheet-sync:drain`. Already-recommended rematch **asks** the same wrapper for `booking-reconciliation:rematch`. Already-recommended `ingestion/worker.ts` constructs `new MongoLeaseStore(SheetSyncLease)` for `ingestion:best_relocation:apply` (acquire / renew / release). Already-recommended `applyPlan.ts` **asks** injected `leaseStore.assertHeld` before each mutation. Already-recommended Best Relocation adapter **asks** `assertHeld` before identity repair. Already-recommended `granotHttpCollector/runWorkflow.ts` constructs `new MongoLeaseStore(SheetSyncLease)` for `granot:automation:account` (acquire / renew / release). Barrel `durableWork/index.ts` re-exports this file. Tests: `durableWork.test.ts` proves **later** `InMemoryLeaseStore` and the `SheetSyncLease` unique-scope index — it never constructs `MongoLeaseStore`. `ingestion.test.ts` **asks** `InMemoryLeaseStore`. There is no Mongo replica of this adapter. Not this **interface**: RingCentral Call Log claim, Granot receipt claim, Lead Messaging sending claim, `ReportingRun` embedded lease, per-job `SheetSyncJob` claim, later `MongoDurableRunStore.transition`.
- Seams callers need: `LeaseStore` interface vs this Mongo **adapter** vs later in-memory **adapter**; claim miss (`null` = busy) vs token; live fence (`scope` + `owner` + `epoch` + `leased_until > now`) vs stale no-op; injected model vs hardcoded `SheetSyncLease` (this file never imports the model); named-scope row vs run-document lease fields. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Lead write **seam**. There is no per-tab **adapter**.
- Split later (only if the file outgrows one sitting): this ~150-line file is one sitting if you read it as hold this named scope until the clock. If it later splits: `claimThisNamedScopeUntilTheClock.ts`, `keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt.ts` — never `acquire.ts` / `renew.ts` / `release.ts` / `create.ts` / `update.ts` / `delete.ts`. The skipped wrapper, later in-memory fake, later schema fields, and every caller’s run-document fence stay siblings / other services.

`MongoLeaseStore.acquire` / `renew` / `release` / `assertHeld` are executor mechanics. The owner question is: *Someone named a scope and a worker. If nobody still holds that scope past now, this worker takes it and bumps the epoch. If another worker still holds it, return empty — do not wait, do not spin. While you hold the same owner and the same epoch and the clock is still ahead, you may push the clock forward or prove you still hold it. When you are done, clear the owner and set the clock to now so the next worker can take it. A stale token cannot renew, release, or prove hold. A first-insert race that hits the unique scope is a loss, not a second row. This file does not pick which Sheet Sync drain, Best Relocation run, Granot automation run, or rematch case to work. This file does not write a Lead or a Booking. This file does not import `SheetSyncLease`. Callers hand it a collection and a scope string.*

Who drains, who applies, who rematches, who embeds a lease on a run document, and who elects the RingCentral sweeper already live in other **modules**. Do not pull those in.

## What this file actually does

One “hold this named scope until the clock” story with four owner operations, not “a lease CRUD store,” and not Drain Due Sheet-Sync Jobs / Claim The Next Best Relocation Run / Elect The Call Log Sweeper:

1. **Claim this named scope until the clock** — `acquire`. Refuse a blank scope, blank owner, or non-positive `ttl_ms`. Upsert the row whose `scope` is free (`leased_until` missing, null, or `<= now`). Winner `$set`s owner + new clock and `$inc`s `lease_epoch`. Return the token (`scope`, `owner`, `epoch`, `leased_until`). Unique-key `11000` → `null` (someone else inserted first). A live holder is also `null`. Never waits. Never spins. This beat does **not** open a run. This beat does **not** write a job.

2. **Keep this named scope alive only while this owner still holds it** — `renew`. Same input guards. Fence `scope` + `owner` + `epoch` + `leased_until > now`. Match → push `leased_until` to `now + ttl`. Miss → `null`. The caller must stop and must not write as the former owner. This beat does **not** bump the epoch. This beat does **not** clear the owner.

3. **Give this named scope back** — `release`. Same live fence. Match → `$set` `lease_owner: null` and `leased_until: now` (not null). `modifiedCount === 1` → `true`. Miss → `false`. A stale token cannot clear a successor. This beat does **not** delete the row. This beat does **not** decrement the epoch.

4. **Prove this owner still holds this named scope** — `assertHeld`. Same live fence. `findOne` hit → `true`. Miss → `false`. This beat does **not** push the clock. This beat does **not** mutate.

There is no fifth mutate operation. `activeTokenFilter` is the shared fence those three later beats **ask**. `toToken` fail-closes if the store returns a row without owner, clock, or a positive integer epoch. `MongoLeaseModel` is the injected collection shape. Re-export through the barrel is convenience for callers, not a second story.

## Organization

Keep one file. This is the screenplay for “hold this named scope until the clock.” The `LeaseStore` types already live on skipped `types.ts`. The in-memory fake already lives on later `testing.ts`. The skipped Sheet Sync wrapper already **asks** this store. Run-document fences already live on already-recommended workers / drain / rematch. RingCentral’s singleton already lives on already-recommended `call-log-sync-state.store.ts`. Do not pull those in. Do not invent a `DurableLeaseService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-tab **seam** that has only the model comment as an **adapter**. Do not invent a second collection **seam** beside the injected model. Do not invent a CRUD folder so “acquire / renew / release each get a file.”

Do not move this into `sheetSync/drainer/leases.ts` so “Sheet Sync owns every scope.” Do not move `SheetSyncLease` import here so “the store owns the collection.” Do not move RingCentral claim here so “one lease owns the company.” Do not move receipt `processing.*` here so “one claim owns Granot drain.” Do not merge later `InMemoryLeaseStore` into this file so “one class owns test and prod.” Do not split `acquire.ts` / `renew.ts` / `release.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `MongoLeaseStore.acquire` | `claimThisNamedScopeUntilTheClock` | drain / rematch wrapper, BR worker, Granot worker |
| `MongoLeaseStore.renew` | `keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt` | drain heartbeat, BR / Granot renew |
| `MongoLeaseStore.release` | `giveThisNamedScopeBack` | every caller’s `finally` |
| `MongoLeaseStore.assertHeld` | `proveThisOwnerStillHoldsThisNamedScope` | drain require, BR apply before mutation, BR identity repair |
| `activeTokenFilter` | `theLiveFenceForThisToken` | the shared `{ scope, owner, epoch, leased_until > now }` filter |
| `MongoLeaseStore` | `MongoLeaseStore` | the Mongo **adapter** of `LeaseStore`; keep the class |
| `MongoLeaseModel` | `theCollectionThisStoreTalksTo` | injected; today every runtime caller passes `SheetSyncLease` |

Keep the old names as one-line aliases / the same class methods until the skipped wrapper, already-recommended workers, and later tests migrate. Do not make callers learn `findOneAndUpdate` / `11000` / `$inc lease_epoch` as the domain language. Do **not** rename persisted field names (`lease_owner`, `lease_epoch`, `leased_until`, `scope`) — those are the durable fence.

**No workflow class besides the store adapter.** `MongoLeaseStore` is the Mongo **adapter** of `LeaseStore`, not a `*Service`. The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type ThisNamedScopeUntilTheClock = {
  scope: string
  owner: string
  epoch: number
  leased_until: Date
}
```

That is today’s `LeaseToken` — the handoff from “this worker won the scope” to “renew, prove, or give it back.” Do **not** add `recovered` here so “we match Call Log.” Do **not** add `run_id` here so “the scope owns the run.” Do **not** add `collection` on the token so “the caller can forget which model they passed.”

Leave `LeaseStore` on skipped `types.ts`. Leave `InMemoryLeaseStore` on later `testing.ts`. Leave `SheetSyncLease` on Wave B models. Leave every caller’s run-document fence where it is.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leases.ts
// Someone named a scope and a worker.
// Hold that scope until the clock, or give it back.
// A live holder cannot be stolen. An expired or empty clock can.
// A stale token writes nothing.

// ── 1. Claim this named scope until the clock ─────────────

export class MongoLeaseStore implements LeaseStore {
  constructor(private readonly model: MongoLeaseModel) {}

  async claimThisNamedScopeUntilTheClock(input): Promise<ThisNamedScopeUntilTheClock | null> {
    refuseABlankScopeOwnerOrTtl(input)
    try {
      const row = await this.model.findOneAndUpdate(
        { scope: input.scope, /* expired, null, or missing clock */ },
        { $set: { lease_owner, leased_until: now + ttl }, $inc: { lease_epoch: 1 }, $setOnInsert: { scope } },
        { returnDocument: "after", upsert: true },
      )
      return row ? refuseAnInvalidFence(row) : null
    } catch (error) {
      if (duplicateUniqueScope(error)) return null
      throw error
    }
  }

  // ── 2. Keep this named scope alive ──────────────────────

  async keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt(input) {
    refuseABlankScopeOwnerOrTtl(input.token)
    const row = await this.model.findOneAndUpdate(
      theLiveFenceForThisToken(input.token, input.now),
      { $set: { leased_until: now + ttl } },
      { returnDocument: "after" },
    )
    return row ? refuseAnInvalidFence(row) : null
  }

  // ── 3. Give this named scope back ───────────────────────

  async giveThisNamedScopeBack(input) {
    const result = await this.model.updateOne(
      theLiveFenceForThisToken(input.token, input.now),
      { $set: { lease_owner: null, leased_until: input.now } },
    )
    return result.modifiedCount === 1
  }

  // ── 4. Prove this owner still holds it ──────────────────

  async proveThisOwnerStillHoldsThisNamedScope(input) {
    const row = await this.model.findOne(theLiveFenceForThisToken(input.token, input.now))
    return row !== null
  }
}

export function theLiveFenceForThisToken(token, now) {
  return { scope, lease_owner: owner, lease_epoch: epoch, leased_until: { $gt: now } }
}

function refuseAnInvalidFence(row): ThisNamedScopeUntilTheClock
function refuseABlankScopeOwnerOrTtl(scope, owner, ttlMs)
function duplicateUniqueScope(error): error.code === 11000
```

Read the claim path out loud: *Refuse a blank scope, blank owner, or a clock that is not ahead. Ask Mongo for the row whose scope is free — expired, null, or missing. If you win, write your name, push the clock, and bump the epoch. If the unique scope already exists because someone else inserted first, you lost — return empty. If someone still holds it, you also lost. Hand back a token only when the stored fence has an owner, a clock, and a positive integer epoch. Never wait. Never pick a run. Never import the Sheet Sync collection.*

That is the operation. `findOneAndUpdate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Four workflows, one collection named for Sheet Sync.** Runtime always injects `SheetSyncLease` / `sheet_sync_leases` for `sheet-sync:drain`, `ingestion:best_relocation:apply`, `granot:automation:account`, and `booking-reconciliation:rematch`. The model comment still says per-tab parallelism (`<spreadsheetId>:<tabName>`). Live callers never pass a tab scope. Do not import `SheetSyncLease` here so “the store owns the collection.” Do not start minting per-tab scopes so “the comment becomes true.” Do not invent a second collection this pass.

2. **The Mongo adapter has no test.** `durableWork.test.ts` proves later `InMemoryLeaseStore` (expired reclaim + epoch bump + stale `assertHeld`) and the unique-scope index on the model. It never constructs `MongoLeaseStore`. Duplicate-key → `null`, invalid stored fence → throw, and release `$set leased_until: now` (not null) are untested on Mongo. Add **interface** proofs of this adapter; do not replace the in-memory fake.

3. **`activeTokenFilter` is exported and unused outside this file.** Already-recommended workers copy `{ lease_owner, lease_epoch, leased_until: { $gt: now } }` onto `IngestionRun` / `GranotAutomationRun` / claimed jobs. Do not merge those run-document fences here so “one filter owns every CAS.” Do not delete the export so “nothing imports it.”

4. **`toToken` throws a raw `Error`.** Sibling Domain Command CAS throws a typed conflict. Do not silently swap the class so “one typed fence owns every store.”

5. **Release sets `leased_until` to `now`, not null.** Next claim uses `$lte now`, so it works. Later `InMemoryLeaseStore.release` deletes the map entry instead. Do not change Mongo to null so “empty means free” without an **interface** proof. Do not make the in-memory fake write `now` so “both adapters match” in this rename.

6. **Leave sibling modules alone.** Skipped `types.ts` owns `LeaseStore`. Later `testing.ts` owns the fake. Later `schema.ts` owns `fencedLeaseFields` (unused today — later pass). Already-recommended drain / worker / rematch own which scope to name. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `claimThisNamedScopeUntilTheClock`, `keepThisNamedScopeAliveOnlyWhileThisOwnerStillHoldsIt`, `giveThisNamedScopeBack`, `proveThisOwnerStillHoldsThisNamedScope`.

Today’s folder test never constructs `MongoLeaseStore`. That is not enough for the Mongo **adapter**.

Add tests that name the operation (Mongo proofs may stay replica-gated; an injected fake model is enough for the fence):

**Claim**
- Free / expired / missing clock → token, `epoch` is previous + 1 (or 1 on insert).
- Live holder → `null`, epoch unchanged.
- Unique-scope `11000` → `null`, not a throw.
- Blank scope, blank owner, or `ttl_ms <= 0` → `TypeError`.
- Stored row missing owner / clock / positive integer epoch → throw, do not hand a half token.

**Renew / prove / give back**
- Matching owner + epoch + live clock → new `leased_until`, same epoch.
- Stale owner, stale epoch, or expired clock → renew `null`, prove `false`, release `false`.
- Release match → owner null, `leased_until === now`, `true`.
- Stale token cannot clear a successor who already claimed the next epoch.

**Out of scope for this interface**
- This file does not import `SheetSyncLease`.
- This file does not pick `sheet-sync:drain` / `ingestion:best_relocation:apply` / `granot:automation:account` / `booking-reconciliation:rematch`.
- This file does not claim a run, a job, a receipt, or the Call Log singleton.

Do **not** add a test per helper (`duplicateUniqueScope`, `refuseABlankScopeOwnerOrTtl`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The class stays exported because `LeaseStore` is a real **adapter** seam (Mongo vs later in-memory), not a test leak.

## What I would not do

- A `DurableLeaseService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder (`acquire.ts` / `renew.ts` / `release.ts`) for cleanliness.
- Breaking the live-fence **seam**. A stale token must not renew, release, or prove hold.
- Treating RingCentral Call Log claim, Granot receipt claim, Lead Messaging sending, or `ReportingRun` embedded lease as this story.
- Inventing a per-tab **seam** that has only the `SheetSyncLease` comment as an **adapter**.
- Silently renaming `sheet_sync_leases` or importing `SheetSyncLease` here so “the collection name matches the callers.”
- Jumping to `checksum.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
