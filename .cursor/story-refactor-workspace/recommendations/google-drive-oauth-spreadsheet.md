# Put A Folder Or A Test-Shaped Workbook In The Owner's Drive As The Connected Owner — Default Parent Is The Configured Export Folder, Trash The New Spreadsheet If Tab Stamping Fails — Never Begin Consent, Never Pick A File, Never Invent The Company Service Account — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 6 of this service — `spreadsheet.service.ts`
- Remaining in this service: `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` already recommended)
- Target: `src/services/googleDriveOAuth/spreadsheet.service.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this create file; leftover `reportingDestination.service.ts` **asks** this file to put a folder, and **asks** skipped `workbook.service.ts` to put a workbook, which is a one-line call into this same file). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — this file **asks** `getConnectedGoogleOAuthClient` and then talks to Drive / Sheets; it does **not** begin or complete). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — this file never unlocks). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md) (fold + exact-set refuse — the live-client **seam** already refused before this file runs). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (canned 403 + JSON sanitize — Wave B `sendApiError` maps this file’s `IntegrationError` / `BadRequestError` / bubbled `NotFoundError`). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (Wave B mounts that middleware **in front** of folder / test-spreadsheet; leftover reporting has its own Owner gate; this file never inspects `req`). Distinct from skipped `workbook.service.ts` (one-line facade `createOAuthSpreadsheetInFolder` → this file’s `createOAuthTestSpreadsheet` — leftover reporting **asks** the facade; the admin test-spreadsheet route **asks** this file). Distinct from later `picker.service.ts` (pick an existing file; it does **not** create). Distinct from later `driveMetadata.service.ts` (**asks** `normalizeFolderId` here, then reads metadata / mime / parent; it does **not** create). Distinct from later `managedTab.service.ts` (add / rename a reporting tab + ownership marker on an **existing** workbook — it does **not** create the spreadsheet). Distinct from leftover reporting destination resolve (`resolveDestinationFolder` / `resolveDestinationWorkbook` — Picker consume vs create-name vs configured export folder; this file is only the create **adapter**). Distinct from leftover reporting live adapters (`reportingSheetsAdapter.ts` / `reportingDriveAdapter.ts` — they **use** an existing destination; they do **not** create folders here). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (Master / Source Company lead rows via the **company** service account — not the Owner’s Drive). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md). Distinct from later Wave A `operationalWorkbooks` (registered spreadsheet IDs; `normalizeSpreadsheetId` is a sibling fold later metadata also asks — this file only folds **folder** ids). Distinct from Wave B `routes/google-drive-oauth.routes.ts` (`POST .../folders` and `POST .../test-spreadsheet` after secret + already-recommended owner gate). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (`exportFolderId` from `GOOGLE_DRIVE_EXPORT_FOLDER_ID` — this file **asks** it as the default parent). Distinct from Wave B `validation/v1/googleDriveOAuth.validation.ts` (title / name / optional folder id — this file does **not** Zod). Distinct from skipped barrel `index.ts` (re-exports folder create / test spreadsheet / request body / `normalizeFolderId`). This checkout’s `CONTEXT.md` does not define a Drive OAuth / Owner-Drive-create term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **four runtime import sites plus the barrel. Tests live on a sibling file.** Wave B `routes/google-drive-oauth.routes.ts` — `POST .../folders` asks `createGoogleDriveFolder({ name, parentFolderId })`; `POST .../test-spreadsheet` asks `createOAuthTestSpreadsheet({ title, folderId })`. Leftover `reporting/reportingDestination.service.ts` — `resolveDestinationFolder` asks `createGoogleDriveFolder({ name })` (no parent — default export folder); `resolveDestinationWorkbook` asks skipped `createOAuthSpreadsheetInFolder({ title, folderId })`, which is this file. Later `driveMetadata.service.ts` — `normalizeDriveFileId` and `assertParentFolderRelationship` ask `normalizeFolderId` (they do **not** create). Skipped `workbook.service.ts` is the one-line reporting **adapter**. Barrel `index.ts` re-exports `createGoogleDriveFolder` / `createGoogleDriveFolderRequest` / `createOAuthTestSpreadsheet` / `normalizeFolderId` and the two input types. Tests: `googleDriveOAuth.test.ts` locks `normalizeFolderId` from a raw id / Drive URL / `undefined`, invalid URL → `BadRequestError`, and `createGoogleDriveFolderRequest` parents under the extracted id. The same file also hosts already-recommended AES / state-hash tests — those belong on already-recommended `tokenEncryption.ts` / `googleDriveOAuth.service.ts`, not this **interface**. Not this **interface**: already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended fold / refuse, already-recommended sanitize, already-recommended signed-owner gate, later Picker consume, later metadata get, later managed-tab create, leftover destination Picker path, leftover company Sheets write, Wave B Zod.
- Seams callers need: put a folder vs put a test-shaped workbook (admin folder route vs admin probe vs leftover destination create); live-client miss (already-recommended `NotFoundError` **outside** the Drive `try`) vs Drive/Sheets failure (`IntegrationError`); create-then-stamp vs trash-if-stamp-fails (workbook only); raw-or-URL folder id (this file + later metadata) vs later spreadsheet-id fold (`normalizeSpreadsheetId`)
- Split later (only if the file outgrows one sitting): this ~230-line file is one sitting if you read it as put a folder or a test-shaped workbook in the Owner's Drive as the connected Owner, default parent is the configured export folder, trash the new spreadsheet if tab stamping fails, never begin consent, never pick a file, never invent the company service account. If it later splits: `putAFolderInTheOwnerDrive.ts` / `putATestShapedWorkbookInTheOwnerDrive.ts` / `readADriveFolderIdFromAUrlOrRawId.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `folder.ts` / `spreadsheet.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, skipped `workbook.service.ts`, later Picker, later `driveMetadata.service.ts`, later `managedTab.service.ts`, leftover reporting destination resolve, or already-recommended company Sheets into this file

`createGoogleDriveFolder` / `createOAuthTestSpreadsheet` / `normalizeFolderId` are executor mechanics. The owner question is: *The Owner wants Vantage to put a folder or a spreadsheet in their Drive, acting as the connected Owner, not as the company service account. Ask already-recommended live client. If they asked for a folder, create it under the requested parent or the configured export folder. If they asked for a spreadsheet, create it in the requested folder (or export folder), then stamp Summary / Customers / Moves with the probe sample rows. If stamping fails, trash the new file and still fail. Later metadata asks this file only to read a folder id from a URL. Leftover reporting destination create asks the skipped workbook facade, which is this same spreadsheet create — a real destination workbook is born with those probe tabs. Do not begin consent. Do not pick a file. Do not create a managed reporting tab. Do not invent the company service account.*

Already-recommended Owner login, already-recommended token lock, already-recommended grant allowlist, already-recommended public failure, already-recommended signed-owner HTTP gate, later Picker / metadata / managed-tab, leftover reporting destination resolve, leftover company Sheets, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “put a folder or a test-shaped workbook in the Owner's Drive as the connected Owner — default parent is the configured export folder, trash the new spreadsheet if tab stamping fails — never begin consent, never pick a file, never invent the company service account” story, not “a Drive CRUD helper,” and not the Owner login / the Picker / the managed reporting tab:

1. **Put a folder in the Owner's Drive** — `createGoogleDriveFolder(input)`. Ask already-recommended `getConnectedGoogleOAuthClient` (no row → `NotFoundError` **before** the Drive `try`). Ask Wave B `getGoogleDriveOAuthConfig`. Build the Drive v3 client. `createGoogleDriveFolderRequest` names the body: `mimeType` folder, `parents` only when `normalizeFolderId(input.parentFolderId ?? config.exportFolderId)` is present. `files.create` with `supportsAllDrives`. Missing `id` → raw `Error` inside the `try` → `IntegrationError` (“Google Drive could not create the folder.”) with `hasParentFolderId`. Else `{ folder_id, name, folder_url }` (`webViewLink` or the Drive folder URL). This beat does not stamp tabs. This beat does not trash on failure — Drive either returned a file or it did not. Wave B `POST .../folders` and leftover `resolveDestinationFolder` (create-name path) ask this **seam**. Leftover create-name passes **no** parent, so the default is the configured export folder.

2. **Put a test-shaped workbook in the Owner's Drive** — `createOAuthTestSpreadsheet(input)`. Same live client (same outside-`try` miss). Drive **and** Sheets v4 clients. Folder is `normalizeFolderId(input.folderId ?? config.exportFolderId)`. `files.create` a spreadsheet in that folder. Then `configureTestTabs`: rename the default sheet to `Summary`, add `Customers` and `Moves`, freeze the Summary header, write the probe rows (`Status` = “Owner OAuth creation test succeeded”, one sample customer, one sample move). Success → `{ spreadsheet_id, spreadsheet_url, title }`. Any throw after an id exists → best-effort `files.update` `{ trashed: true }` (swallow trash failure), then `IntegrationError` (“Google Drive could not create the test spreadsheet.”) with `hasFolderId`. Wave B `POST .../test-spreadsheet` asks this **seam**. Skipped `createOAuthSpreadsheetInFolder` is the same function with a required `folderId` — leftover `resolveDestinationWorkbook` (create-name path) asks that **adapter**, so a real reporting destination workbook is born with those three probe tabs.

3. **Read a Drive folder id from a URL or raw id** — `normalizeFolderId(value)`. Trim. Empty / missing → `undefined`. `/folders/{id}` capture or the raw string. `^[a-zA-Z0-9_-]+$` or `BadRequestError` (“Google Drive folder ID is invalid.”). Operations 1 and 2 ask this beat. Later `driveMetadata.service.ts` asks this **seam** for file-id fold and parent-folder assert. Tests lock it. This beat does not talk to Google. This beat does not fold a spreadsheet URL — later metadata asks leftover `normalizeSpreadsheetId` first.

There is no persist operation. There is no consent operation. There is no Picker operation. There is no managed-tab operation. Already-recommended live client, later metadata get, later managed-tab ownership marker, leftover destination Picker consume, and Wave B Zod already live in other files.

`createGoogleDriveFolderRequest` is the exported request-body beat operation 1 already uses. Tests lock the `parents` extraction. It is not a fourth owner operation.

## Organization

Keep one file as the screenplay for “put a folder or a test-shaped workbook in the Owner's Drive as the connected Owner — default parent is the configured export folder, trash the new spreadsheet if tab stamping fails — never begin consent, never pick a file, never invent the company service account.” Already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, already-recommended `oauthSecurity.ts`, already-recommended `ownerAuth.ts`, skipped `workbook.service.ts`, later Picker / metadata / managed-tab, leftover reporting destination resolve, leftover company Sheets, and Wave B Zod already live in deeper **modules**. Do not pull those in. Do not invent a `SpreadsheetService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a clean-workbook **adapter** beside this file’s probe-tab stamp. Do not invent a Picker **adapter** beside later `consumePickerSelectionReference`. Do not invent a managed-tab **adapter** beside later `createManagedTab`. Do not invent a company-key **adapter** beside already-recommended `createGoogleServiceAccountAuth`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `folder.ts` / `spreadsheet.ts`. Those are HTTP verbs / Drive nouns, not the owner story. Do not move this into already-recommended `googleDriveOAuth.service.ts` so “the login can also write Drive.” Do not move this into skipped `workbook.service.ts` so “reporting can own create.” Do not move this into later `managedTab.service.ts` so “tabs live together.” Do not move this into later `driveMetadata.service.ts` so “normalize can also create.” Do not silently skip `configureTestTabs` when leftover reporting asks so “destinations are empty.” Do not silently construct the company service account so “one Google write.”

**External interface** stays small (this is the test surface). Folder create, test-shaped workbook create, and folder-id fold are one story’s Owner Drive write, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGoogleDriveFolder` | `putAFolderInTheOwnerDrive` | Wave B folder route and leftover destination create-name need `{ folder_id, name, folder_url }` |
| `createGoogleDriveFolderRequest` | `nameTheOwnerDriveFolderCreate` | tests lock `parents` after URL fold without booting Drive |
| `createOAuthTestSpreadsheet` | `putATestShapedWorkbookInTheOwnerDrive` | Wave B test-spreadsheet route needs the probe-tab workbook; skipped facade is this same call |
| `normalizeFolderId` | `readADriveFolderIdFromAUrlOrRawId` | this file + later metadata need a folder id; empty stays `undefined` |
| `CreateGoogleDriveFolderInput` | `OwnerDriveFolderToPut` | name + optional parent (URL or id) |
| `CreateOAuthSpreadsheetInput` | `OwnerDriveWorkbookToPut` | title + optional folder (URL or id) |

Keep the old names as one-line aliases until Wave B routes, leftover reporting destination, skipped workbook facade, later metadata, and the tests migrate. Do not make callers learn `files.create` / `configureTestTabs` / `supportsAllDrives` as the domain language.

**Principle: old exports stay as aliases.** `createOAuthTestSpreadsheet` remains the imported name until the test-spreadsheet route and the skipped facade point at the story name. `createGoogleDriveFolder` remains the imported name until Wave B folders and leftover `resolveDestinationFolder` migrate.

**No class for the workflow.** The type that *does* earn a name is the new workbook this file hands back after the probe tabs exist (or after trash + fail):

```ts
type OwnerDriveTestShapedWorkbook = {
  spreadsheet_id: string
  spreadsheet_url: string
  title: string
}
```

That is the handoff from “Drive has a new spreadsheet file” to “Sheets stamped Summary / Customers / Moves, or we trashed it.” Do **not** add `tabs: []` so “reporting can skip the probe,” do **not** add `refresh_token` so “create can skip the live client,” and do **not** add `ownedByMe` so “this file can skip later metadata.”

`configureTestTabs` stays unexported. It is a beat, not a second public operation. Do not add `getConnectedGoogleOAuthClient` as a public **seam** on this file — already-recommended `googleDriveOAuth.service.ts` already owns the live client. Do not add `createOAuthSpreadsheetInFolder` as a public **seam** on this file — skipped `workbook.service.ts` already owns that one-line alias.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// spreadsheet.service.ts
// The Owner wants Vantage to put a folder or a spreadsheet
// in their Drive, acting as the connected Owner,
// not as the company service account.
// Ask already-recommended live client.
// If they asked for a folder, create it under the requested parent
// or the configured export folder.
// If they asked for a spreadsheet, create it in the requested folder
// (or export folder), then stamp Summary / Customers / Moves
// with the probe sample rows.
// If stamping fails, trash the new file and still fail.
// Later metadata asks this file only to read a folder id from a URL.
// Leftover reporting destination create asks the skipped workbook facade,
// which is this same spreadsheet create —
// a real destination workbook is born with those probe tabs.
// Do not begin consent.
// Do not pick a file.
// Do not create a managed reporting tab.
// Do not invent the company service account.

// ── 1. Put a folder in the Owner's Drive ──────────────────

export async function putAFolderInTheOwnerDrive(input: OwnerDriveFolderToPut): Promise<{
  folder_id: string
  name: string
  folder_url: string
}>

export function nameTheOwnerDriveFolderCreate(input): drive_v3.Schema$File
// mime folder; parents only when a folded id is present

async function handTheLiveOwnerDriveClient()          // already-recommended; throws before Drive try
function defaultTheParentToTheConfiguredExportFolder(parent)
function theFolderCreateFailed(error, hasParent)

// ── 2. Put a test-shaped workbook in the Owner's Drive ────

export async function putATestShapedWorkbookInTheOwnerDrive(
  input: OwnerDriveWorkbookToPut,
): Promise<OwnerDriveTestShapedWorkbook>

async function createTheSpreadsheetFileInTheFolder(drive, title, folderId)
async function stampTheProbeTabsAndSampleRows(sheets, spreadsheetId)
// rename default → Summary; add Customers, Moves; freeze header;
// write "Owner OAuth creation test succeeded" + sample customer + sample move
async function trashTheNewSpreadsheetIfStampingFailed(drive, spreadsheetId)
function theWorkbookCreateFailed(error, hasFolder)

// ── 3. Read a Drive folder id from a URL or raw id ────────

export function readADriveFolderIdFromAUrlOrRawId(
  value: string | undefined,
): string | undefined
```

Read the primary path out loud: *The Owner dashboard just called test-spreadsheet (or leftover reporting asked the skipped facade to create a destination workbook). The route already passed the API secret and the signed configured Drive Owner. Ask already-recommended live client — if there is no connection, fail before talking to Drive. Fold the folder id from the body or the configured export folder. Create a spreadsheet file in that folder as the Owner. Stamp Summary, Customers, and Moves with the probe rows. If stamping fails, trash the new file and still fail. The same file can put a folder the same way, without tabs. Later metadata only asks this file to read a folder id from a URL. This file never begins consent. This file never picks a file. This file never invents the company service account. A leftover destination workbook is born with those probe tabs — do not silently skip the stamp.*

That is the operation. `createOAuthTestSpreadsheet` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`createGoogleDriveFolder` / `createOAuthTestSpreadsheet` / `normalizeFolderId` are executor mechanics.** The owner story is “put a folder in the Owner's Drive” / “put a test-shaped workbook in the Owner's Drive” / “read a Drive folder id from a URL or raw id.” Keep the old names as aliases. Do not grow a `SpreadsheetService` with `create` / `createFolder` / `normalize`.

2. **The skipped workbook facade is this same probe.** Leftover `createOAuthSpreadsheetInFolder` is one call to operation 2 with a required `folderId`. Leftover `resolveDestinationWorkbook` create-name therefore stamps “Owner OAuth creation test succeeded” and sample Customers / Moves into a **real** reporting destination. Do **not** silently skip `configureTestTabs` when `folderId` is present so “destinations are empty.” Do **not** silently add a second export that creates a blank spreadsheet so “reporting can be clean” without a destination-create test. Do **not** silently move the stamp into Wave B test-spreadsheet only so “the facade can be empty.” The dual-use is the owner fact this rename must keep visible.

3. **Trash-if-stamp-fails is a load-bearing seam.** Operation 2 creates the Drive file first, then stamps. Stamp failure (or missing default sheet) tries `trashed: true` and swallows trash failure so the original error survives. Do not silently return the half-created `{ spreadsheet_id }` so “ops can inspect.” Do not silently skip trash so “the Owner can keep the file.” Do not silently add the same trash to operation 1 — folder create is one Drive call.

4. **Live-client miss is outside the Drive `try`.** Already-recommended `NotFoundError` (“Complete the owner authorization first.”) is **not** wrapped in `IntegrationError`. Wave B sanitize maps that 404 to `oauth_not_connected`. A Drive / Sheets throw inside the `try` becomes 502 `oauth_provider_error` (“Google Drive could not create the …”). Do not silently wrap the live-client call so “one IntegrationError.” Do not silently map missing connection to `BadRequestError` so “it matches leftover `requireActiveGoogleConnection`.”

5. **Default parent is the configured export folder, not Drive root-by-policy.** Both creates use `input.parent/folder ?? config.exportFolderId`, then fold. Missing export folder + missing input → no `parents` → Google’s My Drive root. Leftover destination create-name for a folder passes **no** parent and relies on this default. Do not silently refuse a missing export folder so “we never write to root” without a dedicated test. Do not silently require `folderId` on operation 2 so “the admin probe cannot omit it” — Wave B Zod already makes `folder_id` optional.

6. **Folder-id fold is not spreadsheet-id fold.** This file extracts `/folders/{id}` or a raw charset id. Later metadata asks leftover `normalizeSpreadsheetId` **first**, then this fold. A spreadsheet URL passed to `normalizeFolderId` fails the charset check (`/` and `?` are illegal) → `BadRequestError`. Do not silently teach this file to accept `/spreadsheets/d/{id}` so “one id helper.” Do not silently move this fold into later `normalizeDriveFileId` so “metadata owns ids” — tests and both creates already live here.

7. **MIME constants are copied next door.** This file’s `SPREADSHEET_MIME_TYPE` / `FOLDER_MIME_TYPE` are duplicated as later `driveMetadata.service.ts` exports. Later metadata does **not** import these constants from here. Do not silently re-export this file’s constants so “one source” in this rename — later metadata already owns the public names the barrel uses. Do not silently delete later metadata’s copies so “spreadsheet owns mime.”

8. **Two Google clients, one identity.** Operation 2 builds Drive and Sheets from the same already-recommended client. Operation 1 builds only Drive. Later managed-tab builds only Sheets. Do not silently accept an injected `DriveMetadataClient` here so “tests can skip Google” without keeping the live-client **seam**. Do not silently construct `GoogleAuth` from the company key so “Sheets still work when OAuth is down.”

9. **`createGoogleDriveFolderRequest` is exported for the test, not for leftover reporting.** Only `googleDriveOAuth.test.ts` imports it. Do not silently make leftover destination build the request body so “reporting can skip this file.” Keep the export as the request-body **seam** the interface already locks.

10. **Leave sibling modules alone.** Already-recommended begin / complete / live client / health, already-recommended lock / unlock, already-recommended fold / refuse, already-recommended canned 403 / JSON sanitize, already-recommended signed-owner gate, skipped workbook facade, later Picker consume, later metadata get, later managed-tab ownership marker, leftover destination Picker path, leftover company Sheets write, and Wave B Zod stay where they are. This file orchestrates live client → fold parent → Drive create → (workbook only) stamp or trash.

## Testing

The **interface** is the test surface: the folder-create / workbook-create / folder-id-fold / request-body exports (story names, old names as aliases) plus the two input types. Default-parent fold, live-client miss outside the Drive `try`, trash-if-stamp-fails, and the leftover-facade-is-the-probe rule are part of that **interface**. Do not boot Google. Do not boot Mongo. Do not boot Drive.

Today `googleDriveOAuth.test.ts` locks raw id / Drive URL / `undefined` fold, invalid URL → `/folder ID is invalid/`, and `createGoogleDriveFolderRequest` parents under the extracted id. Those tests belong on this **interface**. The AES / state-hash tests in the same file belong on already-recommended `tokenEncryption.ts` / `googleDriveOAuth.service.ts`. Add (or keep) file tests that name the operation:

**Read a Drive folder id from a URL or raw id**
- Raw id returns the id (today).
- `https://drive.google.com/drive/folders/{id}?usp=drive_link` returns the id (today).
- `undefined` / blank → `undefined` (today).
- `https://example.com/not-a-folder` throws `BadRequestError` (today).
- A spreadsheet URL is **not** a folder id.

**Put a folder in the Owner's Drive**
- Request body uses folder mime and the folded parent (today).
- Missing parent and missing export folder → no `parents`.
- Live-client `NotFoundError` is not wrapped in `IntegrationError` (do not boot Drive; stub the already-recommended **seam** if you add this).

**Put a test-shaped workbook in the Owner's Drive**
- Skipped `createOAuthSpreadsheetInFolder({ title, folderId })` is this same function — it still stamps the probe tabs. Do **not** assert a blank workbook.
- Stamp failure after an id exists attempts trash, then throws `IntegrationError` (“…test spreadsheet.”), not the half-created payload.
- Live-client miss stays `NotFoundError` (same outside-`try` rule).

**Not this interface**
- Begin / complete / status / disconnect / live client / health stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Exact-set refuse stays on already-recommended `oauthScopes.ts`.
- Canned 403 / JSON sanitize stay on already-recommended `oauthSecurity.ts`.
- Signed-owner HTTP gate stays on already-recommended `ownerAuth.ts`.
- Picker bootstrap / consume stay on later `picker.service.ts`.
- Metadata get / mime assert / owned-by-me stay on later `driveMetadata.service.ts`.
- Managed-tab ownership marker stays on later `managedTab.service.ts`.
- Destination Picker vs create-name vs export-folder **choice** stays on leftover `reportingDestination.service.ts`.
- Company Master / Source Company row write stays on already-recommended `googleSheets.service.ts`.
- Wave B Zod defaults (`Vantage OAuth Test` / `Vantage API Folder Test`) stay on the validation module.

Do **not** add a test per helper (`defaultTheParentToTheConfiguredExportFolder`, `stampTheProbeTabsAndSampleRows`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file reads `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` except as a prerequisite already-recommended live client already asked — it must not decode it. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that leftover destination create now skips probe tabs — it must not, in this rename. Do not add a test that a missing export folder now 400s — it must not, in this rename. Do not add a test that this file now mounts already-recommended owner middleware — it must not. Do not add a test that this file constructs `GoogleAuth` from the company key — it must not. Do not add a test that this file begins OAuth — it must not. Do not add a test that this file calls later `createManagedTab` — it must not. Do not add a test that this file consumes a Picker nonce — it must not.

## What I would not do

- A `SpreadsheetService` class with `create` / `createFolder` / `normalize`.
- Thirty two-line functions that only wrap `files.create`.
- Moving this into a CRUD folder, or into already-recommended `googleDriveOAuth.service.ts` / skipped `workbook.service.ts` / later `managedTab.service.ts` / later `driveMetadata.service.ts` / leftover `reportingDestination.service.ts` / already-recommended company Sheets “for cleanliness.”
- Breaking the live-client-outside-the-Drive-try **seam**, the trash-if-stamp-fails **seam**, the leftover-facade-is-the-probe **seam**, or the default-parent-is-export-folder **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / already-recommended `tokenEncryption.ts` / already-recommended `oauthScopes.ts` / already-recommended `oauthSecurity.ts` / already-recommended `ownerAuth.ts` / later `picker.service.ts` / later `driveMetadata.service.ts` / later `managedTab.service.ts` / leftover destination Picker consume / already-recommended company Sheets as this story.
- Inventing a clean-workbook **seam** that has only one **adapter** here, or a Picker **seam** that has only one **adapter** here, or a persist **seam** that has only one **adapter** here.
- Silently skipping probe tabs for leftover reporting, or silently returning a half-created spreadsheet, or silently wrapping the live-client miss, or silently refusing Drive root, or silently teaching this file to fold spreadsheet URLs, or silently constructing the company service account, or silently beginning consent from create.
- Writing a whole-folder recommendation that pretends later Picker / metadata / managed-tab / leftover reporting are this module.
- Opening `picker.service.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `putATestShapedWorkbookInTheOwnerDrive`.
