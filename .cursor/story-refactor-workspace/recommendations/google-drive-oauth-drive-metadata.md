# Get Live Drive Metadata For A Known File Id Using The Connected Owner Client, Map Google's HTTP Failures So Leftover Janitor Can Tell A Confirmed-Gone File From A Blocked Refetch, And Assert The File Is Still Not Trash, Still Owned By The Connected Account, Still The Expected Folder Or Spreadsheet, And Still In The Expected Parent When Leftover Destination Asked — Never Create A File, Never Begin Consent, Never Consume A Ticket, Never Trust The Picker Display Name — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 10 of this service — `driveMetadata.service.ts`
- Remaining in this service: `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` / `spreadsheet.service.ts` / `picker.service.ts` / `pickerNonceStore.ts` / `pickerSelectionStore.ts` already recommended)
- Target: `src/services/googleDriveOAuth/driveMetadata.service.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this metadata get; leftover `reportingDestination.service.ts` **asks** already-recommended consume / re-prove, which **ask** this file to fetch and assert). Distinct from already-recommended Owner pick: [recommendations/google-drive-oauth-picker.md](google-drive-oauth-picker.md) (that file hands the Picker, remaps this file’s `BadRequestError` → `picker_invalid_selection` and every other Drive miss → `picker_selection_unavailable`, then spends the ticket — this file never sees a nonce or a selection reference). Distinct from already-recommended unused nonce ticket: [recommendations/google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md). Distinct from already-recommended unused selection-reference ticket: [recommendations/google-drive-oauth-picker-selection-store.md](google-drive-oauth-picker-selection-store.md) (that file persists / finds / spends a hashed row; already-recommended consume **asks** this file **between** find and spend — this file never writes Mongo). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (this file **asks** `getConnectedGoogleOAuthClient` only from `createDriveMetadataClient`; leftover janitor / denylist proof already hold a Drive client and skip that beat). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (Wave B `sendApiError` maps this file’s `NotFoundError` / `UnauthorizedError` / `IntegrationError` / `BadRequestError` when a route surfaces them; leftover janitor reads `drive_reason` **before** that remap). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (this file never inspects `req`). Distinct from already-recommended Owner Drive create: [recommendations/google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md) (put a **new** folder or probe-tab workbook; this file **asks** that file’s `normalizeFolderId` and never creates). Distinct from skipped `workbook.service.ts` (one-line create facade). Distinct from skipped `picker.types.ts`. Distinct from later `managedTab.service.ts` (add / rename a reporting tab + ownership marker on an **already proven** workbook — Sheets v4, not Drive files.get). Distinct from leftover `reporting/destinationIdentity.ts` (hash folds — this file never sees the raw ticket). Distinct from leftover destination resolve (`resolveDestinationFolder` / `resolveDestinationWorkbook` — Picker-vs-create-vs-export **choice**; leftover destination injects `DriveMetadataClient` and **asks** already-recommended consume / re-prove). Distinct from leftover `reporting/live/liveTestSecurity.ts` (`refetchDriveFileMetadata` is a **second** Drive get that also asks `appProperties` — do not merge it into this file in this rename). Distinct from leftover `reporting/google/driveAppProperties.ts` (`REPORTING_SPREADSHEET_MIME_TYPE` is a **second** spreadsheet mime constant). Distinct from later Wave A `operationalWorkbooks` (`normalizeSpreadsheetId` is the first fold this file **asks**; denylist stays on already-recommended picker). Distinct from Wave B routes (no HTTP route imports this file’s fetch / asserts — the barrel re-exports only mime + types). Distinct from skipped barrel `index.ts`. This checkout’s `CONTEXT.md` does not define a Drive metadata / owned-by-me term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **already-recommended picker’s fetch / assert, leftover janitor’s classified refetch, leftover denylist proof’s injected get, leftover picker contract runner, plus assert tests on a sibling file.** Already-recommended `picker.service.ts` — `verifyGooglePickerSelection` / `consumePickerSelectionReference` / `revalidateSpreadsheetMetadata` / `revalidateFolderMetadata` ask `createDriveMetadataClient` (or an injected `DriveMetadataClient`) then `getFileMetadata`, then `assertDriveAccessible` / `assertDriveOwnedByConnectedUser` / `assertDriveMimeType` and optional `assertParentFolderRelationship`; bootstrap only uses this file’s mime constants for Picker views. Leftover `reporting/reportingDestination.service.ts` — `DestinationDeps.driveClient?: DriveMetadataClient` is passed through to already-recommended consume / re-prove (type only; this file is not imported for fetch). Leftover `reporting/live/janitorCompletion.ts` — `refetchRegisteredContainerCleanupState` asks `fetchDriveFileMetadata(drive, folderId)` then `isDriveMetadataConfirmedNotFoundError` / `isDriveMetadataRefetchBlockedError`. Leftover `reporting/live/liveTestDenylistProof.ts` wraps `fetchDriveFileMetadata(driveApi, fileId)` as an injected client. Leftover `reporting/live/livePickerContractRunner.ts` asks `createDriveMetadataClient`. Leftover `reporting/live/liveTestSecurity.ts` imports `FOLDER_MIME_TYPE` + `DriveFileMetadata` and hosts its **own** refetch. Leftover `reporting/live/liveTestReleaseSafety.test.ts` imports `SPREADSHEET_MIME_TYPE`. Leftover `reporting/live/janitorCompletion.test.ts` constructs `DRIVE_METADATA_ERROR_REASON` errors and locks leftover classify — those assertions belong on leftover janitor’s **interface**, but they prove this file’s 404-vs-403 **seam**. Barrel `index.ts` re-exports `FOLDER_MIME_TYPE` / `SPREADSHEET_MIME_TYPE` / `DriveFileMetadata` / `DriveMetadataClient` only. Tests: `driveMetadata.service.test.ts` locks `fetchDriveFileMetadata` 404 vs 403 vs 503; `pickerValidation.test.ts` locks the three ownership asserts (wrong mime / trash / not owned) and leftover hash folds (the hash tests belong on leftover `destinationIdentity.ts`). Not this **interface**: already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended nonce find / consume, already-recommended selection persist / find / spend, already-recommended folder / probe-tab create, later managed-tab, leftover destination **choice**, leftover `refetchDriveFileMetadata`, Wave B Zod.
- Seams callers need: live-client factory vs leftover-already-holds-Drive (`createDriveMetadataClient` asks already-recommended live client; leftover janitor / denylist proof pass `drive_v3.Drive`); injected `DriveMetadataClient` (already-recommended picker tests / leftover destination) vs live factory; confirmed-gone 404 vs blocked refetch (403 / 401 / incomplete / integration — leftover janitor must not mark the run cleaned); assert-after-get (already-recommended picker remaps `BadRequestError` only; this file’s `NotFoundError` 404 is **not** an invalid pick); spreadsheet-id fold then folder-id fold (`normalizeDriveFileId`)
- Split later (only if the file outgrows one sitting): this ~220-line file is one sitting if you read it as get live Drive metadata for a known file id using the connected Owner client, map Google's HTTP failures so leftover janitor can tell a confirmed-gone file from a blocked refetch, and assert the file is still not trash, still owned by the connected account, still the expected folder or spreadsheet, and still in the expected parent when leftover destination asked, never create a file, never begin consent, never consume a ticket, never trust the Picker display name. If it later splits: `fetchLiveDriveFileMetadataForAKnownId.ts` / `classifyWhetherTheMetadataFailureIsAConfirmedGoneFileOrABlockedRefetch.ts` / `assertTheProvenPickStillHolds.ts` — story files, never `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `assert.ts`, and never merge already-recommended `picker.service.ts`, already-recommended `spreadsheet.service.ts`, already-recommended ticket stores, leftover `janitorCompletion.ts`, leftover `liveTestSecurity.ts`, leftover `driveAppProperties.ts`, or later `managedTab.service.ts` into this file

`createDriveMetadataClient` / `fetchDriveFileMetadata` / `assertDriveAccessible` / `assertDriveOwnedByConnectedUser` / `assertDriveMimeType` / `assertParentFolderRelationship` are executor mechanics. The owner question is: *Already-recommended verify just spent a nonce, or leftover destination is about to spend a selection reference, or leftover destination is re-proving a saved export folder / workbook, or leftover janitor is asking whether a harness container is gone. Fetch the file from Drive as the connected Owner. Fold a spreadsheet URL or a folder URL into an id first. If Google says 404, that is a confirmed-gone file — leftover janitor may treat the container as cleaned. If Google says 403, 401, incomplete fields, or a provider blip, leftover janitor must not pretend the folder vanished. If the get succeeds, assert the file is not in the trash, is owned by the connected account, is a folder or a spreadsheet as the caller asked, and still sits in the expected parent when leftover destination asked. Hand back id / name / mime / trash / url / parents / owned-by-me from **this** get. Do not create the file. Do not begin consent. Do not consume a nonce or a selection reference. Do not believe the Picker display name. Do not invent the company service account.*

Already-recommended Owner pick, already-recommended unused tickets, already-recommended Owner login, already-recommended token lock, already-recommended Owner Drive create, later managed-tab, leftover destination **choice**, leftover live-test app-property refetch, leftover operational-workbook denylist, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “get live Drive metadata for a known file id using the connected Owner client, map Google's HTTP failures so leftover janitor can tell a confirmed-gone file from a blocked refetch, and assert the file is still not trash, still owned by the connected account, still the expected folder or spreadsheet, and still in the expected parent when leftover destination asked — never create a file, never begin consent, never consume a ticket, never trust the Picker display name” story, not “a Drive CRUD helper,” and not the Owner pick / the unused tickets / leftover destination choice:

1. **Fetch live Drive file metadata for a known id** — `createDriveMetadataClient()` then `DriveMetadataClient.getFileMetadata(fileId)`, or leftover `fetchDriveFileMetadata(drive, rawFileId)` when the caller already holds Drive. Live factory asks already-recommended `getConnectedGoogleOAuthClient` (no row → already-recommended `NotFoundError` **before** Drive) and builds Drive v3. Both **adapters** fold `normalizeDriveFileId` (leftover `normalizeSpreadsheetId` first, then already-recommended `normalizeFolderId`; neither → `BadRequestError`). `files.get` with `id,name,mimeType,trashed,webViewLink,parents,ownedByMe` and `supportsAllDrives`. Missing `id` / `name` / `mimeType` → `NotFoundError` + `drive_incomplete_metadata` **inside** the try, rethrown as-is. Else `{ id, name, mimeType, trashed === true, url, parentFolderIds: parents ?? [], ownedByMe === true }`. Missing `webViewLink` synthesizes a folder URL when mime is folder, else a Sheets edit URL. HTTP 404 → `NotFoundError` + `drive_file_not_found` (“Re-authorize it through Picker.”). HTTP 403 → `UnauthorizedError` status 403 + `drive_access_denied`. HTTP 401 → `UnauthorizedError` + `drive_unauthorized`. Else `IntegrationError`. Already-recommended verify / consume / re-prove ask the factory or an injected client. Leftover janitor and leftover denylist proof ask the Drive-already-held **adapter**. This beat does **not** assert trash / owner / mime / parent. This beat does **not** spend a ticket.

2. **Classify whether the metadata failure is a confirmed-gone file or a blocked refetch** — `isDriveMetadataConfirmedNotFoundError(error)` is `NotFoundError` + `drive_file_not_found` only. `isDriveMetadataRefetchBlockedError(error)` is any `UnauthorizedError` (401 **and** 403), any `IntegrationError`, or `NotFoundError` + `drive_incomplete_metadata`. Leftover `mapDriveMetadataErrorToCleanupState` asks both: confirmed 404 → `cleaned_not_found`; blocked → `refetch_blocked`; anything else → throw. Leftover janitor must not mark a run cleaned on 403. This beat does **not** fetch. This beat does **not** treat trash as gone — leftover janitor reads `metadata.trashed` after a **successful** get.

3. **Assert the proven pick still holds** — four refuses after a successful get. `assertDriveAccessible`: `trashed` → `BadRequestError` (“in the trash”). `assertDriveOwnedByConnectedUser`: not `ownedByMe` → `BadRequestError` (“Reporting destinations must use files owned by the connected Google account.”). `assertDriveMimeType(metadata, folder | spreadsheet)`: wrong mime → folder or spreadsheet sentence. `assertParentFolderRelationship(metadata, expectedParentFolderId)`: already-recommended `normalizeFolderId` on the expected parent; missing / not in `parentFolderIds` → `BadRequestError` (“not in the authorized destination folder.”). Already-recommended picker asks accessible + owned + mime on every validate; parent only on consume / re-prove when leftover destination passed a folder. This beat does **not** fetch. This beat does **not** evaluate the operational-workbook denylist — already-recommended picker still asks leftover registry **after** these asserts.

There is no create operation. There is no consent operation. There is no ticket-consume operation. There is no denylist operation. Already-recommended `createGoogleDriveFolder` still creates. Already-recommended bootstrap still writes the nonce. Already-recommended consume still spends the selection reference. Later `evaluateReportingDestination` still refuses operational workbooks.

`getGoogleDriveHttpStatus` / `isGoogleDriveNotFoundHttpError` / `isGoogleDriveAccessDeniedHttpError` / `isGoogleDriveUnauthorizedHttpError` / `normalizeDriveFileId` are beats operation 1 already uses. They have **no** leftover runtime caller outside this file. They are not extra owner operations. `FOLDER_MIME_TYPE` / `SPREADSHEET_MIME_TYPE` / `DRIVE_METADATA_ERROR_REASON` / `DriveFileMetadata` / `DriveMetadataClient` are the vocabulary the three operations already share.

## Organization

Keep one file as the screenplay for “get live Drive metadata for a known file id using the connected Owner client, map Google's HTTP failures so leftover janitor can tell a confirmed-gone file from a blocked refetch, and assert the file is still not trash, still owned by the connected account, still the expected folder or spreadsheet, and still in the expected parent when leftover destination asked — never create a file, never begin consent, never consume a ticket, never trust the Picker display name.” Already-recommended `picker.service.ts`, already-recommended `spreadsheet.service.ts`, already-recommended ticket stores, leftover `janitorCompletion.ts`, leftover `liveTestSecurity.ts`, leftover `driveAppProperties.ts`, later `managedTab.service.ts`, and later `operationalWorkbooks` already live in deeper **modules**. Do not pull those in. Do not invent a `DriveMetadataService` class. Do not invent a ticket-consume **seam** here. Do not invent an app-property refetch **adapter** beside leftover `refetchDriveFileMetadata`. Do not invent a denylist **adapter** beside later `evaluateReportingDestination`. Do not invent a create **adapter** beside already-recommended `createGoogleDriveFolder`.

Do not split this into `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `assert.ts`. Those are HTTP verbs / Drive nouns, not the owner story. Do not move this into already-recommended `picker.service.ts` so “the pick can also fetch.” Do not move this into already-recommended `spreadsheet.service.ts` so “normalize can also get.” Do not move this into leftover `janitorCompletion.ts` so “cleanup owns 404.” Do not move this into leftover `liveTestSecurity.ts` so “one refetch.” Do not silently teach leftover janitor to call `assertDriveAccessible` so “trash is a BadRequest” and lose `cleaned_trashed`. Do not silently consume a ticket inside `getFileMetadata` so “a failed get cannot replay.”

**External interface** stays small (this is the test surface). Fetch, classify, and assert are one story’s live Drive proof, not six CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createDriveMetadataClient` | `openTheConnectedOwnerDriveMetadataClient` | already-recommended picker / leftover contract runner need a client from the live OAuth row |
| `fetchDriveFileMetadata` | `fetchLiveDriveFileMetadataForAKnownId` | leftover janitor / denylist proof already hold Drive; the client **adapter** is this same get |
| `isDriveMetadataConfirmedNotFoundError` | `thisMetadataFailureIsAConfirmedGoneFile` | leftover janitor may treat 404 as cleaned |
| `isDriveMetadataRefetchBlockedError` | `thisMetadataFailureMustNotBeTreatedAsGone` | leftover janitor must not complete on 403 / 401 / incomplete / integration |
| `assertDriveAccessible` | `refuseIfTheFileIsInTheTrash` | already-recommended picker / leftover destination re-prove |
| `assertDriveOwnedByConnectedUser` | `refuseIfTheConnectedOwnerDoesNotOwnTheFile` | reporting destinations must be the connected account’s |
| `assertDriveMimeType` | `refuseUnlessTheFileIsTheExpectedFolderOrSpreadsheet` | folder flow vs spreadsheet flow |
| `assertParentFolderRelationship` | `refuseUnlessTheSpreadsheetStillSitsInTheExpectedFolder` | leftover destination workbook consume / re-prove |
| `normalizeDriveFileId` | `readADriveFileIdFromASpreadsheetOrFolderUrlOrRawId` | fetch folds before Drive; tests can lock it without Google |
| `DriveMetadataClient` | `OwnerDriveMetadataClient` | injected **adapter** (tests / leftover destination) vs live factory |
| `DriveFileMetadata` | `LiveOwnerDriveFile` | id / name / mime / trash / url / parents / owned-by-me from **this** get |
| `FOLDER_MIME_TYPE` / `SPREADSHEET_MIME_TYPE` | keep | already-recommended picker views + asserts; leftover live tests import them |
| `DRIVE_METADATA_ERROR_REASON` | `OwnerDriveMetadataFailureReason` | leftover janitor constructs / matches `drive_reason` |

Keep the old names as one-line aliases until already-recommended picker, leftover janitor, leftover denylist proof, leftover contract runner, and the tests migrate. Do not make callers learn `files.get` / `supportsAllDrives` / `webViewLink` as the domain language.

**Principle: old exports stay as aliases.** `fetchDriveFileMetadata` remains the imported name until leftover janitor migrates. `createDriveMetadataClient` remains the imported name until already-recommended picker migrates. The four asserts remain the imported names until already-recommended validate / re-prove migrate.

**No class for the workflow.** `DriveMetadataClient` is an **adapter** **seam**, not a workflow class — keep it. The type that *does* earn a name is the live file already-recommended consume returns from **this** get:

```ts
type LiveOwnerDriveFile = {
  id: string
  name: string
  mimeType: string
  trashed: boolean
  url: string
  parentFolderIds: string[]
  ownedByMe: boolean
}
```

That is the handoff from “Drive answered” to “already-recommended picker may assert, leftover destination may show id / name / url, leftover janitor may read `trashed`.” Do **not** add `appProperties` so “leftover live-test refetch can die,” do **not** add `selection_reference` so “fetch can skip the ticket store,” and do **not** add `refresh_token` so “fetch can skip health.”

`getGoogleDriveHttpStatus` stays exported today because the three `isGoogleDrive*HttpError` helpers sit on it. Those helpers have no leftover runtime caller. Do not promote them to owner **seams** in this rename. Do not add `evaluateReportingDestination` as a public **seam** on this file — already-recommended picker already owns that ask. Do not add `refetchDriveFileMetadata` as a public **seam** on this file — leftover live-test security already owns the app-property get.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// driveMetadata.service.ts
// Already-recommended verify just spent a nonce,
// or leftover destination is about to spend a selection reference,
// or leftover destination is re-proving a saved export folder / workbook,
// or leftover janitor is asking whether a harness container is gone.
// Fetch the file from Drive as the connected Owner.
// Fold a spreadsheet URL or a folder URL into an id first.
// If Google says 404, that is a confirmed-gone file —
// leftover janitor may treat the container as cleaned.
// If Google says 403, 401, incomplete fields, or a provider blip,
// leftover janitor must not pretend the folder vanished.
// If the get succeeds, assert the file is not in the trash,
// is owned by the connected account,
// is a folder or a spreadsheet as the caller asked,
// and still sits in the expected parent
// when leftover destination asked.
// Hand back id / name / mime / trash / url / parents / owned-by-me
// from this get.
// Do not create the file.
// Do not begin consent.
// Do not consume a nonce or a selection reference.
// Do not believe the Picker display name.
// Do not invent the company service account.

// ── 1. Fetch live Drive file metadata for a known id ──────

export async function openTheConnectedOwnerDriveMetadataClient(): Promise<OwnerDriveMetadataClient>
// asks already-recommended getConnectedGoogleOAuthClient

export async function fetchLiveDriveFileMetadataForAKnownId(
  drive: drive_v3.Drive,
  rawFileId: string,
): Promise<LiveOwnerDriveFile>

function readADriveFileIdFromASpreadsheetOrFolderUrlOrRawId(rawFileId)
// leftover normalizeSpreadsheetId first; already-recommended normalizeFolderId second
function askDriveForTheLiveFile(drive, fileId)
// fields: id,name,mimeType,trashed,webViewLink,parents,ownedByMe
function refuseIncompleteMetadata(data)              // NotFoundError + INCOMPLETE
function synthesizeAUrlWhenDriveOmittedTheLink(data) // folder URL vs Sheets URL
function mapGooglesHttpFailure(error)
// 404 confirmed gone; 403 access denied; 401 unauthorized; else integration

// ── 2. Classify whether the metadata failure is a confirmed-gone file or a blocked refetch

export function thisMetadataFailureIsAConfirmedGoneFile(error: unknown): boolean
// NotFoundError + FILE_NOT_FOUND only

export function thisMetadataFailureMustNotBeTreatedAsGone(error: unknown): boolean
// UnauthorizedError (401 and 403) | IntegrationError | NotFoundError + INCOMPLETE

// ── 3. Assert the proven pick still holds ─────────────────

export function refuseIfTheFileIsInTheTrash(metadata: LiveOwnerDriveFile): void
export function refuseIfTheConnectedOwnerDoesNotOwnTheFile(metadata: LiveOwnerDriveFile): void
export function refuseUnlessTheFileIsTheExpectedFolderOrSpreadsheet(
  metadata: LiveOwnerDriveFile,
  expected: typeof FOLDER_MIME_TYPE | typeof SPREADSHEET_MIME_TYPE,
): void
export function refuseUnlessTheSpreadsheetStillSitsInTheExpectedFolder(
  metadata: LiveOwnerDriveFile,
  expectedParentFolderId: string,
): void
```

Read the primary path out loud: *Already-recommended verify already passed the API secret and the signed configured Drive Owner, spent the unused nonce, and asked this file for the file the Owner picked. Fold the id. Fetch Drive as the connected Owner. Incomplete fields are a blocked refetch, not a confirmed-gone file. A 404 is confirmed gone — leftover janitor may clean the run. A 403 is access denied, still a blocked refetch — leftover janitor must not mark the container gone. When the get succeeds, already-recommended picker asserts not trash, owned by the connected account, and the mime for this flow. Leftover destination workbook consume also asserts the live parent. Only then already-recommended picker spends the ticket and returns **this** get’s name and URL. The Picker display name never wins. This file never creates. This file never begins consent. This file never consumes a ticket.*

That is the operation. `assertDriveAccessible` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`createDriveMetadataClient` / `fetchDriveFileMetadata` / `assertDrive*` are executor mechanics.** The owner story is “open the connected Owner Drive metadata client” / “fetch live Drive file metadata for a known id” / “this failure is a confirmed-gone file” / “this failure must not be treated as gone” / “refuse if trash / not owned / wrong mime / wrong parent.” Keep the old names as aliases. Do not grow a `DriveMetadataService` with `get` / `assert`.

2. **Two fetch adapters are one get.** The factory asks already-recommended live client and wraps `fetchDriveFileMetadata`. Leftover janitor / denylist proof already hold Drive and skip the factory. Do not silently delete `fetchDriveFileMetadata` so “everyone must open a client” and force leftover janitor through OAuth again. Do not silently delete `createDriveMetadataClient` so “picker can construct google.drive” and lose the injected **adapter**. Do not silently boot Drive inside leftover janitor so “one client path.”

3. **404 is confirmed gone. 403 is not.** `isDriveMetadataConfirmedNotFoundError` is `FILE_NOT_FOUND` only. 403 is `UnauthorizedError` + `ACCESS_DENIED` and is refetch-blocked. Leftover `janitorCompletion.test.ts` locks that a 403 does not complete the run. Do not silently map 403 onto `NotFoundError` so “denied looks gone.” Do not silently treat `FILE_NOT_FOUND` as refetch-blocked so “janitor never cleans a 404.” Do not silently throw `BadRequestError` from the 404 map so “already-recommended picker can call it invalid_selection” — already-recommended picker remaps **non**-`BadRequestError` Drive misses to `picker_selection_unavailable`, and leftover janitor needs the `NotFoundError` + reason.

4. **Incomplete metadata is a NotFoundError that is not gone.** Missing `id` / `name` / `mimeType` throws `NotFoundError` + `INCOMPLETE` **before** the HTTP catch, then the catch rethrows `NotFoundError`. `isDriveMetadataRefetchBlockedError` matches that reason. `isDriveMetadataConfirmedNotFoundError` does not. Do not silently reuse `FILE_NOT_FOUND` for incomplete so “one not-found.” Do not silently return a partial `DriveFileMetadata` so “asserts can fail instead.” Today’s file test does not lock incomplete — add that on this **interface**.

5. **`assertDriveAccessible` only means not trash.** After a successful get, “accessible” is `trashed === false`. A 404 never reaches this function. Already-recommended picker tests call an injected client `inaccessible: true` and throw a bare `NotFoundError` (no `drive_reason`) — that is picker’s remap to `picker_selection_unavailable`, not this assert. Do not silently teach `assertDriveAccessible` to throw on 404. Do not silently rename leftover janitor’s `cleaned_trashed` to call this assert — leftover janitor wants trash as **cleaned**, not as `BadRequestError`.

6. **The owned-by-me sentence is reporting-shaped.** `assertDriveOwnedByConnectedUser` says “Reporting destinations must use files owned by the connected Google account.” Already-recommended picker verify uses the same refuse. Do not silently soften the sentence so “Picker can pick shared files.” Do not silently treat missing `ownedByMe` as true so “Drive omitted the field.” Today `ownedByMe === true` only; omitted is false.

7. **Parent assert uses live parents, not the stored snapshot.** Already-recommended consume asks `assertParentFolderRelationship(metadata, expectedParentFolderId)` on **this** get. Already-recommended selection store may have persisted `parent_folder_id` at verify time; leftover destination does not spend that field. `normalizeFolderId` on the expected parent throws `BadRequestError` for a bad charset **before** the includes check. Do not silently compare against stored parent so “we can skip Drive.” Do not silently skip normalize so “the caller already folded.” Do not silently require parent on folder flow — already-recommended consume only passes parent for spreadsheet.

8. **Id fold is two sibling folds, not one helper.** `normalizeDriveFileId` asks leftover `normalizeSpreadsheetId` (Sheets URL or 20+ charset id, else `undefined`) then already-recommended `normalizeFolderId` (folder URL or charset id; invalid charset **throws**). A short charset string that is not a spreadsheet id becomes a folder id. A Sheets URL never reaches the folder fold. Do not silently teach already-recommended `normalizeFolderId` to accept `/spreadsheets/d/{id}`. Do not silently move both folds into this file so “metadata owns ids” — already-recommended create tests already lock folder fold on `spreadsheet.service.ts`. Do not silently swallow the folder throw as `undefined` then throw a second `BadRequestError` with a different sentence.

9. **URL synthesis assumes folder or spreadsheet.** Missing `webViewLink` + folder mime → Drive folder URL. Anything else → Sheets edit URL. A future mime would get a Sheets URL and then fail `assertDriveMimeType`. Do not silently fetch `webViewLink` in a second Drive call so “we never synthesize.” Do not silently return `""` like leftover `refetchDriveFileMetadata` so “the two refetches match.”

10. **Mime constants are copied in siblings.** This file exports `FOLDER_MIME_TYPE` / `SPREADSHEET_MIME_TYPE`. Already-recommended `spreadsheet.service.ts` has private copies for create. Leftover `driveAppProperties.ts` exports `REPORTING_SPREADSHEET_MIME_TYPE`. Leftover `reportingLiveTest.ts` has `GOOGLE_FOLDER_MIME_TYPE`. Do not silently delete the private create copies so “one constant” and churn already-recommended create. Do not silently teach leftover reporting adapter to import this file’s spreadsheet mime in this rename.

11. **Leftover live-test refetch is a different get.** `liveTestSecurity.refetchDriveFileMetadata` asks the same fields **plus** `appProperties`, throws a raw `Error` on incomplete, and synthesizes `url: webViewLink ?? ""`. Leftover janitor uses **this** file’s fetch so 404 / 403 classify. Do not silently merge the two so “one refetch” and lose leftover trash-safety’s app-property markers. Do not silently add `appProperties` to `DriveFileMetadata` so “this file can replace leftover refetch.”

12. **HTTP status helpers have no leftover caller.** `getGoogleDriveHttpStatus` reads `code` / `status` / `response.status`. The three `isGoogleDrive*HttpError` helpers are only used inside `fetchDriveFileMetadata`. Do not invent an ops dashboard for them. Do not silently unexport them in this rename without a test that names why they were public. Do not silently treat a string `"404"` as 404 — today only a number matches.

13. **The barrel is a type/mime facade, not this interface.** Skipped `index.ts` re-exports mime + types only. Already-recommended picker, leftover janitor, and leftover denylist proof import this file. Do not silently add `fetchDriveFileMetadata` / the asserts to the barrel so “one import path.” Do not silently hide `DRIVE_METADATA_ERROR_REASON` behind the barrel.

14. **Already-recommended picker remaps this file’s errors.** `BadRequestError` from the four asserts → `picker_invalid_selection` and the ticket stays unused. Any other throw from the get (404 `NotFoundError`, 403 `UnauthorizedError`, `IntegrationError`, incomplete) → `picker_selection_unavailable` and the ticket stays unused. Do not silently throw `BadRequestError` from 404 so “verify can say invalid_selection.” Do not silently catch `UnauthorizedError` inside already-recommended picker in this rename — that remap stays on already-recommended picker’s **interface**.

15. **Leave sibling modules alone.** Already-recommended hand / verify / consume-reference / re-prove, already-recommended unused tickets, leftover SHA-256 folds, later managed-tab ownership marker, leftover destination Picker-vs-create-vs-export **choice**, leftover live-test app-property refetch, leftover janitor classify, already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended grant allowlist, already-recommended canned 403, already-recommended signed-owner gate, already-recommended folder / probe-tab create, and Wave B Zod stay where they are. This file orchestrates fold id → fetch live file → classify Google’s failure → (caller) assert the pick still holds.

## Testing

The **interface** is the test surface: the fetch / classify / assert exports (story names, old names as aliases), the live-client factory, the injected client type, the live-file type, and the failure reasons. Confirmed-gone vs blocked refetch, trash / owned / mime / parent refuse, “display name never returned from this file as leftover destination’s payload,” and “fetch never consumes a ticket” are part of that **interface**. Do not boot Google. Do not boot Drive. Prefer a mock `drive.files.get`. A live-client factory test is allowed only if it stubs already-recommended `getConnectedGoogleOAuthClient` and does not begin OAuth.

Today `driveMetadata.service.test.ts` locks 404 → confirmed-not-found `NotFoundError`, 403 → `UnauthorizedError` + `ACCESS_DENIED` + refetch-blocked, 503 → `IntegrationError` + refetch-blocked. `pickerValidation.test.ts` locks wrong mime / trash / not-owned. Leftover `janitorCompletion.test.ts` locks leftover classify of this file’s 404 vs 403 — those tests stay on leftover janitor’s **interface**. Already-recommended `pickerVerification.test.ts` locks consume-after-validate through an injected client — those tests stay on already-recommended picker’s **interface**. Add (or keep) file tests that name **this** operation:

**Fetch live Drive file metadata for a known id**
- Happy path returns id / name / mime / `trashed === false` / url / parents / `ownedByMe === true` from Drive’s body.
- Missing `webViewLink` + folder mime → Drive folder URL; missing `webViewLink` + spreadsheet mime → Sheets edit URL.
- Spreadsheet URL / 20+ raw id folds before Drive; folder URL folds after spreadsheet miss.
- Invalid id → `BadRequestError` and Drive is not called.
- Missing `id` / `name` / `mimeType` → `NotFoundError` + `INCOMPLETE`, and `thisMetadataFailureMustNotBeTreatedAsGone` is true.
- Does not call already-recommended nonce `consumeActive`.
- Does not call already-recommended selection `create` / `consumeActive`.
- Does not call already-recommended `createGoogleDriveFolder`.

**Classify whether the metadata failure is a confirmed-gone file or a blocked refetch**
- 404 `FILE_NOT_FOUND` → confirmed gone, not refetch-blocked.
- 403 `ACCESS_DENIED` → refetch-blocked, not confirmed gone.
- 401 `UNAUTHORIZED` → refetch-blocked, not confirmed gone.
- `INCOMPLETE` `NotFoundError` → refetch-blocked, not confirmed gone.
- `IntegrationError` → refetch-blocked.
- A raw `NotFoundError` without `drive_reason` is neither classifier (already-recommended picker’s injected `inaccessible` throw) — do not silently start matching every `NotFoundError`.

**Assert the proven pick still holds**
- Trash → `BadRequestError` /trash/.
- `ownedByMe: false` → `BadRequestError` /owned by the connected Google account/.
- Spreadsheet metadata asked as folder → `BadRequestError` /folder/.
- Folder metadata asked as spreadsheet → `BadRequestError` /spreadsheet/.
- Expected parent missing from `parentFolderIds` → `BadRequestError` /authorized destination folder/.
- Expected parent that fails already-recommended `normalizeFolderId` → `BadRequestError` (invalid folder id) and `includes` is not the sentence.
- Happy path asserts do not fetch Drive.

**Not this interface**
- Hand the Owner a one-time Picker / mint raw reference / remap to `picker_*` stay on already-recommended `picker.service.ts`.
- Unused nonce find / consume stay on already-recommended `pickerNonceStore.ts`.
- Persist / find / consume selection reference stay on already-recommended `pickerSelectionStore.ts`.
- SHA-256 ticket folds stay on leftover `destinationIdentity.ts` (`pickerValidation.test.ts` hash tests belong there).
- Leftover destination Picker-vs-create-vs-export **choice** stays on leftover `reportingDestination.service.ts`.
- Leftover janitor `cleaned_trashed` / `cleaned_not_found` / run complete stays on leftover `janitorCompletion.ts`.
- Leftover app-property refetch stays on leftover `liveTestSecurity.ts`.
- Put a folder / probe-tab workbook stays on already-recommended `spreadsheet.service.ts`.
- Begin / complete / live client / health stay on already-recommended `googleDriveOAuth.service.ts`.
- Later managed-tab ownership marker stays on later `managedTab.service.ts`.

Do **not** add a test per helper (`readADriveFileIdFromASpreadsheetOrFolderUrlOrRawId`, `synthesizeAUrlWhenDriveOmittedTheLink`, `refuseIncompleteMetadata`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file creates a Drive file — it must not. Do not add a test that this file begins OAuth — it must not. Do not add a test that this file consumes a nonce or a selection reference — it must not. Do not add a test that this file evaluates the operational-workbook denylist — it must not. Do not add a test that this file returns leftover destination’s `{ fileId, name, url }` without a caller assert — that return stays on already-recommended consume. Do not add a test that 403 is now confirmed gone — it must not. Do not add a test that incomplete is now `FILE_NOT_FOUND` — it must not. Do not add a test that leftover `refetchDriveFileMetadata` is now this function — it must not. Do not add a test that skipped `index.ts` now re-exports fetch / asserts — it must not, in this rename. Do not add a test that leftover destination now imports this file for fetch — it must not (it injects the client into already-recommended consume). Do not add a test that this file and leftover live-test refetch are now one class — it must not.

## What I would not do

- A `DriveMetadataService` class with `get` / `assert` / `create`.
- Thirty two-line functions that only wrap `files.get`.
- Moving this into a CRUD folder, or into already-recommended `picker.service.ts` / already-recommended `spreadsheet.service.ts` / leftover `janitorCompletion.ts` / leftover `liveTestSecurity.ts` “for cleanliness.”
- Breaking the live-client-vs-already-holds-Drive **seam**, the injected-client **seam**, the confirmed-gone-vs-blocked-refetch **seam**, the assert-after-get **seam**, or the leftover-destination-must-re-prove-Drive **seam**.
- Treating already-recommended `picker.service.ts` / already-recommended ticket stores / leftover `reportingDestination.service.ts` / leftover `janitorCompletion.ts` / leftover `liveTestSecurity.ts` / already-recommended `spreadsheet.service.ts` / later `managedTab.service.ts` as this story.
- Inventing a ticket-consume **seam** that has only one **adapter** here, or an app-property refetch **seam** that has only one **adapter** here, or a denylist **seam** that has only one **adapter** here.
- Silently mapping 403 to confirmed gone, or silently throwing `BadRequestError` from 404, or silently merging leftover `refetchDriveFileMetadata`, or silently consuming a ticket inside the get, or silently adding `appProperties` to the live-file type, or silently adding fetch / asserts to skipped `index.ts`.
- Writing a whole-folder recommendation that pretends later managed-tab / leftover reporting are this module.
- Opening `managedTab.service.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `fetchLiveDriveFileMetadataForAKnownId`.
