# Hand The Owner A One-Time Picker So They Can Pick An Existing Folder Or Spreadsheet In Their Drive As A Reporting Destination — Bootstrap Only If Drive Is Connected And The Token Is Healthy (Never Leak The Refresh Token), Verify The Pick Against Live Drive Metadata Then Consume The Nonce And Issue A One-Time Selection Reference, Later Consume That Reference Only After Metadata Still Holds (Parent Folder Optional; Operational Workbooks Fail Closed), Re-Prove A Known File The Same Way — Never Create A File, Never Begin Consent, Never Trust The UI Display Name — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 7 of this service — `picker.service.ts`
- Remaining in this service: `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` / `spreadsheet.service.ts` already recommended)
- Target: `src/services/googleDriveOAuth/picker.service.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this Picker file; leftover `reportingDestination.service.ts` **asks** this file to consume a selection reference, refuse a denylisted workbook, and re-prove a known folder / workbook). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — this file **asks** status + health, then hands Picker a short-lived access token; it does **not** begin or complete). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — this file never unlocks). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md) (fold + exact-set refuse — already-recommended health already refused before this file hands a token). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (canned 403 + JSON sanitize — Wave B `sendApiError` maps this file’s `BadRequestError`). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (Wave B mounts that middleware **in front** of bootstrap / verify; leftover reporting has its own Owner gate; this file never inspects `req`). Distinct from already-recommended Owner Drive create: [recommendations/google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md) (put a **new** folder or probe-tab workbook — leftover destination create-name asks that file; this file only picks an **existing** file). Distinct from skipped `workbook.service.ts` (one-line create facade). Distinct from later `pickerNonceStore.ts` / `pickerSelectionStore.ts` (find / consume / create adapters this file **asks**; bootstrap today writes the nonce model **itself**). Distinct from skipped `picker.types.ts` (`PickerFlow` only). Distinct from later `driveMetadata.service.ts` (get metadata / accessible / owned-by-me / mime / parent — this file **asks** those asserts; it does **not** own them). Distinct from later `managedTab.service.ts` (add / rename a reporting tab + ownership marker on an **already chosen** workbook). Distinct from leftover `reporting/destinationIdentity.ts` (`hashPickerNonce` / `hashPickerSelectionReference` / `expectedConfiguredOwnerEmail` — this file **asks** those folds). Distinct from later Wave A `operationalWorkbooks` (`evaluateReportingDestination` denylist — this file **asks** it on every spreadsheet beat). Distinct from leftover destination resolve (`resolveDestinationFolder` / `resolveDestinationWorkbook` — Picker consume vs create-name vs configured export folder; this file is only the pick **adapter**). Distinct from leftover reporting live harness (`livePickerContractRunner.ts` / `liveTestDenylistProof.ts` — they **ask** bootstrap / verify / consume; they do **not** own the story). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md). Distinct from Wave B `routes/google-drive-oauth.routes.ts` (`POST .../picker/bootstrap` and `POST .../picker/selections/verify` after secret + already-recommended owner gate — leftover destination create consumes the reference; there is **no** consume HTTP route). Distinct from Wave B `config/domain/googlePicker.ts` (`GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` — this file **asks** it). Distinct from Wave B `config/domain/reporting.ts` (10-minute nonce TTL / 15-minute selection TTL — this file **asks** those clocks). Distinct from Wave B `validation/v1/googleDriveOAuth.validation.ts` (flow / nonce / file id / unused display fields — this file does **not** Zod). Distinct from skipped barrel `index.ts` (re-exports bootstrap / verify / consume / allowlist only). This checkout’s `CONTEXT.md` does not define a Drive Picker / selection-reference term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **Wave B bootstrap / verify, leftover destination resolve / re-prove, plus two live harnesses. Tests live on this file and two siblings.** Wave B `routes/google-drive-oauth.routes.ts` — `POST .../picker/bootstrap` asks `bootstrapGooglePicker(flow)`; `POST .../picker/selections/verify` asks `verifyGooglePickerSelection({ selectionNonce, fileId, displayName, displayUrl, parentFolderId })` (the three display fields are **unused** here). Leftover `reporting/reportingDestination.service.ts` — `resolveDestinationFolder` asks `consumePickerSelectionReference({ flow: "folder" })` or already-recommended create or later `revalidateFolderMetadata(exportFolderId)`; `resolveDestinationWorkbook` asks `consumePickerSelectionReference({ flow: "spreadsheet", expectedParentFolderId })` or already-recommended create; `assertWorkbookNotDenylisted` + `revalidateSpreadsheetMetadata` on replace-tab create / update / verify; `revalidateFolderMetadata` on destination verify. Leftover `reporting/live/livePickerContractRunner.ts` and `liveTestDenylistProof.ts` ask bootstrap / verify / consume (and the allowlist). Barrel `index.ts` re-exports `bootstrapGooglePicker` / `verifyGooglePickerSelection` / `consumePickerSelectionReference` / `assertPickerBootstrapAllowlist` only. Tests: `pickerVerification.test.ts` locks verify / consume on injected stores + injected `DriveMetadataClient` (invalid metadata preserves nonce / reference; replay; concurrent winner; denylist fail-closed). `oauthHardening.test.ts` locks `assertPickerBootstrapAllowlist` refuses `refresh_token`. Leftover `reporting/live/liveTestReleaseSafety.test.ts` locks `validatePickerSelectionReferenceMetadata` parent mismatch **before** denylist. Not this **interface**: `pickerValidation.test.ts` locks later metadata asserts + leftover hash folds (it does **not** import this file). Not this **interface**: already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended fold / refuse, already-recommended sanitize, already-recommended signed-owner gate, already-recommended folder / probe-tab create, later nonce / selection **adapters**, later metadata get, later managed-tab create, leftover destination **choice**, leftover company Sheets write, Wave B Zod.
- Seams callers need: hand the Picker (admin bootstrap) vs verify the pick (admin verify) vs consume the one-time reference (leftover destination, **no** HTTP route); consume-nonce / consume-reference only **after** live metadata validates (invalid / denylist / Drive miss must leave the ticket unused); folder pick vs spreadsheet pick (mime + denylist + optional parent); re-prove a known id (export folder / destination update / verify) vs the one-time ticket dance; injected `DriveMetadataClient` (tests / leftover destination) vs later `createDriveMetadataClient`
- Split later (only if the file outgrows one sitting): this ~400-line file is one sitting if you read it as hand the Owner a one-time Picker so they can pick an existing folder or spreadsheet in their Drive as a reporting destination, bootstrap only if Drive is connected and the token is healthy (never leak the refresh token), verify the pick against live Drive metadata then consume the nonce and issue a one-time selection reference, later consume that reference only after metadata still holds (parent folder optional; operational workbooks fail closed), re-prove a known file the same way, never create a file, never begin consent, never trust the UI display name. If it later splits: `handTheOwnerAOneTimePicker.ts` / `verifyThePickAndIssueAOneTimeSelectionReference.ts` / `consumeTheOneTimeSelectionReference.ts` / `reProveAKnownOwnerDrivePick.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `bootstrap.ts` / `verify.ts` / `consume.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, already-recommended `spreadsheet.service.ts`, later `pickerNonceStore.ts`, later `pickerSelectionStore.ts`, later `driveMetadata.service.ts`, later `managedTab.service.ts`, leftover `reportingDestination.service.ts`, leftover `destinationIdentity.ts`, or later `operationalWorkbooks` into this file

`bootstrapGooglePicker` / `verifyGooglePickerSelection` / `consumePickerSelectionReference` / `revalidateSpreadsheetMetadata` are executor mechanics. The owner question is: *The Owner wants to point a reporting destination at an existing folder or spreadsheet in their Drive. They must not type a raw file id into leftover destination create and call it done. Hand the admin UI a Picker: API key, app id, a short-lived access token, and a one-time nonce — only if Drive is already connected and the token still refreshes. Never put the refresh token on that payload. After they pick, look up the unused unexpired nonce for the configured owner. Fetch the file from Drive as the connected Owner. Refuse if it is trash, not theirs, the wrong mime for this flow, or a denylisted operational workbook. Only then consume the nonce and issue a one-time selection reference. Later, leftover destination resolve spends that reference: fetch the file again, optionally assert it still sits in the expected parent folder, refuse the denylist again, and only then consume. Replay fails. Concurrent spenders yield one winner. A known export-folder or saved destination id re-proves the same ownership / mime / denylist rules without a ticket. Do not create the file. Do not begin consent. Do not believe the UI’s display name, display URL, or parent folder id. Do not invent the company service account.*

Already-recommended Owner login, already-recommended token lock, already-recommended grant allowlist, already-recommended public failure, already-recommended signed-owner HTTP gate, already-recommended Owner Drive create, later nonce / selection stores, later metadata get, later managed-tab, leftover destination **choice**, leftover hash folds, later operational-workbook denylist, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “hand the Owner a one-time Picker so they can pick an existing folder or spreadsheet in their Drive as a reporting destination — bootstrap only if Drive is connected and the token is healthy (never leak the refresh token), verify the pick against live Drive metadata then consume the nonce and issue a one-time selection reference, later consume that reference only after metadata still holds (parent folder optional; operational workbooks fail closed), re-prove a known file the same way — never create a file, never begin consent, never trust the UI display name” story, not “a Picker CRUD helper,” and not the Owner login / the folder create / leftover destination choice:

1. **Hand the Owner a one-time Picker** — `bootstrapGooglePicker(flow)`. Ask Wave B `getGooglePickerConfig` (missing API key / app id is a raw `Error`). Ask leftover `expectedConfiguredOwnerEmail`. Ask already-recommended `getGoogleDriveConnectionStatus` and `getGoogleDriveAccessTokenHealth` in parallel. Not connected → `BadRequestError` (“Complete the owner authorization first.”). Token unhealthy → `BadRequestError` (scope violation vs refresh failed — reconnect). Mint a 32-byte base64url nonce. Persist `GooglePickerNonce.create` with leftover `hashPickerNonce`, the configured owner email, the flow, and Wave B `REPORTING_PICKER_NONCE_TTL_MS` (10 minutes). Build `{ picker_api_key, picker_app_id, access_token, access_token_expires_at, flow, views, selection_nonce, connection_health }`. Folder flow views folder mime; spreadsheet flow views spreadsheet mime. Run `assertPickerBootstrapAllowlist` so a future field (especially `refresh_token`) cannot ship. Wave B `POST .../picker/bootstrap` asks this **seam**. Leftover live harness asks it too. This beat does **not** talk to Drive files. This beat does **not** use later `pickerNonceStore` — it writes the model itself.

2. **Verify the pick and issue a one-time selection reference** — `verifyGooglePickerSelection({ selectionNonce, fileId, driveClient? })`. Ask leftover owner email + hash. Later `getPickerNonceStore().findActive` — miss / expired / already used / wrong owner → `picker_invalid_nonce`. Fetch later `driveClient.getFileMetadata(fileId)` (injected or later `createDriveMetadataClient`). `validatePickerSelectionMetadata`: later accessible + owned-by-me + mime for the **nonce’s** flow; spreadsheet also asks later `evaluateReportingDestination` (not allowed → `BadRequestError`, remapped to `picker_invalid_selection`). Later metadata `BadRequestError` → `picker_invalid_selection` and the nonce stays unused. Any other Drive miss → `picker_selection_unavailable` and the nonce stays unused. Only then `consumeActive` — miss → `picker_invalid_nonce` (the concurrent-loser **seam**). Mint a 32-byte selection reference. Later `getPickerSelectionStore().create` with leftover `hashPickerSelectionReference`, 15-minute TTL, file id / mime / name / url from **Drive metadata**, and parent only on spreadsheet (`parentFolderIds[0]`). Return `{ selection_reference, expires_at, flow, file }` — no refresh token, no client secret. Wave B `POST .../picker/selections/verify` asks this **seam**. `displayName` / `displayUrl` / `parentFolderId` on the input are accepted and **ignored**.

3. **Consume the one-time selection reference** — `consumePickerSelectionReference({ reference, flow, expectedParentFolderId?, driveClient? })`. Later `getPickerSelectionStore().findActive` for hash + owner + **caller flow** — miss → `picker_invalid_reference`. Fetch metadata for the **stored** `file_id`. `validatePickerSelectionReferenceMetadata`: same accessible / owned / mime; spreadsheet + expected parent → later `assertParentFolderRelationship`; spreadsheet denylist again. Same remap: `BadRequestError` → `picker_invalid_selection` (reference unused); other Drive miss → `picker_selection_unavailable` (reference unused). Only then `consumeActive` — miss → `picker_invalid_reference`. Return `{ fileId, name, url, mimeType, parentFolderId }` from **this** fetch (`parentFolderIds[0]`, including folder flow). There is **no** HTTP route. Leftover `resolveDestinationFolder` / `resolveDestinationWorkbook` (Picker path) ask this **seam**. Leftover live harness asks it too.

4. **Re-prove a known folder or workbook is still a valid Owner pick** — `revalidateFolderMetadata(folderId)` / `revalidateSpreadsheetMetadata(spreadsheetId, folderId?)` / `assertWorkbookNotDenylisted(workbookId)`. No nonce. No selection reference. Spreadsheet first asks the denylist, then later get + accessible + owned + spreadsheet mime + optional parent. Folder asks get + accessible + owned + folder mime (no denylist). Leftover destination uses these when the export folder is the default parent, when a saved destination is updated or verified, and (again) after consume on replace-tab create. This beat does not persist.

There is no create-file operation. There is no consent operation. There is no destination-choice operation. Already-recommended folder / probe-tab create, already-recommended begin / complete, leftover `resolveDestinationFolder` Picker-vs-create-vs-export, later metadata get, and later managed-tab already live in other files.

`assertPickerBootstrapAllowlist` / `validatePickerSelectionMetadata` / `validatePickerSelectionReferenceMetadata` / `pickerSelectionVerificationError` / `pickerSelectionReferenceError` are beats the four operations already use. Tests and leftover live release-safety lock some of them. They are not extra owner operations. The test-store re-exports (`InMemoryPickerNonceStore`, `setPickerNonceStoreForTests`, `InMemoryPickerSelectionStore`, `setPickerSelectionStoreForTests`, `resetPickerVerificationStoresForTests`) are later-store **adapters** this file re-exports so `pickerVerification.test.ts` can import one path. They are not a sixth owner operation.

## Organization

Keep one file as the screenplay for “hand the Owner a one-time Picker so they can pick an existing folder or spreadsheet in their Drive as a reporting destination — bootstrap only if Drive is connected and the token is healthy (never leak the refresh token), verify the pick against live Drive metadata then consume the nonce and issue a one-time selection reference, later consume that reference only after metadata still holds (parent folder optional; operational workbooks fail closed), re-prove a known file the same way — never create a file, never begin consent, never trust the UI display name.” Already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, already-recommended `oauthScopes.ts`, already-recommended `oauthSecurity.ts`, already-recommended `ownerAuth.ts`, already-recommended `spreadsheet.service.ts`, later `pickerNonceStore.ts`, later `pickerSelectionStore.ts`, later `driveMetadata.service.ts`, later `managedTab.service.ts`, leftover destination resolve, leftover `destinationIdentity.ts`, later `operationalWorkbooks`, and Wave B Zod already live in deeper **modules**. Do not pull those in. Do not invent a `PickerService` class. Do not invent a persist / finalize **seam** here besides the two one-time tickets this story already writes. Do not invent a create-file **adapter** beside already-recommended `createGoogleDriveFolder`. Do not invent a metadata-get **adapter** beside later `createDriveMetadataClient`. Do not invent a destination-choice **adapter** beside leftover `resolveDestinationFolder`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `bootstrap.ts` / `verify.ts` / `consume.ts`. Those are HTTP verbs / Picker nouns, not the owner story. Do not move this into already-recommended `googleDriveOAuth.service.ts` so “the login can also pick.” Do not move this into already-recommended `spreadsheet.service.ts` so “Drive writes live together.” Do not move this into leftover `reportingDestination.service.ts` so “destinations own Picker.” Do not move this into later `driveMetadata.service.ts` so “asserts can also issue tickets.” Do not silently trust `displayName` / `displayUrl` / `parentFolderId` so “we can skip a Drive get.” Do not silently consume the nonce before metadata validates so “we cannot replay a bad pick.”

**External interface** stays small (this is the test surface). Bootstrap, verify, consume, and re-prove are one story’s Owner pick, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `bootstrapGooglePicker` | `handTheOwnerAOneTimePicker` | Wave B bootstrap and leftover live harness need the allowlisted Picker payload + nonce |
| `assertPickerBootstrapAllowlist` | `refuseAPickerPayloadThatCouldLeakSecrets` | tests lock `refresh_token` without booting Google |
| `verifyGooglePickerSelection` | `verifyThePickAndIssueAOneTimeSelectionReference` | Wave B verify needs `{ selection_reference, file }` after a consumed nonce |
| `consumePickerSelectionReference` | `consumeTheOneTimeSelectionReference` | leftover destination Picker path needs `{ fileId, name, url }` after a consumed reference |
| `revalidateFolderMetadata` | `reProveAKnownOwnerFolderPick` | leftover export-folder default and destination verify need a folder id without a ticket |
| `revalidateSpreadsheetMetadata` | `reProveAKnownOwnerWorkbookPick` | leftover destination update / verify need a workbook id + optional parent without a ticket |
| `assertWorkbookNotDenylisted` | `refuseADenylistedOperationalWorkbook` | leftover destination also asks this beat without a full re-prove |
| `validatePickerSelectionMetadata` | `refuseAnUnfitPickerPick` | verify’s metadata beat; leftover live may lock it later |
| `validatePickerSelectionReferenceMetadata` | `refuseAnUnfitSelectionReference` | consume’s metadata beat + optional parent; leftover live release-safety already locks parent mismatch |
| `PickerBootstrapResponse` | `OneTimePickerForTheOwner` | the allowlisted handoff to the admin UI |
| `VerifiedPickerSelection` | `OneTimeSelectionReference` | the handoff from verify to leftover destination create |
| `PickerFlow` | `OwnerPickKind` | `"folder" \| "spreadsheet"` — skipped type file already owns the alias |

Keep the old names as one-line aliases until Wave B routes, leftover destination, leftover live harness, and the tests migrate. Do not make callers learn `GooglePickerNonce.create` / `findActive` / `evaluateReportingDestination` as the domain language.

**Principle: old exports stay as aliases.** `bootstrapGooglePicker` remains the imported name until Wave B bootstrap points at the story name. `verifyGooglePickerSelection` / `consumePickerSelectionReference` remain the imported names until Wave B verify and leftover destination migrate.

**No class for the workflow.** The type that *does* earn a name is the one-time selection reference this file hands leftover destination after the nonce is spent:

```ts
type OneTimeSelectionReference = {
  selection_reference: string
  expires_at: string
  flow: OwnerPickKind
  file: {
    id: string
    name: string
    mime_type: string
    url: string
    parent_folder_id?: string
  }
}
```

That is the handoff from “the Owner picked in Google Picker” to “leftover destination may spend this ticket once.” Do **not** add `refresh_token` so “destination can skip health,” do **not** add `display_name` so “verify can skip Drive,” and do **not** add `ownedByMe` so “this file can skip later metadata.”

`validatePickerSelectionMetadata` stays a named export because leftover live / future tests lock the beat without booting stores. Do not add `getConnectedGoogleOAuthClient` as a public **seam** on this file — already-recommended `googleDriveOAuth.service.ts` already owns the live client; this file asks status + health, and later metadata asks the client. Do not add `createGoogleDriveFolder` as a public **seam** on this file — already-recommended `spreadsheet.service.ts` already owns create.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// picker.service.ts
// The Owner wants to point a reporting destination at an
// existing folder or spreadsheet in their Drive.
// They must not type a raw file id and call it done.
// Hand the admin UI a Picker: API key, app id,
// a short-lived access token, and a one-time nonce —
// only if Drive is already connected and the token still refreshes.
// Never put the refresh token on that payload.
// After they pick, look up the unused unexpired nonce.
// Fetch the file from Drive as the connected Owner.
// Refuse if it is trash, not theirs, the wrong mime,
// or a denylisted operational workbook.
// Only then consume the nonce and issue a one-time selection reference.
// Later, leftover destination spends that reference:
// fetch again, optionally assert the parent folder,
// refuse the denylist again, and only then consume.
// Replay fails. Concurrent spenders yield one winner.
// A known export-folder or saved destination id
// re-proves the same rules without a ticket.
// Do not create the file.
// Do not begin consent.
// Do not believe the UI’s display name.

// ── 1. Hand the Owner a one-time Picker ───────────────────

export async function handTheOwnerAOneTimePicker(
  flow: OwnerPickKind,
): Promise<OneTimePickerForTheOwner>

async function refuseUnlessOwnerDriveIsConnectedAndHealthy()
// already-recommended status + health; not connected / unhealthy → BadRequestError
function rememberAOneTimePickerNonce(nonce, ownerEmail, flow)  // 10-minute hash row
function nameThePickerViews(flow)                             // folder mime or spreadsheet mime
export function refuseAPickerPayloadThatCouldLeakSecrets(payload)

// ── 2. Verify the pick and issue a one-time selection reference

export async function verifyThePickAndIssueAOneTimeSelectionReference(input: {
  selectionNonce: string
  fileId: string
  driveClient?: DriveMetadataClient
}): Promise<OneTimeSelectionReference>

async function findTheUnusedPickerNonce(nonce, ownerEmail)    // miss → picker_invalid_nonce
async function fetchThePickedFileAsTheOwner(fileId, client)
export function refuseAnUnfitPickerPick({ metadata, flow })
// accessible + owned-by-me + mime; spreadsheet → denylist
function remapAFailedPick(error)                              // BadRequest → invalid_selection; else unavailable
async function consumeTheNonceOnlyAfterThePickHolds(nonce)    // miss → picker_invalid_nonce (concurrent loser)
async function rememberAOneTimeSelectionReference(file, flow) // 15-minute hash row; parent only on spreadsheet

// ── 3. Consume the one-time selection reference ───────────

export async function consumeTheOneTimeSelectionReference(input: {
  reference: string
  flow: OwnerPickKind
  expectedParentFolderId?: string
  driveClient?: DriveMetadataClient
}): Promise<OwnerDrivePick>

async function findTheUnusedSelectionReference(reference, ownerEmail, flow)
export function refuseAnUnfitSelectionReference({
  metadata,
  flow,
  expectedParentFolderId,
})
// same asserts + optional parent on spreadsheet + denylist
async function consumeTheReferenceOnlyAfterThePickStillHolds(reference)

// ── 4. Re-prove a known folder or workbook ────────────────

export async function reProveAKnownOwnerFolderPick(folderId, driveClient?)
export async function reProveAKnownOwnerWorkbookPick(
  spreadsheetId,
  folderId?,
  driveClient?,
)
export async function refuseADenylistedOperationalWorkbook(workbookId)
```

Read the primary path out loud: *The Owner dashboard just called picker bootstrap. The route already passed the API secret and the signed configured Drive Owner. Ask already-recommended status and health — if Drive is down or the token will not refresh, fail before handing a token. Persist a hashed nonce for ten minutes. Hand the UI the Picker API key, app id, short-lived access token, and the raw nonce. After they pick a file, Wave B verify sends the nonce and the file id. Look up the unused nonce. Fetch the file from Drive. Refuse trash, not-owned, wrong mime, or a Master-Leads-class operational workbook. Only then consume the nonce and issue a one-time selection reference. Leftover destination create later spends that reference: fetch again, optionally assert the parent folder, refuse the denylist again, and only then consume. A second spend fails. Two spends at once yield one winner. The UI’s display name never wins over Drive. This file never creates a folder. This file never begins consent. This file never invents the company service account.*

That is the operation. `bootstrapGooglePicker` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`bootstrapGooglePicker` / `verifyGooglePickerSelection` / `consumePickerSelectionReference` are executor mechanics.** The owner story is “hand the Owner a one-time Picker” / “verify the pick and issue a one-time selection reference” / “consume the one-time selection reference.” Keep the old names as aliases. Do not grow a `PickerService` with `bootstrap` / `verify` / `consume`.

2. **Consume-after-validate is a load-bearing seam.** Tests lock it on both tickets: wrong mime, trashed, inaccessible, and denylist leave `consumed_at` null and create no selection row. Concurrent valid verify / consume yield one winner (`picker_invalid_nonce` / `picker_invalid_reference`). Do not silently consume the nonce first so “a bad pick cannot retry.” Do not silently leave a selection row after a failed consume so “ops can inspect.” Do not silently treat denylist configuration miss as `selection_unavailable` — today it is `BadRequestError` → `picker_invalid_selection` and the ticket stays.

3. **Bootstrap writes the nonce model; verify reads the store.** Operation 1 calls `GooglePickerNonce.create` after `connectMongo`. Operations 2 and 3 ask later `getPickerNonceStore` / `getPickerSelectionStore`. Injected in-memory stores therefore cannot cover bootstrap. Do not silently switch bootstrap to the store in this rename without a bootstrap test on the **interface**. Do not silently teach verify to `findOne` the model so “one persistence path” and break the injected-store tests. Later `pickerNonceStore.ts` is the next unchecked module — leave the write/read split visible.

4. **The UI display fields are accepted and ignored.** Wave B Zod parses `display_name` / `display_url` / `parent_folder_id`. The verify signature accepts them. The function never reads them. File name, URL, and parent come from later metadata. Do not silently prefer `displayName` so “we can skip a Drive get.” Do not silently assert `parentFolderId` on verify so “parent is checked twice” — parent assert is consume’s spreadsheet beat (`expectedParentFolderId` from leftover destination’s already-resolved folder). Do not silently delete the unused args in this rename without keeping the Wave B route compiling via aliases.

5. **Two validate functions are one story with one extra parent beat.** `validatePickerSelectionMetadata` and `validatePickerSelectionReferenceMetadata` copy accessible / owned / mime / denylist. Consume adds `assertParentFolderRelationship` when the flow is spreadsheet and a parent was expected. Leftover live release-safety locks “parent mismatch fails **before** denylist.” Do not silently merge them so “one validate” and lose that order. Do not silently run denylist before parent so “we can skip a Drive parent look.” Do not silently add parent assert to verify so “verify can fail closed on parent” — Wave B verify does not pass a trusted parent.

6. **Denylist is spreadsheet-only and fail-closed.** Folder picks never ask `evaluateReportingDestination`. A denylisted workbook (or a registry that cannot prove the env id) throws `BadRequestError` and preserves the ticket. Leftover destination also asks `assertWorkbookNotDenylisted` **again** after consume / on update / on verify, and `revalidateSpreadsheetMetadata` asks it a third time. Do not silently skip the leftover extra calls so “one denylist.” Do not silently denylist folders so “all picks are safe.” Do not silently allow a Master Leads id because “the Owner picked it in Google.”

7. **Folder vs spreadsheet is the flow on the ticket, not the UI mime.** Bootstrap stores `flow` on the nonce. Verify uses the **nonce’s** flow, not a caller-supplied flow. Consume requires the caller flow to match the stored selection. A folder nonce plus a spreadsheet file is `picker_invalid_selection` and the nonce stays. Do not silently take `input.flow` on verify so “the UI can change its mind.” Do not silently skip mime because “Picker already filtered views.”

8. **Health miss is `BadRequestError`, not already-recommended `NotFoundError`.** Already-recommended create asks live client and lets `NotFoundError` (“Complete the owner authorization first.”) escape outside the Drive `try`. This file asks status + health and throws `BadRequestError` with the same sentence. Do not silently switch bootstrap to `getConnectedGoogleOAuthClient` so “one miss type” — Wave B sanitize / leftover `requireActiveGoogleConnection` already treat this as 400. Do not silently hand a token when `connected` is true but `healthy` is false.

9. **Allowlist is the leak fence.** `assertPickerBootstrapAllowlist` throws a raw `Error` on any extra key. Tests lock `refresh_token`. `pickerVerification.test.ts` also `doesNotMatch` verify / consume JSON for `refresh_token|client_secret`. Do not silently add `refresh_token` “for the live harness.” Do not silently return `tokenHealth` wholesale. Do not silently put `owner_email` on the payload.

10. **Leave sibling modules alone.** Already-recommended begin / complete / live client / health, already-recommended lock / unlock, already-recommended fold / refuse, already-recommended canned 403 / JSON sanitize, already-recommended signed-owner gate, already-recommended folder / probe-tab create, later nonce / selection adapters, later metadata get / mime / parent, later managed-tab ownership marker, leftover destination Picker-vs-create-vs-export **choice**, leftover hash folds, later operational-workbook registry, and Wave B Zod stay where they are. This file orchestrates status+health → nonce → (later) metadata get → consume ticket → selection reference → (later) consume reference.

## Testing

The **interface** is the test surface: the bootstrap / verify / consume / re-prove / denylist / allowlist / validate exports (story names, old names as aliases) plus the two handoff types. Consume-after-validate, concurrent one-winner, denylist fail-closed, allowlist, and “UI display fields do not win” are part of that **interface**. Do not boot Google. Do not boot Mongo. Inject later stores and later `DriveMetadataClient`.

Today `pickerVerification.test.ts` locks verify / consume: invalid mime / inaccessible preserve the ticket; replay after success; concurrent winner; denylist preserves reference until it clears; denylist configuration miss preserves reference. `oauthHardening.test.ts` locks allowlist vs `refresh_token`. Leftover `liveTestReleaseSafety.test.ts` locks consume’s parent-mismatch-before-denylist beat. Those tests belong on this **interface**. `pickerValidation.test.ts` locks later `assertDriveMimeType` / `assertDriveAccessible` / `assertDriveOwnedByConnectedUser` and leftover `hashPickerNonce` — those belong on later `driveMetadata.service.ts` / leftover `destinationIdentity.ts`, not this **interface**. Add (or keep) file tests that name the operation:

**Hand the Owner a one-time Picker**
- Allowlist accepts the eight known keys (today).
- Allowlist throws on `refresh_token` (today).
- Not connected / unhealthy token → `BadRequestError` (do not boot Google; stub already-recommended status + health if you add this).
- Bootstrap persist is a hashed nonce for the configured owner and the requested flow — not the raw nonce, not the refresh token.

**Verify the pick and issue a one-time selection reference**
- Wrong mime / inaccessible / not-owned leave `consumed_at` null and create no selection (today).
- Replay after success is `picker_invalid_nonce` (today).
- Concurrent valid verifies yield one `selection_reference` (today).
- Returned JSON does not contain `refresh_token` or `client_secret` (today).
- `displayName` / `displayUrl` / `parentFolderId` do not override Drive metadata.

**Consume the one-time selection reference**
- Wrong mime / trashed / inaccessible / denylist leave `consumed_at` null (today).
- Replay after success is `picker_invalid_reference` (today).
- Concurrent valid consumes yield one winner (today).
- Spreadsheet parent mismatch fails before denylist (today, leftover live).
- Caller `flow` must match the stored selection.

**Re-prove a known folder or workbook**
- Spreadsheet asks denylist then owned / mime / optional parent.
- Folder does not ask denylist.
- No nonce or selection row is written.

**Not this interface**
- Begin / complete / status / disconnect / live client / health stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Exact-set refuse stays on already-recommended `oauthScopes.ts`.
- Canned 403 / JSON sanitize stay on already-recommended `oauthSecurity.ts`.
- Signed-owner HTTP gate stays on already-recommended `ownerAuth.ts`.
- Folder / probe-tab create stay on already-recommended `spreadsheet.service.ts`.
- `findActive` / `consumeActive` / `create` stay on later `pickerNonceStore.ts` / `pickerSelectionStore.ts`.
- Metadata get / mime / owned-by-me / parent stay on later `driveMetadata.service.ts`.
- Managed-tab ownership marker stays on later `managedTab.service.ts`.
- Destination Picker vs create-name vs export-folder **choice** stays on leftover `reportingDestination.service.ts`.
- SHA-256 nonce / reference folds stay on leftover `destinationIdentity.ts`.
- Registered operational workbook ids stay on later `operationalWorkbooks`.
- Wave B Zod display fields stay on the validation module.

Do **not** add a test per helper (`rememberAOneTimePickerNonce`, `remapAFailedPick`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file decrypts `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — already-recommended health does that. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that verify now trusts `displayName` — it must not. Do not add a test that bootstrap now returns `refresh_token` — it must not. Do not add a test that a denylisted Master Leads pick is consumed “so the Owner can override” — it must not. Do not add a test that this file now mounts already-recommended owner middleware — it must not. Do not add a test that this file begins OAuth — it must not. Do not add a test that this file calls already-recommended `createGoogleDriveFolder` — it must not. Do not add a test that leftover destination choice now lives in this file — it must not.

## What I would not do

- A `PickerService` class with `bootstrap` / `verify` / `consume` / `revalidate`.
- Thirty two-line functions that only wrap `findActive` / `getFileMetadata`.
- Moving this into a CRUD folder, or into already-recommended `googleDriveOAuth.service.ts` / already-recommended `spreadsheet.service.ts` / later `driveMetadata.service.ts` / leftover `reportingDestination.service.ts` / later store files “for cleanliness.”
- Breaking the consume-after-validate **seam**, the concurrent-one-winner **seam**, the denylist-fail-closed **seam**, the allowlist **seam**, or the Drive-metadata-wins-over-UI **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / already-recommended `tokenEncryption.ts` / already-recommended `oauthScopes.ts` / already-recommended `oauthSecurity.ts` / already-recommended `ownerAuth.ts` / already-recommended `spreadsheet.service.ts` / later `pickerNonceStore.ts` / later `pickerSelectionStore.ts` / later `driveMetadata.service.ts` / later `managedTab.service.ts` / leftover destination choice / leftover hash folds as this story.
- Inventing a create-file **seam** that has only one **adapter** here, or a destination-choice **seam** that has only one **adapter** here, or a metadata-get **seam** that has only one **adapter** here.
- Silently trusting the UI display name, or silently consuming a ticket before metadata validates, or silently handing a refresh token, or silently skipping denylist because the Owner picked in Google, or silently creating a folder from bootstrap, or silently beginning consent from Picker.
- Writing a whole-folder recommendation that pretends later stores / metadata / managed-tab / leftover reporting are this module.
- Opening `pickerNonceStore.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `handTheOwnerAOneTimePicker`.
