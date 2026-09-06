# Prove This Freeze Matches This Request, Open The Painted-Row Reader Once, Then Serve Only The Mapped Pages — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 18 of this service — `manifestPageAdapter.ts`
- Remaining in this service: `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/manifestPageAdapter.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Source read-through is captured by the worker under the active lease owner/epoch. Execution package mandates literal `RAW` spreadsheet writes. Knowledge never names this file, `createPersistedManifestPageAdapter`, `registerPersistedManifestPageAdapter`, `assertManifestCompatible`, `reporting_page_cursor_mapping_mismatch`, or `reporting_page_mapping_empty_before_end` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended gather / paint / page / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (`openReportingPageReader` **materializes** the painted rows once and returns `(pageSize, after?)`; `validateReportingManifestEntries` **proves** fingerprints; `queryReportingPage` rematerializes every call — this file **asks** the reader and the prove, then binds each persisted page map). Distinct from already-recommended freeze-once / emit: [`reporting-execution-stream.md`](reporting-execution-stream.md) (`reportingStage4StreamV1.stream` **asks** `manifestPageAdapter.open`; default adapter throws `ManifestPageAdapterUnavailableError` until this file **installs**; stream resume **asks** `validateCompleteManifestBatched` before and after `open`; stream also throws `reporting_page_cursor_mapping_mismatch` after `readPage` — this file never folds a data checksum and never yields a checkpoint). Distinct from already-recommended persist-the-freeze: [`reporting-manifest-repository.md`](reporting-manifest-repository.md) (unique `{ run_id }` freeze metadata; this file never inserts or loads Mongo). Distinct from already-recommended claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** `stream`; it never imports this file). Distinct from already-recommended RAW write / resume prove: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`assertPersistedManifestStructure` / `validatePersistedManifestForResume` **prove** version / source-read-through / page map / batched entries **before** the worker **asks** `stream`; the engine does **not** import this file). Distinct from already-recommended bootstrap: sibling `registerStage4Foundation.ts` **asks** `registerPersistedManifestPageAdapter` once (idempotent `registered` flag). Distinct from live synthetic reader: `live/syntheticManifestPageAdapter.ts` copies `assertManifestCompatible` and **asks** the same `setReportingManifestPageAdapter` so the harness can inject rows without Mongo — it does **not** prove fingerprints and does **not** bind persisted cursors. Distinct from Wave B `src/app.ts` and `api/queues/reporting-consumer.ts` (they **ask** foundation; they never import this file). Distinct from Wave B `src/routes/reporting.routes.ts` (Owner preview / run; does not import this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `registerStage4Foundation.ts` (**asks** `registerPersistedManifestPageAdapter` with no deps). Runtime install sites **ask** foundation, not this file: `src/app.ts` (Express bootstrap), `api/queues/reporting-consumer.ts` (queue consumers do not inherit Express), `live/liveGoogleOrchestration.ts`. Tests: `reportingDelivery.regressions.test.ts` **asks** `registerReportingStage4Foundation` twice (idempotent) so this reader is installed as a side effect — it never imports this file and never names `reporting_page_mapping_empty_before_end`. `executionStream.test.ts` **injects** `openPageReader` into `createReportingStage4StreamV1` and never imports this file. `reporting.test.ts` / `reportingDelivery.test.ts` do **not** import this file. **No runtime caller** for `createPersistedManifestPageAdapter` except `registerPersistedManifestPageAdapter`. Confirm / heartbeat / Owner GET do **not** import this file.
- Seams callers need: factory (`create`) vs install-on-the-stream-singleton (`register` **asks** `setReportingManifestPageAdapter`). Open-once (`open` materializes, then returns a page function) vs rematerialize-every-page (`queryReportingPage` is the twin this file must not call). Prove-the-whole-freeze-at-open vs stream page-targeted prove (first write has **no** `validateCompleteManifestBatched`; this `open` is that write’s complete prove). Persisted-cursor-map vs live page (`afterCursor` / `nextCursor` must match the freeze). This persisted reader vs live synthetic reader (same install **seam**; synthetic skips prove and cursor bind). Empty-before-end here vs stream empty-page return (stream `return`s on `rowCount === 0`; only this file throws when the freeze said more pages remain). There is no persist-freeze **seam**. There is no lease **seam**. There is no Google write **seam**. There is no begin / complete Domain Command **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~73-line file is one sitting if you read it as prove this freeze matches this request, open the painted-row reader once, then serve only the mapped pages. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `open.ts` / `read.ts` / `register.ts` so “each verb owns a file.” Do **not** pull stream emit / freeze persist / worker Google write / live synthetic rows here so “one reader file owns the company.” If it later splits: `proveThisFreezeMatchesThisRequest.ts` / `serveOnlyTheMappedPages.ts` only as later story files, never CRUD.

`createPersistedManifestPageAdapter` / `registerPersistedManifestPageAdapter` are the factory and the install — executor mechanics. The owner question is: *The worker already froze the records we used. Before we walk pages, prove this freeze is version 1 and was captured at this source-read-through instant. Prove those frozen fingerprints still match. Open the painted-row reader once — do not ask Mongo again for every page. Then for each persisted page map, read exactly that cursor window. If the next cursor is not what we froze, refuse. If a page is empty but the freeze said more pages remain, refuse. Do not write Google. Do not persist the freeze. Do not claim a lease. Do not swap the managed tab. Do not publish the poke.*

Stream emit, freeze persist, worker Google write, live synthetic rows, and foundation bootstrap already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “prove this freeze matches this request, open the painted-row reader once, then serve only the mapped pages” story, not “a page-adapter CRUD service,” and not the stream emit:

1. **Prove this freeze belongs to this request** — `assertManifestCompatible`. Version must be `1` or `unsupported_reporting_manifest_version`. `manifest.sourceReadThrough` must equal `input.sourceReadThrough` or `reporting_manifest_read_through_mismatch`. Stream `stream` already refuses the read-through miss **before** `open`. Stream does **not** refuse `manifest.version !== 1` — this file does. Live synthetic copies this function. Delivery-engine structure prove also refuses version ≠ 1, but the engine does not import this file.

2. **Prove the frozen fingerprints still match before the reader opens** — `open` **asks** `validateReportingManifestEntries(manifest.entries, manifest.sourceReadThrough)` **before** `openReader`. First write has no stream checkpoint, so stream does **not** call `validateCompleteManifestBatched` before `open`. This beat is that write’s complete prove. Resume then triples it: stream batched prove → this `open` → stream batched prove again. Missing row, `updatedAt` after source-read-through, or version / fingerprint drift → sibling `CanonicalSourceChangedError`. This file does not catch that error.

3. **Open the painted-row reader once** — `open` **asks** injected `openReader` (runtime: `openReportingPageReader(input)`). Sibling paint materializes the three report shapes once and returns `(pageSize, after?)`. Default `pageSize` is `REPORTING_PAGE_SIZE` from config (500). Stream singleton hardcodes `pageSize: 500` and does not import the constant. Do not **ask** `queryReportingPage` here — that rematerializes every page.

4. **Serve each mapped page through the exact persisted cursors** — the function `open` returns **asks** `readByCursor(pageSize, mapping.afterCursor ?? undefined)`. `page.nextCursor !== mapping.nextCursor` → `reporting_page_cursor_mapping_mismatch` (stream throws the same code after `readPage`). `page.rowCount === 0 && mapping.nextCursor !== null` → `reporting_page_mapping_empty_before_end` (unique to this file; stream would `return` on any empty page and silently finish). An empty last page (`nextCursor === null`) returns to the stream, which yields nothing. This file does not check `reporting_cursor_did_not_advance` — stream owns that.

`createPersistedManifestPageAdapter` / `registerPersistedManifestPageAdapter` are the factory and the install **seam**, not extra owner operations. `register` only **asks** `setReportingManifestPageAdapter(create(...))`. Foundation **asks** register once.

## Organization

Keep one file. This is the screenplay for “prove this freeze matches this request, open the painted-row reader once, then serve only the mapped pages.” Sibling paint / prove, sibling stream emit, sibling freeze persist, sibling worker Google write already live in deeper **modules**. Do not pull those in. Do not invent a `ManifestPageAdapterService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second reader **adapter** beside `setReportingManifestPageAdapter`. Do not invent a second prove **adapter** beside `validateReportingManifestEntries`. Do not invent a second page **adapter** beside `openReportingPageReader`.

Do not split open / serve / register into CRUD files. Prove-at-open stays with serve-mapped-pages because first write never batched-proves before `open`. Do not start `persistReportingCandidateManifest` from this file. Do not start `writeValuesRaw` from this file. Do not merge the live synthetic reader into this file so “one adapter owns both.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createPersistedManifestPageAdapter` | `openThePageReaderOnceAgainstThisFreeze` | factory; tests should **ask** this, not the stream fake |
| `registerPersistedManifestPageAdapter` | `installThePersistedPageReader` | foundation only |

Keep the old names as one-line aliases until `registerStage4Foundation.ts` migrates. Do not make the worker learn `openThePageReaderOnceAgainstThisFreeze` — the worker **asks** `stream`. Do not make the consumer learn `installThePersistedPageReader` — the consumer **asks** foundation. Do not export `assertManifestCompatible` so “compat is public.”

**No class for the workflow.** `ReportingManifestPageAdapter` already lives on the stream as the install type. Do **not** turn this factory into a `PersistedManifestPageAdapter` class. The type that *does* earn a name is the page function `open` already returns:

```ts
type MappedPageReader = (
  mapping: {
    pageNumber: number
    afterCursor: string | null
    nextCursor: string | null
    dependencyKeys: string[]
  },
) => Promise<{
  rows: Array<Record<string, unknown>>
  rowCount: number
  nextCursor: string | null
  canonicalPageChecksum: string
}>
```

That is the handoff from “we opened the painted rows under this freeze” to “the stream may ask for page N by its persisted cursors.” Do **not** put lease owner / epoch on this type. Do **not** put Google range strings on this type. Do **not** move catalog `ReportingOutputPageMapV1` / `QueryPage` into a new `types/` folder.

Optional deps stay internal:

```ts
type OpenThePageReaderOnceAgainstThisFreezeDeps = {
  openReader?: typeof openReportingPageReader
  pageSize?: number
}
```

Default remains sibling `openReportingPageReader` and `REPORTING_PAGE_SIZE`. Do not invent a second deps bag for register — register already forwards the same optional deps.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// manifestPageAdapter.ts
// The worker already froze the records we used.
// Before we walk pages, prove this freeze is version 1
// and was captured at this source-read-through instant.
// Prove those frozen fingerprints still match.
// Open the painted-row reader once — do not ask Mongo again for every page.
// Then for each persisted page map, read exactly that cursor window.
// If the next cursor is not what we froze, refuse.
// If a page is empty but the freeze said more pages remain, refuse.
// Do not write Google.
// Do not persist the freeze.
// Do not claim a lease.
// Do not swap the managed tab.
// Do not publish the poke.
// Express, the reporting consumer, and the live harness install this
// through foundation. Until they do, the stream throws
// ManifestPageAdapterUnavailableError.

// ── 1. Prove this freeze belongs to this request ──────────

function proveThisFreezeBelongsToThisRequest(input, manifest)
// version !== 1 → unsupported_reporting_manifest_version
// sourceReadThrough miss → reporting_manifest_read_through_mismatch

// ── 2. Prove the frozen fingerprints still match ──────────

// open asks validateReportingManifestEntries(all entries)
// before the reader opens — first write’s complete prove

// ── 3. Open the painted-row reader once ───────────────────

export function openThePageReaderOnceAgainstThisFreeze(deps?)
// asks openReportingPageReader(input); binds REPORTING_PAGE_SIZE

export function installThePersistedPageReader(deps?)
// setReportingManifestPageAdapter(openThePageReaderOnceAgainstThisFreeze(deps))

// ── 4. Serve each mapped page through the exact cursors ───

// readByCursor(pageSize, mapping.afterCursor)
// nextCursor miss → reporting_page_cursor_mapping_mismatch
// empty && mapping.nextCursor !== null → reporting_page_mapping_empty_before_end
```

Read the first-write path out loud: *The worker already persisted the freeze. Foundation already installed this reader. Stream **asks** `open` with no checkpoint. Prove version 1 and this source-read-through. Prove every frozen fingerprint. Open the painted-row reader once. Then stream **asks** each mapped page: read that cursor window, refuse a next-cursor that is not what we froze, refuse an empty page that is not the end.*

Read the resume path out loud: *Stream proves the complete freeze in page-sized batches before `open`. This file proves it again, then opens the same painted-row reader. Stream proves the complete freeze after `open`, then **asks** only the remaining mapped pages. Do not rebuild the freeze. Do not rematerialize every page.*

That is the operation. `createPersistedManifestPageAdapter` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Cursor-mismatch is thrown twice.** This file throws `reporting_page_cursor_mapping_mismatch` inside the page function. Stream throws the same code after `readPage`. The adapter throw wins first. Do not silently delete one check so “one file owns the code.” Do not change the string.

2. **Empty-before-end is unique here.** Stream `return`s on any `rowCount === 0` and would treat a mid-freeze empty page as “already finished.” This file refuses when `mapping.nextCursor !== null`. Do not move that throw into the stream so “one empty-page policy owns the company.” Do not delete it so “stream already returns.”

3. **First write’s complete prove lives here.** Stream skips `validateCompleteManifestBatched` when there is no checkpoint. Removing this `open` prove would leave first write with only page-targeted keys. Do not delete it so “stream already proves page deps.”

4. **Resume triples the complete prove.** Stream batched → this `open` (all entries) → stream batched again. Do not silently skip this file’s prove on resume so “we save a query.” Leave the order.

5. **`assertManifestCompatible` is copied in the live synthetic reader.** Same version + read-through throws. Synthetic does not prove fingerprints and does not bind cursors — that is the live-test limitation. Do not merge the two files. Do not extract a shared helper in this rename unless both files are already being touched (they are not).

6. **Stream singleton hardcodes `pageSize: 500`.** This file imports `REPORTING_PAGE_SIZE`. Do not silently import the constant into `executionStream.ts` in this rename. Do not change the default here.

7. **No test imports this file.** Stream tests inject `openPageReader`. Regression tests only install foundation. `reporting_page_mapping_empty_before_end` has no assertion. Do not “fix” that by editing tests in this Cloud pass.

8. **Leave sibling files alone.** Paint / page / prove stay in `query/canonicalReporting.ts`. Emit / checksum stay in `executionStream.ts`. Freeze persist stays in `reportingManifestRepository.ts`. Worker Google write stays in `reportingWorker.ts`. Foundation stays in `registerStage4Foundation.ts`. Live synthetic stays in `live/syntheticManifestPageAdapter.ts`. Do not open unvisited `promotion.ts` this pass.

## Testing

The interface is the story-named exports, not the helpers.

There is no existing test that locks this file by name. Add proofs at the new names (later implementer; not this Cloud pass):

- prove this freeze belongs to this request: version ≠ 1 throws `unsupported_reporting_manifest_version`; source-read-through miss throws `reporting_manifest_read_through_mismatch`
- prove the frozen fingerprints still match before the reader opens: drifted entry throws before `openReader` is called (`opened === 0`)
- open the painted-row reader once: two mapped pages **ask** `openReader` once; each page **asks** the returned function with that mapping’s `afterCursor`
- serve each mapped page through the exact persisted cursors: `nextCursor` miss throws `reporting_page_cursor_mapping_mismatch`; empty page with `mapping.nextCursor !== null` throws `reporting_page_mapping_empty_before_end`; empty last page (`nextCursor === null`) returns and stream yields nothing
- install the persisted page reader: `register` **asks** `setReportingManifestPageAdapter`; foundation second call is a no-op
- first write: no checkpoint still complete-proves at `open`
- do not rematerialize: `queryReportingPage` is never called

Do not add helper-unit tests for `assertManifestCompatible`. Do not boot live Google, the queue publisher, run claim, or freeze persist. Do not replace `executionStream.test.ts` injected readers with this file so “one test owns both stories.”

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/app.ts`, `api/queues/reporting-consumer.ts`, `src/routes/reporting.routes.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ManifestPageAdapterService` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not split open / serve / register into separate persist files.
- I would not pull stream emit, freeze persist, worker Google write, or live synthetic rows into this file.
- I would not switch `open` to `queryReportingPage` so “every page is fresh.”
- I would not inject this factory into `createReportingStage4StreamV1` so “the factory owns the reader.”
- I would not silently delete the duplicate cursor-mismatch throw in the stream.
- I would not silently skip this file’s complete prove on first write or on resume.
- I would not merge `live/syntheticManifestPageAdapter.ts` into this file.
- I would not open unvisited `promotion.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
