# Remember Which Harness Folders This Live-Test Run Created Under The Dedicated Export Root — So Later Janitor Can Trash Only Those Folders — Never A Drive Listing Alone — Record Always Starts Pending — Mark Needs Janitor When In-Process Trash Fails — Mark Completed Only When Every Registered Folder Is Gone — Refuse A Copied-Marker Sibling — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 40 of this service — `live/liveTestHarnessRunRegistry.ts`
- Remaining in this service: `live/syntheticLiveTestManifest.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestHarnessRunRegistry.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `recordLiveTestHarnessRun`, `getLiveTestHarnessRun`, `listJanitorEligibleHarnessRunTags`, `isJanitorContainerAuthorized`, `assertRegistryContainerBinding`, `isJanitorEligibleCleanupStatus`, `markLiveTestHarnessRunNeedsJanitor`, `markLiveTestHarnessRunCleanupCompleted`, `reporting_live_test_harness_runs`, `pending` / `needs_janitor` / `completed`, or a live-test harness-run registry — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** `recordLiveTestHarnessRun` before stamp, then trash-the-set; catch stamps again then **asks** trash-the-set; trash-the-set **asks** record again). Distinct from already-recommended stamp / trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (trash-the-set **asks** record / mark-needs / mark-completed; later janitor **asks** confirmed-trash only). Distinct from already-recommended refuse / trash fence: [`reporting-live-test-security.md`](reporting-live-test-security.md) (fence **asks** `isJanitorContainerAuthorized`; fence never writes this collection). Distinct from already-recommended official janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (failed / cancelled `ReportingDelivery` trash; never **asks** this file). Distinct from already-recommended official Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`trashFile` **asks** official run match; never **asks** this collection). Distinct from already-recommended tell: [`reporting-reporting-observability.md`](reporting-reporting-observability.md) (later janitor **asks** `recordReportingLiveTestJanitorOutcome`; this file never tells). Distinct from unvisited later janitor: `live/testArtifactJanitor.ts` (Wave B `/api/cron/reporting-test-artifact-janitor` **asks** later janitor; later janitor **asks** list / get / mark-needs / mark-completed; later-janitor select **asks** authorized run tags from this list). Distinct from unvisited evaluate: `live/janitorCompletion.ts` (trash-the-set **asks** `evaluateRegisteredContainersCleanup`; later janitor **asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned` with `getHarnessRun: getLiveTestHarnessRun` and `markCompleted` wrapping this mark-completed; evaluate never writes this collection). Distinct from unvisited mask: `live/piiSafeEvidence.ts`. Distinct from unvisited synthetic page / retry wrapper. Distinct from already-recommended picker contract: [`reporting-live-picker-contract-runner.md`](reporting-live-picker-contract-runner.md) (never **asks** this file). Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (later-janitor age-select **asks** `isPositivelyMarkedHarnessContainer`; this file never ages a folder). Distinct from Wave B `src/routes/reporting-cron.routes.ts` (`/api/cron/reporting-test-artifact-janitor` **asks** later janitor, not this file). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). There is no Mongoose model for `reporting_live_test_harness_runs`. This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** `recordLiveTestHarnessRun` with `runTag`, `config.exportRootFolderId`, container folder ids, and no `harnessOutcome`; success path and catch path both **ask** trash-the-set, which **asks** record again). Already-recommended `live/liveTestCleanup.ts` (**asks** record; **asks** mark-needs on nested-artifact refuse or when evaluate is not all-cleaned and trash-the-set failed; **asks** mark-completed when evaluate says every registered folder is gone). Already-recommended `live/liveTestSecurity.ts` (**asks** `isJanitorContainerAuthorized` inside `assertHarnessContainerSafeToTrash`; unauthorized → refuse). Unvisited `live/testArtifactJanitor.ts` (**asks** `listJanitorEligibleHarnessRunTags` for the export root; **asks** `getLiveTestHarnessRun` per eligible folder; missing record → errors += 1 and skip trash; trash fail **asks** mark-needs; then **asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned` with this get and this mark-completed). Unvisited `live/janitorCompletion.ts` receives this get / this mark-completed as injected adapters. Deprecated `listPendingLiveTestHarnessRunTags` / `isRunTagAuthorizedForJanitor` have **no caller**. Tests: `live/liveTestReleaseSafety.test.ts` **asks** `isJanitorEligibleCleanupStatus` and `assertRegistryContainerBinding` only (pending / needs_janitor eligible; completed not; copied-marker sibling refuse; export-root mismatch refuse). That test file also **asks** denylist interpret / picker parent mismatch / env snapshot — those are sibling **interfaces**. `live/liveTestSecurity.test.ts` does not import this file. `live/testArtifactJanitor.test.ts` **asks** later-janitor select with an injected `authorizedRunTags` set, not this list. `live/janitorCompletion.test.ts` **asks** classify, not this file. `live/liveGoogleHarness.test.ts` / `reporting.test.ts` do not import this file. Owner HTTP never **asks** this file. Official janitor never **asks** this file. **No HTTP route** mounts this file. **No Mongoose model** owns this collection.
- Seams callers need: remember-this-live-test-harness-run (`recordLiveTestHarnessRun`) vs refuse-unless-this-folder-is-registered-for-this-run-under-this-export-root (`assertRegistryContainerBinding` / `isJanitorContainerAuthorized`) vs list-and-load-runs-still-needing-later-janitor (`listJanitorEligibleHarnessRunTags` / `getLiveTestHarnessRun`) vs mark-needs-later-janitor-or-mark-cleanup-completed (`markLiveTestHarnessRunNeedsJanitor` / `markLiveTestHarnessRunCleanupCompleted`). The record / trash-the-set **seam** exists because orchestration **asks** record before stamp, then trash-the-set **asks** record again and always `$set`s `cleanup_status: "pending"`. The assert / boolean **seam** exists because tests **ask** assert; trash fence **asks** authorized (assert then catch → false). The authorized / deprecated-weaker-authorize **seam** exists because `isRunTagAuthorizedForJanitor` checks export root + eligible status and never the container folder id; no caller **asks** it. The list / later-janitor-select **seam** exists because later janitor **asks** this list for authorized run tags, then age-selects Drive children; this file never lists Drive. The mark / evaluate **seam** exists because evaluate never writes; trash-the-set and later janitor **ask** this mark after evaluate. The this-collection / official-ReportingRun **seam** exists because this is raw `reporting_live_test_harness_runs`, not a `ReportingRun` and not a Mongoose model. The this-file / official-janitor **seam** exists because official `cleanup.ts` never **asks** this collection. There is no begin / complete Domain Command **seam**. There is no `files.update` `{ trashed: true }` **seam**. There is no worker **seam**. There is no HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as remember which harness folders this live-test run created under the dedicated export root, so later janitor can trash only those folders — never a Drive listing alone. Record always starts pending. Mark needs janitor when in-process trash fails. Mark completed only when every registered folder is gone. Refuse a copied-marker sibling. Do **not** split into `record.ts` / `get.ts` / `list.ts` / `mark.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull orchestration, trash-the-set, trash fence, later janitor, or evaluate here so “one registry file owns the company.” If it later splits: `rememberThisLiveTestHarnessRun.ts` / `refuseUnlessThisFolderIsRegisteredForThisRunUnderThisExportRoot.ts` / `listRunTagsStillNeedingLaterJanitor.ts` / `markTheRunNeedsLaterJanitorOrCleanupCompleted.ts` only as later story files, never CRUD.

`recordLiveTestHarnessRun` / `getLiveTestHarnessRun` / `listJanitorEligibleHarnessRunTags` / `isJanitorContainerAuthorized` / `assertRegistryContainerBinding` / `markLiveTestHarnessRunNeedsJanitor` / `markLiveTestHarnessRunCleanupCompleted` are executor mechanics. The owner question is: *After live Google testing creates harness folders under the dedicated export root, remember those folder ids on this run tag so later janitor can trash only those folders. Do not trust a Drive listing alone. Do not trash a copied-marker sibling that is not on the list. Record always starts pending. If in-process trash fails, mark the run needs later janitor. Mark completed only when evaluate says every registered folder is gone. Do not start the worker. Do not trash a folder from this file. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended orchestration, stamp / trash-the-set, refuse / trash fence, official janitor, official Drive trash, and tell already live in other **modules**. Later janitor, evaluate, mask, synthetic page, retry wrapper, and Wave B config stay sibling **modules**. Do not pull those in.

## What this file actually does

Four operations of one “remember which harness folders this live-test run created under the dedicated export root, so later janitor can trash only those folders” story, not “a harness-run CRUD helper,” and not trash-the-set / later janitor / trash fence:

1. **Remember this live-test harness run** — `recordLiveTestHarnessRun`. **Asks** `connectMongo`. Upserts `reporting_live_test_harness_runs` on `run_tag`. Always `$set`s `cleanup_status: "pending"`, the export root, unique `container_folder_ids`, and `updated_at`. `$setOnInsert` `created_at`. Optional `harnessOutcome` is written only when passed; no current caller passes it. An empty container set still writes the row.

2. **Refuse unless this folder is registered for this run under this export root** — `isJanitorEligibleCleanupStatus` + `assertRegistryContainerBinding` + `isJanitorContainerAuthorized`. Eligible is `pending` or `needs_janitor` only. Assert throws on export-root mismatch, a status that is not eligible, or a folder id missing from `container_folder_ids`. Authorized **asks** get; a missing row → `false`; an assert throw → `false`. Trash fence **asks** authorized. `liveTestReleaseSafety.test.ts` **asks** eligible and assert. Deprecated `isRunTagAuthorizedForJanitor` checks export root + eligible status and never the folder id; no caller.

3. **List and load runs still needing later janitor** — `listJanitorEligibleHarnessRunTags` / `getLiveTestHarnessRun`. List filters `cleanup_status ∈ { pending, needs_janitor }` and an optional `export_root_folder_id`. Returns trimmed `run_tag` strings and drops blanks. Get maps the raw row or returns `null`. Later janitor **asks** both. Deprecated `listPendingLiveTestHarnessRunTags` is the same function as list eligible.

4. **Mark the run needs later janitor, or mark cleanup completed** — `markLiveTestHarnessRunNeedsJanitor` / `markLiveTestHarnessRunCleanupCompleted`. Each **asks** `connectMongo` and `$set`s status + `updated_at` on `run_tag`. Neither checks `matchedCount`. Trash-the-set **asks** mark-needs on nested-artifact refuse, or when evaluate is not all-cleaned and trash failed. Trash-the-set **asks** mark-completed when evaluate says every registered folder is gone. Later janitor **asks** mark-needs on trash fail and mark-completed through evaluate.

`LiveTestHarnessRunRecord` / `LiveTestHarnessCleanupStatus` are the bag callers already read, not extra owner operations.

## Organization

Keep one file. This is the screenplay for “remember which harness folders this live-test run created under the dedicated export root.” Orchestration, trash-the-set, trash fence, later janitor, and evaluate already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestHarnessRunRegistryService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second trash-fence **adapter** beside `assertHarnessContainerSafeToTrash`. Do not invent a second evaluate **adapter** beside `evaluateRegisteredContainersCleanup`. Do not invent a Mongoose model in this rename.

Do not split record / get / list / mark into CRUD files. Record stays with mark because trash-the-set **asks** record then mark. Do not move trash fence here so “the registry owns refuse.” Do not move later janitor here so “the registry owns Drive list.” Do not start `files.update` from this file so “the registry can trash.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `recordLiveTestHarnessRun` | `rememberThisLiveTestHarnessRun` | orchestration + trash-the-set |
| `isJanitorEligibleCleanupStatus` | `decideWhetherThisCleanupStatusStillNeedsLaterJanitor` | assert + release-safety test |
| `assertRegistryContainerBinding` | `refuseUnlessThisFolderIsRegisteredForThisRunUnderThisExportRoot` | authorized + release-safety test |
| `isJanitorContainerAuthorized` | `decideWhetherLaterJanitorMayTrashThisContainer` | trash fence |
| `listJanitorEligibleHarnessRunTags` | `listRunTagsStillNeedingLaterJanitor` | later janitor select |
| `getLiveTestHarnessRun` | `loadThisRememberedHarnessRun` | later janitor + evaluate inject |
| `markLiveTestHarnessRunNeedsJanitor` | `markTheRunNeedsLaterJanitor` | trash-the-set + later janitor fail |
| `markLiveTestHarnessRunCleanupCompleted` | `markTheRunCleanupCompleted` | trash-the-set + evaluate inject |

Keep `listPendingLiveTestHarnessRunTags` as a one-line alias of `listJanitorEligibleHarnessRunTags` until no import remains (today none). Keep `isRunTagAuthorizedForJanitor` as a one-line alias of a weaker check until callers migrate (today none). Keep `LiveTestHarnessRunRecord` until later janitor / evaluate migrate. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the bag trash fence and later janitor already read:

```ts
type RememberedLiveTestHarnessRun = {
  run_tag: string
  export_root_folder_id: string
  container_folder_ids: string[]
  cleanup_status: "pending" | "needs_janitor" | "completed"
}
```

That is the handoff from “we created these folders on this run” to “later janitor may trash only those folders.” Do **not** put Drive metadata on this type. Do **not** put `trashed: true` on this type. Do **not** put official `ReportingRun` ids on this type as the key — the key is `run_tag`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestHarnessRunRegistry.ts
// After live Google testing creates harness folders
// under the dedicated export root, remember those
// folder ids on this run tag.
// Later janitor may trash only those folders.
// Do not trust a Drive listing alone.
// Do not trash a copied-marker sibling.
// Record always starts pending.
// If in-process trash fails, mark needs later janitor.
// Mark completed only when every registered folder is gone.
// Do not start the worker.
// Do not trash a folder from this file.

// ── 1. Remember this live-test harness run ───────────────

export async function rememberThisLiveTestHarnessRun(input)
  // connectMongo
  // upsert reporting_live_test_harness_runs on run_tag
  // always $set cleanup_status pending
  // unique container_folder_ids
  // harnessOutcome accepted and almost never written
export const recordLiveTestHarnessRun = rememberThisLiveTestHarnessRun

// ── 2. Refuse unless this folder is registered ───────────

export function decideWhetherThisCleanupStatusStillNeedsLaterJanitor(status)
  // pending | needs_janitor → true; completed → false
export const isJanitorEligibleCleanupStatus =
  decideWhetherThisCleanupStatusStillNeedsLaterJanitor

export function refuseUnlessThisFolderIsRegisteredForThisRunUnderThisExportRoot(input)
  // export root mismatch → throw
  // status not eligible → throw
  // folder id not on the list → throw
export const assertRegistryContainerBinding =
  refuseUnlessThisFolderIsRegisteredForThisRunUnderThisExportRoot

export async function decideWhetherLaterJanitorMayTrashThisContainer(input)
  // loadThisRememberedHarnessRun
  // missing → false
  // assert throw → false
export const isJanitorContainerAuthorized =
  decideWhetherLaterJanitorMayTrashThisContainer

// ── 3. List and load runs still needing later janitor ────

export async function listRunTagsStillNeedingLaterJanitor(input?)
  // pending | needs_janitor; optional export root
export const listJanitorEligibleHarnessRunTags =
  listRunTagsStillNeedingLaterJanitor
export const listPendingLiveTestHarnessRunTags =
  listJanitorEligibleHarnessRunTags

export async function loadThisRememberedHarnessRun(runTag)
export const getLiveTestHarnessRun = loadThisRememberedHarnessRun

// ── 4. Mark needs later janitor, or mark completed ───────

export async function markTheRunNeedsLaterJanitor(input)
export const markLiveTestHarnessRunNeedsJanitor = markTheRunNeedsLaterJanitor

export async function markTheRunCleanupCompleted(input)
export const markLiveTestHarnessRunCleanupCompleted = markTheRunCleanupCompleted
```

Read the primary path out loud: *Remember this run tag, this export root, and these container folder ids. Status starts pending. When in-process trash fails, mark needs later janitor. When evaluate says every registered folder is gone, mark completed. Later janitor lists only pending and needs-janitor tags for that export root. Trash fence refuses a copied-marker sibling that is not on the list. Never trash from this file. Never list Drive from this file. Never start the worker.*

That is the operation. `recordLiveTestHarnessRun` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Record always resets to pending.** Orchestration **asks** record, then trash-the-set **asks** record again and `$set`s `cleanup_status: "pending"`. A later re-record of a completed run would un-complete it. Cleanup already named the second record. Rename the reset. Do not silently stop resetting so “callers own status” without a paired test.

2. **`harnessOutcome` is a lie.** Record accepts it. No caller passes it. Rename the unused argument. Do not silently start writing `passed` / `failed` / `skipped` from orchestration so “the field starts working.”

3. **Mark is a silent no-op on a missing row.** Neither mark checks `matchedCount`. Later janitor **asks** mark-needs after a trash fail even when get already returned null (the missing-record branch increments errors and continues; the catch branch marks). Rename the unmatched write. Do not silently throw on unmatched without a paired test.

4. **Get casts `cleanup_status` without a guard.** A corrupt row becomes whatever string Mongo stored. List hardcodes `pending` / `needs_janitor` instead of **asking** `isJanitorEligibleCleanupStatus`. Rename the split. Do not silently share one filter helper without a paired test.

5. **`listPendingLiveTestHarnessRunTags` lies.** The alias includes `needs_janitor`. No caller remains. Keep the alias. Do not silently delete it in this rename.

6. **`isRunTagAuthorizedForJanitor` is weaker and has no caller.** It never checks the container folder id. Trash fence **asks** the stronger authorized. Keep the deprecated export as an alias. Do not silently make the weak check walk folders so “one authorize owns both.”

7. **Authorized swallows every assert throw as false.** Export-root mismatch, ineligible status, and unregistered folder all become the same `false`. Trash fence then throws one refuse string. Rename the collapse. Do not silently rethrow from authorized so “callers see the reason” without a paired test.

8. **Raw collection, no unique index, no model.** Upsert keys on `run_tag` only. Nothing in `src/models/` declares `reporting_live_test_harness_runs`. Rename the missing schema. Do not silently add a Mongoose model in this rename.

9. **Empty folder-id list still records.** Record does not drop blank ids. Trash-the-set skips record only when the unique container set is empty. Mixed `runTag` values on the same trash-the-set collapse onto `uniqueContainers[0].runTag`. Rename the first-tag collapse. Do not silently refuse mixed tags without a paired test.

10. **No test **asks** record, get, list, mark, or authorized.** Release-safety **asks** eligible and assert only. Later-janitor tests inject `authorizedRunTags`. That is not enough for a story that upserts Mongo and is the only list later janitor trusts.

11. **Leave sibling modules alone.** `cleanupLiveTestHarnessContainers`, `assertHarnessContainerSafeToTrash`, `runTestArtifactJanitor`, and `evaluateRegisteredContainersCleanup` are already the right **depth**. This file remembers, refuses a copied-marker sibling, lists tags still needing later janitor, and marks.

## Testing

The **interface** is the test surface: `rememberThisLiveTestHarnessRun`, `refuseUnlessThisFolderIsRegisteredForThisRunUnderThisExportRoot`, `decideWhetherLaterJanitorMayTrashThisContainer`, `listRunTagsStillNeedingLaterJanitor`, `loadThisRememberedHarnessRun`, `markTheRunNeedsLaterJanitor`, `markTheRunCleanupCompleted` (today `recordLiveTestHarnessRun` / `assertRegistryContainerBinding` / `isJanitorContainerAuthorized` / `listJanitorEligibleHarnessRunTags` / `getLiveTestHarnessRun` / `markLiveTestHarnessRunNeedsJanitor` / `markLiveTestHarnessRunCleanupCompleted`).

Today `liveTestReleaseSafety.test.ts` proves eligible status and assert refuse. It does **not** **ask** record, get, list, mark, or authorized. That is not enough for a story that upserts Mongo.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Remember**
- Upsert on `run_tag` writes pending and unique folder ids.
- A second record on the same tag resets status to pending.
- `harnessOutcome` may be omitted and the row still writes.

**Refuse**
- Copied-marker sibling throws.
- Export-root mismatch throws.
- Completed status is not eligible.
- Authorized is false when get returns null.
- Authorized is false when assert throws.

**List / load**
- List returns pending and needs_janitor tags for that export root.
- List omits completed.
- Get maps the row or returns null.

**Mark**
- Mark-needs writes `needs_janitor`.
- Mark-completed writes `completed`.
- Mark on a missing tag does not throw today (name the silent no-op). Do not silently throw in this rename.
- Worker / `files.update` `{ trashed: true }` / Drive `files.list` are not **asked**.

Do **not** add a test per helper (`connectMongo`, the `Set` fold, the catch in authorized). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official janitor, worker, queue publish, Analytics, or Sheet Sync inside these tests. Trash-fence refuse stays `liveTestSecurity.test.ts`. Later-janitor select stays `testArtifactJanitor.test.ts`. Evaluate classify stays `janitorCompletion.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/config/domain/reportingLiveTest.ts`, `src/routes/reporting-cron.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestHarnessRunRegistryService` class or a `record.ts` / `get.ts` / `list.ts` / `mark.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second trash-fence **adapter** beside `assertHarnessContainerSafeToTrash`.
- I would not invent a second evaluate **adapter** beside `evaluateRegisteredContainersCleanup`.
- I would not silently add a Mongoose model for `reporting_live_test_harness_runs`.
- I would not silently start writing `harnessOutcome`.
- I would not silently throw when mark matches zero rows.
- I would not silently delete `listPendingLiveTestHarnessRunTags` or `isRunTagAuthorizedForJanitor`.
- I would not silently merge this file with `live/testArtifactJanitor.ts` or `live/liveTestCleanup.ts`.
- I would not silently start `files.update` `{ trashed: true }` from this file.
- I would not open `live/syntheticLiveTestManifest.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
