# Prove Live Google Delivery On A Dedicated Owner Folder — Never A Service Account, Never The Queue — Then Tag And Trash Only Those Harness Folders And Return Masked Evidence — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 32 of this service — `live/liveGoogleOrchestration.ts`
- Remaining in this service: `live/liveTestRunFactory.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveGoogleOrchestration.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `runLiveGoogleOrchestration`, `runLiveGoogleHarness`, `REPORTING_LIVE_TEST_ENABLED`, synthetic rows, in-process worker, denylist proof, `LIVE_TEST_HARNESS_LIMITATION`, or masked evidence — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-skipped facade: `live/liveGoogleHarness.ts` (one-line `runLiveGoogleOrchestration as runLiveGoogleHarness` plus types). Distinct from already-recommended claim / write: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (this file **asks** `runReportingDeliveryWorker({ runHint })` in-process; the queue consumer **asks** the worker after the queue; heartbeat never **asks** the worker). Distinct from already-recommended wake-up: [`reporting-queue.md`](reporting-queue.md) (confirm / cancel / heartbeat **ask** `publishReportingWakeup`; this file never publishes). Distinct from already-recommended destination desk: [`reporting-destination.md`](reporting-destination.md) (this file **asks** `createReportingDestination` + `buildValidatedDestinationSnapshot` for replace-tab + snapshot folders under the export root). Distinct from already-recommended preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (the seed sibling inserts a queued `ReportingRun` without HTTP confirm). Distinct from already-recommended delivery persist: [`reporting-delivery-repository.md`](reporting-delivery-repository.md) (this file **asks** `loadReportingDelivery` to say whether replace-tab completed). Distinct from already-recommended official janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (failed / cancelled `ReportingDelivery` trash; a completed snapshot never trash). Distinct from already-recommended Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (official stamp `assertSafeToTrashReportingArtifact`; live trash **asks** live stamp). Distinct from unvisited seed: `live/liveTestRunFactory.ts` (`seedLiveTestQueuedRun`). Distinct from unvisited denylist: `live/liveTestDenylistProof.ts`. Distinct from unvisited security: `live/liveTestSecurity.ts`. Distinct from unvisited OAuth adapters: `live/liveTestOAuthAdapters.ts`. Distinct from unvisited cleanup: `live/liveTestCleanup.ts`. Distinct from unvisited env: `live/liveTestEnv.ts`. Distinct from unvisited picker contract: `live/livePickerContractRunner.ts`. Distinct from unvisited synthetic page: `live/syntheticManifestPageAdapter.ts` + `live/syntheticLiveTestManifest.ts` (`LIVE_TEST_HARNESS_LIMITATION` — synthetic rows, not canonical Mongo page content). Distinct from unvisited inject: `live/liveTestWorkerHooks.ts` + `live/transientRetryWrapper.ts`. Distinct from unvisited mask: `live/piiSafeEvidence.ts`. Distinct from unvisited later janitor: `live/testArtifactJanitor.ts` + `live/liveTestHarnessRunRegistry.ts` + `live/janitorCompletion.ts` (Wave B `/api/cron/reporting-test-artifact-janitor`; this file **asks** `recordLiveTestHarnessRun` then in-process trash). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (`pnpm reporting:live-google-harness` **asks** the facade). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `live/liveGoogleHarness.ts` (re-exports `runLiveGoogleOrchestration as runLiveGoogleHarness` + `formatHarnessEvidenceForLog` + types). Wave B `scripts/reporting/run-live-google-harness.ts` **asks** the facade, prints `formatHarnessEvidenceForLog`; skipped exits `2`; failed exits `1`. Tests: `live/liveGoogleHarness.test.ts` **asks** `runLiveGoogleHarness` once — skip when `REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID` is absent; **asks** `formatHarnessEvidenceForLog` has no raw PII field names. Other tests **ask** config / mask / inject siblings, not this file. `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Owner HTTP confirm never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: skip-unless-owner-OAuth-and-dedicated-export-root (`validateReportingLiveTestPrerequisites` / `REPORTING_LIVE_TEST_ENABLED`) vs prove-live-Google-delivery-on-that-folder (`runLiveGoogleOrchestration`) vs write-masked-evidence-for-the-log (`formatHarnessEvidenceForLog`). The skip / Google **seam** exists because missing config returns `skipped: true` before `connectMongo` / Drive. The this-process worker / queue wake-up **seam** exists because this file **asks** `runReportingDeliveryWorker` in-process and never `publishReportingWakeup`. The synthetic page / canonical Mongo page **seam** exists because `LIVE_TEST_HARNESS_LIMITATION` says synthetic rows paint the tab while lease / checkpoint / verify / promotion / owner OAuth still run. The replace-tab deliver / failed-replacement preserve **seam** exists because a completed published tab must survive a later failed replace. The snapshot deliver / transient resume **seam** exists because `REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES>0` injects then **asks** the worker again; `0` skips inject and completes snapshot once. The in-process trash / later cron janitor **seam** exists because this file **asks** `cleanupLiveTestHarnessContainers` now and also `recordLiveTestHarnessRun` so Wave B test-artifact janitor can finish later. The official delivery janitor / live trash **seam** exists because official `cleanup.ts` never **asks** this file. The export-folder env snapshot / restore **seam** exists because `finally` always **asks** `restoreExportFolderEnv`. There is no begin / complete Domain Command **seam**. There is no claim-lease **seam** besides the worker this file already **asks**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~570-line file is one sitting if you read it as prove live Google delivery on a dedicated owner folder — never a service account, never the queue — then tag and trash only those harness folders and return masked evidence. Do **not** split into `run.ts` / `skip.ts` / `cleanup.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull seed, denylist, security, OAuth adapters, picker contract, synthetic page, inject, mask, later janitor, official worker, official queue, official destination desk, or official cleanup here so “one harness file owns the company.” If it later splits: `skipUnlessOwnerOauthAndDedicatedExportRoot.ts` / `deliverAReplaceTabReportAndProveAFailedReplacementLeavesTheTab.ts` / `deliverASnapshotReportAndProveATransientWriteResumes.ts` / `tagAndTrashOnlyTheHarnessFoldersThenReturnMaskedEvidence.ts` only as later story files, never CRUD.

`runLiveGoogleOrchestration` / `runWorkerToTerminal` / `readPublishedTabSnapshot` / `skippedResult` / `buildFailureResult` / `formatHarnessEvidenceForLog` are executor mechanics. The owner question is: *If live Google testing is on, prove we are the owner on a dedicated export folder — never a service account, never live-account identity. Refuse a denylisted operational workbook. Then actually deliver a replace-tab report onto real Google, read the published tab back, and prove a failed replacement leaves that tab. Then actually deliver a snapshot report. If we inject a transient write failure, the worker must resume and still complete. Call the worker in this process — do not publish a queue wakeup, do not hit HTTP, do not run cron. Paint synthetic rows, not live Form Lead page content. Then tag the harness folders and trash only those folders. If anything fails, still try to tag and trash. Always restore the export-folder env. Return masked evidence — never raw file IDs, never customer fields.*

Already-recommended worker, queue, destination desk, official janitor, and Drive trash already live in other **modules**. Seed, denylist, security, OAuth, picker, synthetic page, inject, mask, and later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Six operations of one “prove live Google delivery on a dedicated owner folder — never a service account, never the queue — then tag and trash only those harness folders and return masked evidence” story, not “a harness CRUD runner,” and not official confirm / official queue / official cleanup:

1. **Skip unless owner OAuth and a dedicated export folder are in place** — `runLiveGoogleOrchestration` early return via `skippedResult`. **Asks** `validateReportingLiveTestPrerequisites`. Missing config → `skipped: true`, `ok: false`, `skipReason` is `${code}: ${message}`. Enabled flag off → skip `REPORTING_LIVE_TEST_ENABLED is not true`. Then **asks** `rejectServiceAccountCredentialsForLiveTest`, the live-account identity-separation assert, `connectMongo`, `registerReportingStage4Foundation`, `registerSyntheticLiveTestSnapshotAdapter` (never restores the default), `seedLiveTestCanonicalFormLeads`, `getGoogleDriveAccessTokenHealth`, `assertLiveTestOAuthPrincipal`, `validateDedicatedExportRoot`. Unhealthy OAuth throws. **Asks** `applyLiveTestExportFolderEnv` after OAuth health. Does not **ask** Drive write yet.

2. **Prove the denylist refuses an operational destination** — **asks** the denylist proof in `live/liveTestDenylistProof.ts`. Step `denylist_rejection`. Not ok → throw. Does not create an unmarked folder for the proof.

3. **Deliver a replace-tab report on real Google and read the published tab back** — **asks** `createReportingDestination` strategy `replace_tab` under `${runTag}-replace-folder` / `${runTag}-replace-workbook` / published title `Live Test Report`. **Asks** `buildValidatedDestinationSnapshot`, picker contract when a workbook id exists, `registerSyntheticLiveTestManifestPageAdapter` with `liveTestSyntheticRows`, `seedLiveTestQueuedRun`, `runWorkerToTerminal`. Passes only when worker status is `completed` **and** `loadReportingDelivery` status is `completed`. Then `readPublishedTabSnapshot` must see a visible published tab with more than a header. Does not **ask** `publishReportingWakeup`.

4. **Prove a failed replacement leaves the prior published tab** — re-registers the synthetic page adapter with `emitRowCount: 1`, seeds a second queued run on the same destination snapshot, **asks** `runWorkerToTerminal` again, then reads the published tab back. Preserved means worker status is `failed` **and** sheet id / title / first 10×5 values still match. Not preserved → throw. Collects nested `workbook_id` / `staging_workbook_id` from the completed replace delivery for later trash.

5. **Deliver a snapshot report — or inject a transient write failure and prove resume** — **asks** `createReportingDestination` strategy `snapshot` under `${runTag}-snapshot-folder`, validated snapshot, synthetic page adapter, `seedLiveTestQueuedRun`. If `injectTransientFailures > 0`: **asks** `configureLiveTestTransientWriteFailures`, one `runReportingDeliveryWorker`, mid-run status must not already be `completed` / `failed`, then `runWorkerToTerminal` must end `completed`, then `resetLiveTestTransientWriteFailures`. If inject is `0`: **asks** `runWorkerToTerminal` once (step `snapshot_worker_delivery`) and marks `transient_retry_resume` skipped. Collects snapshot `workbook_id`.

6. **Tag harness folders, trash only those artifacts, return masked evidence** — **asks** `recordLiveTestHarnessRun`, `tagHarnessContainerFolder` for each container, then `cleanupLiveTestHarnessContainers`. Cleanup failed → throw. Success returns `ok` only when no step is `failed`, `artifactIds` are container folder ids, evidence **asks** `buildMaskedLiveTestEvidence` (owner_oauth, optional replace-run checksum, `LIVE_TEST_HARNESS_LIMITATION`, sanitized cleanup counts). Catch: push `harness_error`, still try tag + cleanup; cleanup fail returns `buildFailureResult`. `finally` always **asks** `restoreExportFolderEnv` and `resetLiveTestTransientWriteFailures`.

`HARNESS_ACTOR` is the system actor this file stamps on destinations and seeded runs. It is not a seventh owner operation. `formatHarnessEvidenceForLog` **asks** `sanitizeLiveTestLogDetail`. It is not an eighth owner operation.

## Organization

Keep one file. This is the screenplay for “prove live Google delivery on a dedicated owner folder — never a service account, never the queue — then tag and trash only those harness folders and return masked evidence.” Seed, denylist, security, OAuth adapters, picker contract, synthetic page, inject, mask, later janitor, official worker, official queue, official destination desk, and official cleanup already live in deeper **modules**. Do not pull those in. Do not invent a `LiveGoogleHarnessService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second queue **adapter** beside `publishReportingWakeup`. Do not invent a second official cleanup **adapter** beside `cleanup.ts`.

Do not split skip / deliver / trash into CRUD files. Skip stays with deliver because the same export-folder env snapshot must restore after either path. Do not start `publishReportingWakeup` from this file. Do not move `LIVE_TEST_HARNESS_LIMITATION` here so “the orchestrator owns the limitation sentence.” Do not restore the default snapshot adapter in this rename unless a later tested change says so.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runLiveGoogleOrchestration` | `proveLiveGoogleDeliveryOnADedicatedOwnerFolder` | facade + script + skip test |
| `formatHarnessEvidenceForLog` | `writeMaskedHarnessEvidenceForTheLog` | script + PII log test |
| `LiveGoogleHarnessResult` | `LiveGoogleProofResult` | facade + script |
| `LiveGoogleHarnessStep` | `OneBeatOfTheLiveGoogleProof` | evidence bag |

Keep the old names as one-line aliases until `live/liveGoogleHarness.ts`, `scripts/reporting/run-live-google-harness.ts`, and `live/liveGoogleHarness.test.ts` migrate. Do not make the script learn `proveLiveGoogleDeliveryOnADedicatedOwnerFolder` instead of `runLiveGoogleHarness`. Do not make official confirm learn this file as the live path. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the proof bag the script already prints:

```ts
type LiveGoogleProofResult = {
  ok: boolean
  skipped: boolean
  skipReason?: string
  runTag: string
  artifactIds: string[]
  evidence: MaskedLiveTestEvidence
}
```

That is the handoff from “the operator asked for a live Google proof” to “here is a masked answer, or a skip.” Do **not** put official `ZZ1` / `ZY1` on this type. Do **not** put `REPORTING_FAILURE_CODES` on this type. Do **not** put a queue wake-up on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveGoogleOrchestration.ts
// If live Google testing is on, prove we are the owner
// on a dedicated export folder — never a service account,
// never live-account identity.
// Refuse a denylisted operational workbook.
// Then actually deliver a replace-tab report onto real Google,
// read the published tab back,
// and prove a failed replacement leaves that tab.
// Then actually deliver a snapshot report.
// If we inject a transient write failure,
// the worker must resume and still complete.
// Call the worker in this process.
// Do not publish a queue wakeup.
// Do not hit HTTP. Do not run cron.
// Paint synthetic rows, not live Form Lead page content.
// Then tag the harness folders and trash only those folders.
// If anything fails, still try to tag and trash.
// Always restore the export-folder env.
// Return masked evidence — never raw file IDs,
// never customer fields.

const theSystemActorThatStampsThisProof = {
  actor_type: "system",
  actor_id: "reporting-live-google-harness",
  actor_label: "Reporting Live Google Harness",
  actor_role: "system",
  request_id: "reporting-live-google-harness",
  origin: "reporting_projection",
}
const HARNESS_ACTOR = theSystemActorThatStampsThisProof
const LIVE_TEST_PUBLISHED_TITLE = "Live Test Report"

// ── 1. Skip unless owner OAuth and a dedicated export folder ─

export async function proveLiveGoogleDeliveryOnADedicatedOwnerFolder()
  // ask validateReportingLiveTestPrerequisites
  // missing / not enabled → return skipWithoutCallingGoogle
  // snapshotExportFolderEnv
  // rejectServiceAccountCredentialsForLiveTest
  // live-account identity-separation assert
  // connectMongo; registerReportingStage4Foundation
  // registerSyntheticLiveTestSnapshotAdapter  // never restores default
  // seedLiveTestCanonicalFormLeads
  // getGoogleDriveAccessTokenHealth; assertLiveTestOAuthPrincipal
  // validateDedicatedExportRoot
  // applyLiveTestExportFolderEnv
  // then operations 2–6
  // catch: still tag + trash
  // finally: restoreExportFolderEnv; resetLiveTestTransientWriteFailures

export const runLiveGoogleOrchestration =
  proveLiveGoogleDeliveryOnADedicatedOwnerFolder

function skipWithoutCallingGoogle(reason, steps)
export const skippedResult = skipWithoutCallingGoogle

// ── 2. Prove the denylist refuses a operational destination ─

async function proveTheDenylistRefusesAnOperationalDestination(config, runTag)
  // ask the denylist proof sibling
  // not ok → throw

// ── 3. Deliver a replace-tab report and read the tab back ─

async function deliverAReplaceTabReportAndReadThePublishedTabBack(...)
  // createReportingDestination replace_tab
  // buildValidatedDestinationSnapshot
  // runLivePickerServerContractTests when workbook id exists
  // registerSyntheticLiveTestManifestPageAdapter(liveTestSyntheticRows)
  // seedLiveTestQueuedRun
  // keepAskingTheWorkerUntilTheRunIsTerminal
  // loadReportingDelivery must be completed
  // readThePublishedTabBack must have sheetId + more than a header

async function keepAskingTheWorkerUntilTheRunIsTerminal(runId, sheets, drive)
  // up to 8 asks of runReportingDeliveryWorker({ runHint })
  // stop on completed / failed / cancelled
  // unclaimed → wait 150ms
export const runWorkerToTerminal = keepAskingTheWorkerUntilTheRunIsTerminal

async function readThePublishedTabBack(sheets, workbookId, publishedTitle)
  // listSheets; visible title match; readValues 1..10 × 1..5
export const readPublishedTabSnapshot = readThePublishedTabBack

// ── 4. Prove a failed replacement leaves the prior tab ─

async function proveAFailedReplacementLeavesThePriorPublishedTab(...)
  // registerSyntheticLiveTestManifestPageAdapter({ emitRowCount: 1 })
  // seedLiveTestQueuedRun on the same snapshot
  // keepAskingTheWorkerUntilTheRunIsTerminal
  // worker failed AND sheet id / title / values still match

// ── 5. Deliver a snapshot — or inject a blip and prove resume ─

async function deliverASnapshotReportAndProveATransientWriteResumes(...)
  // createReportingDestination snapshot
  // seedLiveTestQueuedRun
  // inject > 0 → configureLiveTestTransientWriteFailures
  //   one runReportingDeliveryWorker; mid-run not terminal
  //   keepAskingTheWorkerUntilTheRunIsTerminal must complete
  // inject === 0 → keepAskingTheWorkerUntilTheRunIsTerminal once
  //   mark transient_retry_resume skipped

// ── 6. Tag, trash only harness folders, return masked evidence ─

async function tagAndTrashOnlyTheHarnessFoldersThenReturnMaskedEvidence(...)
  // recordLiveTestHarnessRun
  // tagHarnessContainerFolder each container
  // cleanupLiveTestHarnessContainers
  // cleanup failed → throw
  // buildMaskedLiveTestEvidence

function answerThatTheProofFailed(runTag, artifactIds, cleanupOutcome, steps)
export const buildFailureResult = answerThatTheProofFailed

export function writeMaskedHarnessEvidenceForTheLog(evidence)
  // JSON.stringify(sanitizeLiveTestLogDetail(evidence))
export const formatHarnessEvidenceForLog =
  writeMaskedHarnessEvidenceForTheLog
```

Read the primary path out loud: *If live testing is off or the dedicated folder is missing, skip without calling Google. Otherwise refuse a service account, prove we are the owner on that folder, and refuse a denylisted operational workbook. Create a replace-tab destination, prove picker, seed a queued run, call the worker in this process until the run is done, and read the published tab back. Seed a second run that must fail and leave that tab. Create a snapshot destination, seed a queued run, and either complete it once or inject a transient write failure and prove resume. Record the harness run, tag the folders, trash only those folders, restore the export-folder env, and return masked evidence. Never publish a queue wakeup. Never hit HTTP. Never run cron. Never paint live Form Lead page content.*

That is the operation. `runLiveGoogleOrchestration` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two trash implementations.** Success path and catch path both tag containers then **ask** `cleanupLiveTestHarnessContainers`. One story, two copies. Shared beat: tag then trash. Only whether we return success evidence or `buildFailureResult` differs.

2. **`skippedResult` first argument lies.** Callers pass the string `"skipped"` as `runTag`. The skip bag’s `runTag` is not a live-test tag. Name the helper `skipWithoutCallingGoogle(reason, steps)` and stop pretending the first arg is a run tag.

3. **`formatHarnessEvidenceForLog` is a pass-through.** It only `JSON.stringify`s `sanitizeLiveTestLogDetail`. Keep the export as an alias. Do not add a second sanitizer here.

4. **`registerSyntheticLiveTestSnapshotAdapter` never restores the default.** Already noted on [`reporting-snapshot-adapter.md`](reporting-snapshot-adapter.md). Rename the beat so the missing restore is visible. Do not silently restore in this pass.

5. **`runWorkerToTerminal` is executor mechanics.** “Keep asking the worker until the run is terminal” is the decision. Max 8 / wait 150ms on unclaimed stay inside the parent. Do not extract a retry class.

6. **The script connects Mongo, then this file connects Mongo again.** Wave B `run-live-google-harness.ts` **asks** `connectMongo().catch(() => undefined)` before the facade. Do not “fix” the script in this rename.

7. **Do not silently start a queue wakeup.** Official confirm publishes after the run exists. This file seeds a queued row and **asks** the worker in-process. Teaching this file `publishReportingWakeup` so “every run uses the queue” would invent a **seam** this screenplay refuses.

8. **Leave sibling modules alone.** `seedLiveTestQueuedRun`, the denylist proof sibling, `createLiveTestGoogleAdapters`, `cleanupLiveTestHarnessContainers`, `buildMaskedLiveTestEvidence`, `runReportingDeliveryWorker`, `createReportingDestination` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `proveLiveGoogleDeliveryOnADedicatedOwnerFolder` (today `runLiveGoogleOrchestration` / facade `runLiveGoogleHarness`) and `writeMaskedHarnessEvidenceForTheLog`.

Today’s `liveGoogleHarness.test.ts` proves skip-closed when the export root is absent, service-account reject (via config sibling), PII mask, run-tag uniqueness, live-test appProperties, transient-failure arithmetic, and janitor-positive-mark. That is not enough for a story this long, but the happy path needs real owner OAuth and must stay off the default unit suite.

Replace the stub style with tests that name the operation:

**Skip**
- Missing export root / missing OAuth env → `skipped: true`, `ok: false`, no Drive, no Mongo write.
- `REPORTING_LIVE_TEST_ENABLED` not true → same skip.
- Service-account env present → throw before destination create.

**Limitation (unit, no live Google)**
- Evidence always carries `LIVE_TEST_HARNESS_LIMITATION` (synthetic rows; in-process worker; no HTTP / cron / queue consumer).
- `formatHarnessEvidenceForLog` never contains `customer_name` / `lead_email` / `phone`.
- `artifactIds` on success are container folder ids, not nested workbook ids.

**Live path (existing `pnpm reporting:live-google-harness` only)**
- Denylist workbook is refused with `OPERATIONAL_WORKBOOK`.
- Replace-tab worker + delivery complete; published tab readback has more than a header.
- Failed replacement leaves sheet id / title / values.
- Snapshot completes; when inject > 0, first attempt is not terminal and resume completes.
- Cleanup outcome is `completed`; export-folder env is restored.

Do **not** add a test per helper (`keepAskingTheWorkerUntilTheRunIsTerminal`, `readThePublishedTabBack`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official confirm, official queue publish, official cleanup janitor, Analytics, or Sheet Sync inside these tests. Official worker proofs stay `reportingDelivery.test.ts`. Official queue stays untested here on purpose.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveGoogleHarnessService` class or a `run.ts` / `skip.ts` / `cleanup.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second queue **adapter** beside `publishReportingWakeup`.
- I would not invent a second official cleanup **adapter** beside `cleanup.ts`.
- I would not pull seed, denylist, security, OAuth adapters, picker, synthetic page, inject, mask, later janitor, official worker, official destination desk, or official Drive trash into this file.
- I would not silently start `publishReportingWakeup` from this file.
- I would not silently restore the default snapshot adapter.
- I would not silently merge live trash with official `cleanup.ts`.
- I would not open `live/liveTestRunFactory.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
