# Claim The Next Best Relocation Run Under A Five-Minute Apply Lease, Inspect The Sheets And Lock A Checksum-Bound Plan, Then Apply It Or Wait For The Owner — Skip When The Gate Is Off; A Retryable Google Error Queues One Retry — operational story

- Status: recommended
- Service: `ingestion` (Wave A, in-progress)
- Pass: 1 of this service — `worker.ts`
- Remaining in this service: `applyPlan.ts`, `repository.ts`, `health.ts`, `queue.ts`
- Target: `src/services/ingestion/worker.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (primary code is leftover `applyPlan.ts`. Role: Inspect Best Relocation sheets, plan create/update/adopt/conflict after the 2026-04-30 Eastern cutoff, and apply a checksum-bound plan under a single lease. Mongo domain documents are System of Record and are written only through leftover canonical commands. Best Relocation workbooks are the external evidence source. `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second Lead authority. Happy path: Owner queues → this worker claims `ingestion:best_relocation:apply` (five minutes) — approved applying first, then queued — leftover planner reads Forms / Local Forms / Calls / Booked Deals / Refunds → Owner approves the exact `plan_checksum` → leftover `applyBestRelocationPlan` walks actions. This is not Sheet Sync and not Granot HTTP automation. Knowledge names `runBestRelocationIngestionWorker` on the queue consumer row; it never names leftover `applyApprovedClaim`, leftover `failRun`, leftover `persistWorkerCheckpoint`, leftover `leaseFilter`, leftover `DEPLOYMENT_GATE_DISABLED`, leftover `BOOTSTRAP_NOT_COMPLETED`, leftover `STRUCTURAL_INSPECTION_FAILED`, leftover `INGESTION_WORKER_FAILED`, leftover `assertIngestionEnabled`, leftover `deploymentGateEnabled`, leftover `persistPlanConflicts`, leftover `connectionHealthFromInspection`, leftover `SheetSyncLease`, or leftover `APPLY_SCOPE` — do not add an Ingestion Service file in this rename so “the Service sentence wins”). Distinct from later leftover apply-the-locked-plan: sibling `applyPlan.ts` (this file **asks** leftover `applyBestRelocationPlan` twice — once after schedule/retry planning, once from leftover `applyApprovedClaim`; leftover `bestRelocationSheetIngest/adapter.ts` also **asks** leftover `apply` and this file never **asks** leftover `adapter.apply`). Distinct from later leftover connection / run / receipt persist: sibling `repository.ts` (this file **asks** leftover `claimApprovedRun` / leftover `claimQueuedRun` / leftover `createQueuedIngestionRun` / leftover `detectMissingSourceActions` / leftover `evidenceKeysForConnection` / leftover `newWorkerOwner` / leftover `openIngestionConflict`; leftover `lockRunPlan` is unused here — this file inlines the plan lock; Wave B Owner HTTP **asks** leftover `ensureBestRelocationConnection` / leftover `createQueuedIngestionRun`, never this file). Distinct from later leftover health letters: sibling `health.ts` (this file **asks** leftover `emitIngestionHealthSignal` and leftover `planHealthSignals`; leftover `shouldAlertIngestionSignal` lives there). Distinct from later leftover wakeup: sibling `queue.ts` (this file **asks** leftover `publishIngestionWakeup` only on a retryable Google fail; Wave B heartbeat / Owner preview / Owner approve **ask** leftover publish themselves). Distinct from unvisited leftover sheet inspect / leftover plan / leftover adopt: later Wave A `bestRelocationSheetIngest/` (this file **asks** leftover `createBestRelocationIngestionAdapter` / leftover `planBootstrapAdoption` / leftover `applySourceChangePolicy` / leftover `applyCanonicalAdoptionPolicy` / leftover `BEST_RELOCATION_CUTOFF`; leftover CLI dry-run never imports this file). Distinct from unvisited leftover Domain Commands: later Wave A `domainCommands/` (this file injects leftover `canonicalDomainCommands` into leftover apply; it never imports Form Lead / Call Lead / Booked Lead / Cancelled Lead models). Distinct from already-recommended leftover Sheet Sync drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md) (this file reuses leftover `MongoLeaseStore(SheetSyncLease)` for leftover `ingestion:best_relocation:apply`; it never **asks** leftover `runSheetSyncDrain`). Distinct from already-recommended leftover Reporting worker write: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (Reporting claims a confirmed RAW write; this file claims a Best Relocation inspect/plan/apply). Distinct from already-recommended leftover Granot drain: [`granot-lifecycle-drainer.md`](granot-lifecycle-drainer.md) (one `{ receipt_id }`; this claim is an adapter-wide five-minute lease then a run row). Distinct from leftover Wave B `src/routes/ingestion.routes.ts` (Owner GET/PATCH connection, leftover inspect, leftover preview queues + leftover publish, leftover approve CAS to `applying` + leftover publish, leftover retry, leftover conflicts; **no import** of this file). Distinct from leftover Wave B `src/routes/best-relocation-ingestion-cron.routes.ts` (heartbeat **asks** leftover ensure / leftover recover wakeup / leftover `claimDueBestRelocationConnection` / leftover create queued schedule / leftover publish; skips before source reads when leftover `BEST_RELOCATION_INGEST_ENABLED` is off; **no import** of this file). Distinct from leftover Wave B `api/queues/best-relocation-ingestion-consumer.ts` (the only runtime **ask** of leftover `runBestRelocationIngestionWorker`; leftover `lease_busy` throws so Vercel retries). Distinct from leftover Wave B `scripts/best-relocation-sheet-ingest.ts` (CLI dry-run; live apply retired). This checkout’s `CONTEXT.md` does not define Ingestion Origin / Best Relocation / Ingestion Run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover Wave B `api/queues/best-relocation-ingestion-consumer.ts` (**asks** leftover `runBestRelocationIngestionWorker`; leftover `{ claimed: false, status: "lease_busy" }` throws `Best Relocation ingestion apply lease is busy` so Vercel Queue retries; any other result is logged). Barrel: `src/services/ingestion/index.ts`. Tests: `ingestion.test.ts` **reads the source** of leftover `worker.ts` (no leftover Form Lead / Call Lead / Booked Lead / Cancelled Lead model import; no `/api/v1` / leftover `fetch` / leftover `axios`; leftover `finalized.modifiedCount !== 1` + leftover `lease_owner` / leftover `lease_epoch`; leftover consumer throws on leftover `lease_busy`). No test **asks** leftover `runBestRelocationIngestionWorker`. Leftover apply tests **ask** leftover `applyBestRelocationPlan`, not this file. Leftover heartbeat tests **ask** leftover Wave B `envGateEnabled` / leftover `ingestionHeartbeatSkipReason`, not this file. Owner HTTP never imports this file. Heartbeat never imports this file. Leftover CLI never imports this file. Leftover `adapter.apply` is not a caller of this file.
- Seams callers need: claim-the-next-run-under-a-five-minute-apply-lease (`runBestRelocationIngestionWorker`) vs skip-when-the-gate-is-off vs inspect-the-sheets-and-lock-a-checksum-bound-plan vs apply-the-locked-plan-or-resume-from-checkpoint (`applyApprovedClaim`) vs fail-the-fenced-run-and-maybe-queue-one-retry (`failRun`). The approved-first / queued-second **seam** exists because Owner leftover approve (Wave B) flips `awaiting_approval` → `applying` and leftover publishes; this claim must take that applying row before a newer queued inspect. The this-file / leftover apply **seam** exists because leftover `applyBestRelocationPlan` walks actions; this file claims, inspects, locks, checkpoints, and finalizes. The this-file / leftover adapter.apply **seam** exists because leftover `createBestRelocationIngestionAdapter().apply` also **asks** leftover apply and this file never uses that **adapter**. The this-file / leftover `lockRunPlan` **seam** exists because leftover repository already locks a plan and this file inlines the same `$set`. The this-file / leftover publish **seam** exists because only a retryable Google fail **asks** leftover wakeup from here; Owner / heartbeat publish themselves. The this-file / leftover heartbeat **seam** exists because leftover cron never starts this file. The leftover consumer / leftover `lease_busy` **seam** exists because acknowledging a busy lease can strand durable queued work. The env-gate / leftover `application_enabled` **seam** exists because leftover `BEST_RELOCATION_INGEST_ENABLED` must be true before leftover application enable, non-bootstrap apply, or leftover retry; leftover bootstrap apply after Owner approve does not **ask** leftover `assertIngestionEnabled`. There is no begin / complete Domain Command **seam**. There is no Owner HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync drain **seam**.
- Split later (only if the file outgrows one sitting): this ~887-line file is one sitting if you read it as claim the next Best Relocation run under a five-minute apply lease, inspect the sheets and lock a checksum-bound plan, then apply it or wait for the Owner — skip when the gate is off; a retryable Google error queues one retry. Do **not** split into `claim.ts` / `inspect.ts` / `plan.ts` / `apply.ts` / `fail.ts` so “each status owns a file.” Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover apply / leftover repository persist / leftover health letters / leftover wakeup / leftover sheet inspect / leftover Domain Commands here so “one worker owns the company.” If it later splits: `claimTheNextBestRelocationRunUnderAFiveMinuteApplyLease.ts` / `inspectTheSheetsAndLockAChecksumBoundPlan.ts` / `applyTheLockedPlanOrResumeFromCheckpoint.ts` / `failTheFencedRunAndMaybeQueueOneRetry.ts` only as later story files, never CRUD.

`runBestRelocationIngestionWorker` / leftover `applyApprovedClaim` are executor mechanics. The owner question is: *I queued a Best Relocation run — preview, manual, bootstrap, schedule, or retry. Claim the adapter-wide five-minute apply lease. Take an already-approved applying run first, then a queued one. If the env or application gate is off, skip a non-bootstrap apply. Inspect the two workbooks. If inspection is blocking, fail. Read one snapshot. Skip rows we already applied. Ask leftover plan, leftover receipt-skip or leftover bootstrap adopt, leftover adopt-before-create, leftover missing-source. Lock that checksum-bound plan. Preview ends there. Manual and bootstrap wait for my exact checksum. Schedule and retry apply now if bootstrap already completed. Resume from the checkpoint. Domain writes go through leftover commands only. A lost lease stops the walk. A retryable Google error fails this run and queues one retry. Do not approve from this file. Do not start leftover Sheet Sync drain. Do not post to Granot from this file. Do not run Analytics.*

Leftover apply, leftover repository persist, leftover health letters, leftover wakeup, leftover sheet inspect / leftover adopt, leftover Domain Commands, leftover Owner HTTP, leftover heartbeat already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “claim the next Best Relocation run under a five-minute apply lease, inspect the sheets and lock a checksum-bound plan, then apply it or wait for the Owner” story, not “an ingestion worker CRUD service,” and not leftover apply / leftover Owner approve / leftover heartbeat:

1. **Claim the next Best Relocation run under a five-minute apply lease** — leftover `runBestRelocationIngestionWorker`. Leftover `connectMongo`. Leftover `newWorkerOwner` (`best-relocation-worker:<uuid>`). Leftover `MongoLeaseStore(SheetSyncLease)` leftover `acquire` leftover `APPLY_SCOPE` `ingestion:best_relocation:apply` leftover `LEASE_TTL_MS` five minutes. Miss → `{ claimed: false, status: "lease_busy" }`. Leftover `claimApprovedRun` first (leftover `applying` + leftover locked plan + leftover approved-at **or** leftover trigger `schedule` / leftover `retry` + unleased / expired). Else leftover `claimQueuedRun` (leftover `queued`, or leftover `inspecting` / leftover `planning` with expired / missing lease → leftover `inspecting`, leftover `attempt_count++`). No run → `{ claimed: false }` (no leftover `status`). Always leftover `release` in leftover `finally`.

2. **Skip when the env or application gate is off** — leftover trigger is not leftover `bootstrap`, leftover status is leftover `applying` **or** leftover trigger is leftover `schedule` / leftover `retry`, and leftover `deploymentGateEnabled()` is false **or** leftover `isConnectionApplicationEnabled` is false → leftover `IngestionRun.updateOne` fenced to leftover `inspecting` / leftover `applying` + leftover lease owner/epoch → leftover `skipped` / leftover `DEPLOYMENT_GATE_DISABLED`. Leftover `modifiedCount !== 1` throws leftover “Deployment-gate skip lost the fenced run lease.” Leftover bootstrap never takes this skip.

3. **Inspect the sheets and lock a checksum-bound plan** — when leftover claimed status is not leftover `applying`. Leftover `createBestRelocationIngestionAdapter({ leaseStore })`. Leftover `adapter.inspect`: leftover `repair_identity` is true only for leftover `bootstrap` / leftover `schedule` / leftover `retry` (leftover preview / leftover manual never repair). Stamp leftover `ExternalDataConnection` leftover `last_checked_at` / leftover `resolved_workbooks` / leftover `health` from leftover `connectionHealthFromInspection`. Unhealthy → leftover `emitIngestionHealthSignal` leftover `schema_or_formula_drift` + leftover `failRun` leftover `STRUCTURAL_INSPECTION_FAILED` / leftover `inspecting`. Healthy → leftover status leftover `planning`. Leftover `adapter.read` must yield **exactly one** workbook snapshot. Leftover `evidenceKeysForConnection` remaps matching leftover `dataset_key:stable_source_row_id:content_hash` actions to leftover `unchanged` (drops leftover `command_payload`). Leftover `adapter.plan`. Leftover `bootstrap` → leftover `planBootstrapAdoption` on the **unmapped** leftover `initialPlanSnapshot`. Else leftover `applySourceChangePolicy` on leftover `withEvidence`, then leftover `applyCanonicalAdoptionPolicy`. Leftover `detectMissingSourceActions` appends leftover `record_conflict` leftover `missing_source_row` (never delete). Renew leftover apply lease; miss throws leftover “Ingestion lease expired during source planning.” Leftover `persistPlanConflicts` leftover **asks** leftover `openIngestionConflict` for every leftover `record_conflict` already on the plan. Lock: leftover `preview` → leftover `completed`; leftover `schedule` / leftover `retry` → leftover `applying`; else leftover `awaiting_approval`. Leftover `plan_locked_at` must still be empty. Leftover `modifiedCount !== 1` throws leftover “Run plan could not be locked under the active lease.” Leftover `planHealthSignals` then leftover emit. If leftover next status is not leftover `applying`, return leftover `claimed: true` + that status.

4. **Apply the locked plan, or resume from the checkpoint** — leftover `applyApprovedClaim` when the claimed row is already leftover `applying` (Owner leftover approve, leftover schedule/retry leftover applying retry, leftover reclaim). Else leftover schedule/retry after this plan lock: leftover `bootstrap_completed_at` missing → leftover `failRun` leftover `BOOTSTRAP_NOT_COMPLETED`. Both paths leftover **ask** leftover `applyBestRelocationPlan` with leftover `canonicalDomainCommands`, leftover `onCheckpoint` → leftover `persistWorkerCheckpoint` (renew leftover apply lease, leftover `IngestionRun` leftover `checkpoint` + leftover `counters.failures` fenced to leftover `applying`). Leftover `applyApprovedClaim` resumes leftover `start_action_index` / leftover initial counters / leftover `failed_action_keys` from leftover `checkpoint`. Leftover `assertApplicationEnabled` is omitted for leftover `bootstrap`. Failures or leftover `skipped_dependencies` → leftover `completed_with_errors`; else leftover `completed`. Leftover finalize leftover `modifiedCount !== 1` throws leftover “Ingestion finalization lost the fenced run lease.” Stamp leftover connection leftover `last_checked_at`; leftover `completed` also leftover `last_successful_run_at`. Leftover `bootstrap` + leftover `completed` stamps leftover `bootstrap_completed_at` **only** on leftover `applyApprovedClaim`. Leftover `completed_with_errors` leftover **asks** leftover emit.

5. **Fail the fenced run, then maybe queue one retry** — leftover catch leftover **asks** leftover `failRun` leftover `INGESTION_WORKER_FAILED` (leftover lease owner/epoch/until + leftover non-terminal statuses → leftover `failed` + leftover `recordOperationalEvent` leftover `best_relocation_ingestion.run_failed`). Leftover `modifiedCount !== 1` is leftover `false` (no event). Leftover `classifyGoogleFailure` leftover `retryable_rate_limit` / leftover `retryable_transient` **and** leftover trigger is not leftover `retry`: leftover locked plan → new leftover `IngestionRun` leftover `trigger: "retry"` leftover `status: "applying"` with the same leftover snapshot/checksum; else leftover `createQueuedIngestionRun` leftover `retry`. Leftover **ask** leftover `publishIngestionWakeup` leftover `reason: "retry"`. Then leftover **rethrow**. Leftover `finally` still releases leftover apply lease.

Leftover `leaseFilter` / leftover `persistWorkerCheckpoint` / leftover `connectionHealthFromInspection` / leftover `persistPlanConflicts` / leftover `assertIngestionEnabled` / leftover `deploymentGateEnabled` / leftover `isRecord` are beats, not extra owner operations.

## Organization

Keep one file. This is the screenplay for “claim the next Best Relocation run under a five-minute apply lease, inspect the sheets and lock a checksum-bound plan, then apply it or wait for the Owner.” Leftover apply, leftover repository persist, leftover health letters, leftover wakeup, leftover sheet inspect / leftover adopt, leftover Domain Commands, leftover Owner HTTP, leftover heartbeat already live in deeper **modules**. Do not pull those in. Do not invent an `IngestionWorkerService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover apply **adapter** beside leftover `applyBestRelocationPlan`. Do not invent a second leftover wakeup **adapter** beside leftover `publishIngestionWakeup`. Do not invent a second leftover lease collection beside leftover `MongoLeaseStore(SheetSyncLease)`. Do not invent a second leftover env-gate **adapter** beside leftover Wave B `envGateEnabled` — leftover `deploymentGateEnabled` is the copy this file already has.

Do not split claim / inspect / lock / apply / fail into CRUD files. Claim and leftover fail stay together because leftover consumer only **asks** leftover `runBestRelocationIngestionWorker`. Leftover `applyApprovedClaim` stays in this file because leftover resume and leftover bootstrap-completed stamp are this run’s apply, not leftover `applyPlan.ts`. Do not start leftover Owner leftover approve from this file so “the worker owns the checksum.” Do not start leftover heartbeat leftover `claimDueBestRelocationConnection` from this file so “the worker owns cadence.” Do not start leftover `runSheetSyncDrain` from this file so “we already hold `SheetSyncLease`.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runBestRelocationIngestionWorker` | `claimTheNextBestRelocationRunInspectLockThenApplyOrWait` | leftover consumer is the only runtime **ask** |

Keep the old name as a one-line alias until leftover `api/queues/best-relocation-ingestion-consumer.ts` and leftover `ingestion.test.ts` source-read migrate. Do not export leftover `applyApprovedClaim` / leftover `failRun` / leftover `persistWorkerCheckpoint` / leftover `leaseFilter` / leftover `assertIngestionEnabled` / leftover `deploymentGateEnabled`. Do not make leftover heartbeat learn leftover `runBestRelocationIngestionWorker` — leftover cron only leftover publishes leftover wakeup. Do not make leftover Owner leftover approve learn this file — leftover approve leftover CAS-es leftover `applying` and leftover publishes. Do not make leftover apply tests learn leftover `runBestRelocationIngestionWorker` — leftover apply tests leftover **ask** leftover `applyBestRelocationPlan`.

**No class for the workflow.** The type that *does* earn a name is the leftover consumer handoff:

```ts
type ClaimedBestRelocationIngestion = {
  claimed: boolean
  run_id?: string
  status?: string
}
```

That is the handoff from “Owner or leftover heartbeat queued a run” to “leftover consumer may log leftover `awaiting_approval` / leftover `completed` / leftover `lease_busy`.” Do **not** put leftover plan actions on this type. Do **not** put leftover Google leftover range strings on this type. Do **not** put leftover `plan_checksum` on this type. Do **not** move leftover `IngestionApplyResult` here — that bag is leftover apply.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// worker.ts
// The owner queued a Best Relocation run.
// Claim the adapter-wide five-minute apply lease.
// Take an already-approved applying run first, then a queued one.
// If the env or application gate is off, skip a non-bootstrap apply.
// Inspect the two workbooks. Blocking → fail.
// Read one snapshot. Skip rows we already applied.
// Ask leftover plan, leftover receipt-skip or leftover bootstrap adopt,
// leftover adopt-before-create, leftover missing-source.
// Lock that checksum-bound plan.
// Preview ends there. Manual and bootstrap wait for the exact checksum.
// Schedule and retry apply now if bootstrap already completed.
// Resume from the checkpoint. Domain writes go through leftover commands.
// A lost lease stops the walk.
// A retryable Google error fails this run and queues one retry.

// ── 1. Claim the next Best Relocation run under a five-minute apply lease ─

export async function claimTheNextBestRelocationRunInspectLockThenApplyOrWait()
export const runBestRelocationIngestionWorker =
  claimTheNextBestRelocationRunInspectLockThenApplyOrWait

async function takeTheAdapterWideApplyLease(owner, now)
async function claimAnApprovedApplyingRunFirstThenAQueuedOne(owner, lease, now)

// ── 2. Skip when the env or application gate is off ─

async function skipANonBootstrapApplyWhenTheGateIsOff(run, lease)
function envGateSaysIngestIsOn() // leftover deploymentGateEnabled; Wave B leftover envGateEnabled is the twin

// ── 3. Inspect the sheets and lock a checksum-bound plan ─

async function inspectTheSheetsAndLockAChecksumBoundPlan(run, lease, adapter)
async function refuseWhenInspectionIsBlocking(inspection, runId, lease)
async function skipRowsWeAlreadyApplied(actions, evidenceKeys)
async function askLeftoverAdoptThenLeftoverMissingSource(plan, trigger)
async function lockTheChecksumBoundPlanOrThrow(runId, lease, planned, nextStatus)
function nextStatusAfterPlanning(trigger) // preview completed; schedule/retry applying; else awaiting_approval

// ── 4. Apply the locked plan, or resume from the checkpoint ─

async function applyTheLockedPlanOrResumeFromCheckpoint(run, lease)
async function refuseScheduleApplyUntilBootstrapCompleted(runId, lease)
async function persistACheckpointAndRenewTheApplyLease(runId, lease, checkpoint)
async function finalizeCompletedOrCompletedWithErrors(runId, lease, applied)

// ── 5. Fail the fenced run, then maybe queue one retry ─

async function failTheFencedRunAndMaybeQueueOneRetry(runId, error, lease)
async function queueOneRetryOnlyWhenThisTriggerIsNotAlreadyRetry(failed)
```

Read the primary path out loud: *The owner queued a Best Relocation run. Claim the adapter-wide five-minute apply lease. Take an already-approved applying run first, then a queued one. If the env or application gate is off, skip a non-bootstrap apply. Inspect the two workbooks; blocking fails the fenced run. Read one snapshot. Skip rows we already applied. Ask leftover plan, leftover receipt-skip or leftover bootstrap adopt, leftover adopt-before-create, leftover missing-source. Lock that checksum-bound plan. Preview ends there. Manual and bootstrap wait for the owner’s exact checksum. Schedule and retry apply now if bootstrap already completed. Resume from the checkpoint. Domain writes go through leftover commands. A lost lease stops the walk. A retryable Google error fails this run and queues one retry. Never approve from this file. Never drain Sheet Sync. Never post to Granot from this file.*

That is the operation. `runBestRelocationIngestionWorker` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two apply-and-finalize copies.** Leftover schedule/retry after this plan lock leftover **asks** leftover apply, leftover finalize, leftover connection health, leftover `completed_with_errors` emit. Leftover `applyApprovedClaim` copies that walk and is the only path that stamps leftover `bootstrap_completed_at`. Name the two **adapters** (fresh schedule apply vs leftover resume / leftover Owner-approved apply). Do **not** silently merge them in this rename so “one apply owns bootstrap-completed.”

2. **Leftover `lockRunPlan` is unused.** Leftover repository already leftover `$set`s leftover `plan_snapshot` / leftover `plan_checksum` / leftover `plan_locked_at`. This file inlines the same lock plus leftover read counters. Name the inline lock. Do **not** silently switch this file to leftover `lockRunPlan` so “one persist owns the lock” without proving leftover counter keys (`creates` vs leftover `create`).

3. **Leftover `adapter.apply` is never asked.** Leftover `createBestRelocationIngestionAdapter().apply` leftover **asks** leftover `applyBestRelocationPlan`. This file leftover **asks** leftover apply directly. Name the unused **adapter**. Do **not** silently switch this file to leftover `adapter.apply` so “the kernel owns apply” — leftover `IngestionKernelDependencies` is also unused.

4. **Conflicts are opened twice.** Leftover `persistPlanConflicts` leftover **asks** leftover `openIngestionConflict` at lock time. Leftover apply leftover **asks** leftover `record_conflict` again during the walk (unless leftover dispositioned). Name plan-time open vs apply-time open. Do **not** silently drop leftover `persistPlanConflicts` so “apply owns every conflict” — leftover Owner leftover approve leftover refuses leftover open leftover `blocking` / leftover `critical` **before** this file leftover applies.

5. **Bootstrap leftover adopt uses the unmapped snapshot.** Leftover `planBootstrapAdoption(initialPlanSnapshot)` sees leftover creates leftover evidence-skip would have remapped to leftover `unchanged`. Recurring leftover `applySourceChangePolicy` uses leftover `withEvidence`. Name the two inputs. Do **not** silently feed leftover `withEvidence` into leftover bootstrap adopt so “one snapshot owns both triggers.”

6. **Leftover `deploymentGateEnabled` is a twin of leftover Wave B `envGateEnabled`.** Same leftover `BEST_RELOCATION_INGEST_ENABLED === "true"` fold. Heartbeat leftover skips before leftover claim-due. This file leftover skips after leftover run claim. Name the two gates. Do **not** silently import leftover Wave B leftover `envGateEnabled` so “one helper owns both trees” — Wave B is locked.

7. **Leftover consumer must throw on leftover `lease_busy`.** Acknowledging leftover busy can strand leftover durable queued work. Name reject-busy. Do **not** silently return leftover `claimed: false` without leftover `lease_busy` so “empty and busy look the same.” Empty claim already returns leftover `{ claimed: false }` with no leftover `status`.

8. **Tests never ask the parent seam.** Today leftover `ingestion.test.ts` leftover **reads the source** of leftover `worker.ts` and leftover **asks** leftover `applyBestRelocationPlan` for leftover resume / leftover adopt / leftover checksum. No test leftover **asks** leftover `runBestRelocationIngestionWorker`. That is helper-unit / source-read style for a story that leftover CAS-es leftover `IngestionRun` statuses.

9. **This file writes leftover `IngestionRun` / leftover `ExternalDataConnection` directly.** Leftover claim / leftover create-queued / leftover missing-source / leftover open-conflict leftover **ask** leftover repository. Leftover inspect stamp / leftover planning / leftover lock / leftover skip / leftover fail / leftover finalize / leftover checkpoint do not. Name the inline writes. Do **not** silently move them into leftover repository this pass so “one persist file owns the worker.”

10. **Leave sibling modules alone.** Leftover `applyBestRelocationPlan`, leftover `claimApprovedRun` / leftover `claimQueuedRun`, leftover `emitIngestionHealthSignal`, leftover `publishIngestionWakeup`, leftover `createBestRelocationIngestionAdapter`, leftover `planBootstrapAdoption`, leftover `applySourceChangePolicy`, leftover `applyCanonicalAdoptionPolicy`, leftover `canonicalDomainCommands`, leftover `classifyGoogleFailure`, leftover `MongoLeaseStore` are already the right **depth**. This file leftover claims, leftover inspects, leftover locks, leftover finalizes, leftover fails. Do not open leftover `applyPlan.ts` as a second recommendation this pass. Do not open leftover `bestRelocationSheetIngest/` this pass.

## Testing

The **interface** is the test surface: leftover `claimTheNextBestRelocationRunInspectLockThenApplyOrWait` (today leftover `runBestRelocationIngestionWorker`).

Today leftover `ingestion.test.ts` leftover **reads** leftover `worker.ts` (no leftover domain-model imports; leftover finalize leftover `modifiedCount`; leftover consumer leftover throws leftover `lease_busy`) and leftover **asks** leftover `applyBestRelocationPlan` (leftover resume without replay; leftover adopt leftover Form Lead leftover supplies leftover Booking leftover `lead_ref`; leftover failed leftover Lead leftover blocks leftover Booking; leftover concurrent leftover apply leftover lease; leftover altered leftover checksum). Those leftover apply proofs stay leftover `applyPlan.ts`. Replace the leftover worker source-read with tests that name the operation. Use `TEST_MODE`. Inject leftover lease / leftover adapter / leftover commands. Do not boot live Google Sheets.

**Claim**
- Leftover apply lease miss → leftover `{ claimed: false, status: "lease_busy" }`. Leftover consumer leftover throws.
- Leftover approved leftover `applying` is claimed before leftover `queued`.
- No leftover run → leftover `{ claimed: false }` with no leftover `status`. Leftover apply lease leftover is leftover released.

**Skip / inspect / lock**
- Leftover schedule + leftover env off → leftover `skipped` / leftover `DEPLOYMENT_GATE_DISABLED`. Leftover adapter leftover inspect is not **asked**.
- Leftover bootstrap + leftover env off → leftover inspect still **asked** (leftover skip does not fire).
- Leftover preview leftover `repair_identity` is leftover false. Leftover bootstrap / leftover schedule leftover `repair_identity` is leftover true.
- Leftover unhealthy leftover inspect → leftover `failed` / leftover `STRUCTURAL_INSPECTION_FAILED` + leftover `schema_or_formula_drift` emit. Leftover apply is not **asked**.
- Leftover preview leftover locks leftover `completed` and leftover returns without leftover apply.
- Leftover manual / leftover bootstrap leftover locks leftover `awaiting_approval`. Leftover apply is not **asked**.
- Leftover schedule leftover locks leftover `applying` only when leftover `bootstrap_completed_at` exists; missing → leftover `BOOTSTRAP_NOT_COMPLETED`.
- Leftover `adapter.read` leftover 0 or leftover 2 snapshots leftover throws leftover “no workbook snapshot.” Leftover apply is not **asked**.
- Leftover evidence-skip remaps leftover matching leftover hash to leftover `unchanged` before leftover recurring leftover policy. Leftover bootstrap leftover adopt leftover still leftover **asks** leftover `initialPlanSnapshot`.

**Apply / fail / retry**
- Leftover `applyApprovedClaim` leftover **asks** leftover `applyBestRelocationPlan` with leftover `start_action_index` from leftover checkpoint. Leftover `bootstrap` leftover omits leftover `assertApplicationEnabled`. Leftover `completed` leftover stamps leftover `bootstrap_completed_at`.
- Leftover finalize leftover `modifiedCount !== 1` leftover throws leftover “lost the fenced run lease.”
- Leftover lost leftover apply lease leftover during leftover checkpoint leftover throws leftover “could not renew the apply lease.”
- Leftover retryable leftover Google leftover fail leftover **asks** leftover `failRun` then leftover `publishIngestionWakeup` leftover `retry` leftover once. Leftover trigger leftover `retry` leftover does not leftover queue leftover another leftover retry. Leftover error leftover is leftover rethrown. Leftover apply lease leftover is leftover released.
- Leftover Form Lead / leftover Call Lead / leftover Booked Lead / leftover Cancelled Lead models are not imported. Leftover `/api/v1` leftover `fetch` leftover `axios` are not leftover **asked**.

Do **not** add a test per helper (leftover `leaseFilter`, leftover `isRecord`, leftover `connectionHealthFromInspection`, leftover `persistPlanConflicts`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot leftover Owner leftover approve, leftover heartbeat leftover claim-due, leftover Sheet Sync drain, leftover Reporting leftover worker write, leftover Analytics, leftover Granot leftover drain, or leftover CLI leftover dry-run inside these tests. Leftover apply proofs stay leftover `applyPlan` tests. Leftover heartbeat leftover skip proofs stay leftover Wave B leftover `ingestionHeartbeatSkipReason`. Live leftover Sheets stay leftover `pnpm ingest:best-relocation -- --dry-run`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Ingestion Origin / Best Relocation / Ingestion Run.
- I would not open Wave B (`src/routes/ingestion.routes.ts`, `src/routes/best-relocation-ingestion-cron.routes.ts`, `api/queues/best-relocation-ingestion-consumer.ts`).
- I would not write a whole-folder Ingestion recommendation.
- I would not introduce an `IngestionWorkerService` class or a `claim.ts` / `inspect.ts` / `plan.ts` / `apply.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second leftover apply **adapter** beside leftover `applyBestRelocationPlan`.
- I would not invent a second leftover wakeup **adapter** beside leftover `publishIngestionWakeup`.
- I would not invent a second leftover lease collection beside leftover `MongoLeaseStore(SheetSyncLease)`.
- I would not silently merge leftover schedule apply and leftover `applyApprovedClaim` so “one apply owns bootstrap-completed.”
- I would not silently switch this file to leftover `lockRunPlan` or leftover `adapter.apply` so “one persist / one kernel owns the walk.”
- I would not silently drop leftover `persistPlanConflicts` so “apply owns every conflict.”
- I would not silently feed leftover `withEvidence` into leftover bootstrap adopt so “one snapshot owns both triggers.”
- I would not silently import leftover Wave B leftover `envGateEnabled`.
- I would not silently make leftover empty claim return leftover `lease_busy`.
- I would not silently start leftover `runSheetSyncDrain` because leftover `SheetSyncLease` is already in hand.
- I would not silently start leftover Owner leftover approve or leftover heartbeat leftover claim-due from this file.
- I would not open leftover `bestRelocationSheetIngest/` or leftover `domainCommands/` this pass.
- I would not jump to leftover `applyPlan.ts` as a second recommendation this pass.
- I would not silently reorder ADR-known side effects.
