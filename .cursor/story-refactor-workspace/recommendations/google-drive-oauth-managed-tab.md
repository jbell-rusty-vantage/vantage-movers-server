# On An Already Proven Owner Workbook, Add A Vantage-Managed Reporting Tab And Stamp This Destination's Ownership Marker In ZZ1; Rename Only After Proving The Immutable Sheet Id Still Matches The Name And Marker, Then Re-Prove; Refuse A Human-Created Name Collision And A Tab That Is Not Ours — Never Create The Workbook, Never Begin Consent, Never Pick A File, Never Promote A Staging Tab, Never Evaluate The Operational-Workbook Denylist — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, visited after this pass)
- Pass: 11 of this service — `managedTab.service.ts`
- Remaining in this service: none (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` / `spreadsheet.service.ts` / `picker.service.ts` / `pickerNonceStore.ts` / `pickerSelectionStore.ts` / `driveMetadata.service.ts` already recommended)
- Target: `src/services/googleDriveOAuth/managedTab.service.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this managed-tab file; leftover `reportingDestination.service.ts` **asks** this file to refuse a human name collision, add the tab, rename the tab, and prove the tab is still ours). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (this file **asks** `getConnectedGoogleOAuthClient` only from `createSheetsWorkbookClient`; leftover destination already injects `SheetsWorkbookClient` and skips that beat). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (Wave B `sendApiError` maps this file’s `BadRequestError` / `IntegrationError` when leftover destination surfaces them). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (this file never inspects `req`). Distinct from already-recommended Owner Drive create: [recommendations/google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md) (put a **new** folder or probe-tab workbook; this file never creates a spreadsheet and never stamps Summary / Customers / Moves). Distinct from skipped `workbook.service.ts` (one-line create facade leftover destination **asks** before this file runs). Distinct from already-recommended Owner pick: [recommendations/google-drive-oauth-picker.md](google-drive-oauth-picker.md) (hand / verify / consume / re-prove a **file**; leftover destination already chose the workbook before this file adds a tab). Distinct from already-recommended unused nonce ticket: [recommendations/google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md). Distinct from already-recommended unused selection-reference ticket: [recommendations/google-drive-oauth-picker-selection-store.md](google-drive-oauth-picker-selection-store.md). Distinct from already-recommended live Drive metadata: [recommendations/google-drive-oauth-drive-metadata.md](google-drive-oauth-drive-metadata.md) (Drive v3 `files.get` + trash / owned / mime / parent — this file is Sheets v4 `addSheet` / `updateSheetProperties` / `values.update` / `values.get`). Distinct from skipped `picker.types.ts`. Distinct from leftover `reporting/ownershipMarker.ts` (`REPORTING_OWNERSHIP_MARKER_CELL` = `ZZ1`, serialize / parse / match — this file **asks** serialize on add and match on prove; it does **not** own the JSON). Distinct from leftover `reportingDestination.service.ts` (Picker-vs-create-vs-export **choice**, Mongo insert / `mutation_pending` rename reserve, leftover `calculateWorkbookCapacity` **asks** this client’s `listSheets`). Distinct from leftover `reporting/google/reportingSheetsAdapter.ts` (a **second** Sheets **adapter**: hidden staging tab + run marker + RAW writes + promote / delete — leftover delivery **asks** that file; this file never hides, never writes a run marker, never promotes). Distinct from leftover `reporting/google/reportingSheetsAdapter.ts` `createHiddenStagingTab` (same leftover `ownershipMarker` cell, **plus** a run marker — do not merge it into this file in this rename). Distinct from later Wave A `operationalWorkbooks` (denylist leftover destination already asked **before** this file). Distinct from later Wave A `reporting` (destination **choice** / snapshot / worker). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md). Distinct from Wave B routes (no HTTP route imports this file — leftover destination routes **ask** leftover destination). Distinct from skipped barrel `index.ts` (does **not** re-export this file). This checkout’s `CONTEXT.md` does not define a managed-tab / ownership-marker term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **leftover destination create / rename / verify / snapshot, plus leftover destination tests that lock prove on an injected client.** Leftover `reporting/reportingDestination.service.ts` — `assertNoHumanTabNameCollision` then leftover `createManagedTabWithClient` on create; leftover `renameManagedTabWithClient` on update after Mongo `mutation_pending` reserve; leftover verify (after optional pending-rename reconcile via `listSheets`) and leftover `buildValidatedDestinationSnapshot` ask `verifyManagedTabOwnership`; leftover `calculateWorkbookCapacity` / pending-rename reconcile ask `createSheetsWorkbookClient` (or the injected `sheetsClient`) then `listSheets`. Leftover `createManagedTabWithClient` / `renameManagedTabWithClient` are one-line pass-throughs onto this client. Tests: leftover `reportingDestination.test.ts` locks `verifyManagedTabOwnership` (human name collision / missing marker / matching marker) on an injected `SheetsWorkbookClient`; the “rename preserves immutable sheet ID” test **writes its own** `renameManagedTab` and does **not** call this file’s implementation. Leftover capacity tests ask `listSheets` on leftover destination’s **interface**, not this file’s add / rename. Not this **interface**: already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended folder / probe-tab create, already-recommended pick / unused tickets / live Drive metadata, leftover destination Mongo persist / denylist / Picker **choice**, leftover reporting Sheets delivery **adapter**, Wave B Zod. No dedicated `managedTab*.test.ts`.
- Seams callers need: live-client factory vs leftover-already-holds-Sheets (`createSheetsWorkbookClient` asks already-recommended live client; leftover destination tests / deps inject `SheetsWorkbookClient`); add vs rename vs prove (leftover create / leftover update / leftover verify + snapshot); leftover destination’s pre-add name refuse (`assertNoHumanTabNameCollision`) vs this file’s add-time name refuse (same sentence, two **asks**); leftover destination’s Mongo `mutation_pending` reserve **before** this file’s rename (this file never writes Mongo)
- Split later (only if the file outgrows one sitting): this ~240-line file is one sitting if you read it as on an already proven Owner workbook, add a Vantage-managed reporting tab and stamp this destination's ownership marker in ZZ1; rename only after proving the immutable sheet id still matches the name and marker, then re-prove; refuse a human-created name collision and a tab that is not ours, never create the workbook, never begin consent, never pick a file, never promote a staging tab, never evaluate the operational-workbook denylist. If it later splits: `addAVantageManagedReportingTabAndStampThisDestinationsOwnershipMarker.ts` / `renameAVantageManagedReportingTabAfterProvingItIsStillOursThenReProve.ts` / `proveTheManagedTabIsStillOurs.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `rename.ts` / `verify.ts`, and never merge already-recommended `spreadsheet.service.ts`, already-recommended `driveMetadata.service.ts`, leftover `reportingDestination.service.ts`, leftover `ownershipMarker.ts`, leftover `reportingSheetsAdapter.ts`, or later `operationalWorkbooks` into this file

`createSheetsWorkbookClient` / `createManagedTab` / `renameManagedTab` / `verifyManagedTabOwnership` / `assertNoHumanTabNameCollision` are executor mechanics. The owner question is: *Leftover destination already proved the workbook. Now it needs a tab Vantage owns on that workbook — not a human tab, not another destination’s tab. Add the tab, stamp ZZ1 with this destination’s marker, remember the immutable sheet id. When the owner renames, first prove the id still is that tab and still has our marker, refuse if a human already uses the new name, change only the title, then prove again. When leftover destination verifies or builds a snapshot, prove the same three things: id still matches the recorded name, no human twin shares that name, ZZ1 still matches this destination. Do not create the spreadsheet. Do not begin consent. Do not pick a file. Do not hide a staging tab or write a run marker. Do not evaluate the operational-workbook denylist. Do not invent the company service account.*

Already-recommended Owner login, already-recommended token lock, already-recommended Owner Drive create, already-recommended Owner pick, already-recommended unused tickets, already-recommended live Drive metadata, leftover destination **choice** / Mongo reserve, leftover ownership-marker JSON, leftover reporting Sheets delivery **adapter**, later operational-workbook denylist, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “on an already proven Owner workbook, add a Vantage-managed reporting tab and stamp this destination's ownership marker in ZZ1; rename only after proving the immutable sheet id still matches the name and marker, then re-prove; refuse a human-created name collision and a tab that is not ours — never create the workbook, never begin consent, never pick a file, never promote a staging tab, never evaluate the operational-workbook denylist” story, not “a Sheets CRUD helper,” and not leftover destination create / leftover delivery promote:

1. **Add a Vantage-managed reporting tab and stamp this destination’s ownership marker** — `SheetsWorkbookClient.createManagedTab({ spreadsheetId, destinationId, tabName })`. List tabs. Any existing title equal to `tabName` → `BadRequestError` (“A tab with that name already exists. Choose a different managed tab name.”). `spreadsheets.batchUpdate` `addSheet` with that title, `hidden: false`. Missing `sheetId` → `IntegrationError` (“Google Sheets did not return a managed tab ID.”). Then `values.update` RAW on `{tabName}!ZZ1` with leftover `serializeReportingOwnershipMarker(destinationId)`. Return `{ immutableSheetId, name: tabName }`. This beat does **not** call prove after the stamp. This beat does **not** trash the new tab if the marker write fails. This beat does **not** trim `tabName` — leftover destination already trimmed. Leftover create **asks** leftover `assertNoHumanTabNameCollision` **then** this beat (same name refuse twice). Leftover `createManagedTabWithClient` is this same call.

2. **Rename a Vantage-managed reporting tab after proving it is still ours, then re-prove** — `SheetsWorkbookClient.renameManagedTab({ spreadsheetId, destinationId, immutableSheetId, currentTabName, nextTabName })`. First **asks** operation 3 with `currentTabName`. Trim `nextTabName`; empty → `BadRequestError` (“Managed tab name is required.”). Same as `currentTabName` → return the current id / name (prove already ran; this beat does **not** list again). Else list tabs; any **other** `sheetId` whose title equals the trimmed name → the same “already exists” `BadRequestError`. `updateSheetProperties` title on the immutable id (`fields: "title"`). Then **asks** operation 3 with the new name. Return `{ immutableSheetId, name: trimmedNextName }`. This beat does **not** write Mongo. Leftover destination already reserved `mutation_pending: managed_tab_rename` **before** this beat; a throw leaves that reservation for leftover verify to reconcile by immutable id. Leftover `renameManagedTabWithClient` is this same call.

3. **Prove the managed tab is still ours** — `verifyManagedTabOwnership({ spreadsheetId, destinationId, immutableSheetId, tabName, client? })`. List tabs. Find `sheetId === immutableSheetId`; missing or `title !== tabName` → `BadRequestError` (“The managed reporting tab is missing or no longer matches the destination record.”). Any **other** sheet with the same title → `BadRequestError` (“A human-created tab already uses the managed tab name. Choose another name.”). Read `{tabName}!ZZ1`. Leftover `ownershipMarkerMatchesDestination(marker, destinationId)` false → `BadRequestError` (“The selected tab is not a Vantage-managed reporting tab.”). Return `{ humanCreatedTabTakeover: false }` — this beat never returns `true`. Leftover snapshot catches **any** throw and sets `humanCreatedTabTakeover = true` then `destination_unsafe`. Leftover verify **asks** this beat after optional pending-rename reconcile (leftover `listSheets` picks the live title if it is the recorded name **or** the pending next name). This beat does **not** rename. This beat does **not** add a tab.

There is no create-workbook operation. There is no consent operation. There is no Picker operation. There is no Drive-metadata operation. There is no denylist operation. There is no staging-promote operation. Already-recommended `createOAuthTestSpreadsheet` still creates the workbook. Already-recommended consume still spends the selection reference. Leftover `evaluateReportingDestination` still refuses operational workbooks. Leftover `createHiddenStagingTab` still hides a run tab.

`createSheetsWorkbookClient` / `createSheetsWorkbookClientFromApi` are the live-factory **adapters** operations 1–3 already use. `listSheets` / `readCell` are client methods leftover capacity / leftover pending-rename reconcile / this file’s own beats already use. They are not extra owner operations. `assertNoHumanTabNameCollision` is the pre-add name refuse leftover create **asks** before operation 1; operation 1 repeats it. It is not a fourth owner operation. `SheetsWorkbookClient` is the injected **adapter** leftover destination tests / deps already hold.

## Organization

Keep one file as the screenplay for “on an already proven Owner workbook, add a Vantage-managed reporting tab and stamp this destination's ownership marker in ZZ1; rename only after proving the immutable sheet id still matches the name and marker, then re-prove; refuse a human-created name collision and a tab that is not ours — never create the workbook, never begin consent, never pick a file, never promote a staging tab, never evaluate the operational-workbook denylist.” Already-recommended `spreadsheet.service.ts`, already-recommended `driveMetadata.service.ts`, leftover `reportingDestination.service.ts`, leftover `ownershipMarker.ts`, leftover `reportingSheetsAdapter.ts`, and later `operationalWorkbooks` already live in deeper **modules**. Do not pull those in. Do not invent a `ManagedTabService` class. Do not invent a Mongo persist **seam** here. Do not invent a staging-promote **adapter** beside leftover `createHiddenStagingTab`. Do not invent a denylist **adapter** beside later `evaluateReportingDestination`. Do not invent a create-workbook **adapter** beside already-recommended `createOAuthTestSpreadsheet`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `rename.ts` / `verify.ts`. Those are HTTP verbs / Sheets nouns, not the owner story. Do not move this into leftover `reportingDestination.service.ts` so “destination owns tabs.” Do not move this into leftover `reportingSheetsAdapter.ts` so “one Sheets client.” Do not move this into leftover `ownershipMarker.ts` so “the JSON can also write ZZ1.” Do not move this into already-recommended `spreadsheet.service.ts` so “tabs live with create.” Do not silently trash-if-stamp-fails so “add matches already-recommended workbook create.” Do not silently call prove after add so “create and rename match” and fail leftover create when ZZ1 is momentarily unreadable. Do not silently write `mutation_pending` inside rename so “this file can skip leftover reserve.”

**External interface** stays small (this is the test surface). Add, rename, and prove are one story’s Vantage-owned tab, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createSheetsWorkbookClient` | `openTheConnectedOwnerSheetsWorkbookClient` | leftover destination live path needs a client from the live OAuth row |
| `createSheetsWorkbookClientFromApi` | `wrapAnAlreadyBuiltSheetsApiAsTheWorkbookClient` | live factory **adapter**; leftover destination injects the client type, not this wrap |
| `SheetsWorkbookClient.createManagedTab` | `addAVantageManagedReportingTabAndStampThisDestinationsOwnershipMarker` | leftover create needs `{ immutableSheetId, name }` |
| `SheetsWorkbookClient.renameManagedTab` | `renameAVantageManagedReportingTabAfterProvingItIsStillOursThenReProve` | leftover update after Mongo reserve |
| `verifyManagedTabOwnership` | `proveTheManagedTabIsStillOurs` | leftover verify / leftover snapshot / rename before-and-after |
| `assertNoHumanTabNameCollision` | `refuseIfAnyTabAlreadyUsesThisManagedName` | leftover create **asks** this **before** add |
| `SheetsWorkbookClient.listSheets` | `listTheWorkbookTabs` | leftover capacity / leftover pending-rename reconcile / this file’s own beats |
| `SheetsWorkbookClient.readCell` | `readOneWorkbookCell` | prove reads ZZ1 |
| `SheetsWorkbookClient` | `OwnerSheetsWorkbookClient` | injected **adapter** (tests / leftover destination deps) vs live factory |

Keep the old names as one-line aliases until leftover destination and the leftover destination tests migrate. Do not make callers learn `addSheet` / `updateSheetProperties` / `ZZ1` / `batchUpdate` as the domain language.

**Principle: old exports stay as aliases.** `verifyManagedTabOwnership` remains the imported name until leftover verify / snapshot migrate. `createSheetsWorkbookClient` remains the imported name until leftover destination live path migrates. `createManagedTab` / `renameManagedTab` remain the client method names until leftover `*WithClient` pass-throughs migrate.

**No class for the workflow.** `SheetsWorkbookClient` is an **adapter** **seam**, not a workflow class — keep it. The type that *does* earn a name is the tab leftover destination stores after add / rename:

```ts
type VantageManagedReportingTab = {
  immutableSheetId: number
  name: string
}
```

That is the handoff from “Sheets added or renamed the tab” to “leftover destination may persist `managed_tab.immutable_sheet_id` / `name` / `ownership_marker_version`.” Do **not** add `humanCreatedTabTakeover: true` so “prove can skip leftover snapshot’s catch,” do **not** add `refresh_token` so “add can skip health,” and do **not** add `hidden` / `runId` so “this file can replace leftover staging.”

`assertNoHumanTabNameCollision` stays exported because leftover create **asks** it as a real pre-add refuse, not a test leak. Do not add `serializeReportingOwnershipMarker` as a public **seam** on this file — leftover `ownershipMarker.ts` already owns the JSON. Do not add `calculateWorkbookCapacity` as a public **seam** on this file — leftover destination already owns the cell math. Do not add `createHiddenStagingTab` as a public **seam** on this file — leftover reporting Sheets **adapter** already owns staging.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// managedTab.service.ts
// Leftover destination already proved the workbook.
// Now it needs a tab Vantage owns on that workbook —
// not a human tab, not another destination’s tab.
// Add the tab, stamp ZZ1 with this destination’s marker,
// remember the immutable sheet id.
// When the owner renames, first prove the id still is that tab
// and still has our marker, refuse if a human already uses
// the new name, change only the title, then prove again.
// When leftover destination verifies or builds a snapshot,
// prove the same three things: id still matches the recorded name,
// no human twin shares that name, ZZ1 still matches this destination.
// Do not create the spreadsheet.
// Do not begin consent.
// Do not pick a file.
// Do not hide a staging tab or write a run marker.
// Do not evaluate the operational-workbook denylist.
// Do not invent the company service account.

// ── 1. Add a Vantage-managed reporting tab and stamp this destination’s ownership marker

export async function openTheConnectedOwnerSheetsWorkbookClient(): Promise<OwnerSheetsWorkbookClient>
// asks already-recommended getConnectedGoogleOAuthClient

export function wrapAnAlreadyBuiltSheetsApiAsTheWorkbookClient(
  sheets: sheets_v4.Sheets,
): OwnerSheetsWorkbookClient

async function addAVantageManagedReportingTabAndStampThisDestinationsOwnershipMarker(input)
function refuseIfAnyTabAlreadyUsesThisManagedName(existing, tabName)
function askSheetsToAddAVisibleTab(spreadsheetId, tabName)
function refuseAMissingManagedTabId(sheetId)
async function stampThisDestinationsOwnershipMarkerInZz1(spreadsheetId, tabName, destinationId)
// leftover serializeReportingOwnershipMarker; RAW values.update
// does not prove after the stamp
// does not trash if the stamp fails

// ── 2. Rename a Vantage-managed reporting tab after proving it is still ours, then re-prove

async function renameAVantageManagedReportingTabAfterProvingItIsStillOursThenReProve(input)
// first asks prove with currentTabName
function refuseAnEmptyNextManagedTabName(nextTabName)
function returnTheCurrentTabWhenTheNameDidNotChange(input)
function refuseIfAnotherTabAlreadyUsesTheNextName(existing, immutableSheetId, nextName)
async function askSheetsToRenameOnlyTheImmutableTabTitle(spreadsheetId, immutableSheetId, nextName)
// then asks prove with the new name
// does not write Mongo

// ── 3. Prove the managed tab is still ours ────────────────

export async function proveTheManagedTabIsStillOurs(input): Promise<{ humanCreatedTabTakeover: false }>
function findTheTabByImmutableSheetId(sheets, immutableSheetId)
function refuseIfTheLiveTitleNoLongerMatchesTheRecordedName(managed, tabName)
function refuseIfAHumanCreatedTabAlreadyUsesTheManagedName(sheets, immutableSheetId, tabName)
async function refuseUnlessZz1StillMatchesThisDestination(client, spreadsheetId, tabName, destinationId)
// leftover ownershipMarkerMatchesDestination
// never returns humanCreatedTabTakeover: true

export async function refuseIfAnyTabAlreadyUsesThisManagedName(input): Promise<void>
// leftover create asks this before add; add repeats the same refuse
```

Read the primary path out loud: *Leftover destination already passed the API secret and the signed configured Drive Owner, chose or created the workbook, and refused the operational-workbook denylist. Refuse if any tab already uses the managed name. Add a visible tab. Stamp ZZ1 with this destination’s marker. Remember the immutable sheet id — do not prove again on the add path. When the owner later asks to rename, leftover destination first reserves `mutation_pending` in Mongo, then this file proves the id still matches the recorded name and marker, refuses a human twin on the new name, changes only that title, and proves again. Leftover verify and leftover snapshot prove the same three things before a report may write. A missing tab, a wrong marker, and a human twin are all `BadRequestError` here; leftover snapshot maps every throw to `humanCreatedTabTakeover`. This file never creates the workbook. This file never begins consent. This file never picks a file. This file never promotes a staging tab.*

That is the operation. `createManagedTab` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`createManagedTab` / `renameManagedTab` / `verifyManagedTabOwnership` are executor mechanics.** The owner story is “add a Vantage-managed reporting tab and stamp this destination’s ownership marker” / “rename after proving it is still ours, then re-prove” / “prove the managed tab is still ours.” Keep the old names as aliases. Do not grow a `ManagedTabService` with `create` / `update` / `verify`.

2. **Add does not prove. Rename proves twice.** After `addSheet` + ZZ1 write, add returns the new id / name and leftover create persists them. Rename **asks** prove before and after. Do not silently teach add to call prove so “one post-write path” — leftover create has no `mutation_pending` recovery for a failed first stamp, and a transient ZZ1 miss would 400 a brand-new destination. Do not silently drop prove-after-rename so “add and rename match” and lose leftover verify’s assumption that a successful rename already re-proved.

3. **Add does not trash if the marker write fails.** Already-recommended workbook create trashes the new spreadsheet when tab stamping fails. This add leaves an unmarked visible tab. Do not silently add trash-if-stamp-fails in this rename. Do not silently retry the stamp from leftover create so “the tab cannot exist unmarked” without a test that names leftover recovery. Leftover destination has no janitor for an unmarked managed tab.

4. **Leftover create asks the name refuse twice.** `assertNoHumanTabNameCollision` then `createManagedTab` lists again and throws the same sentence. A race between the two lists can still add a duplicate title; prove later would catch a human twin. Do not silently delete leftover’s pre-check so “add owns the refuse” and lose leftover create’s fail-before-insert-id… leftover create already **inserted** the destination row **before** both refuses. Do not silently move the leftover insert to after add in this rename — leftover destination’s write order is leftover destination’s **interface**. Do not silently delete this file’s add-time refuse so “leftover already checked.”

5. **`{ humanCreatedTabTakeover: false }` never returns true.** Prove’s success type is a constant. Leftover snapshot’s `humanCreatedTabTakeover = true` is the **catch** of any throw (missing tab, title mismatch, human twin, wrong marker). Do not silently return `{ humanCreatedTabTakeover: true }` from the human-twin branch so “the flag lives here” and change leftover snapshot’s catch. Do not silently throw a different error class for a wrong marker so “takeover means only a human twin” without leftover snapshot tests. Today every prove failure is a takeover from leftover snapshot’s point of view.

6. **Prove matches id **and** recorded name.** `find(sheetId)` then `title !== tabName` is the same refuse as missing. Leftover verify may pass the live title after pending-rename reconcile (`actual.title` is recorded name **or** pending next name). Do not silently prove by id only so “a human rename is fine.” Do not silently teach leftover verify to skip reconcile and pass the stale recorded name after a provider timeout — leftover verify’s reconcile is leftover destination’s **interface**.

7. **Rename same-name is a no-op after prove.** Empty trim → required. Equal to `currentTabName` → return current without a second list. Leftover destination already trimmed. Do not silently skip prove on the same-name path so “nothing changed.” Do not silently trim `currentTabName` here so “both sides fold” — leftover persisted name is the authority leftover verify reconciles against.

8. **Add does not trim; leftover destination does.** `createManagedTab` compares `input.tabName` as given. Leftover create passes `managedTabName.trim()`. Do not silently trim inside add so “this file can skip leftover fold” and accept a name leftover destination did not persist. Do not silently accept whitespace so “Sheets will trim.”

9. **The live factory and the injected client are one workbook **adapter**.** `createSheetsWorkbookClient` asks already-recommended live client and wraps `createSheetsWorkbookClientFromApi`. Leftover destination deps inject `SheetsWorkbookClient` and skip the factory. `FromApi` has no leftover runtime caller except the factory. Do not silently delete `FromApi` so “everyone must open a client.” Do not silently boot Sheets inside leftover destination tests so “one client path.” Do not silently add `FromApi` to skipped `index.ts`.

10. **Leftover reporting Sheets **adapter** is a second Sheets client.** Leftover `createReportingSheetsAdapter` also asks already-recommended live client, also lists sheets, also `addSheet`s, also writes leftover `ZZ1`. It hides the tab, writes a **run** marker, and later promotes / deletes. Do not silently teach this file to hide + stamp a run marker so “one addSheet.” Do not silently teach leftover delivery to call `createManagedTab` so “one ownership stamp.” Do not silently share `listSheets` implementations in this rename.

11. **Leftover capacity **asks** `listSheets`, not add / rename.** Leftover `calculateWorkbookCapacity` sums `rowCount * columnCount` and fails closed without grid metadata. This file lists those fields. Do not silently move leftover capacity into this file so “the client owns cells.” Do not silently drop `rowCount` / `columnCount` from `listSheets` so “prove does not need them” and break leftover capacity.

12. **This file never writes Mongo.** Leftover create inserts the destination **before** add, then patches `managed_tab`. Leftover rename reserves `mutation_pending` **before** this rename and keeps the reservation on throw. Do not silently persist `managed_tab` inside add / rename. Do not silently clear `mutation_pending` inside rename so “success can skip leftover patch.”

13. **The barrel does not re-export this file.** Skipped `index.ts` stops at already-recommended metadata types. Leftover destination imports this file. Do not silently add `verifyManagedTabOwnership` / the client factory to the barrel so “one import path.”

14. **Leave sibling modules alone.** Already-recommended begin / complete / live client / health, already-recommended folder / probe-tab create, already-recommended hand / verify / consume-reference / re-prove, already-recommended unused tickets, already-recommended live Drive metadata, leftover destination Picker-vs-create-vs-export **choice** / Mongo reserve / capacity, leftover ownership-marker JSON, leftover reporting Sheets delivery **adapter**, later operational-workbook denylist, and Wave B Zod stay where they are. This file orchestrates list tabs → refuse a human name → add or rename the visible tab → stamp or re-read ZZ1 → (caller) persist the immutable id.

## Testing

The **interface** is the test surface: the add / rename / prove exports (story names, old names as aliases), the live-client factory, the injected client type, and the managed-tab return. “Add never proves,” “rename proves before and after,” “prove never returns takeover true,” “add never trashes on a failed stamp,” and “this file never writes Mongo” are part of that **interface**. Do not boot Google. Do not boot Sheets. Prefer a mock `sheets.spreadsheets.batchUpdate` / `values.update` / `values.get` / `spreadsheets.get`. A live-client factory test is allowed only if it stubs already-recommended `getConnectedGoogleOAuthClient` and does not begin OAuth.

Today there is **no** `managedTab*.test.ts`. Leftover `reportingDestination.test.ts` locks prove (human twin / missing marker / matching marker) on an injected client — those assertions belong on this **interface** and should move here (or stay imported from this file). The leftover “rename preserves immutable sheet ID” test **implements** `renameManagedTab` itself and does **not** lock this file. Add file tests that name **this** operation:

**Add a Vantage-managed reporting tab and stamp this destination’s ownership marker**
- Happy path `addSheet` then RAW ZZ1 write of leftover `serializeReportingOwnershipMarker(destinationId)`; returns that `sheetId` as `immutableSheetId` and the given name.
- Existing title → `BadRequestError` /already exists/ and `addSheet` is not called.
- Missing `sheetId` → `IntegrationError` /managed tab ID/ and ZZ1 is not written.
- Does not call `proveTheManagedTabIsStillOurs` after the stamp.
- Does not trash / delete the new tab when ZZ1 write throws — the error propagates.
- Does not call already-recommended `createOAuthTestSpreadsheet`.
- Does not call leftover `createHiddenStagingTab`.

**Rename a Vantage-managed reporting tab after proving it is still ours, then re-prove**
- Happy path prove (current name) → `updateSheetProperties` title on the immutable id → prove (new name); returns the same `immutableSheetId` and the trimmed name.
- Empty / whitespace next name → `BadRequestError` /required/ and Sheets is not asked to rename.
- Next name equals current name → return current after the first prove; `updateSheetProperties` is not called.
- Another `sheetId` already uses the next name → `BadRequestError` /already exists/ and title is not updated.
- First prove failure (missing id / title mismatch / human twin / wrong marker) → rename is not called.
- Does not write `mutation_pending` / `managed_tab` / any Mongo collection.

**Prove the managed tab is still ours**
- Matching id + title + ZZ1 marker → `{ humanCreatedTabTakeover: false }`.
- Missing id or title mismatch → `BadRequestError` /missing or no longer matches/.
- Second sheet with the same title → `BadRequestError` /human-created tab already uses the managed tab name/.
- ZZ1 not leftover-matching this destination → `BadRequestError` /not a Vantage-managed reporting tab/.
- Success never returns `humanCreatedTabTakeover: true`.
- Happy path prove does not call `addSheet` / `updateSheetProperties`.

**Not this interface**
- Leftover destination insert / `mutation_pending` reserve / pending-rename reconcile stays on leftover `reportingDestination.service.ts`.
- Leftover capacity cell math stays on leftover `calculateWorkbookCapacity`.
- Leftover ownership-marker JSON stays on leftover `ownershipMarker.ts`.
- Leftover hidden staging / run marker / promote stays on leftover `reportingSheetsAdapter.ts`.
- Put a folder / probe-tab workbook stays on already-recommended `spreadsheet.service.ts`.
- Hand / verify / consume-reference / re-prove stays on already-recommended `picker.service.ts`.
- Live Drive metadata get / 404-vs-403 stays on already-recommended `driveMetadata.service.ts`.
- Begin / complete / live client / health stays on already-recommended `googleDriveOAuth.service.ts`.
- Operational-workbook denylist stays on later `operationalWorkbooks`.

Do **not** add a test per helper (`refuseIfAnyTabAlreadyUsesThisManagedName`, `stampThisDestinationsOwnershipMarkerInZz1`, `findTheTabByImmutableSheetId`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file creates a spreadsheet — it must not. Do not add a test that this file begins OAuth — it must not. Do not add a test that this file consumes a nonce or a selection reference — it must not. Do not add a test that this file evaluates the operational-workbook denylist — it must not. Do not add a test that this file hides a staging tab or writes a run marker — it must not. Do not add a test that this file writes `mutation_pending` — it must not. Do not add a test that add now calls prove — it must not, in this rename. Do not add a test that add now trashes on a failed stamp — it must not, in this rename. Do not add a test that prove now returns `humanCreatedTabTakeover: true` — it must not, in this rename. Do not add a test that skipped `index.ts` now re-exports this file — it must not, in this rename. Do not add a test that leftover `createHiddenStagingTab` is now this function — it must not. Do not add a test that leftover destination now inserts after add — it must not, in this rename.

## What I would not do

- A `ManagedTabService` class with `create` / `update` / `delete` / `verify`.
- Thirty two-line functions that only wrap `addSheet`.
- Moving this into a CRUD folder, or into leftover `reportingDestination.service.ts` / leftover `reportingSheetsAdapter.ts` / leftover `ownershipMarker.ts` / already-recommended `spreadsheet.service.ts` “for cleanliness.”
- Breaking the live-client-vs-injected-client **seam**, the add-does-not-prove **seam**, the rename-proves-before-and-after **seam**, or the leftover-destination-reserves-Mongo-before-rename **seam**.
- Treating leftover `reportingDestination.service.ts` / leftover `reportingSheetsAdapter.ts` / leftover `ownershipMarker.ts` / already-recommended `spreadsheet.service.ts` / already-recommended `driveMetadata.service.ts` / already-recommended `picker.service.ts` as this story.
- Inventing a staging-promote **seam** that has only one **adapter** here, or a denylist **seam** that has only one **adapter** here, or a Mongo persist **seam** that has only one **adapter** here.
- Silently teaching add to prove or trash-if-stamp-fails, or silently returning `humanCreatedTabTakeover: true`, or silently merging leftover `createHiddenStagingTab`, or silently writing `mutation_pending` inside rename, or silently adding this file to skipped `index.ts`.
- Writing a whole-folder recommendation that pretends leftover reporting / later `operationalWorkbooks` are this module.
- Opening `googleMaps` in this same pass — finish `googleDriveOAuth` here; that folder is the next unvisited service.
- Making a Form Lead 201 wait on `addAVantageManagedReportingTabAndStampThisDestinationsOwnershipMarker`.
