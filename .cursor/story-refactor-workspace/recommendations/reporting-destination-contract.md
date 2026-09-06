# Prove This Is Still The Same Destination We Agreed To Write — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 3 of this service — `destinationContract.ts`
- Remaining in this service: `destinationLineage.ts`, `destinationIdentity.ts`, `reportingDestination.service.ts`, `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/destinationContract.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: live destination snapshot + checksum on preview; estimate / confirm bind **stable destination identity**, not volatile `healthVerifiedAt` / `denylistCheckedAt`. Skip / fail: destination port safety / checksum drift fail closed). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** `getReportingDestinationPort().getValidatedSnapshot` + `validateDestinationSnapshot` on preview / freeze; **asks** leftover lineage then `destinationStableIdentityChecksum` on estimate / confirm — does **not** require live checksum === frozen revision checksum). Distinct from already-recommended leftover Eastern window: [`reporting-timezone.md`](reporting-timezone.md). Distinct from leftover destination desk: sibling `reportingDestination.service.ts` (`buildValidatedDestinationSnapshot` goes live to Drive / ownership / operational-workbook registry, then **asks** `destinationSnapshotChecksum`). Distinct from leftover destination port adapter: sibling `reportingDestinationPort.adapter.ts` (one Stage-4 **adapter**; leftover `registerStage4Foundation` **asks** `setReportingDestinationPort`). Distinct from leftover lineage: sibling `destinationLineage.ts` (**asks** `validateDestinationSnapshot` as a self-check, then folder / workbook / managed-tab advancement). Distinct from leftover owner-id fold: sibling `destinationIdentity.ts` (email hash, Drive URLs — not this checksum). Distinct from leftover repository: sibling `reportingDestinationRepository.ts` (**asks** `snapshotChecksumFromDestinationRecord` on owner list / read). Distinct from leftover worker: sibling `reportingWorker.ts` (**asks** the port, then leftover `resolveDestinationForWorker`). Distinct from leftover live harness: `live/liveTestRunFactory.ts` (puts `snapshotChecksum` in the `destinationStableIdentityChecksum` field — a known lie; do not “fix” it here). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner destination desk). Distinct from leftover `operationalWorkbooks` registry (desk evaluates; this file only refuses `operationalWorkbookMatch !== false`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR). Do not add a Reporting Service file in this rename.
- Callers: already-recommended leftover `reporting.service.ts` (preview / freeze **ask** the port then `validateDestinationSnapshot` against the draft’s cited id / checksum / strategy; estimate / confirm **ask** leftover lineage, then bind `destinationStableIdentityChecksum`). Leftover `destinationLineage.ts` (`validateDestinationForImmutableRevision` / `resolveDestinationForWorker` **ask** `validateDestinationSnapshot` as a structural self-check). Leftover `reportingDestination.service.ts` (`buildValidatedDestinationSnapshot` **asks** `destinationSnapshotChecksum`). Leftover `reportingDestinationRepository.ts` (`safeReportingDestinationForRead` **asks** `snapshotChecksumFromDestinationRecord`). Leftover `registerStage4Foundation.ts` (**asks** `setReportingDestinationPort`). Leftover worker and leftover live harness **ask** the port / the snapshot type. Tests: `reporting.test.ts` proves injectable Fake port, checksum / safety fail-closed, stale / future / unparseable health, identity mismatch, snapshot strategy refusing replace-tab shape, replace-tab sheet id, stable identity ignoring health and noticing folder drift. `reportingDestination.test.ts` proves operational-workbook refuse and stale health. `reportingDelivery.regressions.test.ts` proves stable identity ignores health and notices folder drift. **Does not name** `snapshotChecksumFromDestinationRecord` / `setReportingDestinationPort` as operations.
- Seams callers need: load-this-destination-live (`getReportingDestinationPort`) vs prove-this-cited-snapshot (`validateDestinationSnapshot`) vs fingerprint-the-full-snapshot (`destinationSnapshotChecksum`) vs fingerprint-the-stable-identity (`destinationStableIdentityChecksum`) vs cite-the-saved-record (`snapshotChecksumFromDestinationRecord`). The full-checksum / stable-identity **seam** exists because leftover estimate / confirm must survive a health refresh. The port **seam** exists because leftover Stage-4 bootstrap installs the Stage-4 **adapter** and tests install the Fake. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no lineage-advancement **seam**. There is no destination-desk **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~275-line file is one sitting if you read it as prove this is still the same destination we agreed to write. Do **not** split into `checksum.ts` / `validate.ts` / `port.ts`. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover desk / leftover lineage / leftover owner-id fold here so “one destination file owns the company.” If it later splits: `proveThisCitedDestinationSnapshotStillHolds.ts` / `fingerprintThisDestinationsStableIdentity.ts` only as later story files, never CRUD.

`validateDestinationSnapshot` / `destinationSnapshotChecksum` / `destinationStableIdentityChecksum` are executor mechanics. The owner question is: *I pointed at a verified Google folder and either a snapshot workbook or a Vantage-managed tab. Before I preview or freeze, load that destination live and prove the checksum I cited still hashes, it is the same strategy, it is not an operational workbook, nobody took over a human tab, health is fresh, and the sheet still has room. When I estimate and confirm a run, bind the folder / workbook / tab / owner / capacity — not last night’s health stamp. If health refreshed between those two clicks, still confirm. If someone swapped the folder, refuse. Listing destinations may paint a checksum from the saved record without going live; unverified rows stay checksum-less. Do not create the destination here. Do not walk managed-tab lineage here. Do not write Google.*

Leftover preview / freeze, leftover destination desk, leftover lineage, leftover owner-id fold, leftover worker write already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “prove this is still the same destination we agreed to write” story, not “a destination checksum helper,” and not leftover destination desk or leftover lineage:

1. **Load this destination live** — `getReportingDestinationPort().getValidatedSnapshot`. The **interface** is `ReportingDestinationPort`. Process default is `FakeReportingDestinationPort` (empty map; missing id → 409 `destination_unverified`). Leftover `registerStage4Foundation` **asks** `setReportingDestinationPort` once so Express and leftover queue consumers share the Stage-4 **adapter**. Fake `add` / `get` clone. This file does not talk to Drive.

2. **Prove this cited snapshot still holds** — `validateDestinationSnapshot`. Re-hash the payload (`destinationSnapshotChecksum`) and require it equals both the stamp on the snapshot and the checksum the caller cited. Same `destinationId`. Same `strategy`. `archived === false` and `accessStatus === "verified"`. Safety flags both `false`. `replace_tab` must carry a workbook and a `managed: true` tab whose `immutableSheetId` is a safe integer. `snapshot` must carry **no** workbook and **no** managed tab. Health and denylist instants must parse, must not sit more than leftover `REPORTING_DESTINATION_MAX_FUTURE_SKEW_MS` (5 minutes) in the future, and must be younger than `maxAgeMs` (default 24 hours). Capacity integers must be safe and `> 0`. Failures are 409 `destination_unverified` / `destination_strategy_mismatch` / `destination_unsafe`. Leftover preview / freeze **ask** this against the draft’s cited checksum. Leftover lineage **asks** it as a self-check (`checksum: live.snapshotChecksum`) before folder / tab advancement.

3. **Fingerprint the full snapshot versus the stable identity** — `destinationSnapshotChecksum` hashes `artifact_kind: "reporting_destination_snapshot"` including `healthVerifiedAt` and `safety.denylistCheckedAt`. `destinationStableIdentityChecksum` hashes `artifact_kind: "reporting_destination_stable_identity"` over `destinationStableIdentityPayload`: same folder / workbook / tab / owner / strategy / safety *flags* / capacity, with timestamps stripped and missing workbook / tab stored as `null`. Leftover estimate / confirm bind the stable digest. The full digest is kept for diagnostics. A health refresh changes the full digest and must not change the stable one. A folder id change must change the stable one.

4. **Cite a saved destination record without going live** — `snapshotChecksumFromDestinationRecord`. Owner list / read only. Requires `state === "active"` and `access_status === "verified"`, a Drive connection, owner snapshot, folder, strategy, capacity, and parseable health / denylist. `replace_tab` also needs workbook id and managed-tab sheet id / name. Safety flags are forced `false`. Missing pieces → `null` (omit `snapshot_checksum`), not a throw. This is not leftover `buildValidatedDestinationSnapshot`.

`destinationStableIdentityPayload` is a beat of operation 3, not a fifth owner operation. Do not export a second Fake. Do not export the process-global `destinationPort` binding.

## Organization

Keep one file. This is the screenplay for “prove this is still the same destination we agreed to write.” Destination create / verify / archive, Drive ownership, operational-workbook evaluation, managed-tab lineage, and owner-email hashing already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDestinationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second live **adapter** beside leftover `reportingDestinationPort.adapter.ts`. Do not invent a second checksum **adapter** beside leftover `durableWork.computeChecksum`.

Do not split port / validate / checksum into CRUD files. Full snapshot and stable identity stay together because leftover estimate / confirm need both letters in one sitting. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED`. Do not start walking `predecessor_sheet_ids`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getReportingDestinationPort` | `loadThisDestinationLive` | leftover preview / freeze / worker / lineage ask the installed adapter |
| `setReportingDestinationPort` | `installTheLiveDestinationAdapter` | leftover Stage-4 bootstrap and tests |
| `FakeReportingDestinationPort` | `InMemoryDestinationPort` | default until bootstrap; test **adapter** |
| `ReportingDestinationPort` | `LiveDestinationPort` | the **seam**; leftover Stage-4 **adapter** implements it |
| `validateDestinationSnapshot` | `proveThisCitedDestinationSnapshotStillHolds` | leftover preview / freeze cite; leftover lineage self-check |
| `destinationSnapshotChecksum` | `fingerprintThisFullDestinationSnapshot` | includes health stamps; leftover desk stamps it |
| `destinationStableIdentityChecksum` | `fingerprintThisDestinationsStableIdentity` | leftover estimate / confirm bind |
| `destinationStableIdentityPayload` | `stableIdentityFieldsForThisDestination` | the fields the identity digest hashes |
| `snapshotChecksumFromDestinationRecord` | `citeThisSavedDestinationRecord` | leftover owner list / read; `null` if unverified |
| `ValidatedReportingDestinationSnapshotV1` | `ProvenDestinationSnapshot` | the handoff leftover preview / lineage / worker accept |

Keep the old names as one-line aliases until leftover `reporting.service.ts`, leftover desk, leftover repository, leftover lineage, leftover Stage-4 bootstrap, leftover worker, and `reporting.test.ts` migrate. Do not make callers learn `getReportingDestinationPort` as the domain language — owners **ask** `loadThisDestinationLive`. Do not make leftover estimate learn `destinationSnapshotChecksum` as the confirm bind.

**No class for the workflow.** The Fake port class is a test **adapter**, not a workflow. The type that *does* earn a name is the proven snapshot:

```ts
type ProvenDestinationSnapshot = {
  contractVersion: 1
  destinationId: string
  provider: "google_sheets"
  strategy: "replace_tab" | "snapshot"
  accessStatus: "verified"
  archived: false
  snapshotChecksum: string
  healthVerifiedAt: string
  safety: {
    denylistCheckedAt: string
    operationalWorkbookMatch: false
    humanCreatedTabTakeover: false
  }
  capacity: { providerMaxCells: number; destinationAvailableCells: number }
  // folder + owner; replace_tab also carries workbook + managed tab
}
```

That is the handoff from “leftover desk went live” to “leftover preview may count cells.” Do **not** put sample rows on this type. Do **not** collapse leftover destination-desk Mongo documents into this type — snake_case records are what leftover `citeThisSavedDestinationRecord` reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// destinationContract.ts
// The owner pointed at a verified Google folder
// and either a snapshot workbook or a Vantage-managed tab.
// Load it live. Prove the checksum they cited still hashes.
// Refuse an operational workbook, a human-tab takeover, stale health, or a fake capacity.
// When they estimate and confirm, bind folder / workbook / tab / owner / capacity —
// not last night’s health stamp.
// Listing may paint a checksum from the saved row. Unverified rows stay checksum-less.

// ── 1. Load this destination live ─────────────────────────

export function loadThisDestinationLive()               // getReportingDestinationPort
export function installTheLiveDestinationAdapter(port)
export class InMemoryDestinationPort                    // Fake; clones on add / get

// ── 2. Prove this cited snapshot still holds ──────────────

export function proveThisCitedDestinationSnapshotStillHolds(snapshot, expected)

function refuseWhenTheChecksumDoesNotHash(snapshot, cited)
function refuseWhenTheDestinationIdDrifted(snapshot, cited)
function refuseWhenTheStrategyDrifted(snapshot, cited)
function refuseAnArchivedOrUnverifiedDestination(snapshot)
function refuseAnOperationalWorkbookOrHumanTabTakeover(snapshot)
function requireReplaceTabShapeOrBareSnapshotShape(snapshot)
function refuseStaleOrFutureHealth(snapshot, maxAgeMs)  // 24h default; 5-minute future skew
function refuseANonPositiveCapacity(snapshot)

// ── 3. Fingerprint the full snapshot versus the stable identity

export function fingerprintThisFullDestinationSnapshot(snapshot)
export function fingerprintThisDestinationsStableIdentity(snapshot)
export function stableIdentityFieldsForThisDestination(snapshot) // strips health stamps

// ── 4. Cite a saved destination record without going live ─

export function citeThisSavedDestinationRecord(record, destinationId) // null if unverified

function readSnakeCaseVerificationFields(record)
function omitTheChecksumWhenTheSavedRowCannotCite(record)

/** @deprecated Use loadThisDestinationLive */
export const getReportingDestinationPort = loadThisDestinationLive
/** @deprecated Use installTheLiveDestinationAdapter */
export const setReportingDestinationPort = installTheLiveDestinationAdapter
/** @deprecated Use InMemoryDestinationPort */
export { InMemoryDestinationPort as FakeReportingDestinationPort }
/** @deprecated Use proveThisCitedDestinationSnapshotStillHolds */
export const validateDestinationSnapshot = proveThisCitedDestinationSnapshotStillHolds
/** @deprecated Use fingerprintThisFullDestinationSnapshot */
export const destinationSnapshotChecksum = fingerprintThisFullDestinationSnapshot
/** @deprecated Use fingerprintThisDestinationsStableIdentity */
export const destinationStableIdentityChecksum = fingerprintThisDestinationsStableIdentity
/** @deprecated Use stableIdentityFieldsForThisDestination */
export const destinationStableIdentityPayload = stableIdentityFieldsForThisDestination
/** @deprecated Use citeThisSavedDestinationRecord */
export const snapshotChecksumFromDestinationRecord = citeThisSavedDestinationRecord
export type ValidatedReportingDestinationSnapshotV1 = ProvenDestinationSnapshot
export type ReportingDestinationPort = LiveDestinationPort
```

Read the primary path out loud: leftover desk already verified the folder. Leftover preview loads that destination through the installed port and proves the checksum the owner cited still hashes, the strategy matches, safety flags are both false, health is inside a day, and capacity is a real positive count. Leftover freeze does the same before the revision is written. Leftover estimate loads a fresh live snapshot, lets leftover lineage decide whether the managed tab advanced, then binds the stable identity — folder, workbook, tab, owner, capacity — so a health refresh between estimate and confirm still confirms. A swapped folder does not. Owner list paints a checksum from the saved row when it is active and verified; it does not go back to Drive.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two checksums are the story.** `fingerprintThisFullDestinationSnapshot` includes health stamps. `fingerprintThisDestinationsStableIdentity` does not. Do not merge them so “one checksum is cleaner.” Leftover estimate / confirm would start failing after leftover `refreshDestinationHealthAndDenylist`. See [`reporting-reporting.md`](reporting-reporting.md).

2. **Leftover estimate / confirm do not cite the frozen revision checksum.** Already-recommended `prepareManualRun` **asks** leftover `validateDestinationForImmutableRevision` and explicitly does **not** require `live.snapshotChecksum === revision.destination_snapshot_checksum`. Do not silently route estimate through `proveThisCitedDestinationSnapshotStillHolds` with the revision checksum so “preview and run share one prove.” That split is known.

3. **`citeThisSavedDestinationRecord` trusts Mongo and forces safety flags false.** Leftover desk’s `buildValidatedDestinationSnapshot` goes live (Drive, ownership marker, operational-workbook registry) and then **asks** the full fingerprint. The record cite reconstructs snake_case fields and never re-evaluates safety. Do not merge the two so “one payload builder owns the company.” Do not start throwing on a missing folder — owner list stays readable; the checksum is omitted.

4. **Capacity sits on the stable identity.** Available cells can change if leftover desk recounts the grid between estimate and confirm. Do not silently drop `capacity` from `stableIdentityFieldsForThisDestination` so “only folder / tab are identity.” That would hide a confirm mismatch the current digest would catch. Do not add `healthVerifiedAt` back.

5. **The process default is the Fake.** Missing leftover `registerReportingStage4Foundation` means Express / leftover queue consumers talk to an empty in-memory map. Project-organization already says queue consumers must re-register. Do not auto-install leftover Stage-4 inside `loadThisDestinationLive` so “there is always a live adapter.”

6. **Leftover live harness lies.** `live/liveTestRunFactory.ts` stores `destinationSnapshot.snapshotChecksum` in the `destinationStableIdentityChecksum` field. Do not “fix” that sibling in this rename.

7. **24-hour max-age is hardcoded here. Future skew is leftover config (5 minutes).** Do not pull `REPORTING_MAX_WINDOW_DAYS` or the Google kill switch into this file. Do not delete the hardcoded day so “config owns every clock.”

8. **`snapshot` strategy with workbook / managed-tab fields is `destination_unsafe`, even when the checksum hashes.** Tests already name that. Do not relax it so “extra fields are harmless.”

9. **Fake clones on add and get.** Do not switch to shared references so “tests are faster.” A test that mutates `safety.operationalWorkbookMatch` after `add` must not poison the next `get`.

10. **Leave sibling modules alone.** Leftover `buildValidatedDestinationSnapshot`, leftover `validateDestinationForImmutableRevision`, leftover `stableOwnerIdFromEmail`, leftover `evaluateReportingDestination` are already the right **depth**. This file does not create destinations or write Google.

## Testing

The **interface** is the test surface: `loadThisDestinationLive` / `installTheLiveDestinationAdapter`, `proveThisCitedDestinationSnapshotStillHolds`, `fingerprintThisFullDestinationSnapshot`, `fingerprintThisDestinationsStableIdentity`, `citeThisSavedDestinationRecord`.

Today’s `reporting.test.ts` already names Fake inject, checksum / safety fail-closed, stale / future / unparseable health, identity mismatch, snapshot-vs-replace shape, replace-tab sheet id, and stable identity ignoring health. Keep those. Add the missing named operations:

**Load this destination live**
- Empty Fake → 409 `destination_unverified` for an unknown id.
- `add` then `get` returns a clone; mutating the returned snapshot does not change the next `get`.
- `installTheLiveDestinationAdapter` is what leftover Stage-4 **asks**; do not boot leftover Stage-4 inside this test.

**Prove this cited snapshot still holds**
- Matching id / checksum / snapshot strategy returns the same snapshot.
- Cited checksum `"0".repeat(64)` → 409 checksum mismatch.
- `operationalWorkbookMatch: true` or `humanCreatedTabTakeover: true` → 409 safety (checksum also drifts if the stamp is not rebuilt — keep the existing fail-closed letter).
- `snapshot` carrying workbook + managed tab → 409 safety.
- `replace_tab` without a safe-integer sheet id → 409 safety.
- Health 25 hours old, 10 minutes in the future, or `"not-a-date"` → 409 stale.
- Capacity `0` or a non-integer → 409 unverified.
- Archived or `accessStatus !== "verified"` → 409 unavailable.

**Fingerprint the full snapshot versus the stable identity**
- Same folder / tab / capacity, newer health + denylist → full digests differ; stable digests match.
- Folder id change → stable digest changes.
- Artifact kinds stay `reporting_destination_snapshot` vs `reporting_destination_stable_identity` (leftover `computeChecksum` envelope). Do not assert helper internals.

**Cite a saved destination record**
- Active + verified + folder + capacity + health → a digest equal to `fingerprintThisFullDestinationSnapshot` of the reconstructed payload.
- `state !== "active"` or `access_status !== "verified"` → `null`.
- `replace_tab` missing workbook id or managed-tab sheet id → `null`.
- Owner list test already proves credentials are stripped; add that `snapshot_checksum` is present only when the cite returns a digest.

Do **not** add a test per helper (`refuseWhenTheChecksumDoesNotHash`, `requireReplaceTabShapeOrBareSnapshotShape`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover preview / leftover estimate / leftover desk verify / leftover lineage advancement inside these tests. Leftover `validateDestinationForImmutableRevision` stays a lineage test.

## What I would not do

- A `ReportingDestinationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `computeChecksum`.
- Moving the module into `checksum.ts` / `validate.ts` / `port.ts` or `create.ts` / `update.ts` / `delete.ts`.
- Breaking the full-checksum / stable-identity **seam** (health refresh between estimate and confirm must still confirm).
- Treating leftover destination desk, leftover lineage, leftover owner-id fold, leftover worker write, leftover preview / freeze, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing a live-destination **seam** that has only one **adapter** beside leftover `reportingDestinationPort.adapter.ts`.
- Silently “fixing” estimate’s refusal to cite the frozen revision checksum, leftover live harness’s snapshot-as-stable-identity lie, or capacity-on-stable-identity while recommending a rename.
- Jumping to `destinationLineage.ts`’s leftover managed-tab advancement — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
