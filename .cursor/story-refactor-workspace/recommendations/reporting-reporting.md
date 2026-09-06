# Preview This Report Draft, Freeze It As An Immutable Revision, Then Estimate And Confirm The Manual Write — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 1 of this service — `reporting.service.ts`
- Remaining in this service: `timezone.ts`, `destinationContract.ts`, `destinationLineage.ts`, `destinationIdentity.ts`, `reportingDestination.service.ts`, `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reporting.service.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is this file. Role: Owner-designed, checksum-bound reports. Preview → immutable revision → two-step confirmed run → worker write. Mongo is System of Record. Google workbooks are a delivery surface. This is not Admin Analytics and not Sheet Sync). Distinct from leftover dataset catalog: sibling `catalog/index.ts` (`GET .../catalog` **asks** `getReportingCatalog`; this file **asks** `requireDataset` / `REPORTING_DATASETS` / `reportingError` only). Distinct from leftover destination desk: sibling `reportingDestination.service.ts` (create / verify / archive). Distinct from leftover destination port: sibling `destinationContract.ts` (this file **asks** `getReportingDestinationPort().getValidatedSnapshot` + `validateDestinationSnapshot` + `destinationStableIdentityChecksum`). Distinct from leftover lineage: sibling `destinationLineage.ts` (this file **asks** `validateDestinationForImmutableRevision` / `extractPredecessorSheetIds` / `buildDestinationLineageEvidence` on estimate / confirm / package). Distinct from leftover query: sibling `query/canonicalReporting.ts` (this file **asks** `previewReportingQuery` / `estimateReportingQuery` / `computeQueryInputChecksum`; it never pages rows for the worker). Distinct from leftover Eastern window: sibling `timezone.ts` (this file **asks** `resolveReportingDateWindow` only on `revisionToQueryInput`). Distinct from leftover worker write: sibling `reportingWorker.ts` (**asks** `assertEstimateFitsCapacity`; writes RAW cells under a lease). Distinct from leftover queue: sibling `queue.ts` (this file **asks** `publishReportingWakeup` after the run exists). Distinct from leftover cancel: sibling `reportingRunRepository.ts` (`POST .../runs/:id/cancel`). Distinct from leftover audit: sibling `reportingAudit.ts` (this file records **failure** only; Wave B records success). Distinct from leftover Stage-4 bootstrap: sibling `registerStage4Foundation.ts` (installs the destination port this file **asks**). Distinct from leftover live harness: `live/liveTestRunFactory.ts` (**asks** `buildExecutionPackage` / `canonicalRevisionSnapshot`). Distinct from already-recommended leftover Analytics dispatcher: [`analytics-analytics.md`](analytics-analytics.md). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner preview / revision / run; list / clone / archive of definitions live **in the route**, not here; Google kill switch `REPORTING_GOOGLE_DELIVERY_ENABLED` is on destination mutations and `POST .../run` only). Distinct from leftover Wave B crons / consumer. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR; do not restate it as a new ADR). Do not add a Reporting Service file in this rename.
- Callers: Wave B `src/routes/reporting.routes.ts` (`POST .../draft/preview` and `POST .../definitions/:id/preview` → `previewReportingDraft`; `POST .../definitions` and `POST .../definitions/:id/revisions` → `saveReportingRevision`; `POST .../definitions/:id/run` → `prepareManualRun`). Leftover worker **asks** `assertEstimateFitsCapacity`. Leftover live harness **asks** `buildExecutionPackage` / `canonicalRevisionSnapshot`. Tests: `reporting.test.ts` proves capacity, opaque HMAC sample evidence, RAW execution-package literals, revision-checksum tamper, confirmation stable-identity bind, actor/idempotency fingerprints, duplicate-key 11000, persisted-run replay shape. **Does not call** `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun`.
- Seams callers need: preview-this-draft (`previewReportingDraft`) vs freeze-this-revision (`saveReportingRevision`) vs estimate-this-manual-run (`prepareManualRun` without `confirmationToken`) vs confirm-and-queue (`prepareManualRun` with `confirmationToken`). The estimate / confirm **seam** exists because Wave B uses one `POST .../run` for both steps. The after-persist wakeup **seam** exists because the run is durable before `publishReportingWakeup`. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no cancel **seam**. There is no destination-desk **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~1040-line file is one sitting if you read it as preview this report draft, freeze it as an immutable revision, then estimate and confirm the manual write. Do **not** split into `preview.ts` / `revision.ts` / `run.ts` so “each HTTP verb owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover destinations / leftover worker / leftover query / leftover catalog here so “reporting owns the company.” If it later splits: `previewThisReportDraft.ts` / `freezeThisDraftAsAnImmutableRevision.ts` / `estimateThisManualRun.ts` / `confirmThisManualRunAndQueueTheWrite.ts` only as later story files, never CRUD.

`previewReportingDraft` / `saveReportingRevision` / `prepareManualRun` are executor mechanics. The owner question is: *I designed a report. Show me fifty sample rows against the live destination and prove the sheet still has room. If that preview is still fresh and matches this draft, freeze it as the next immutable revision. Then, with one idempotency key, give me a ten-minute estimate bound to this revision and this destination’s stable identity — not last night’s health stamp. When I send the token back, queue one run. Same key, same inputs: give me that run again. Do not write Google from this file. Do not run Analytics. Do not sync the Master Sheet.*

Leftover dataset catalog, leftover destination desk, leftover destination port, leftover lineage, leftover query, leftover worker write, leftover queue, leftover cancel, leftover audit, leftover Analytics, leftover Sheet Sync already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “preview this report draft, freeze it as an immutable revision, then estimate and confirm the manual write” story, not “a reporting CRUD service,” and not leftover destinations or leftover worker write:

1. **Preview this report draft** — `previewReportingDraft`. Validate the draft (`validateReportingDraft` in Wave B validation). `requireDataset`. Ask the leftover destination port for a live snapshot; `validateDestinationSnapshot` against the draft’s destination id / checksum / strategy. Stamp `source_read_through` now. Ask leftover `previewReportingQuery` for an estimate plus **50** sample rows. Projected cells = `(estimate.rows + 1) * selected column count`. Limit is `min(providerMaxCells, destinationAvailableCells)`. `assertEstimateFitsCapacity`: over the limit → 409 `destination_capacity_exceeded`; an `upper_bound` that cannot prove fit uses the “safe upper bound cannot prove” letter. Checksum the draft. Sample evidence is keyed HMAC (`hmac-sha256-v1.…`), not raw SHA of the sample. Persist `ReportingPreview` with 15-minute `expires_at`. Return preview id, checksums, estimate, projected cells, capacity remainder, batch counts (`REPORTING_PAGE_SIZE` query pages, 1000-row write batches), **raw `sampleRows`**, opaque `sampleEvidence`, PII column ids, intended change (`create_snapshot_workbook` vs `replace_managed_tab`). Failure → leftover audit `preview` / `failure`, then rethrow. Success audit lives in the route.

2. **Freeze this draft as an immutable revision** — `saveReportingRevision`. Re-validate the draft. Find an unexpired preview whose `preview_checksum` **and** `draft_checksum` match; missing → 409 `preview_expired_or_mismatch`. Re-read the live destination snapshot. In a transaction: create the `ReportingDefinition` when `definitionId` is absent, or load an `active` one; archived / missing → 409 `definition_unavailable`. Refuse a dataset-key change (`invalid_filter`). `$inc next_revision_number` and CAS the current-revision pointer from the pre-increment `current_revision_number`. Persist `ReportingDefinitionRevision` with `revision_snapshot_checksum` over `canonicalRevisionSnapshot`. Pointer `modifiedCount !== 1` → throw `reporting_definition_pointer_conflict` (not a `ReportingError`). Return `{ definitionId, revisionId, revisionNumber, revisionSnapshotChecksum }`. Failure audit action is `revision_create`.

3. **Estimate this manual run** — `prepareManualRun` **without** `confirmationToken`. Load active definition + revision (revision id defaults to `current_revision_id`). `assertRevisionChecksum`. `requireDataset` on the frozen key. Ask leftover port for a **fresh** live snapshot. Do **not** require `live.snapshotChecksum === revision.destination_snapshot_checksum`. Ask leftover `validateDestinationForImmutableRevision` (lineage vs frozen destination). Refresh destination health / denylist timestamps so they stay aligned. Ask leftover `estimateReportingQuery` on `revisionToQueryInput` (Eastern window resolved **now**). Capacity again. Bind confirmation to `destinationStableIdentityChecksum` — not `healthVerifiedAt` / `denylistCheckedAt`. Require `idempotencyKey` (400 `invalid_confirmation` if missing). Fingerprint: actor + revision checksum + stable destination identity + query checksum + estimate fingerprint + key. Existing confirmation: same fingerprint + unconsumed + unexpired → return the signed token; consumed → replay the run; different fingerprint → 409 `idempotency_fingerprint_mismatch`; expired → 409 `invalid_confirmation`. Else insert `ReportingRunConfirmation` (10-minute TTL). Duplicate-key 11000 → reload the winner and replay or return its token. Return `{ requiresConfirmation: true, confirmationToken, … }`. Failure audit action is `run_estimate`.

4. **Confirm this manual run and queue the write** — same `prepareManualRun` **with** `confirmationToken`. Verify HMAC token; expired / malformed → 409 / 400 `invalid_confirmation`. Actor, key, revision, stable identity, query checksum, estimate fingerprint, and immutable fingerprint must still match **live** stable identity. Missing issued row → 409 “not issued by this server.” Already consumed → replay. Existing run for actor + revision + key → attach `consumed_run_id` and replay. Else start a session: CAS-consume the confirmation (`consumed_at` null, unexpired, same fingerprint) and insert `ReportingRun` `queued` with `execution_package` from `buildExecutionPackage` (literal `RAW` / `formulasAllowed: false`; `sourceReadThroughCapture: "stage_4_worker_before_query"`). Concurrent consume → replay the winner’s run. **After** the session ends, dynamic-import leftover `queue.ts` and `publishReportingWakeup({ reason: "manual", run_hint })`. Return `{ runId, status, executionPackage, idempotentReplay, wakeupPublished }`. Publish `false` does not delete the run. Failure audit action is `run_confirmation`.

`assertEstimateFitsCapacity` / `buildExecutionPackage` / `canonicalRevisionSnapshot` / `assertRevisionChecksum` / `createOpaqueSampleEvidence` / `reportingActorFingerprint` / `confirmationImmutableFingerprint` / `serializePersistedRunReplay` / `assertIdempotencyFingerprint` / `isMongoDuplicateKeyError` are beats, not extra owner operations. Do not export `previewReportingDraftCore` / `signConfirmation` / `verifyConfirmation`.

## Organization

Keep one file. This is the screenplay for “preview this report draft, freeze it as an immutable revision, then estimate and confirm the manual write.” Dataset contracts, destination desk, destination port, lineage, query pages, worker write, queue publish, cancel, and list/clone/archive already live in deeper **modules** or in the Wave B route. Do not pull those in. Do not invent a `ReportingService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second destination **adapter** beside leftover `getReportingDestinationPort`. Do not invent a second query **adapter** beside leftover `previewReportingQuery` / `estimateReportingQuery`. Do not invent a second wakeup **adapter** beside leftover `publishReportingWakeup`.

Do not split preview / revision / estimate / confirm into CRUD files. Estimate and confirm stay together because they share one idempotency key and one route. Do not move success audit from the route into this file so “the service owns every letter.” Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED` inside preview / revision so “this file owns the kill switch.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewReportingDraft` | `previewThisReportDraft` | Wave B draft preview and definition preview |
| `saveReportingRevision` | `freezeThisDraftAsAnImmutableRevision` | Wave B create definition / add revision |
| `prepareManualRun` (no token) | `estimateThisManualRun` | Wave B `POST .../run` first step |
| `prepareManualRun` (token) | `confirmThisManualRunAndQueueTheWrite` | Same route, second step; leftover worker is later |
| `ReportingExecutionPackageV1` | `QueuedRawWritePackage` | Handoff the worker must accept (`RAW`, no formulas) |
| `ReportingRevisionSnapshotV1` | `FrozenReportRevision` | Checksummed revision body |
| `ReportingConfirmationSnapshotV1` | `ManualRunEstimate` | Estimate + warnings + intended change bound into the token |

Keep the old names as one-line aliases until Wave B `reporting.routes.ts`, leftover worker, leftover live harness, and `reporting.test.ts` migrate. Do not make callers learn `prepareManualRunCore` / `InTransaction` / `previewReportingDraftCore` as the domain language. `prepareManualRun` stays as the compatibility alias for **both** estimate and confirm until the route learns two names.

**No class for the workflow.** The type that *does* earn a name is the queued RAW write package:

```ts
type QueuedRawWritePackage = {
  contractVersion: 1
  runId: string
  writeSemantics: {
    valueInputOption: "RAW"
    headers: "literal_strings"
    cells: "literal_values"
    formulasAllowed: false
  }
  sourceReadThroughCapture: "stage_4_worker_before_query"
  // destination + lineage + acceptance gates
}
```

That is the handoff from “the owner confirmed” to “the leftover worker may write cells.” Do **not** put sample rows on this type. Do **not** collapse leftover destination-desk documents into this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reporting.service.ts
// The owner designed a report.
// Show fifty sample rows and prove the sheet still has room.
// If that preview is still fresh, freeze the draft as the next revision.
// Estimate with one key. Confirm with the same key. Queue one run.
// Same key, same inputs: give that run back.
// This file does not write Google.
// This file does not run Analytics.
// This file does not sync the Master Sheet.

// ── 1. Preview this report draft ──────────────────────────

export async function previewThisReportDraft(draft, actor)

async function refuseADraftThatDoesNotFitTheSheet(estimate, columns, limit)
function rememberTheSampleWithoutShowingTheRawHash(sample) // keyed HMAC
async function keepThePreviewForFifteenMinutes(metadata)

// ── 2. Freeze this draft as an immutable revision ─────────

export async function freezeThisDraftAsAnImmutableRevision(input, actor)

async function requireAMatchingUnexpiredPreview(previewId, checksums)
async function allocateTheNextRevisionNumber(definition, session) // $inc + CAS pointer
function freezeTheRevisionBody(snapshot)                         // canonicalRevisionSnapshot

// ── 3. Estimate this manual run ───────────────────────────

export async function estimateThisManualRun(input, actor)

async function loadTheFrozenRevision(definitionId, revisionId)
function refuseATamperedRevision(revision)
async function lookAtTheLiveDestinationWithoutRequiringTheOldChecksum(revision)
async function bindTheEstimateToStableIdentityNotHealthStamps(destination, estimate, actor, key)

// ── 4. Confirm this manual run and queue the write ────────

export async function confirmThisManualRunAndQueueTheWrite(input, actor)

function refuseATokenThatNoLongerMatchesLiveIdentity(token, live)
async function consumeTheConfirmationAndWriteTheQueuedRun(proposedRunId, package)
async function wakeTheWorkerAfterTheRunExists(runId) // leftover queue; do not roll back

/** @deprecated Use previewThisReportDraft */
export const previewReportingDraft = previewThisReportDraft
/** @deprecated Use freezeThisDraftAsAnImmutableRevision */
export const saveReportingRevision = freezeThisDraftAsAnImmutableRevision
/** @deprecated Use estimateThisManualRun / confirmThisManualRunAndQueueTheWrite */
export async function prepareManualRun(input, actor) {
  return input.confirmationToken
    ? confirmThisManualRunAndQueueTheWrite(input, actor)
    : estimateThisManualRun(input, actor)
}
export type ReportingExecutionPackageV1 = QueuedRawWritePackage
```

Read the primary path out loud: the owner sends a draft; we validate it, look at the live destination, ask leftover query for an estimate and fifty rows, and keep a fifteen-minute preview if the sheet still has room. They send that preview back; we freeze the draft as the next revision only when the preview is still the same draft. They ask to run it; we bind a ten-minute token to this revision and this destination’s stable identity, not the health clock. They send the token; we consume it, queue one RAW write package, then wake the leftover worker. Same key, same inputs: the same run. Google is not written here.

## Precise logic I would tighten while renaming

1. `prepareManualRun` is two owner operations with one name. The token is the **seam**, not a boolean flag. Rename the two paths; keep `prepareManualRun` as the alias that branches on `confirmationToken`.

2. Success letters live in Wave B; this file only writes leftover audit on **throw**. Do not move success audit here in the same rename so “the service owns the letter.” That is a known split.

3. Preview and freeze do **not** read `REPORTING_GOOGLE_DELIVERY_ENABLED`. The route kill switch is on destination mutations and new runs only. Do not add the flag here so “preview cannot leak a destination.”

4. Live destination checksum may differ from the frozen revision checksum. Lineage leftover decides whether that is still the same sheet. Do not “fix” confirm by requiring the two checksums to match.

5. Confirmation binds `destinationStableIdentityChecksum`, not `healthVerifiedAt` / `denylistCheckedAt`. A health refresh between estimate and confirm is supposed to stay valid. Do not put those stamps back on the immutable fingerprint.

6. `revisionToQueryInput` re-resolves the Eastern window at estimate / confirm time. The frozen `resolved_window` on the revision is not what leftover `estimateReportingQuery` sees. Do not silently swap in the frozen window so “estimate matches preview.”

7. Wakeup is a dynamic `import("./queue.js")` **after** the run transaction. Publish `false` (local / publish fail) still returns the queued run. Do not move publish inside the transaction. Do not delete the run when wakeup fails.

8. `createOpaqueSampleEvidence` is keyed HMAC. Preview still returns raw `sampleRows` to the Owner HTTP response. Do not drop `sampleRows` so “evidence is enough.” Do not hash with leftover `computeChecksum` so “one checksum function owns samples.”

9. Pointer conflict throws a bare `Error("reporting_definition_pointer_conflict")`, not `reportingError`. Duplicate-key 11000 on confirmation insert is recovered. Do not collapse those into one “conflict” helper that changes the HTTP envelope.

10. List / clone / archive of definitions live in the Wave B route. Cancel lives in leftover `reportingRunRepository`. Do not pull those in so “this file owns the definition desk.”

11. Tests never call the three public operations. They prove helper checksums and package literals. Out of scope for this rename: adding the missing interface tests (name them as the operations below).

12. Leftover worker / leftover query / leftover destinations / leftover Analytics / leftover Sheet Sync are sibling **modules**. Do not reorder ADR-known side effects. This checkout has no `docs/adr/`; do not invent one to justify a reorder.

## Testing

The **interface** is the test surface. A later implementer must prove:

- Preview: matching live destination + fifty sample rows + opaque HMAC evidence + 15-minute preview; over-capacity exact and unprovable `upper_bound` both 409 `destination_capacity_exceeded`; disabled dataset refuses; failure audit `preview` / `failure`.
- Freeze: matching unexpired preview required; expired / checksum mismatch → 409 `preview_expired_or_mismatch`; new definition vs next revision on an active one; dataset-key change refused; archived definition 409; CAS pointer conflict throws.
- Estimate: missing `idempotencyKey` → 400; same key + same immutable inputs returns the same token; same key + different inputs → 409 `idempotency_fingerprint_mismatch`; health timestamp refresh does **not** change the bind; expired confirmation refuses.
- Confirm: matching token queues `status: "queued"` and asks leftover wakeup **after** persist; replay returns the same `runId` with `idempotentReplay: true`; wakeup `false` still returns the run; token / actor / identity mismatch → 409 `invalid_confirmation`.
- Package: `writeSemantics` stays `RAW` / literal headers and cells / `formulasAllowed: false`.
- Do **not** add helper-unit tests for `signConfirmation`, `safeEqual`, `safeReasonCode`, or `checksumArtifact`.
- Do **not** start a leftover worker write or leftover destination create inside these tests.

## What I would not do

- A `ReportingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover query / leftover port / leftover audit.
- Moving the module into `preview.ts` / `revision.ts` / `run.ts` or `create.ts` / `update.ts` / `delete.ts`.
- Breaking the after-persist wakeup **seam** (run first, then leftover `publishReportingWakeup`).
- Treating leftover Analytics, leftover Sheet Sync, leftover destination desk, leftover worker write, leftover cancel, or leftover list/clone/archive as this story.
- Inventing a destination **seam** that has only one **adapter** beside leftover `getReportingDestinationPort`.
- Silently “fixing” success-audit-in-the-route, kill-switch-on-the-route, live-vs-revision checksum drift, or window re-resolution while recommending a rename.
- Jumping to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
