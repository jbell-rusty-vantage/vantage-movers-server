# Watch The Sheet Sync Outbox From The Admin Dashboard — Then Put Failed Jobs Back On The Desk And Start A Drain From Here — operational story

- Status: recommended
- Service: `admin` (Wave A, visited)
- Pass: 7 of this service — `adminSheetSync.service.ts`
- Remaining in this service: none
- Target: `src/services/admin/adminSheetSync.service.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (Admin retry section names this file: health card, job / run desks, default-`failed` requeue, then `runSheetSyncDrain("admin")` via `waitUntil`; **does not** `publishSheetSyncWakeup`; no destructive heal that fights the drainer). Distinct from already-recommended persist / finalize: [`sheet-sync-coordinator.md`](sheet-sync-coordinator.md). Distinct from already-recommended outbox coalesce + tombstone: [`sheet-sync-outbox.md`](sheet-sync-outbox.md) (`dueAt` has no runtime caller; this file mutates the job row itself). Distinct from already-recommended wake-up: [`sheet-sync-queue.md`](sheet-sync-queue.md) (this file never imports it). Distinct from already-recommended drain: [`sheet-sync-run-sheet-sync-drain.md`](sheet-sync-run-sheet-sync-drain.md) (queue / cron / this retry all enter there; cron is the queued-mode gate, not this file). Distinct from leftover Owner live Master Sheet membership: `googleSheets/sheetContains.ts` (barrel re-exports `checkSheetContains`; Wave B `POST .../contains` is Owner-only and does not enqueue or drain). Distinct from later unvisited Observability overview / `sheet-sync-health-summary` (they **ask** the health card and swallow a throw). Distinct from five-minute cron `/api/cron/sheet-sync-drain`. Distinct from Google Sheets tabs / projections: [`google-sheets.md`](../../../docs/knowledge/services/google-sheets.md). Distinct from already-recommended desk / CSV / typeahead / chips / catalog / Agent credits. This checkout’s `CONTEXT.md` names Sheet Sync in the intro and does not define outbox / drain / Master Sheet — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an admin-sheet-sync Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`GET .../sheet-sync/{health,jobs,runs,runs/:id}` **asks** the four reads; `POST .../sheet-sync/retry` **asks** `retrySheetSyncJobs` — Admin may retry; Owner gate is only on leftover `contains`, which does **not** import this file). Barrel `admin/index.ts` re-exports the five names. Later unvisited `observability/adminObservability.service.ts` **asks** `getSheetSyncHealth` for the overview `sheet_sync` bag (`.catch(() => null)`). Later unvisited `observability/operationalReports.service.ts` **asks** the same for report `sheet-sync-health-summary`. Tests: `adminSheetSync.service.test.ts` (health backlog age, job-desk filter, default-`failed` requeue + injectable drain, no queue-publish event, empty match is a no-op). No tests for the run desk or run detail. Already-recommended drain / coordinator / outbox / queue do **not** import this file.
- Seams callers need: show-the-health-card (`getSheetSyncHealth`) vs page-the-job-desk / page-the-run-desk / open-one-run vs put-failed-jobs-back-and-start-a-drain (`retrySheetSyncJobs`, injectable `startDrain` for tests). There is no publish **seam**. There is no contains **seam**. There is no begin / complete **seam**. There is no mode-gate **seam** on retry (health **shows** `getSheetSyncMode()`; retry still starts the drain). There is no HTTP **seam**.
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as watch the Sheet Sync outbox from the Admin Dashboard, then put failed jobs back on the desk and start a drain from here. Do **not** split health vs list vs retry into `get.ts` / `list.ts` / `retry.ts`. Do **not** pull leftover `checkSheetContains` here so “one admin file owns every Sheet Sync button.” Do **not** merge already-recommended `runSheetSyncDrain` here so “retry owns the drain.” If it later splits: `showTheSheetSyncHealthCard.ts` / `inspectTheSheetSyncOutbox.ts` / `putFailedSheetSyncJobsBackOnTheDeskAndStartADrain.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

`getSheetSyncHealth` / `listSheetSyncJobs` / `retrySheetSyncJobs` are executor mechanics. The owner question is: *I opened the Admin Dashboard Sheet Sync card. How backed-up are we? How many jobs are pending or retrying, how many failed, how old is the oldest due row, and which drain ran last? I can page the outbox and the drain history. When I retry, put those jobs back to pending right now, clear the lease, and start a drain from this desk — do not wait for the queue, do not wait for the five-minute cron. Do not heal a live processing job. Do not ask whether a Lead is already on the Master Sheet. This is not writing the outbox from a domain save. This is not publishing a wake-up.*

Already-recommended persist / outbox / wake-up / drain, leftover Owner contains, leftover scope pick, already-recommended desk / CSV / typeahead / chips / catalog / Agent credits, and later Observability reports already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “watch the Sheet Sync outbox from the Admin Dashboard, then put failed jobs back on the desk and start a drain from here” story, not “an admin CRUD sheet-sync helper,” and not the drain / the wake-up / the Master Sheet membership check:

1. **Show how backed-up Sheet Sync is, and let the owner inspect the outbox** — `getSheetSyncHealth`, `listSheetSyncJobs`, `listSheetSyncRuns`, `getSheetSyncRunDetail`. Health **asks** three reads in parallel: counts by job `status`, the oldest `pending` / `retrying` row by `due_at`, the newest `SheetSyncRun` by `started_at`. `pending` on the card is `pending` + `retrying`. `failed` / `processing` are the raw buckets (missing bucket → `0`). `backlog_age_ms` is only how late the oldest due row is; a future `due_at` (debounce) is `0`. Mode is `getSheetSyncMode()` for display. Job desk: optional `status` / `resource` / `entity_id` / `job_id`, page, sort `due_at` asc / `priority` desc / `createdAt` asc. Run desk: optional run `status`, page, sort `started_at` desc. Open one run: bad ObjectId → 400, missing → 404, then load `SheetSyncAttempt` rows for that `run_id` oldest first. These four reads never mutate and never start a drain.

2. **Put failed jobs back on the desk and start a drain from here** — `retrySheetSyncJobs`. Default filter is **`failed` only**. Optional `statuses` (Zod allows every job status, including `pending` / `processing` / `synced`) or explicit `job_ids` (knowledge: any status; `job_ids` wins and ignores `statuses`). Cap with `limit` (default 100, max 500). Find matching `_id`s with **no sort**. Empty match → `{ requeued: 0, drain_started: false }` and no `updateMany`. Else `$set` `pending`, `due_at=now`, `attempts=0`, `created_by=admin`, `$unset` lease / `last_error`. If anything actually moved, **ask** `startDrain` (default `startAdminSheetSyncDrain`: `waitUntil(runSheetSyncDrain("admin"))`, swallow the throw, log `sheet_sync.admin_retry.drain_failed`). **Does not** `publishSheetSyncWakeup`. Tests inject `startDrain` so the real drain never runs.

There is no third owner operation. `startAdminSheetSyncDrain` is the default drain **adapter**, not a public **seam**. Do not export the health aggregate stages. Do not export leftover `checkSheetContains` from this file as if this story owned Master Sheet membership.

## Organization

Keep one file. This is the screenplay for “watch the Sheet Sync outbox from the Admin Dashboard, then put failed jobs back on the desk and start a drain from here.” Persist / finalize, outbox coalesce, queue wake-up, the drain itself, leftover Owner contains, and later Observability overview already live in deeper **modules**. Do not pull those in. Do not invent an `AdminSheetSyncService` class. Do not invent a begin / complete **seam** — retry is a bounded re-arm, not a canonical command. Do not invent a publish **adapter** beside already-recommended `publishSheetSyncWakeup`. Do not invent a contains **adapter** beside leftover `checkSheetContains`. Do not invent a second drain **adapter** beside already-recommended `drainDueSheetSyncJobs` — this file **asks** that function after it has already moved the rows.

Do not split this by HTTP verb. Health, the two desks, and retry are beats of one watch-then-re-arm story. Do not move this into `sheetSync/` so “the outbox folder owns the Admin Dashboard card.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getSheetSyncHealth` | `showTheSheetSyncHealthCard` | Admin Dashboard card; later Observability **asks** the same snapshot |
| `listSheetSyncJobs` | `pageTheSheetSyncJobDesk` | inspect the durable outbox |
| `listSheetSyncRuns` | `pageTheSheetSyncRunDesk` | inspect drain history |
| `getSheetSyncRunDetail` | `openOneSheetSyncRun` | one run plus its attempt rows |
| `retrySheetSyncJobs` | `putFailedSheetSyncJobsBackOnTheDeskAndStartADrain` | re-arm terminal work and start drain from this desk; injectable `startDrain` is the test **adapter** |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, `admin/index.ts`, later Observability, and `adminSheetSync.service.test.ts` migrate. Do not make callers learn `$group` / `waitUntil` / `leased_until` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the health card the Admin Dashboard already paints:

```ts
type SheetSyncHealthOnTheAdminDashboard = {
  mode: "queued" | "legacy" | "disabled"
  jobs_by_status: Record<string, number>  // only statuses that have rows
  pending: number                         // pending + retrying
  failed: number
  processing: number
  oldest_pending_due_at: Date | null
  backlog_age_ms: number                  // 0 when the oldest due_at is still in the future
  last_run: unknown | null                // newest SheetSyncRun by started_at, including a still-running drain
}
```

That is the handoff from “we counted the outbox” to “paint the card.” `synced` / `cancelled` are not promoted to top-level fields.

The retry result that *also* earns a name is the bounded re-arm receipt:

```ts
type SheetSyncRetryFromTheDesk = {
  requeued: number
  drain_started: boolean  // true only when modifiedCount > 0
}
```

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminSheetSync.service.ts
// The owner opened the Admin Dashboard Sheet Sync card.
// How backed-up are we?
// How many jobs are pending or retrying, how many failed,
// how old is the oldest due row, and which drain ran last?
// Page the outbox. Page the drain history. Open one run.
// When I retry, put those jobs back to pending right now,
// clear the lease, and start a drain from this desk.
// Do not wait for the queue.
// Do not wait for the five-minute cron.
// Do not heal a live processing job.
// Do not ask whether a Lead is already on the Master Sheet.
// This file does not write the outbox from a domain save.
// This file does not publish a wake-up.
// This file does not take the global drain seat itself.

// ── 1. Show how backed-up Sheet Sync is ───────────────────

export async function showTheSheetSyncHealthCard()

function countJobsByStatus()
function findTheOldestDuePendingOrRetryingRow()
function findTheNewestDrainRun()
function backlogIsOnlyHowLateTheOldestDueRowIs(dueAt, now) // future due_at → 0
function pendingOnTheCardMeansPendingPlusRetrying(byStatus)

export async function pageTheSheetSyncJobDesk(query)
export async function pageTheSheetSyncRunDesk(query)
export async function openOneSheetSyncRun(id)              // 400 / 404

// ── 2. Put failed jobs back on the desk and start a drain ─

export async function putFailedSheetSyncJobsBackOnTheDeskAndStartADrain(input, options?)

function defaultFilterIsFailedOnly(input)                  // job_ids win; else statuses ?? ["failed"]
function capHowManyWeReArm(limit)
function findMatchingJobIdsWithNoSort(filter, limit)       // empty → stop
function reArmToPendingNowAndClearTheLease(ids)            // created_by=admin, attempts=0
async function startADrainFromThisDeskAfterAnythingMoved() // waitUntil; swallow; do not publish

function startAdminSheetSyncDrain()                        // default adapter; tests inject startDrain
```

Read the retry path out loud: *If I named job ids, use those. Otherwise take failed jobs, or the statuses I sent. Cap the list. If nobody matches, stop. Put the matches back to pending due now, forget the lease and the last error, stamp created-by admin, and reset attempts. If anything actually moved, start a drain from this desk and do not publish a wake-up. If the drain throws, log it and leave the jobs pending — the five-minute cron can still find them.*

That is the operation. `retrySheetSyncJobs` is not a different story. `getSheetSyncHealth` is not a CRUD count helper.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file comment says terminal jobs. `job_ids` does not.** Comment: re-queue `failed` / `cancelled` only. Knowledge: explicit `job_ids` are any status. Zod `statuses` is every `SHEET_SYNC_JOB_STATUSES` value, so `processing` / `pending` / `synced` are legal. sheet-sync-process: never reset stuck `processing` to `pending` until the root cause is fixed. Do not silently `$in: ["failed", "cancelled"]` on the `job_ids` path so “the comment becomes true,” and do not drop the knowledge “any status” line so “the comment wins.”

2. **Retry starts a drain even when mode is `legacy` or `disabled`.** Health **shows** `getSheetSyncMode()`. Cron is the queued-mode gate. This file always `waitUntil(runSheetSyncDrain("admin"))` after a move. Do not add a mode check here so “legacy cannot drain,” and do not hide mode on the card so “retry already ignores it.”

3. **Find-then-updateMany has no sort and no second status fence.** `SheetSyncJob.find(filter).limit(limit)` uses natural order. `updateMany` is `_id ∈ those ids` only. A `processing` id that was live between the two calls still loses its lease. Do not add `priority: -1, createdAt: 1` so “retry matches the drain claim order,” and do not re-filter `status: failed` on `updateMany` so “the race disappears” unless that is a later, tested change.

4. **`created_by: "admin"` overwrites `api` / `cron` / `script`.** The outbox remembers who first wrote the row. Retry stamps the desk. Do not keep the original `created_by` so “provenance survives retry,” and do not add an audit collection in this rename.

5. **Attempts go back to `0`.** Already-recommended drain burns attempts up to 8, then `failed`. Retry gives the job another eight. Do not increment from the old count so “admin retry still counts toward exhausted,” and do not skip the drain’s attempt cap on `created_by=admin`.

6. **Pending on the card is pending plus retrying.** `processing` is separate. A drain that holds the seat can show `pending: 0` while `processing` is large and `backlog_age_ms` is `0` (no pending/retrying row). Do not add `processing` into `pending` so “the card matches the drain’s claimed set,” and do not treat `retrying` as `failed`.

7. **Backlog age ignores a future `due_at`.** Debounce and a just-retried `due_at=now` are not “late.” Do not use `createdAt` so “we see how long the job has existed,” and do not include `processing` in the oldest-due query so “the card shows the live claim.”

8. **Last run is newest `started_at`, including a still-`running` drain.** A crashed run that never finalized still wins if it started last. Do not filter `status: completed` so “last run means last success.”

9. **The job desk sort is not the drain claim sort.** Desk: `due_at` asc, then `priority` desc. Drain claim: `priority` desc, then `createdAt` asc. Do not silently switch the desk to the claim order so “the page matches who drains first.”

10. **Injectable `startDrain` is the test seam, not a second product path.** Default is `waitUntil` + swallow. Tests prove no `sheet_sync.queue.publish_failed`. Do not call already-recommended `publishSheetSyncWakeup` so “retry matches finalize,” and do not `await runSheetSyncDrain` on the request so “the response includes the summary.”

11. **Empty match does not call `updateMany`.** `{ requeued: 0, drain_started: false }`. A later `modifiedCount === 0` after a non-empty find also skips drain. Do not start a drain on an empty requeue so “someone might have become due.”

12. **Leave sibling modules alone.** Persist / finalize stay in already-recommended `sheetSyncCoordinator.ts`. Coalesce stays in the outbox. Wake-up stays in the queue. The drain stays in `runSheetSyncDrain`. Leftover Owner contains stays in `googleSheets/sheetContains.ts` (and leftover `expectedSheetTabs.ts` — both appeared after `googleSheets` was marked visited; do not reopen that folder in this pass). Later Observability overview **asks** the health card; it does not own retry. This file orchestrates count-the-outbox → page-jobs-and-runs → re-arm-failed → start-drain-from-this-desk.

13. **Do not treat contains, cron, or a domain save as this story.** `POST .../contains` is a live Master Sheet read. Cron is `runSheetSyncDrain("cron")` behind the queued gate. Form / Booking / Cancellation remember-then-finalize never import this file. Do not point Wave B retry at `finalizeSheetSync`, and do not teach this file `publishSheetSyncWakeup`.

## Testing

The **interface** is the test surface: `showTheSheetSyncHealthCard`, `pageTheSheetSyncJobDesk`, `pageTheSheetSyncRunDesk`, `openOneSheetSyncRun`, `putFailedSheetSyncJobsBackOnTheDeskAndStartADrain`. The health card fields and `{ requeued, drain_started }` are part of that **interface**.

Today’s `adminSheetSync.service.test.ts` already names health backlog age, job-desk filter + page, default-`failed` requeue + injectable drain, no queue-publish event, and empty-match no-op. Fill the gaps the story names make obvious:

**Show how backed-up Sheet Sync is**
- `pending` on the card is pending + retrying. `processing` stays out.
- Future `due_at` → `backlog_age_ms === 0`. Past `due_at` → age is `now - due_at` (already locked).
- Missing status buckets are `0`, not omitted, on the promoted fields. `jobs_by_status` may omit them.
- Newest run by `started_at` wins even when `status === "running"`.
- Job desk forwards `status` / `resource` / `entity_id` / `job_id` and does not invent `created_by`.
- Bad run id → 400. Missing run → 404. Attempts load by `run_id` oldest first. (No test today.)

**Put failed jobs back on the desk and start a drain**
- No `job_ids` / no `statuses` → `{ status: { $in: ["failed"] } }` (already locked).
- `statuses: ["cancelled"]` with no match → no `updateMany`, `drain_started: false` (already locked).
- `job_ids` present → filter is `_id $in`, `statuses` ignored. Prove today’s any-status find. Do not “fix” it to terminal-only.
- `$set` `pending` / `due_at` / `attempts: 0` / `created_by: "admin"`. `$unset` `leased_until` / `lease_owner` / `last_error` / `last_error_at` (already locked).
- `modifiedCount > 0` → injectable `startDrain` runs. Default path is `waitUntil(runSheetSyncDrain("admin"))`, not `publishSheetSyncWakeup` (already locked).
- Mode `legacy` / queue-topic env still starts the injected drain (already locked). Do not assert a mode skip that does not exist.

Do **not** add a test per helper (`countJobsByStatus`, `defaultFilterIsFailedOnly`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test already-recommended drain claim / timeout→pending / crash→retrying, coordinator persist / finalize, queue publish gates, leftover `checkSheetContains` verdicts, or later Observability overview rollup here.

## What I would not do

- An `AdminSheetSyncService` class with `get` / `list` / `retry`.
- Thirty two-line functions that only wrap `find` / `countDocuments`.
- Moving this into a CRUD folder, or into `sheetSync/` “because the outbox already lives there.”
- Pulling leftover `checkSheetContains` / `expectedSheetTabs` into this file so “one admin module owns every Sheet Sync button.”
- Calling already-recommended `publishSheetSyncWakeup` so “retry matches finalize.”
- Adding `getSheetSyncMode() !== "queued"` so “legacy cannot drain,” or teaching cron to skip that gate so “admin and cron match.”
- Silently fencing `job_ids` to `failed` / `cancelled` so “the file comment becomes true.”
- Resetting stuck `processing` as the default status filter so “heal owns the desk.”
- `await`ing the drain on the request so “the retry response includes the summary.”
- Writing a whole-folder recommendation for `admin`.
