# Keep The Frozen Revision, Bind The Live Tab If Vantage Already Promoted It — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 4 of this service — `destinationLineage.ts`
- Remaining in this service: `destinationIdentity.ts`, `reportingDestination.service.ts`, `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/destinationLineage.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: estimate / confirm bind **stable destination identity**; Skip / fail: destination port safety / checksum drift fail closed. Knowledge does **not** name managed-tab predecessors, CAS promotion, or this file — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** `extractPredecessorSheetIds` + `validateDestinationForImmutableRevision` on estimate / confirm; **asks** `buildDestinationLineageEvidence` when leftover `buildExecutionPackage` packs the run; does **not** require live checksum === frozen revision checksum). Distinct from already-recommended leftover prove-this-destination: [`reporting-destination-contract.md`](reporting-destination-contract.md) (this file **asks** `validateDestinationSnapshot` as a structural self-check; leftover estimate then **asks** leftover `destinationStableIdentityChecksum` — this file does not hash). Distinct from already-recommended leftover Eastern window: [`reporting-timezone.md`](reporting-timezone.md). Distinct from leftover destination desk: sibling `reportingDestination.service.ts` (create / verify / archive). Distinct from leftover owner-id fold: sibling `destinationIdentity.ts` (email hash, Drive URLs — next pass). Distinct from leftover repository: sibling `reportingDestinationRepository.ts` (`getReportingDestinationById` is what leftover estimate / leftover worker **ask** before this file reads `managed_tab.predecessor_sheet_ids`; leftover `casUpdateManagedSheetAfterPromotion` **writes** that array — this file only reads). Distinct from leftover promotion CAS: sibling `promotionReservation.ts` (`commitPromotionDestinationCas` `$addToSet`s the old sheet id in the same Mongo transaction that completes the run). Distinct from leftover worker write: sibling `reportingWorker.ts` (**asks** `resolveDestinationForWorker` with `casResumeInFlight: false`; rename-batch-submitted recovery returns **before** this file). Distinct from leftover live harness: `live/liveTestRunFactory.ts` (snapshot-as-stable-identity lie stays a leftover-contract note). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner run desk). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended leftover `reporting.service.ts` (`prepareManualRunCore` **asks** leftover port + leftover `getReportingDestinationById`, then `extractPredecessorSheetIds` + `validateDestinationForImmutableRevision`; leftover `buildExecutionPackage` **asks** `buildDestinationLineageEvidence`). Leftover `reportingWorker.ts` (`resolveDestinationForWorker` + `extractPredecessorSheetIds`; `casResumeInFlight` is always `false` at the only call site). Leftover `promotionReservation.ts` and leftover `reportingDestinationRepository.ts` **write** predecessors; they do not import this file. Tests: `reportingDelivery.regressions.test.ts` proves `isProvenManagedTabAdvancement` true when revision sheet `1` sits in `[1]` and live is `2`, false when the list is empty; `validateDestinationForImmutableRevision` returns live sheet `2` when predecessors include `1`, throws `/lineage|drift/` when they do not. **Does not name** `extractPredecessorSheetIds` / `resolveDestinationForWorker` / `buildDestinationLineageEvidence` as operations. `reporting.test.ts` does not import this file.
- Seams callers need: read-recorded-predecessors (`extractPredecessorSheetIds`) vs accept-live-for-this-frozen-revision (`validateDestinationForImmutableRevision`) vs bind-what-the-worker-may-write (`resolveDestinationForWorker`) vs stamp-whether-this-run-advanced (`buildDestinationLineageEvidence`). The frozen-revision / live-tab **seam** exists because leftover estimate must survive a successful Vantage promotion without rewriting the revision. The packaged / live **seam** exists because leftover CAS-resume must keep pre-CAS sheet IDs. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no checksum **seam** (leftover contract hashes). There is no destination-desk **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~185-line file is one sitting if you read it as keep the frozen revision, bind the live tab if Vantage already promoted it. Do **not** split into `predecessors.ts` / `validate.ts` / `worker.ts`. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover promotion CAS / leftover desk / leftover owner-id fold here so “one destination file owns the company.” If it later splits: `acceptThisLiveDestinationForTheFrozenRevision.ts` / `bindTheDestinationTheWorkerMayWrite.ts` only as later story files, never CRUD.

`validateDestinationForImmutableRevision` / `resolveDestinationForWorker` / `isProvenManagedTabAdvancement` are executor mechanics. The owner question is: *I froze a revision pointing at a Vantage-managed tab. A later successful promotion replaced that tab and recorded the old sheet as a predecessor. When I estimate or confirm, load the destination live. If it is the same folder, workbook, and published name, and either the same sheet or the frozen sheet sits in the predecessor list, bind the live tab. Do not rewrite the revision. Do not accept a random new tab. Do not require the live checksum to match the frozen snapshot checksum — a promotion changes the sheet id. Mid-promotion, keep the packaged pre-CAS sheet IDs. Snapshot destinations only have to keep the same folder. Do not create the destination here. Do not write Google. Do not hash.*

Leftover preview / freeze (cite the draft checksum), leftover destination desk, leftover prove-this-destination, leftover promotion CAS write, leftover owner-id fold, leftover worker write already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “keep the frozen revision, bind the live tab if Vantage already promoted it” story, not “a sheet-id helper,” and not leftover promotion CAS or leftover destination desk:

1. **Read the predecessor sheet IDs Vantage already recorded** — `extractPredecessorSheetIds`. Owner estimate / leftover worker load the destination row, then **ask** this. Missing record, missing `managed_tab`, or a non-array → `[]`. Only `Number.isSafeInteger` entries survive; strings and floats drop on the floor. This file does not `$addToSet`. Leftover `commitPromotionDestinationCas` and leftover `casUpdateManagedSheetAfterPromotion` are the writers.

2. **Accept the live destination for this immutable revision** — `validateDestinationForImmutableRevision`. Leftover `validateDestinationSnapshot` first, citing the live snapshot’s **own** checksum (fresh structure / safety / health — not the frozen revision checksum). Then same `destinationId`, same `strategy`, same `folder.id`. `replace_tab` also requires the same workbook id and the same published managed-tab **name**. Advancement is leftover `isProvenManagedTabAdvancement`: same live sheet as the frozen sheet, **or** the frozen sheet id appears in `predecessorSheetIds`. Failures are 409 `destination_unverified` / `destination_strategy_mismatch`. Returns the **live** snapshot so leftover estimate can bind leftover stable identity on the advanced tab. `snapshot` strategy stops after folder identity — there is no workbook / tab to advance.

3. **Bind the destination the worker may write** — `resolveDestinationForWorker`. Three letters, in this order: (a) `casResumeInFlight` → return `packaged` untouched (pre-CAS sheet IDs). (b) live checksum === packaged checksum → leftover `validateDestinationSnapshot` citing the packaged id / checksum / strategy. (c) otherwise leftover `validateDestinationForImmutableRevision` against packaged as the frozen revision. Leftover worker today always passes `casResumeInFlight: false` and recovers `rename_batch_submitted` **before** this function. Do not silently pass `true` so “the flag is used.”

4. **Stamp whether this run accepted a tab advancement** — `buildDestinationLineageEvidence`. Writes `{ revisionDestinationSnapshotChecksum, predecessorSheetId, currentManagedSheetId, acceptedAdvancement }` onto leftover `ReportingExecutionPackageV1.destinationLineage`. `acceptedAdvancement` is true only when both sheet ids exist, they **differ**, and leftover `isProvenManagedTabAdvancement` holds. Same-sheet bind: `acceptedAdvancement: false`, `predecessorSheetId: null`, `currentManagedSheetId` is the live sheet. Snapshot (no managed tab): both sheet fields null, `acceptedAdvancement: false`. Missing leftover `lineage` argument on leftover `buildExecutionPackage` falls back to `revision.destination_snapshot` and `[]` predecessors.

`isProvenManagedTabAdvancement` is a beat of operations 2 and 4, not a fifth owner operation. `ManagedTabLineageEvidence` is exported and unused — do not make leftover `destinationLineage` wear that type. Do not export a second predecessor reader.

## Organization

Keep one file. This is the screenplay for “keep the frozen revision, bind the live tab if Vantage already promoted it.” Destination create / verify, checksum / port, owner-email hashing, promotion CAS write, and Google rename already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingLineageService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second predecessor-write **adapter** beside leftover `commitPromotionDestinationCas`. Do not invent a second live **adapter** beside leftover `getReportingDestinationPort`.

Do not split read / accept / bind / stamp into CRUD files. Estimate and worker stay together because they share one frozen-revision contract. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED`. Do not start renaming tabs.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `extractPredecessorSheetIds` | `readRecordedPredecessorSheetIds` | leftover estimate / leftover worker read Mongo; this file does not write |
| `isProvenManagedTabAdvancement` | `theFrozenSheetIsStillOursOrAlreadyPromoted` | same tab, or frozen id sits in the recorded list |
| `validateDestinationForImmutableRevision` | `acceptThisLiveDestinationForTheFrozenRevision` | leftover estimate / confirm; leftover worker path (c) |
| `resolveDestinationForWorker` | `bindTheDestinationTheWorkerMayWrite` | CAS-resume packaged vs same-checksum vs lineage |
| `buildDestinationLineageEvidence` | `stampWhetherThisRunAcceptedATabAdvancement` | leftover execution package only |
| `ManagedTabLineageEvidence` | (do not promote) | unused; leftover package already has a different shape |

Keep the old names as one-line aliases until leftover `reporting.service.ts`, leftover `reportingWorker.ts`, and `reportingDelivery.regressions.test.ts` migrate. Do not make leftover estimate learn `isProvenManagedTabAdvancement` as the domain language — owners **ask** `acceptThisLiveDestinationForTheFrozenRevision`. Do not make leftover worker learn `validateDestinationForImmutableRevision` as the only bind — CAS-resume **asks** `bindTheDestinationTheWorkerMayWrite`.

**No class for the workflow.** The type that *does* earn a name is the package stamp leftover confirm already persists:

```ts
type DestinationLineageOnThisRun = {
  revisionDestinationSnapshotChecksum: string
  predecessorSheetId: number | null
  currentManagedSheetId: number | null
  acceptedAdvancement: boolean
}
```

That is the handoff from “leftover estimate accepted the live tab” to “leftover worker can see whether this run advanced.” Do **not** put sample rows on this type. Do **not** collapse leftover `ManagedTabLineageEvidence` into this type — that export lists workbook / published name / the whole predecessor array and nobody reads it. Do **not** put the live snapshot on this type — leftover `executionPackage.destination` already is the live bind.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// destinationLineage.ts
// The owner froze a revision pointing at a Vantage-managed tab.
// A later successful promotion replaced that tab
// and recorded the old sheet as a predecessor.
// Load the destination live. Keep the same folder, workbook, and published name.
// Bind the live tab when the frozen sheet is still current
// or already sits in the predecessor list.
// Do not rewrite the revision. Do not accept a random new tab.
// Mid-promotion, keep the packaged pre-CAS sheet IDs.

// ── 1. Read the predecessor sheet IDs Vantage already recorded ─

export function readRecordedPredecessorSheetIds(destinationRecord) // [] if missing

function keepOnlySafeIntegerSheetIds(raw)

// ── 2. Accept the live destination for this immutable revision ─

export function acceptThisLiveDestinationForTheFrozenRevision(input)

function proveTheLiveSnapshotIsStillStructurallyValid(live, maxAgeMs) // leftover validateDestinationSnapshot on live.own checksum
function refuseWhenTheDestinationIdDrifted(live, frozen)
function refuseWhenTheStrategyDrifted(live, frozen)
function refuseWhenTheFolderDrifted(live, frozen)
function refuseWhenTheWorkbookDrifted(live, frozen)          // replace_tab only
function refuseWhenThePublishedTabNameDrifted(live, frozen)  // replace_tab only
function theFrozenSheetIsStillOursOrAlreadyPromoted(input)   // same id, or frozen id ∈ predecessors
function refuseAnUnprovenSheetIdSwap(live, frozen, predecessors)

// ── 3. Bind the destination the worker may write ──────────

export function bindTheDestinationTheWorkerMayWrite(input)

function keepThePackagedPreCasSheetIds(packaged)             // casResumeInFlight
function citeThePackagedChecksumWhenNothingMoved(live, packaged)
function acceptLineageWhenTheChecksumMoved(live, packaged, predecessors)

// ── 4. Stamp whether this run accepted a tab advancement ─

export function stampWhetherThisRunAcceptedATabAdvancement(input)

function thisRunAdvancedTheManagedTab(frozenSheet, liveSheet, predecessors)

/** @deprecated Use readRecordedPredecessorSheetIds */
export const extractPredecessorSheetIds = readRecordedPredecessorSheetIds
/** @deprecated Use theFrozenSheetIsStillOursOrAlreadyPromoted */
export const isProvenManagedTabAdvancement = theFrozenSheetIsStillOursOrAlreadyPromoted
/** @deprecated Use acceptThisLiveDestinationForTheFrozenRevision */
export const validateDestinationForImmutableRevision = acceptThisLiveDestinationForTheFrozenRevision
/** @deprecated Use bindTheDestinationTheWorkerMayWrite */
export const resolveDestinationForWorker = bindTheDestinationTheWorkerMayWrite
/** @deprecated Use stampWhetherThisRunAcceptedATabAdvancement */
export const buildDestinationLineageEvidence = stampWhetherThisRunAcceptedATabAdvancement
```

Read the primary path out loud: leftover estimate loads the frozen revision and a fresh live snapshot. It reads the predecessor sheet IDs leftover promotion CAS already recorded. It proves the live snapshot is still structurally valid on its own checksum, then that the destination, folder, workbook, and published name still match the revision. If the managed tab id moved, the frozen sheet must sit in that predecessor list. The live snapshot is what leftover confirm binds as stable identity. Leftover `buildExecutionPackage` stamps whether this run accepted an advancement. Leftover worker loads live again: same checksum cites the packaged snapshot; a moved checksum walks the same frozen-revision accept; a mid-promotion rename-batch recovery never reaches this file.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover estimate / confirm do not cite the frozen revision checksum.** Already-recommended `prepareManualRun` **asks** this file and explicitly does **not** require `live.snapshotChecksum === revision.destination_snapshot_checksum`. A proven promotion changes the sheet id and therefore the full snapshot digest. Do not silently route estimate through leftover `proveThisCitedDestinationSnapshotStillHolds` with the revision checksum so “preview and run share one prove.” See [`reporting-destination-contract.md`](reporting-destination-contract.md) smell 2 and [`reporting-reporting.md`](reporting-reporting.md).

2. **`casResumeInFlight: true` is dead at the only call site.** Leftover worker always passes `false`, then recovers `rename_batch_submitted` **before** `bindTheDestinationTheWorkerMayWrite`. The true branch returns packaged **without** leftover `validateDestinationSnapshot`. Do not wire `true` so “the flag is used.” Do not delete the branch so “dead code is cleaner.” Mid-CAS packaged sheet IDs are the load-bearing letter.

3. **`acceptedAdvancement` is not “accepted.”** Same-sheet bind is a successful accept and stamps `acceptedAdvancement: false`. The flag means “the live sheet is a proven successor,” not “leftover estimate accepted the destination.” Do not flip it true on same-sheet so “accepted means accepted.” Callers that later read the package would start treating every healthy run as a promotion.

4. **`ManagedTabLineageEvidence` is a lying export.** It names workbook / published name / the whole predecessor array. Leftover `buildExecutionPackage` persists a different four-field stamp. Do not switch the package to the unused type so “one evidence type owns the company.” Do not delete the type in this rename if a leftover test later grows onto it — leave it unused until leftover worker / leftover package agree.

5. **Two leftover writers already `$addToSet` predecessors.** Leftover `commitPromotionDestinationCas` (transaction with run completion) and leftover `casUpdateManagedSheetAfterPromotion` (repository helper, tested as a typeof + throw on bad ids). This file only reads. Do not merge the writers into this module so “lineage owns the list.” Do not start calling leftover CAS from `readRecordedPredecessorSheetIds`.

6. **Non-integers vanish.** `readRecordedPredecessorSheetIds` drops anything that is not a safe integer. A corrupted string `"1"` makes a real promotion look unproven and leftover estimate 409s. Do not parse strings so “we are helpful.” Fail closed. Do not throw from the reader — leftover estimate treats `[]` as “no proof.”

7. **Published name is identity.** Leftover promotion CAS also `$set`s `managed_tab.name` to the published title. A human rename in Google without CAS is `destination_unverified`, even when the sheet id is unchanged. Do not drop the name check so “sheet id is enough.” Do not start writing the name here.

8. **`snapshot` strategy has no tab to advance.** Folder + destination + strategy is the whole identity. Do not require a workbook on snapshot so “both strategies share one shape.” Leftover contract already calls workbook-on-snapshot `destination_unsafe`.

9. **Health refresh between estimate and leftover worker changes the full checksum.** Path (b) same-checksum becomes path (c) lineage. That is why leftover estimate binds leftover **stable** identity, not this file’s accept. Do not make path (b) the only worker letter so “checksum match is simpler.”

10. **Leave sibling modules alone.** Leftover `validateDestinationSnapshot`, leftover `destinationStableIdentityChecksum`, leftover `commitPromotionDestinationCas`, leftover `stableOwnerIdFromEmail`, leftover `recoverRenameBatchSubmitted` are already the right **depth**. This file does not create destinations, hash, or write Google.

## Testing

The **interface** is the test surface: `readRecordedPredecessorSheetIds`, `acceptThisLiveDestinationForTheFrozenRevision`, `bindTheDestinationTheWorkerMayWrite`, `stampWhetherThisRunAcceptedATabAdvancement`.

Today’s `reportingDelivery.regressions.test.ts` already names proven `1 → 2` with predecessors `[1]`, and refuse when the list is empty. Keep those. Add the missing named operations:

**Read the predecessor sheet IDs Vantage already recorded**
- `{ managed_tab: { predecessor_sheet_ids: [1, 2] } }` → `[1, 2]`.
- `null` / missing `managed_tab` / non-array → `[]`.
- `[1, "2", 1.5, 3]` → `[1, 3]` (unsafe values dropped, no throw).

**Accept the live destination for this immutable revision**
- Same sheet id, empty predecessors → returns live (same-tab is proven).
- Live sheet `2`, frozen sheet `1`, predecessors `[1]` → returns live with sheet `2` (existing regression).
- Live sheet `2`, frozen sheet `1`, predecessors `[]` → 409 `/lineage|drift/` (existing regression).
- Folder id change → 409 unverified, even when predecessors would prove the sheet.
- Workbook id change or published name change → 409 unverified.
- Strategy drift → 409 `destination_strategy_mismatch`.
- Destination id drift → 409 unverified.
- `snapshot` strategy: same folder accepts; folder drift refuses; no sheet-id check.
- Live fails leftover `validateDestinationSnapshot` (stale health, safety flag) → that 409, before lineage.

**Bind the destination the worker may write**
- `casResumeInFlight: true` returns packaged even when live sheet / checksum differ. Do not call leftover validate.
- Same checksum, `casResumeInFlight: false` → leftover `validateDestinationSnapshot` citing packaged.
- Different checksum + proven predecessors → live (lineage).
- Different checksum + empty predecessors + different sheet → 409.

**Stamp whether this run accepted a tab advancement**
- Same sheet → `acceptedAdvancement: false`, `predecessorSheetId: null`, `currentManagedSheetId` is the live id.
- Proven `1 → 2` → `acceptedAdvancement: true`, `predecessorSheetId: 1`, `currentManagedSheetId: 2`.
- Snapshot (no managed tab) → both sheet fields null, `acceptedAdvancement: false`.
- Checksum on the stamp is the **frozen** revision snapshot checksum, not the live one.

Do **not** add a test per helper (`refuseWhenTheFolderDrifted`, `keepThePackagedPreCasSheetIds`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover preview / leftover estimate / leftover promotion CAS / leftover desk verify inside these tests. Leftover `commitPromotionDestinationCas` stays a promotion-reservation test. Leftover `prepareManualRun` stays an estimate test.

## What I would not do

- A `ReportingLineageService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `validateDestinationSnapshot`.
- Moving the module into `predecessors.ts` / `validate.ts` / `worker.ts` or `create.ts` / `update.ts` / `delete.ts`.
- Breaking the frozen-revision / live-tab **seam** (a proven promotion must still estimate / confirm without rewriting the revision).
- Treating leftover destination desk, leftover prove-this-destination, leftover owner-id fold, leftover promotion CAS write, leftover worker Google rename, leftover preview / freeze, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing a predecessor-write **seam** that has only one **adapter** beside leftover `commitPromotionDestinationCas`.
- Silently “fixing” estimate’s refusal to cite the frozen revision checksum, leftover worker’s unused `casResumeInFlight: true`, `acceptedAdvancement` on same-sheet, or unused `ManagedTabLineageEvidence` while recommending a rename.
- Jumping to `destinationIdentity.ts`’s leftover owner-email hash — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
