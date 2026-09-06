# Claim The Confirmed Run, Write RAW Cells Onto Staging, Verify The Checksum, Then Promote Or Publish — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 11 of this service — `reportingWorker.ts`
- Remaining in this service: `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reportingWorker.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Execution package mandates literal `RAW` spreadsheet writes, literal headers/cells, `formulasAllowed: false`. Source read-through is captured by the worker under the active lease owner/epoch. Google destination mutations and new runs stay off unless `REPORTING_GOOGLE_DELIVERY_ENABLED=true`. Queue: reporting consumer → `reportingWorker`. Cron: `/api/cron/reporting-delivery-heartbeat` wakes stranded leased runs — it publishes leftover `publishReportingWakeup`, it does **not** import this file. Knowledge never names claim, lease epoch, delivery fence, rename-batch recovery, or leftover `disposeWorkerError` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (this file **asks** leftover `assertEstimateFitsCapacity` only; leftover confirm already queued the run). Distinct from already-recommended leftover gather / paint / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (this file **asks** leftover `computeQueryPlanChecksum` when leftover source-read-through is first captured; leftover stream **asks** leftover freeze / leftover prove). Distinct from already-recommended leftover keep-the-frozen-revision: [`reporting-destination-lineage.md`](reporting-destination-lineage.md) (`resolveDestinationForWorker` with `casResumeInFlight: false`; leftover rename-batch recovery returns **before** this bind). Distinct from already-recommended leftover remember-the-destination-row: [`reporting-destination-repository.md`](reporting-destination-repository.md) (this file **asks** get + leftover health refresh; leftover promotion **asks** leftover `commitPromotionDestinationCas`, never leftover `casUpdateManagedSheetAfterPromotion`). Distinct from leftover delivery engine: sibling `deliveryEngine.ts` (create-or-resume artifact, bounded RAW write, verify staging, `promoteOrRecoverReplaceTab`, `validatePersistedManifestForResume`, `assertNoSilentTruncation`). Distinct from leftover execution stream: sibling `executionStream.ts` (`reportingStage4StreamV1.prepareManifest` / `stream`; lifecycle is capture → persist once → open reader → validate page deps → emit). Distinct from leftover run persist: sibling `reportingRunRepository.ts` (claim / lease renew / transition / checkpoint / cancel-at-safe-point). Distinct from leftover delivery persist: sibling `reportingDeliveryRepository.ts` (fence bind / fenced patch / snapshot completion). Distinct from leftover manifest persist: sibling `reportingManifestRepository.ts`. Distinct from leftover promotion: sibling `promotion.ts` (`inspectReplaceTabPromotion` / `recoveryTabTitle`) and sibling `promotionReservation.ts` (reserve / mark-applied / destination CAS). Distinct from leftover queue: sibling `queue.ts` (leftover confirm **asks** leftover `publishReportingWakeup`; Wave B heartbeat **asks** the same; this file does not publish). Distinct from leftover cleanup: sibling `cleanup.ts` (this file **asks** leftover `enqueueIncompleteArtifactCleanup` on cancel / snapshot verify fail). Distinct from leftover live harness: `live/liveGoogleOrchestration.ts` (**asks** leftover `runReportingDeliveryWorker` in-process; leftover `consumeLiveTestTransientWriteFailure` is the only reason leftover `writeBoundedReportingBatch` wraps leftover engine). Distinct from leftover Wave B `api/queues/reporting-consumer.ts` (injects Google adapters when the flag is on, then **asks** this file; leftover janitor after). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (heartbeat publishes a wakeup; it never imports this file). Distinct from already-recommended leftover Analytics dispatcher: [`analytics-analytics.md`](analytics-analytics.md). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover Wave B `api/queues/reporting-consumer.ts` (**asks** leftover `runReportingDeliveryWorker` with leftover sheets/drive when leftover `REPORTING_GOOGLE_DELIVERY_ENABLED`; without adapters when the flag is off). Leftover `live/liveGoogleOrchestration.ts` (**asks** leftover `runReportingDeliveryWorker` for leftover replace-tab / leftover snapshot / leftover transient-retry resume; leftover `live/syntheticLiveTestManifest.ts` names this file in a comment only). Tests: `reportingDelivery.regressions.test.ts` **asks** leftover `LeaseLostError` / leftover `PhaseSkipError` / leftover `disposeWorkerError` (lease-lost after promote CAS never terminal-fails; retryable `PROVIDER_UNAVAILABLE` is `retryable_abandon`; leftover phase-skip code is not leftover `LEASE_LOST`). `reportingDelivery.test.ts` **asks** leftover delivery-engine writes, not this file. `reporting.test.ts` does not import this file. **No runtime caller** for leftover `executeLeasedReportingRun`, leftover `recoverRenameBatchSubmitted`, leftover `executeReplaceTabPromotion`, leftover `finishDestinationCasAndComplete`, leftover `finishSnapshotDeliveryAndComplete`, leftover `cancelIfRequested`, leftover `failRun`.
- Seams callers need: claim-the-confirmed-run (`runReportingDeliveryWorker`) vs decide-whether-this-error-may-retry (`disposeWorkerError`). The delivery-disabled / injected-adapter **seam** exists because leftover consumer must still honor leftover cancel when leftover Google writes are off, and leftover enabled writes refuse to invent leftover Google clients. The recover-rename / live-bind **seam** exists because leftover `rename_batch_submitted` must re-inspect leftover Google before leftover `resolveDestinationForWorker`. The write / verify-promote **seam** exists because leftover phase-aware resume skips leftover RAW writes once leftover status is leftover `verifying` or later. The retryable-abandon / terminal-fail **seam** exists because leftover lease-lost and leftover retryable provider must leave leftover checkpoints / leftover reservation / leftover delivery progress intact. There is no begin / complete Domain Command **seam**. There is no leftover preview / leftover estimate / leftover confirm **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~1850-line file is one sitting if you read it as claim the confirmed run, write RAW cells onto staging, verify the checksum, then promote or publish. Do **not** split into `claim.ts` / `write.ts` / `verify.ts` / `promote.ts` so “each phase owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split `replaceTab.ts` / `snapshot.ts` so “each destination strategy owns a CRUD file.” Do **not** pull leftover delivery engine / leftover stream / leftover run persist / leftover promotion reservation here so “one worker file owns the company.” If it later splits: `claimTheConfirmedRunUnderAFiveMinuteLease.ts` / `recoverARenameGoogleAlreadyApplied.ts` / `writeRawCellsOntoStagingThenVerifyAndPromote.ts` only as later story files, never CRUD.

`runReportingDeliveryWorker` / `executeLeasedReportingRun` / `executeReplaceTabPromotion` are executor mechanics. The owner question is: *I confirmed a run. Claim it under a five-minute lease. If Google delivery is off, only honor a cancel. If it is on, bind the live destination, prove the workbook still has room, stamp source-read-through, freeze the records we used, write RAW cells onto a staging tab, verify the checksum, then either swap the managed tab or publish the snapshot workbook. If the lease is lost after Google already renamed, do not complete from the promotion step alone — re-inspect, re-verify, then CAS. A cancel is allowed until promoting. A retryable error leaves checkpoints; a terminal error marks failed. Do not preview. Do not estimate. Do not run Analytics. Do not sync the Master Sheet.*

Leftover preview / freeze / estimate / confirm, leftover paint / leftover candidate manifest, leftover destination desk, leftover delivery engine, leftover execution stream, leftover run persist, leftover promotion reservation, leftover queue wakeup, leftover Analytics, leftover Sheet Sync already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “claim the confirmed run, write RAW cells onto staging, verify the checksum, then promote or publish” story, not “a reporting worker CRUD service,” and not leftover preview desk or leftover delivery-engine batch write:

1. **Claim the next queued run under a five-minute lease** — `runReportingDeliveryWorker`. Connect Mongo. Read leftover `isReportingGoogleDeliveryEnabled`. Enabled + no leftover `deps` → throw (“requires injected Google adapters”). Mint leftover `reporting-worker:<hex>` owner. Leftover `claimNextQueuedReportingRun` with leftover `LEASE_TTL_MS` (five minutes) and leftover `cancellationOnly: !deliveryEnabled`. Empty / busy → `{ claimed: false, status: "lease_busy_or_empty" }`. Flag off: leftover `cancelIfRequested`, leftover release, return leftover `cancelled` or leftover `delivery_disabled`. Flag on: leftover `executeLeasedReportingRun`, leftover release, return leftover status. Catch leftover `disposeWorkerError`: leftover already-terminal / leftover phase-skip / leftover retryable-abandon release and return (never leftover `transitionReportingRun` to leftover `failed`); leftover terminal-fail marks leftover run + leftover delivery failed under leftover lease, then releases.

2. **Recover a replace-tab rename Google already applied** — leftover `recoverRenameBatchSubmitted`. Leftover `executeLeasedReportingRun` binds leftover delivery fence, then returns here when leftover strategy is leftover `replace_tab`, leftover `promotion_step === "rename_batch_submitted"`, and leftover `published_sheet_id` + leftover `old_sheet_id` exist. Missing leftover workbook / leftover source-read-through / leftover checksum → leftover `PROMOTION_AMBIGUOUS`. Leftover `inspectReplaceTabPromotion` must be leftover `already_promoted` or leftover fail. Re-check leftover ownership marker on leftover old sheet, leftover published title / leftover hidden, leftover run markers. Leftover `validatePersistedManifestForResume`. Leftover `verifyStagingContents` against leftover published ids. Ensure leftover reservation is leftover `provider_applied` for this leftover epoch. Then leftover `finishDestinationCasAndComplete`. Never complete from leftover `promotion_step` alone.

3. **Bind the live destination and prove the sheet still has room** — leftover port leftover `getValidatedSnapshot`, leftover `getReportingDestinationById`, leftover `resolveDestinationForWorker` with leftover `casResumeInFlight: false` (the only call site). Leftover `operationalWorkbookRegistry.assertConfigurationComplete` even for leftover snapshot (a newly missing registration must not leave leftover denylist incomplete after leftover confirm). Leftover replace-tab + leftover workbook: leftover `evaluateReportingDestination`; leftover deny → leftover `DESTINATION_UNSAFE` (leftover incomplete also leftover `emitReportingDenylistUnavailable`). Leftover allow (replace-tab or leftover snapshot): leftover `refreshDestinationHealthAndDenylist`. Leftover replace-tab then leftover `listSheets`: leftover unsafe grid integers → leftover `DESTINATION_CAPACITY_EXCEEDED`; leftover observed available cells credit leftover resumable staging; leftover first-create refuses leftover `< 26_000` (Google’s default leftover 1000×26 grid). Leftover `assertEstimateFitsCapacity` on leftover `min(provider, packaged, observed)`. Then leftover cancel check.

4. **Stamp source-read-through, freeze the candidate manifest, write RAW cells onto staging** — leftover first capture leftover `computeQueryPlanChecksum` + leftover `captureReportingSourceReadThrough` (idempotent resume if another attempt already stamped). Leftover `queued` → leftover `querying`. Leftover missing manifest → leftover `reportingStage4StreamV1.prepareManifest` then leftover persist. Always leftover `validatePersistedManifestForResume`. Leftover already leftover `verifying`+ skips leftover write work. Leftover `createOrResumeDeliveryArtifact` + leftover fenced patch. Leftover `querying` → leftover `writing`. Leftover `next_write_row === 1` writes leftover header (`includeHeader: true`). Leftover stream pages: leftover skip already-written leftover rows, leftover `buildReportingWriteBatches`, leftover `writeBoundedReportingBatch` (leftover live-test hook may throw leftover `PROVIDER_UNAVAILABLE`), leftover refuse leftover `rowsWritten + batch > expectedRows`, leftover fenced progress + leftover `requireCheckpoint`. Leftover upper-bound leftover cells are leftover actual `(rowsWritten+1)*columns`, not leftover estimate ceiling. Leftover empty checksum → leftover `initialChecksumAccumulator`. Leftover `writing` → leftover `verifying`. Leftover cancel during leftover write leftover `enqueueIncompleteArtifactCleanup`.

5. **Verify staging, then swap the managed tab or publish the snapshot** — leftover `verifyStagingContents`. Mismatch → leftover `VERIFICATION_MISMATCH`; leftover snapshot also leftover enqueue cleanup. Leftover `verifying` → leftover `promoting`. Leftover replace-tab: leftover `executeReplaceTabPromotion` (leftover inspect → leftover `planPromotionRecovery` → leftover reserve / leftover skip-provider / leftover `promoteOrRecoverReplaceTab` → leftover renew after leftover Google → leftover `markPromotionReservationProviderApplied` → leftover `progress.promotion_step = "rename_batch_submitted"` → leftover `finishDestinationCasAndComplete`). Leftover snapshot: leftover `finishSnapshotDeliveryAndComplete` (`commitSnapshotDeliveryAndRunCompletion`). Leftover stale leftover CAS / leftover exhausted leftover 3-attempt leftover tx → leftover `LeaseLostError` (retryable), never leftover terminal-fail. Success leftover audit leftover `delivery_complete`.

6. **Honor a cancel until promoting; abandon retryable errors without marking failed** — leftover `cancelIfRequested` returns false during leftover `promoting` or leftover non-safe leftover status; leftover `applyReportingRunCancellationAtSafePoint` on leftover `queued` / leftover `querying` / leftover `writing` / leftover `verifying`; leftover race → leftover `LeaseLostError` unless leftover status is already leftover `cancelled`. Leftover `disposeWorkerError`: leftover already terminal; leftover `PhaseSkipError` only when leftover status is leftover at-or-past leftover `writing`; leftover `LeaseLostError` / leftover retryable leftover `reportingFailure` → leftover `retryable_abandon`; else leftover `terminal_fail`. Leftover `toFailure` maps leftover provider leftover auth / leftover authorization / leftover retryable leftover sanitize, else leftover `INTERNAL_FAILURE`.

`requireLease` / leftover `requireTransition` / leftover `requireCheckpoint` / leftover `requireDeliveryPatch` / leftover `failRun` / leftover `failAmbiguousPromotion` / leftover `emitObservabilityForReportingFailure` / leftover `isAtOrPast` / leftover `inferPhase` / leftover `toFailure` are beats, not extra owner operations. Leftover `ReportingWorkerDependencies` is leftover sheets + leftover drive + leftover optional clock.

## Organization

Keep one file. This is the screenplay for “claim the confirmed run, write RAW cells onto staging, verify the checksum, then promote or publish.” Leftover preview desk, leftover paint / leftover freeze, leftover destination persist, leftover delivery-engine batch write, leftover stream page fetch, leftover run lease persist, leftover promotion reservation already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingWorkerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover RAW-write **adapter** beside leftover `writeBoundedReportingBatchEngine`. Do not invent a second leftover stream **adapter** beside leftover `reportingStage4StreamV1`. Do not invent a second leftover wakeup **adapter** beside leftover `publishReportingWakeup`.

Do not split claim / write / verify / promote into CRUD files. Claim and leftover dispose stay together because leftover consumer only **asks** leftover `runReportingDeliveryWorker`. Leftover recover-rename stays in this file because leftover live bind must not run after leftover Google already swapped leftover titles. Do not start leftover `publishReportingWakeup` from this file so “the worker owns the heartbeat.” Do not start leftover preview / leftover estimate.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runReportingDeliveryWorker` | `claimTheConfirmedRunAndWriteTheSheet` | leftover consumer / leftover live harness |
| `disposeWorkerError` | `decideWhetherThisErrorMayRetryWithoutMarkingFailed` | leftover catch; leftover regressions |
| `LeaseLostError` | `TheLeaseWasLost` | leftover fence / leftover stale CAS; leftover retryable |
| `PhaseSkipError` | `ThisPhaseAlreadyMovedOn` | leftover expected-status miss while leftover lease is still held |
| `ReportingWorkerDependencies` | `InjectedGoogleAdapters` | leftover consumer injects leftover sheets + leftover drive |

Keep the old names as one-line aliases until leftover `api/queues/reporting-consumer.ts`, leftover `live/liveGoogleOrchestration.ts`, and `reportingDelivery.regressions.test.ts` migrate. Do not make leftover consumer learn leftover `executeLeasedReportingRun` as the domain language. Do not make leftover heartbeat learn leftover `runReportingDeliveryWorker` — leftover cron only leftover publishes leftover wakeup. Do not make leftover delivery-engine tests learn leftover `writeBoundedReportingBatch` from this file — leftover tests **ask** leftover engine.

**No class for the workflow.** Leftover `LeaseLostError` / leftover `PhaseSkipError` stay errors, not a leftover `ReportingWorker` class. The type that *does* earn a name is the leftover claim handoff leftover consumer already reads:

```ts
type ClaimedReportingWrite = {
  claimed: boolean
  run_id?: string
  status?: string
}
```

That is the handoff from “leftover confirm queued a run” to “leftover consumer may log leftover `completed` / leftover `lease_lost` / leftover `delivery_disabled`.” Do **not** put leftover sample rows on this type. Do **not** put leftover Google leftover range strings on this type. Do **not** move leftover `ReportingExecutionPackageV1` into a new `types/` folder.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingWorker.ts
// The owner confirmed a run.
// Claim it under a five-minute lease.
// If Google delivery is off, only honor a cancel.
// If it is on, bind the live destination, prove the sheet still has room,
// stamp source-read-through, freeze the records we used,
// write RAW cells onto staging, verify the checksum,
// then swap the managed tab or publish the snapshot.
// If Google already renamed, recover — do not complete from the promotion step.
// A cancel is allowed until promoting.
// A retryable error leaves checkpoints.

// ── 1. Claim the next queued run under a five-minute lease ─

export async function claimTheConfirmedRunAndWriteTheSheet(input, deps)
export class TheLeaseWasLost extends Error {}
export class ThisPhaseAlreadyMovedOn extends Error {}

async function claimTheOldestUnleasedRun(owner, now, runHint, cancellationOnly)
async function releaseTheLease(runId, lease)

// ── 2. Recover a replace-tab rename Google already applied ─

async function recoverARenameGoogleAlreadyApplied(input)
async function refuseUnlessTheInspectionSaysAlreadyPromoted(inspection)
async function recheckOwnershipMarkersAndPublishedTitle(sheets, ids)

// ── 3. Bind the live destination and prove the sheet still has room ─

async function bindTheLiveDestinationTheWorkerMayWrite(executionPackage)
async function refuseWhenTheOperationalWorkbookRegistryIsIncomplete()
async function refuseWhenTheDenylistBlocksThisWorkbook(workbookId)
async function observeHowManyCellsTheWorkbookAlreadyUses(sheets, workbookId, stagingSheetId)
async function refuseWhenTheEstimateCannotProveFit(estimate, columns, capacityCells)

// ── 4. Stamp source-read-through, freeze the manifest, write RAW cells ─

async function stampSourceReadThroughOnceUnderThisLease(runId, lease, queryInput, destination)
async function freezeTheCandidateManifestOnce(runId, queryInput, sourceReadThrough)
async function createOrResumeTheStagingTab(sheets, drive, destination, existing)
async function writeTheHeaderThenEachPageOntoStaging(stream, artifact, progress)
function skipRowsThisLeaseAlreadyWrote(pageRows, nextWriteRow, writtenRowBaseline)
function refuseWhenThisBatchWouldExceedTheEstimate(rowsWritten, batch, expectedRows)

// ── 5. Verify staging, then swap the managed tab or publish the snapshot ─

async function verifyTheStagingTabMatchesTheChecksum(sheets, artifact, expected)
async function reserveThenRenameThenCasTheManagedTab(input)
async function finishTheSnapshotWorkbookAndCompleteTheRun(input)
async function casTheDestinationSheetIdWithTheRunCompletion(input)

// ── 6. Honor a cancel until promoting; abandon retryable errors ─

export function decideWhetherThisErrorMayRetryWithoutMarkingFailed({ error, runStatus })
async function honorACancelUntilPromoting(runId, lease, now)
async function markTheRunAndDeliveryFailedUnderThisLease(runId, lease, code)
```

Read the primary path out loud: *claim the oldest queued run that has no live lease. If Google writes are off, only honor a cancel. If they are on, bind the live destination (`casResumeInFlight: false`), prove the denylist and the room for the header plus the rows, stamp source-read-through once, freeze the records we used, write RAW cells onto staging, verify the checksum, then swap the managed tab or publish the snapshot. If Google already renamed, re-inspect first. A cancel stops until promoting. Lease-lost leaves checkpoints.*

That is the operation. `runReportingDeliveryWorker` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`casResumeInFlight` is dead at the only call site.** `bindTheLiveDestinationTheWorkerMayWrite` always passes `false`. Rename-batch recovery returns **before** the bind. Lineage letter (a) (“return packaged untouched”) has no runtime adapter here. Do not silently pass `true` so “the flag is used.”

2. **The Google-delivery flag is checked twice.** `claimTheConfirmedRunAndWriteTheSheet` throws when enabled and `deps` is missing, then claims with `cancellationOnly: !deliveryEnabled`, then throws again if `!deps` after the claim. Shared beat: the consumer already branches on the same flag before it injects adapters. Do not silently drop the second throw in this rename.

3. **`writeBoundedReportingBatch` exists only for live-test injection.** The wrapper strips `runId` and **asks** the engine unless `consumeLiveTestTransientWriteFailure` throws `PROVIDER_UNAVAILABLE`. Delivery-engine tests **ask** the engine directly. Do not start routing spreadsheet writes through a second adapter so “one write owns the company.”

4. **Recover-rename re-walks verify + reservation + CAS.** `recoverARenameGoogleAlreadyApplied` does not **ask** `reserveThenRenameThenCasTheManagedTab`. Inspect / ownership / verify / `provider_applied` / destination CAS are copied as a safer resume. Shared beats exist (`recheckOwnershipMarkersAndPublishedTitle`, `casTheDestinationSheetIdWithTheRunCompletion`). Do not start calling `executeReplaceTabPromotion` from recover so “one promote owns the company.”

5. **`ThisPhaseAlreadyMovedOn` only disposes when status is at-or-past `writing`.** `requireTransition` already swallows an already-advanced status (`isAtOrPast(run.status, nextStatus)` → return). `PhaseSkipError` is the unexpected miss while the lease is still held. Do not collapse those two letters so “one skip owns resume.”

6. **Two completion writers.** `casTheDestinationSheetIdWithTheRunCompletion` and `finishTheSnapshotWorkbookAndCompleteTheRun` both retry three times, both treat stale / exhausted tx as `TheLeaseWasLost`, both record leftover `delivery_complete`. Shared beat: leftover audit after leftover CAS. Do not merge replace-tab destination CAS into snapshot completion so “one complete owns both strategies.”

7. **Cancel during `queued` maps phase to `querying`.** `TheLeaseWasLost` constructor only accepts `querying` / `writing` / `verifying` / `promoting`. `honorACancelUntilPromoting` remaps `queued` → `querying`. Leave that map. Do not add `queued` to the error so “the phase list matches `PHASE_ORDER`.”

8. **Leave sibling modules alone.** Leftover `writeBoundedReportingBatchEngine`, leftover `reportingStage4StreamV1`, leftover `claimNextQueuedReportingRun`, leftover `commitPromotionDestinationCas`, leftover `publishReportingWakeup`, leftover `assertEstimateFitsCapacity` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `claimTheConfirmedRunAndWriteTheSheet`, `decideWhetherThisErrorMayRetryWithoutMarkingFailed`, `TheLeaseWasLost`, `ThisPhaseAlreadyMovedOn`.

Today's `reportingDelivery.regressions.test.ts` already names lease-lost after promote CAS never terminal-fails, retryable `PROVIDER_UNAVAILABLE` is `retryable_abandon`, and `PhaseSkipError` code is not `LEASE_LOST`. Keep those. Replace the helper-dump style with tests that name these worker operations (Mongo in `TEST_MODE`; do not boot live Google; delivery-engine writes stay in `reportingDelivery.test.ts`):

**Claim the next queued run**
- Empty queue / lease held -> `{ claimed: false, status: "lease_busy_or_empty" }`.
- Google delivery off + cancel requested -> `cancelled`. Flag off + no cancel -> `delivery_disabled`.
- Flag on + no `deps` -> throw "requires injected Google adapters."
- Do **not** assert `publishReportingWakeup` here. Heartbeat stays a Wave B cron test.

**Recover a rename Google already applied**
- `promotion_step === "rename_batch_submitted"` + inspection `already_promoted` + markers match -> destination CAS then `completed`.
- Inspection not `already_promoted`, or missing workbook / source-read-through / checksum -> `PROMOTION_AMBIGUOUS` and `failed`.
- Do **not** complete from `promotion_step` alone.

**Bind the destination and prove room**
- Incomplete operational-workbook registry -> `DESTINATION_UNSAFE` even on snapshot.
- Replace-tab denylist deny -> `DESTINATION_UNSAFE`. Incomplete denylist also emits `emitReportingDenylistUnavailable`.
- First staging create with observed cells under 26_000 -> `DESTINATION_CAPACITY_EXCEEDED`.
- Do **not** assert `assertEstimateFitsCapacity` letters here. Those stay reporting-service tests.

**Write RAW cells onto staging**
- Header writes when `next_write_row === 1`. Resume skips already-written rows.
- `rowsWritten + batch > expectedRows` -> `DESTINATION_CAPACITY_EXCEEDED`.
- Status already `verifying` or later -> no new Google writes.
- Cancel during writing enqueues incomplete-artifact cleanup.

**Verify then promote or publish**
- Staging mismatch -> `VERIFICATION_MISMATCH`; snapshot also enqueues cleanup.
- Replace-tab: reserve -> Google rename -> renew -> mark `provider_applied` -> destination CAS. Stale CAS -> `TheLeaseWasLost`, run stays `promoting`.
- Snapshot: `commitSnapshotDeliveryAndRunCompletion`. Stale / exhausted tx -> `TheLeaseWasLost`.

**Honor cancel; abandon retryable errors**
- Existing lease-lost / provider-unavailable / phase-skip proofs stay.
- Cancel during `promoting` is refused.
- Already `completed` / `failed` / `cancelled` -> `already_terminal`.
- Do **not** add a test per helper (`requireLease`, `inferPhase`, `toFailure`, `emitObservabilityForReportingFailure`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start preview desk / estimate / confirm / Analytics / Sheet Sync / live Google inside these tests. `previewThisReportDraft` stays a reporting-service test. Engine write proofs stay `reportingDelivery.test.ts`. Live harness stays `live/liveGoogleOrchestration.ts`.

## What I would not do

- A `ReportingWorkerService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `claimNextQueuedReportingRun` / `writeBoundedReportingBatchEngine` / `transitionReportingRun`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `claim.ts` / `write.ts` / `verify.ts` / `promote.ts` or `replaceTab.ts` / `snapshot.ts`.
- Breaking the recover-rename / live-bind **seam** by binding the destination before Google is re-inspected.
- Breaking the retryable-abandon / terminal-fail **seam** by marking a lease-lost run failed.
- Breaking cancel-until-promoting so a cancel can fire after Google renamed.
- Treating leftover preview / leftover estimate / leftover confirm, leftover paint, leftover delivery engine, leftover stream, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing a second RAW-write **seam** that has only one **adapter** beside leftover `writeBoundedReportingBatchEngine`.
- Inventing a second stream **seam** that has only one **adapter** beside leftover `reportingStage4StreamV1`.
- Inventing a second wakeup **seam** that has only one **adapter** beside leftover `publishReportingWakeup`.
- Silently "fixing" leftover `casResumeInFlight: false`, leftover double flag check, leftover live-test write wrapper, leftover recover-rename copy, leftover unused `queued` phase on leftover `TheLeaseWasLost`, or leftover two completion writers while recommending a rename.
- Starting leftover `publishReportingWakeup` from this file.
- Jumping to leftover `deliveryEngine.ts` leftover batch write. Next pass is that module; do not pull it into this file. Do not jump to leftover `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for leftover `reporting`.
