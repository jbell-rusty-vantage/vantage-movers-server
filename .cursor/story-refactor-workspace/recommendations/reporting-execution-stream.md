# Freeze The Records Once, Open The Page Reader Once, Prove The Freeze On Resume, Then Emit Each Mapped Page And Fold The Data Checksum — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 13 of this service — `executionStream.ts`
- Remaining in this service: `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/executionStream.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Source read-through is captured by the worker under the active lease owner/epoch. Knowledge never names `createReportingStage4StreamV1`, `reportingStage4StreamV1`, `prepareManifest`, `validateCompleteManifestBatched`, `initialChecksumAccumulator`, `advanceChecksumAccumulator`, or `setReportingManifestPageAdapter` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended gather / paint / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (this file **asks** `buildReportingCandidateManifest` / `validateReportingManifestEntries`; sibling freeze / prove do not walk pages or fold a data checksum). Distinct from already-recommended claim / lease / write-then-promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** `reportingStage4StreamV1.prepareManifest` / `stream`; the worker stamps source-read-through via `captureReportingSourceReadThrough`, persists via `persistReportingCandidateManifest`, and writes RAW batches — this file never claims a lease and never writes Google). Distinct from already-recommended create-or-resume / RAW write / verify: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (**asks** `initialChecksumAccumulator` / `advanceChecksumAccumulator` / `validateCompleteManifestBatched`; sibling verify recomputes the checksum from cells this stream folded while writing). Distinct from page-reader install: sibling `manifestPageAdapter.ts` (`registerPersistedManifestPageAdapter` **asks** `setReportingManifestPageAdapter`; `createPersistedManifestPageAdapter` **asks** `openReportingPageReader`). Distinct from live synthetic reader: `live/syntheticManifestPageAdapter.ts` swaps the same module adapter so the live harness can inject rows without Mongo. Distinct from run persist: sibling `reportingRunRepository.ts` (`captureReportingSourceReadThrough` / `streamCheckpointFromRun` — the worker stamps the instant there, not via `captureSourceReadThrough`). Distinct from manifest persist: sibling `reportingManifestRepository.ts` (the worker persist callback **asks** `persistReportingCandidateManifest`). Distinct from bootstrap hook: sibling `registerStage4Foundation.ts` **asks** `registerPersistedManifestPageAdapter` once at Express / reporting consumer / live harness — this file defaults to throw `ManifestPageAdapterUnavailableError`. Distinct from Wave B `api/queues/reporting-consumer.ts` and `src/app.ts` (they register the foundation; they never import this file). Distinct from Wave B `src/routes/reporting.routes.ts` (Owner preview / run; does not import this file). Distinct from already-recommended Analytics dispatcher: [`analytics-analytics.md`](analytics-analytics.md). Distinct from already-recommended Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `reportingWorker.ts` (**asks** `reportingStage4StreamV1.prepareManifest` when no persisted freeze exists, then `stream` with `streamCheckpointFromRun`; empty / skipped-write fallback **asks** `initialChecksumAccumulator`). `deliveryEngine.ts` (**asks** `initialChecksumAccumulator` / `advanceChecksumAccumulator` inside `recomputeChecksumFromRows`; `validatePersistedManifestForResume` **asks** `validateCompleteManifestBatched`). `manifestPageAdapter.ts` and `live/syntheticManifestPageAdapter.ts` **ask** `setReportingManifestPageAdapter`. Tests: `executionStream.test.ts` **asks** `createReportingStage4StreamV1` / `initialChecksumAccumulator` (resume without duplicates, before-and-after page prove, valid UTC instant, persist-once + page-targeted prove, resume proves the complete freeze before reopen, mapped dependency fails without O(N)). `reportingDelivery.regressions.test.ts` **asks** `initialChecksumAccumulator` for empty-report checksum equality. `reporting.test.ts` does not import this file. **No runtime caller** for `captureSourceReadThrough` (the worker stamps via `captureReportingSourceReadThrough`), `createReportingStage4StreamV1` (tests only; runtime uses the singleton), or `ManifestPageAdapterUnavailableError` as a typed catch (the default adapter throws it until foundation registers a reader).
- Seams callers need: freeze-and-persist-once (`prepareManifest`) vs emit-pages-from-a-checkpoint (`stream`) vs prove-the-complete-freeze-in-batches (`validateCompleteManifestBatched`) vs fold-the-data-checksum (`initialChecksumAccumulator` / `advanceChecksumAccumulator`) vs install-the-page-reader (`setReportingManifestPageAdapter`). The persist-then-stream **seam** exists because resume may already have a persisted freeze and must not rebuild. The resume-prove-before-reopen **seam** exists because a drifted entry must fail before `openPageReader` (test: `opened === 0`). The before-and-after-page-query **seam** exists because a record can move during the query (test: two `validateEntries` per page). The page-targeted-deps **seam** exists because only mapped keys are proved per page, not O(N) all entries. The completed-checkpoint **seam** exists because `rowCount > 0` and `cursor === null` means already finished. The module-level adapter **seam** exists because Express bootstrap and the live harness swap readers without constructing a new stream. There is no begin / complete Domain Command **seam**. There is no claim-lease **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~253-line file is one sitting if you read it as freeze the records once, open the page reader once, prove the freeze on resume, then emit each mapped page and fold the data checksum. Do **not** split into `prepare.ts` / `stream.ts` / `checksum.ts` so “each verb owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull sibling freeze / sibling prove / sibling persist / sibling RAW write here so “one stream file owns the company.” If it later splits: `freezeTheCandidateManifestOnce.ts` / `emitMappedPagesFromACheckpoint.ts` only as later story files, never CRUD.

`prepareManifest` / `createReportingStage4StreamV1` / `reportingStage4StreamV1` are executor mechanics. The owner question is: *The worker already claimed the run and stamped source-read-through. Freeze the records we used, once, and persist that freeze. Open the page reader once. If we are resuming, prove every frozen record still matches before we reopen the reader. Then emit each mapped page, prove those page dependencies before and after the query, refuse a cursor that does not advance, and fold each page into the data checksum. Do not write Google. Do not claim a lease. Do not preview. Do not run Analytics. Do not sync the Master Sheet.*

Sibling freeze / prove, sibling worker claim, sibling delivery RAW write, sibling page-reader install, sibling Analytics, sibling Sheet Sync already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “freeze the records once, open the page reader once, prove the freeze on resume, then emit each mapped page and fold the data checksum” story, not “a Stage 4 stream CRUD service,” and not the worker claim:

1. **Stamp a valid source-read-through instant** — `captureSourceReadThrough`. Refuse a non-finite Date. Return `instant.toISOString()`. Tests name this. **No runtime caller.** The worker stamps via `captureReportingSourceReadThrough` on the run document and passes the ISO string into `prepareManifest` / `stream`.

2. **Freeze the candidate manifest once and persist it** — `prepareManifest`. **Asks** injected `buildManifest` (runtime: `buildReportingCandidateManifest`), then the caller’s `persist` callback, then returns the freeze. The worker **asks** this only when `loadReportingCandidateManifest` is empty. Resume with a persisted freeze never rebuilds.

3. **Emit mapped pages from a checkpoint without duplicates** — `stream`. Refuse `manifest.sourceReadThrough !== input.sourceReadThrough`. Refuse unsupported checkpoint version. If the checkpoint already finished (`rowCount > 0` and `cursor === null`), return with no pages. On a checkpoint, **ask** `validateCompleteManifestBatched` before `openPageReader` (resume must fail before reopen), then open the reader once, then **ask** `validateCompleteManifestBatched` again. For each mapping: look up only `dependencyKeys`, prove those entries before the query, read the page, prove those entries after the query. Empty page returns without a yield. Cursor must match the mapping and must advance. Then increment `pageNumber`, fold the checksum, yield `{ page, checkpoint }`. Stop when `nextCursor` is null.

4. **Prove the complete freeze in page-sized batches** — `validateCompleteManifestBatched`. Refuse a batch size that is not a safe integer ≥ 1. Walk `manifest.entries` in slices and **ask** injected `validateEntries` (runtime: `validateReportingManifestEntries`). Stream resume **asks** this twice. Delivery-engine resume **asks** it once after structure refuse.

5. **Fold the data checksum from painted pages** — `initialChecksumAccumulator` checksums dataset / schema / selected columns / sort / manifest checksum / source-read-through (`artifact_kind: "reporting_data"`). `advanceChecksumAccumulator` folds previous + pageNumber + page checksum + nextCursor + rowCount. Stream starts from the checkpoint accumulator or the initial value. Worker empty-report / skipped-write fallback **asks** the initial value. Delivery-engine verify **asks** both to recompute from cells.

`setReportingManifestPageAdapter` / `ManifestPageAdapterUnavailableError` / `createReportingStage4StreamV1` / `reportingStage4StreamV1` are the factory, the singleton, and the reader install — seams, not extra owner operations. `ReportingStage4StreamV1.lifecycle` is documentation-as-type. Catalog `ReportingStreamCheckpointV1` / `ReportingExecutionPageV1` live in sibling catalog — do not move them here.

## Organization

Keep one file. This is the screenplay for “freeze the records once, open the page reader once, prove the freeze on resume, then emit each mapped page and fold the data checksum.” Sibling freeze / prove, sibling persist, sibling RAW write already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingStreamService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second freeze **adapter** beside `buildReportingCandidateManifest`. Do not invent a second prove **adapter** beside `validateReportingManifestEntries`. Do not invent a second reader **adapter** beside `setReportingManifestPageAdapter`.

Do not split prepare / stream / checksum into CRUD files. Persist-once stays on `prepareManifest` because the worker must not rebuild a freeze it already saved. Before-and-after page prove stays inside `stream` because a record can move during the query. Do not start `claimNextQueuedReportingRun` from this file. Do not start `writeValuesRaw` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `reportingStage4StreamV1` | `thePageStream` | runtime singleton the worker asks |
| `createReportingStage4StreamV1` | `createThePageStream` | stream tests inject freeze / prove / reader |
| `prepareManifest` (on the stream) | `freezeTheCandidateManifestOnceAndPersistIt` | worker first write only |
| `stream` (on the stream) | `emitMappedPagesFromACheckpointWithoutDuplicates` | worker write loop |
| `captureSourceReadThrough` (on the stream) | `stampAValidSourceReadThroughInstant` | tests name it; no runtime caller |
| `validateCompleteManifestBatched` | `proveTheCompleteFreezeInPageSizedBatches` | stream resume + delivery resume |
| `initialChecksumAccumulator` | `startTheDataChecksumFromTheFreeze` | stream / worker empty / delivery verify / empty-report regression |
| `advanceChecksumAccumulator` | `foldThisPageIntoTheDataChecksum` | stream + delivery verify |
| `setReportingManifestPageAdapter` | `installThePageReader` | foundation / live synthetic |
| `ManifestPageAdapterUnavailableError` | `ThePageReaderWasNeverInstalled` | default until register |
| `ReportingManifestPageAdapter` | `ThePageReader` | install type |
| `ReportingStage4StreamV1` | `ThePageStreamContract` | factory return type |

Keep the old names as one-line aliases until `reportingWorker.ts`, `deliveryEngine.ts`, `manifestPageAdapter.ts`, `live/syntheticManifestPageAdapter.ts`, `executionStream.test.ts`, and `reportingDelivery.regressions.test.ts` migrate. Do not make the consumer learn `stream` from this file — the consumer asks the worker. Do not make the heartbeat learn this file. Do not export `StreamDependencies` so “injected deps are public.”

**No class for the workflow.** `createReportingStage4StreamV1` already returns an object with methods. Do **not** turn that into a `ReportingStreamService` class. `ManifestPageAdapterUnavailableError` stays an error. The type that *does* earn a name is the yielded page the worker already reads:

```ts
type EmittedReportingPage = {
  page: QueryPage
  checkpoint: {
    version: 1
    cursor: string | null
    pageNumber: number
    rowCount: number
    checksumAccumulator: string
  }
}
```

That is the handoff from “we painted this page under the freeze” to “the worker may write these rows and remember the checkpoint.” Do **not** put Google range strings on this type. Do **not** put lease owner / epoch on this type. Do **not** move catalog `ReportingStreamCheckpointV1` into a new `types/` folder.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// executionStream.ts
// The worker already claimed the run and stamped source-read-through.
// Freeze the records we used, once, and persist that freeze.
// Open the page reader once.
// If we are resuming, prove every frozen record still matches
// before we reopen the reader.
// Then emit each mapped page.
// Prove those page dependencies before and after the query.
// Refuse a cursor that does not advance.
// Fold each page into the data checksum.

// ── 1. Stamp a valid source-read-through instant ─

function stampAValidSourceReadThroughInstant(instant)

// ── 2. Freeze the candidate manifest once and persist it ─

async function freezeTheCandidateManifestOnceAndPersistIt(input, persist)

// ── 3. Emit mapped pages from a checkpoint without duplicates ─

async function* emitMappedPagesFromACheckpointWithoutDuplicates(input, manifest, checkpoint)
function refuseWhenTheFreezeDoesNotMatchThisReadThrough(manifest, input)
function returnIfTheCheckpointAlreadyFinished(checkpoint)
async function proveTheCompleteFreezeBeforeReopeningTheReader(manifest)
async function openThePageReaderOnce(input, manifest)
function lookupOnlyTheMappedDependenciesForThisPage(manifest, mapping)
async function proveThoseDependenciesBeforeTheQuery(entries, sourceReadThrough)
async function proveThoseDependenciesAfterTheQuery(entries, sourceReadThrough)
function refuseWhenTheCursorDidNotAdvance(page, mapping, cursor)

// ── 4. Prove the complete freeze in page-sized batches ─

export async function proveTheCompleteFreezeInPageSizedBatches(manifest, batchSize, validate)

// ── 5. Fold the data checksum from painted pages ─

export function startTheDataChecksumFromTheFreeze(input, manifest)
export function foldThisPageIntoTheDataChecksum({ previous, pageNumber, pageChecksum, nextCursor, rowCount })

// ── factory / singleton / reader install ─

export function createThePageStream(dependencies)
export const thePageStream
export function installThePageReader(adapter)
```

Read the primary path out loud: *freeze the records we used, once, and persist that freeze. Open the page reader once. If we are resuming, prove every frozen record still matches before we reopen the reader. Then emit each mapped page, prove those page dependencies before and after the query, refuse a cursor that does not advance, and fold each page into the data checksum.*

That is the operation. `createReportingStage4StreamV1` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Resume proves the complete freeze twice inside `stream`.** Once before `openPageReader`, once after. The test only names “before reopening reader” (`opened === 0`). The worker also asks `validatePersistedManifestForResume` before it ever calls `stream`. A resume with a checkpoint therefore proves the complete freeze three times before the first page emit. Do not silently drop either stream call so “one prove owns the company.”

2. **`stampAValidSourceReadThroughInstant` has no runtime caller.** The worker stamps via `captureReportingSourceReadThrough` and passes ISO into `prepareManifest` / `stream`. Tests still name the stream method. Do not silently make the worker call this so “one stamp owns the company.”

3. **Default reader throws until foundation registers.** Express, the reporting consumer, and the live harness each call `registerReportingStage4Foundation`. Queue consumers do not inherit Express bootstrap. Do not silently inject `createPersistedManifestPageAdapter` into the singleton constructor so “the factory owns the reader.”

4. **Module-level mutable reader.** Live tests swap it with `registerSyntheticLiveTestManifestPageAdapter`. Do not invent a second stream singleton.

5. **`createThePageStream` returns a workflow object.** That is the existing factory. Do not turn it into `ReportingStreamService`. Injected `buildManifest` / `validateEntries` / `openPageReader` are a test seam, not domain polymorphism.

6. **Checkpoint `pageNumber` increments before yield.** Manifest `outputPages` are 0-based. Resume with `pageNumber: 1` starts at the second mapping. Do not silently 0-index the checkpoint.

7. **Empty page returns without a yield.** `page.rowCount === 0` stops. The worker then asks `startTheDataChecksumFromTheFreeze` for empty reports. Do not silently yield an empty checkpoint.

8. **Page prove runs twice per page.** Before and after `readPage`. Load-bearing for mid-query drift. Tests name `validations === 2`. Do not drop the second prove so “the query already read it.”

9. **Singleton hardcodes `pageSize: 500`.** That matches `REPORTING_PAGE_SIZE` in config, but this file does not import the constant. Sibling `manifestPageAdapter.ts` does. Do not silently import the constant in this rename.

10. **Leave sibling modules alone.** `buildReportingCandidateManifest`, `validateReportingManifestEntries`, `persistReportingCandidateManifest`, `captureReportingSourceReadThrough`, `openReportingPageReader` are already the right depth. This file orchestrates them.

## Testing

The **interface** is the test surface: `createThePageStream`, `thePageStream`, `freezeTheCandidateManifestOnceAndPersistIt`, `emitMappedPagesFromACheckpointWithoutDuplicates`, `stampAValidSourceReadThroughInstant`, `proveTheCompleteFreezeInPageSizedBatches`, `startTheDataChecksumFromTheFreeze`, `foldThisPageIntoTheDataChecksum`, `installThePageReader`.

Today’s `src/services/reporting/executionStream.test.ts` already names resume without duplicates and preserved checksum state, before-and-after page prove, valid UTC instant, persist-once + page-targeted prove, resume proves the complete freeze before reopen (`opened === 0`), and mapped contributing dependency fails without O(N). `reportingDelivery.regressions.test.ts` already names empty-report checksum equals the initial accumulator. Keep those. Replace helper-dump additions with tests that name these stream operations (injected freeze / prove / reader; do not boot live Sheets; worker lease proofs stay in worker tests):

**Stamp a valid source-read-through instant**
- A finite Date returns ISO UTC.
- An invalid Date throws.
- Do **not** assert `captureReportingSourceReadThrough` here. That stamp stays a run-persist test.

**Freeze the candidate manifest once and persist it**
- `buildManifest` runs once. The persist callback runs once. The returned freeze is what `stream` walks.
- Resume with a persisted freeze never asks `prepareManifest` again. That is a worker test, not a second freeze adapter.

**Emit mapped pages from a checkpoint**
- Uninterrupted walk yields every page. Resume from the first checkpoint yields only later pages. Accumulators match.
- Finished checkpoint (`rowCount > 0`, `cursor === null`) yields nothing.
- Read-through mismatch throws. Unsupported checkpoint version throws. Cursor that does not advance throws. Missing mapping throws.
- Resume with a drifted entry fails before `openPageReader` (`opened === 0`).
- Per-page prove runs before and after the query. Only mapped keys are proved.

**Prove the complete freeze in batches**
- Batch size < 1 throws. Entries are sliced by `pageSize`. Delivery-engine resume asks this after structure refuse — do not re-test structure here.

**Fold the data checksum**
- Empty report checksum equals `startTheDataChecksumFromTheFreeze`.
- Deterministic for the same input + freeze. Delivery verify asks the same fold from cells.

Do **not** add a test per helper (`lookupOnlyTheMappedDependenciesForThisPage`, `refuseWhenTheCursorDidNotAdvance`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start worker claim / lease, preview / estimate / confirm, Analytics, Sheet Sync, or live Google inside these tests. `runReportingDeliveryWorker` stays a worker test. Live harness stays `live/liveGoogleOrchestration.ts`.

## What I would not do

- A `ReportingStreamService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `buildReportingCandidateManifest` / `validateReportingManifestEntries` / `openPageReader`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `prepare.ts` / `stream.ts` / `checksum.ts`.
- Breaking the persist-then-stream **seam** by rebuilding a freeze the worker already saved.
- Breaking the resume-prove-before-reopen **seam** by opening the reader before the complete freeze is proved.
- Breaking the before-and-after-page-query **seam** by proving only once per page.
- Treating worker claim / lease, preview / estimate / confirm, sibling freeze / prove, sibling RAW write, Analytics, or Sheet Sync as this story.
- Inventing a second freeze **seam** that has only one **adapter** beside `buildReportingCandidateManifest`.
- Inventing a second prove **seam** that has only one **adapter** beside `validateReportingManifestEntries`.
- Inventing a second reader **seam** that has only one **adapter** beside `setReportingManifestPageAdapter`.
- Silently “fixing” the double complete-freeze prove inside `stream`, the unused `captureSourceReadThrough`, the default-throw reader, the module-level mutable adapter, the hardcoded 500, the empty-page no-yield, or the 1-based checkpoint pageNumber while recommending a rename.
- Starting `claimNextQueuedReportingRun` or `writeValuesRaw` from this file.
- Jumping to `queue.ts` leftover wakeup. Next pass is that module; do not pull it into this file. Do not jump to leftover `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for leftover `reporting`.
