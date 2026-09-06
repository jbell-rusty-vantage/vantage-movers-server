# Point Reports At The Owner's Drive, Keep The Managed Tab Ours, Then Prove It Is Still Safe To Write — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 6 of this service — `reportingDestination.service.ts`
- Remaining in this service: `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reportingDestination.service.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. HTTP: Destinations `GET/POST/PATCH/DELETE .../destinations`, `POST .../verify` → this file. Happy path: preview loads a **live destination snapshot + checksum**. Skip / fail: destination port safety / checksum drift fail closed. Google destination **mutations and new runs** stay off unless `REPORTING_GOOGLE_DELIVERY_ENABLED=true` — that kill switch lives on leftover Wave B `src/routes/reporting.routes.ts`, not here). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** leftover port `getValidatedSnapshot`, not this file). Distinct from already-recommended leftover prove-this-destination: [`reporting-destination-contract.md`](reporting-destination-contract.md) (this file **asks** `destinationSnapshotChecksum` after the live prove; leftover `validateDestinationSnapshot` is leftover preview / leftover lineage). Distinct from already-recommended leftover keep-the-frozen-revision: [`reporting-destination-lineage.md`](reporting-destination-lineage.md) (predecessor sheet IDs — this file never reads `predecessor_sheet_ids`). Distinct from already-recommended leftover name-the-owner: [`reporting-destination-identity.md`](reporting-destination-identity.md) (this file **asks** `ownerIdentitySnapshotFromEmail` on snapshot and replace-tab create; unused `destinationFolderArtifact` / `destinationWorkbookArtifact` **ask** `driveFolderUrl` / `spreadsheetUrl`; create itself reads `getGoogleDriveOAuthConfig().ownerEmail` and does **not** **ask** `expectedConfiguredOwnerEmail`). Distinct from leftover repository: sibling `reportingDestinationRepository.ts` (CAS persist / `safeReportingDestinationForRead` / leftover `casUpdateManagedSheetAfterPromotion` — this file **asks** list / get / insert / update / archive / safe-read; it does **not** **ask** promotion CAS or leftover `refreshDestinationHealthAndDenylist`). Distinct from leftover destination port adapter: sibling `reportingDestinationPort.adapter.ts` (one Stage-4 **adapter**; **asks** `buildValidatedDestinationSnapshot`). Distinct from leftover ownership marker: sibling `ownershipMarker.ts` (this file stamps `REPORTING_OWNERSHIP_MARKER_VERSION`; leftover managed-tab **adapter** writes the cell). Distinct from leftover operational-workbook registry: already-recommended [`operational-workbooks-registry.md`](operational-workbooks-registry.md) (`assertConfigurationComplete` on create / rename / verify / live prove; `evaluateReportingDestination` on replace-tab live prove). Distinct from already-recommended leftover Owner pick: [`google-drive-oauth-picker.md`](google-drive-oauth-picker.md) (this file **asks** `consumePickerSelectionReference` + `revalidateFolderMetadata` / `revalidateSpreadsheetMetadata` + `assertWorkbookNotDenylisted`). Distinct from already-recommended leftover managed tab: [`google-drive-oauth-managed-tab.md`](google-drive-oauth-managed-tab.md) (this file **asks** `assertNoHumanTabNameCollision` / `createManagedTab` / `renameManagedTab` / `verifyManagedTabOwnership`). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner destination desk + success audit + kill switch + verify-failure leftover observability). Distinct from leftover live harness: `live/liveGoogleOrchestration.ts` (**asks** create + live prove for replace-tab and snapshot seeds) and `live/liveTestDenylistProof.ts` (**asks** `setReportingDestinationDeps` then create against a denylisted workbook). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR). Do not add a Reporting Service file in this rename so “the Service sentence wins.”
- Callers: Wave B `src/routes/reporting.routes.ts` (`GET .../destinations` → `listReportingDestinationSummaries`; `GET .../destinations/:id` → `getReportingDestinationSummary`; `POST .../destinations` → `createReportingDestination`; `PATCH .../destinations/:id` → `updateReportingDestinationRecord`; `POST .../destinations/:id/verify` → `verifyReportingDestination`; `DELETE .../destinations/:id` → `archiveReportingDestinationRecord`). Leftover `reportingDestinationPort.adapter.ts` (**asks** `buildValidatedDestinationSnapshot`). Leftover live harness **asks** create + live prove; leftover denylist proof **asks** `setReportingDestinationDeps` + create. Tests: `reportingDestination.test.ts` **asks** `calculateWorkbookCapacity` only (grid subtract / missing metadata). The same file also proves leftover operational-workbook refuse, leftover managed-tab marker, leftover contract stale / unsafe snapshot, leftover repository credential strip, and leftover managed-tab rename **without** calling this desk. `reporting.test.ts` does not import this file. **Does not name** `resolveDestinationFolder` / `calculateWorkbookCapacity` / `setReportingDestinationDeps` as operations.
- Seams callers need: show-the-destinations (`list` / `get`) vs point-reports-at-this-Drive-place (`createReportingDestination`) vs rename-the-managed-tab-without-two-owners-colliding (`updateReportingDestinationRecord`) vs prove-the-destination-is-still-ours (`verifyReportingDestination`) vs stop-pointing-reports-here (`archiveReportingDestinationRecord`) vs hand-leftover-preview-a-live-proven-snapshot (`buildValidatedDestinationSnapshot`). The snapshot / replace-tab **seam** exists because snapshot remembers a folder only and replace-tab must own a Vantage tab before leftover preview may count cells. The reserve-before-Google **seam** exists because two renames must fail at Mongo before either caller reaches Sheets, and a provider timeout must leave `mutation_pending` so verify can reconcile by immutable sheet ID. The live-prove / cite-saved-record **seam** exists because leftover preview goes live through leftover port and leftover owner list paints leftover `snapshotChecksumFromDestinationRecord` without Drive. There is no begin / complete Domain Command **seam**. There is no leftover worker RAW-cell **seam**. There is no leftover promotion-CAS **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~730-line file is one sitting if you read it as point reports at the owner's Drive, keep the managed tab ours, then prove it is still safe to write. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `snapshot.ts` / `replaceTab.ts` so “each strategy owns a file.” Do **not** pull leftover repository CAS / leftover contract validate / leftover lineage / leftover worker write here so “one destination file owns the company.” If it later splits: `pointReportsAtThisDrivePlace.ts` / `renameTheManagedTabWithoutTwoOwnersColliding.ts` / `proveThisDestinationIsStillOurs.ts` / `handLeftoverPreviewALiveProvenSnapshot.ts` only as later story files, never CRUD.

`createReportingDestination` / `updateReportingDestinationRecord` / `verifyReportingDestination` / `archiveReportingDestinationRecord` are executor mechanics. The owner question is: *I want Vantage to write reports into my Drive. Point at a folder — a Picker ticket, a folder we create, or the configured export folder. Snapshot: remember the folder, stamp the hashed owner, and mark it verified. Replace-tab: pick or create a workbook in that folder, write an unverified destination first, create a Vantage-owned tab, then mark it verified. If I rename that tab, reserve the Mongo version before Google so two clicks cannot both reach Sheets; if Google times out, leave the reservation so verify can reconcile the actual title by immutable sheet ID. Before leftover preview counts cells, go live: refuse stale health, refuse an operational workbook, refuse a human-taken tab, then stamp leftover contract’s checksum. Archive when I am done — not while a rename is pending. Do not preview. Do not freeze. Do not write report cells. Do not walk predecessor sheet IDs.*

Leftover preview / freeze, leftover prove-this-destination, leftover keep-the-frozen-revision, leftover name-the-owner, leftover repository CAS, leftover picker consume, leftover managed-tab **adapter**, leftover worker write already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one “point reports at the owner's Drive, keep the managed tab ours, then prove it is still safe to write” story, not “a destination CRUD service,” and not leftover preview or leftover worker write:

1. **Show the destinations we already pointed at** — `listReportingDestinationSummaries` / `getReportingDestinationSummary`. Connect Mongo. Leftover repository list (default active, newest `updated_at`) or get-by-id. Missing / not found → 404. Return leftover `safeReportingDestinationForRead` (no `drive_connection_id`, no actors; leftover contract may paint `snapshot_checksum` from the saved record). Does not talk to Drive. Does not **ask** leftover operational-workbook `assertConfigurationComplete`.

2. **Point reports at this Drive place** — `createReportingDestination`. Connect Mongo. Require leftover operational-workbook configuration. Require an active leftover `GoogleDriveConnection` for the configured owner email. Resolve the folder (Picker consume `flow: "folder"`, or leftover `createGoogleDriveFolder`, or leftover `exportFolderId` + revalidate). Stamp leftover `ownerIdentitySnapshotFromEmail`. Snapshot: insert `strategy: "snapshot"`, `access_status: "verified"`, default capacity = leftover `GOOGLE_SHEETS_PROVIDER_MAX_CELLS` on both sides, no workbook, no tab. Replace-tab: require a trimmed managed-tab name; resolve the workbook (Picker consume `flow: "spreadsheet"` with `expectedParentFolderId`, or leftover `createOAuthSpreadsheetInFolder`); leftover `assertWorkbookNotDenylisted`; insert `access_status: "unverified"` **before** Google tab work; leftover `assertNoHumanTabNameCollision`; create the managed tab (destination id is already the Mongo id); recount leftover `calculateWorkbookCapacity` from every sheet grid; CAS-update version `1` to verified + managed tab + health / denylist now. CAS miss → 409 `destination_unverified`. Wave B Zod already requires a folder pick or create-name and, for replace-tab, a workbook pick or create-name plus tab name — leftover `exportFolderId` fallback is not on the HTTP path.

3. **Rename the managed tab without two owners colliding** — `updateReportingDestinationRecord`. Active only. `mutation_pending` → 409. Version must equal `expectedVersion`. Snapshot strategy → 400 (only replace-tab). Missing workbook or missing managed tab → 409 / 400 (“archive and create a new destination”). Denylist + leftover spreadsheet revalidate. Then reserve: CAS this exact version to `access_status: "unverified"` + `mutation_pending: { kind: "managed_tab_rename", token, next_name, started_at }`. Reservation miss → 409. Then leftover `renameManagedTab`. Provider throw **keeps** the reservation (comment: a timeout may have applied the title). Then CAS `expectedVersion + 1` to the new title, same immutable sheet id, verified, `mutation_pending: null`, health now. Second CAS miss → 409. The temporary unverified state is deliberate.

4. **Prove the destination is still ours / recover the pending rename** — `verifyReportingDestination`. Active only. Revalidate the folder. Snapshot: stamp health / denylist / `access_status: "verified"`. Replace-tab: require workbook + managed-tab sheet id; denylist; leftover spreadsheet revalidate; if `mutation_pending` exists it must be `managed_tab_rename` with a trimmed `next_name` or 409 “operator recovery”; list sheets and find the immutable sheet id; actual title must be the recorded name **or** the pending next name, else 409 “could not be reconciled safely”; adopt the actual title and clear `mutation_pending`; leftover `verifyManagedTabOwnership` on that title; recount capacity; persist the CAS at the current version. Persist miss → 409.

5. **Stop pointing reports here** — `archiveReportingDestinationRecord`. `mutation_pending` → 409 (do not archive mid-rename). Leftover repository archive CAS (`state: "archived"`, `access_status: "unhealthy"`). Miss → 404. Does not delete the Google folder, workbook, or tab.

6. **Hand leftover preview a live proven snapshot** — `buildValidatedDestinationSnapshot`. Active + `access_status: "verified"` or 409. Health and denylist instants must be younger than leftover `REPORTING_DESTINATION_HEALTH_MAX_AGE_MS` (24 hours) or 409 stale. Replace-tab: leftover operational-workbook `evaluateReportingDestination` — `allowed === false` throws `destination_unsafe` (and would have set `operationalWorkbookMatch`; the payload still writes `false` because the throw happens first). Leftover `verifyManagedTabOwnership` catch → `humanCreatedTabTakeover` then the same `destination_unsafe` throw. Remap leftover snake_case owner / folder / capacity onto leftover contract’s camelCase payload, `accessStatus: "verified"`, `archived: false`, safety flags both `false`. **Ask** leftover `destinationSnapshotChecksum`. Does **not** persist a health refresh. Does **not** **ask** leftover `validateDestinationSnapshot` — leftover preview does that after leftover port returns.

`resolveDestinationFolder` / `resolveDestinationWorkbook` / `requireActiveGoogleConnection` / `calculateWorkbookCapacity` / `createManagedTabWithClient` / `renameManagedTabWithClient` / `defaultDestinationCapacity` are beats, not extra owner operations. `setReportingDestinationDeps` is the live / test Drive–Sheets injection, not a seventh destination. `toObjectId` / `destinationFolderArtifact` / `destinationWorkbookArtifact` are unused here — do not promote them.

## Organization

Keep one file. This is the screenplay for “point reports at the owner's Drive, keep the managed tab ours, then prove it is still safe to write.” Leftover repository CAS, leftover contract checksum / validate, leftover lineage, leftover owner-email hash, leftover picker consume, leftover managed-tab cells, leftover worker RAW write already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDestinationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second live **adapter** beside leftover `reportingDestinationPort.adapter.ts`. Do not invent a second persist **adapter** beside leftover repository `updateReportingDestination`. Do not invent a second owner-email **adapter** beside leftover `getGoogleDriveOAuthConfig`.

Do not split snapshot / replace-tab / verify into CRUD files. Point, rename, verify, and live prove stay together because leftover preview must not count cells against a destination this desk has not verified, and a rename reservation is what verify recovers. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED` so “this file owns the kill switch.” Do not move success audit from the route into this file. Do not start calling leftover `casUpdateManagedSheetAfterPromotion`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listReportingDestinationSummaries` | `listTheDestinationsWeAlreadyPointedAt` | Wave B owner list |
| `getReportingDestinationSummary` | `showThisDestination` | Wave B owner read |
| `createReportingDestination` | `pointReportsAtThisDrivePlace` | Wave B create; leftover live harness seeds |
| `updateReportingDestinationRecord` | `renameTheManagedTabWithoutTwoOwnersColliding` | Wave B patch; reserve before Google |
| `verifyReportingDestination` | `proveThisDestinationIsStillOurs` | Wave B verify; recovers `mutation_pending` |
| `archiveReportingDestinationRecord` | `stopPointingReportsHere` | Wave B delete-as-archive |
| `buildValidatedDestinationSnapshot` | `handLeftoverPreviewALiveProvenSnapshot` | leftover Stage-4 port **adapter** |
| `setReportingDestinationDeps` | `installTheDestinationDriveAndSheetsAdapters` | leftover live denylist proof / tests |
| `calculateWorkbookCapacity` | `countTheCellsThisWorkbookAlreadyUses` | beat of replace-tab create / verify; keep exported until tests drop it |
| `CreateReportingDestinationInput` | `PointReportsAtThisDrivePlaceInput` | snapshot vs replace-tab folder / workbook / tab |
| `UpdateReportingDestinationInput` | `RenameTheManagedTabInput` | `expectedVersion` + next tab name |

Keep the old names as one-line aliases until Wave B `reporting.routes.ts`, leftover port **adapter**, leftover live harness, leftover denylist proof, and `reportingDestination.test.ts` migrate. Do not make leftover preview learn `createReportingDestination` as the live prove — leftover port **asks** `handLeftoverPreviewALiveProvenSnapshot`. Do not make callers learn `updateReportingDestinationRecord` as “any destination patch” — only replace-tab rename exists. Do not export `toObjectId` / `destinationFolderArtifact` / `destinationWorkbookArtifact` as story names (unused; leftover `src/utils/objectId.ts` already owns ObjectId construction).

**No class for the workflow.** The leftover Stage-4 port class stays in leftover `reportingDestinationPort.adapter.ts`. The type that *does* earn a name is the pending rename reservation:

```ts
type ManagedTabRenameInProgress = {
  kind: "managed_tab_rename"
  token: string
  next_name: string
  started_at: Date
}
```

That is the handoff from “we reserved this version before Google” to “verify may adopt the actual title by immutable sheet ID.” Do **not** put a predecessor sheet id on this type. Do **not** collapse leftover contract’s `ProvenDestinationSnapshot` into this type — that checksum payload is what leftover preview cites.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingDestination.service.ts
// The owner wants Vantage to write reports into their Drive.
// Point at a folder. Snapshot remembers the folder.
// Replace-tab also owns a Vantage-managed tab.
// Rename reserves Mongo before Google.
// Verify recovers a timed-out rename by immutable sheet ID.
// Leftover preview may count cells only after a live prove.
// Do not preview. Do not freeze. Do not write report cells.

// ── 1. Show the destinations we already pointed at ───────

export async function listTheDestinationsWeAlreadyPointedAt(filter)
export async function showThisDestination(id)

// ── 2. Point reports at this Drive place ─────────────────

export async function pointReportsAtThisDrivePlace(input, actor)

async function requireTheOwnerDriveConnection()
async function resolveTheFolderWeWillWriteInto(input, drive)
async function resolveTheWorkbookInsideThatFolder(input, folderId, drive)
function stampTheHashedOwnerWePersist()
function defaultCapacityUntilWeCountTheWorkbook()
async function rememberTheSnapshotFolderAsVerified(folder, actor)
async function rememberTheReplaceTabDestinationUnverified(folder, workbook, actor)
async function refuseAHumanTabAlreadyUsingThisName(workbookId, tabName)
async function createTheVantageOwnedTab(destinationId, workbookId, tabName)
async function countTheCellsThisWorkbookAlreadyUses(workbookId)
async function markTheReplaceTabDestinationVerified(destinationId, tab, capacity, actor)

// ── 3. Rename the managed tab without two owners colliding

export async function renameTheManagedTabWithoutTwoOwnersColliding(id, input, actor)

async function loadTheActiveReplaceTabDestination(id)
function refuseIfARenameIsAlreadyPending(destination)
function refuseIfTheVersionIsStale(destination, expectedVersion)
async function reserveThisVersionBeforeGoogle(id, expectedVersion, nextName, actor)
async function renameTheVantageOwnedTab(workbookId, destinationId, sheetId, currentName, nextName)
async function clearTheReservationAfterGoogleRenames(id, reservedVersion, renamedTab, actor)

// ── 4. Prove the destination is still ours ───────────────

export async function proveThisDestinationIsStillOurs(id, actor)

async function revalidateTheFolderIsStillThere(folderId)
async function recoverThePendingRenameByImmutableSheetId(workbookId, managedTab, pending)
async function proveTheTabStillCarriesOurOwnershipMarker(workbookId, destinationId, sheetId, tabName)
async function persistTheFreshHealthStamp(id, version, patch)

// ── 5. Stop pointing reports here ────────────────────────

export async function stopPointingReportsHere(id, expectedVersion, actor)

// ── 6. Hand leftover preview a live proven snapshot ──────

export async function handLeftoverPreviewALiveProvenSnapshot(destinationId)

function refuseIfHealthIsOlderThanADay(healthVerifiedAt, denylistCheckedAt)
function refuseIfThisIsAnOperationalWorkbook(workbookId)
async function refuseIfAHumanTookTheTab(workbookId, destinationId, managedTab)
function remapTheSavedRecordOntoTheChecksumPayload(destination)
```

Read the replace-tab create path out loud: *require the Drive connection, resolve the folder, stamp the hashed owner, resolve the workbook, refuse a denylisted workbook, remember the destination unverified, refuse a human tab already using this name, create the Vantage-owned tab, count the cells this workbook already uses, mark the destination verified.*

Read the rename path out loud: *load the active replace-tab destination, refuse a pending mutation, refuse a stale version, reserve this version before Google, rename the Vantage-owned tab, clear the reservation after Google renames. If Google times out, keep the reservation. Verify later finds the immutable sheet id and adopts the actual title if it is the old name or the pending next name.*

That is the operation. `updateReportingDestinationRecord` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`updateReportingDestinationRecord` lies.** The only legal patch is a replace-tab managed-tab rename with a version reservation. The name says “any destination update.” Call it `renameTheManagedTabWithoutTwoOwnersColliding` or owners will keep asking for a folder-url PATCH.

2. **`createReportingDestination` is two strategies, one insert timing.** Snapshot writes verified in one persist. Replace-tab inserts unverified **before** leftover collision check and leftover tab create. If Google throws, Mongo already has an unverified row with no `managed_tab`. Verify then 409s “incomplete.” Do not silently move the insert after Google so “create is atomic” — that reorder is a separate, tested change. Rename the beats (`rememberTheReplaceTabDestinationUnverified` then `createTheVantageOwnedTab`) so the order is visible.

3. **Wave B Zod already forbids the `exportFolderId` fallback.** Leftover `resolveDestinationFolder` will revalidate leftover `GOOGLE_DRIVE_EXPORT_FOLDER_ID` when the body omits pick and create-name. Leftover `createReportingDestinationSchema` requires one of those two. Do not start sending an empty folder from the route so “the configured export folder is used.” Do not delete the fallback in this rename.

4. **Create reads the owner email twice and never asks leftover `expectedConfiguredOwnerEmail`.** `requireActiveGoogleConnection` and the stamp both call leftover `getGoogleDriveOAuthConfig().ownerEmail`. Already-recommended leftover identity exports the one-line reader leftover picker uses. Do not start wiring it here so “one helper owns the company” in the same pass as the rename.

5. **Live prove does not persist health; verify does.** Leftover `handLeftoverPreviewALiveProvenSnapshot` throws on stale stamps and returns leftover contract’s checksum. Leftover estimate’s health refresh is leftover repository `refreshDestinationHealthAndDenylist`, not this file. Do not start writing Mongo from the live prove so “preview keeps health young.”

6. **`toObjectId` here is a different function.** It validates a hex string and returns the same string. Leftover `src/utils/objectId.ts` constructs a `Types.ObjectId`. This export has **no** caller. Do not promote it. Do not “fix” the name clash by re-exporting the util.

7. **`destinationFolderArtifact` / `destinationWorkbookArtifact` are unused.** Resolve already takes a URL from leftover picker / leftover folder create / leftover workbook create / leftover revalidate. Do not start calling the wrappers so “the public-URL fallback is used.”

8. **`reportingDestination.test.ts` barely names this desk.** Capacity is the only export it **asks**. Operational-workbook refuse, leftover contract stale / unsafe, leftover repository credential strip, and leftover managed-tab rename live in the same file and never call `pointReportsAtThisDrivePlace` / `renameTheManagedTabWithoutTwoOwnersColliding` / `proveThisDestinationIsStillOurs` / `handLeftoverPreviewALiveProvenSnapshot`. Do not treat those sibling proofs as this interface.

9. **Leave sibling modules alone.** Leftover `insertReportingDestination`, leftover `destinationSnapshotChecksum`, leftover `consumePickerSelectionReference`, leftover `createManagedTab`, leftover `evaluateReportingDestination` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `listTheDestinationsWeAlreadyPointedAt`, `showThisDestination`, `pointReportsAtThisDrivePlace`, `renameTheManagedTabWithoutTwoOwnersColliding`, `proveThisDestinationIsStillOurs`, `stopPointingReportsHere`, `handLeftoverPreviewALiveProvenSnapshot`.

Today’s `reportingDestination.test.ts` only **asks** `calculateWorkbookCapacity` (every grid subtracted; missing row/column metadata fails closed). That is a beat, not the story. Keep those two capacity proofs. Replace the sibling-dump style with tests that name the desk operations (inject leftover `setReportingDestinationDeps` Drive / Sheets **adapters**; do not boot leftover live Google):

**Point reports at this Drive place**
- Snapshot + create-folder: one insert, `strategy: "snapshot"`, `access_status: "verified"`, no workbook, capacity both sides = leftover provider max, leftover `ownerIdentitySnapshotFromEmail` keys are snake_case.
- Replace-tab + create-workbook: denylist runs **before** insert; insert is `unverified`; collision + create-tab run **after**; CAS version `1` becomes verified with the new immutable sheet id.
- Replace-tab against a denylisted workbook → leftover denylist throw and **no** insert (leftover live denylist proof already names this).
- Missing Drive connection → 400 “not connected.”
- Replace-tab without a tab name → 400 (desk guard; Wave B Zod also guards).

**Rename the managed tab without two owners colliding**
- Happy path: reserve `expectedVersion` → Google rename → CAS `expectedVersion + 1` verified, same sheet id, `mutation_pending` cleared.
- Second concurrent rename at the same `expectedVersion` fails at reserve (409) and leftover `renameManagedTab` is **not** called.
- Snapshot strategy → 400.
- `mutation_pending` already set → 409.
- Google throw after reserve: reservation remains; do not clear `mutation_pending` in the catch.

**Prove the destination is still ours**
- Snapshot verify stamps health / denylist and stays verified without listing sheets.
- Pending rename whose live title equals `next_name`: adopt the title, clear reservation, ownership marker still required.
- Pending rename whose live title is neither recorded nor `next_name` → 409 reconcile.
- Pending kind other than `managed_tab_rename` → 409 operator recovery.

**Hand leftover preview a live proven snapshot**
- Fresh verified replace-tab returns leftover contract checksum and camelCase owner / managed tab.
- Health older than 24 hours → 409 stale (desk clock; leftover contract’s own stale test stays on leftover `validateDestinationSnapshot`).
- Operational workbook → 409 `destination_unsafe`.
- Ownership marker miss → 409 `destination_unsafe`.
- Does **not** write `health_verified_at`.

**Show / stop**
- Missing id → 404.
- Archive with `mutation_pending` → 409.
- Archive CAS miss → 404.
- Safe read still omits `drive_connection_id` / actors (existing leftover repository proof; keep it there).

Do **not** add a test per helper (`resolveTheFolderWeWillWriteInto`, `defaultCapacityUntilWeCountTheWorkbook`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover preview / leftover freeze / leftover estimate / leftover promotion CAS / leftover worker RAW write inside these tests. Leftover `previewReportingDraft` stays a leftover-reporting test. Leftover `validateDestinationSnapshot` stays a leftover-contract test. Leftover `casUpdateManagedSheetAfterPromotion` stays a leftover-repository / leftover-promotion test.

## What I would not do

- A `ReportingDestinationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover repository `insert` / `update` / `archive`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `snapshot.ts` / `replaceTab.ts`.
- Breaking the reserve-before-Google **seam** (Mongo reservation must land before leftover `renameManagedTab`).
- Breaking the replace-tab insert-before-tab-create **seam** in the same pass as the rename.
- Treating leftover preview / leftover prove-this-destination / leftover keep-the-frozen-revision / leftover name-the-owner / leftover promotion CAS / leftover worker write / leftover Analytics / leftover Sheet Sync as this story.
- Inventing a live-destination **seam** that has only one **adapter** beside leftover `reportingDestinationPort.adapter.ts`.
- Silently “fixing” leftover `exportFolderId` being dead on HTTP, unused URL artifacts, unused `toObjectId`, create’s direct config email read, or the unverified-row-if-Google-throws gap while recommending a rename.
- Starting to check `REPORTING_GOOGLE_DELIVERY_ENABLED` inside this file.
- Jumping to `reportingDestinationRepository.ts`’s leftover persist — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
