# Claim The Confirmed Run Under A Five-Minute Lease, Advance Only The Graph This Owner Still Holds, Stamp Source-Read-Through Once, Honor Cancel Until Promoting, And Never Leak An Unsafe Failure — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 15 of this service — `reportingRunRepository.ts`
- Remaining in this service: `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reportingRunRepository.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Source read-through is captured by the worker under the active lease owner/epoch. Cron: `/api/cron/reporting-delivery-heartbeat` wakes stranded leased runs. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Knowledge never names this file, `claimNextQueuedReportingRun`, `STATUS_GRAPH`, `REPORTING_FAILURE_CODES`, cancel-at-safe-point, `modifiedCount` vs `matchedCount`, or the mongoose “narrow Stage 4 repository” hooks — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**creates** the `queued` row via mongoose `ReportingRun.create` inside leftover confirm’s transaction; leftover replay `findById`s mongoose; this file **never inserts**). Distinct from already-recommended leftover claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** claim / renew / release / capture / transition / checkpoint / stream-reopen / cancel-at-safe-point / `reportingFailure`; leftover `requireLease` / `requireTransition` / `requireCheckpoint` wrap this file). Distinct from already-recommended leftover wake-up: [`reporting-queue.md`](reporting-queue.md) (leftover first confirm and leftover Owner cancel **ask** `publishReportingWakeup` **after** the run row / cancel request already exist; leftover heartbeat finds a stranded row itself and **asks** leftover queue, never this file). Distinct from leftover delivery persist: sibling `reportingDeliveryRepository.ts` (**asks** `assertSafeReportingFailure` before leftover fenced delivery patch / leftover snapshot completion). Distinct from leftover Wave B `src/models/ReportingRun.ts` (schema + mongoose hooks that **throw** on `updateOne` / `findOneAndUpdate` / `save` of an existing row / `bulkWrite` — “mutations require the narrow Stage 4 repository”). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner `POST .../runs/:id/cancel` **asks** `requestReportingRunCancellation`; leftover `safeReportingRunForRead` **asks** `safeReportingFailureForRead` and never `loadReportingRun`). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (heartbeat `ReportingRun.collection.findOne`s the oldest unleased live row and publishes; leftover health-scan lists active runs; neither claims). Distinct from later Wave A `durableWork/` (leftover model spreads `durableRunControlFields`; this file implements lease / transition itself and does **not** **ask** `durableWork/leases.ts`). Distinct from already-recommended leftover RingCentral account lease: [`ringcentral-call-log-sync-state-store.md`](ringcentral-call-log-sync-state-store.md) (one `key: "account"` row; cursor only on full success). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingWorker.ts` (**asks** `claimNextQueuedReportingRun` with leftover five-minute `LEASE_TTL_MS` and `cancellationOnly: !deliveryEnabled`; `loadReportingRun`; `renewReportingRunLease`; `releaseReportingRunLease`; `captureReportingSourceReadThrough`; `transitionReportingRun`; `checkpointReportingRun`; `streamCheckpointFromRun`; `applyReportingRunCancellationAtSafePoint`; `reportingFailure`). Wave B leftover `src/routes/reporting.routes.ts` (**asks** `requestReportingRunCancellation`; `safeReportingFailureForRead` on leftover Owner run DTO). Leftover `reportingDeliveryRepository.ts` (**asks** `assertSafeReportingFailure` only). Tests: leftover `reporting.test.ts` **asks** `reportingFailure` / `assertSafeReportingFailure` / `safeReportingFailureForRead` (unsafe `raw_payload` / rewritten `summary` / nested metadata → throw / `null`; leftover Owner DTO `failure` is `null`) plus `reportingSourceCaptureFilter` shape and `reportingCheckpoint` (`version: pageNumber + 1`, hard-coded `phase: "querying"`). Leftover `reportingDelivery.test.ts` **asks** `reportingFailure` / `assertSafeReportingFailure` for `PROVIDER_UNAVAILABLE` / `LEASE_LOST` / `PROMOTION_AMBIGUOUS`. Leftover `reportingDelivery.regressions.test.ts` **asks** `requestReportingRunCancellation` with `idempotencyKey: "short"` (throw + typeof) and `reportingFailure("PROVIDER_UNAVAILABLE")` as leftover worker error. **No runtime caller** for `acquireReportingRunLease` except `claimNextQueuedReportingRun`. **No runtime caller** for `reportingSourceCaptureFilter` / `reportingCheckpoint` except leftover capture / leftover transition / leftover checkpoint + leftover tests. Leftover confirm / leftover heartbeat / leftover health-scan / leftover live harness **do not import this file**.
- Seams callers need: leftover confirm-insert (mongoose `create` of a `queued` row) vs leftover Stage-4 native `.collection` mutate (mongoose hooks throw); leftover claim find-then-acquire vs leftover heartbeat find-then-wakeup (leftover cron never claims); leftover renew `matchedCount === 1` vs leftover transition / leftover capture `modifiedCount === 1` (identical renew must not look like `LEASE_LOST`; identical status write misses); leftover cancel-request vs leftover cancel-apply (`promoting` may record `cancel_requested`; leftover graph forbids `promoting → cancelled`; leftover worker `honorACancelUntilPromoting` returns false during `promoting`); leftover failure catalog vs leftover worker `disposeWorkerError` (leftover worker maps errors **to** `reportingFailure`; this file refuses unsafe envelopes on persist and leftover Owner read). There is no begin / complete Domain Command **seam**. There is no leftover Google write **seam**. There is no leftover Analytics **seam**. There is no leftover Sheet Sync **seam**. There is no leftover `durableWork` elect **seam** — do not open that unvisited folder.
- Split later (only if the file outgrows one sitting): this ~695-line file is one sitting if you read it as claim the confirmed run under a five-minute lease, advance only the graph this owner still holds, stamp source-read-through once, honor cancel until promoting, and never leak an unsafe failure. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `lease.ts` / `transition.ts` / `cancel.ts` / `failure.ts` so “each persist verb owns a file.” Do **not** pull leftover confirm insert / leftover worker Google write / leftover delivery fence / leftover queue poke here so “one run file owns the company.” If it later splits: `claimTheOldestUnleasedRun.ts` / `advanceTheRunOnlyAlongTheAllowedGraph.ts` / `recordTheOwnersCancelRequest.ts` only as later story files, never CRUD.

`acquireReportingRunLease` / `transitionReportingRun` / `requestReportingRunCancellation` are executor mechanics. The owner question is: *I already confirmed the run. It is sitting in Mongo as queued. Claim the oldest live run that has no live lease — or take it back if the five minutes expired, or if this same owner still holds it. Prefer the run hint the consumer forwarded, but Mongo still elects whoever is due. Keep the lease alive only while this owner and this epoch still hold it — a no-op renew is still held. Stamp source-read-through once while the run is still queued. Move status only along queued → querying → writing → verifying → promoting → completed, or failed / cancelled where the graph allows it, and only while the lease is still live. Remember the page checkpoint without changing status. When I click Cancel, record the request under an idempotency key — do not interrupt promoting. The worker honors the cancel at queued / querying / writing / verifying. If something fails, persist only a closed-catalog sentence — never a customer name, a phone, or a rewritten summary. Do not create the run. Do not write Google. Do not publish the poke.*

Leftover confirm insert, leftover worker Google write, leftover delivery fence, leftover queue poke, leftover heartbeat find already live in other **modules**. Do not pull those in.

## What this file actually does

Eight operations of one “claim the confirmed run under a five-minute lease, advance only the graph this owner still holds, stamp source-read-through once, honor cancel until promoting, and never leak an unsafe failure” story, not “a run CRUD repository,” and not leftover confirm insert or leftover worker Google write:

1. **Hand the owner a closed, safe failure envelope** — `REPORTING_FAILURE_CODES` / `reportingFailure` / `assertSafeReportingFailure` / `safeReportingFailureForRead`. Fourteen codes. `summary` and `retryable` are fixed from the catalog. Metadata keys are allowlisted (`phase`, `model`, counts / ids / `remediation`). Extra keys (`raw_payload`), a rewritten `summary`, nested objects, negative numbers, or an unknown `phase` / `model` throw. Leftover Owner read returns `null` instead of throwing. Leftover delivery persist **asks** `assertSafeReportingFailure` before a fenced delivery patch. This is not leftover worker `disposeWorkerError`.

2. **Claim the oldest unleased live run under a five-minute lease** — `claimNextQueuedReportingRun` then `acquireReportingRunLease`. Find oldest `{ created_at, _id }` among live statuses (`queued` / `querying` / `writing` / `verifying` / `promoting`) whose lease is missing, expired, or already this owner. Optional `runHint` is `{ _id }` — a preference, not a Granot job id. Optional `cancellationOnly` requires `cancellation_requested_at` (leftover worker when Google delivery is off). Then acquire: same live-status + lease `$or`, `$set` owner / `leased_until` / `last_attempt_at`, `$inc` `lease_epoch` and `attempt_count`. Miss → `null`. Reload via `loadReportingRun`. `acquireReportingRunLease` has **no other runtime caller**. Invalid owner / `ttlMs` throw. This file does not insert the row leftover confirm already wrote.

3. **Keep the lease alive only while this owner and epoch still hold it** — `renewReportingRunLease` / `releaseReportingRunLease`. Renew fence: `{ _id, lease_owner, lease_epoch, leased_until: { $gt: now } }`. Returns `matchedCount === 1` so an identical `now + ttl` does not look like `LEASE_LOST` (comment in source). Release clears `lease_owner` / `leased_until` and does not change status. Leftover worker `requireLease` throws leftover `LeaseLostError` on miss. Leftover worker releases after success / cancel / retryable abandon / terminal fail.

4. **Stamp source-read-through once while the run is still queued** — `captureReportingSourceReadThrough`. Match `reportingSourceCaptureFilter`: `status: "queued"`, this owner + epoch, live lease, both `source_read_through` and `query_plan_checksum` still `null`. Writes the instant and a 64-hex plan checksum (lowercased). `modifiedCount === 1`. Leftover worker treats a miss as resume if another attempt already stamped; otherwise leftover `LeaseLostError`. Invalid dates / checksum / epoch throw.

5. **Advance the run only along the allowed graph while this lease still holds** — `transitionReportingRun`. `STATUS_GRAPH`: `queued → querying | failed | cancelled`; `querying → writing | failed | cancelled`; `writing → verifying | failed | cancelled`; `verifying → promoting | failed | cancelled`; `promoting → completed | failed` (**not** `cancelled`); terminals have no exits. Illegal pair throws. Fence is `_id` + `expectedStatus` + owner / epoch / live lease. Optional checkpoint / counters / `finalDataChecksum` / failure (asserted when present). `queued → querying` stamps `started_at`. Terminal next stamps `completed_at`. Returns `modifiedCount === 1` — an identical status write misses. Leftover worker `requireTransition` then reloads: lease gone → leftover `LeaseLostError`; already at-or-past next → swallow; else leftover `PhaseSkipError`.

6. **Remember the page checkpoint without changing status** — `checkpointReportingRun` / `reportingCheckpoint` / `streamCheckpointFromRun`. Same lease fence as leftover transition. `reportingCheckpoint` writes `version: pageNumber + 1`, hard-coded `phase: "querying"`, snake_case cursor, `completed_units: rowCount`. Leftover stream-reopen rebuilds leftover `ReportingStreamCheckpointV1` from leftover `checkpoint.cursor` or returns `undefined`. Leftover worker `requireCheckpoint` throws leftover `LeaseLostError` on miss.

7. **Record the owner's cancel request without interrupting promotion** — `requestReportingRunCancellation`. Idempotency key required (trim, length ≥ 8). Missing run → `not_found`. Same key + persisted `cancellation_result` replays. A different key already bound returns that prior result (or `already_requested`). Terminal status → `already_terminal` and persist. `cancellation_requested_at` already set → `already_requested` and persist. Else CAS: live status + `cancellation_requested_at: null` + key null-or-same; stamp requested-at / actor / key / `{ status: "cancel_requested", runStatus }`. Promoting is included in the live-status match so the request is recorded, but leftover graph and leftover worker refuse to apply it there. Leftover Owner route **asks** leftover queue poke after `cancel_requested` / `already_requested`.

8. **Honor the cancel at a safe point under this lease** — `applyReportingRunCancellationAtSafePoint`. Expected status is only `queued` / `querying` / `writing` / `verifying`. Fence: this owner + epoch + live lease + `cancellation_requested_at` set. `$set` `cancelled`, `completed_at`, leftover `reportingFailure("RUN_CANCELLED")` (`queued` maps phase to `querying`). `modifiedCount === 1`. Leftover worker `honorACancelUntilPromoting` returns false during `promoting` and leftover `LeaseLostError` if the apply misses and status is not already `cancelled`. Then leftover worker **asks** leftover fenced delivery cancel.

`loadReportingRun` is the worker’s re-read, not a ninth owner operation and not leftover Owner HTTP (Wave B leftover `safeReportingRunForRead`). Unused `mongoose` import is not an operation.

## Organization

Keep one file. This is the screenplay for “claim the confirmed run under a five-minute lease, advance only the graph this owner still holds, stamp source-read-through once, honor cancel until promoting, and never leak an unsafe failure.” Leftover confirm insert, leftover worker Google write, leftover delivery fence, leftover queue poke, leftover heartbeat find already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingRunRepository` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover confirm-insert **adapter**. Do not invent a second leftover heartbeat-claim **adapter**. Do not invent a leftover `durableWork` elect **adapter** beside this file’s own lease.

Do not split claim / transition / cancel / failure into CRUD files. Claim and leftover acquire stay together because leftover worker only **asks** leftover `claimNextQueuedReportingRun`. Cancel-request and cancel-apply stay together because leftover `promoting` is the **seam**. Do not start leftover `ReportingRun.create` from this file so “one persist owns insert.” Do not start leftover `publishReportingWakeup` from this file so “cancel owns the poke.” Do not go through mongoose `findOneAndUpdate` so “we match leftover destination persist” — leftover model hooks throw.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `reportingFailure` | `paintASafeFailureFromTheClosedCatalog` | leftover worker maps errors; leftover delivery persist asserts |
| `assertSafeReportingFailure` | `refuseUnlessThisFailureIsTheClosedCatalog` | leftover persist / leftover delivery fence |
| `safeReportingFailureForRead` | `hideAnUnsafeFailureFromTheOwner` | leftover Owner run DTO |
| `REPORTING_FAILURE_CODES` | `REPORTING_FAILURE_CODES` | closed catalog; leftover tests compare `summary` |
| `claimNextQueuedReportingRun` | `claimTheOldestUnleasedRun` | leftover worker only |
| `acquireReportingRunLease` | `takeThisRunUnderAFiveMinuteLease` | exported; only leftover claim **asks** it |
| `renewReportingRunLease` | `keepTheLeaseAliveOnlyWhileThisOwnerAndEpochStillHoldIt` | leftover worker `requireLease` |
| `releaseReportingRunLease` | `clearTheLeaseWithoutChangingStatus` | leftover worker after every disposition |
| `captureReportingSourceReadThrough` | `stampSourceReadThroughOnceWhileStillQueued` | leftover worker first capture |
| `reportingSourceCaptureFilter` | `theQueuedLeaseCaptureMatch` | leftover tests prove the fence |
| `transitionReportingRun` | `advanceTheRunOnlyAlongTheAllowedGraph` | leftover worker `requireTransition` / leftover `failRun` |
| `checkpointReportingRun` | `rememberThePageCheckpointWithoutChangingStatus` | leftover worker `requireCheckpoint` |
| `reportingCheckpoint` | `foldThePageCursorIntoTheRunCheckpoint` | leftover tests prove `phase: "querying"` |
| `streamCheckpointFromRun` | `reopenThePageCheckpointFromThisRun` | leftover worker resume |
| `requestReportingRunCancellation` | `recordTheOwnersCancelRequest` | leftover Owner cancel route |
| `applyReportingRunCancellationAtSafePoint` | `honorTheCancelAtASafePointUnderThisLease` | leftover worker; not leftover `promoting` |
| `loadReportingRun` | `loadThisRunRow` | leftover worker re-read; not leftover Owner HTTP |

Keep the old names as one-line aliases until leftover `reportingWorker.ts`, leftover `reporting.routes.ts`, leftover `reportingDeliveryRepository.ts`, leftover `reporting.test.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover confirm learn leftover `claimTheOldestUnleasedRun` as insert. Do not make leftover heartbeat learn leftover `claimTheOldestUnleasedRun` as drain. Do not make leftover Owner HTTP learn leftover `loadThisRunRow` as the DTO.

**Principle: old exports stay as aliases.** `claimNextQueuedReportingRun` remains the imported name until leftover worker points at the story name.

**No class for the workflow.** The types that *do* earn names are the lease handoff leftover worker already reads, the closed failure bag leftover Owner already sees, and the cancel result leftover route already echoes:

```ts
type ReportingLease = { owner: string; epoch: number; leasedUntil: Date }

type SafeReportingFailure = {
  code: ReportingFailureCode
  summary: string          // fixed from the catalog
  retryable: boolean       // fixed from the catalog
  metadata: { /* allowlisted scalars only */ }
}

type ReportingCancelResult = {
  status: "cancel_requested" | "already_terminal" | "already_requested" | "not_found"
  runStatus?: ReportingRunStatus
}
```

That is the handoff from “leftover confirm queued a run” to “leftover worker may write, leftover Owner may cancel, leftover Owner may read a safe sentence.” Do **not** put leftover execution-package destination credentials on leftover `loadThisRunRow`. Do **not** move leftover `durableWork` leftover lease token into this file so “every Vantage lease looks the same.” Do **not** add leftover `queued` to leftover `STATUS_GRAPH.promoting`.

There is no deps bag today. Do not invent `ClaimTheOldestUnleasedRunDeps` unless a later test **adapter** needs to inject leftover `ReportingRun.collection`. Default remains leftover native collection.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingRunRepository.ts
// The owner already confirmed the run.
// It is sitting in Mongo as queued.
// Claim the oldest live run that has no live lease.
// Keep the lease alive only while this owner and epoch still hold it.
// Stamp source-read-through once while still queued.
// Advance only along the allowed graph.
// Remember the page checkpoint without changing status.
// Record Cancel under an idempotency key — do not interrupt promoting.
// Honor the cancel at queued / querying / writing / verifying.
// Persist only a closed-catalog sentence.
// Do not create the run.
// Do not write Google.
// Do not publish the poke.
// Mongoose hooks throw if you mutate an existing row the ordinary way.

// ── 1. Hand the owner a closed, safe failure envelope ─────

export function paintASafeFailureFromTheClosedCatalog(code, metadata)
export function refuseUnlessThisFailureIsTheClosedCatalog(value)
export function hideAnUnsafeFailureFromTheOwner(value) // null if unsafe

// ── 2. Claim the oldest unleased live run ─────────────────

export async function claimTheOldestUnleasedRun(input)
export async function takeThisRunUnderAFiveMinuteLease(input) // only claim asks
export async function loadThisRunRow(runId)

// ── 3. Keep the lease alive only while this owner holds it ─

export async function keepTheLeaseAliveOnlyWhileThisOwnerAndEpochStillHoldIt(input)
// matchedCount === 1; identical now+ttl is still held
export async function clearTheLeaseWithoutChangingStatus(input)

// ── 4. Stamp source-read-through once while still queued ──

export async function stampSourceReadThroughOnceWhileStillQueued(input)
export function theQueuedLeaseCaptureMatch(input) // both capture fields still null

// ── 5. Advance only along the allowed graph ───────────────

export async function advanceTheRunOnlyAlongTheAllowedGraph(input)
// promoting cannot become cancelled; modifiedCount === 1

// ── 6. Remember the page checkpoint without changing status

export async function rememberThePageCheckpointWithoutChangingStatus(input)
export function foldThePageCursorIntoTheRunCheckpoint(checkpoint, now)
export function reopenThePageCheckpointFromThisRun(run)

// ── 7. Record the owner's cancel request ──────────────────

export async function recordTheOwnersCancelRequest(input)
// promoting may record; it may not apply

// ── 8. Honor the cancel at a safe point ───────────────────

export async function honorTheCancelAtASafePointUnderThisLease(input)
// queued | querying | writing | verifying only
```

Read the leftover worker path out loud: *claim the oldest unleased live run under a five-minute lease. Renew before each long step — a no-op renew is still held. Stamp source-read-through once while still queued. Advance queued → querying → writing → verifying → promoting → completed only while this owner and epoch still hold the lease. Remember each page checkpoint without changing status. If the owner already asked to cancel, honor it until promoting. If the lease is gone, leave checkpoints. Persist only a closed-catalog sentence.*

Read the leftover Owner cancel path out loud: *record the cancel request under this idempotency key. Replay the same key. Do not change status here. If the run is already promoting, still remember that I asked — the worker will not interrupt the rename. Then leftover Owner route **asks** leftover queue poke.*

That is the operation. `transitionReportingRun` is not.



## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **This file never inserts a run.** Leftover confirm in `reporting.service.ts` creates the `queued` row with mongoose. Do not move that insert here and do not switch these mutates to mongoose — Wave B `ReportingRun.ts` hooks throw on mutate of an existing row. The native `.collection` path is the Stage 4 contract.

2. **Claim is find-then-acquire, not one atomic `$or`.** `claimNextQueuedReportingRun` finds the oldest unleased live run, then `acquireReportingRunLease`. If acquire returns null, claim returns null. Do not silently retry the next candidate. Heartbeat in leftover `reportingHeartbeat.ts` finds the same way and never claims.

3. **Renew uses `matchedCount`; transition and capture use `modifiedCount`.** A no-op renew that writes the same `now + ttl` must still succeed. A no-op transition or a second capture must fail. Do not unify the two.

4. **`promoting` cannot become `cancelled`.** `STATUS_GRAPH` and `applyReportingRunCancellationAtSafePoint` both exclude it. Do not add `cancelled` to that edge. The Owner request may still record while promoting.

5. **`reportingCheckpoint` hard-codes `phase: "querying"`.** Workers that checkpoint later phases still persist `querying`. Do not silently fix the phase while renaming.

6. **`acquireReportingRunLease` has no other runtime caller.** Only claim uses it. Do not have heartbeat acquire a lease. The unused `mongoose` import can drop on rename; do not start using it.

7. **Leave sibling files alone.** Confirm insert stays in leftover `reporting.service.ts`. Google write stays in leftover `reportingWorker.ts`. Delivery fence stays in leftover `reportingDeliveryRepository.ts`. Queue poke stays in leftover `reportingQueue.ts`. Heartbeat find stays in leftover `reportingHeartbeat.ts`. Do not open unvisited `durableWork/`.

## Testing

The interface is the story-named exports, not the helpers.

Keep the existing tests that already lock this file: the fourteen-code failure envelope (`assertSafeReportingFailure` / `safeReportingFailureForRead`), the source-capture filter (both fields still null), the checkpoint shape (`phase: "querying"`), and the short-key cancel request in `reportingDelivery.regressions.test.ts`.

Add Mongo `TEST_MODE` proofs at the new names:

- claim oldest unleased live run, then fail when acquire loses
- renew succeeds on `matchedCount === 1` even when `until` is unchanged
- `STATUS_GRAPH` forbids `promoting → cancelled` and every other missing edge
- source-read-through stamps once; a second call returns null
- cancel request records while promoting; `expectedStatus` type forbids apply at `promoting`
- apply at `queued|querying|writing|verifying` is the only path that writes `cancelled`

Do not add helper-unit tests for `reportingFailure` construction or `streamCheckpointFromRun`. Do not boot live Google, the queue publisher, or leftover confirm.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/ReportingRun.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingRunRepository` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not move confirm's mongoose insert into this file or switch these mutates to mongoose.
- I would not unify renew `matchedCount` with transition `modifiedCount`.
- I would not add `cancelled` to the `promoting` graph edge.
- I would not have leftover heartbeat acquire a lease.
- I would not open unvisited `durableWork/`.
- I would not silently reorder ADR-known side effects.
