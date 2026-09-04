# Rewrite Prior Lead CPL Snapshots After The Owner Changed The Book — Show What This Feed Would Rewrite In A New York Window — Freeze The Reviewed Leads And File A Job Only When The Preview Hash Still Matches — Claim A Lease And Rewrite One Batch — A Drifted Or Missing Reviewed Lead Is Stale Not A Silent Rewrite — Cancel Stops Later Batches And Keeps Finished Work — Analytics Handoff After Complete Never Un-Completes The Job — Never Touch A Lead That Arrived After Preview — Never Use createdAt — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 5 of this service — `cplCorrections.ts`
- Remaining in this service: `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/cplCorrections.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplCorrections.ts` is Owner correction jobs against stored Lead snapshots; leftover `cplSchedule.ts` is the writable CPL authority; Lead writes go through leftover `leads/leadCplResolution.ts`). Software rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (prior Lead rewrites require the separate Owner preview/apply workflow; freeze reviewed IDs and state; reject drift as `CPL_PREVIEW_STALE`; touch FormLead and CallLead collections only; keep immutable before/after evidence; workers use owner-guarded leases, stable cursors, transactional Lead-plus-checkpoint writes, resumable failures, safe cancellation, bounded windows/targets, and sanitized events/errors; schedule edits never rewrite prior Leads). Already-recommended leftover price book: [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (**asks** leftover `resolveCplFromPeriods`, leftover `mongoCplScheduleStore.loadSchedule`, leftover `businessDateToUtc`, leftover `storedLeadTimestampToCplInstant`, leftover `ownerInclusiveEndDateToExclusive`). Already-recommended leftover Lead snapshot **adapter**: [recommendations/leads-cpl-resolution.md](leads-cpl-resolution.md) (**asks** leftover `resolveCpl` on **new** Lead writes — not this file). Already-recommended leftover fourteen-slot book: [recommendations/cpl-cpl-rate.md](cpl-cpl-rate.md). Leftover `queries/health.ts` counts failed and expired-lease processing jobs on the job model itself — it does **not** import this file. This checkout’s `CONTEXT.md` does not define CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `v1.routes.ts` leftover `POST /admin/cpl-corrections/preview` first **asks** leftover `listCplSchedule` then leftover `previewCplCorrection` (stamps the live revision; strips leftover `reviewed_targets` from the JSON). Leftover `POST /admin/cpl-corrections` (**asks** leftover `createCplCorrection`, `202`). Leftover `GET /admin/cpl-corrections/:id` (**asks** leftover `getCplCorrectionJob`; leftover read actor). Leftover `POST /admin/cpl-corrections/:id/cancel` (**asks** leftover `cancelCplCorrectionJob`). Leftover cron `POST /api/cron/cpl-corrections-drain` (**asks** leftover `runDueCplCorrectionJobs` with `limit: 5`). Barrel: `operationsRegistry/index.ts`. Tests: `cplCorrections.test.ts` (in-memory job/lead stores: hash, preview sample vs full digest, Form-duplicate not Call-zero, stale hash / stale revision, audit without Lead payloads, late Lead excluded, reviewed-state drift, reviewed Lead disappeared, lease resume, overlapping workers, completed re-entry, cancel keeps finished work, partial failure retries the same Lead, Analytics once after complete, Analytics handoff failure leaves completed, inclusive business dates, stored Eastern window across DST).
- Seams callers need: Owner show-what-would-change vs Owner file-the-job vs worker rewrite-one-batch vs cron wake; leftover `withRegistryMutation` (job create/cancel + Registry Change before commit); leftover `CplCorrectionJobStore` / leftover `CplCorrectionLeadStore` / leftover `CplCorrectionGranularityStore` (tests inject); leftover `CplCorrectionResolver` (default **asks** leftover `priceALeadDayFromThesePeriods` after leftover `mapTheStoredEasternDayToNewYorkMidnight`); leftover Analytics invalidation **seam** (default is a live-query event; parent may replace); lease claim / renew / release; preview-hash CAS; frozen reviewed ids+state vs first-scan window; Lead CAS + leftover `CplLeadCorrection` evidence in the same session as the job checkpoint; Form-then-Call cursor; Owner `YYYY-MM-DD` vs stored Lead Eastern wall-clock `Date`
- Split later (only if the file outgrows one sitting): this ~2103-line file is one sitting if you read it as rewrite prior Lead CPL snapshots after the Owner changed the book — show what this Feed would rewrite in a New York window — freeze the reviewed Leads and file a job only when the preview hash still matches — claim a lease and rewrite one batch — a drifted or missing reviewed Lead is stale not a silent rewrite — cancel stops later batches and keeps finished work — Analytics handoff after complete never un-completes the job — never touch a Lead that arrived after preview — never use `createdAt`. If it later splits: `showWhatThisWindowWouldRewrite.ts` / `fileThePriorLeadRewriteJob.ts` / `showOrCancelTheRewriteJob.ts` / `rewriteOneFrozenLeadBatch.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover price-book writes, leftover new-Lead snapshot stamping, leftover fourteen-slot reads, leftover `withRegistryMutation`, leftover health job counts, or Wave B HTTP into this file

`previewCplCorrection` / `createCplCorrection` / `processCplCorrectionBatch` / `runDueCplCorrectionJobs` are executor mechanics. The owner question is: *The live book changed. Last month’s Leads still hold last month’s snapshot. The Owner picks one Feed and a New York business-date window. Show how many Form and Call Leads would change, and a short sample. Cap the window at 250 Leads. Freeze every reviewed Lead’s id and snapshot. File a job only when the Owner sends back the same preview hash and the book revision is still the one they reviewed. Do not rewrite a Lead in that confirm. A worker claims a lease, walks Form then Call, and for each frozen Lead: if the snapshot drifted or the Lead vanished, that is stale — stop, do not invent a new price. If the Lead already matches the book, skip it. If this job already stamped it, skip it. Else CAS-write the new snapshot, append immutable before/after evidence, and checkpoint the cursor in the same transaction. A failed Lead keeps the cursor so the next batch retries that Lead; earlier successes stay idempotent. Cancel stops later batches and keeps the work that already landed. When the last frozen Lead is accounted for, complete the job, then tell Analytics. If that handoff fails, the job stays completed. A Lead that arrived after preview is invisible. Do not use `createdAt`. Do not rewrite a new Lead write — that is leftover `priceTheLead`.*

Leftover price-book writes, leftover new-Lead snapshot stamping, leftover fourteen-slot reads, leftover `withRegistryMutation`, leftover health job counts, leftover cron auth, and Wave B CPL-correction HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “rewrite prior Lead CPL snapshots after the Owner changed the book — show what this Feed would rewrite in a New York window — freeze the reviewed Leads and file a job only when the preview hash still matches — claim a lease and rewrite one batch — a drifted or missing reviewed Lead is stale not a silent rewrite — cancel stops later batches and keeps finished work — Analytics handoff after complete never un-completes the job — never touch a Lead that arrived after preview — never use createdAt” story, not “a CPL correction CRUD service,” and not leftover schedule edit / leftover new-Lead stamp:

1. **Show the Owner what this window would rewrite** — `previewCplCorrection`. Normalize the Feed id, the target `schedule_revision` (≥ 1), and the window (Owner inclusive `YYYY-MM-DD` → leftover `newYorkMidnightFromABusinessDate` / leftover `ownerInclusiveEndToNextMidnight`, or raw instants). Missing Feed → `NOT_FOUND`. Live revision ≠ target → `CPL_PREVIEW_STALE` (refresh). Count matching Form + Call Leads in the stored-Eastern window; more than 250 → `DEPENDENCY_CONFLICT` (smaller window). Scan Form then Call in id order. For each Lead, **ask** leftover `resolveTargetCpl` with `duplicate: true` only when the Lead is a Call Lead marked duplicate (a Form duplicate is priced as an ordinary Lead). Compare current snapshot to the target fields. Build a selection digest over every Lead (not only the sample). Hash the selection + counts + digest + max Form/Call ids — not the sample rows. Return the hash, the normalized window, the impact, and leftover `reviewed_targets` (Wave B HTTP strips that last bag). This beat does **not** write a job. This beat does **not** rewrite a Lead. This beat does **not** require Owner (Wave B preview still gates Owner).

2. **File the rewrite job when the preview still matches** — `createCplCorrection`. Owner only. `confirm` must be `true`. Re-run operation 1. Hash mismatch or a book that moved → `CPL_PREVIEW_STALE` and **no** job. Else leftover `withRegistryMutation`: insert a `pending` job that freezes the reviewed ids+state, the window, the revision, the hash, and the max Form/Call ids; write one Registry Change (`action: "correction"`, `entityType: "source_granularity"`, `entityId` is the Feed). Audit `after` / `metadata` carry counts and the hash — not Lead payloads. This beat does **not** stamp a Lead. This beat does **not** claim a lease. Wave B POST returns `202`.

3. **Show the job, or cancel it before it finishes** — `getCplCorrectionJob` / `cancelCplCorrectionJob`. Show maps the job to leftover `CplCorrectionJobView` (missing → `NOT_FOUND`). Cancel is Owner only. Already cancelled → return it. Completed or failed → `DEPENDENCY_CONFLICT`. Else leftover `withRegistryMutation` marks `cancelled`, clears the lease, writes another Registry Change (`operation: "cancel"`), then leftover `cpl_correction.cancelled`. Finished Lead snapshots stay. This beat does **not** rewind a stamped Lead.

4. **Claim a lease and rewrite one frozen batch** — `processCplCorrectionBatch` (cron **asks** leftover `runDueCplCorrectionJobs`, which finds claimable jobs and **asks** this). Claim `pending` / `processing` when the lease is missing or expired. Held by someone else, already completed, or already cancelled → `{ claimed: false }` and do not touch Leads. For each Lead in the batch: refresh cancel; renew the lease (lost lease → stop, leftover `cpl_correction.lease_lost`); if the frozen snapshot drifted or the Lead is gone from the reviewed list → `CPL_PREVIEW_STALE`, count a failure, keep the cursor **before** that Lead, and if the code is preview-stale mark the job `failed`. If this job already stamped the Lead and it still matches, or the live snapshot already matches the book → `no_op`. Else CAS-update the Form or Call row (expected filter is the reviewed snapshot), append leftover `CplLeadCorrection` before/after, checkpoint counts + cursor in the same leftover `runMutation` session. After the batch: if the scan is done and accounted (changed + no-op + failed) is short of `matched_count`, the missing reviewed Leads fail the job (`cpl_correction.reviewed_target_missing`). Else complete, release the lease, leftover `cpl_correction.completed`, and only then leftover `invalidateAnalytics` when `changed_count > 0`. Analytics throw → leftover `cpl_correction.analytics_handoff_failed`; the job stays `completed`. Book revision changed at the start of the batch → stale, job `failed`. This beat does **not** invent a Lead that arrived after preview. This beat does **not** use `createdAt`.

There is no fifth schedule-edit operation. There is no leftover `priceTheLead` operation. Leftover `withRegistryMutation` is the job create/cancel transaction **adapter**. Leftover stores are the persistence **adapter**. Leftover `createDefaultCplCorrectionResolver` is the price **adapter** (loads the unarchived book once per Feed+revision, maps the stored Eastern day, **asks** leftover `priceALeadDayFromThesePeriods`). Leftover `configureCplCorrectionAnalyticsInvalidation` is the completion handoff **adapter**. Wave B HTTP and leftover cron are second show / file / cancel / wake **adapters**, not a second owner story.

`normalizeCplCorrectionSelection` / `cplCorrectionWindowToStoredLeadRange` / `computeCplCorrectionPreviewHash` sit on operations 1 and 2. They are the calendar-and-hash beats leftover HTTP and leftover tests already **ask**, not extra owner operations. Do not export leftover `applyCorrectionToLead` / leftover `leadTimestampFilter` / leftover `queryLeadBatch` as a public **seam**.

## Organization

Keep one file as the screenplay for “rewrite prior Lead CPL snapshots after the Owner changed the book, show what this Feed would rewrite in a New York window, freeze the reviewed Leads and file a job only when the preview hash still matches, claim a lease and rewrite one batch, a drifted or missing reviewed Lead is stale not a silent rewrite, cancel stops later batches and keeps finished work, Analytics handoff after complete never un-completes the job, never touch a Lead that arrived after preview, never use `createdAt`.” Leftover price-book writes, leftover new-Lead snapshot stamping, leftover fourteen-slot reads, leftover `withRegistryMutation`, leftover health job counts, leftover cron auth, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CplCorrectionService` class. Do not invent a begin / complete **seam** for the Owner file — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. The worker’s lease + Lead-plus-checkpoint session is the rewrite **seam**; do not invent a second one. Do not invent a second store **adapter** beside leftover `CplCorrectionJobStore` / leftover `CplCorrectionLeadStore`. Do not invent a second price **adapter** beside leftover `resolveTargetCpl`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `preview.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move leftover `priceTheLead` into this file so “one file owns Lead CPL.” Do not move leftover `cplSchedule.ts` writes into this file so “edits rewrite old Leads.” Do not silently raise the 250-Lead cap so “the Owner can do a year.”

**External interface** stays small (this is the test surface). Show, file, watch/cancel, and rewrite-one-batch are one story’s prior-Lead rewrite, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewCplCorrection` | `showWhatThisWindowWouldRewrite` | Wave B preview POST; leftover file re-runs this before the hash check |
| `createCplCorrection` | `fileThePriorLeadRewriteJob` | Wave B create POST (`202`); writes the job, not the Leads |
| `getCplCorrectionJob` | `showTheRewriteJob` | Wave B detail GET |
| `cancelCplCorrectionJob` | `cancelTheRewriteJob` | Wave B cancel POST; leftover worker honors `cancelled` |
| `processCplCorrectionBatch` | `rewriteOneFrozenLeadBatch` | leftover cron and leftover tests **ask** the same worker |
| `runDueCplCorrectionJobs` | `wakeDueRewriteJobs` | leftover cron drain (`limit: 5`); finds claimable, then **asks** the batch |
| `normalizeCplCorrectionSelection` | `readTheOwnerWindow` | leftover HTTP and leftover tests share inclusive dates vs instants |
| `cplCorrectionWindowToStoredLeadRange` | `mapTheNewYorkWindowOntoStoredEasternDays` | leftover Mongo lead query; leftover DST test |
| `computeCplCorrectionPreviewHash` | `hashTheFrozenSelection` | leftover file CAS; leftover tests lock stability |
| `createDefaultCplCorrectionDependencies` | `theLivePriorLeadRewrite` | Wave B + leftover cron wire Mongo stores + leftover live-query Analytics |
| `configureCplCorrectionAnalyticsInvalidation` / `getCplCorrectionAnalyticsInvalidationSeam` | `registerTheAnalyticsHandoff` / `theAnalyticsHandoff` | leftover tests replace the default live-query event |
| `CplCorrectionPreviewResult` / `CplCorrectionJobView` / `CplCorrectionBatchResult` | `OwnerRewritePreview` / `OwnerRewriteJob` / `RewriteBatchOutcome` | Wave B JSON + leftover cron JSON |

Keep the old names as one-line aliases until leftover HTTP, leftover cron, leftover barrel, and leftover tests migrate. Do not make callers learn `createCplCorrection` as “rewrite the Leads.”

**Principle: old exports stay as aliases.** `previewCplCorrection` remains the imported name until Wave B preview POST migrates. `createCplCorrection` remains the imported name until Wave B create POST migrates. Persisted Registry Change `action` (`correction`), persisted job `status` strings, persisted leftover `cpl_resolution_version` (`operations-registry-cpl-correction-v1`), and persisted Operational Event keys stay those strings — they are audit / Lead-snapshot history, not story names.

**No class for the workflow.** The types that *do* earn names are the frozen selection leftover file persists and the job view leftover HTTP already returns:

```ts
type FrozenPriorLeadRewrite = {
  source_granularity_id: string
  window_from: Date
  window_until: Date
  target_schedule_revision: number
  preview_hash: string
  reviewed_targets: ReviewedLeadSnapshot[]
  max_form_lead_id: string | null
  max_call_lead_id: string | null
}

type OwnerRewriteJob = {
  id: string
  status: "pending" | "processing" | "completed" | "cancelled" | "failed"
  preview_hash: string
  matched_count: number
  changed_count: number
  no_op_count: number
  failed_count: number
  cursor: { lead_model: "FormLead" | "CallLead"; lead_id: string } | null
}
```

That is the handoff from “the Owner reviewed this window” to “the worker may touch only these frozen Leads.” Do **not** add `rewriteFromTheLiveWindow` so “new Leads in the dates get the new price.” Do **not** add `priceTheLead` so “one resolver owns new and old.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add `priceALeadDayFromThesePeriods` as a public **seam** from this file — leftover `cplSchedule.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cplCorrections.ts
// The live book changed.
// Last month’s Leads still hold last month’s snapshot.
// The Owner picks one Feed and a New York window.
// Show what would change. Freeze those Leads.
// File a job only when the preview hash still matches.
// A worker claims a lease and rewrites one frozen batch.
// Drift or a missing reviewed Lead is stale, not a silent rewrite.
// Cancel stops later batches and keeps finished work.
// Analytics after complete never un-completes the job.
// A Lead that arrived after preview is invisible.
// Do not use createdAt.

// ── 1. Show what this window would rewrite ────────────────

export async function showWhatThisWindowWouldRewrite(command)
export function readTheOwnerWindow(command)             // id, revision ≥ 1, dates or instants
export function mapTheNewYorkWindowOntoStoredEasternDays(window)
export function hashTheFrozenSelection(selection, impact)
async function refuseUnlessTheBookRevisionIsTheOneTheyReviewed(feedId, revision)
async function refuseAWindowBiggerThanTwoHundredFiftyLeads(selection)
async function scanFormThenCallAndPriceEachLead(selection)
function priceAFormDuplicateAsAnOrdinaryLead(lead)      // Call + duplicate only → leftover duplicate_zero
function thisLeadWouldChange(lead, target)
function digestEveryLeadNotOnlyTheSample(lead, target)

// ── 2. File the rewrite job ───────────────────────────────

export async function fileThePriorLeadRewriteJob(command, actor)
function refuseUnlessTheOwnerConfirmed(command)
async function refuseUnlessThePreviewHashStillMatches(command)
async function persistThePendingJobInTheSameTransactionAsTheChange(preview, actor)
  // leftover withRegistryMutation; action "correction"; no Lead payloads

// ── 3. Show or cancel ─────────────────────────────────────

export async function showTheRewriteJob(jobId)
export async function cancelTheRewriteJob(jobId, actor, reason)
function refuseCancelWhenTheJobAlreadyFinished(job)
async function markCancelledAndClearTheLease(job, actor)

// ── 4. Claim a lease and rewrite one frozen batch ─────────

export async function wakeDueRewriteJobs(deps, { limit })
export async function rewriteOneFrozenLeadBatch(jobId)
async function claimTheLeaseOrSaySomeoneElseHasIt(jobId, owner)
async function refuseIfTheBookMovedDuringTheBatch(selection)
async function walkTheNextFrozenLeads(selection, cursor, limit)
async function applyOneFrozenLeadOrSayStale(jobId, lead, selection, session)
  // drifted reviewed state → CPL_PREVIEW_STALE
  // already this job + matches, or already matches the book → no_op
  // else CAS Lead + append CplLeadCorrection + checkpoint cursor
function keepTheCursorBeforeAFailedLead(cursor, lead)
async function failIfReviewedLeadsDisappeared(job, accounted)
async function completeThenTellAnalytics(job)
  // Analytics throw → event; status stays completed
```

Read the primary path out loud: *The Owner changed January’s book. They ask what last month’s Best Relocation Form and Call Leads would look like now. We map that New York window onto the stored Eastern days, scan Form then Call, price each Lead from the live book — a Form duplicate is not Call-zero — and hand back a hash of the frozen set. They confirm with that hash. We re-scan, and only then file a pending job with those exact Lead snapshots and one Registry Change. We do not stamp a Lead yet. A cron drain claims the lease, walks fifty frozen Leads, and for each one: if someone patched CPL after preview, stop as stale; if a new Lead appeared in the same dates, ignore it; if the snapshot already matches, skip; else CAS-write the new rate, keep the before/after row, and move the cursor. If a write throws, the cursor stays on that Lead so the next batch retries it. If the Owner cancels after twenty successes, those twenty stay and the rest do not run. When every reviewed Lead is accounted for, the job is completed, then Analytics hears about it. If that hear-about fails, the job is still completed. Do not use createdAt.*

That is the operation. `createCplCorrection` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`createCplCorrection` does not rewrite a Lead.** It re-runs the preview and inserts a `pending` job. The name sounds like leftover `priceTheLead`. Rename the beat (`fileThePriorLeadRewriteJob`) so “confirm is a filing” is visible. Do not silently stamp Leads inside leftover `create` so “apply means apply.”

2. **`HashImpactInput.sample` is not in the hash.** Leftover `computeCplCorrectionPreviewHash` canonicalizes selection + counts + digest + bounds. The sample array is accepted and ignored. Leftover tests pass sample into the helper and still lock stability. Rename the type so the digest-not-sample **seam** is visible. Do not silently hash the sample so “the Owner’s screen is the lock” — that would invalidate live preview hashes.

3. **`listSample` is unused by the preview.** Operation 1 **asks** leftover `countMatching` then leftover `listBatch` until the scan ends. Leftover `listSample` sorts a first page and is never called. Do not silently switch the preview onto leftover `listSample` so “sample is cheaper” — the digest must see every Lead.

4. **Two no-op paths in leftover `applyCorrectionToLead`.** “This job already stamped it and it still matches” and “it already matches the book” both return `no_op`. The first is resume idempotence. The second is “the book already agrees.” Keep both beats named. Do not silently skip the job-id check so “match is enough” without a paired interface test for a Lead stamped by a *different* job that happens to match.

5. **Claim overwrites `started_at` on resume.** Leftover `claimForProcessing` `$set`s `started_at: now` every successful claim, including an expired-lease resume. The first-batch / second-batch resume test does not lock the original start. Name the overwrite. Do not silently preserve the first `started_at` in this rename without a paired interface test.

6. **`targetAmount` is a leftover unused export.** Preview and apply **ask** leftover `resolutionToLeadFields`. Leftover `targetAmount` is re-exported and has no caller. Do not silently teach Wave B to display leftover `targetAmount` so “one number wins” — `missing_rate` uses `fallback_amount`, not `amount`.

7. **Wave B preview stamps the revision; create requires the Owner send it.** Leftover `handleCplCorrectionPreview` **asks** leftover `showTheOwnerTheCurrentCplBook` then this file. Leftover create Zod requires `target_schedule_revision` + `preview_hash`. Do not silently ignore the posted revision and re-read the live book so “the Owner cannot be stale” — the stale-revision **seam** is the point.

8. **Wave B Zod caps the window at 366 inclusive days; this file does not.** Leftover `isBoundedCorrectionWindow` is HTTP. This module only refuses `until <= from`. Do not silently copy the 366-day cap into leftover `readTheOwnerWindow` so “one guard wins” without a paired interface test — instant-kind callers (tests) are not on that Zod.

9. **Leftover health does not **ask** this file.** Leftover `queries/health.ts` counts `failed` jobs and `processing` rows whose lease has expired on the job model. Do not silently route those counts through leftover `findClaimable` so “one store wins” in this rename — that is leftover health, next on the checklist later.

10. **Default Analytics is a live-query event, not a rebuild.** Leftover `configureCplCorrectionAnalyticsInvalidation` comment says there is no materialized CPL cache. The default writes leftover `analytics.cpl_correction.invalidated` with `analytics_mode: "live_query"`. Do not silently rebuild an Analytics collection so “invalidation means rebuild.” Do not silently skip the event when `changed_count > 0` so “live queries need no hint.”

11. **Form duplicate is not Call-zero.** The test `Form duplicate flags do not invoke Call duplicate-zero CPL semantics` is load-bearing. Leftover `priceTheLead` / leftover `resolveCpl` treat `duplicate: true` as Call-only. Do not silently pass `lead.duplicate` for Form Leads so “duplicate always means zero.”

12. **A Lead that arrives after preview is excluded by frozen `$in`, not by max id alone.** Leftover `leadTimestampFilter` with leftover `reviewed_targets` queries `_id: { $in: reviewedIds }`. The late-Lead test pushes a Form Lead after file and asserts no `cpl_correction`. Do not silently drop leftover `reviewed_targets` and scan the live window so “the dates are the truth.”

13. **A failed Lead keeps the cursor.** The comment and the partial-failure test lock it: first batch changes the earlier Leads, fails Form `02`, leaves `failed_count: 1`, and the next batch retries that Lead. Do not silently advance the cursor past a failure so “the drain always moves forward.”

14. **Reviewed-state drift fails the job, not only the Lead.** When leftover `applyCorrectionToLead` throws `CPL_PREVIEW_STALE`, leftover `processCplCorrectionBatch` marks the job `failed` and releases the lease. A generic write error stays `processing` so a later batch can retry. Do not silently keep preview-stale in `processing` so “all failures resume.”

15. **`create` audit entity is the Feed, not the job.** Registry Change `entityType: "source_granularity"`, `entityId` is the Feed. The job id is not the audit entity. Do not silently retarget leftover `entityType` to `cpl_correction_job` so “the job is the record” without a paired interface test — leftover `action: "correction"` is history.

16. **Leave sibling modules alone.** Leftover `withRegistryMutation`, leftover `priceALeadDayFromThesePeriods`, leftover `priceTheLead`, leftover `listCplSchedule`, leftover fourteen-slot `getCplRate`, leftover health job counts, leftover cron auth, and Wave B CPL-correction HTTP are already the right **depth**. This file owns the prior-Lead rewrite.

17. **Do not silently change persisted audit `action`, job `status`, event keys, or leftover `cpl_resolution_version`.** `correction`, `pending` / `processing` / `completed` / `cancelled` / `failed`, `cpl_correction.*`, and `operations-registry-cpl-correction-v1` are history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `showWhatThisWindowWouldRewrite`, `fileThePriorLeadRewriteJob`, `showTheRewriteJob`, `cancelTheRewriteJob`, `rewriteOneFrozenLeadBatch`, `wakeDueRewriteJobs`, leftover calendar/hash exports leftover HTTP and leftover tests already **ask**.

Today’s `cplCorrections.test.ts` already names hash stability, sample-vs-full digest, Form-duplicate not Call-zero, stale hash / stale revision, audit without Lead payloads, late Lead excluded, reviewed-state drift, reviewed Lead disappeared, lease resume, overlapping workers, completed re-entry, cancel keeps finished work, partial failure retries the same Lead, Analytics once after complete, Analytics handoff failure leaves completed, inclusive business dates, and stored Eastern window across DST. Keep that **interface**. Rename the tests to the operations. Do not add a model-index assertion as a fifth owner operation.

Prove the operations:

**Show / file**
- Missing Feed → `NOT_FOUND`. Live revision ≠ target → `CPL_PREVIEW_STALE`, no job.
- More than 250 matching Leads → `DEPENDENCY_CONFLICT` (smaller window). A scan that grows past 250 mid-preview → `CPL_PREVIEW_STALE`.
- Hash is stable for the same selection + counts + digest + bounds. Changing one Lead’s CPL after the first preview changes the hash even when that Lead is outside the sample.
- Form `duplicate: true` still targets leftover `resolved`, not leftover `duplicate_zero`.
- Stale hash or `confirm !== true` → no job. Matching hash + Owner → `pending` job, leftover `action: "correction"`, no Lead payloads on the Change, no Lead `cpl_correction` yet.
- Non-owner actor → `FORBIDDEN`.

**Rewrite one batch / cancel**
- Late Lead pushed after file is not stamped.
- Reviewed CPL patched after file → `failed`, that Lead has no `cpl_correction`.
- Reviewed Call Lead removed after file → two Form changes, one failed, job `failed`, `completed: false`.
- Expired lease: first batch writes two, second worker finishes the third. Overlapping live lease → `{ claimed: false, processed: 0 }`.
- Re-enter completed → `{ claimed: false, completed: true }`.
- Cancel after two successes: those two keep `cpl_correction.job_id`; the third is untouched; leftover `cpl_correction.cancelled`; a later batch returns `{ cancelled: true, processed: 0 }`.
- Simulated write throw on Form `02`: `failed_count: 1`, cursor stays so the next batch stamps that Lead; leftover `cpl_correction.lead_failed`.
- Book revision changed at batch start → stale, no further stamps.

**Analytics / calendar**
- `changed_count > 0` → leftover `invalidateAnalytics` once after complete. Throw → leftover `cpl_correction.analytics_handoff_failed`, job stays `completed`.
- Owner inclusive `2026-01-01`..`2026-01-31` → `2026-01-01T05:00:00.000Z` .. `2026-02-01T05:00:00.000Z`. Stored Eastern query for spring DST `2026-03-08`..`2026-03-08` → pseudo-UTC midnight `2026-03-08` .. `2026-03-09`. Do not re-test leftover `priceTheLead` stamping here. Do not re-test leftover `changeCplFromABusinessDate` here.

Do **not** add a test per helper (`priceAFormDuplicateAsAnOrdinaryLead`, `keepTheCursorBeforeAFailedLead`, `canonicalizeForHash`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`hashTheFrozenSelection` / `readTheOwnerWindow` / `mapTheNewYorkWindowOntoStoredEasternDays` stay exported because leftover HTTP and leftover tests share those **adapters**, not because a test leaked. Leftover `priceTheLead` owns the new-Lead stamp proof; leftover `changeCplFromABusinessDate` owns the book-edit proof; leftover health owns the failed-job count proof — do **not** retest leftover fourteen-slot `getCplRate` here.

## What I would not do

- A `CplCorrectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation`, leftover `priceALeadDayFromThesePeriods`, or leftover `claimForProcessing`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `preview.ts`) for cleanliness.
- Breaking the job-create + Registry Change before-commit **seam**, or the Lead CAS + evidence + checkpoint session **seam**, or the complete-then-Analytics after-commit **seam**. A failed audit must not leave a job. A failed Analytics handoff must not un-complete a job.
- Treating leftover price-book writes, leftover new-Lead snapshot stamping, leftover fourteen-slot reads, leftover health job counts, leftover cron auth, or Wave B CPL-correction HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not stamp Leads inside leftover `create`; do not hash the sample; do not switch preview onto leftover `listSample`; do not drop leftover `reviewed_targets` and rescan the live window; do not pass Form `duplicate` into leftover Call-zero; do not advance the cursor past a failed Lead; do not keep preview-stale in `processing`; do not overwrite leftover `started_at` “fix” without a test; do not copy the HTTP 366-day cap into this module; do not ignore the posted revision; do not retarget leftover Change `entityType` to the job; do not rebuild an Analytics collection; do not raise the 250-Lead cap; do not use `createdAt`; do not rewrite Booked / Cancelled / historical collections; do not rename persisted `correction` / job `status` / event keys / `operations-registry-cpl-correction-v1`; do not move leftover `priceTheLead` or leftover `cplSchedule.ts` into this file.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
