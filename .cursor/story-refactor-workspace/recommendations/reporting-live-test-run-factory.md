# Seed A Queued Live-Test Run Without HTTP Confirm — Three Synthetic Rows And A Package The Worker Can Claim In This Process — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 33 of this service — `live/liveTestRunFactory.ts`
- Remaining in this service: `live/liveTestWorkerHooks.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestRunFactory.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `seedLiveTestQueuedRun`, `liveTestSyntheticRows`, `buildLiveTestQueryInput`, `LIVE_TEST_COLUMNS`, fake `c`/`d` preview stamps, or a queued insert that skips HTTP — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (this file **asks** `buildExecutionPackage` / `canonicalRevisionSnapshot` / `confirmationImmutableFingerprint`; it never **asks** `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun`). Distinct from already-recommended leftover query checksum: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (this file **asks** `computeQueryInputChecksum` only). Distinct from already-recommended leftover destination contract: [`reporting-destination-contract.md`](reporting-destination-contract.md) (this file stores `destinationSnapshot.snapshotChecksum` in the `destinationStableIdentityChecksum` field — already named a leftover-harness lie; do not “fix” it here). Distinct from already-recommended leftover queue: [`reporting-queue.md`](reporting-queue.md) (official confirm **asks** `publishReportingWakeup`; this file never publishes). Distinct from already-recommended leftover worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (orchestration **asks** the worker after this seed; this file only plants the queued row). Distinct from already-recommended leftover live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (this file is the seed that file **asks**). Distinct from already-skipped facade: `live/liveGoogleHarness.ts`. Distinct from unvisited synthetic page: `live/syntheticLiveTestManifest.ts` + `live/syntheticManifestPageAdapter.ts` (`LIVE_TEST_HARNESS_LIMITATION` + `seedLiveTestCanonicalFormLeads` + `buildSyntheticLiveTestManifest` live there; this file only names the three rows / three columns). Distinct from unvisited inject: `live/liveTestWorkerHooks.ts` + `live/transientRetryWrapper.ts`. Distinct from unvisited denylist / security / OAuth / cleanup / env / picker / mask / later janitor. Distinct from Wave B `src/routes/reporting.routes.ts` (`POST .../draft/preview`, `POST .../definitions`, `POST .../definitions/:id/run`) and Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** `liveTestSyntheticRows` to register the synthetic page adapter and as `estimateRows`; **asks** `seedLiveTestQueuedRun` three times — replace-tab, failed-replace on the same snapshot, snapshot). Unvisited `live/syntheticLiveTestManifest.ts` (**asks** `liveTestSyntheticRows` + `LIVE_TEST_COLUMNS`; re-exports `LIVE_TEST_COLUMNS`; does **not** **ask** `seedLiveTestQueuedRun`). No other `src/` import. Tests: **none** import this file. `liveGoogleHarness.test.ts` **asks** the facade / config / mask siblings, not this seed. `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Owner HTTP confirm never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: name-the-synthetic-rows (`liveTestSyntheticRows` / `LIVE_TEST_COLUMNS`) vs build-the-frozen-query (`buildLiveTestQueryInput`) vs seed-a-queued-run-without-HTTP-confirm (`seedLiveTestQueuedRun`). The synthetic-rows / canonical-Mongo-page **seam** exists because the leftover limitation sentence says synthetic rows paint the tab; this file names those rows and does not read Form Lead page content. The seed-without-HTTP / official-preview-freeze-estimate-confirm **seam** exists because this file inserts a definition, a revision, and a `queued` run and never **asks** `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun`. The no-wakeup / official-after-persist-wakeup **seam** exists because official confirm **asks** `publishReportingWakeup` after the run exists and this file never publishes. The snapshotChecksum-as-stable-identity / official-`destinationStableIdentityChecksum` **seam** exists because the confirmation bag stores `destinationSnapshot.snapshotChecksum` in the stable-identity field. The new-definition-per-seed / official-reuse-one-definition **seam** exists because each seed creates a new `ReportingDefinition` + revision `1`, so the unique `(actor, definition_revision_id, idempotency_key)` index allows the same `live-${runTag}` key three times. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no claim-lease **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~200-line file is one sitting if you read it as seed a queued live-test run without HTTP confirm — three synthetic rows and a package the worker can claim in this process. Do **not** split into `rows.ts` / `query.ts` / `seed.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull official confirm, official queue, leftover orchestration, leftover synthetic page, leftover Form Lead seed, leftover inject, leftover worker, leftover destination desk, or leftover Drive trash here so “the factory owns the company.” If it later splits: `nameTheSyntheticRowsTheHarnessWillPaint.ts` / `buildTheFrozenLiveTestQuery.ts` / `seedAQueuedLiveTestRunWithoutHttpConfirm.ts` only as later story files, never CRUD.

`seedLiveTestQueuedRun` / `buildLiveTestQueryInput` / `liveTestSyntheticRows` / `LIVE_TEST_COLUMNS` / `revisionChecksum` are executor mechanics. The owner question is: *Do not preview. Do not freeze through the official path. Do not estimate. Do not confirm. Do not publish a wakeup. Do not hit HTTP. Name three synthetic lead-outcome rows — never live Form Lead page content. Build the frozen Eastern January query those rows pretend to answer. Then insert a new definition, stamp a revision that looks checksummed, and insert a queued run the leftover worker can claim in this process. If this is snapshot, say create a workbook in that folder. If this is replace-tab, say replace that managed tab. Bind the destination snapshot we already have. A later seed may reuse the same run tag — still plant a new definition and a new run.*

Already-recommended leftover preview / confirm, leftover query checksum, leftover destination contract, leftover queue, leftover worker, and leftover live orchestration already live in other **modules**. Synthetic page, Form Lead seed, inject, denylist, security, OAuth, cleanup, and later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Three operations of one “seed a queued live-test run without HTTP confirm — three synthetic rows and a package the worker can claim in this process” story, not “a run CRUD factory,” and not official preview / official confirm / official queue:

1. **Name the three synthetic rows the harness will paint** — `liveTestSyntheticRows` + `LIVE_TEST_COLUMNS`. Columns are `lead_id` / `cohort_day` / `outcome`. Rows are `SYN-LIVE-001` booked `2026-07-01`, `SYN-LIVE-002` cancelled `2026-07-02`, `SYN-LIVE-003` open `2026-07-03`. Orchestration **asks** these rows when it registers the leftover synthetic page adapter and when it passes `estimateRows`. Leftover `syntheticLiveTestManifest.ts` **asks** the same rows to build output-page mappings. This file does not insert Form Leads. This file does not paint Google.

2. **Build the frozen live-test query** — `buildLiveTestQueryInput(sourceReadThrough)`. Dataset `lead_outcome_detail` schema `1`. Window America/New_York `2026-01-01T05:00:00.000Z` → `2026-02-01T05:00:00.000Z`. Empty registry. Empty filters. Those three columns. Sort `lead_id` asc. Stamps `sourceReadThrough` now (`new Date().toISOString()` at seed). Official leftover `revisionToQueryInput` does **not** stamp `sourceReadThrough` — the leftover worker captures it under the lease. Keep that split visible.

3. **Seed a queued run without HTTP confirm** — `seedLiveTestQueuedRun`. **Asks** leftover `computeQueryInputChecksum` on that query. Builds an `exact` estimate from caller `estimateRows` × three columns (cells include the header). `ReportingDefinition.create` a new definition named `Live Test ${runTag}`. Picks new ObjectIds for revision and preview. Inserts `ReportingDefinitionRevision` via `collection.insertOne` with `canonicalRevisionSnapshot` + local `revisionChecksum`. Pointer-updates the definition to revision `1` / `next_revision_number: 2`. Builds a confirmation bag (`actorFingerprint: "live-test"`, `idempotencyKey: live-${runTag}`, `estimateFingerprint: "live-test-estimate"`, `destinationStableIdentityChecksum: destinationSnapshot.snapshotChecksum`, then `confirmationImmutableFingerprint`). **Asks** leftover `buildExecutionPackage` (`as any` on the revision) with snapshot → `create_snapshot_workbook` or replace-tab → `replace_managed_tab`. Inserts `ReportingRun` `queued`, `trigger: "manual"`, confirmation already stamped, `execution_package` attached. Returns `{ runId, definitionId, revisionId, executionPackage }`. Does not insert `ReportingPreview`. Does not insert `ReportingRunConfirmation`. Does not **ask** `publishReportingWakeup`. Does not **ask** the leftover worker.

`revisionChecksum` is a beat, not a fourth owner operation. It wraps leftover `computeChecksum` with `artifact_kind: "reporting_revision"`. Official leftover `checksumArtifact` already does that.

## Organization

Keep one file. This is the screenplay for “seed a queued live-test run without HTTP confirm — three synthetic rows and a package the worker can claim in this process.” Official preview / freeze / estimate / confirm, leftover query pages, leftover destination desk, leftover queue publish, leftover worker claim, leftover synthetic page, leftover Form Lead seed, leftover inject, leftover orchestration, leftover denylist, leftover cleanup, and leftover later janitor already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestRunFactoryService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second confirm **adapter** beside leftover `prepareManualRun`. Do not invent a second wakeup **adapter** beside leftover `publishReportingWakeup`.

Do not split rows / query / seed into CRUD files. Rows stay with seed because the estimate cell count and the revision’s `selected_columns` must name the same three columns the leftover page adapter will paint. Do not start `prepareManualRun` from this file so “every queued run uses official confirm.” Do not move `LIVE_TEST_HARNESS_LIMITATION` here so “the factory owns the limitation sentence.” Do not move `seedLiveTestCanonicalFormLeads` here so “one seed file owns Mongo.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `liveTestSyntheticRows` | `nameTheSyntheticRowsTheHarnessWillPaint` | leftover orchestration + leftover synthetic manifest |
| `LIVE_TEST_COLUMNS` | `theThreeLiveTestColumns` | leftover synthetic manifest re-export |
| `buildLiveTestQueryInput` | `buildTheFrozenLiveTestQuery` | seed uses it; keep exported so a later test can name the frozen query without inserting |
| `seedLiveTestQueuedRun` | `seedAQueuedLiveTestRunWithoutHttpConfirm` | leftover orchestration, three times |

Keep the old names as one-line aliases until `live/liveGoogleOrchestration.ts` and `live/syntheticLiveTestManifest.ts` migrate. Do not make leftover orchestration learn `seedAQueuedLiveTestRunWithoutHttpConfirm` instead of `seedLiveTestQueuedRun`. Do not make official confirm learn this file as a second insert path. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the seeded-run handoff leftover orchestration already keeps (`runId` on the container, then **asks** the leftover worker):

```ts
type SeededLiveTestQueuedRun = {
  runId: string
  definitionId: string
  revisionId: string
  executionPackage: ReportingExecutionPackageV1
}
```

That is the handoff from “the destination snapshot exists” to “the leftover worker may claim this queued row in this process.” Do **not** put Google file ids on this type. Do **not** put a queue wake-up on this type. Do **not** put official `ReportingRunConfirmation` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestRunFactory.ts
// Do not preview. Do not freeze through the official path.
// Do not estimate. Do not confirm. Do not publish a wakeup.
// Do not hit HTTP.
// Name three synthetic lead-outcome rows —
// never live Form Lead page content.
// Build the frozen Eastern January query those rows pretend to answer.
// Then insert a new definition, stamp a revision that looks checksummed,
// and insert a queued run the leftover worker can claim in this process.
// If this is snapshot, say create a workbook in that folder.
// If this is replace-tab, say replace that managed tab.
// Bind the destination snapshot we already have.
// A later seed may reuse the same run tag —
// still plant a new definition and a new run.

const theThreeLiveTestColumns = [
  { id: "lead_id", label: "Lead ID" },
  { id: "cohort_day", label: "Cohort Day" },
  { id: "outcome", label: "Outcome" },
]
export const LIVE_TEST_COLUMNS = theThreeLiveTestColumns

// ── 1. Name the three synthetic rows the harness will paint ─

export function nameTheSyntheticRowsTheHarnessWillPaint()
  // SYN-LIVE-001 booked 2026-07-01
  // SYN-LIVE-002 cancelled 2026-07-02
  // SYN-LIVE-003 open 2026-07-03
export const liveTestSyntheticRows = nameTheSyntheticRowsTheHarnessWillPaint

// ── 2. Build the frozen live-test query ────────────────────

export function buildTheFrozenLiveTestQuery(sourceReadThrough)
  // lead_outcome_detail @1
  // America/New_York 2026-01-01T05:00:00.000Z → 2026-02-01T05:00:00.000Z
  // empty registry, empty filters
  // those three columns, sort lead_id asc
  // stamp sourceReadThrough now — official leftover revisionToQueryInput does not
export const buildLiveTestQueryInput = buildTheFrozenLiveTestQuery

// ── 3. Seed a queued run without HTTP confirm ──────────────

export async function seedAQueuedLiveTestRunWithoutHttpConfirm(input)
  // sourceReadThrough = now
  // buildTheFrozenLiveTestQuery
  // ask leftover computeQueryInputChecksum
  // exact estimate from caller estimateRows × three columns
  // ReportingDefinition.create Live Test ${runTag}
  // pick revision id + preview id
  // write the revision body (fake preview_checksum "c"×64, draft_checksum "d"×64,
  //   sample_evidence "hmac-sha256-v1.live-test")
  // ask leftover canonicalRevisionSnapshot
  // checksumTheRevision  // local computeChecksum wrapper
  // ReportingDefinitionRevision.collection.insertOne
  // point the definition at revision 1
  // confirmation bag:
  //   destinationStableIdentityChecksum = snapshot.snapshotChecksum  // the lie
  //   actorFingerprint "live-test"
  //   idempotencyKey live-${runTag}
  //   estimateFingerprint "live-test-estimate"
  //   then leftover confirmationImmutableFingerprint
  // ask leftover buildExecutionPackage (revision as any)
  //   snapshot → create_snapshot_workbook in that folder
  //   replace_tab → replace_managed_tab on that workbook / sheet
  // ReportingRun.collection.insertOne queued, trigger manual, confirmation stamped
  // return { runId, definitionId, revisionId, executionPackage }
  // do not insert ReportingPreview
  // do not insert ReportingRunConfirmation
  // do not ask leftover publishReportingWakeup
  // do not ask leftover runReportingDeliveryWorker
export const seedLiveTestQueuedRun = seedAQueuedLiveTestRunWithoutHttpConfirm

function checksumTheRevision(revision)
  // leftover computeChecksum artifact_kind reporting_revision
export const revisionChecksum = checksumTheRevision
```

Read the primary path out loud: *Name three synthetic lead-outcome rows. Build the frozen Eastern January query those rows pretend to answer, and stamp source-read-through now. Create a new definition. Stamp a revision that looks checksummed — fake preview and draft stamps, not an official HMAC preview. Bind the destination snapshot we already have. If this is snapshot, say create a workbook in that folder. If this is replace-tab, say replace that managed tab. Insert a queued run the leftover worker can claim in this process. Do not preview. Do not confirm. Do not publish a wakeup. Do not hit HTTP. A later seed may reuse the same run tag — still plant a new definition and a new run.*

That is the operation. `seedLiveTestQueuedRun` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`destinationStableIdentityChecksum` lies.** Official leftover estimate **asks** leftover `destinationStableIdentityChecksum` and keeps `destinationSnapshotChecksum` as a diagnostic. This file stores `destinationSnapshot.snapshotChecksum` in the stable-identity field. [`reporting-destination-contract.md`](reporting-destination-contract.md) already named this leftover-harness lie. Rename the beat so the swap is visible. Do not silently call leftover `destinationStableIdentityChecksum` in this pass so “the seed matches official confirm.”

2. **Fake preview / draft / sample stamps.** `preview_checksum` is `"c".repeat(64)`. `draft_checksum` is `"d".repeat(64)`. `sample_evidence` is `"hmac-sha256-v1.live-test"`, not leftover `createOpaqueSampleEvidence`. Official leftover freeze refuses a missing unexpired preview. This seed never inserts `ReportingPreview`. Rename the stamps (`theFakePreviewStamp`, `theFakeDraftStamp`, `theStubSampleEvidence`). Do not silently route through leftover `previewReportingDraft` so “every revision has a real preview.”

3. **Same run tag, three queued runs, no 11000.** Leftover orchestration **asks** this seed three times with the same `runTag` / `live-${runTag}` key. Unique leftover index is `(actor.actor_id, definition_revision_id, idempotency_key)`. Each seed creates a **new** definition and revision `1`, so the key does not collide. Do not “fix” the key to be unique per seed so “idempotency looks official.” Do not reuse one definition across the three seeds so “the harness has one report.” Official leftover confirm would 409 a reused key on the same revision.

4. **`estimateRows` can disagree with the three synthetic rows.** Leftover orchestration always passes `liveTestSyntheticRows().length` (3), then the failed-replace leftover page adapter emits `1`. The seed still estimates 3. That mismatch is how leftover orchestration proves a failed replacement. Do not force `estimateRows === liveTestSyntheticRows().length` inside the seed so “the factory owns the truth.” The leftover adapter owns the emit count.

5. **`sourceReadThrough` is stamped at seed.** Official leftover `revisionToQueryInput` omits it; leftover worker captures it under the lease (`sourceReadThroughCapture: "stage_4_worker_before_query"`). This factory puts `sourceReadThrough` on the query input. Rename the beat so the early stamp is visible. Do not silently drop it so “the seed matches official estimate.”

6. **Intended-change copy.** Snapshot vs replace-tab action is inlined here and already lives as leftover `intendedChanges` inside `reporting.service.ts`. Keep the copy. Do not import that unexported helper so “one function owns every intended change.” Do not export leftover `intendedChanges` in this rename.

7. **`revisionChecksum` is a pass-through.** It only wraps leftover `computeChecksum`. Keep it as an alias or inline it. Do not add a second revision-checksum **adapter** beside leftover `checksumArtifact` / `assertRevisionChecksum`.

8. **`buildExecutionPackage(..., as any)`.** The revision bag is not a leftover `ReportingRevisionSnapshotV1` until the checksum is attached. Do not silently widen leftover `buildExecutionPackage` so “the harness type-checks.” Do not add a second package builder here.

9. **`LIVE_TEST_COLUMNS` has two barrels.** This file exports it. Leftover `syntheticLiveTestManifest.ts` re-exports it. Do not move the columns into the leftover manifest so “the page file owns the columns” in this pass. Do not delete the leftover re-export so “one export site wins” until that sibling is visited.

10. **`collection.insertOne` bypasses Mongoose.** Same pattern as leftover `seedLiveTestCanonicalFormLeads`. Rename the beat (`insertTheRevisionWithoutTheModel`, `insertTheQueuedRunWithoutTheModel`). Do not silently switch to `ReportingRun.create` so “the model owns every insert” unless a later tested change says the validators must run.

11. **Do not silently start a queue wakeup.** Official leftover confirm publishes after the run exists. This file plants a queued row for leftover orchestration to **ask** the leftover worker in-process. Teaching this file `publishReportingWakeup` so “every run uses the queue” would invent a **seam** leftover orchestration already refuses.

12. **Do not silently call leftover `prepareManualRun`.** The owner question is the skip. Routing the seed through official estimate / confirm so “one confirm owns every run” would create `ReportingRunConfirmation`, bind real stable identity, and publish a wakeup.

13. **Leave sibling modules alone.** Leftover `buildExecutionPackage`, leftover `canonicalRevisionSnapshot`, leftover `computeQueryInputChecksum`, leftover `liveGoogleOrchestration`, leftover `buildSyntheticLiveTestManifest` are already the right **depth**. This file names the rows and plants the queued row.

## Testing

The **interface** is the test surface: `nameTheSyntheticRowsTheHarnessWillPaint`, `buildTheFrozenLiveTestQuery`, `seedAQueuedLiveTestRunWithoutHttpConfirm` (today `liveTestSyntheticRows` / `buildLiveTestQueryInput` / `seedLiveTestQueuedRun`).

Today **no test imports this file**. `liveGoogleHarness.test.ts` proves skip-closed / service-account reject / PII mask / run-tag uniqueness — not this seed. That is not enough for a story that writes Mongo.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE` Mongo. Do not boot live Google.

**Synthetic rows / frozen query**
- `liveTestSyntheticRows` is exactly those three `SYN-LIVE-*` outcomes.
- `buildLiveTestQueryInput` is `lead_outcome_detail` @1, Eastern January 2026 half-open window, empty registry, those three columns, `sourceReadThrough` echoed.

**Seed without HTTP**
- Returns a new `runId` / `definitionId` / `revisionId` and an execution package with leftover `RAW` / `formulasAllowed: false` / `sourceReadThroughCapture: "stage_4_worker_before_query"`.
- `ReportingRun` is `queued`, `trigger: "manual"`, confirmation already stamped, `idempotency_key` is `live-${runTag}`.
- No `ReportingPreview` row. No `ReportingRunConfirmation` row.
- Does **not** **ask** `publishReportingWakeup`.
- Snapshot intended change is `create_snapshot_workbook` with that folder id. Replace-tab intended change is `replace_managed_tab` with that workbook / sheet.
- Two seeds with the **same** `runTag` and the **same** actor both insert — different definition / revision ids, no 11000.

**The lie stays named, not fixed**
- Seeded `confirmation.destinationStableIdentityChecksum` equals `destinationSnapshot.snapshotChecksum` today. Official leftover estimate would **ask** leftover `destinationStableIdentityChecksum` instead. Do not change the stored field in this rename. The test names the swap.

**Estimate vs emit**
- `estimateRows: 3` writes estimate rows `3` even when a later leftover adapter emits `1`. The seed does not read the leftover adapter.

Do **not** add a test per helper (`checksumTheRevision`). That name exists so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official leftover `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun`, leftover queue publish, leftover live Google orchestration, Analytics, or Sheet Sync inside these tests. Official confirm proofs stay `reporting.test.ts`. Official worker proofs stay `reportingDelivery.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestRunFactoryService` class or a `rows.ts` / `query.ts` / `seed.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second confirm **adapter** beside leftover `prepareManualRun`.
- I would not invent a second wakeup **adapter** beside leftover `publishReportingWakeup`.
- I would not pull leftover orchestration, leftover synthetic page, leftover Form Lead seed, leftover inject, leftover worker, leftover destination desk, leftover official confirm, or leftover Drive trash into this file.
- I would not silently start `publishReportingWakeup` from this file.
- I would not silently route this seed through leftover `prepareManualRun`.
- I would not silently call leftover `destinationStableIdentityChecksum` so “the lie goes away.”
- I would not silently insert `ReportingPreview` / `ReportingRunConfirmation`.
- I would not silently force `estimateRows === liveTestSyntheticRows().length`.
- I would not silently reuse one definition across leftover orchestration’s three seeds.
- I would not open `live/liveTestWorkerHooks.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
