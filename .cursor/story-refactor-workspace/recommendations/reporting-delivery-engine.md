# Create Or Resume The Run-Marked Staging Tab, Write RAW Cells In Bounded Batches, Verify The Claimed Used Range Without Reading Estimate Headroom, Then Swap The Managed Tab Or Leave The Snapshot — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 12 of this service — `deliveryEngine.ts`
- Remaining in this service: `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/deliveryEngine.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Execution package mandates literal `RAW` spreadsheet writes, literal headers/cells, `formulasAllowed: false`. Knowledge never names `createOrResumeDeliveryArtifact`, persist-before-markers, `writeValuesRaw` replay, claimed-used-range verify, trailing probe, `promoteOrRecoverReplaceTab`, `contentVerification`, or `validatePersistedManifestForResume` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover claim / lease / write-then-promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** `createOrResumeDeliveryArtifact` / `writeBoundedReportingBatch` as `writeBoundedReportingBatchEngine` / `verifyStagingContents` / `promoteOrRecoverReplaceTab` / `validatePersistedManifestForResume` / `assertNoSilentTruncation` / `buildReportingWriteBatches` / `maxCapacityDataRowsFromCells`; leftover worker owns the five-minute lease, cancel-until-promoting, destination bind, and source-read-through stamp — this file never claims a run). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (leftover estimate already refused capacity; this file only asserts rows / cells after the write). Distinct from already-recommended leftover gather / paint / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (this file **asks** `validateReportingManifestEntries` on resume; leftover prove does not write Google). Distinct from leftover execution stream: sibling `executionStream.ts` (this file **asks** `initialChecksumAccumulator` / `advanceChecksumAccumulator` / `validateCompleteManifestBatched`; leftover stream **asks** leftover freeze / leftover prove). Distinct from leftover promotion inspect: sibling `promotion.ts` (`inspectReplaceTabPromotion` / `recoveryTabTitle` / `stagingTabTitle`; this file **asks** leftover inspect before rename and after Google). Distinct from leftover promotion reservation: sibling `promotionReservation.ts` (leftover worker **asks** reserve / mark-applied; this file never leftovers a reservation). Distinct from leftover cleanup: sibling `cleanup.ts` (`cleanupDeliveryArtifacts` is a different export — trash of positively marked workbooks; this file never leftovers trash). Distinct from leftover google cells: sibling `google/cellSerialization.ts` (`serializeReportingHeaderCells` / `serializeReportingRowCells`; `WRITE_BATCH_ROWS` / `writeValuesRaw` live in `google/reportingSheetsAdapter.ts`). Distinct from leftover provider sanitize: sibling `google/providerFailures.ts`. Distinct from leftover live harness: leftover worker wraps `writeBoundedReportingBatchEngine` only so `consumeLiveTestTransientWriteFailure` can throw `PROVIDER_UNAVAILABLE`; leftover delivery tests **ask** this file, not leftover worker. Distinct from leftover Wave B `api/queues/reporting-consumer.ts` (injects leftover Google, then **asks** leftover worker; it never imports this file). Distinct from already-recommended leftover Analytics dispatcher: [`analytics-analytics.md`](analytics-analytics.md). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingWorker.ts` (**asks** create-or-resume, pack-batches, engine write, verify, promote-or-recover, silent-truncation assert, resume-manifest prove, cell-capacity → data-rows). Tests: `reportingDelivery.test.ts` **asks** bounded RAW write / idempotent replay / checksum-safe progress / provider-timeout read-back / promote-or-preserve-old-tab / silent-truncation / persist-manifest-no-row-payloads. `reportingDelivery.regressions.test.ts` **asks** deterministic checksum, published-tab-before-staging, one-positively-marked artifact, resume-validates-manifest, promotion-ambiguity, empty-report checksum, upper-bound-never-reads-estimate-headroom, title-change-by-immutable-id, already-promoted-requires-content-verify, CAS-resume refuses tampered markers / trailing edits. Leftover `reporting.test.ts` does not import this file. **No runtime caller** for `recomputeChecksumFromRows` (verify **asks** it; tests **ask** it), `assertPersistedManifestStructure` (resume **asks** it; tests **ask** it), `REPORTING_VERIFY_SCAN_CHUNK_ROWS`, `DeliveryWriteProgress` (exported, unused outside this file).
- Seams callers need: create-or-resume-the-run-marked-tab (`createOrResumeDeliveryArtifact`) vs write-a-bounded-RAW-batch (`writeBoundedReportingBatch`) vs verify-the-claimed-used-range (`verifyStagingContents`) vs swap-or-recover-the-managed-tab (`promoteOrRecoverReplaceTab`) vs refuse-silent-truncation (`assertNoSilentTruncation`) vs prove-the-persisted-freeze (`validatePersistedManifestForResume`). The persist-workbook-before-markers **seam** exists because `onWorkbookCreated` must fire before run markers / cells, or crash recovery cannot resume. The immutable-sheet-id / stale-title **seam** exists because Google rename / promotion changes titles. The retryable-write / verify-then-replay **seam** exists because a `writeValuesRaw` timeout must read the exact range before a second write. The claimed-used-range / estimate-headroom **seam** exists because verify must never size reads from `expectedRows` when `estimateKind === "upper_bound"`. The content-verification-required **seam** exists because already-promoted recovery must not accept a published title alone. The snapshot / replace-tab **seam** exists because snapshot creates a Drive workbook and unhides staging; replace-tab writes into the managed workbook and keeps staging hidden until promote. There is no begin / complete Domain Command **seam**. There is no claim-lease **seam**. There is no leftover preview / leftover estimate / leftover confirm **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~820-line file is one sitting if you read it as create or resume the run-marked staging tab, write RAW cells in bounded batches, verify the claimed used range without reading estimate headroom, then swap the managed tab or leave the snapshot. Do **not** split into `create.ts` / `write.ts` / `verify.ts` / `promote.ts` so “each verb owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split `snapshot.ts` / `replaceTab.ts` so “each destination strategy owns a CRUD file.” Do **not** pull leftover worker lease / leftover stream page fetch / leftover promotion inspect / leftover cell serialize here so “one engine file owns the company.” If it later splits: `createOrResumeTheRunMarkedStagingTab.ts` / `writeABoundedRawBatchAndReplayIfGoogleIsUnsure.ts` / `verifyTheClaimedUsedRangeThenSwapOrRecover.ts` only as later story files, never CRUD.

`createOrResumeDeliveryArtifact` / `writeBoundedReportingBatch` / `verifyStagingContents` / `promoteOrRecoverReplaceTab` are executor mechanics. The owner question is: *The worker claimed a confirmed run. Create or resume exactly one positively run-marked staging tab. Persist the workbook id before markers. Write RAW cells in bounded batches. If Google times out, read back the exact range and replay. Verify the claimed used range plus one capacity-capped trailing probe — never estimate headroom, never clear or trim. Then swap the managed tab by immutable IDs, or leave the snapshot workbook as the published artifact. If the swap is ambiguous, keep the old tab. Do not claim a lease. Do not preview. Do not run Analytics. Do not sync the Master Sheet.*

Leftover claim / leftover lease, leftover paint / leftover freeze, leftover promotion inspect, leftover cell serialize, leftover Analytics, leftover Sheet Sync already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “create or resume the run-marked staging tab, write RAW cells in bounded batches, verify the claimed used range, then swap the managed tab or leave the snapshot” story, not “a delivery-engine CRUD service,” and not leftover worker leftover claim:

1. **Create or resume exactly one positively run-marked staging artifact** — `createOrResumeDeliveryArtifact`. If `existing.workbookId` + `existing.stagingSheetId` exist: `listSheets`, resolve by immutable sheet ID, `verifyOwnershipAndRunMarkers` on the current title. Marker miss on replace-tab with `oldSheetId`: `inspectReplaceTabPromotion`; `already_promoted` returns the ID-resolved artifact so leftover worker can recover. Snapshot without a workbook: `drive.createSpreadsheet` (`role: "snapshot"`), **then** `onWorkbookCreated` (persist before markers / cells). Both strategies then `findSheetByRunMarker`; a hit **asks** `onStagingCreated` and returns. Snapshot miss: `createHiddenStagingTab` titled `report_<runId-8>`, then `hideSheet({ hidden: false })` (snapshot staging is visible). Replace-tab miss: `verifyPublishedManagedTab` on the managed tab **before** staging, then `createHiddenStagingTab` titled `stagingTabTitle`. Never depend on a stale staging title after Google rename.

2. **Write a bounded RAW batch; if Google is unsure, read back the exact range and replay** — `buildReportingWriteBatches` packs literal header + row cells into `REPORTING_WRITE_BATCH_ROWS` chunks (**asks** `serializeReportingHeaderCells` / `serializeReportingRowCells`). `writeBoundedReportingBatch` **asks** `sheets.writeValuesRaw` (`startCol: 1`). Catch **asks** `sanitizeReportingProviderFailure`; not retryable rethrows the original error. Retryable: `verifyRange` on the same write bag; match returns `range: "replay:<title>:<startRow>"` without a second write; miss leftovers a second `writeValuesRaw`. Tests name this `RAW` + idempotent replay.

3. **Verify the claimed used range without reading estimate headroom, never clear or trim** — `verifyStagingContents`. `resolveCurrentSheetTitle` by immutable ID. `verifyOwnershipAndRunMarkers`. Refuse invalid `actualRowsWritten` / invalid `maxCapacityDataRows`. Exact: claimed rows must equal `expectedRows`. Upper-bound: claimed must not exceed `expectedRows`. Claimed must not exceed capacity data rows. The read is sheet rows `1 … claimedRows+1` only. Header must match serialized labels. Derived used rows (last managed value) must equal claimed. One trailing probe starts at `claimedRows+2`, sized `REPORTING_VERIFY_SCAN_CHUNK_ROWS`, capped by `maxCapacityDataRows+1` — never `expectedRows` headroom. A trailing managed value → `unexpected_trailing_values`. Reconstruct objects from cells and `recomputeChecksumFromRows` (**asks** `initialChecksumAccumulator` / `advanceChecksumAccumulator` / `computeChecksum` `reporting_page`). Mismatch → `checksum_mismatch`. `matched` is `reasons.length === 0`. Never clears or trims cells.

4. **Swap the managed tab by immutable IDs, or recover without deleting the old tab by name** — `promoteOrRecoverReplaceTab`. Missing `oldSheetId` → `ambiguous` `missing_old_sheet`. **Asks** `inspectReplaceTabPromotion`. Inspect `ambiguous` → keep the old tab. Then `verifyOwnershipMarkerBySheetId` on old + `verifyOwnershipAndRunMarkers` on staging **by ID**, never title-only. `ready_to_promote` / `staging_still_hidden`: `promoteStagingTab` with `recoveryTabTitle`; catch re-inspects and refuses unless `already_promoted`. After rename: the published title must sit on the **staging sheet ID**. Missing `contentVerification` → `content_verification_required` (title coincidence is not enough). Then **asks** `verifyStagingContents` against the published title. Final inspect must be `already_promoted`. Success returns `{ outcome: "promoted", recoveryTitle, publishedSheetId: stagingSheetId }`. Every fail path is `{ outcome: "ambiguous", preserveOldTab: true }`.

5. **Refuse silent truncation; prove the persisted freeze still has no row payloads** — `assertNoSilentTruncation` throws `VERIFICATION_MISMATCH` on exact row miss, `DESTINATION_CAPACITY_EXCEEDED` when rows or cells exceed the estimate ceiling. `maxCapacityDataRowsFromCells` is `floor(capacityCells / columnCount) - 1` (header inclusive). `assertPersistedManifestStructure` refuses version ≠ 1, source-read-through miss, missing arrays, `rows` / `values` / `cells` on entries or page maps. `validatePersistedManifestForResume` always leftover structure + `validateCompleteManifestBatched` — even when there is no stream checkpoint. Injectable `validateEntries` defaults to `validateReportingManifestEntries`.

`resolveCurrentSheetTitle` / `rowHasManagedValue` / `recomputeChecksumFromRows` are beats, not extra owner operations. `DeliveryArtifact` is the handoff leftover worker already leftovers. `PromoteContentVerification` is the required proof leftover promote must carry.

## Organization

Keep one file. This is the screenplay for “create or resume the run-marked staging tab, write RAW cells in bounded batches, verify the claimed used range, then swap the managed tab or leave the snapshot.” Leftover worker leftover claim, leftover stream leftover pages, leftover promotion leftover inspect, leftover cell leftover serialize already live in deeper **modules**. Do not pull those in. Do not invent a `DeliveryEngineService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover RAW-write **adapter** beside `sheets.writeValuesRaw`. Do not invent a second leftover inspect **adapter** beside `inspectReplaceTabPromotion`. Do not invent a second leftover serialize **adapter** beside `serializeReportingRowCells`.

Do not split snapshot / replace-tab into CRUD files. Persist-before-markers stays on create-or-resume because crash recovery **asks** `onWorkbookCreated` before leftover markers. Content-verify stays inside leftover promote because already-promoted recovery must re-read cells after Google rename. Do not start `claimNextQueuedReportingRun` from this file so “the engine owns the lease.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createOrResumeDeliveryArtifact` | `createOrResumeTheRunMarkedStagingTab` | leftover worker leftover write + leftover tests leftover resume by leftover ID |
| `writeBoundedReportingBatch` | `writeABoundedRawBatchAndReplayIfGoogleIsUnsure` | leftover worker (as leftover Engine) + leftover delivery leftover tests |
| `buildReportingWriteBatches` | `packLiteralCellsIntoBoundedBatches` | leftover header once, then leftover pages |
| `verifyStagingContents` | `verifyTheClaimedUsedRangeWithoutReadingEstimateHeadroom` | leftover worker leftover verify + leftover promote leftover recovery + leftover tests |
| `promoteOrRecoverReplaceTab` | `swapTheManagedTabOrRecoverWithoutDeletingTheOldTabByName` | leftover worker leftover replace-tab + leftover tests leftover ambiguity |
| `assertNoSilentTruncation` | `refuseSilentTruncation` | leftover worker after leftover write + leftover capacity leftover tests |
| `validatePersistedManifestForResume` | `proveThePersistedFreezeStillHasNoRowPayloads` | leftover worker leftover resume + leftover regression 8 |
| `assertPersistedManifestStructure` | `refuseAPersistedManifestThatStillCarriesRowPayloads` | leftover beat of leftover prove; leftover tests leftover **ask** it alone |
| `recomputeChecksumFromRows` | `recomputeTheChecksumFromTheCellsWeRead` | leftover verify leftover **asks** it; leftover tests leftover name leftover checksum leftover match |
| `maxCapacityDataRowsFromCells` | `convertCellCapacityToDataRowsExcludingTheHeader` | leftover worker is the only leftover runtime leftover caller |
| `DeliveryArtifact` | `TheRunMarkedStagingTab` | leftover handoff leftover worker already leftovers |
| `PromoteContentVerification` | `RequiredContentProofForPromotion` | leftover already-promoted leftover must leftover carry leftover columns + leftover checksum |

Keep the old names as one-line aliases until leftover `reportingWorker.ts`, `reportingDelivery.test.ts`, and `reportingDelivery.regressions.test.ts` migrate. Do not make leftover consumer leftover learn `writeBoundedReportingBatch` from this file — leftover consumer leftover **asks** leftover worker. Do not make leftover heartbeat leftover learn this file. Do not leftover export leftover `resolveCurrentSheetTitle` so “title leftover resolve leftover is leftover public.”

**No class for the workflow.** Leftover `DeliveryArtifact` stays a type, not a leftover `DeliveryEngine` class. The type that *does* earn a name is the leftover persist-before-markers leftover handoff leftover worker already leftovers:

```ts
type RunMarkedStagingTab = {
  workbookId: string
  workbookUrl: string
  stagingSheetId: number
  stagingSheetTitle: string
  oldSheetId: number | null
}
```

That is the handoff from “Drive created a workbook” to “the worker may write RAW cells onto staging.” Do **not** put sample rows on this type. Do **not** put lease owner / epoch on this type. Do **not** move `PromoteContentVerification` into a new `types/` folder. `DeliveryWriteProgress` is unused outside this file — do not make leftover worker learn it so “one progress type owns the company.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// deliveryEngine.ts
// The worker claimed a confirmed run.
// Create or resume exactly one positively run-marked staging tab.
// Persist the workbook id before markers.
// Write RAW cells in bounded batches.
// If Google times out, read back the exact range and replay.
// Verify the claimed used range plus one capacity-capped trailing probe.
// Never size reads from estimate headroom. Never clear or trim.
// Then swap the managed tab by immutable IDs, or leave the snapshot.
// If the swap is ambiguous, keep the old tab.

// ── 1. Create or resume exactly one positively run-marked staging tab ─

export async function createOrResumeTheRunMarkedStagingTab(input)
async function resolveTheStagingTabByImmutableSheetId(existing)
async function recoverAlreadyPromotedWhenMarkersNoLongerMatch(existing, managedTab)
async function persistTheWorkbookIdBeforeMarkers(created)
async function findTheSheetAlreadyMarkedForThisRun(workbookId, runId)
async function createTheSnapshotWorkbookThenUnhideStaging(input)
async function verifyThePublishedManagedTabThenCreateHiddenStaging(input)

// ── 2. Write a bounded RAW batch; replay if Google is unsure ─

export function packLiteralCellsIntoBoundedBatches({ rows, columns, includeHeader })
export async function writeABoundedRawBatchAndReplayIfGoogleIsUnsure(input)
async function readBackTheExactRangeAfterARetryableTimeout(write)
async function replayTheSameRawWrite(write)

// ── 3. Verify the claimed used range without reading estimate headroom ─

export async function verifyTheClaimedUsedRangeWithoutReadingEstimateHeadroom(input)
async function resolveTheCurrentTitleByImmutableSheetId(sheets, workbookId, sheetId, fallback)
function refuseWhenClaimedRowsDisagreeWithTheEstimateKind(claimed, expected, kind)
async function probeOneCapacityCappedTrailingChunk(sheets, afterClaimedRow, capacityCap)
export function recomputeTheChecksumFromTheCellsWeRead({ rows, queryInput, manifest, pageSize })
export function convertCellCapacityToDataRowsExcludingTheHeader({ capacityCells, columnCount })

// ── 4. Swap the managed tab by immutable IDs, or recover ─

export async function swapTheManagedTabOrRecoverWithoutDeletingTheOldTabByName(input)
async function refuseUnlessInspectionIsReadyAlreadyOrStillHidden(inspection)
async function recheckOwnershipMarkersByImmutableIds(sheets, oldSheetId, stagingSheetId)
async function renameStagingOntoThePublishedTitleAndKeepTheOldTab(input)
async function refuseTitleCoincidenceWithoutContentProof(contentVerification)
async function reVerifyThePublishedIdThenRequireAlreadyPromoted(input)

// ── 5. Refuse silent truncation; prove the persisted freeze ─

export function refuseSilentTruncation({ rowsWritten, expectedRows, estimateKind, cellsWritten, expectedCells })
export function refuseAPersistedManifestThatStillCarriesRowPayloads(manifest, sourceReadThrough)
export async function proveThePersistedFreezeStillHasNoRowPayloads(manifest, sourceReadThrough, pageSize)
```

Read the primary path out loud: *resolve the staging tab by immutable sheet ID, not a stale title. If markers miss after a replace-tab rename, inspect — already-promoted returns that ID so the worker can recover. Otherwise persist the workbook id before markers, find the run marker or create staging. Write RAW cells in bounded batches. If Google times out, read back the exact range and replay. Verify the claimed used range plus one capacity-capped trailing probe — never estimate headroom. Then swap the managed tab by IDs after a required content proof, or leave the snapshot.*

That is the operation. `createOrResumeDeliveryArtifact` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Snapshot creates a hidden tab, then immediately unhides it.** `createTheSnapshotWorkbookThenUnhideStaging` **asks** `createHiddenStagingTab` and then `hideSheet({ hidden: false })`. The helper name lies for snapshot. Replace-tab leaves staging hidden until promote. Do not silently drop the unhide so “hidden means hidden.”

2. **`RequiredContentProofForPromotion` is optional on the type and required at runtime.** The field is `contentVerification?`. Missing it returns `ambiguous` / `content_verification_required`. The comment already says required. Do not silently make the field required in this rename without updating leftover worker and leftover tests.

3. **`DeliveryWriteProgress` is unused.** The type is exported. Leftover worker tracks progress on the run document. Engine tests never construct it. Do not make leftover worker learn this type so “one progress bag owns the company.”

4. **The empty-report return after the checksum loop is the same as the next line.** `recomputeTheChecksumFromTheCellsWeRead` walks pages, then `if (rows.length === 0) return accumulator` and `return accumulator`. Empty reports already work because the loop never runs and `initialChecksumAccumulator` is the value. Regression “empty report checksum equals initial accumulator” names that. Do not silently hoist or drop the empty branch in this rename.

5. **Promote re-asks `verifyTheClaimedUsedRangeWithoutReadingEstimateHeadroom` after leftover worker already verified.** That second read is load-bearing for already-promoted recovery. Title coincidence is not enough. Do not skip the second verify so “the worker already proved it.”

6. **Injectable `validateEntries` on resume is a test seam.** `proveThePersistedFreezeStillHasNoRowPayloads` defaults to `validateReportingManifestEntries`. Runtime resume always leftover structure + leftover `validateCompleteManifestBatched`. Do not treat the extra argument as domain polymorphism.

7. **Leftover worker wraps the same write name.** `reportingWorker.ts` imports `writeBoundedReportingBatch` as `writeBoundedReportingBatchEngine` and re-exports a wrapper only so leftover live-test can throw `PROVIDER_UNAVAILABLE`. Engine tests **ask** this file. Do not invent a second RAW-write **adapter** so “one write owns the company.”

8. **ID-found + marker-fail + not already-promoted falls through to recreate.** `createOrResumeTheRunMarkedStagingTab` comments “Fall through to run-marker scan / recreate paths.” A tampered-marker sheet can still exist when a new staging tab is created on the same workbook. Do not silently refuse recreate so “one tab owns the company.”

9. **The write return does not say replayed vs recovered.** Success returns the Google range. Replay returns `replay:<title>:<startRow>`. The second write returns that write’s range. Do not add a `recovered` flag in this rename.

10. **Leave sibling modules alone.** Leftover `inspectReplaceTabPromotion`, leftover `serializeReportingRowCells`, leftover `writeValuesRaw`, leftover `initialChecksumAccumulator` / leftover `validateCompleteManifestBatched`, leftover `validateReportingManifestEntries` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `createOrResumeTheRunMarkedStagingTab`, `writeABoundedRawBatchAndReplayIfGoogleIsUnsure`, `packLiteralCellsIntoBoundedBatches`, `verifyTheClaimedUsedRangeWithoutReadingEstimateHeadroom`, `swapTheManagedTabOrRecoverWithoutDeletingTheOldTabByName`, `refuseSilentTruncation`, `proveThePersistedFreezeStillHasNoRowPayloads`.

Today’s `src/services/reporting/reportingDelivery.test.ts` already names bounded RAW write / idempotent replay / checksum-safe progress (acceptance 13/14), provider-timeout read-back (acceptance 13), staging verification plus failed replacement preserves the old tab (acceptance 15/16), silent truncation (acceptance 12), RAW formula refuse, and persisted-manifest no row payloads. `src/services/reporting/reportingDelivery.regressions.test.ts` already names deterministic checksum (regression 4), published-tab-before-staging (regression 5), one positively marked artifact (regression 7), resume always validates the freeze (regression 8 / 8b), promotion ambiguity never deletes by name (regression 11), empty-report checksum, upper-bound never reads estimate headroom, title change by immutable id, already-promoted requires content verify, and CAS-resume refuses tampered markers / trailing edits. Keep those. Replace helper-dump additions with tests that name these engine operations (fake Google; do not boot live Sheets; leftover worker lease proofs stay in leftover worker tests):

**Create or resume the run-marked staging tab**
- Resume resolves by immutable sheet ID when the stored title is stale.
- Snapshot: `onWorkbookCreated` fires before markers / cells.
- Replace-tab: published managed tab is verified before a new hidden staging tab.
- Marker miss + replace-tab + `already_promoted` returns the ID-resolved artifact. The worker must not create a second spreadsheet.
- Do **not** assert leftover `claimNextQueuedReportingRun` here. Claim stays a leftover worker test.

**Write a bounded RAW batch**
- Literal header + row cells pack into `REPORTING_WRITE_BATCH_ROWS` chunks.
- Success **asks** `writeValuesRaw`. Retryable timeout + `verifyRange` match → `replay:<title>:<startRow>` and no second write.
- Retryable miss → one more `writeValuesRaw`. Non-retryable throws with no verify.
- Formula-shaped cells stay refused by leftover serialize. Do **not** re-test leftover serialize letters here.

**Verify the claimed used range**
- Read is sheet rows `1 … claimedRows+1` plus one trailing probe sized `REPORTING_VERIFY_SCAN_CHUNK_ROWS`, capped by `maxCapacityDataRows+1`.
- Upper-bound must never size that read from `expectedRows`.
- Trailing managed value → `unexpected_trailing_values`. Checksum mismatch → `checksum_mismatch`. Extra rows fail closed. Never clear or trim.
- Empty report checksum equals `initialChecksumAccumulator`.

**Swap the managed tab or recover**
- Missing `contentVerification` → `ambiguous` + `preserveOldTab` + `content_verification_required`.
- Published title on a different sheet ID is collision, not success.
- Promote fail after Google may have renamed → `ambiguous` + `preserveOldTab`. Never delete the old tab by name.
- Final inspect must be `already_promoted`. Success `publishedSheetId` is the staging sheet ID.

**Refuse silent truncation; prove the freeze**
- Exact row miss → `VERIFICATION_MISMATCH`. Rows or cells over the estimate ceiling → `DESTINATION_CAPACITY_EXCEEDED`.
- Persisted entries / page maps with `rows` / `values` / `cells` throw. Resume validates even with no stream checkpoint.

Do **not** add a test per helper (`resolveTheCurrentTitleByImmutableSheetId`, `rowHasManagedValue`, `refuseWhenClaimedRowsDisagreeWithTheEstimateKind`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover worker leftover claim / leftover lease, leftover preview / leftover estimate / leftover confirm, leftover Analytics, leftover Sheet Sync, or live Google inside these tests. Leftover `runReportingDeliveryWorker` stays a leftover worker test. Leftover live harness stays `live/liveGoogleOrchestration.ts`.

## What I would not do

- A `DeliveryEngineService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `writeValuesRaw` / `inspectReplaceTabPromotion` / `serializeReportingRowCells`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `create.ts` / `write.ts` / `verify.ts` / `promote.ts` or `snapshot.ts` / `replaceTab.ts`.
- Breaking the persist-workbook-before-markers **seam** by writing markers before `onWorkbookCreated`.
- Breaking the claimed-used-range / estimate-headroom **seam** by sizing verify reads from `expectedRows` when `estimateKind === "upper_bound"`.
- Breaking the content-verification-required **seam** by accepting a published title without `verifyStagingContents`.
- Breaking replace-tab recovery so the old tab can be deleted by name.
- Treating leftover worker leftover claim / leftover lease, leftover preview / leftover estimate / leftover confirm, leftover paint, leftover promotion inspect, leftover cell serialize, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing a second RAW-write **seam** that has only one **adapter** beside leftover `writeValuesRaw`.
- Inventing a second leftover inspect **seam** that has only one **adapter** beside leftover `inspectReplaceTabPromotion`.
- Inventing a second leftover serialize **seam** that has only one **adapter** beside leftover `serializeReportingRowCells`.
- Silently “fixing” leftover snapshot hide-then-unhide, leftover optional `contentVerification`, leftover unused `DeliveryWriteProgress`, leftover empty-checksum twin return, leftover second verify on promote, leftover injectable `validateEntries`, leftover worker write wrapper, leftover marker-fail recreate, or leftover replay range string while recommending a rename.
- Starting leftover `claimNextQueuedReportingRun` from this file.
- Jumping to leftover `executionStream.ts` leftover page stream. Next pass is that module; do not pull it into this file. Do not jump to leftover `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for leftover `reporting`.
