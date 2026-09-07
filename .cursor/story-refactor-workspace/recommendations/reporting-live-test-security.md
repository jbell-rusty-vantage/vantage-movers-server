# Never A Service Account, Never Live-Account Identity — Prove The Connected Test Owner And The Dedicated Export Root, Then Only Allow Trash Of A Marked Harness Folder We Registered — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 35 of this service — `live/liveTestSecurity.ts`
- Remaining in this service: `live/liveTestOAuthAdapters.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestSecurity.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `rejectServiceAccountCredentialsForLiveTest`, `assertLiveTestOAuthPrincipal`, `assert` + `IdentitySeparation`, `validateDedicatedExportRoot`, `assertHarnessContainerSafeToTrash`, `refetchDriveFileMetadata`, `vantage_live_test_root`, or a live-test trash fence — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** reject / live-account-identity refuse / principal / export-root prove; it never **asks** this file’s trash fence). Distinct from already-recommended seed: [`reporting-live-test-run-factory.md`](reporting-live-test-run-factory.md) (queued Mongo insert; never **asks** this file). Distinct from already-skipped inject: `live/liveTestWorkerHooks.ts`. Distinct from already-recommended official Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`assertSafeToTrashReportingArtifact` is spreadsheet MIME + `driveAppPropertiesMatchRun`; live trash **asks** this file). Distinct from already-recommended official Drive stamp: [`reporting-drive-app-properties.md`](reporting-drive-app-properties.md) (`vantage_reporting_run_id` / role `snapshot` | `staging_workbook`; live evidence **asks** `buildLiveTestAppProperties` + `harness_container`). Distinct from already-recommended official janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (failed / cancelled `ReportingDelivery` trash; never **asks** this file). Distinct from already-recommended Drive metadata get: [`google-drive-oauth-drive-metadata.md`](google-drive-oauth-drive-metadata.md) (`getFileMetadata` classifies 404 / 403 and has no `appProperties` on `DriveFileMetadata`; live refetch is a second get). Distinct from already-recommended Owner login: [`google-drive-oauth-google-drive-oauth.md`](google-drive-oauth-google-drive-oauth.md) (this file **asks** `getGoogleDriveConnectionStatus` / `getGoogleDriveAccessTokenHealth` / `getConnectedGoogleOAuthClient`; Owner login never **asks** this file). Distinct from already-recommended company identity: [`google-auth-service-account.md`](google-auth-service-account.md) (this file **refuses** that identity). Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (`listConfiguredServiceAccountEnvVars` / `rejectServiceAccountCredentialsForLiveTest` / `validateReportingLiveTestPrerequisites` / `isPositivelyMarkedHarnessContainer` — a second reject that does **not** check credential files on disk). Distinct from unvisited OAuth adapters: `live/liveTestOAuthAdapters.ts`. Distinct from unvisited cleanup: `live/liveTestCleanup.ts` (owns `files.update` `{ trashed: true }`). Distinct from unvisited later janitor: `live/testArtifactJanitor.ts` + `live/liveTestHarnessRunRegistry.ts` + `live/janitorCompletion.ts` (Wave B `/api/cron/reporting-test-artifact-janitor`). Distinct from unvisited denylist: `live/liveTestDenylistProof.ts` (**asks** reject only). Distinct from unvisited env / picker / mask / synthetic page. Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** reject, live-account-identity refuse, principal, export-root prove; does **not** **ask** trash safety). Unvisited `live/testArtifactJanitor.ts` (**asks** reject, principal, export-root prove, trash safety). Unvisited `live/liveTestOAuthAdapters.ts` (**asks** reject on both adapter builders; `createLiveTestGoogleAdapters` also **asks** principal). Unvisited `live/liveTestDenylistProof.ts` (**asks** reject only). Unvisited `live/liveTestCleanup.ts` (**asks** principal, refetch, trash safety; tag / nested-artifact walk **ask** refetch). Tests: `live/liveTestSecurity.test.ts` **asks** run-tag format / direct-child / known-evidence / service-account indicators (and also mask / janitor skip / inject — those are sibling **interfaces**). `live/liveGoogleHarness.test.ts` **asks** Wave B `rejectServiceAccountCredentialsForLiveTest`, not this file. `live/liveTestOAuthAdapters.test.ts` **asks** adapters, which **ask** this file. `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Owner HTTP confirm never **asks** this file. Official Drive trash never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: refuse-a-service-account (`rejectServiceAccountCredentialsForLiveTest`) vs prove-the-connected-test-owner (`assertLiveTestOAuthPrincipal`) vs refuse-when-test-oauth-equals-live-account (`assert` + `IdentitySeparation`) vs prove-the-dedicated-export-root (`validateDedicatedExportRoot`) vs refuse-to-trash-unless-this-folder-is-a-marked-harness-container-we-registered (`assertHarnessContainerSafeToTrash`). The this-file-reject / Wave B config-reject **seam** exists because both export the same two names; harness tests **ask** Wave B config; orchestration / janitor / adapters / denylist **ask** this file. The this-file-refetch / already-recommended metadata-get **seam** exists because live refetch **asks** `appProperties` and throws a raw `Error`; janitor-completion **asks** `fetchDriveFileMetadata` so 404 / 403 classify. The live-harness-trash / official-delivery-trash **seam** exists because official `assertSafeToTrashReportingArtifact` is spreadsheet MIME + `driveAppPropertiesMatchRun`; live trash **asks** folder MIME + live markers + registry. The principal / adapter **seam** exists because `buildLiveTestGoogleAdaptersFromOAuthClient` **asks** reject and does **not** **ask** principal (the caller already holds an OAuth client). The export-root-Drive-prove / Wave B env-prereq **seam** exists because `validateReportingLiveTestPrerequisites` is env-only; this file **asks** Drive `files.get`. The janitor-age-select / this-file-trash-prove **seam** exists because `isPositivelyMarkedHarnessContainer` requires age; trash safety does **not** check age. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no `files.update` `{ trashed: true }` **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~300-line file is one sitting if you read it as never a service account, never live-account identity — prove the connected test owner and the dedicated export root, then only allow trash of a marked harness folder we registered. Do **not** split into `reject.ts` / `assert.ts` / `validate.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull orchestration, adapters, cleanup trash, later janitor, official Drive trash, official Drive stamp, Owner login, or Wave B env config here so “one security file owns the company.” If it later splits: `refuseAServiceAccountForLiveGoogleTests.ts` / `proveTheConnectedPrincipalIsTheConfiguredTestOwner.ts` / `refuseWhenTestOauthIdentityEqualsLiveAccount.ts` / `proveTheDedicatedExportRootIsAMarkedFolderWeOwn.ts` / `refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered.ts` only as later story files, never CRUD.

`rejectServiceAccountCredentialsForLiveTest` / `assertLiveTestOAuthPrincipal` / `assert` + `IdentitySeparation` / `validateDedicatedExportRoot` / `assertHarnessContainerSafeToTrash` are executor mechanics. The owner question is: *Live Google testing may not use the company service account. It may not use live-account OAuth identity. Prove the connected Owner login is the configured test owner. Prove the export root is a folder we own, not trash, and stamped as the live-test root. Then only allow trash of a folder that is a direct child of that root, marked as this harness run, and bound in the janitor registry. Do not trash a spreadsheet from this file. Do not write Google from this file. Do not start official `assertSafeToTrashReportingArtifact`. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended orchestration, official Drive trash, official Drive stamp, Owner login, company identity, and Drive metadata get already live in other **modules**. Adapters, cleanup trash, later janitor, denylist, env, mask, synthetic page, and Wave B config stay sibling **modules**. Do not pull those in.

## What this file actually does

Five operations of one “never a service account, never live-account identity — prove the connected test owner and the dedicated export root, then only allow trash of a marked harness folder we registered” story, not “a live-test assert CRUD helper,” and not official Drive trash / Owner login / later janitor:

1. **Refuse a service account for live Google tests** — `rejectServiceAccountCredentialsForLiveTest`. **Asks** `listConfiguredServiceAccountIndicators`. Indicators are `listConfiguredServiceAccountEnvVars` (the four `GOOGLE_SERVICE_ACCOUNT_ENV_VARS` plus `SERVICE_ACCOUNT_LOCAL_FILE` / `SERVICE_ACCOUNT_LOCAL_FILE_JSON`) plus `GOOGLE_APPLICATION_CREDENTIALS` plus files-on-disk `google-service-account.json` / `google-service-account.one-line.json` / `service-account.json` via `existsSync`. Any indicator → `Error` “Live reporting Google tests reject service-account credentials. Remove: …”. Orchestration / janitor / adapters / denylist **ask** this **seam**. Wave B `reportingLiveTest.ts` exports the same two names and does **not** check files on disk. Harness tests **ask** Wave B config.

2. **Prove the connected principal is the configured test owner** — `assertLiveTestOAuthPrincipal`. **Asks** reject first. **Asks** `getGoogleDriveOAuthConfig`, `getGoogleDriveConnectionStatus`, `getGoogleDriveAccessTokenHealth`. Not connected or token not healthy → `Error` (`tokenHealth.reason` when unhealthy; the string `"connected"` when connected is false and the token is healthy — the message lies). Connection email ≠ token email → mismatch. Connection email (lowercase) ≠ `config.ownerEmail` (lowercase) → “does not match configured test owner email.” Returns `{ googleEmail, ownerEmail, clientId }`. `createLiveTestGoogleAdapters` **asks** this **seam**. Export-root prove **asks** this **seam** again.

3. **Refuse when test OAuth identity equals live-account identity** — `assert` + `IdentitySeparation`. Reads `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_OWNER_EMAIL` vs `REPORTING_*_GOOGLE_OAUTH_CLIENT_ID` / `REPORTING_*_GOOGLE_OAUTH_OWNER_EMAIL`. Missing test pair → throw. Missing live-account pair → throw. Same client id → throw. Same owner email (lowercase) → throw. Orchestration **asks** this **seam**. Janitor does **not**.

4. **Prove the dedicated export root is a marked folder we own** — `validateDedicatedExportRoot`. **Asks** principal. **Asks** `getConnectedGoogleOAuthClient` then `google.drive` `files.get` fields `id,mimeType,ownedByMe,appProperties,trashed` with `supportsAllDrives: true`. Trashed / not folder MIME / not `ownedByMe` / `appProperties[vantage_live_test_root] !== "1"` / missing id → throw. Returns `{ fileId, ownedByMe: true, mimeType: folder, appProperties }`. `expectedOwnerEmail` is accepted and never read. Orchestration / janitor **ask** this **seam**.

5. **Refuse to trash unless this folder is a marked harness container we registered** — `assertHarnessContainerSafeToTrash`. **Asks** `refetchDriveFileMetadata` (`files.get` fields include `appProperties`; incomplete id / mime / name → raw `Error`; `url` is `webViewLink ?? ""`). Already trashed → return (ok). Not `ownedByMe` / not folder MIME → refuse. **Asks** `assertDirectChildOfExportRoot`. Run tag on Drive ≠ expectation run tag → refuse. **Asks** `assertKnownHarnessRunEvidence` `expectedRole: "harness_container"` (run-tag format, `vantage_live_test` / `vantage_reporting_marker_version` `"1"`, `vantage_live_test_run_tag` match, role on `LIVE_TEST_JANITOR_ARTIFACT_ROLES` or the expected role, `vantage_reporting_run_id` / `vantage_reporting_destination_id` present). Drive run id / destination id ≠ expectation → refuse. **Asks** `isJanitorContainerAuthorized` `{ runTag, exportRootFolderId, containerFolderId }`. Not authorized → refuse. Cleanup / later janitor **ask** this **seam** then `trashHarnessContainerWithConfirmation`. This file never `files.update`.

`listConfiguredServiceAccountIndicators` / `listConfiguredServiceAccountEnvVars` / `validateLiveTestRunTagFormat` / `assertDirectChildOfExportRoot` / `assertKnownHarnessRunEvidence` / `refetchDriveFileMetadata` / `buildExportRootAppProperties` are beats, not extra owner operations. `buildExportRootAppProperties` has **no caller**. The `ReportingLiveTestConfig` re-export is unused.

## Organization

Keep one file. This is the screenplay for “never a service account, never live-account identity — prove the connected test owner and the dedicated export root, then only allow trash of a marked harness folder we registered.” Orchestration, official Drive trash, official Drive stamp, Owner login, company identity, Drive metadata get, adapters, cleanup trash, later janitor, denylist, env, mask, synthetic page, and Wave B config already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestSecurityService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second official trash **adapter** beside `assertSafeToTrashReportingArtifact`. Do not invent a second metadata-get **adapter** beside `getFileMetadata`. Do not invent a second reject **adapter** beside Wave B config in this rename — name the duplicate; do not silently delete either export.

Do not split reject / principal / export-root / trash-fence into CRUD files. Refuse stays with prove because export-root prove **asks** principal, which **asks** reject. Do not move trash `files.update` here so “security owns trash.” Do not move `isJanitorContainerAuthorized` here so “one file owns the registry.” Do not start official `assertSafeToTrashReportingArtifact` from this file so “one trash fence owns Google.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `rejectServiceAccountCredentialsForLiveTest` | `refuseAServiceAccountForLiveGoogleTests` | orchestration / janitor / adapters / denylist |
| `assertLiveTestOAuthPrincipal` | `proveTheConnectedPrincipalIsTheConfiguredTestOwner` | adapters + export-root prove |
| `assert` + `IdentitySeparation` | `refuseWhenTestOauthIdentityEqualsLiveAccount` | orchestration only |
| `validateDedicatedExportRoot` | `proveTheDedicatedExportRootIsAMarkedFolderWeOwn` | orchestration + janitor |
| `assertHarnessContainerSafeToTrash` | `refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered` | cleanup + later janitor |
| `refetchDriveFileMetadata` | `refetchDriveMetadataIncludingAppProperties` | cleanup tag / nested walk / trash confirm |

Keep `listConfiguredServiceAccountIndicators` / `validateLiveTestRunTagFormat` / `assertDirectChildOfExportRoot` / `assertKnownHarnessRunEvidence` as one-line aliases until tests migrate onto the parent operations. Keep the old names as one-line aliases until `liveGoogleOrchestration.ts` / `liveTestOAuthAdapters.ts` / `liveTestCleanup.ts` / `testArtifactJanitor.ts` / `liveTestDenylistProof.ts` migrate. Do not make official Drive trash learn this file. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the trash expectation cleanup / later janitor already pass:

```ts
type MarkedHarnessContainerWeMayTrash = {
  runTag: string
  runId: string
  destinationId: string
  exportRootFolderId: string
  runTagPrefix: string
}
```

That is the handoff from “this folder is tagged as this harness run” to “this file may say trash is allowed.” Do **not** put official `ZZ1` / `ZY1` on this type. Do **not** put a Google write on this type. Do **not** put `trashed: true` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestSecurity.ts
// Live Google testing may not use the company service account.
// It may not use live-account OAuth identity.
// Prove the connected Owner login is the configured test owner.
// Prove the export root is a folder we own, not trash,
// and stamped as the live-test root.
// Then only allow trash of a folder that is a direct child
// of that root, marked as this harness run,
// and bound in the janitor registry.
// Do not trash a spreadsheet from this file.
// Do not write Google from this file.

// ── 1. Refuse a service account for live Google tests ─────

export function refuseAServiceAccountForLiveGoogleTests()
  // nameTheServiceAccountIndicatorsInThisProcess
  // env vars + GOOGLE_APPLICATION_CREDENTIALS + files on disk
  // any present → Error "Remove: …"
export const rejectServiceAccountCredentialsForLiveTest =
  refuseAServiceAccountForLiveGoogleTests

function nameTheServiceAccountIndicatorsInThisProcess()
  // env list (no GOOGLE_APPLICATION_CREDENTIALS here)
  // plus GOOGLE_APPLICATION_CREDENTIALS
  // plus SERVICE_ACCOUNT_LOCAL_FILE / SERVICE_ACCOUNT_LOCAL_FILE_JSON
  // plus existsSync of the three credential file names
export const listConfiguredServiceAccountIndicators =
  nameTheServiceAccountIndicatorsInThisProcess

// ── 2. Prove the connected principal is the configured test owner ─

export async function proveTheConnectedPrincipalIsTheConfiguredTestOwner()
  // refuseAServiceAccountForLiveGoogleTests
  // ask getGoogleDriveOAuthConfig
  // ask getGoogleDriveConnectionStatus + getGoogleDriveAccessTokenHealth
  // not connected or token unhealthy → throw (message lies when connected is false)
  // connection email ≠ token email → throw
  // connection email ≠ config.ownerEmail → throw
  // return { googleEmail, ownerEmail, clientId }
export const assertLiveTestOAuthPrincipal =
  proveTheConnectedPrincipalIsTheConfiguredTestOwner

// ── 3. Refuse when test OAuth identity equals live-account identity ──

export function refuseWhenTestOauthIdentityEqualsLiveAccount()
  // test client / owner must both be set
  // REPORTING_*_GOOGLE_OAUTH_* must both be set
  // client ids must differ
  // owner emails must differ
export const assert + IdentitySeparation =
  refuseWhenTestOauthIdentityEqualsLiveAccount

// ── 4. Prove the dedicated export root is a marked folder we own ─

export async function proveTheDedicatedExportRootIsAMarkedFolderWeOwn(input)
  // proveTheConnectedPrincipalIsTheConfiguredTestOwner
  // ask getConnectedGoogleOAuthClient
  // Drive files.get id,mimeType,ownedByMe,appProperties,trashed
  // refuse trashed / not folder / not ownedByMe
  // refuse missing vantage_live_test_root === "1"
  // expectedOwnerEmail is accepted and never read
export const validateDedicatedExportRoot =
  proveTheDedicatedExportRootIsAMarkedFolderWeOwn

// ── 5. Refuse to trash unless this folder is a marked harness container we registered ─

export async function refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered(input)
  // refetchDriveMetadataIncludingAppProperties
  // already trashed → return
  // refuse not owned / not folder
  // refuseUnlessTheFolderIsADirectChildOfTheExportRoot
  // refuse when Drive run tag ≠ expectation
  // proveTheDriveMarkersNameThisHarnessRun expectedRole harness_container
  // refuse when Drive run id / destination id ≠ expectation
  // ask isJanitorContainerAuthorized
  // refuse without a registry binding for this folder id
export const assertHarnessContainerSafeToTrash =
  refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered

export async function refetchDriveMetadataIncludingAppProperties(drive, fileId)
  // files.get includes appProperties
  // incomplete id / mime / name → raw Error
  // url = webViewLink ?? ""
export const refetchDriveFileMetadata =
  refetchDriveMetadataIncludingAppProperties

function refuseAnInvalidLiveTestRunTag(runTag, prefix)
export const validateLiveTestRunTagFormat = refuseAnInvalidLiveTestRunTag

function refuseUnlessTheFolderIsADirectChildOfTheExportRoot(input)
export const assertDirectChildOfExportRoot =
  refuseUnlessTheFolderIsADirectChildOfTheExportRoot

function proveTheDriveMarkersNameThisHarnessRun(input)
  // refuseAnInvalidLiveTestRunTag
  // vantage_live_test + vantage_reporting_marker_version === "1"
  // vantage_live_test_run_tag matches
  // role on janitor allowlist or expectedRole
  // run id + destination id present
export const assertKnownHarnessRunEvidence =
  proveTheDriveMarkersNameThisHarnessRun
```

Read the primary path out loud: *Refuse a service account — env, application-default credentials, and credential files on disk. Prove the connected Owner login is the configured test owner. Refuse when that test OAuth client or owner email equals the live-account pair. Prove the export root is a folder we own, not trash, and stamped as the live-test root. Then only allow trash of a folder that is a direct child of that root, marked as this harness run, and bound in the janitor registry. Do not trash a spreadsheet. Do not write Google. Do not start official Drive trash.*

That is the operation. `assertHarnessContainerSafeToTrash` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two rejects, different coverage.** This file’s reject **asks** files on disk and says “Remove:”. Wave B `reportingLiveTest.ts` exports the same names, includes `GOOGLE_APPLICATION_CREDENTIALS` inside `listConfiguredServiceAccountEnvVars`, does **not** check files, and says “Unset:”. Harness tests **ask** Wave B. Orchestration / janitor / adapters / denylist **ask** this file. Rename both so the split is visible. Do not silently delete either export so “one reject wins.” Wave B is locked.

2. **`expectedOwnerEmail` is a lie.** `validateDedicatedExportRoot` accepts it and never reads it. Principal already checks `config.ownerEmail`. Rename the unused argument (`_unusedOwnerEmail` or drop it at the alias). Do not silently compare it so “the parameter starts working.”

3. **Principal error lies when disconnected.** When `connection.connected` is false and `tokenHealth.healthy` is true, the throw says `"connected"`. Rename the beat so the false connected path is visible. Do not silently swap in `connection` reason in this rename.

4. **Janitor skips live-account-identity refuse.** Orchestration **asks** `assert` + `IdentitySeparation`. Janitor **asks** reject + principal + export-root and never this refuse. Do not silently add it to janitor so “every live path separates identity.”

5. **Export-root prove re-asks principal.** Orchestration and janitor both **ask** principal and then export-root, which **asks** principal again (which **asks** reject again). Rename the nested call so the double prove is visible. Do not silently drop the inner **ask** so “callers own principal.”

6. **Already-trashed is success here, skip-then-trash there.** This fence returns when Drive already says trashed. Official `assertSafeToTrashReportingArtifact` does **not** check `trashed`; official janitor **asks** `getFile` first and skips. Do not silently make this fence throw on already-trashed so “the two fences match.”

7. **Age lives on the selector, not the fence.** Janitor `isPositivelyMarkedHarnessContainer` requires age ≥ `artifactMaxAgeMs`. This fence never checks age. Do not silently add age so “the fence owns eligibility.”

8. **Live refetch vs classified metadata get.** This refetch **asks** `appProperties` and throws a raw `Error`. Already-recommended `getFileMetadata` classifies 404 / 403 and has no `appProperties` on `DriveFileMetadata`. Do not silently merge the two so “one refetch” and lose trash-safety markers. Already named in [`google-drive-oauth-drive-metadata.md`](google-drive-oauth-drive-metadata.md).

9. **`buildExportRootAppProperties` has no caller.** It only stamps `vantage_live_test_root: "1"`. Do not silently start writing the root marker from this file so “security owns the stamp.” Do not delete the export until a later sitting finds the writer.

10. **This-file `listConfiguredServiceAccountEnvVars` omits `GOOGLE_APPLICATION_CREDENTIALS`.** Indicators add it. Wave B env list includes it. Rename the two lists so the hole is visible. Do not silently add GAC to this env list so “the lists match.”

11. **`liveTestSecurity.test.ts` tests sibling interfaces.** Mask / janitor skip / inject sit in this file’s test. Those are `piiSafeEvidence` / `testArtifactJanitor` / `liveTestWorkerHooks`. Do not treat those tests as this **interface**.

12. **Leave sibling modules alone.** `getGoogleDriveConnectionStatus`, `getConnectedGoogleOAuthClient`, `isJanitorContainerAuthorized`, `trashHarnessContainerWithConfirmation`, official `assertSafeToTrashReportingArtifact`, and Wave B `validateReportingLiveTestPrerequisites` are already the right **depth**. This file refuses, proves, and fences trash.

## Testing

The **interface** is the test surface: `refuseAServiceAccountForLiveGoogleTests`, `proveTheConnectedPrincipalIsTheConfiguredTestOwner`, `refuseWhenTestOauthIdentityEqualsLiveAccount`, `proveTheDedicatedExportRootIsAMarkedFolderWeOwn`, `refuseToTrashUnlessThisFolderIsAMarkedHarnessContainerWeRegistered` (today `rejectServiceAccountCredentialsForLiveTest` / `assertLiveTestOAuthPrincipal` / `assert` + `IdentitySeparation` / `validateDedicatedExportRoot` / `assertHarnessContainerSafeToTrash`). `refetchDriveFileMetadata` stays exported because cleanup is a second real **adapter**.

Today `liveTestSecurity.test.ts` proves run-tag prefix, nested-parent refuse, `harness_container` evidence vs `snapshot` with `expectedRole`, and service-account indicators for `GOOGLE_APPLICATION_CREDENTIALS` + `SERVICE_ACCOUNT_LOCAL_FILE`. It does **not** prove principal, live-account-identity refuse, export-root Drive prove, or the trash fence. `liveGoogleHarness.test.ts` proves Wave B reject, not this file. That is not enough for a story that can refuse trash.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Refuse a service account**
- Env json / local-file json / `GOOGLE_APPLICATION_CREDENTIALS` each throw “Remove:” with that name.
- A credential file name on disk is an indicator on this file and is **not** an indicator on Wave B config. Name the split. Do not change either list in this rename.

**Prove the test owner / refuse live-account identity**
- Unhealthy token throws `tokenHealth.reason`.
- Connected false + healthy token still throws (today the message is `"connected"`).
- Connection email ≠ token email throws.
- Connection email ≠ configured owner throws.
- Missing live-account client / owner throws.
- Same test and live-account client id throws. Same owner email throws.

**Export root**
- Trashed / not folder / not `ownedByMe` / missing `vantage_live_test_root` `"1"` each throw.
- `expectedOwnerEmail` may disagree with the connected owner and still pass today. Name the unused argument. Do not start reading it in this rename.

**Trash fence**
- Already trashed returns without asking the registry.
- Nested parent / missing live-test marker / role `snapshot` with `expectedRole: "harness_container"` / mismatched run id / unauthorized registry each refuse.
- Matching markers + registry binding do not trash (this file never `files.update`).

Do **not** add a test per helper (`refuseAnInvalidLiveTestRunTag`, `proveTheDriveMarkersNameThisHarnessRun`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official `assertSafeToTrashReportingArtifact`, leftover orchestration, leftover cleanup `files.update`, Analytics, or Sheet Sync inside these tests. Official trash proofs stay `reportingDelivery.regressions.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/config/domain/reportingLiveTest.ts`, `src/routes/reporting.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestSecurityService` class or a `reject.ts` / `assert.ts` / `validate.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second official trash **adapter** beside `assertSafeToTrashReportingArtifact`.
- I would not invent a second metadata-get **adapter** beside `getFileMetadata`.
- I would not silently delete Wave B `rejectServiceAccountCredentialsForLiveTest` so “one reject wins.”
- I would not silently start reading `expectedOwnerEmail`.
- I would not silently add live-account-identity refuse to janitor.
- I would not silently merge live refetch into `getFileMetadata`.
- I would not silently move `files.update` `{ trashed: true }` into this file.
- I would not silently add an age check to the trash fence.
- I would not open `live/liveTestOAuthAdapters.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
