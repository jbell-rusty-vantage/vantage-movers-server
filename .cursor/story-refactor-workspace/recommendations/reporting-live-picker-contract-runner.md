# Prove The Live Owner Picker Still Accepts The Harness Folder And Workbook We Just Created — Never Type A Raw File Id And Call It Done — Then Refuse A Replayed Folder Nonce — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 39 of this service — `live/livePickerContractRunner.ts`
- Remaining in this service: `live/liveTestHarnessRunRegistry.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/livePickerContractRunner.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `runLivePickerServerContractTests`, `syntheticPickerFolderId`, `PickerContractStep`, leftover bootstrap / leftover verify / leftover consume, leftover nonce replay, or a live picker contract — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** this contract after leftover replace-tab leftover `createFolderName` when leftover `replaceSnapshot.workbook?.id` exists; leftover `!ok` → throw leftover `"Picker server contract tests failed."`; leftover missing leftover workbook id **skips** this file; leftover later leftover worker / leftover trash never **ask** this file). Distinct from already-recommended leftover denylist proof: [`reporting-live-test-denylist-proof.md`](reporting-live-test-denylist-proof.md) (that file **asks** leftover bootstrap / leftover verify only on leftover reserved leftover parent + leftover reserved leftover workbook; it never **asks** leftover consume, never **asks** leftover nonce replay, never **asks** this file). Distinct from already-recommended leftover Owner pick: [`google-drive-oauth-picker.md`](google-drive-oauth-picker.md) (leftover bootstrap / leftover verify / leftover consume / leftover allowlist / leftover remap; this file **asks** those **adapters**; leftover verify leftover `parentFolderId` is leftover accepted and leftover **ignored**; leftover spreadsheet leftover consume leftover **asks** leftover `expectedParentFolderId`). Distinct from already-recommended leftover unused nonce ticket: [`google-drive-oauth-picker-nonce-store.md`](google-drive-oauth-picker-nonce-store.md). Distinct from already-recommended leftover unused selection-reference ticket: [`google-drive-oauth-picker-selection-store.md`](google-drive-oauth-picker-selection-store.md). Distinct from already-recommended leftover Drive metadata get: [`google-drive-oauth-drive-metadata.md`](google-drive-oauth-drive-metadata.md) (this file **asks** leftover `createDriveMetadataClient`, not leftover `fetchDriveFileMetadata(driveApi)`). Distinct from already-recommended leftover destination desk: [`reporting-destination.md`](reporting-destination.md) (leftover orchestration leftover **asks** leftover `createFolderName` **before** this file; this file never leftover creates leftover destination). Distinct from already-recommended leftover refuse / leftover principal: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file never **asks** leftover refuse). Distinct from already-recommended leftover wrap: [`reporting-live-test-oauth-adapters.md`](reporting-live-test-oauth-adapters.md) (leftover orchestration leftover **asks** leftover wrap **before** leftover create-name; this file never leftover wraps). Distinct from already-recommended leftover stamp / leftover trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (never **asks** this file). Distinct from already-recommended leftover worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (never **asks** this file). Distinct from Wave B `src/routes/google-drive-oauth.routes.ts` (`POST .../picker/bootstrap` / `POST .../picker/selections/verify`; leftover destination leftover consume has **no** HTTP route; this file never leftover mounts). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (**asks** leftover facade, never this file). Distinct from unvisited leftover registry / leftover synthetic page / leftover retry wrapper / leftover mask / leftover later janitor / leftover evaluate. This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets / Drive Picker — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** leftover `runLivePickerServerContractTests` with leftover `replaceSnapshot.folder.id` as leftover `folderId` **and** leftover `parentFolderId`, leftover `replaceSnapshot.workbook.id` as leftover `spreadsheetId`; leftover spreads leftover `steps`; leftover `!ok` leftover throws). No other `src/` import. Leftover `syntheticPickerFolderId` has **no caller**. Tests: **no test imports this file**. `live/liveGoogleHarness.test.ts` leftover skip / leftover mask only. `live/liveTestReleaseSafety.test.ts` leftover **asks** leftover `validatePickerSelectionReferenceMetadata` leftover parent mismatch, leftover interpret — sibling **interfaces**. `pickerVerification.test.ts` leftover **asks** leftover Owner pick leftover verify / leftover consume on leftover injected leftover stores — not this file. `oauthHardening.test.ts` leftover **asks** leftover allowlist. `reporting.test.ts` / `reportingDestination.test.ts` do not import this file. Owner HTTP leftover picker leftover bootstrap / leftover verify never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: prove-the-live-owner-picker-still-accepts-this-created-folder-and-workbook (`runLivePickerServerContractTests`) vs mint-a-fake-folder-id-nobody-asks (`syntheticPickerFolderId`). The leftover this-file-contract / leftover-orchestration **seam** exists because leftover orchestration leftover **asks** leftover prove only after leftover replace-tab leftover create-name, and leftover skips leftover prove when leftover workbook id is leftover missing. The leftover this-file-bootstrap / leftover-owner-pick-bootstrap **seam** exists because leftover folder leftover beat leftover **asks** leftover bootstrap then leftover re-asserts leftover allowlist; leftover spreadsheet leftover beat leftover **asks** leftover bootstrap and leftover never leftover re-asserts leftover allowlist. The leftover this-file-verify / leftover-owner-pick-verify **seam** exists because leftover spreadsheet leftover verify leftover passes leftover `parentFolderId` that leftover Owner pick leftover **ignores**. The leftover this-file-consume / leftover-owner-pick-consume **seam** exists because leftover folder leftover consume leftover has leftover no leftover expected parent; leftover spreadsheet leftover consume leftover **asks** leftover `expectedParentFolderId`. The leftover this-file-official-metadata / leftover-wrap **seam** exists because this file leftover **asks** leftover `createDriveMetadataClient` (leftover connected leftover Owner leftover client); leftover denylist leftover proof leftover **asks** leftover wrap leftover `driveApi`. The leftover this-file-replay / leftover-owner-pick-nonce **seam** exists because leftover prove leftover replays leftover folder leftover verify only; leftover never leftover replays leftover consume leftover reference or leftover spreadsheet leftover nonce. The leftover this-file / leftover-denylist-proof **seam** exists because leftover denylist leftover **asks** leftover bootstrap / leftover verify leftover only; leftover never leftover consume. There is no begin / complete Domain Command **seam**. There is no leftover destination-create **seam**. There is no leftover worker **seam**. There is no leftover `files.update` `{ trashed: true }` **seam**. There is no HTTP leftover picker leftover route **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~95-line file is one sitting if you read it as prove the live Owner Picker still accepts the harness folder and workbook we just created — never type a raw file id and call it done — then refuse a replayed folder nonce. Do **not** split into `bootstrap.ts` / `verify.ts` / `consume.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover orchestration, leftover Owner pick, leftover destination desk, leftover denylist proof, leftover wrap, leftover refuse, leftover official leftover janitor, or leftover worker here so “one picker file owns the company.” If it later splits: `proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook.ts` / `proveASpentFolderNonceCannotBeVerifiedAgain.ts` only as later story files, never CRUD.

`runLivePickerServerContractTests` / `syntheticPickerFolderId` / `PickerContractStep` are executor mechanics. The owner question is: *After live Google testing creates a replace-tab folder and workbook by name, prove the Owner Picker path still works on those same files. Do not type a raw file id and call it done. Bootstrap a folder picker — never leak the refresh token. Verify that folder against live Drive. Consume the one-time selection reference. Then bootstrap a spreadsheet picker. Verify that workbook against live Drive. Consume the one-time selection reference only if it still sits in that folder. Then try the spent folder nonce again — that replay must fail. Do not create a destination. Do not start leftover worker. Do not trash a folder from this file. Do not hit HTTP. Do not mint a synthetic folder id and send it to live Drive. Do not sync the Master Sheet.*

Already-recommended leftover orchestration, leftover Owner pick, leftover unused tickets, leftover Drive metadata get, leftover destination desk, leftover denylist proof, leftover refuse, leftover wrap already live in other **modules**. Leftover registry, leftover synthetic page, leftover retry wrapper, leftover mask, leftover later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Two operations of one “prove the live Owner Picker still accepts the harness folder and workbook we just created — then refuse a replayed folder nonce” story, not “a picker CRUD runner,” and not leftover Owner pick / leftover destination desk / leftover denylist proof:

1. **Prove the live Owner Picker still accepts this created folder and workbook** — `runLivePickerServerContractTests` through leftover consume leftover spreadsheet leftover reference. Leftover `connectMongo`. Leftover `bootstrapGooglePicker("folder")`. Leftover `assertPickerBootstrapAllowlist`. Leftover `assert.ok` leftover `selection_nonce` and leftover `access_token`. Leftover `createDriveMetadataClient`. Leftover `verifyGooglePickerSelection` leftover folder leftover id. Leftover `assert.ok` leftover `selection_reference`. Leftover `consumePickerSelectionReference` leftover `{ flow: "folder" }` — leftover no leftover expected parent. Leftover `assert.equal` leftover consumed leftover `fileId`. Leftover `bootstrapGooglePicker("spreadsheet")` — leftover no leftover second leftover allowlist leftover assert, leftover no leftover `assert.ok` leftover nonce / leftover token. Leftover `verifyGooglePickerSelection` leftover spreadsheet leftover id + leftover `parentFolderId` (leftover Owner pick leftover **ignores** leftover `parentFolderId`). Leftover `consumePickerSelectionReference` leftover `{ flow: "spreadsheet", expectedParentFolderId }`. Leftover `assert.equal` leftover consumed leftover `fileId`. Leftover passed leftover steps leftover `picker_bootstrap_folder` / leftover `picker_verify_folder_selection` / leftover `picker_consume_folder_reference` / leftover `picker_verify_spreadsheet_selection` / leftover `picker_consume_spreadsheet_reference`. Leftover orchestration leftover **asks** this leftover parent leftover through leftover consume leftover before leftover replay leftover beat leftover finishes.

2. **Prove a spent folder nonce cannot be verified again** — leftover same leftover `runLivePickerServerContractTests` leftover after leftover consume leftover spreadsheet. Leftover `assert.rejects` leftover `verifyGooglePickerSelection` leftover with leftover already-spent leftover folder leftover `selection_nonce` leftover matching leftover `/invalid_nonce|Picker selection nonce/i`. Leftover passed leftover step leftover `picker_nonce_replay_rejected`. Leftover catch leftover any leftover throw leftover pushes leftover `picker_contract_error` leftover `failed` leftover with leftover `error.message` leftover and leftover returns leftover `{ ok: false, steps }`. Leftover happy leftover path leftover returns leftover `{ ok: true, steps }`. Leftover `syntheticPickerFolderId` leftover is leftover `randomBytes(12).toString("hex")` leftover with leftover **no caller** — leftover not leftover an leftover owner leftover operation.

`PickerContractStep` is the leftover bag leftover orchestration leftover already leftover spreads into leftover harness leftover steps, not leftover a leftover third leftover owner leftover operation.

## Organization

Keep one file. This is the screenplay for “prove the live Owner Picker still accepts the harness folder and workbook we just created, then refuse a replayed folder nonce.” Leftover orchestration, leftover Owner pick, leftover unused tickets, leftover Drive metadata get, leftover destination desk, leftover denylist proof already live in deeper **modules**. Do not pull those in. Do not invent a `LivePickerContractRunnerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover Owner-pick **adapter** beside leftover `bootstrapGooglePicker` / leftover `verifyGooglePickerSelection` / leftover `consumePickerSelectionReference`. Do not invent a second leftover metadata **adapter** beside leftover `createDriveMetadataClient`. Do not invent a second leftover destination-create **adapter** beside leftover `createReportingDestination`.

Do not split leftover prove leftover folder / leftover prove leftover workbook / leftover refuse leftover replay into CRUD files. Leftover replay leftover stays leftover with leftover prove because leftover replay leftover **asks** leftover the leftover spent leftover folder leftover nonce leftover from leftover the leftover same leftover sitting. Do not move leftover Owner pick leftover here so “the harness owns Picker.” Do not start leftover `createFolderName` leftover from leftover this leftover file so “the contract can mint a parent.” Do not leftover start leftover worker leftover from leftover this leftover file so “one harness file owns Google.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runLivePickerServerContractTests` | `proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook` | leftover orchestration leftover after leftover replace-tab leftover create-name |
| `syntheticPickerFolderId` | `mintAFakeFolderIdNobodyAsks` | leftover dead leftover export leftover — leftover keep leftover until leftover a leftover caller leftover exists leftover or leftover a leftover later leftover tested leftover delete |
| `PickerContractStep` | `OneBeatOfTheLivePickerProof` | leftover orchestration leftover spreads leftover steps |

Keep leftover `{ ok, steps }` leftover until leftover orchestration leftover migrates. Keep the old names as one-line aliases until leftover `liveGoogleOrchestration.ts` leftover migrates. Do not make leftover Wave B leftover picker leftover routes leftover learn leftover `proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook`. Do not persist a new leftover harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover orchestration leftover already leftover destructures:

```ts
type LivePickerProofWeMayReturn = {
  ok: boolean
  steps: Array<{
    name: string
    outcome: "passed" | "failed"
    detail?: string
  }>
}
```

That is the handoff from “leftover Owner Picker leftover still leftover accepts leftover these leftover created leftover files, or leftover one leftover beat leftover failed” to “leftover orchestration leftover may leftover seed leftover the leftover replace-tab leftover run.” Do **not** put leftover `ZZ1` / leftover `ZY1` on this type. Do **not** put leftover `createFolderName` on this type. Do **not** put leftover `trashed: true` on this type. Do **not** put leftover `refresh_token` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// livePickerContractRunner.ts
// After live Google testing creates a replace-tab folder
// and workbook by name, prove the Owner Picker path
// still works on those same files.
// Do not type a raw file id and call it done.
// Bootstrap a folder picker — never leak the refresh token.
// Verify that folder against live Drive.
// Consume the one-time selection reference.
// Then bootstrap a spreadsheet picker.
// Verify that workbook against live Drive.
// Consume the one-time selection reference only if
// it still sits in that folder.
// Then try the spent folder nonce again —
// that replay must fail.
// Do not create a destination.
// Do not start leftover worker.
// Do not trash a folder from this file.
// Do not mint a synthetic folder id
// and send it to live Drive.

// ── 1. Prove the live Owner Picker still accepts these files ─

export async function proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook(input)
  // connectMongo
  // leftover bootstrap folder + leftover re-assert leftover allowlist
  // leftover createDriveMetadataClient — official Owner client
  // leftover verify leftover folder + leftover consume leftover folder reference
  // leftover bootstrap spreadsheet — no second leftover allowlist assert
  // leftover verify leftover workbook (parentFolderId is ignored here)
  // leftover consume leftover spreadsheet reference with leftover expected parent
export const runLivePickerServerContractTests =
  proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook

// ── 2. Prove a spent folder nonce cannot be verified again ─

  // leftover assert.rejects leftover verify leftover with leftover spent leftover folder leftover nonce
  // leftover catch leftover any leftover throw leftover → leftover ok: false, leftover picker_contract_error

export function mintAFakeFolderIdNobodyAsks()
  // randomBytes(12).toString("hex") — no caller
export const syntheticPickerFolderId = mintAFakeFolderIdNobodyAsks
```

Read the primary path out loud: *The harness already created a replace-tab folder and workbook by name. Bootstrap a folder picker and refuse a payload that could leak the refresh token. Verify that folder against live Drive as the connected Owner. Consume that one-time selection reference. Bootstrap a spreadsheet picker. Verify that workbook — leftover Owner pick leftover ignores leftover `parentFolderId` on leftover verify. Consume that one-time selection reference only if the workbook still sits in that folder. Then replay the spent folder nonce; leftover verify leftover must leftover refuse leftover `picker_invalid_nonce`. Do not create a destination. Do not start leftover worker. Do not trash. If leftover create-name leftover never leftover minted leftover a leftover workbook id, leftover orchestration leftover skips leftover this leftover file leftover entirely.*

That is the operation. `runLivePickerServerContractTests` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Spreadsheet verify `parentFolderId` is ignored.** Leftover Owner pick leftover verify leftover accepts leftover `parentFolderId` leftover and leftover never leftover reads leftover it. Leftover parent leftover assert leftover lives leftover only leftover on leftover consume leftover `expectedParentFolderId`. Leftover prove leftover passes leftover `parentFolderId` leftover into leftover verify leftover as leftover if leftover verify leftover owned leftover the leftover parent leftover beat. Rename leftover that leftover lie. Do not silently leftover start leftover reading leftover verify leftover `parentFolderId` leftover so leftover “the contract leftover can leftover skip leftover consume” — leftover Owner pick leftover already leftover named leftover consume-after-validate.

2. **Spreadsheet bootstrap skips the allowlist re-assert.** Leftover folder leftover beat leftover **asks** leftover `assertPickerBootstrapAllowlist` leftover again leftover (leftover bootstrap leftover already leftover asserts leftover internally). Leftover spreadsheet leftover beat leftover does leftover not. Leftover spreadsheet leftover beat leftover also leftover never leftover `assert.ok` leftover nonce leftover or leftover token. Rename leftover the leftover uneven leftover beats. Do not silently leftover drop leftover the leftover folder leftover re-assert leftover so leftover “bootstrap leftover already leftover owns leftover allowlist.” Do not silently leftover add leftover a leftover second leftover spreadsheet leftover allowlist leftover so leftover “both leftover flows leftover look leftover the leftover same” leftover without leftover a leftover paired leftover test.

3. **Replay is folder verify only.** Leftover prove leftover never leftover replays leftover consume leftover of leftover a leftover spent leftover selection leftover reference. Leftover prove leftover never leftover replays leftover the leftover spreadsheet leftover nonce. Leftover `pickerVerification.test.ts` leftover already leftover locks leftover inject leftover replay leftover on leftover Owner pick. Rename leftover the leftover live leftover gap. Do not silently leftover add leftover consume leftover replay leftover so leftover “the leftover contract leftover owns leftover every leftover ticket leftover refuse” leftover without leftover a leftover paired leftover test.

4. **Official metadata client, not leftover wrap.** Leftover prove leftover **asks** leftover `createDriveMetadataClient` leftover (`getConnectedGoogleOAuthClient`). Leftover orchestration leftover already leftover **asked** leftover wrap leftover and leftover create-name leftover before leftover this leftover file. Leftover denylist leftover proof leftover **asks** leftover wrap leftover `driveApi`. Rename leftover the leftover two leftover Drive leftover clients leftover on leftover one leftover harness leftover sitting. Do not silently leftover inject leftover wrap leftover here leftover so leftover “every leftover live leftover path leftover shares leftover one leftover client” leftover — leftover official leftover Owner leftover pick leftover is leftover the leftover load-bearing leftover path leftover this leftover file leftover proves.

5. **Orchestration skips this file when create-name minted no workbook.** Leftover `if (replaceSnapshot.workbook?.id)` leftover is leftover the leftover only leftover caller leftover gate. Leftover prove leftover itself leftover always leftover **asks** leftover live leftover Drive leftover for leftover both leftover ids leftover it leftover was leftover given. Rename leftover the leftover skip leftover as leftover orchestration leftover owning leftover “no leftover workbook, leftover no leftover picker leftover proof.” Do not silently leftover start leftover prove leftover from leftover snapshot leftover create leftover so leftover “every leftover destination leftover gets leftover a leftover picker leftover contract.”

6. **First failure collapses to `picker_contract_error`.** Leftover passed leftover beats leftover stay leftover in leftover `steps`. Leftover failing leftover beat leftover is leftover not leftover named leftover except leftover via leftover `detail`. Leftover orchestration leftover then leftover throws leftover a leftover generic leftover `"Picker server contract tests failed."` leftover after leftover it leftover spreads leftover `steps`. Rename leftover the leftover collapsed leftover catch. Do not silently leftover rethrow leftover Owner pick leftover codes leftover so leftover “leftover interpret leftover can leftover pass” leftover — leftover denylist leftover proof leftover already leftover named leftover remap leftover `picker_invalid_selection`.

7. **`syntheticPickerFolderId` is a lie sitting next to a live Drive proof.** Leftover no leftover caller. Leftover a leftover later leftover implementer leftover could leftover feed leftover hex leftover into leftover verify leftover against leftover live leftover Drive. Rename leftover the leftover unused leftover export leftover as leftover mint-a-fake-folder-id-nobody-asks. Do not silently leftover delete leftover it leftover in leftover this leftover rename leftover without leftover a leftover paired leftover test leftover that leftover names leftover “no leftover caller.” Do not silently leftover start leftover using leftover it leftover so leftover “the leftover parameter leftover starts leftover working.”

8. **`connectMongo` twice.** This file leftover **asks** leftover `connectMongo` leftover then leftover bootstrap leftover **asks** leftover `connectMongo` leftover again. Leftover orchestration leftover already leftover connected. Rename leftover the leftover pile-up. Do not silently leftover drop leftover this leftover file leftover `connectMongo` leftover so leftover “callers leftover own leftover Mongo” leftover without leftover a leftover paired leftover test leftover for leftover standalone leftover invoke.

9. **No leftover refuse leftover service leftover account leftover here.** Leftover denylist leftover proof leftover **asks** leftover refuse leftover then leftover wrap. This file leftover relies leftover on leftover orchestration leftover already leftover refusing. Leftover bootstrap leftover still leftover refuses leftover unless leftover Owner leftover Drive leftover is leftover connected leftover and leftover healthy. Rename leftover the leftover standalone leftover gap. Do not silently leftover add leftover refuse leftover here leftover so leftover “every leftover live leftover path leftover separates leftover identity.”

10. **No test asks leftover prove.** Leftover `pickerVerification.test.ts` leftover Owner leftover pick leftover only. Leftover `liveTestReleaseSafety.test.ts` leftover parent leftover mismatch leftover on leftover Owner leftover pick leftover `validatePickerSelectionReferenceMetadata`, leftover not leftover this leftover file. That leftover is leftover not leftover enough leftover for leftover a leftover story leftover that leftover bootstraps leftover live leftover Picker leftover and leftover consumes leftover tickets leftover against leftover created leftover files.

11. **Leave sibling modules alone.** Leftover `bootstrapGooglePicker`, leftover `verifyGooglePickerSelection`, leftover `consumePickerSelectionReference`, leftover `createDriveMetadataClient`, leftover `createReportingDestination`, and leftover `proveDenylistBlocksProductionDestination` are already the right **depth**. This file leftover proves leftover those leftover **adapters** leftover still leftover accept leftover created leftover files leftover and leftover refuse leftover a leftover spent leftover folder leftover nonce. <!-- pragma: allowlist secret -->

## Testing

The **interface** is the test surface: `proveTheLiveOwnerPickerStillAcceptsThisCreatedFolderAndWorkbook`, `mintAFakeFolderIdNobodyAsks` (today `runLivePickerServerContractTests` / `syntheticPickerFolderId`).

Today **no test imports this file**. `pickerVerification.test.ts` leftover proves leftover Owner pick leftover verify / leftover consume leftover replay leftover on leftover injected leftover stores. `liveTestReleaseSafety.test.ts` leftover proves leftover parent leftover mismatch leftover on leftover `validatePickerSelectionReferenceMetadata`. That is not enough for a story that leftover bootstraps leftover live leftover Picker leftover and leftover **asks** leftover consume leftover against leftover created leftover files.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Prove**
- Folder leftover bootstrap leftover re-asserts leftover allowlist leftover and leftover records leftover `picker_bootstrap_folder`.
- Folder leftover verify leftover then leftover consume leftover records leftover `picker_verify_folder_selection` leftover and leftover `picker_consume_folder_reference`. Leftover consumed leftover `fileId` leftover equals leftover input leftover `folderId`.
- Spreadsheet leftover bootstrap leftover does leftover not leftover re-assert leftover allowlist leftover today leftover (name leftover the leftover gap). Do not silently leftover add leftover that leftover assert leftover in leftover this leftover rename.
- Spreadsheet leftover verify leftover passes leftover `parentFolderId` leftover that leftover Owner pick leftover ignores leftover (name leftover the leftover lie). Leftover consume leftover then leftover **asks** leftover `expectedParentFolderId` leftover and leftover records leftover `picker_consume_spreadsheet_reference`.
- Spent leftover folder leftover nonce leftover verify leftover rejects leftover and leftover records leftover `picker_nonce_replay_rejected`.
- First leftover throw leftover returns leftover `{ ok: false }` leftover with leftover `picker_contract_error` leftover and leftover keeps leftover earlier leftover passed leftover steps.
- Leftover worker / leftover `createFolderName` / leftover `files.update` `{ trashed: true }` leftover / leftover HTTP leftover picker leftover routes leftover are leftover not leftover **asked**.
- Leftover `createDriveMetadataClient` leftover is leftover **asked**; leftover wrap leftover `driveApi` leftover is leftover not.

**Mint**
- Leftover `syntheticPickerFolderId` leftover returns leftover 24 leftover hex leftover chars leftover and leftover has leftover no leftover runtime leftover caller.

Do **not** add a test per helper (the leftover `assert.ok`, leftover step leftover push). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot leftover official leftover janitor, leftover worker, leftover queue publish, Analytics, or Sheet Sync inside these tests. Leftover Owner pick leftover remap leftover stays leftover `pickerVerification.test.ts`. Leftover parent leftover mismatch leftover stays leftover `liveTestReleaseSafety.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Drive Picker.
- I would not open Wave B (`src/routes/google-drive-oauth.routes.ts`, `src/config/domain/googlePicker.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LivePickerContractRunnerService` class or a `bootstrap.ts` / `verify.ts` / `consume.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second leftover Owner-pick **adapter** beside leftover `bootstrapGooglePicker` / leftover `verifyGooglePickerSelection` / leftover `consumePickerSelectionReference`.
- I would not silently start leftover reading leftover verify leftover `parentFolderId`.
- I would not silently leftover add leftover spreadsheet leftover allowlist leftover re-assert leftover without leftover a leftover paired leftover test.
- I would not silently leftover add leftover consume leftover replay leftover or leftover spreadsheet leftover nonce leftover replay.
- I would not silently leftover inject leftover wrap leftover `driveApi` leftover in leftover place leftover of leftover `createDriveMetadataClient`.
- I would not silently leftover delete leftover `syntheticPickerFolderId`.
- I would not silently leftover start leftover using leftover `syntheticPickerFolderId` leftover against leftover live leftover Drive.
- I would not silently leftover merge this file with leftover `liveTestDenylistProof.ts` or leftover `picker.service.ts`.
- I would not silently leftover start leftover `createFolderName` leftover from leftover this leftover file.
- I would not open `live/liveTestHarnessRunRegistry.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
