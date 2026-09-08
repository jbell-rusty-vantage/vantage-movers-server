# Refetch Every Folder This Registry Still Lists For This Run; Mark That Pending Or Needs-Janitor Run Completed Only When Drive Says Each One Is Gone — Trashed Or Confirmed 404 — Never On 403, Never On A Transient Error, Never From A Drive Listing Alone, Never By Trashing — operational story

- Status: recommended
- Service: `reporting` (Wave A, visited)
- Pass: 46 of this service — `live/janitorCompletion.ts`
- Remaining in this service: none (`reporting` visited)
- Target: `src/services/reporting/live/janitorCompletion.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `markJanitorEligibleRunsCompletedWhenFullyCleaned`, `evaluateRegisteredContainersCleanup`, `refetchRegisteredContainerCleanupState`, `classifyRegisteredContainerRefetch`, `mapDriveMetadataErrorToCleanupState`, `areAllRegisteredContainersCleaned`, `isRegisteredContainerCleaned`, `RegisteredContainerCleanupState`, `cleaned_trashed`, `cleaned_not_found`, `refetch_blocked`, or later-evaluate — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended later janitor: [`reporting-test-artifact-janitor.md`](reporting-test-artifact-janitor.md) (Wave B `/api/cron/reporting-test-artifact-janitor` **asks** later janitor; later janitor **asks** this mark after the trash loop and ignores the returned completed tags; this file never lists Drive children, never **asks** the fence, never `files.update`). Distinct from already-recommended stamp / trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (trash-the-set **asks** this evaluate on the in-memory unique folder ids, then **asks** registry mark-completed / mark-needs itself — it never **asks** this mark; confirmed-trash **asks** leftover `refetchDriveFileMetadata` and throws if not `trashed`; this refetch **asks** leftover `fetchDriveFileMetadata` so 404 / 403 classify). Distinct from already-recommended registry: [`reporting-live-test-harness-run-registry.md`](reporting-live-test-harness-run-registry.md) (this mark **asks** injected get + mark-completed; trash-the-set **asks** those registry exports directly; this file never writes Mongo). Distinct from already-recommended leftover Drive metadata: [`google-drive-oauth-drive-metadata.md`](google-drive-oauth-drive-metadata.md) (this refetch **asks** leftover `fetchDriveFileMetadata` / leftover confirmed-404 / leftover refetch-blocked; leftover metadata never classifies `cleaned_trashed`). Distinct from already-recommended leftover refuse / leftover fence: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file never **asks** leftover fence). Distinct from already-recommended official leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (`runReportingCleanupJanitor` / `cleanupDeliveryArtifacts` trash failed or cancelled `ReportingDelivery` workbooks; never **asks** this file). Distinct from already-recommended official Drive trash: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`trashFile` **asks** spreadsheet MIME + official run match; this file never **asks** `drive.trashFile`). Distinct from already-recommended leftover tell: [`reporting-reporting-observability.md`](reporting-reporting-observability.md) (later janitor **asks** tell after this mark; this file never **asks** tell). Distinct from already-recommended leftover bag: [`reporting-pii-safe-evidence.md`](reporting-pii-safe-evidence.md) (this file never builds a bag). Distinct from Wave B `src/routes/reporting-cron.routes.ts` (cron **asks** later janitor, not this file). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/testArtifactJanitor.ts` (**asks** `markJanitorEligibleRunsCompletedWhenFullyCleaned` `{ drive, runTags: authorized ∪ touched, getHarnessRun: getLiveTestHarnessRun, markCompleted }` after the trash loop, including dry-run; discards the returned completed tags). Already-recommended `live/liveTestCleanup.ts` (**asks** `evaluateRegisteredContainersCleanup` `{ drive, containerFolderIds: uniqueContainers.map(folderId) }` after the trash loop; `allCleaned` → leftover `markLiveTestHarnessRunCleanupCompleted`; else if trash-the-set `failed` → leftover `markLiveTestHarnessRunNeedsJanitor`; empty unique set returns leftover `completed` **without** **asking** this file). `live/janitorCompletion.test.ts` **asks** `classifyRegisteredContainerRefetch` / `mapDriveMetadataErrorToCleanupState` / `areAllRegisteredContainersCleaned` only — never mark, never evaluate, never refetch. `live/liveGoogleHarness.test.ts` / `live/liveTestSecurity.test.ts` / `live/testArtifactJanitor.test.ts` / `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Orchestration never **asks** this file (it **asks** trash-the-set). Official leftover janitor never **asks** this file. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: classify-whether-this-registered-folder-is-gone (`classifyRegisteredContainerRefetch`) vs map-this-Drive-metadata-error-to-gone-or-blocked-or-throw (`mapDriveMetadataErrorToCleanupState`) vs refetch-this-registered-folder (`refetchRegisteredContainerCleanupState`) vs evaluate-whether-every-registered-folder-for-this-run-is-gone (`evaluateRegisteredContainersCleanup`) vs mark-janitor-eligible-runs-completed-only-when-every-registered-folder-is-gone (`markJanitorEligibleRunsCompletedWhenFullyCleaned`). The classify / refetch **seam** exists because classify is pure; refetch **asks** leftover `fetchDriveFileMetadata` then classify, or maps the throw. The error-map / throw **seam** exists because leftover confirmed 404 is `cleaned_not_found`, leftover refetch-blocked (401 / 403 / leftover `IntegrationError` / leftover `ServiceUnavailableError` / leftover incomplete metadata) is `refetch_blocked`, and anything else rethrows. The evaluate / mark **seam** exists because in-process trash-the-set **asks** evaluate then marks the registry itself; later janitor **asks** this mark, which **asks** evaluate then injected mark-completed. The this-file / leftover Drive-list **seam** exists because later janitor lists export-root children; this file only refetches ids the registry already listed. The this-file / leftover trash **seam** exists because confirmed-trash `files.update` `{ trashed: true }`; this file never writes Drive. The this-file / leftover official leftover janitor **seam** exists because `cleanup.ts` **asks** delivery workbooks. The injected get / mark **seam** exists because later janitor injects leftover registry get + leftover mark-completed; this file never imports the registry. The empty-list / all-cleaned **seam** exists because `Array.every` on `[]` is true; trash-the-set’s empty unique set never **asks** this file. There is no begin / complete Domain Command **seam**. There is no official `ReportingDelivery.status` **seam**. There is no worker write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~127-line file is one sitting if you read it as refetch every folder this registry still lists for this run, then mark that pending or needs-janitor run completed only when Drive says each one is gone — never on 403, never from a listing, never by trashing. Do **not** split into `classify.ts` / `evaluate.ts` / `mark.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull later janitor, trash-the-set, leftover fence, leftover registry persist, leftover metadata fetch, leftover official leftover janitor, leftover bag, or leftover tell here so “one evaluate file owns the company.” If it later splits: `classifyWhetherThisRegisteredFolderIsGone.ts` / `evaluateWhetherEveryRegisteredFolderForThisRunIsGone.ts` / `markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone.ts` only as later story files, never CRUD.

`markJanitorEligibleRunsCompletedWhenFullyCleaned` / `evaluateRegisteredContainersCleanup` are executor mechanics. The owner question is: *After later janitor or in-process trash-the-set has already tried to trash harness folders, look at every folder this registry still lists for that run. Refetch Drive. A folder is gone only when Drive says trashed or a confirmed 404. A 403 or a transient error is blocked — do not mark the run completed. If every registered folder is gone, and the run is still pending or needs_janitor, mark it completed. A missing registry row is skip, not complete. Never trash. Never list Drive children. Never trust later janitor’s Drive listing alone. Never hit Owner HTTP. Never sync the Master Sheet.*

Already-recommended later janitor, trash-the-set, leftover registry, leftover Drive metadata, leftover fence, leftover official leftover janitor, leftover bag, and leftover tell already live in other **modules**. Wave B cron stays Wave B. Do not pull those in.

## What this file actually does

Five operations of one “refetch every folder this registry still lists for this run, then mark that pending or needs-janitor run completed only when Drive says each one is gone” story, not “a janitor completion CRUD helper,” and not later janitor / trash-the-set:

1. **Classify whether this registered folder is gone, still there, or refetch-blocked** — `classifyRegisteredContainerRefetch`. Leftover `confirmedNotFound` → `cleaned_not_found`. Leftover `refetchBlocked` → `refetch_blocked`. Missing leftover metadata → `present`. Leftover `metadata.trashed` → `cleaned_trashed`, else `present`. Confirmed-404 wins if both flags are set. This beat does **not** fetch.

2. **Map this Drive metadata error to gone, blocked, or throw** — `mapDriveMetadataErrorToCleanupState`. Leftover `isDriveMetadataConfirmedNotFoundError` → `cleaned_not_found`. Leftover `isDriveMetadataRefetchBlockedError` → `refetch_blocked` (any leftover `UnauthorizedError` including 403, leftover `IntegrationError`, leftover `ServiceUnavailableError`, leftover `NotFoundError` + incomplete metadata). Anything else → `"throw"`. This beat does **not** fetch.

3. **Refetch this registered folder’s cleanup state** — `refetchRegisteredContainerCleanupState`. **Asks** leftover `fetchDriveFileMetadata`, then classify. Catch **asks** the error map; `"throw"` rethrows. This is the only Drive get in this file.

4. **Evaluate whether every registered folder for this run is gone** — `evaluateRegisteredContainersCleanup`. Sequential refetch per leftover `containerFolderIds`. Then `areAllRegisteredContainersCleaned`: a missing map entry defaults to `present` (not gone). `isRegisteredContainerCleaned` is `cleaned_trashed` or `cleaned_not_found` only. Trash-the-set **asks** this **seam** on the in-memory unique folder ids after the trash loop.

5. **Mark janitor-eligible runs completed only when every registered folder is gone** — `markJanitorEligibleRunsCompletedWhenFullyCleaned`. For each leftover run tag: injected get `null` → skip. Leftover `cleanup_status` not `pending` / `needs_janitor` → skip. Else **ask** evaluate on leftover `registry.container_folder_ids`. Leftover `allCleaned` → injected mark-completed and push the tag. Returns the completed tags. Later janitor **asks** this **seam** and discards the return. This file never **asks** leftover mark-needs.

`RegisteredContainerCleanupState` is the four-way folder answer, not an extra owner operation.

## Organization

Keep one file. This is the screenplay for “refetch every folder this registry still lists for this run, then mark that pending or needs-janitor run completed only when Drive says each one is gone.” Later janitor, trash-the-set, leftover registry, leftover Drive metadata, leftover fence, leftover official leftover janitor, leftover bag, and leftover tell already live in deeper **modules**. Do not pull those in. Do not invent a `JanitorCompletionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover evaluate **adapter** beside this file. Do not invent a second leftover `files.update` `{ trashed: true }` beside leftover confirmed-trash. Do not invent a second leftover official leftover-janitor **adapter** beside `cleanup.ts`.

Do not split classify / evaluate / mark into CRUD files. Mark stays with evaluate because mark **asks** evaluate on the registry list. Do not start leftover `runTestArtifactJanitor` from this file so “one later janitor owns evaluate.” Do not start leftover `cleanupLiveTestHarnessContainers` from this file so “one trash-the-set owns mark.” Do not start leftover `files.list` from this file so “evaluate owns the export-root scan.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateRegisteredContainersCleanup` | `evaluateWhetherEveryRegisteredFolderForThisRunIsGone` | in-process trash-the-set after the trash loop |
| `markJanitorEligibleRunsCompletedWhenFullyCleaned` | `markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone` | later janitor after the trash loop, including dry-run |

Keep `classifyRegisteredContainerRefetch` / `mapDriveMetadataErrorToCleanupState` / `areAllRegisteredContainersCleaned` / `isRegisteredContainerCleaned` / `refetchRegisteredContainerCleanupState` as one-line aliases until leftover tests migrate onto the two parent **seams**. Keep `RegisteredContainerCleanupState` until leftover tests and leftover trash-the-set migrate. Do not make Wave B cron learn `markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone`. Do not persist a new leftover harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the four-way folder answer evaluate already stores:

```ts
type RegisteredHarnessFolderCleanupState =
  | "cleaned_trashed"
  | "cleaned_not_found"
  | "present"
  | "refetch_blocked"
```

That is the handoff from “Drive already answered this folder id” to “mark may complete the run only when every registered id is `cleaned_trashed` or `cleaned_not_found`.” Do **not** put official `ReportingDelivery.status` on this type. Do **not** put a raw `fileId` on this type. Do **not** put leftover `cleanup_status` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// janitorCompletion.ts
// After later janitor or in-process trash-the-set
// has already tried to trash harness folders,
// look at every folder this registry still lists
// for that run.
// Refetch Drive.
// A folder is gone only when Drive says trashed
// or a confirmed 404.
// A 403 or a transient error is blocked —
// do not mark the run completed.
// If every registered folder is gone, and the run
// is still pending or needs_janitor, mark it completed.
// A missing registry row is skip, not complete.
// Never trash.
// Never list Drive children.
// Never trust later janitor’s Drive listing alone.

// -- 1. Classify whether this registered folder is gone --

export function classifyWhetherThisRegisteredFolderIsGone(input)
  // confirmed 404 -> cleaned_not_found
  // refetch blocked -> refetch_blocked
  // missing metadata / not trashed -> present
  // trashed -> cleaned_trashed
export const classifyRegisteredContainerRefetch =
  classifyWhetherThisRegisteredFolderIsGone

export function mapThisDriveMetadataErrorToGoneOrBlockedOrThrow(error)
  // leftover confirmed 404 / leftover refetch-blocked / else "throw"
export const mapDriveMetadataErrorToCleanupState =
  mapThisDriveMetadataErrorToGoneOrBlockedOrThrow

// -- 2. Evaluate whether every registered folder for this run is gone --

export async function evaluateWhetherEveryRegisteredFolderForThisRunIsGone(input)
  // sequential leftover fetchDriveFileMetadata per registered id
  // missing map entry defaults to present
export const evaluateRegisteredContainersCleanup =
  evaluateWhetherEveryRegisteredFolderForThisRunIsGone

// -- 3. Mark janitor-eligible runs completed only when every registered folder is gone --

export async function markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone(input)
  // missing registry -> skip
  // status not pending / needs_janitor -> skip
  // evaluate registry.container_folder_ids
  // allCleaned -> injected markCompleted
export const markJanitorEligibleRunsCompletedWhenFullyCleaned =
  markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone
```

Read the later-evaluate path out loud: *After later janitor has already scanned the export root and maybe trashed folders, take every run tag still pending or needs_janitor — plus any tag this walk touched. Skip a missing registry row. Skip a run already completed. Refetch Drive for every folder id the registry still lists. A folder is gone only when Drive says trashed or a confirmed 404. A 403 or a transient error is blocked. Mark the run completed only when every registered folder is gone. Never trash from this file. Never list Drive children. Never trust the export-root listing alone.*

That is the operation. `markJanitorEligibleRunsCompletedWhenFullyCleaned` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **An empty registered list is all-cleaned.** `areAllRegisteredContainersCleaned` on `[]` is `true`. Later janitor can flip `pending` → `completed` when leftover `container_folder_ids` is empty. In-process trash-the-set’s empty unique set returns leftover `completed` **without** **asking** this file and **without** leftover record. Name empty-list completes. Do **not** silently refuse empty lists in this rename so “empty means skip.”

2. **An unknown Drive error aborts the remaining run tags.** Refetch `"throw"` bubbles out of evaluate, then out of mark. Later tags in the same `runTags` array never get evaluated. Name abort-the-rest. Do **not** silently catch-and-continue so “one bad folder still marks the others.”

3. **The two folder lists are not the same list.** Trash-the-set **asks** evaluate on leftover `uniqueContainers` folder ids. Later janitor **asks** mark, which **asks** evaluate on leftover `registry.container_folder_ids`. A later walker that recorded more ids than this in-memory unique set can refuse complete while trash-the-set would have marked. Name the two lists. Do **not** silently make trash-the-set **ask** this mark so “one mark owns both walkers.”

4. **Missing registry is skip, not complete, and not needs-janitor.** Injected get `null` `continue`s. Later janitor can pass a touched tag whose row already vanished. Name the skip. Do **not** silently **ask** mark-needs here so “every miss writes needs_janitor.”

5. **Blocked refetch never writes needs-janitor.** `refetch_blocked` keeps leftover `allCleaned` false. Mark does not **ask** leftover mark-needs. The run stays `pending` or `needs_janitor` for the next cron. Name leave-it. Do **not** silently **ask** mark-needs on 403 so “blocked means needs janitor.”

6. **Later janitor discards the completed tags.** `runTestArtifactJanitor` awaits mark and ignores the `string[]`. The leftover bag’s leftover `janitor_status` is leftover trash-error all-or-nothing, not this return. Name discarded tags. Do **not** silently put the returned tags on the leftover bag so “the bag lists completed runs.”

7. **A missing map entry defaults to present.** `statesByFolderId.get(id) ?? "present"` is not gone. Evaluate always sets every id it was given, so this only bites the exported leftover `areAll` helper / leftover tests. Name missing-is-present. Do **not** silently default missing to cleaned.

8. **Tests never ask the parent seams.** Today leftover `janitorCompletion.test.ts` **asks** classify / map / leftover `areAll` only. No test **asks** mark with an injected get / mark. No test **asks** evaluate with a Drive fake. That is helper-unit style for a story that may write leftover `cleanup_status: "completed"`.

9. **Leave sibling modules alone.** Leftover `fetchDriveFileMetadata`, leftover `markLiveTestHarnessRunCleanupCompleted`, leftover `runTestArtifactJanitor`, leftover `cleanupLiveTestHarnessContainers`, leftover `assertHarnessContainerSafeToTrash`, leftover `cleanupDeliveryArtifacts`, leftover `drive.trashFile`, leftover `buildMaskedLiveTestEvidence`, and leftover `recordReportingLiveTestJanitorOutcome` are already the right **depth**. This file classifies, refetches, evaluates the registry list, then **asks** injected mark-completed. Do not open unvisited `ingestion` this pass.

## Testing

The **interface** is the test surface: `markJanitorEligibleRunsCompletedOnlyWhenEveryRegisteredFolderIsGone` (today `markJanitorEligibleRunsCompletedWhenFullyCleaned`) and `evaluateWhetherEveryRegisteredFolderForThisRunIsGone` (today `evaluateRegisteredContainersCleanup`).

Today leftover `janitorCompletion.test.ts` **asks** leftover classify / leftover map / leftover `areAll` only (confirmed 404 cleaned; 403 / leftover `IntegrationError` blocked; mixed cleaned + blocked is not all-cleaned; leftover partial then leftover next-run). Those leftover helper names exist so the parent reads. Replace the helper style with tests that name the operation. Use `TEST_MODE`. Inject get / mark / a Drive fake. Do not boot live Google.

**Evaluate**
- Registered ids all leftover `trashed` or leftover confirmed 404 → leftover `allCleaned: true`.
- One leftover `present` or leftover `refetch_blocked` → leftover `allCleaned: false`.
- Leftover empty id list → leftover `allCleaned: true`. Name that gap.
- Leftover unknown Drive error rethrows. Official leftover `cleanupDeliveryArtifacts` / leftover `drive.trashFile` / leftover `files.update` are not **asked**. Leftover `files.list` is not **asked**.

**Mark**
- Leftover `pending` / leftover `needs_janitor` + leftover `allCleaned` → injected mark-completed; tag appears in the return.
- Leftover get `null` → skip; mark-completed never **asked**.
- Leftover `cleanup_status: "completed"` → skip.
- Leftover 403 / leftover transient → mark-completed never **asked**; leftover mark-needs never **asked**.
- Leftover unknown Drive error on run A → leftover run B in the same array is not evaluated. Name that gap.
- Later janitor dry-run still **asks** this mark (already named on the later-janitor pass). Do not re-prove leftover dry-run here except as this **seam**.

Do **not** add a test per helper (`isRegisteredContainerCleaned`, leftover classify, leftover map). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot leftover later janitor, leftover official leftover janitor, leftover worker write, leftover queue publish, leftover Analytics, or leftover Sheet Sync inside these tests. Later janitor proofs stay leftover `testArtifactJanitor.test.ts` / leftover `liveTestSecurity.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting-cron.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `JanitorCompletionService` class or a `classify.ts` / `evaluate.ts` / `mark.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second leftover evaluate **adapter** beside this file.
- I would not invent a second leftover `files.update` `{ trashed: true }` beside leftover confirmed-trash.
- I would not silently refuse an empty registered list so “empty means skip.”
- I would not silently catch-and-continue an unknown Drive error so “one bad folder still marks the others.”
- I would not silently make trash-the-set **ask** this mark so “one mark owns both walkers.”
- I would not silently **ask** leftover mark-needs on a missing registry row or a leftover 403.
- I would not silently put the returned completed tags on the leftover later-janitor bag.
- I would not silently default a missing map entry to cleaned.
- I would not silently merge this file with leftover `testArtifactJanitor.ts` or leftover `liveTestCleanup.ts`.
- I would not open unvisited `ingestion` while this pass still owns leftover later evaluate.
- I would not silently reorder ADR-known side effects.
