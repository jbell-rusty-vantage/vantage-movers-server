# Gather The Leads In This Window, Paint The Three Report Shapes, Estimate The Sheet, Page The Rows, Freeze A Candidate Manifest, Prove The Source Did Not Move — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 9 of this service — `query/canonicalReporting.ts`
- Remaining in this service: `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/query/canonicalReporting.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Datasets: exactly three keys — `lead_outcome_detail` (one canonical Lead per row), `lead_quality_exceptions` (one exception occurrence), `source_performance` (Source Company / optional granularity / time). Windows are America/New_York half-open `[from,to)`. Preview asks estimate + 50 sample rows. Estimate binds a query checksum. Happy path names leftover preview / freeze / estimate / confirm / leftover worker write — it never names this file, cohort load, primary-booking pick, orphan exception branches, candidate manifest, or source-read-through fence — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** `previewReportingQuery` / `estimateReportingQuery` / `computeQueryInputChecksum`; it never pages rows or freezes a manifest). Distinct from already-recommended leftover count-this-window: [`reporting-timezone.md`](reporting-timezone.md) (this file **asks** `halfOpenDatePredicate` for Mongo `$gte` / `$lt` and `displayInstant` for painted clocks; leftover timezone does not own which field is the clock). Distinct from leftover registry filters: sibling `registryFilters.ts` (`registryMongoPredicate` on Form Lead / Call Lead `timestamp` queries; this file owns leftover `registryHierarchyPredicate` on Booked / recon / conflict / cancellation orphans). Distinct from leftover pagination: sibling `query/pagination.ts` (`paginateRows` / `compareSortTuple` / `encodeCursor`; this file materializes, then **asks** those helpers). Distinct from leftover snapshot: sibling `snapshotAdapter.ts` (leftover freeze **asks** `getReportingSnapshotAdapter().capture`; leftover adapter owns the Mongo snapshot token). Distinct from leftover catalog: sibling `catalog/index.ts` (`ValidatedReportingRequest`, `EXCEPTION_TYPES`, `reportingError`, dataset columns). Distinct from leftover worker write: sibling `reportingWorker.ts` (**asks** `computeQueryPlanChecksum` only; leftover stream **asks** leftover freeze / leftover prove). Distinct from leftover execution stream: sibling `executionStream.ts` (**asks** `buildReportingCandidateManifest` + `validateReportingManifestEntries`; lifecycle is capture → persist once → open reader → validate page deps → emit). Distinct from leftover manifest page adapter: sibling `manifestPageAdapter.ts` (**asks** leftover prove, then leftover `openReportingPageReader`). Distinct from leftover delivery resume: sibling `deliveryEngine.ts` (`validatePersistedManifestForResume` **asks** leftover prove). Distinct from leftover live harness: `live/liveTestRunFactory.ts` (**asks** leftover input checksum); `live/syntheticLiveTestManifest.ts` (**asks** leftover `buildOutputPageMappings`). Distinct from already-recommended leftover destinations / leftover prove-this-destination / leftover remember-the-destination-row. Distinct from already-recommended leftover Analytics dispatcher: [`analytics-analytics.md`](analytics-analytics.md). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner preview / run; does not import this file). Distinct from leftover Wave B `src/validation/reporting.validation.ts` (draft → leftover timezone). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended leftover `reporting.service.ts` (`previewReportingDraftCore` **asks** leftover `previewReportingQuery` for estimate + 50 samples; leftover `prepareManualRun` estimate **asks** leftover `estimateReportingQuery` then leftover `computeQueryInputChecksum`). Leftover `reportingWorker.ts` (**asks** leftover `computeQueryPlanChecksum` when leftover source-read-through is first captured). Leftover `executionStream.ts` (`reportingStage4StreamV1` **asks** leftover `buildReportingCandidateManifest` + leftover `validateReportingManifestEntries`). Leftover `manifestPageAdapter.ts` (**asks** leftover prove then leftover `openReportingPageReader`). Leftover `deliveryEngine.ts` (`validatePersistedManifestForResume` **asks** leftover prove). Leftover `live/liveTestRunFactory.ts` (**asks** leftover input checksum). Leftover `live/syntheticLiveTestManifest.ts` (**asks** leftover `buildOutputPageMappings`). Tests: `reporting.test.ts` **asks** leftover `deriveReportingEstimate`, leftover `representativeSampleRows`, leftover `choosePrimaryBooking`, leftover `aggregateSourcePerformance`, leftover `sourcePerformanceGroupIdentity`, leftover `isUnresolvedCplStatus`, leftover `queryReportingPage` (page-size reject only), leftover `buildReportingCandidateManifest` + leftover `validateReportingManifestEntries` (leadless booking fingerprint), leftover `assertWithinQueryBudget` / leftover `assertGlobalMaterializationBudget`, leftover `CanonicalSourceChangedError` shape. `reportingDelivery.test.ts` / leftover stream tests do not import this file by name. **No runtime caller** for leftover `executeReportingQuery`, leftover `sampleReportingQuery`, leftover `queryReportingPage`, or leftover `assertReportingCandidateManifestUnchanged`.
- Seams callers need: estimate-this-window (`estimateReportingQuery` / leftover `deriveReportingEstimate`) vs hand-leftover-preview-fifty-samples (`previewReportingQuery`) vs paint-the-three-shapes (`executeReportingQuery` / leftover internal) vs page-the-painted-rows (`openReportingPageReader`; leftover `queryReportingPage` is the rematerialize twin) vs freeze-the-candidate-manifest (`buildReportingCandidateManifest`) vs prove-those-records-did-not-move (`validateReportingManifestEntries`) vs checksum-the-query (`computeQueryInputChecksum`) vs checksum-the-plan (`computeQueryPlanChecksum`). The exact / upper-bound **seam** exists because leftover capacity refuses an `upper_bound` that cannot prove fit. The preview-sample / leftover-worker-page **seam** exists because leftover preview may show fifty rows and leftover worker must walk every page under the same sort. The freeze / prove **seam** exists because leftover stream persists the manifest once, then leftover resume re-reads fingerprints without rebuilding. The query-input / query-plan **seam** exists because leftover estimate binds the validated request and leftover worker bind also includes destination snapshot + source-read-through. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no destination-desk **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~1640-line file is one sitting if you read it as gather the leads in this window, paint the three report shapes, estimate the sheet, page the rows, freeze a candidate manifest, prove the source did not move. Do **not** split into `execute.ts` / `estimate.ts` / `manifest.ts` so “each query verb owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split `detail.ts` / `performance.ts` / `exceptions.ts` so “each dataset owns a CRUD file.” Do **not** pull leftover timezone / leftover pagination / leftover snapshot / leftover destinations / leftover worker RAW write here so “one query file owns the company.” If it later splits: `estimateHowManyRowsThisWindowWouldWrite.ts` / `paintTheThreeReportShapes.ts` / `freezeTheCandidateManifestAndProveTheSourceDidNotMove.ts` only as later story files, never CRUD.

`executeReportingQuery` / `estimateReportingQuery` / `previewReportingQuery` / `queryReportingPage` / `buildReportingCandidateManifest` are executor mechanics. The owner question is: *I designed a report. Count how many rows this Eastern window would write — exact when you can prove it, a safe upper bound when you cannot. Show me fifty representative samples so I can see first, last, and each category. When leftover worker writes, gather every Form Lead and Call Lead in that window, attach their bookings and cancellations, paint one row per lead, one row per source group, or one row per exception, then page those rows without asking Mongo again. Freeze the IDs and fingerprints of every record you used. If any of those records moved after the source-read-through instant, refuse and retry as a new run. Do not write Google. Do not preview the destination. Do not run Analytics. Do not sync the Master Sheet.*

Leftover preview / freeze / estimate / confirm, leftover timezone window, leftover pagination helpers, leftover snapshot token, leftover destinations, leftover worker RAW write, leftover Analytics, leftover Sheet Sync already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “gather the leads in this window, paint the three report shapes, estimate the sheet, page the rows, freeze a candidate manifest, prove the source did not move” story, not “a reporting query CRUD service,” and not leftover preview desk or leftover worker write:

1. **Estimate how many rows this window would write** — `estimateReportingQuery` / `deriveReportingEstimate`. Count Form Leads + Call Leads in the leftover half-open window + leftover registry predicate + optional `createdAt <= sourceReadThrough`. Does not load the rows. `lead_outcome_detail`: `exact` when leftover booking / merchant / route / cancel filters are absent; `upper_bound` (same cohort count, “before outcome filters”) when they are present. `source_performance`: `exact` 0 when the cohort is empty; otherwise `upper_bound` = cohort (“each group has at least one lead”). `lead_quality_exceptions`: `upper_bound` = `cohort * 4 + orphanUpper` (at most four lead exceptions per lead, plus independently counted leadless bookings, pending recon cases, open canonical-divergence conflicts, and cancellations with no `lead_ref`). Unsafe integers throw `TypeError`. Leftover estimate **asks** this so leftover capacity can refuse an `upper_bound` that cannot prove fit. Does not paint rows. Does not talk to Drive.

2. **Hand leftover preview fifty representative samples** — `previewReportingQuery`. Paint the full report (operation 3), then estimate again (operation 1), then keep at most 50 rows: first, last, one of each category (`lead_type` / booked / cancelled on detail; `exception_type` on exceptions; period + source ids on performance), then evenly spaced fill. Limit outside 1..50 → `RangeError`. Project only the selected columns. Leftover preview desk **asks** this with `limit = 50`. Leftover `sampleReportingQuery` is the same sample without the estimate — **no runtime caller**.

3. **Paint the three report shapes** — `executeReportingQuery` / leftover `executeReportingQueryInternal`. Gather Form + Call leads (`REPORTING_MAX_COHORT_ROWS + 1`, then leftover budget 409). Sort by timestamp / lead type / id. Attach Booked Leads by `lead_ref` and Cancelled Leads by those bookings (`REPORTING_MAX_RELATED_ROWS`, leftover combined budget). `lead_outcome_detail`: one row per lead; leftover `choosePrimaryBooking` prefers an uncancelled booking, then newest `book_date`, then id; leftover `detailFilter` may drop rows after paint. `source_performance`: group by leftover `sourcePerformanceGroupIdentity` (period + company id + optional granularity key — **not** the painted label); leftover `aggregateSourcePerformance` counts every related booking. `lead_quality_exceptions`: up to four lead exceptions (duplicate, bad, unresolved CPL / missing source, multiple bookings) plus four orphan branches (leadless booking, pending recon, open divergence, scoped unresolved cancellation `$lookup`). Sort. Then leftover `executeReportingQuery` projects selected columns. **No runtime caller** for the exported wrapper — leftover preview / leftover page / leftover freeze all **ask** the internal paint.

4. **Page the painted rows for leftover worker** — `openReportingPageReader` / leftover `queryReportingPage`. Materialize operation 3 once (reader) or again on every call (leftover `queryReportingPage`). Leftover `paginateRows` walks the leftover sort. Re-checksum the **projected** page (`artifact_kind: "reporting_page"`). Page size outside 1..`REPORTING_MAX_PAGE_SIZE` → `RangeError` before leftover pagination. Leftover manifest page adapter **asks** leftover reader, then compares leftover `nextCursor` to the persisted mapping. Leftover `queryReportingPage` is test-only for the page-size reject.

5. **Freeze a candidate manifest of the records we used** — `buildReportingCandidateManifest`. Leftover snapshot adapter `capture` under a session: same cohort + outcomes as operation 3; one leftover `candidateManifestEntry` per Form / Call / Booked / Cancelled (`updatedAt` ISO version + fingerprint of the identity fields). Exception datasets also collect leftover orphan ids (and leftover recon bookings / leftover cancellation’s joined booking / form / call). Dedup by `model:id`, sort, leftover `buildOutputPageMappings` (page size 500) so every painted row’s `_dependencyKeys` are in the entry set — missing keys throw `reporting_output_dependency_mapping_missing`. Checksum the bag (`sourceReadThrough`, captured-at, snapshot token, entries, pages). Leftover stream persists this once.

6. **Prove those records did not move after source-read-through** — `validateReportingManifestEntries`. Re-read each persisted id. Missing row, `updatedAt` after leftover `sourceReadThrough`, or version / fingerprint drift → leftover `CanonicalSourceChangedError` (`retryable: true`). Leftover stream and leftover delivery resume **ask** this. Leftover `assertReportingCandidateManifestUnchanged` rebuilds the whole manifest and compares entry+page checksums (not the snapshot token) — **no runtime caller**. Do not start calling leftover rebuild from leftover stream so “one prove owns the company.”

`computeQueryInputChecksum` / `computeQueryPlanChecksum` / leftover `CanonicalSourceChangedError` / leftover `assertWithinQueryBudget` / leftover `assertGlobalMaterializationBudget` / leftover `registryHierarchyPredicate` / leftover `buildScopedUnresolvedCancellationPipeline` / leftover `representativeSampleRows` / leftover `choosePrimaryBooking` / leftover `aggregateSourcePerformance` / leftover `sourcePerformanceGroupIdentity` / leftover `isUnresolvedCplStatus` / leftover `buildOutputPageMappings` are beats or checksum **seams**, not extra owner operations. `ReportingCandidateManifestV1` lives in leftover catalog — do not move it here.

## Organization

Keep one file. This is the screenplay for “gather the leads in this window, paint the three report shapes, estimate the sheet, page the rows, freeze a candidate manifest, prove the source did not move.” Leftover timezone window, leftover pagination cursor, leftover snapshot token, leftover destination desk, leftover worker RAW write already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingQueryService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second pagination **adapter** beside leftover `paginateRows`. Do not invent a second snapshot **adapter** beside leftover `getReportingSnapshotAdapter`. Do not invent a second window **adapter** beside leftover `halfOpenDatePredicate` / leftover `displayInstant`.

Do not split estimate / paint / freeze into CRUD files. Estimate and paint stay together because leftover preview **asks** both and leftover capacity reads the estimate kind. Freeze and prove stay together because leftover stream persists the same fingerprints leftover resume re-reads. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED`. Do not start talking to Drive.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `estimateReportingQuery` | `estimateHowManyRowsThisWindowWouldWrite` | leftover estimate / leftover capacity |
| `deriveReportingEstimate` | `decideExactOrSafeUpperBound` | same estimate without Mongo; leftover tests |
| `previewReportingQuery` | `handLeftoverPreviewFiftyRepresentativeSamples` | leftover preview desk |
| `executeReportingQuery` | `paintTheThreeReportShapes` | unused wrapper; keep alias |
| `openReportingPageReader` | `openAReaderOverThePaintedRows` | leftover manifest page adapter |
| `queryReportingPage` | `pageThePaintedRowsOnce` | rematerialize twin; test page-size reject |
| `buildReportingCandidateManifest` | `freezeACandidateManifestOfTheRecordsWeUsed` | leftover execution stream |
| `validateReportingManifestEntries` | `proveThoseRecordsDidNotMoveAfterSourceReadThrough` | leftover stream / leftover delivery resume |
| `assertReportingCandidateManifestUnchanged` | `rebuildTheManifestAndRefuseIfItDrifted` | unused; leftover stream uses leftover prove |
| `computeQueryInputChecksum` | `checksumThisQueryInput` | leftover estimate bind |
| `computeQueryPlanChecksum` | `checksumThisQueryPlanWithDestinationAndReadThrough` | leftover worker first capture |
| `buildOutputPageMappings` | `mapEachPageToTheRecordsItDependsOn` | leftover freeze + leftover live synthetic |
| `CanonicalSourceChangedError` | `TheSourceMovedAfterReadThrough` | leftover worker retry |
| `sampleReportingQuery` | `sampleThePaintedRowsWithoutEstimating` | unused; leftover preview already samples |

Keep the old names as one-line aliases until leftover `reporting.service.ts`, leftover `reportingWorker.ts`, leftover `executionStream.ts`, leftover `manifestPageAdapter.ts`, leftover `deliveryEngine.ts`, leftover live harness, and `reporting.test.ts` migrate. Do not make leftover preview learn `executeReportingQuery` as “show fifty rows.” Do not make leftover worker learn leftover `queryReportingPage` as the reader. Do not make leftover stream learn leftover `assertReportingCandidateManifestUnchanged` as leftover prove.

**No class for the workflow.** The leftover Stage-4 stream class stays in leftover `executionStream.ts`. The type that *does* earn a name is the frozen candidate bag:

```ts
type FrozenCandidateManifest = {
  version: 1
  sourceReadThrough: string
  manifestCapturedAt: string
  snapshotToken: { adapter: "mongodb_snapshot"; operationTime: string; capturedAt: string }
  entries: Array<{ model: string; id: string; version: string; fingerprint: string }>
  outputPages: Array<{ pageNumber: number; afterCursor: string | null; nextCursor: string | null; dependencyKeys: string[] }>
  checksum: string
}
```

That is the handoff from “we painted these rows under this snapshot” to “leftover worker may write if these fingerprints still match.” Do **not** put leftover destination snapshot or leftover RAW write semantics on this type. Do **not** move leftover catalog `ReportingCandidateManifestV1` into a new `types/` folder. Do **not** put leftover `_dependencyKeys` on the owner-facing painted row — leftover project strips them before leftover preview / leftover page return.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// query/canonicalReporting.ts
// The owner designed a report for this Eastern window.
// Count how many rows the sheet would need.
// Show fifty representative samples.
// When leftover worker writes, gather the leads,
// paint the three shapes, page the rows,
// freeze the records we used, and refuse if any of them moved.

// ── 1. Estimate how many rows this window would write ─────

export async function estimateHowManyRowsThisWindowWouldWrite(input)
export function decideExactOrSafeUpperBound({ datasetKey, cohortRows, hasOutcomeFilters, orphanUpper })

async function countTheFormAndCallLeadsInThisWindow(input)
async function countTheOrphanExceptionBranches(input)   // leadless / recon / divergence / unscoped cancel

// ── 2. Hand leftover preview fifty representative samples ─

export async function handLeftoverPreviewFiftyRepresentativeSamples(input, limit = 50)
export async function sampleThePaintedRowsWithoutEstimating(input, limit = 50) // unused alias

function pickFirstLastEachCategoryThenFillEvenly(datasetKey, rows, limit)

// ── 3. Paint the three report shapes ──────────────────────

export async function paintTheThreeReportShapes(input)

async function gatherTheFormAndCallLeadsInThisWindow(input, session)
async function attachBookingsAndCancellations(leads, sourceReadThrough, session)
function paintOneRowPerLead(leads, outcomes, input)
function pickThePrimaryBookingPreferringActiveThenNewest(bookings, cancellationsByBooking)
function keepOnlyTheLeadsTheOwnerFiltered(row, filters)
function paintOneRowPerSourceGroup(leads, outcomes, input)
function nameTheSourceGroupByIdsNotLabels(lead, input)
function countEveryRelatedBookingInTheGroup(leads, bookings, cancellationsByBooking)
async function paintOneRowPerException(leads, outcomes, input, session)
function isCplStillUnresolved(status)
function predicateTheOrphanOnThisSourceHierarchy(registry, paths)
function lookupCancellationsThatLostTheirLead(input, limit)

// ── 4. Page the painted rows for leftover worker ──────────

export async function openAReaderOverThePaintedRows(input)
export async function pageThePaintedRowsOnce(input, pageSize, after) // rematerialize twin

function projectOnlyTheColumnsTheOwnerPicked(rows, selectedIds)
function refuseWhenThisBranchExceedsTheSafeBound(count, limit, label)
function refuseWhenTheCombinedBranchesExceedTheSafeBound(branches, limit)
function refuseWhenARowMovedAfterSourceReadThrough(rows, sourceReadThrough)

// ── 5. Freeze a candidate manifest of the records we used ─

export async function freezeACandidateManifestOfTheRecordsWeUsed(input)
export function mapEachPageToTheRecordsItDependsOn(rows, sort, pageSize, manifestEntryKeys)
export function checksumThisQueryInput(input)
export function checksumThisQueryPlanWithDestinationAndReadThrough(input)

async function captureTheCohortUnderTheSnapshotAdapter(input)
function fingerprintThisRecord(model, row)
async function collectTheOrphanIdsTheExceptionRowsNeed(input, budget, session)

// ── 6. Prove those records did not move ───────────────────

export async function proveThoseRecordsDidNotMoveAfterSourceReadThrough(entries, sourceReadThrough)
export async function rebuildTheManifestAndRefuseIfItDrifted(input, expected) // unused
export class TheSourceMovedAfterReadThrough extends Error {}
```

Read the primary path out loud: *count the Form Leads and Call Leads in this leftover half-open window. If leftover preview is asking, paint every row, estimate again, and keep first, last, each category, then fill to fifty. If leftover worker is asking, gather those leads, attach their bookings and cancellations, paint one row per lead or source group or exception, page the painted rows, freeze every record id and fingerprint under leftover snapshot, then re-read those ids before each write. If any `updatedAt` moved after source-read-through, refuse and retry as a new run.*

That is the operation. `executeReportingQuery` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover preview paints the company, then counts it again.** `handLeftoverPreviewFiftyRepresentativeSamples` **asks** leftover paint (full cohort + bookings + orphans) and then leftover `estimateHowManyRowsThisWindowWouldWrite` (a second pair of `countDocuments` plus leftover orphan counts). One story, two Mongo walks. Shared beat: leftover `decideExactOrSafeUpperBound` already accepts a cohort number. Do not silently skip the second count in this rename.

2. **Three leftover sample / paint wrappers.** Leftover `paintTheThreeReportShapes`, leftover `sampleThePaintedRowsWithoutEstimating`, leftover `pageThePaintedRowsOnce`, and leftover preview all **ask** leftover `executeReportingQueryInternal`. Only leftover preview and leftover reader have runtime callers. Keep leftover paint / leftover sample / leftover rematerialize page as aliases. Do not delete them in this pass so “the unused export is clutter.”

3. **Orphan exception queries are triplicated.** Leftover estimate count, leftover exception paint, and leftover freeze `collectExceptionManifestEntries` each query leadless bookings, pending recon, open divergences, and unresolved cancellations. Same story, three **adapters**. Shared beats: leftover `predicateTheOrphanOnThisSourceHierarchy` and leftover `lookupCancellationsThatLostTheirLead`. Only the select list / leftover remaining budget / leftover session differ.

4. **Leftover estimate’s cancellation orphan is unscoped.** Leftover count is `CancelledLead` with null `lead_ref` in the window. Leftover paint / leftover freeze use leftover `$lookup` onto booking + form/call and leftover `registryHierarchyPredicate`. The estimate can overstate. Rename the leftover count beat (`countUnscopedCancellationsWithNoLeadRef`) so the gap is visible. Do not silently switch leftover estimate to leftover scoped pipeline while recommending a rename.

5. **Leftover count fences `createdAt`; leftover paint also refuses a later `updatedAt`.** Leftover `countTheFormAndCallLeadsInThisWindow` does not **ask** leftover `refuseWhenARowMovedAfterSourceReadThrough`. A lead created before leftover read-through and patched after it still increments leftover estimate. Leave that order. Do not start throwing leftover `TheSourceMovedAfterReadThrough` from leftover count so “estimate is as strict as paint.”

6. **Two leftover prove implementations.** Leftover `proveThoseRecordsDidNotMoveAfterSourceReadThrough` re-reads each id. Leftover `rebuildTheManifestAndRefuseIfItDrifted` rebuilds the company and compares entry+page checksums (not leftover snapshot token / leftover `manifestCapturedAt`). Leftover stream **asks** leftover prove. Do not start calling leftover rebuild from leftover stream.

7. **Leftover page checksums twice.** Leftover `paginateRows` checksums the unprojected slice. This file overwrites `canonicalPageChecksum` with the projected payload. Leftover reader / leftover rematerialize page both do that. Do not silently drop leftover pagination’s checksum so “one checksum owns the page.”

8. **Leave sibling modules alone.** Leftover `resolveReportingDateWindow` / leftover `halfOpenDatePredicate` / leftover `displayInstant`, leftover `paginateRows`, leftover `getReportingSnapshotAdapter`, leftover `registryMongoPredicate`, leftover `assertEstimateFitsCapacity` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `estimateHowManyRowsThisWindowWouldWrite`, `handLeftoverPreviewFiftyRepresentativeSamples`, `paintTheThreeReportShapes`, `openAReaderOverThePaintedRows`, `freezeACandidateManifestOfTheRecordsWeUsed`, `proveThoseRecordsDidNotMoveAfterSourceReadThrough`, `checksumThisQueryInput`, `checksumThisQueryPlanWithDestinationAndReadThrough`.

Today’s `reporting.test.ts` already names leftover exact / upper-bound math, leftover representative first/last/category, leftover primary-booking pick, leftover source-performance aggregates (all related bookings; unresolved CPL excludes `resolved` / `duplicate_zero` / `not_applicable`), leftover grouping by ids not labels, leftover leadless-booking fingerprint stay/change, leftover page-size reject, leftover combined-branch budget. Keep those. Replace the helper-dump style with tests that name these query operations (Mongo in `TEST_MODE`; do not boot leftover live Google; do not call leftover preview desk or leftover worker RAW write):

**Estimate how many rows this window would write**
- Detail, no leftover outcome filters → `exact`, rows = Form + Call counts in leftover window.
- Detail with leftover booking / merchant / route / cancel filters → `upper_bound`, same row count, leftover “before outcome filters” letter.
- Performance, empty cohort → `exact` 0. Non-empty → `upper_bound` = cohort.
- Exceptions → `upper_bound` = `cohort * 4 +` leftover orphan counts. Keep the 10 + 7 = 47 proof.
- Unsafe / negative leftover cohort → `TypeError`.
- Do **not** assert leftover `assertEstimateFitsCapacity` here — that stays a leftover-reporting test. This test only proves the kind and the row count.

**Hand leftover preview fifty representative samples**
- Existing first / last / booked / cancelled / every leftover `EXCEPTION_TYPES` proof stays.
- Sample length ≤ 50. Limit 0 or 51 → `RangeError`.
- Returned keys are only leftover selected columns (no leftover `_dependencyKeys`, no leftover `_agentKeys`).

**Paint the three report shapes**
- Detail: one row per leftover lead; leftover primary booking prefers active then newest; leftover quoted is `not_applicable` on Call Lead.
- Performance: two leftover label snapshots still share one leftover group key; leftover binder / deposit sum every related booking; leftover net bookings = bookings − cancelled.
- Exceptions: leftover duplicate / bad / missing source / multiple bookings emit leftover lead exceptions; leftover leadless / recon / divergence / scoped unresolved cancellation emit leftover orphans.
- Cohort `REPORTING_MAX_COHORT_ROWS + 1` → 409 `reporting_query_budget_exceeded`.
- A row with leftover `updatedAt` after leftover `sourceReadThrough` → leftover `TheSourceMovedAfterReadThrough`.

**Page the painted rows**
- Keep leftover page-size reject on leftover `pageThePaintedRowsOnce`.
- Leftover reader: two leftover pages cover the painted rows once; leftover `canonicalPageChecksum` is over leftover projected rows and is stable across `structuredClone`.
- Do **not** assert leftover `nextCursor` vs leftover persisted mapping here — that stays a leftover-manifest-page-adapter test.

**Freeze / prove**
- Existing leftover leadless booking fingerprint stay / change proofs stay.
- Leftover freeze entries are unique by `model:id` and leftover output pages have leftover `dependencyKeys`.
- Leftover prove: missing id, leftover `updatedAt` after leftover read-through, or leftover `job_no` / leftover source snapshot change → leftover `TheSourceMovedAfterReadThrough`.
- Do **not** start leftover `rebuildTheManifestAndRefuseIfItDrifted` inside leftover stream tests.

**Checksums**
- Leftover query-input checksum is deterministic for the same leftover `ValidatedReportingRequest`.
- Leftover query-plan checksum changes when leftover `sourceReadThrough` or leftover destination snapshot checksum changes.

Do **not** add a test per helper (`nameTheSourceGroupByIdsNotLabels`, `predicateTheOrphanOnThisSourceHierarchy`, `lookupCancellationsThatLostTheirLead`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Leftover `decideExactOrSafeUpperBound` / leftover `pickThePrimaryBookingPreferringActiveThenNewest` stay exported because leftover tests and leftover paint are a second real **adapter**, not a test leak.

Do **not** start leftover preview desk / leftover freeze-revision / leftover destination Drive / leftover worker RAW write / leftover Analytics / leftover Sheet Sync inside these tests. Leftover `previewThisReportDraft` stays a leftover-reporting test. Leftover `validateDestinationSnapshot` stays a leftover-contract test. Leftover `commitPromotionDestinationCas` stays a leftover-promotion-reservation test.

## What I would not do

- A `ReportingQueryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `countDocuments` / leftover `find` / leftover `paginateRows`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `execute.ts` / `estimate.ts` / `manifest.ts` or `detail.ts` / `performance.ts` / `exceptions.ts`.
- Breaking the exact / upper-bound **seam** (leftover capacity must still see `kind`).
- Breaking the freeze / prove **seam** by making leftover stream rebuild the manifest on every leftover page.
- Breaking leftover `sourceReadThrough` / leftover `updatedAt` fence so leftover worker can write a row that moved.
- Treating leftover preview / freeze / estimate / confirm, leftover timezone, leftover pagination, leftover snapshot, leftover destinations, leftover worker RAW write, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing a second pagination **seam** that has only one **adapter** beside leftover `paginateRows`.
- Inventing a second snapshot **seam** that has only one **adapter** beside leftover `getReportingSnapshotAdapter`.
- Silently “fixing” leftover preview’s double Mongo walk, leftover unscoped estimate cancellation count, leftover unused `executeReportingQuery` / leftover `sampleReportingQuery` / leftover `queryReportingPage` / leftover `assertReportingCandidateManifestUnchanged`, leftover count-vs-paint fence, or leftover page double-checksum while recommending a rename.
- Starting to check `REPORTING_GOOGLE_DELIVERY_ENABLED` inside this file.
- Jumping to `query/pagination.ts`’s leftover cursor — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
