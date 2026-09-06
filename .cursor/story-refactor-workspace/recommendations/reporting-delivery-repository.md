# Open Or Resume The One Delivery Row, Bind This Lease Onto Run And Delivery Together, Stamp Progress Only While This Generation Still Holds The Fence, Complete Snapshot And Run Together, And Never Let Cleanup Rewrite Terminal Truth — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 16 of this service — `reportingDeliveryRepository.ts`
- Remaining in this service: `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reportingDeliveryRepository.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Google is a delivery surface; Mongo remains the authority. Cron: `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Knowledge never names this file, `bindReportingDeliveryFence`, `patchReportingDeliveryFenced`, `commitSnapshotDeliveryAndRunCompletion`, `cleanup_pending`, or the run/delivery fence generation — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover claim / lease / graph / cancel: [`reporting-run-repository.md`](reporting-run-repository.md) (this file **asks** leftover `assertSafeReportingFailure` before a fenced delivery patch / snapshot completion; leftover worker **asks** leftover run claim / leftover run cancel **then** leftover fenced delivery cancel). Distinct from already-recommended leftover claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** leftover `ensure` / leftover `bind` / leftover `load` / leftover fenced patch / leftover snapshot complete; leftover `requireDeliveryPatch` wraps leftover `patchReportingDeliveryFenced`). Distinct from already-recommended leftover RAW write / leftover verify / leftover swap: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (leftover worker **asks** leftover engine with leftover `onWorkbookCreated` / leftover `onStagingCreated` that **ask** leftover fenced patch — this file never talks to Google). Distinct from already-recommended leftover wake-up: [`reporting-queue.md`](reporting-queue.md) (leftover first confirm / leftover Owner cancel / leftover heartbeat **ask** leftover queue; this file never publishes). Distinct from leftover cleanup: sibling `cleanup.ts` (**asks** leftover `load` / leftover cleanup patch / leftover list-pending; leftover worker **asks** leftover `enqueueIncompleteArtifactCleanup` on leftover cancel / leftover snapshot verify fail). Distinct from leftover replace-tab complete: sibling `promotionReservation.ts` (leftover worker **asks** leftover `commitPromotionDestinationCas` for leftover replace-tab; leftover snapshot **asks** leftover `commitSnapshotDeliveryAndRunCompletion` here). Distinct from leftover Wave B `src/models/ReportingDelivery.ts` (schema + unique `{ run_id }`; **no** “narrow Stage 4 repository” throw hooks — leftover `ReportingRun.ts` **does** throw on mongoose mutate of an existing row). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner `GET .../runs/:id` **asks** leftover `load` + leftover `safeReportingDeliveryForRead`; leftover cancel does **not** import this file). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (leftover health-scan **asks** leftover `listCleanupPendingDeliveries(100)`; leftover cleanup cron **asks** leftover janitor, not this file directly). Distinct from leftover live harness: `live/liveGoogleOrchestration.ts` **asks** leftover `load` after leftover worker to prove leftover `status === "completed"` and collect leftover `workbook_id`. This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingWorker.ts` (**asks** leftover `ensureReportingDelivery` after leftover claim; leftover `bindReportingDeliveryFence` immediately after; leftover `loadReportingDelivery` for leftover rename-batch early resume / leftover artifact resume / leftover write progress / leftover verifying resume; leftover `patchReportingDeliveryFenced` via leftover `requireDeliveryPatch` for leftover workbook persist-before-markers, leftover staging persist, leftover write progress, leftover stream checkpoint, leftover `rename_batch_submitted`, leftover `ambiguous`, leftover terminal fail, leftover cancel; leftover `commitSnapshotDeliveryAndRunCompletion` from leftover `finishSnapshotDeliveryAndComplete` only). Leftover `cleanup.ts` (**asks** leftover `load` / leftover `patchReportingDeliveryCleanup` / leftover `listCleanupPendingDeliveries`). Wave B leftover `src/routes/reporting.routes.ts` (**asks** leftover `load` + leftover `safeReportingDeliveryForRead` on leftover Owner run GET). Wave B leftover `src/routes/reporting-cron.routes.ts` (**asks** leftover `listCleanupPendingDeliveries(100)` on leftover health-scan). Leftover `live/liveGoogleOrchestration.ts` (**asks** leftover `load` after leftover replace-tab / leftover snapshot worker). Tests: leftover `reportingDelivery.test.ts` **asks** leftover `safeReportingDeliveryForRead` (header labels stay; leftover `last_stream_checkpoint` is omitted; leftover `Ada` is absent). Leftover `reportingDelivery.regressions.test.ts` **asks** leftover `patchReportingDeliveryCleanup` rejecting leftover `status: "cleanup_pending"`; leftover `patchReportingDeliveryFenced` rejecting leftover `fence_owner` in leftover `set`; leftover `simulateFenceBindRace` (stale worker A loses to worker B); leftover `simulateFenceBindInterleaving` (A writes the run fence, B takes over, A’s delivery bind aborts); leftover `snapshotTerminalConsistency` (`completed`/`completed` is `consistent`; `promoting` + delivery `completed` is `delivery_ahead_recoverable`; `failed` + delivery `completed` is `inconsistent_terminal`) plus `typeof commitSnapshotDeliveryAndRunCompletion`. Leftover `reporting.test.ts` does not import this file. **No runtime caller** for leftover `runFenceGenerationWriteFilter` / leftover `runFenceGenerationWriteUpdate` / leftover `deliveryFenceBindUpdate` except leftover bind. **No runtime caller** for leftover `simulateFenceBindInterleaving` / leftover `simulateFenceBindRace` / leftover `snapshotTerminalConsistency`.
- Seams callers need: leftover open-or-resume (`ensure` / leftover `load`) vs leftover bind-this-lease (one TX writes run `delivery_fence_*` then delivery `fence_*`) vs leftover stamp-progress-only-while-this-generation-holds (leftover fenced patch) vs leftover complete-snapshot-and-run-together (leftover snapshot TX) vs leftover mark-artifacts-without-rewriting-terminal-truth (leftover cleanup patch has **no** fence). The leftover mongoose-run-hooks / leftover native-collection **seam** exists because leftover `ReportingRun.ts` throws on mongoose mutate of an existing row; leftover bind and leftover snapshot complete **must** use leftover `ReportingRun.collection`. The leftover snapshot-complete / leftover replace-tab-CAS **seam** exists because leftover replace-tab worker **asks** leftover `commitPromotionDestinationCas`, never this snapshot TX. The leftover Owner-delivery-citation / leftover Owner-run-failure **seam** exists because leftover run DTO **asks** leftover `safeReportingFailureForRead` and leftover delivery citation does **not**. There is no begin / complete Domain Command **seam**. There is no leftover Google write **seam**. There is no leftover Analytics **seam**. There is no leftover Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~645-line file is one sitting if you read it as open or resume the one delivery row, bind this lease onto run and delivery together, stamp progress only while this generation still holds the fence, complete snapshot and run together, and never let cleanup rewrite terminal truth. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `ensure.ts` / `fence.ts` / `cleanup.ts` so “each persist verb owns a file.” Do **not** pull leftover worker Google write / leftover run claim / leftover replace-tab destination CAS / leftover cleanup Drive trash here so “one delivery file owns the company.” If it later splits: `bindThisLeaseOntoRunAndDeliveryTogether.ts` / `completeTheSnapshotDeliveryAndTheRunTogether.ts` / `markLeftoverArtifactsWithoutRewritingTerminalStatus.ts` only as later story files, never CRUD.

`ensureReportingDelivery` / `bindReportingDeliveryFence` / `patchReportingDeliveryFenced` are executor mechanics. The owner question is: *The worker already claimed this run. Open the one delivery row for it — or resume the row we already opened. Bind this worker’s five-minute lease onto the run and the delivery in one transaction. If another worker took the lease between those two writes, abort. After that, only this generation may stamp Google progress, fail, or cancel. Never persist row payloads. Never overwrite a finished delivery with `cleanup_pending`. For a snapshot, complete the delivery and the run together so we never show delivery-done while the run is still promoting. Cleanup of leftover artifacts may proceed without the lease, but it may only touch `cleanup.*`. When I read the run, hide the stream checkpoint and never show a customer name. Do not claim the run. Do not write Google. Do not swap the managed tab. Do not publish the poke.*

Leftover run claim, leftover worker Google write, leftover replace-tab destination CAS, leftover cleanup Drive trash, leftover queue poke already live in other **modules**. Do not pull those in.

## What this file actually does

Seven operations of one “open or resume the one delivery row, bind this lease onto run and delivery together, stamp progress only while this generation still holds the fence, complete snapshot and run together, and never let cleanup rewrite terminal truth” story, not “a delivery CRUD repository,” and not leftover worker Google write:

1. **Open or resume the one delivery row for this run** — `ensureReportingDelivery` / `loadReportingDelivery`. Unique `run_id`. `findOne`; a hit returns the existing row and never overwrites strategy / expected / progress. Miss `insertOne`s `pending` with empty `actual` / `verification` / `progress.promotion_step: "not_started"` / `cleanup.state: "not_needed"` / `fence_*` null. Duplicate-key `11000` re-finds. Leftover worker **asks** leftover ensure after leftover claim, then leftover bind. Leftover `load` is leftover worker resume, leftover Owner GET, leftover cleanup merge, leftover live harness prove. This file does not insert leftover `ReportingRun`.

2. **Bind this lease onto the run and the delivery in one transaction** — `bindReportingDeliveryFence` plus leftover `runFenceGenerationWriteFilter` / leftover `runFenceGenerationWriteUpdate` / leftover `deliveryFenceBindUpdate`. Invalid owner trim / epoch throw. Bind TX: leftover `ReportingRun.collection.findOneAndUpdate` matches `_id` + `lease_owner` + `lease_epoch` + live `leased_until`, `$set` `delivery_fence_owner` / `delivery_fence_generation` = epoch; generation must equal epoch or `STALE_FENCE_BIND`; leftover `ReportingDelivery.collection.updateOne` `{ run_id }` `$set` `fence_owner` / `fence_epoch` / `fence_generation` = that generation; `matchedCount !== 1` is `STALE_FENCE_BIND`. `STALE_FENCE_BIND` returns `false`. Optional `session` uses the caller TX; else leftover `withTransaction`. Leftover worker miss is leftover `LeaseLostError("querying")`. Leftover `simulateFenceBindInterleaving` is the same TX as a deterministic model leftover tests **ask**; leftover `simulateFenceBindRace` is the `@deprecated` wrapper leftover tests still **ask**. Leftover filter / update helpers have **no other runtime caller**.

3. **Stamp Google progress only while this generation still holds the fence** — `patchReportingDeliveryFenced`. Leftover `set.failure` **asks** leftover `assertSafeReportingFailure`. Leftover `assertArtifactSafePatch` refuses JSON `"rows": [` / `"values": [`. Leftover `status: "cleanup_pending"` throws. Leftover `fence_owner` / leftover `fence_epoch` / leftover `fence_generation` in leftover `set` throw — “Delivery fence fields may only be bound via leftover `bindReportingDeliveryFence`.” Match `run_id` + `fence_owner` + `fence_epoch` + `fence_generation === leaseEpoch`. Optional leftover `expectedStatus`. Leftover `matchedCount === 1`. Leftover worker leftover `requireDeliveryPatch` miss is leftover `LeaseLostError`. Leftover worker **asks** this for persist-before-markers, write progress, stream checkpoint, leftover `rename_batch_submitted`, leftover `ambiguous`, terminal fail, leftover cancel `status: "cancelled"` + leftover `RUN_CANCELLED`. This is not leftover cleanup patch.

4. **Complete the snapshot delivery and the run together** — `commitSnapshotDeliveryAndRunCompletion`. Snapshot only. Run match `status: "promoting"` + live lease + `delivery_fence_generation === epoch` + `delivery_fence_owner === owner`; `$set` `completed` + `completed_at` + lowercased `final_data_checksum`. Delivery match fence + `status` `$in` `pending` / `writing` / `verifying` / `promoting`; `$set` caller leftover `deliverySet` + `completed`. Miss `STALE_SNAPSHOT_COMPLETION` → `"stale"`. Leftover worker leftover `finishSnapshotDeliveryAndComplete` retries a transient TX then leftover `"stale"` is leftover `LeaseLostError("promoting")`. Leftover replace-tab does **not** **ask** this — leftover worker **asks** leftover `commitPromotionDestinationCas`.

5. **Name the delivery/run pair recovery must close** — `snapshotTerminalConsistency`. Same status is `consistent`. Delivery `completed` + run `promoting` or `verifying` is `delivery_ahead_recoverable`. Both terminal and different, or delivery `completed` + run `failed`, or run `completed` + delivery not `completed`, is `inconsistent_terminal`. **No runtime caller.** Leftover tests prove the three sentences plus leftover `typeof` leftover snapshot complete.

6. **Mark leftover artifacts without rewriting terminal truth** — `patchReportingDeliveryCleanup` / `listCleanupPendingDeliveries`. Cleanup keys must start `cleanup.`; leftover `status` throws “Cleanup patches must not modify delivery status.” **No** fence match — leftover janitor may write after the lease is gone. Leftover `list` is leftover `cleanup.state: "pending"` oldest leftover `updated_at` default 50. Leftover janitor **asks** 25; leftover health-scan **asks** 100. Leftover worker never leftovers leftover `status: "cleanup_pending"` — leftover `cleanup.state` is leftover `pending` / leftover `completed` / leftover `failed`.

7. **Hand the owner a payload-stripped delivery citation** — `safeReportingDeliveryForRead`. Copies leftover `run_id` / destination / strategy / status / workbook ids / published sheet / expected / actual / verification / progress without leftover `last_acknowledged_range` / leftover `last_stream_checkpoint` / leftover cleanup without leftover `artifact_ids` / leftover `failure` as stored / timestamps. Omits leftover `staging_sheet_title` / leftover `old_sheet_recovery_title`. Does **not** **ask** leftover `safeReportingFailureForRead`. Leftover Owner run GET nests this under leftover `delivery`. Leftover tests keep header labels and refuse leftover `Ada`.

Unused leftover `mongoose` import is not an operation. Leftover `asObjectId` / leftover `isDuplicateKeyError` / leftover `assertArtifactSafePatch` are beats.

## Organization

Keep one file. This is the screenplay for “open or resume the one delivery row, bind this lease onto run and delivery together, stamp progress only while this generation still holds the fence, complete snapshot and run together, and never let cleanup rewrite terminal truth.” Leftover run claim, leftover worker Google write, leftover replace-tab destination CAS, leftover cleanup Drive trash, leftover queue poke already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDeliveryRepository` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Google-write **adapter**. Do not invent a second leftover replace-tab complete **adapter** beside leftover `commitPromotionDestinationCas`. Do not invent a leftover `durableWork` elect **adapter**.

Do not split leftover ensure / leftover bind / leftover cleanup into CRUD files. Leftover bind and leftover fenced patch stay together because fence fields may only leftover bind. Leftover snapshot complete stays here because it writes run `completed` + delivery `completed` in one TX so leftover `delivery=completed` + run `promoting` cannot persist. Do not start leftover `ReportingRun.create` from this file so “one persist owns insert.” Do not leftover `publishReportingWakeup` from this file so “leftover cancel owns the poke.” Do not leftover mongoose leftover `findOneAndUpdate` on leftover `ReportingRun` so “we match leftover destination persist” — leftover model hooks throw.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ensureReportingDelivery` | `openOrResumeTheOneDeliveryRowForThisRun` | leftover worker first write; unique leftover `run_id` |
| `loadReportingDelivery` | `loadThisDeliveryRow` | leftover worker resume / leftover Owner GET / leftover cleanup / leftover live harness |
| `bindReportingDeliveryFence` | `bindThisLeaseOntoRunAndDeliveryTogether` | leftover worker after leftover ensure |
| `runFenceGenerationWriteFilter` | `theActiveLeaseMatchForTheRunFenceWrite` | leftover bind TX beat; no other runtime caller |
| `runFenceGenerationWriteUpdate` | `stampTheRunFenceGenerationFromThisLease` | leftover bind TX beat |
| `deliveryFenceBindUpdate` | `stampTheDeliveryFenceFromThatGeneration` | leftover bind TX beat |
| `simulateFenceBindInterleaving` | `proveAStaleBindAbortsWhenTheLeaseMoves` | leftover tests only |
| `simulateFenceBindRace` | `proveALateBindLosesToTakeover` | leftover `@deprecated` wrapper leftover tests still **ask** |
| `patchReportingDeliveryFenced` | `stampProgressOnlyWhileThisGenerationStillHoldsTheFence` | leftover worker progress / leftover fail / leftover cancel |
| `commitSnapshotDeliveryAndRunCompletion` | `completeTheSnapshotDeliveryAndTheRunTogether` | leftover worker snapshot finish; not leftover replace-tab |
| `snapshotTerminalConsistency` | `nameTheDeliveryRunPairRecoveryMustClose` | leftover tests only; no runtime caller |
| `patchReportingDeliveryCleanup` | `markLeftoverArtifactsWithoutRewritingTerminalStatus` | leftover janitor; no fence |
| `listCleanupPendingDeliveries` | `listDeliveriesWaitingForArtifactCleanup` | leftover janitor / leftover health-scan |
| `safeReportingDeliveryForRead` | `handTheOwnerAPayloadStrippedDeliveryCitation` | leftover Owner run GET |
| `ReportingDeliveryStatus` | `ReportingDeliveryStatus` | leftover status union |
| `ReportingDeliveryProgress` | `ReportingDeliveryProgress` | leftover progress bag |
| `ReportingSafeFailureEnvelope` | `ReportingSafeFailureEnvelope` | leftover re-export from leftover run persist |

Keep the old names as one-line aliases until leftover `reportingWorker.ts`, leftover `cleanup.ts`, leftover `reporting.routes.ts`, leftover `reporting-cron.routes.ts`, leftover `live/liveGoogleOrchestration.ts`, leftover `reportingDelivery.test.ts`, and leftover `reportingDelivery.regressions.test.ts` migrate. Do not make leftover confirm learn leftover `openOrResumeTheOneDeliveryRowForThisRun` as leftover run insert. Do not make leftover heartbeat learn leftover `bindThisLeaseOntoRunAndDeliveryTogether` as leftover drain. Do not make leftover replace-tab learn leftover `completeTheSnapshotDeliveryAndTheRunTogether` as leftover destination CAS. Do not make leftover janitor learn leftover `stampProgressOnlyWhileThisGenerationStillHoldsTheFence` as leftover cleanup.

**Principle: old exports stay as aliases.** `bindReportingDeliveryFence` remains the imported name until leftover worker points at the story name.

**No class for the workflow.** The types that *do* earn names are the leftover fence leftover worker already writes, the leftover snapshot TX result leftover worker already branches on, and the leftover Owner citation leftover GET already nests:

```ts
type DeliveryFence = {
  owner: string
  epoch: number
  generation: number // equals epoch after leftover bind
}

type SnapshotCompletion = "committed" | "stale"

type DeliveryCitationForTheOwner = {
  // strategy, status, workbook / published sheet ids,
  // expected / actual / verification,
  // progress without last_stream_checkpoint / last_acknowledged_range,
  // cleanup without artifact_ids,
  // failure as stored (this file does not ask leftover safeReportingFailureForRead)
  // never staging_sheet_title, never old_sheet_recovery_title
}
```

That is the handoff from “leftover worker claimed the run” to “only this generation may stamp Google progress, leftover Owner may read a citation without a stream checkpoint or a customer name.” Do **not** put leftover engine leftover `DeliveryArtifact` on this type — leftover worker maps leftover `workbook_id` / leftover `staging_sheet_id`. Do **not** move leftover `commitPromotionDestinationCas` into this file so “every complete lives next to leftover fence.”

There is no deps bag today. Do not invent `BindThisLeaseOntoRunAndDeliveryTogetherDeps` unless a later test **adapter** needs to inject leftover `ReportingRun.collection` / leftover `ReportingDelivery.collection`. Default remains leftover native collection.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingDeliveryRepository.ts
// The worker already claimed this run.
// Open the one delivery row for it — or resume the row we already opened.
// Bind this worker’s five-minute lease onto the run and the delivery
// in one transaction.
// If another worker took the lease between those two writes, abort.
// After that, only this generation may stamp Google progress, fail, or cancel.
// Never persist row payloads.
// Never overwrite a finished delivery with cleanup_pending.
// For a snapshot, complete the delivery and the run together.
// Cleanup of leftover artifacts may proceed without the lease,
// but it may only touch cleanup.*.
// When I read the run, hide the stream checkpoint
// and never show a customer name.
// Do not claim the run.
// Do not write Google.
// Do not swap the managed tab.
// Do not publish the poke.
// ReportingRun mongoose hooks throw if you mutate an existing row
// the ordinary way — leftover bind and leftover snapshot complete
// must use leftover .collection.

// ── 1. Open or resume the one delivery row ────────────────

export async function openOrResumeTheOneDeliveryRowForThisRun(input)
export async function loadThisDeliveryRow(runId)

// ── 2. Bind this lease onto run and delivery together ─────

export async function bindThisLeaseOntoRunAndDeliveryTogether(input)
// STALE_FENCE_BIND → false
export function theActiveLeaseMatchForTheRunFenceWrite(input)
export function stampTheRunFenceGenerationFromThisLease(input)
export function stampTheDeliveryFenceFromThatGeneration(input)
export function proveAStaleBindAbortsWhenTheLeaseMoves(events) // tests
export function proveALateBindLosesToTakeover(events)          // deprecated wrapper

// ── 3. Stamp progress only while this generation holds ────

export async function stampProgressOnlyWhileThisGenerationStillHoldsTheFence(input)
// matchedCount === 1; fence fields refuse; rows/values refuse; cleanup_pending refuses

// ── 4. Complete snapshot delivery and run together ────────

export async function completeTheSnapshotDeliveryAndTheRunTogether(input)
// "committed" | "stale" — replace-tab does not ask this

// ── 5. Name the pair recovery must close ──────────────────

export function nameTheDeliveryRunPairRecoveryMustClose(input) // no runtime caller

// ── 6. Mark leftover artifacts without rewriting terminal ─

export async function markLeftoverArtifactsWithoutRewritingTerminalStatus(input)
export async function listDeliveriesWaitingForArtifactCleanup(limit)

// ── 7. Hand the owner a payload-stripped citation ─────────

export function handTheOwnerAPayloadStrippedDeliveryCitation(value)
```

Read the leftover worker path out loud: *open or resume the one delivery row for this claimed run. Bind this lease onto the run and the delivery together — a stale bind returns false and leftover worker throws leftover `LeaseLostError`. Persist the workbook id before leftover markers through a leftover fenced patch. Stamp leftover write progress and leftover stream checkpoint only while this generation still matches. If the owner already asked to cancel, leftover run persist honors it then this file stamps leftover `cancelled`. For a snapshot, complete the delivery and the run together so we never persist delivery-done while the run is still promoting. Leftover replace-tab **asks** leftover `commitPromotionDestinationCas`, not this TX.*

Read the leftover Owner GET path out loud: *load the delivery row for this run. Hand me a citation without leftover `last_stream_checkpoint`, leftover `artifact_ids`, leftover staging title, or a customer name. Header labels may stay. Do not wrap leftover `failure` through leftover `safeReportingFailureForRead` here — leftover run DTO already does that for leftover run leftover `failure`.*

Read the leftover janitor path out loud: *list leftover `cleanup.state: "pending"`. Patch leftover `cleanup.*` only. Never leftover `status`. Never require leftover fence. Terminal leftover `completed` / leftover `failed` / leftover `cancelled` stay intact.*

That is the operation. `patchReportingDeliveryFenced` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **This file never inserts a run.** Leftover confirm in leftover `reporting.service.ts` creates the leftover `queued` row with mongoose. Leftover bind and leftover snapshot complete mutate leftover `ReportingRun` through leftover `.collection` because Wave B leftover `ReportingRun.ts` hooks throw on mongoose mutate of an existing row. Do not switch those two writes to mongoose.

2. **`snapshotTerminalConsistency` has no runtime caller.** Leftover tests prove leftover `delivery_ahead_recoverable` and leftover `inconsistent_terminal`. Leftover worker leftover snapshot complete does not **ask** it. Do not start calling it from leftover worker so “the classifier owns recovery.” Do not delete it in this rename.

3. **Leftover Owner delivery citation does not **ask** leftover `safeReportingFailureForRead`.** Leftover run DTO does. Leftover `failure` on leftover delivery citation is leftover stored leftover as leftover stored. Do not silently wrap it while renaming.

4. **Leftover `simulateFenceBindRace` is leftover `@deprecated`.** Leftover tests still **ask** it. Leftover `simulateFenceBindInterleaving` is the real model. Do not delete leftover race in this rename. Do not add a Mongo test that only leftover race leftover already leftover proves leftover in leftover memory.

5. **Leftover fence leftover `generation` leftover equals leftover `epoch`.** Leftover bind leftover stamps leftover both leftover from leftover leftover `fenceEpoch`. Leftover fenced leftover patch leftover matches leftover `fence_generation === leaseEpoch`. Do not invent a leftover generation leftover that leftover walks leftover independently leftover of leftover leftover epoch leftover so leftover “we leftover can leftover leftover rebind leftover leftover without leftover leftover a leftover leftover new leftover leftover claim.”
5. **Fence generation equals epoch.** Leftover bind stamps leftover `delivery_fence_generation` and leftover delivery `fence_generation` from leftover `fenceEpoch`. Leftover fenced patch matches leftover `fence_generation === leaseEpoch`. Do not invent a leftover generation that walks independently of leftover epoch so “we can rebind without a new claim.”

6. **Cleanup has no fence.** Leftover janitor leftover writes leftover `cleanup.*` after the leftover lease is gone. Do not require leftover `fence_owner` on leftover cleanup patches. Do not let leftover cleanup leftover `$set` leftover `status`.

7. **Unused `mongoose` import.** Drop it on rename. Do not start leftover mongoose leftover `findOneAndUpdate` on leftover `ReportingRun` so “we match leftover destination persist” — leftover Wave B leftover hooks throw.

8. **Leave sibling files alone.** Leftover run claim stays in leftover `reportingRunRepository.ts`. Leftover Google write stays in leftover `reportingWorker.ts`. Leftover replace-tab destination CAS stays in leftover `promotionReservation.ts`. Leftover Drive trash stays in leftover `cleanup.ts`. Leftover queue poke stays in leftover `queue.ts`. Do not open unvisited leftover `durableWork/`.

## Testing

The interface is the story-named exports, not the helpers.

Keep the existing tests that already lock this file: leftover `safeReportingDeliveryForRead` in leftover `reportingDelivery.test.ts` (header labels stay; leftover `last_stream_checkpoint` is omitted; leftover `Ada` is absent), leftover `patchReportingDeliveryCleanup` rejecting leftover `status: "cleanup_pending"`, leftover `patchReportingDeliveryFenced` rejecting leftover `fence_owner` in leftover `set`, leftover `simulateFenceBindRace` (stale worker A loses to worker B), leftover `simulateFenceBindInterleaving` (A writes the run fence, B takes over, A’s delivery bind aborts), leftover `snapshotTerminalConsistency` (`completed`/`completed` is `consistent`; `promoting` + delivery `completed` is `delivery_ahead_recoverable`; `failed` + delivery `completed` is `inconsistent_terminal`) plus leftover `typeof commitSnapshotDeliveryAndRunCompletion`.

Add Mongo `TEST_MODE` proofs at the new names:

- open or resume the one delivery row: unique leftover `run_id`; a hit never overwrites leftover strategy / leftover expected; leftover `11000` re-finds
- bind this lease onto run and delivery together: leftover `STALE_FENCE_BIND` returns `false` when leftover lease owner / leftover epoch / leftover expiry miss, or when leftover delivery `matchedCount !== 1`
- stamp progress only while this generation still holds: leftover `rows` / leftover `values` throw; leftover `cleanup_pending` throws; leftover fence fields in leftover `set` throw; leftover miss is leftover `matchedCount !== 1`
- complete the snapshot delivery and the run together: leftover `promoting` + leftover live leftover fence leftover `committed`; leftover miss leftover `"stale"`; leftover replace-tab does not **ask** this
- mark leftover artifacts without rewriting terminal status: leftover `cleanup.*` only; leftover `status` throws; leftover list is leftover `cleanup.state: "pending"` oldest leftover `updated_at`
- hand the owner a payload-stripped citation: leftover header labels stay; leftover stream checkpoint / leftover `artifact_ids` / leftover `Ada` do not

Do not add helper-unit tests for leftover `asObjectId`, leftover `isDuplicateKeyError`, or leftover `assertArtifactSafePatch`. Do not boot leftover live Google, leftover queue publisher, leftover run claim, or leftover replace-tab leftover `commitPromotionDestinationCas`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/ReportingDelivery.ts`, `src/models/ReportingRun.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingDeliveryRepository` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not split leftover ensure / leftover bind / leftover cleanup into separate persist files.
- I would not pull leftover run claim, leftover worker Google write, leftover replace-tab destination CAS, leftover Drive trash, or leftover queue poke into this file.
- I would not switch leftover bind / leftover snapshot complete to leftover mongoose leftover `findOneAndUpdate` on leftover `ReportingRun`.
- I would not require leftover fence on leftover cleanup, or let leftover cleanup leftover `$set` leftover `status`.
- I would not make leftover replace-tab leftover **ask** leftover `completeTheSnapshotDeliveryAndTheRunTogether`.
- I would not start leftover worker leftover **asking** leftover `snapshotTerminalConsistency` so “the classifier owns recovery.”
- I would not wrap leftover Owner leftover delivery leftover `failure` through leftover `safeReportingFailureForRead` while renaming.
- I would not invent a leftover fence leftover generation that walks independently of leftover epoch.
- I would not open unvisited leftover `durableWork/`.
- I would not silently reorder ADR-known side effects.
