# After The Cron Secret Proves This Tick Is Ours, Wake Up To Five Due Prior-Lead CPL Rewrite Jobs — Never Claim A Lease Here, Never Preview A Window, Never Stamp A Lead, Never File Or Cancel A Job, Never Use The API Secret Or Owner HMAC — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 23 of this service — `cpl-correction-cron.routes.ts`
- Remaining in this service: `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/cpl-correction-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (module list: `cplCorrections.ts` is Owner correction jobs against stored Lead snapshots; leftover `cplSchedule.ts` is the writable CPL authority; new Lead writes go through leftover `leads/leadCplResolution.ts`. The Service does **not** name this file or `ALL /api/cron/cpl-corrections-drain`). Software rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (prior Lead rewrites require the separate Owner preview/apply workflow; freeze reviewed IDs and state; reject drift as `CPL_PREVIEW_STALE`; touch FormLead and CallLead only; workers use owner-guarded leases, stable cursors, transactional Lead-plus-checkpoint writes, resumable failures, safe cancellation, bounded windows/targets, and sanitized events/errors; schedule edits never rewrite prior Leads). Distinct from already-recommended prior-Lead rewrite: [operations-registry-cpl-corrections.md](operations-registry-cpl-corrections.md) (`previewCplCorrection` / `createCplCorrection` / `getCplCorrectionJob` / `cancelCplCorrectionJob` / `processCplCorrectionBatch` / `runDueCplCorrectionJobs` / `createDefaultCplCorrectionDependencies` — this file **asks** the last two after `connectMongo` with `{ limit: 5 }`; that file shows the New York window, files the job only when the preview hash still matches, claims a 60s lease, rewrites one frozen Form-then-Call batch of 50, treats drift / a missing reviewed Lead as stale, keeps finished work on cancel, and hands Analytics after complete; **this file never previews, never files, never cancels, never claims a lease, and never stamps a Lead**. Wave A already said: `runDue` finds claimable `pending` / `processing` with a missing or expired lease, oldest `createdAt` first, default `limit` **1**; leftover cron overrides to **5**; a held lease is `{ claimed: false }` inside the batch, not HTTP `lease_held`). Distinct from already-recommended leftover price book: [operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (schedule edits never rewrite prior Leads — **does not import** this file). Distinct from already-recommended leftover new-Lead stamp: [leads-cpl-resolution.md](leads-cpl-resolution.md) (`resolveCpl` on **new** Lead writes — **this file never prices a new Lead**). Distinct from already-recommended leftover fourteen-slot book: [cpl-cpl-rate.md](cpl-cpl-rate.md). Distinct from already-recommended Owner mount: [routes-v1.md](routes-v1.md) (`POST /api/v1/admin/cpl-corrections/preview`, `POST /api/v1/admin/cpl-corrections` **202**, `GET .../:id`, `POST .../:id/cancel` after `requireApiSecret` + leftover `requireRegistryOwnerActor` / leftover `requireRegistryReadActor`; preview strips leftover `reviewed_targets`; **does not import** this file). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (mode gate **on the route**, no-op unless `queued`, HTTP `{ skipped: true }` — **does not import** this file; **this file has no mode gate**). Distinct from already-recommended Lead Messaging cron: [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) (always-ask drain, **200** `{ summary }`, **500** may echo `error.message` — **does not import** this file; **this file 500s a generic code**). Distinct from already-recommended rematch cron: [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (flag default **on**, HTTP `{ skipped: true }` when off — **does not import** this file). Distinct from already-recommended Call Log cron: [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (`lease_held` **200** + factory inject; flags default **false** — **does not import** this file). Distinct from already-recommended letters: [observability-record-operational-event.md](observability-record-operational-event.md) (Wave A batch **asks** `cpl_correction.completed` / `cpl_correction.cancelled` / `cpl_correction.lease_lost` / `cpl_correction.reviewed_target_missing` / `cpl_correction.analytics_handoff_failed` / `cpl_correction.lead_failed`; **this file never asks letters** — it only logs `cpl_correction.cron.failed`). Distinct from other secrets: `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). There is **no** dedicated queue consumer for CPL corrections — Mongo `findClaimable` is the due list; cron is the only wake. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it does not define CPL; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one thin HTTP harness.** `src/app.ts` **asks** the default export (`app.use(cplCorrectionCronRoutes)` on line 60 — **after** already-recommended RingCentral cron / rematch cron / Sheet Sync cron / Lead Messaging cron, **before** next notification cron, already-recommended Twilio desks, Best Relocation / reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1). `src/routes/cpl-correction-cron.routes.test.ts` **asks** the live default export — missing `CRON_SECRET` **500** (status only), Bearer mismatch **401** (status only). Wave A folder tests prove preview / file / cancel / lease / stale / Analytics through `cplCorrections.test.ts`, not this router. Operator `hit-vantage-api` lists Owner `POST /api/v1/admin/cpl-corrections/preview`, `POST /api/v1/admin/cpl-corrections`, `GET .../:id`, `POST .../:id/cancel`, **not** `/api/cron/cpl-corrections-drain`. Host public/unguarded tables omit this path. Not this **interface**: `runDueCplCorrectionJobs` itself, `processCplCorrectionBatch` itself, `previewCplCorrection` itself, `createCplCorrection` itself, `cancelCplCorrectionJob` itself, `createDefaultCplCorrectionDependencies` itself, leftover `listCplSchedule` itself, leftover `resolveCpl` itself.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs `requireApiSecret` vs Owner HMAC vs leftover `requireRegistryOwnerActor`; always-ask wake **200** `{ ok: true, claimed: results.length, results }` (empty due list is still 200 with `claimed: 0`) vs already-recommended Sheet Sync **200** `{ skipped: true }` vs rematch flag-off skip vs Call Log `lease_held`; unexpected throw **500** generic `"CPL correction drain failed"` + `code: "CPL_CORRECTION_DRAIN_FAILED"` (does **not** echo `error.message`) vs already-recommended Lead Messaging / Sheet Sync 500 that may echo the message vs rematch unhandled Express; HTTP `claimed` is the **array length** vs Wave A `CplCorrectionBatchResult.claimed` (lease won); `connectMongo` on this desk vs Wave A `runDue` assuming a live connection; no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; cron `limit: 5` vs Wave A default `limit` **1**; no mode / flag gate vs Sheet Sync queued-only vs rematch default-on vs RingCentral default-false. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no publish **seam**. There is no route-level mode **seam**. There is no queue-consumer **seam**.
- Split later (only if the file outgrows one sitting): this ~55-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake up to five due prior-Lead CPL rewrite jobs — never claim a lease here, never preview a window, never stamp a Lead, never file or cancel a job, never use the API secret or Owner HMAC. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`. Show / file / cancel / rewrite-one-batch stay already-recommended `cplCorrections.ts`. Owner HTTP stays leftover `v1.routes.ts`. Price-book writes stay already-recommended `cplSchedule.ts`. New-Lead stamps stay already-recommended `leadCplResolution.ts`. Notification digest stays next `notification-cron.routes.ts`.

`router.all("/api/cron/cpl-corrections-drain")` is an HTTP verb. The owner question is: *Vercel just woke us — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. Then open Mongo and ask Wave A to wake up to five due rewrite jobs. Echo how many jobs we asked about, and each batch bag. An empty due list is still 200 with `claimed: 0`. A held lease is inside a batch `{ claimed: false }`, not HTTP `lease_held`. Only an unexpected throw is 500, and that 500 is a generic code — do not echo the message. Do not preview a window in this file. Do not file a job. Do not cancel a job. Do not claim a lease. Do not stamp a Lead. Do not compare `x-api-secret`. Do not require Owner HMAC.*

Who show the window / file the job / claim the lease / rewrite one frozen batch / cancel later batches already lives in already-recommended `cplCorrections.ts`. Who gate Owner preview / file / cancel already lives in leftover `v1.routes.ts`. Who name the live book already lives in already-recommended `cplSchedule.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, wake up to five due prior-Lead CPL rewrite jobs” story, not “a cron CRUD dump,” and not Show What This Window Would Rewrite / File The Prior-Lead Rewrite Job / Rewrite One Frozen Lead Batch themselves:

1. **Wake up to five due prior-Lead rewrite jobs** — `ALL /api/cron/cpl-corrections-drain`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not configured" }`. Mismatch **401** `{ ok: false, error: "Unauthorized" }`. Then **asks** `connectMongo()`, then `runDueCplCorrectionJobs(createDefaultCplCorrectionDependencies(), { limit: 5 })`, and **200** `{ ok: true, claimed: results.length, results }`. There is **no** HTTP `skipped`. An empty due list is still **200** `{ claimed: 0, results: [] }` — the route still opened Mongo. Unexpected throw logs `cpl_correction.cron.failed` and **500** `{ ok: false, error: "CPL correction drain failed", code: "CPL_CORRECTION_DRAIN_FAILED" }` — it does **not** echo `error.message`. This beat does **not** **ask** `previewCplCorrection`. This beat does **not** **ask** `createCplCorrection`. This beat does **not** **ask** `cancelCplCorrectionJob`. This beat does **not** **ask** `processCplCorrectionBatch` directly (Wave A `runDue` does). This beat does **not** **ask** `getSheetSyncMode` / a rematch flag / a RingCentral flag. This beat does **not** map a held per-job lease onto HTTP `{ skipped: true, reason: "lease_held" }`. This beat does **not** **ask** `recordOperationalEvent`. This beat does **not** compare `x-api-secret`. This beat does **not** **ask** leftover `requireRegistryOwnerActor`.

`requireCronAuth` is a beat inside this operation, not an extra owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second show-the-window operation. Wave A preview lives on leftover Owner POST. There is no third file-the-job operation. There is no fourth cancel operation. There is no fifth claim-a-lease operation. Wave A `processCplCorrectionBatch` elects each job’s 60s lease. There is no sixth Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake up to five due prior-Lead CPL rewrite jobs — never claim a lease here, never preview a window, never stamp a Lead, never file or cancel a job, never use the API secret or Owner HMAC.” Already-recommended show / file / cancel / rewrite-one-batch / live deps already live in deeper **modules**. Do not pull those in. Do not invent a `CplCorrectionCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** Wave A `runDue`. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner preview.” Do not invent a route-level mode **adapter** so “this desk matches Sheet Sync queued-only.” Do not invent a lease **adapter** beside already-recommended `DEFAULT_CPL_CORRECTION_LEASE_MS`. Do not invent a queue **adapter** so “every drain uses `@vercel/queue`.” Do not invent a CRUD folder so `drain.ts` / `cron.ts` each get a file.

Do not move `runDueCplCorrectionJobs` into this file so “the route owns the drain.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside `v1.routes.ts` so “one file owns every CPL correction.” Do not merge this router into leftover Owner `cpl-corrections*` so “one file owns every rewrite start.” Do not merge this router into already-recommended Lead Messaging cron so “one file owns every five-minute `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `priorLeadCplRewriteDrainCronDesk` | `app.ts` mounts the instance **after** Lead Messaging cron, **before** next notification cron |
| `ALL /api/cron/cpl-corrections-drain` (today unexported handler) | `wakeUpToFiveDuePriorLeadRewriteJobsOverHttp` | auth **then** Mongo **then** `runDue` with `limit: 5`; no HTTP skip |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `DEFAULT_CPL_CORRECTION_LEASE_MS` / `DEFAULT_CPL_CORRECTION_BATCH_SIZE` / leftover `reviewed_targets` / leftover `cpl_resolution_version` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createCplCorrectionCronRouter({ runDue, limit })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after Wave A returns batch bags:

```ts
type PriorLeadRewriteDrainFinishedOverHttp = {
  ok: true
  claimed: number // results.length — jobs asked, not leases won
  results: Array<{
    job_id: string
    claimed: boolean
    processed: number
    changed: number
    no_op: number
    failed: number
    completed: boolean
    cancelled: boolean
  }>
}
```

That is the **200** handoff from “Vercel woke us” to “Wave A asked up to five claimable jobs.” Do **not** add `skipped: true` onto that bag so “this desk matches Sheet Sync / rematch.” Do **not** collapse Wave A `result.claimed === false` into HTTP `{ reason: "lease_held" }` so “every cron maps overlap.” Do **not** rename HTTP `claimed` to `asked` in this rename without a paired harness — today’s body uses `claimed` for the array length. Do **not** add `leads[]` / phones / leftover `reviewed_targets` onto the **200** so “the owner can see every frozen Lead on the cron body.”

Leave `runDueCplCorrectionJobs` / `processCplCorrectionBatch` / `previewCplCorrection` / `createCplCorrection` / `cancelCplCorrectionJob` on already-recommended `cplCorrections.ts`. Leave Owner HTTP on leftover `v1.routes.ts`. Leave the live book on already-recommended `cplSchedule.ts`. Leave new-Lead stamps on already-recommended `leadCplResolution.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cpl-correction-cron.routes.ts
// Vercel just woke us — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// Open Mongo, then ask Wave A to wake up to five due rewrite jobs.
// Echo how many jobs we asked about, and each batch bag.
// An empty due list is still 200 with claimed 0.
// A held lease is inside a batch { claimed: false }, not HTTP lease_held.
// Only an unexpected throw is 500, and that 500 is a generic code.
// Do not preview a window in this file.
// Do not file a job.
// Do not cancel a job.
// Do not claim a lease.
// Do not stamp a Lead.
// Do not compare x-api-secret.
// Do not require Owner HMAC.

export default acceptThisPriorLeadCplRewriteDrainCronDesk()

function acceptThisPriorLeadCplRewriteDrainCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/cpl-corrections-drain",
    proveThisCronTickIsOurs,
    wakeUpToFiveDuePriorLeadRewriteJobsOverHttp,
  )
  return desk
}

// ── 1. Wake up to five due prior-Lead rewrite jobs ────────

async function wakeUpToFiveDuePriorLeadRewriteJobsOverHttp(_req, res) {
  try {
    await openMongoForThisTick()
    const results = await wakeDueRewriteJobs(theLivePriorLeadRewrite(), { limit: 5 })
    return theDrainAskedTheseJobs(res, results)
  } catch (error) {
    rememberTheCronTickThrew(error)
    return priorLeadRewriteDrainFailedWithAGenericCode(res)
  }
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) {
    return cronIsMisconfigured(res) // "CRON_SECRET is not configured"
  }
  if (bearerMatches(req, expected) || headerSecretMatches(req, expected)) {
    return next()
  }
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500 `"CRON_SECRET is not configured"`, not 401. A mismatch is 401. Open Mongo, ask `runDue` with live deps and `limit: 5`, and echo `{ claimed: results.length, results }`. Empty due is still 200 with `claimed: 0`. A held lease is a batch `{ claimed: false }`, not HTTP `lease_held`. An unexpected throw is 500 with `CPL_CORRECTION_DRAIN_FAILED` and does not echo `error.message`. Do not preview. Do not file. Do not cancel. Do not claim a lease. Do not stamp a Lead. Do not compare `x-api-secret`. Do not require Owner HMAC.*

That is the operation. `router.all("/api/cron/cpl-corrections-drain")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk has no mode or flag gate; Sheet Sync and rematch do.** Already-recommended Sheet Sync **200** `{ skipped: true }` and never **asks** drain unless `queued`. Already-recommended rematch **200** `{ skipped: true }` when the flag is `false`. This file always **asks** `connectMongo` then `runDue`. There is no `CPL_CORRECTION_DRAIN_ENABLED`. A host with no open jobs still opens Mongo and returns `{ claimed: 0, results: [] }`. Do not copy the Sheet Sync queued-only fence here so “every five-minute desk matches.” Do not add a kill-switch env in this rename so “disabled never opens Mongo” without a paired HTTP proof that a filed `pending` job still wakes.

2. **HTTP `claimed` is the array length, not leases won.** Wave A `CplCorrectionBatchResult.claimed` is “this worker took the 60s lease.” `findClaimable` already filtered to missing / expired leases, then `processCplCorrectionBatch` may still return `{ claimed: false }` on a race, a just-completed job, or a just-cancelled job — and that bag stays in `results`. This file still **200** `{ claimed: results.length }`. Do not sum `result.claimed` so “HTTP claimed means leases.” Do not drop `claimed: false` bags so “the cron only reports wins.” Do not map a false bag onto HTTP `{ skipped: true, reason: "lease_held" }` so “this desk matches Call Log.”

3. **Wave A default `limit` is 1; this tick asks 5.** `runDueCplCorrectionJobs` defaults to one claimable job. Leftover cron overrides `{ limit: 5 }`. Each claimed job rewrites one Form-then-Call batch of 50 (`DEFAULT_CPL_CORRECTION_BATCH_SIZE`) behind a 60s lease. Do not raise the cron limit to “all due jobs” so “one tick finishes the book.” Do not drop the override so “cron matches the default 1” without a paired proof that five oldest due jobs still wake. Do not move `limit: 5` into Wave A so “every caller drains five.”

4. **A held lease is not HTTP `lease_held`.** Overlapping live lease → Wave A `{ claimed: false, processed: 0 }`. Already-recommended Call Log maps `skipReason === "lease_held"` onto **200** `{ skipped: true, reason: "lease_held" }`. Already-recommended Sheet Sync wraps a held `sheet-sync:drain` as HTTP `skipped: false` plus `summary.skipped`. There is no global `cpl-correction:drain` seat — each job elects its own lease. Do not invent that global seat in this rename so “every cron elects one drain.” Do not copy Call Log `lease_held` onto this desk so “overlap looks like a skip.”

5. **Route 500 is a generic code, not `error.message`.** `connectMongo` / Wave A `findClaimable` / `claimForProcessing` / leftover `NOT_FOUND` after a vanished job can throw into this catch. Already-recommended Lead Messaging / Sheet Sync **500** may echo `error.message`. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Already-recommended rematch has no try/catch. This file matches Call Log silence plus a stable `CPL_CORRECTION_DRAIN_FAILED`. Do not echo `error.message` so “this desk matches Lead Messaging” without a paired HTTP proof that operators still do not see a Lead id / preview hash / RegistryError text on the cron body. Do not drop the catch so “this desk matches rematch unhandled Express.”

6. **Missing-secret copy is `"CRON_SECRET is not configured"`, not `"CRON_SECRET is not set"`.** Already-recommended Sheet Sync / Lead Messaging / rematch / RingCentral say `"is not set"`. Reporting 503s `"CRON_SECRET is not configured."` (period). Today’s harness only asserts status **500**. Do not “fix” the copy to `"is not set"` in this rename so “every cron matches” without a paired harness on **this** desk. Park the copy.

7. **This desk never writes a letter.** Wave A batch already persisted `cpl_correction.completed` / `cancelled` / `lease_lost` / `reviewed_target_missing` / `analytics_handoff_failed` / `lead_failed`. This file only logs `cpl_correction.cron.failed`. Do not **ask** `recordOperationalEvent` from this file so “one route owns every CPL letter.” Do not drop Wave A’s letters so “the cron log is enough.”

8. **`connectMongo` lives on this desk and on leftover Owner HTTP, not inside Wave A `runDue`.** Already-recommended Sheet Sync drain connects itself; that cron does not. Lead Messaging cron also connects before drain. Do not move `connectMongo` into `runDueCplCorrectionJobs` in this rename so “every caller matches Sheet Sync” without a paired Owner-preview + cron proof. Do not drop the connect so “runDue already opened it.”

9. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today’s harness mounts the live default and proves auth 500/401 only. Do not add `createCplCorrectionCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

10. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / Sheet Sync / Lead Messaging / Granot lifecycle use the same Bearer-or-header 500/401. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy. IDEAS already parked that extract.

11. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Today’s harness POSTs only. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

12. **This desk never previews, never files, never cancels, never claims a lease, and never stamps a Lead.** Leftover Owner preview **asks** leftover `listCplSchedule` then Wave A `previewCplCorrection` and strips leftover `reviewed_targets`. Leftover Owner create **asks** Wave A `createCplCorrection` and **202**. Leftover Owner cancel **asks** Wave A `cancelCplCorrectionJob`. Wave A `runDue` **asks** `findClaimable` then `processCplCorrectionBatch`. This file **asks** one export after Mongo. Do not **ask** `previewCplCorrection` from this file so “the safety net also refreshes the hash.” Do not merge this router into leftover Owner `cpl-corrections*` so “one file owns every rewrite start.” Do not call `applyCorrectionToLead` from this file so “one hop owns the snapshot.”

13. **Owner HTTP uses `x-api-secret` + leftover Owner HMAC; this tick uses `CRON_SECRET`.** `app.ts` mounts **before** `v1Routes`. Do not remount `requireApiSecret` so “it matches Owner preview.” Do not hide this ALL behind leftover `requireRegistryOwnerActor` so “cron matches leftover admin.” Do not accept Owner HMAC so “someone must be an Owner.”

14. **There is no queue consumer.** Sheet Sync / Lead Messaging / Granot lifecycle publish a wake-up and have `api/queues/*-consumer.ts`. CPL corrections have neither. Mongo `findClaimable` is the due list. Do not add `publishCplCorrectionWakeup` in this rename so “every drain uses `@vercel/queue`.” Do not treat `reason: "cron"` on those other unions as a missing publisher here.

15. **Live deps are created per tick with no overrides.** Leftover Owner preview may pass `previewSampleLimit`. This file **asks** `createDefaultCplCorrectionDependencies()` — Mongo job / lead / granularity stores, leftover live resolver, leftover Analytics handoff, leftover `withTransaction`. Do not pass `previewSampleLimit` so “cron matches Owner preview.” Do not replace `invalidateAnalytics` so “cron never tells Analytics” — Wave A complete still **asks** the default seam. Do not inject an in-memory store from this file so “the test can skip Mongo” without a paired live-default proof.

16. **Host tables and `hit-vantage-api` omit `/api/cron/cpl-corrections-drain` and list Owner `POST/GET /api/v1/admin/cpl-corrections*`.** That skill is `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

17. **Today’s harness never wakes `runDue` and never proves a 200.** Auth 500/401 status only — no body text, no `x-cron-secret`, no empty-due `{ claimed: 0 }`. `vercel.json` `*/5 * * * *` is the only cadence proof. Do not treat schedule-parse as HTTP drain. Keep handshake + empty-due counts at this **interface**. Lease / stale / Analytics / Form-duplicate-not-Call-zero stay on already-recommended Wave A tests unless a later factory inject exists with a live-default proof.

18. **Leave sibling modules alone.** `runDueCplCorrectionJobs` / `createDefaultCplCorrectionDependencies` are already the right **depth**. This file orchestrates the HTTP **adapter**.

19. **Do not treat show / file / cancel / rewrite-one-batch / leftover price-book writes / leftover new-Lead stamps / Owner HTTP / rematch / Sheet Sync drain / Lead Messaging drain / Call Log sweep / next notification digest as this story.** Next `notification-cron.routes.ts` is the daily owner digest. Do not teach this file `database_scope`. Do not rewrite Booked / Cancelled / historical collections from this file. Do not use `createdAt` as the Lead window. Do not raise the 250-Lead preview cap from this file. Do not rename persisted `correction` / job `status` / `cpl_correction.*` / `operations-registry-cpl-correction-v1`.

## Testing

The **interface** is the test surface: `priorLeadCplRewriteDrainCronDesk` (mounted on `app.ts` **after** Lead Messaging cron, **before** next notification cron as the default export) and the one HTTP operation above.

Today `cpl-correction-cron.routes.test.ts` names missing-secret **500** and Bearer-mismatch **401** through the live default (status only). Keep those proofs. Add the missing-secret copy, `x-cron-secret`, GET, and empty-due **200** at the same **interface** (do not invent a factory so the test can no longer see the live Wave A default):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not configured"`.
- Bearer mismatch **401** `"Unauthorized"`.
- Matching `x-cron-secret` **200**.
- `requireApiSecret` / Owner HMAC / leftover `requireRegistryOwnerActor` / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` are **not** accepted here.

**Wake due jobs — never claim a lease here**
- Empty due list **200** `{ ok: true, claimed: 0, results: [] }` — not `{ skipped: true }`. Prove the route still **asks** `runDue` (Mongo connect happens).
- Due jobs **200** `{ ok: true, claimed: results.length, results }` echoes Wave A batch bags (`job_id` / `claimed` / `processed` / `changed` / `no_op` / `failed` / `completed` / `cancelled`) and is PII-free (no phone / Lead id / preview hash / leftover `reviewed_targets` / Bearer / token). Prove lease / stale / Analytics on already-recommended Wave A tests unless a later factory inject exists.
- HTTP `claimed` is `results.length` even when a bag has `claimed: false`. Do not invent `{ reason: "lease_held" }` on this desk.
- Unexpected throw **500** `{ error: "CPL correction drain failed", code: "CPL_CORRECTION_DRAIN_FAILED" }` — does **not** echo `error.message`.
- This beat does **not** **ask** `previewCplCorrection` / `createCplCorrection` / `cancelCplCorrectionJob` / `recordOperationalEvent`.

**Cadence**
- `vercel.json` `/api/cron/cpl-corrections-drain` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(cplCorrectionCronRoutes)` after Lead Messaging cron, before next notification cron / Twilio desks / `v1Routes`.
- Leftover Owner `cpl-corrections*` stays mounted on already-recommended public v1. There is no dedicated queue consumer.

**Not this file**
- Show / file / cancel / rewrite-one-batch stay on already-recommended [operations-registry-cpl-corrections.md](operations-registry-cpl-corrections.md).
- Owner HTTP stays on already-recommended [routes-v1.md](routes-v1.md).
- Price-book writes stay on already-recommended [operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md).
- New-Lead stamps stay on already-recommended [leads-cpl-resolution.md](leads-cpl-resolution.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `openMongoForThisTick`, `theDrainAskedTheseJobs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `CplCorrectionCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, claimed: results.length, results })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the always-ask **seam**: do not copy Sheet Sync’s queued-only fence or rematch’s flag-off skip onto this desk.
- Breaking the HTTP-claimed-is-array-length **seam**: do not sum Wave A `result.claimed`, and do not map a false bag onto HTTP `lease_held`.
- Breaking the generic-500 **seam**: do not echo `error.message` so “this desk matches Lead Messaging.”
- Breaking the cron-secret **seam**: do not remount `requireApiSecret` or admit HMAC / leftover `requireRegistryOwnerActor` / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` here.
- Treating `runDueCplCorrectionJobs`, `processCplCorrectionBatch`, `previewCplCorrection`, `createCplCorrection`, `cancelCplCorrectionJob`, leftover `listCplSchedule`, leftover `resolveCpl`, leftover Owner HTTP, rematch, Sheet Sync drain, Lead Messaging drain, Call Log sweep, next notification digest, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / publish / route-level mode / queue **adapter** that has only one caller in this pass.
- Silently adding a kill-switch env, publishing a wake-up, remounting `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `cpl-corrections*`, raising the 250-Lead cap, rewriting Booked / Cancelled / historical collections, using `createdAt` as the Lead window, or renaming persisted `correction` / job `status` / `cpl_correction.*` / `operations-registry-cpl-correction-v1` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
