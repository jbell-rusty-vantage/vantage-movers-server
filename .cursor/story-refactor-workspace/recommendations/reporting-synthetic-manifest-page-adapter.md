# Paint Three Synthetic SYN-LIVE Rows Instead Of Reading Form Lead Documents — Or Paint Fewer So Verify Fails — Never Prove Fingerprints, Never Bind Cursors, Never Restore The Official Reader — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 42 of this service — `live/syntheticManifestPageAdapter.ts`
- Remaining in this service: `live/transientRetryWrapper.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/syntheticManifestPageAdapter.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Execution package mandates literal `RAW` spreadsheet writes. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `createSyntheticLiveTestManifestPageAdapter`, `registerSyntheticLiveTestManifestPageAdapter`, `SyntheticLiveTestPageAdapterOptions`, `emitRowCount`, `SYN-LIVE-*`, or a live-test page paint that skips fingerprint prove — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended official page reader: [`reporting-manifest-page-adapter.md`](reporting-manifest-page-adapter.md) (official `open` **asks** `validateReportingManifestEntries` then `openReportingPageReader` and binds persisted cursors; this file copies `assertManifestCompatible` and **asks** the same `setReportingManifestPageAdapter` so the harness can inject rows without Mongo). Distinct from already-recommended stream emit: [`reporting-execution-stream.md`](reporting-execution-stream.md) (`reportingStage4StreamV1.stream` **asks** the installed `open`; default throws `ManifestPageAdapterUnavailableError` until foundation or this file **installs**; stream still proves page-targeted fingerprints and still throws `reporting_page_cursor_mapping_mismatch` after `readPage`). Distinct from already-recommended official freeze: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (`openReportingPageReader` **materializes** painted Mongo rows; this file never **asks** that reader). Distinct from already-recommended snapshot slot: [`reporting-snapshot-adapter.md`](reporting-snapshot-adapter.md) (sibling `registerSyntheticLiveTestSnapshotAdapter` swaps capture; this file swaps page paint). Distinct from already-recommended plant-three-fake-Form-Leads: [`reporting-synthetic-live-test-manifest.md`](reporting-synthetic-live-test-manifest.md) (that file plants documents and names the limitation; this file never reads those documents). Distinct from already-recommended factory seed-run: [`reporting-live-test-run-factory.md`](reporting-live-test-run-factory.md) (that file **asks** `liveTestSyntheticRows` and an `exact` `estimateRows`; this file paints those rows, or fewer). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** this register three times — full rows, `emitRowCount: 1`, full rows again). Distinct from already-recommended worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (orchestration **asks** `runReportingDeliveryWorker` after this swap; this file never starts the worker). Distinct from already-recommended verify: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`verifyStagingContents` **asks** `row_count_mismatch` when `exact` claimed rows ≠ estimate; `emitRowCount: 1` against estimate `3` is that fail). Distinct from already-recommended bootstrap: sibling `registerStage4Foundation.ts` **asks** `registerPersistedManifestPageAdapter` once; this file overwrites that slot and never restores. Distinct from unvisited retry wrapper: `live/transientRetryWrapper.ts`. Distinct from unvisited mask: `live/piiSafeEvidence.ts`. Distinct from unvisited later janitor / evaluate. Distinct from Wave B `src/routes/reporting.routes.ts` and Wave B `scripts/reporting/run-live-google-harness.ts` (**asks** the facade, never this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** `registerSyntheticLiveTestManifestPageAdapter` three times: replace-tab with `liveTestSyntheticRows()`, failed-replace with `emitRowCount: 1`, snapshot with `liveTestSyntheticRows()` again). No other `src/` import. `createSyntheticLiveTestManifestPageAdapter` has **no external caller** — only `register` **asks** it. Tests: **no test imports this file**. `live/liveGoogleHarness.test.ts` skip / mask only. `executionStream.test.ts` **injects** `openPageReader` into `createReportingStage4StreamV1` and never imports this file. `reportingDelivery.regressions.test.ts` **asks** `registerReportingStage4Foundation` so the official reader is installed — not this swap. `reporting.test.ts` / `reportingDelivery.test.ts` do **not** import this file. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: prove-this-freeze-belongs-to-this-request (`assertManifestCompatible`) vs paint-the-synthetic-rows-instead-of-reading-form-lead-documents (`create` / `rows` / `emitRowCount`) vs install-onto-the-stream-singleton (`register` **asks** `setReportingManifestPageAdapter`). The this-file / official-persisted-reader **seam** exists because both **ask** the same stream slot; foundation installs official first; this file overwrites and never restores. The prove-belong / skip-fingerprints **seam** exists because this `open` copies version + read-through and never **asks** `validateReportingManifestEntries`; stream still proves page-targeted entries after `readPage`. The paint / planted-Form-Lead **seam** exists because sibling seed writes `Synthetic Live Lead` documents and this file paints `SYN-LIVE-*`. The emit-count / factory-estimate **seam** exists because orchestration **asks** `emitRowCount: 1` against factory `estimateRows: 3` so exact verify fails and the prior published tab stays. The nextCursor-null / stream-cursor-bind **seam** exists because this file always returns `nextCursor: null`; stream still throws `reporting_page_cursor_mapping_mismatch` when the freeze said otherwise. The empty-checksum / stream-fold **seam** exists because `canonicalPageChecksum: ""` is what `advanceChecksumAccumulator` folds. There is no begin / complete Domain Command **seam**. There is no worker **seam**. There is no Google write **seam**. There is no HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~60-line file is one sitting if you read it as paint three synthetic SYN-LIVE rows instead of reading Form Lead documents — or paint fewer so verify fails — never prove fingerprints, never bind cursors, never restore the official reader. Do **not** split into `create.ts` / `register.ts` / `assert.ts` / `update.ts` / `delete.ts`. Do **not** pull official persist reader, stream emit, factory rows, Form Lead seed, or orchestration here so “one page-adapter file owns the company.” If it later splits: `proveThisFreezeBelongsToThisRequest.ts` / `paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments.ts` only as later story files, never CRUD.

`createSyntheticLiveTestManifestPageAdapter` / `registerSyntheticLiveTestManifestPageAdapter` are the factory and the install — executor mechanics. The owner question is: *After foundation installed the official persisted reader, swap the stream slot so the worker paints three synthetic `SYN-LIVE-*` rows instead of reading Form Lead documents. Still prove this freeze is version 1 and was captured at this source-read-through instant. Do not prove fingerprints. Do not bind persisted cursors. Do not rematerialize Mongo. Return `nextCursor` null and an empty page checksum every time. If we pass `emitRowCount: 1`, paint one row so exact verify fails and the prior published tab stays. Never restore the official reader. Do not start the worker from this file. Do not trash a folder. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended official page reader, stream emit, official freeze, Form Lead seed, factory seed-run, orchestration, worker, and verify already live in other **modules**. Retry wrapper, mask, later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Three operations of one “paint three synthetic SYN-LIVE rows instead of reading Form Lead documents — or paint fewer so verify fails — never prove fingerprints, never bind cursors, never restore the official reader” story, not “a page-adapter CRUD helper,” and not the official persisted reader:

1. **Prove this freeze belongs to this request** — copied `assertManifestCompatible`. Version must be `1` or `unsupported_reporting_manifest_version`. `manifest.sourceReadThrough` must equal `input.sourceReadThrough` or `reporting_manifest_read_through_mismatch`. Official persisted reader copies the same function. Stream `stream` already refuses the read-through miss **before** `open`. Stream does **not** refuse `manifest.version !== 1` — this file does. This file does **not** **ask** `validateReportingManifestEntries`. Official `open` does, before the reader opens.

2. **Paint the synthetic rows instead of reading Form Lead documents** — `create` slices `options.rows` to `emitRowCount ?? rows.length`. Orchestration **asks** factory `liveTestSyntheticRows()` (`SYN-LIVE-001` booked, `SYN-LIVE-002` cancelled, `SYN-LIVE-003` open) for replace-tab and snapshot. Failed-replace **asks** the same rows with `emitRowCount: 1`. Does not **ask** `openReportingPageReader`. Does not **ask** `queryReportingPage`. Does not read planted Form Lead documents. Comment on the file names the limitation: canonical Mongo rows are not read; synthetic rows are injected while the real worker lease / checkpoint / write / verify / promotion path still runs against Owner OAuth Google adapters.

3. **Serve every mapped page as that same painted bag** — the function `open` returns ignores `_mapping`. Every call returns `{ rows, rowCount: rows.length, nextCursor: null, canonicalPageChecksum: "" }`. Official reader **asks** `readByCursor(pageSize, mapping.afterCursor)` and refuses a next-cursor miss or an empty page that is not the end. This file throws neither. Stream still throws `reporting_page_cursor_mapping_mismatch` after `readPage` when the freeze’s `mapping.nextCursor` is not `null`. Stream `return`s on `rowCount === 0` before that check.

`registerSyntheticLiveTestManifestPageAdapter` is the install **seam**, not a fourth owner operation. `register` only **asks** `setReportingManifestPageAdapter(create(...))`. Orchestration **asks** register three times. `create` has no external caller.

## Organization

Keep one file. This is the screenplay for “paint three synthetic SYN-LIVE rows instead of reading Form Lead documents.” Official persist reader, stream emit, official freeze, Form Lead seed, factory rows, and orchestration already live in deeper **modules**. Do not pull those in. Do not invent a `SyntheticManifestPageAdapterService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second stream slot beside `setReportingManifestPageAdapter`. Do not invent a second official reader beside `createPersistedManifestPageAdapter`. Do not invent a second row bag beside `liveTestSyntheticRows`.

Do not split prove / paint / register into CRUD files. Prove-belong stays with paint because `open` must refuse a bad freeze before the worker writes RAW cells. Do not merge this file into `manifestPageAdapter.ts` so “one adapter owns both.” Do not start `openReportingPageReader` from this file so “live test proves Mongo paint.” Do not restore the official reader in this rename unless a later tested change says so.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createSyntheticLiveTestManifestPageAdapter` | `paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments` | factory; tests should **ask** this, not the stream fake |
| `registerSyntheticLiveTestManifestPageAdapter` | `installTheSyntheticPagePaint` | orchestration only |
| `SyntheticLiveTestPageAdapterOptions` | `WhichSyntheticRowsToPaint` | `rows` plus optional `emitRowCount` |

Keep the old names as one-line aliases until `live/liveGoogleOrchestration.ts` migrates. Do not make orchestration learn `paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments` as a new import path in this rename. Do not make the worker learn this file — the worker **asks** `stream`. Do not export `assertManifestCompatible` so “compat is public.”

**No class for the workflow.** `ReportingManifestPageAdapter` already lives on the stream as the install type. Do **not** turn this factory into a `SyntheticManifestPageAdapter` class. The type that *does* earn a name is the painted page `open` already returns:

```ts
type PaintedLiveTestPage = {
  rows: Array<Record<string, unknown>>
  rowCount: number
  nextCursor: null
  canonicalPageChecksum: ""
}
```

That is the handoff from “we painted these rows” to “the stream may write them RAW.” Do **not** put planted Form Lead ids on this type. Do **not** put `SYN-LIVE-*` literals on this type — factory owns those strings. Do **not** put lease owner / epoch on this type. Do **not** put Google range strings on this type. Do **not** put `refresh_token` on this type. Do **not** move catalog `QueryPage` / `ReportingOutputPageMapV1` into a new `types/` folder.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// syntheticManifestPageAdapter.ts
// After foundation installed the official persisted reader,
// swap the stream slot so the worker paints three synthetic
// SYN-LIVE-* rows instead of reading Form Lead documents.
// Still prove this freeze is version 1 and was captured
// at this source-read-through instant.
// Do not prove fingerprints.
// Do not bind persisted cursors.
// Do not rematerialize Mongo.
// Return nextCursor null and an empty page checksum.
// If we pass emitRowCount: 1, paint one row so exact
// verify fails and the prior published tab stays.
// Never restore the official reader.
// Do not start the worker from this file.
// Do not trash a folder.
// Do not hit HTTP.

// ── 1. Prove this freeze belongs to this request ──────────

function proveThisFreezeBelongsToThisRequest(input, manifest)
// version !== 1 → unsupported_reporting_manifest_version
// sourceReadThrough miss → reporting_manifest_read_through_mismatch

// ── 2. Paint the synthetic rows instead of Mongo ──────────

export function paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments(options)
// slice rows to emitRowCount ?? rows.length
// never asks openReportingPageReader
export const createSyntheticLiveTestManifestPageAdapter =
  paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments

export function installTheSyntheticPagePaint(options)
// setReportingManifestPageAdapter(paint(...))
// never restores registerPersistedManifestPageAdapter
export const registerSyntheticLiveTestManifestPageAdapter =
  installTheSyntheticPagePaint

// ── 3. Serve every mapped page as that same painted bag ───

// open returns (_mapping) => ({
//   rows,
//   rowCount: rows.length,
//   nextCursor: null,
//   canonicalPageChecksum: "",
// })
```

Read the replace-tab path out loud: *Foundation already installed the official persisted reader. Orchestration overwrites the slot with three `SYN-LIVE-*` rows. Worker claims the seeded run. Stream **asks** `open`. Prove version 1 and this source-read-through. Do not prove fingerprints. Do not open the Mongo page reader. Return the three rows, `nextCursor` null, empty checksum. Stream writes them RAW, verifies three against the exact estimate, and promotes. The planted Form Leads are still sitting in Mongo. Nobody painted their name, phone, or email.*

Read the failed-replace path out loud: *Register again with `emitRowCount: 1`. Seed a second queued run whose exact estimate is still three. Stream paints one row. Exact verify **asks** `row_count_mismatch`. The prior published tab stays. Do not restore the official reader in between.*

That is the operation. `createSyntheticLiveTestManifestPageAdapter` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`assertManifestCompatible` is copied from the official reader.** Same version + read-through throws. Official rec already named the copy. Do not extract a shared helper in this rename unless both files are already being touched (they are not). Do not merge the two files so “one assert owns both stories.”

2. **Open never proves fingerprints.** Official `open` **asks** `validateReportingManifestEntries` before the reader opens — first write’s complete prove. This file skips it. Stream still proves page-targeted `dependencyKeys` after `readPage`. Rename the skip (`doNotProveFingerprintsAtOpen`). Do not silently start **asking** the official prove so “live test proves Mongo paint.”

3. **Mapping is ignored.** Official reader binds `afterCursor` / `nextCursor`. This file prefixes `_mapping` and returns the same bag every time. Rename the ignore. Do not silently start binding cursors so “the synthetic reader looks official.”

4. **`nextCursor` is always `null`.** Stream still throws `reporting_page_cursor_mapping_mismatch` when the freeze’s mapping is not also `null`. Three factory rows at page size 500 are one page that ends. Rename the one-page bet. Do not silently start returning the freeze’s `mapping.nextCursor` so “multi-page live tests start working” without a paired test that names a second page.

5. **`canonicalPageChecksum` is always `""`.** Stream folds that empty string into `advanceChecksumAccumulator`. Official pages checksum real painted rows. Rename the empty fold. Do not silently start checksuming the synthetic rows so “the accumulator looks official.”

6. **Register never restores the official reader.** Foundation **asks** `registerPersistedManifestPageAdapter` once (`registered` flag). This file overwrites the same slot. Orchestration **asks** this register three times and never **asks** foundation again. Same leftover as the snapshot swap. Do not silently restore `registerPersistedManifestPageAdapter` in this rename. Do not silently skip foundation so “synthetic owns the process from boot.”

7. **`emitRowCount: 1` is the fail-replacement lever.** Factory estimate is `exact` `3`. Painting one row is what `verifyStagingContents` names `row_count_mismatch`. Rename the lever (`paintFewerRowsSoExactVerifyFails`). Do not silently change the factory estimate so “emit and estimate match.” Do not silently change verify so “one painted row still promotes.”

8. **`create` has no external caller.** Only `register` **asks** it. Rename as the factory tests should **ask**. Do not silently start orchestration importing `create` so “the factory earns a caller.”

9. **Painted rows are not the planted Form Leads.** Sibling seed writes `Synthetic Live Lead` / `+15555550100` / `live-test@example.invalid`. This file paints `SYN-LIVE-*`. Limitation sentence lives on the sibling, not this export. Rename the split. Do not silently start reading those documents so “page paint proves the seed.”

10. **Empty paint ends the stream before cursor check.** `emitRowCount: 0` → `rowCount === 0` → stream `return`s and never throws cursor mismatch. Official reader would throw `reporting_page_mapping_empty_before_end` when the freeze said more pages remain. Rename the empty-page gap. Do not silently copy that throw here.

11. **No test asks this file.** Stream tests inject `openPageReader`. Regression tests only install foundation. `emitRowCount` has no assertion. That is not enough for a story that overwrites the process-wide page slot.

12. **Leave sibling modules alone.** Official persist reader stays in `manifestPageAdapter.ts`. Stream emit stays in `executionStream.ts`. Factory rows stay in `liveTestRunFactory.ts`. Form Lead seed stays in `syntheticLiveTestManifest.ts`. Orchestration stays in `liveGoogleOrchestration.ts`. Worker write stays in `reportingWorker.ts`. Verify stays in `deliveryEngine.ts`. Foundation stays in `registerStage4Foundation.ts`. Do not open unvisited `live/transientRetryWrapper.ts` this pass.

## Testing

The **interface** is the test surface: `paintTheSyntheticRowsInsteadOfReadingFormLeadDocuments`, `installTheSyntheticPagePaint` (today `createSyntheticLiveTestManifestPageAdapter` / `registerSyntheticLiveTestManifestPageAdapter`).

Today **no test imports this file**. That is not enough for a story that overwrites the process-wide page slot.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Prove belong**
- Version ≠ 1 throws `unsupported_reporting_manifest_version` before any rows are returned.
- Source-read-through miss throws `reporting_manifest_read_through_mismatch`.

**Paint**
- Default emit returns all three factory rows, `rowCount: 3`, `nextCursor: null`, `canonicalPageChecksum: ""`.
- `emitRowCount: 1` returns one row. `validateReportingManifestEntries` is not **asked**. `openReportingPageReader` is not **asked**.
- Two `open` page calls return the same bag. Mapping `afterCursor` / `nextCursor` are ignored.

**Install**
- `register` **asks** `setReportingManifestPageAdapter`.
- Official `registerPersistedManifestPageAdapter` is not restored (name the gap). Do not silently restore in this rename.

**Empty paint**
- `emitRowCount: 0` returns `rowCount: 0`. Stream would `return` before cursor mismatch. Name the gap. Do not silently copy `reporting_page_mapping_empty_before_end`.

Do **not** add a test per helper (`assertManifestCompatible`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official janitor, worker write, queue publish, Analytics, or Sheet Sync inside these tests. Official persist reader stays `manifestPageAdapter` / stream tests. Live Google stays `pnpm reporting:live-google-harness`. Restore the page-adapter slot in `finally` if a later implementer **asks** register from a test.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `SyntheticManifestPageAdapterService` class or a `create.ts` / `register.ts` / `assert.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second stream slot beside `setReportingManifestPageAdapter`.
- I would not merge this file into `manifestPageAdapter.ts`.
- I would not silently start **asking** `validateReportingManifestEntries` or `openReportingPageReader`.
- I would not silently restore `registerPersistedManifestPageAdapter`.
- I would not silently start binding persisted cursors or checksuming the synthetic rows.
- I would not silently change factory `estimateRows` so emit and estimate match.
- I would not silently start reading planted Form Lead documents.
- I would not silently start the worker from this file.
- I would not open `live/transientRetryWrapper.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
