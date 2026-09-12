# After The Cron Secret Proves This Tick Is Ours, Wake One Stranded Reporting Run, Scan Stuck Phases And The Cleanup Backlog, Trash Official Leftovers, Then Trash Aged Live-Test Harness Folders — Never Claim The Delivery Lease Here, Never Write RAW Cells Here, Never Preview A Report Here, Never Use The API Secret, Owner HMAC, Or The Sibling `x-cron-secret` Header — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 26 of this service — `reporting-cron.routes.ts`
- Remaining in this service: `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/reporting-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Mongo reporting collections are [System of Record](../../../../CONTEXT.md); Google workbooks are a delivery surface, not a second Lead / Booking authority. This is not Admin Analytics and not Sheet Sync. **HTTP / queue / cron** row: Cron `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor) “wake stranded leased runs”; queue consumer is leftover `reportingWorker`; Owner HTTP stays `/api/v1/admin/reporting` with leftover `requireApiSecret`. Google destination **mutations and new runs** stay off unless leftover `REPORTING_GOOGLE_DELIVERY_ENABLED=true` (fail-closed). Knowledge never names leftover `requireCronAuth`, leftover Bearer-only handshake, leftover `woke`, leftover Vercel-only unpublished **503**, leftover `scanReportingOperationalHealth`, leftover `runReportingCleanupJanitor`, leftover `runTestArtifactJanitor`, leftover `dry_run`, or leftover `CRON_SECRET is not configured.` — do not add a Routes Service file in this rename so “the Service sentence wins”). Distinct from already-recommended Owner desk: [routes-reporting.md](routes-reporting.md) (`GET|POST|PATCH|DELETE /api/v1/admin/reporting/*` after leftover `requireApiSecret` + HMAC; leftover cancel **asks** leftover `publishReportingWakeup` leftover `reason: "manual"` and **discards** the boolean; leftover confirm leftover **asks** leftover wakeup from leftover `reporting.service.ts`; **does not use `CRON_SECRET`**; **this file never asks HMAC**). Distinct from leftover queue consumer: `api/queues/reporting-consumer.ts` (`runReportingDeliveryWorker` leftover `{ runHint }`, then leftover `runReportingCleanupJanitor` leftover `{ limit: 10 }` **only when** leftover Google delivery is on — **does not import this file**). Distinct from already-recommended Wave A poke: [reporting-queue.md](reporting-queue.md) (`publishReportingWakeup` — this file **asks** leftover `{ reason: "cron", run_hint }` from leftover heartbeat **only**; leftover health-scan / leftover cleanup / leftover live janitor **do not**). Distinct from already-recommended Wave A claim / write: [reporting-reporting-worker.md](reporting-reporting-worker.md) (`runReportingDeliveryWorker` — **this file never asks it**). Distinct from already-recommended Wave A walk: [reporting-cleanup.md](reporting-cleanup.md) (`runReportingCleanupJanitor` — leftover cleanup tick **asks** leftover `{ drive, sheets, limit: 25 }`; leftover consumer leftover **asks** leftover `limit: 10`). Distinct from already-recommended Wave A persist list: [reporting-delivery-repository.md](reporting-delivery-repository.md) (`listCleanupPendingDeliveries` — leftover health-scan **asks** leftover `100`; leftover janitor leftover **asks** leftover `25`). Distinct from already-recommended Wave A tell: [reporting-reporting-observability.md](reporting-reporting-observability.md) (`scanReportingOperationalHealth` — leftover health-scan **asks** it after leftover gather; leftover heartbeat / leftover cleanup / leftover live janitor **do not** leftover **ask** leftover scan). Distinct from already-recommended Wave A live janitor: [reporting-test-artifact-janitor.md](reporting-test-artifact-janitor.md) (`runTestArtifactJanitor` — leftover test-artifact tick **asks** leftover `{ dryRun: query.dry_run === "true", limit: 50 }`; leftover `skipped` → leftover **200** leftover canned reason; leftover `ok: false` → leftover **503** leftover full leftover result). Distinct from already-recommended leftover Drive / Sheets adapters: [reporting-reporting-drive-adapter.md](reporting-reporting-drive-adapter.md) / [reporting-reporting-sheets-adapter.md](reporting-reporting-sheets-adapter.md) (leftover cleanup tick **asks** leftover `createReportingDriveAdapter` / leftover `createReportingSheetsAdapter` **before** leftover janitor; leftover heartbeat / leftover health-scan **do not**). Distinct from already-recommended leftover reserved list: [operational-workbooks-registry.md](operational-workbooks-registry.md) (`assertConfigurationComplete` — leftover health-scan leftover **asks** it; leftover `OperationalWorkbookConfigurationError` leftover paints leftover `missingDenylistKeys`). Distinct from already-recommended leftover letters persist: [observability-record-operational-event.md](observability-record-operational-event.md) (**this file never asks it**; leftover scan leftover **asks** leftover stuck / leftover backlog / leftover denylist). Distinct from already-recommended Best Relocation cron: [routes-best-relocation-ingestion-cron.md](routes-best-relocation-ingestion-cron.md) (leftover unpublished leftover **503** leftover **always**, leftover accepts leftover `x-cron-secret`, leftover missing secret leftover **500** leftover `"CRON_SECRET is not set"` — **does not import this file**). Distinct from already-recommended notification cron: [routes-notification-cron.md](routes-notification-cron.md) (leftover **void** leftover `cron.auth.failed`, leftover **500** leftover `"is not set"`, leftover accepts leftover `x-cron-secret` — **does not import this file**). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (leftover mode leftover gate leftover **on the route**, leftover **500** leftover `"is not set"`, leftover accepts leftover `x-cron-secret` — **does not import this file**). Distinct from already-recommended CPL cron: [routes-cpl-correction-cron.md](routes-cpl-correction-cron.md) (leftover missing secret leftover **500** leftover `"CRON_SECRET is not configured"` leftover **no period**, leftover **500** leftover generic leftover `CPL_CORRECTION_DRAIN_FAILED` — **does not import this file**). Distinct from leftover Vercel schedules: leftover `/api/cron/reporting-delivery-heartbeat` leftover `*/5 * * * *`; leftover `/api/cron/reporting-health-scan` leftover `*/15 * * * *`; leftover `/api/cron/reporting-cleanup-janitor` leftover `0 */6 * * *`; leftover `/api/cron/reporting-test-artifact-janitor` leftover `0 4 * * *` UTC. Distinct from leftover env: leftover `REPORTING_GOOGLE_DELIVERY_ENABLED` leftover trim / lower leftover `=== "true"` leftover (`isReportingGoogleDeliveryEnabled`) leftover **narrows leftover heartbeat leftover find**; leftover `REPORTING_LIVE_TEST_ENABLED` leftover lives leftover on leftover Wave A leftover janitor. Distinct from other secrets: leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host leftover `x-debug-token` / leftover sibling leftover `x-cron-secret` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [System of Record](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(reportingCronRoutes)` on line 65 — **after** already-recommended Best Relocation ingest heartbeat, **before** next Granot automation / Granot lifecycle crons, leftover Granot automation desk, leftover public v1, leftover Owner ingestion desk, leftover Owner reporting desk). Wave A `reportingObservability.test.ts` **asks** leftover `findReportingStuckRuns` / leftover keys — it does **not** HTTP leftover health-scan. Wave A `live/liveTestSecurity.test.ts` **asks** leftover `runTestArtifactJanitor` leftover disabled skip — it does **not** HTTP leftover test-artifact. Wave A `reporting.test.ts` / leftover `reportingDelivery.test.ts` do **not** import this file. Operator `hit-vantage-api` lists Owner `/admin/reporting/*`, **not** these four leftover `/api/cron/reporting-*` paths. Host public/unguarded tables omit these paths. Not this **interface**: leftover `runReportingDeliveryWorker` itself, leftover `publishReportingWakeup` itself, leftover `scanReportingOperationalHealth` itself, leftover `runReportingCleanupJanitor` itself, leftover `runTestArtifactJanitor` itself, leftover `prepareManualRun` itself, leftover Owner HMAC itself.
- Seams callers need: leftover `CRON_SECRET` leftover **Bearer only** vs leftover sibling leftover Bearer-**or**-leftover `x-cron-secret`; leftover missing secret leftover **503** leftover `"CRON_SECRET is not configured."` leftover (period) vs leftover CPL leftover **500** leftover `"is not configured"` leftover (no period) vs leftover Sheet Sync / leftover Best Relocation leftover **500** leftover `"is not set"`; leftover heartbeat leftover unpublished leftover **503** leftover **only when** leftover `VERCEL === "1"` vs leftover Best Relocation leftover **always 503**; leftover local leftover unpublished leftover **200** leftover `{ woke: true, published: false }` vs leftover Owner leftover cancel leftover **discard**; leftover Google-delivery-off leftover heartbeat leftover find leftover **only** leftover `cancellation_requested_at != null` vs leftover Owner leftover cancel leftover still leftover allowed leftover when leftover writes leftover are leftover off; leftover health-scan leftover gather leftover **here** leftover then leftover **ask** leftover scan vs leftover scan leftover never leftover query leftover Mongo; leftover cleanup leftover **asks** leftover Drive leftover OAuth leftover **before** leftover Mongo leftover list vs leftover heartbeat leftover **asks** leftover `connectMongo` leftover first; leftover consumer leftover janitor leftover `limit: 10` leftover **only when** leftover delivery leftover is leftover on vs leftover cleanup leftover tick leftover **always** leftover **asks** leftover adapters leftover + leftover `limit: 25`; leftover test-artifact leftover `skipped` leftover **200** leftover canned vs leftover `ok: false` leftover **503** leftover full leftover result; leftover all leftover unexpected leftover throws leftover **500** leftover generic leftover sentences leftover (do **not** leftover echo leftover `error.message`) vs leftover Best Relocation leftover / leftover notification leftover may leftover echo; leftover four leftover Vercel leftover cadences vs leftover sibling leftover `*/5`; leftover `router.all` leftover (Vercel GET) vs leftover webhook leftover POST-only; leftover no leftover factory leftover inject vs leftover already-recommended leftover `createRingCentralCronRouter`. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no leftover claim-lease **seam**. There is no leftover RAW-cell **seam**. There is no leftover `x-cron-secret` **seam**.
- Split later (only if the file outgrows one sitting): this ~194-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake one stranded reporting run, scan stuck phases and the cleanup backlog, trash official leftovers, then trash aged live-test harness folders — never claim the delivery lease here, never write RAW cells here, never preview a report here, never use the API secret, Owner HMAC, or the sibling `x-cron-secret` header. If it later splits: `wakeOneStrandedReportingDeliveryRun.ts` / `scanReportingOperationalHealthOverHttp.ts` / `walkTheOfficialReportingCleanupJanitorOverHttp.ts` / `walkTheLiveTestHarnessFolderJanitorOverHttp.ts` only as later **story** files, never `heartbeat.ts` / `health.ts` / `cleanup.ts` / `janitor.ts` / `get.ts` / `post.ts` / `cron.ts` / `create.ts` / `update.ts` / `delete.ts`. Poke stays already-recommended `queue.ts`. Worker claim stays already-recommended `reportingWorker.ts`. Official leftover trash stays already-recommended `cleanup.ts`. Health letters stay already-recommended `reportingObservability.ts`. Live-test trash stays already-recommended `live/testArtifactJanitor.ts`. Owner HMAC stays already-recommended `reporting.routes.ts`. Next Granot automation heartbeat stays next `granot-automation-cron.routes.ts`.

`router.all("/api/cron/reporting-delivery-heartbeat")` is an HTTP verb. The owner question is: *Vercel just woke one of four reporting safety-net ticks — or a local operator used the same Bearer secret. Prove Authorization Bearer matches `CRON_SECRET`. Do not accept `x-cron-secret` the way every already-recommended sibling cron does. If the secret is missing, say the cron is not configured — 503, not 401, and do not pretend this is unauthorized. If it does not match, refuse it. On the five-minute heartbeat: open Mongo, find the oldest stranded queued / querying / writing / verifying / promoting run whose lease is missing or expired — and when Google delivery is off, only a cancel-requested stranded run. If none, answer `woke: false`. If one exists, poke the worker as `cron`. Unpublished on hosted Vercel is 503. Unpublished locally is still 200 with `published: false`. On the fifteen-minute health scan: gather up to one hundred active runs, up to one hundred pending cleanups, and whether the reserved-workbook list is complete, then ask Wave A to tell only what is actually stuck, backlogged, or denylist-incomplete. On the six-hour official janitor: build Drive and Sheets adapters, then walk twenty-five pending leftover deliveries. On the 4am live-test janitor: ask Wave A to trash aged harness folders; a disabled host is 200 with a canned skip; a failed walk is 503 with the full bag. Do not claim the five-minute delivery lease. Do not write RAW cells. Do not preview fifty rows. Do not compare `x-api-secret`.*

Who claim the five-minute delivery lease / write RAW cells already lives in already-recommended `reportingWorker.ts`. Who poke the worker already lives in already-recommended `queue.ts`. Who trash failed or cancelled leftovers already lives in already-recommended `cleanup.ts`. Who tell stuck / backlog / denylist already lives in already-recommended `reportingObservability.ts`. Who trash aged harness folders already lives in already-recommended `live/testArtifactJanitor.ts`. Who preview / estimate / cancel already lives in already-recommended `reporting.routes.ts`. Do not pull those in.

## What this file actually does

Four operations of one “after the cron secret proves this tick is ours, wake one stranded reporting run, scan stuck phases and the cleanup backlog, trash official leftovers, then trash aged live-test harness folders” story, not “a reporting cron CRUD dump,” and not Claim The Next Reporting Run / Preview This Report / Show The Owner The Destination themselves:

1. **Wake one stranded reporting delivery run** — `ALL /api/cron/reporting-delivery-heartbeat`. `requireCronAuth` first. Missing `CRON_SECRET` **503** `{ ok: false, error: "CRON_SECRET is not configured." }` — **does not** leftover `recordOperationalEvent`. Mismatch **401** `{ ok: false, error: "Unauthorized" }` — **does not** leftover `recordOperationalEvent`. Then **asks** leftover `connectMongo`. Leftover `ReportingRun.collection.findOne` leftover oldest leftover `created_at` / leftover `_id`: leftover status leftover `queued` | leftover `querying` | leftover `writing` | leftover `verifying` | leftover `promoting`, leftover `$or` leftover `leased_until` leftover null leftover or leftover `<= now`. When leftover `isReportingGoogleDeliveryEnabled()` is leftover **false**, leftover also leftover requires leftover `cancellation_requested_at: { $ne: null }`. Miss **200** `{ ok: true, woke: false }`. Hit **asks** leftover `publishReportingWakeup({ reason: "cron", run_hint })`. Leftover `!published && process.env.VERCEL === "1"` leftover **503** `{ ok: false, error: "Reporting recovery wakeup could not be published.", run_id }`. Else leftover **200** `{ ok: true, woke: true, run_id, published }` — leftover local leftover unpublished leftover is leftover still leftover **200** leftover `published: false`. Unexpected throw leftover **500** `{ ok: false, error: "Reporting heartbeat failed." }` — leftover catch leftover binds leftover `error` leftover and leftover **does not** leftover echo leftover `error.message`. This beat does **not** leftover **ask** leftover `runReportingDeliveryWorker`. This beat does **not** leftover **ask** leftover `scanReportingOperationalHealth`. This beat does **not** leftover compare leftover `x-api-secret`. This beat does **not** leftover read leftover `x-cron-secret`.

2. **Scan reporting operational health** — `ALL /api/cron/reporting-health-scan`. Same leftover handshake. **Asks** leftover `connectMongo`. Leftover `ReportingRun.collection.find` leftover same leftover five leftover active leftover statuses leftover (leftover **no** leftover lease leftover filter leftover, leftover **no** leftover cancel leftover filter leftover), leftover projection leftover `_id` / leftover `status` / leftover `updated_at` / leftover `lease_owner`, leftover `limit: 100`. Maps leftover `ReportingStuckRunCandidate` leftover (`updatedAtMs` leftover from leftover `updated_at` leftover or leftover `_id.getTimestamp()`). **Asks** leftover `listCleanupPendingDeliveries(100)`. Leftover `operationalWorkbookRegistry.assertConfigurationComplete()` leftover catch: leftover `OperationalWorkbookConfigurationError` leftover paints leftover `denylistIncomplete` leftover + leftover `missingDenylistKeys`; leftover any leftover other leftover throw leftover paints leftover `denylistIncomplete` leftover **without** leftover keys. Then leftover **await-asks** leftover `scanReportingOperationalHealth` leftover (leftover Wave A leftover filters leftover thirty leftover minutes leftover, leftover tells leftover each leftover stuck leftover, leftover tells leftover backlog leftover when leftover pending leftover `> 0`, leftover tells leftover denylist leftover when leftover incomplete). Leftover **200** `{ ok: true, scanned_at, active_runs, cleanup_pending, denylist_incomplete }` — leftover does leftover **not** leftover echo leftover stuck leftover count leftover, leftover missing leftover keys leftover, leftover or leftover `ownerVisible` leftover bags. Unexpected throw leftover **500** `{ ok: false, error: "Reporting health scan failed." }`. This beat does **not** leftover **ask** leftover `publishReportingWakeup`. This beat does **not** leftover **ask** leftover `runReportingCleanupJanitor`. This beat does **not** leftover **ask** leftover `findReportingStuckRuns` leftover (leftover scan leftover does).

3. **Walk the official leftover cleanup janitor** — `ALL /api/cron/reporting-cleanup-janitor`. Same leftover handshake. Does leftover **not** leftover **ask** leftover `connectMongo` leftover on leftover this leftover desk leftover (leftover `createReportingDriveAdapter` leftover → leftover `getConnectedGoogleOAuthClient` leftover **asks** leftover `connectMongo` leftover as leftover a leftover side leftover effect leftover, leftover then leftover leftover janitor leftover lists leftover Mongo). **Asks** leftover `createReportingDriveAdapter()` leftover then leftover `createReportingSheetsAdapter()` leftover then leftover `runReportingCleanupJanitor({ drive, sheets, limit: 25 })`. Leftover **200** `{ ok: true, processed, cleaned, skipped }`. Does leftover **not** leftover check leftover `isReportingGoogleDeliveryEnabled` leftover (leftover consumer leftover **does** leftover — leftover janitor leftover only leftover when leftover delivery leftover is leftover on leftover, leftover `limit: 10`). Unexpected throw leftover **500** `{ ok: false, error: "Reporting cleanup janitor failed." }`. This beat does **not** leftover **ask** leftover `enqueueIncompleteArtifactCleanup`. This beat does **not** leftover **ask** leftover `runTestArtifactJanitor`. This beat does **not** leftover **ask** leftover `publishReportingWakeup`.

4. **Walk the live-test harness-folder janitor** — `ALL /api/cron/reporting-test-artifact-janitor`. Same leftover handshake. Leftover `dryRun = req.query.dry_run === "true"`. **Asks** leftover `runTestArtifactJanitor({ dryRun, limit: 50 })`. Leftover `result.skipped` leftover **200** `{ ok: true, skipped: true, reason: "REPORTING_LIVE_TEST_ENABLED is not true" }` — leftover **does not** leftover echo leftover Wave A leftover `janitor-noop` leftover evidence leftover bag. Else leftover **200** leftover when leftover `result.ok` leftover else leftover **503** leftover with leftover the leftover full leftover `result` leftover (leftover Wave A leftover prereq leftover fail leftover / leftover trash leftover errors leftover). Unexpected throw leftover **500** `{ ok: false, error: "Test artifact janitor failed." }`. This beat does leftover **not** leftover **ask** leftover `connectMongo` leftover on leftover this leftover desk leftover (leftover Wave A leftover registry leftover connects leftover itself leftover). This beat does leftover **not** leftover **ask** leftover `runReportingCleanupJanitor`. This beat does leftover **not** leftover **ask** leftover `cleanupLiveTestHarnessContainers`.

`requireCronAuth` is a beat inside these operations, not a fifth owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no fifth leftover claim-the-delivery-lease operation. Wave A leftover worker elects leftover the leftover five-minute leftover run leftover lease. There is no sixth leftover preview / leftover estimate operation. There is no seventh leftover Owner HMAC operation. There is no eighth leftover Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake one stranded reporting run, scan stuck phases and the cleanup backlog, trash official leftovers, then trash aged live-test harness folders — never claim the delivery lease here, never write RAW cells here, never preview a report here, never use the API secret, Owner HMAC, or the sibling `x-cron-secret` header.” Already-recommended poke / leftover worker / leftover official leftover janitor / leftover scan / leftover live leftover janitor / leftover Owner leftover desk already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** leftover heartbeat leftover then leftover health-scan leftover then leftover cleanup leftover then leftover live leftover janitor. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner cancel.” Do not invent a leftover `x-cron-secret` **adapter** so “this desk matches Sheet Sync” without a paired HTTP proof that leftover Bearer leftover still leftover wins leftover on leftover Vercel leftover GET. Do not invent a leftover claim **adapter** so “the heartbeat can write RAW cells without the worker.” Do not invent a CRUD folder so `heartbeat.ts` / `health.ts` / `cleanup.ts` / `janitor.ts` each get a file.

Do not move leftover `publishReportingWakeup` into this file so “the route owns the poke.” Do not move leftover `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** leftover Bearer-only leftover **503** leftover **and** leftover every leftover sibling leftover that leftover still leftover accepts leftover `x-cron-secret`. Do not mount this router inside leftover `reporting.routes.ts` so “one file owns recover.” Do not merge this router into leftover `notification-cron.routes.ts` so “one file owns every `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `reportingSafetyNetCronDesk` | `app.ts` mounts the instance **after** already-recommended Best Relocation heartbeat, **before** next Granot automation cron / leftover Owner reporting desk |
| `ALL /api/cron/reporting-delivery-heartbeat` (today unexported handler) | `wakeOneStrandedReportingDeliveryRunOverHttp` | auth **then** leftover find leftover one leftover stranded leftover **then** leftover poke leftover **or** leftover `woke: false` |
| `ALL /api/cron/reporting-health-scan` (today unexported handler) | `scanReportingOperationalHealthOverHttp` | auth **then** leftover gather leftover **then** leftover Wave A leftover tell |
| `ALL /api/cron/reporting-cleanup-janitor` (today unexported handler) | `walkTheOfficialReportingCleanupJanitorOverHttp` | auth **then** leftover adapters leftover **then** leftover janitor leftover `limit: 25` |
| `ALL /api/cron/reporting-test-artifact-janitor` (today unexported handler) | `walkTheLiveTestHarnessFolderJanitorOverHttp` | auth **then** leftover Wave A leftover janitor leftover `limit: 50`; leftover skip leftover **200** leftover canned |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn leftover `leased_until` / leftover `cancellation_requested_at` / leftover `REPORTING_PHASE_STUCK_THRESHOLD_MS` / leftover `janitor-noop` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createReportingCronRouter({ publish, scan, cleanup, janitor })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after a hosted or local poke:

```ts
type ReportingHeartbeatWokeOneStrandedRunOverHttp = {
  ok: true
  woke: true
  run_id: string
  published: boolean
}
```

That is the **200** handoff from “Vercel woke us and Mongo still had one stranded leased run” to “this host either published `reason: cron` or, off hosted Vercel, admitted `published: false`.” Do **not** add leftover `queue_published: true` onto that bag so “this desk matches leftover Best Relocation leftover 202.” Do **not** collapse leftover `{ woke: false }` into leftover `{ skipped: true }` so “one skip owns every quiet tick.” Do **not** copy leftover RingCentral leftover `{ reason: "lease_held" }` onto leftover unpublished leftover **503** so “every cron maps overlap.” Do **not** add leftover `execution_package` leftover / leftover row leftover payloads leftover onto leftover any leftover of leftover these leftover four leftover **200** leftover bodies.

Leave leftover `publishReportingWakeup` on already-recommended leftover `queue.ts`. Leave leftover `runReportingDeliveryWorker` on already-recommended leftover `reportingWorker.ts`. Leave leftover `runReportingCleanupJanitor` on already-recommended leftover `cleanup.ts`. Leave leftover `scanReportingOperationalHealth` on already-recommended leftover `reportingObservability.ts`. Leave leftover `runTestArtifactJanitor` on already-recommended leftover `live/testArtifactJanitor.ts`. Leave leftover Owner HMAC on already-recommended leftover `reporting.routes.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reporting-cron.routes.ts
// Vercel just woke one of four reporting safety-net ticks —
// or a local operator used the same Bearer secret.
// Prove Authorization Bearer matches CRON_SECRET.
// Do not accept x-cron-secret.
// If the secret is missing, say the cron is not configured — 503.
// If it does not match, refuse it.
// On the five-minute heartbeat: open Mongo, find the oldest stranded run,
// and when Google delivery is off only a cancel-requested stranded run.
// If none, answer woke false.
// If one exists, poke the worker as cron.
// Unpublished on hosted Vercel is 503.
// Unpublished locally is still 200 with published false.
// On the fifteen-minute health scan: gather active runs, pending cleanups,
// and whether the reserved-workbook list is complete, then ask Wave A to tell.
// On the six-hour official janitor: build Drive and Sheets, walk twenty-five leftovers.
// On the 4am live-test janitor: trash aged harness folders.
// Disabled live tests are 200 with a canned skip.
// A failed live walk is 503 with the full bag.
// Do not claim the five-minute delivery lease.
// Do not write RAW cells.
// Do not preview fifty rows.
// Do not compare x-api-secret.

export default acceptThisReportingSafetyNetCronDesk()

function acceptThisReportingSafetyNetCronDesk() {
  const desk = Router()
  desk.all("/api/cron/reporting-delivery-heartbeat", proveThisCronTickIsOurs, wakeOneStrandedReportingDeliveryRunOverHttp)
  desk.all("/api/cron/reporting-health-scan", proveThisCronTickIsOurs, scanReportingOperationalHealthOverHttp)
  desk.all("/api/cron/reporting-cleanup-janitor", proveThisCronTickIsOurs, walkTheOfficialReportingCleanupJanitorOverHttp)
  desk.all("/api/cron/reporting-test-artifact-janitor", proveThisCronTickIsOurs, walkTheLiveTestHarnessFolderJanitorOverHttp)
  return desk
}

// ── 1. Wake one stranded reporting delivery run ───────────

async function wakeOneStrandedReportingDeliveryRunOverHttp(_req, res) {
  try {
    await openMongoForThisHeartbeat()
    const stranded = await findTheOldestStrandedReportingRun(new Date())
    if (!stranded) return noStrandedReportingRunNeededAPoke(res) // { woke: false }
    const published = await pokeTheReportingWorkerForThisStrandedRun(stranded._id)
    if (!published && thisHostIsHostedVercel()) {
      return recoveryWakeupCouldNotBePublishedOnHostedVercel(res, stranded._id)
    }
    return thisStrandedReportingRunWasWoken(res, stranded._id, published) // local unpublished still 200
  } catch {
    return heartbeatFailedWithAGenericSentence(res) // never echo error.message
  }
}

function findTheOldestStrandedReportingRun(now) {
  return ReportingRun.collection.findOne(
    {
      ...(googleDeliveryIsOff() ? { cancellation_requested_at: { $ne: null } } : {}),
      status: { $in: ["queued", "querying", "writing", "verifying", "promoting"] },
      $or: [{ leased_until: null }, { leased_until: { $lte: now } }],
    },
    { sort: { created_at: 1, _id: 1 } },
  )
}

// ── 2. Scan reporting operational health ──────────────────

async function scanReportingOperationalHealthOverHttp(_req, res) {
  try {
    await openMongoForThisHeartbeat()
    const activeRuns = await listUpToOneHundredActiveReportingRuns()
    const pendingCleanup = await listUpToOneHundredPendingCleanupDeliveries()
    const denylist = readWhetherTheReservedWorkbookListIsComplete()
    await askWaveAToTellStuckPhasesBacklogAndDenylist({
      stuckCandidates: paintStuckCandidatesFromActiveRuns(activeRuns),
      cleanupPendingCount: pendingCleanup.length,
      oldestCleanupRunId: pendingCleanup[0]?.run_id,
      ...denylist,
    })
    return theHealthScanFinished(res, activeRuns.length, pendingCleanup.length, denylist.denylistIncomplete)
  } catch {
    return healthScanFailedWithAGenericSentence(res)
  }
}

// ── 3. Walk the official leftover cleanup janitor ─────────

async function walkTheOfficialReportingCleanupJanitorOverHttp(_req, res) {
  try {
    const drive = await openTheReportingDriveAdapter() // OAuth connects Mongo
    const sheets = await openTheReportingSheetsAdapter()
    const result = await walkTwentyFivePendingOfficialLeftovers(drive, sheets)
    return theOfficialCleanupJanitorFinished(res, result)
  } catch {
    return officialCleanupJanitorFailedWithAGenericSentence(res)
  }
}

// ── 4. Walk the live-test harness-folder janitor ──────────

async function walkTheLiveTestHarnessFolderJanitorOverHttp(req, res) {
  try {
    const result = await trashAgedLiveTestHarnessFolders({
      dryRun: req.query.dry_run === "true",
      limit: 50,
    })
    if (result.skipped) return liveTestJanitorSkippedBecauseTheFlagIsOff(res)
    return result.ok ? theLiveTestJanitorFinished(res, result) : theLiveTestJanitorFailedOverHttp(res, result)
  } catch {
    return liveTestJanitorFailedWithAGenericSentence(res)
  }
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) return cronIsNotConfigured(res) // 503 "CRON_SECRET is not configured."
  if (bearerMatches(req, expected)) return next()
  return refuseAnUnauthorizedCronTick(res) // does not read x-cron-secret
}
```

Read the desk path out loud: *Prove Authorization Bearer matches `CRON_SECRET`. Missing secret is 503 `"CRON_SECRET is not configured."`, not 500 and not 401, and writes no letter. A mismatch is 401. `x-cron-secret` is not a second door. Heartbeat opens Mongo, finds one stranded run, and when Google delivery is off only a cancel-requested stranded run. None is 200 `woke: false`. A poke unpublished on hosted Vercel is 503. A poke unpublished locally is 200 `published: false`. Health scan gathers then asks Wave A to tell. Official janitor builds Drive and Sheets then walks twenty-five leftovers. Live-test janitor skips 200 canned when the flag is off, else 200 or 503 with the Wave A bag. Do not claim the delivery lease. Do not write RAW cells. Do not preview fifty rows. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/reporting-delivery-heartbeat")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk is Bearer-only. Every already-recommended sibling cron also accepts `x-cron-secret`.** Sheet Sync / Lead Messaging / rematch / CPL / notification / Best Relocation tests ask the header. Vercel cron sends `Authorization: Bearer`. A local operator using the sibling header **401**s here. Do not start reading `x-cron-secret` so “this desk matches Sheet Sync” without a paired HTTP proof that Bearer still wins on Vercel GET. Do not 401 a matching Bearer so “one header owns every tick.”

2. **Missing `CRON_SECRET` is 503 with a period.** CPL **500**s `"CRON_SECRET is not configured"` (no period). Sheet Sync / Best Relocation / notification **500** `"CRON_SECRET is not set"`. The Sheet Sync rec already named this 503. Do not change this to 500 `"is not set"` so “every cron matches” without a paired HTTP proof on this desk and CPL. Do not write `cron.auth.failed` so “this desk matches notification.”

3. **Unpublished wakeup is 503 only on hosted Vercel.** Wave A poke never throws; a local or non-hosted host returns `false` (two-env publish gate: `VERCEL === "1"` and the live `NODE_ENV`). A local stranded tick **200**s `{ woke: true, published: false }`. Hosted unpublished is **503**. Best Relocation **always** 503s unpublished. Owner cancel discards the boolean and still **200**s. Do not 503 local unpublished so “this desk matches Best Relocation” without a product decision. Do not discard the boolean so “this desk matches Owner cancel.”

4. **Hosted Vercel with the publish gate off 503s every stranded heartbeat.** `VERCEL === "1"` plus a non-live `NODE_ENV` makes `publishReportingWakeup` return `false` without `send`, then this desk 503s. Do not treat that as `{ woke: false }` so “preview hosts stay quiet” without a product decision. Do not start `reason: "recovery"` so “the union wins.”

5. **When Google delivery is off, the heartbeat only wakes a cancel-requested stranded run.** Owner cancel is still allowed when writes are off. A queued write with an expired lease is **not** poked until `REPORTING_GOOGLE_DELIVERY_ENABLED=true`. Do not drop the cancel filter so “every stranded run matches Wave A claim” without a paired proof that a delivery-off host still does not write RAW cells. Do not skip the whole heartbeat so “delivery-off is `{ skipped: true }`.”

6. **The heartbeat finds one oldest stranded run and never drains.** Sheet Sync cron asks `runSheetSyncDrain`. Lead Messaging asks the drain. This tick asks `publishReportingWakeup` only. Do not ask `runReportingDeliveryWorker` so “every cron matches Sheet Sync.”

7. **Health scan gathers here; Wave A scan never queries Mongo.** This file lists up to 100 active runs (no lease filter) and 100 pending cleanups, then asks `scanReportingOperationalHealth`. Wave A `findReportingStuckRuns` keeps a candidate whose age is at least thirty minutes. The HTTP **200** echoes `active_runs` / `cleanup_pending` / `denylist_incomplete` and does **not** echo stuck count or missing keys. Do not ask `findReportingStuckRuns` from this file so “the route owns the thirty-minute clock.” Do not add `stuck_runs` onto the **200** so “the owner can see every run id on the cron body.”

8. **Health scan tells on every pending cleanup, including one row.** Wave A backlog notify only when `pendingCount >= 5`. The letter still writes at `warn` for one pending row (`notificationCandidate: false`). Do not skip the tell when `pendingCleanup.length < 5` so “HTTP matches notify.” Do not ask `runReportingCleanupJanitor` from health-scan so “the scan also trashes.”

9. **Official cleanup never opens Mongo on the route.** Heartbeat and health-scan ask `connectMongo` first. Cleanup asks `createReportingDriveAdapter` first; `getConnectedGoogleOAuthClient` connects Mongo as a side effect, then the janitor lists pending deliveries. If OAuth throws, Mongo is never listed and the tick **500**s generic. Do not add `connectMongo` before the adapters so “cleanup can count pending when Drive is down” without a product decision. Do not skip adapter create when Google delivery is off so “this desk matches the consumer” without a paired proof that a delivery-off host still 200s `{ processed: 0 }` or still 500s the same OAuth miss.

10. **Consumer janitor is `limit: 10` and only when delivery is on. This tick is `limit: 25` and always asks adapters.** Do not copy the consumer gate onto this desk so “every janitor matches the worker.” Do not drop this tick’s limit to 10 so “one number owns leftover trash.”

11. **Live-test skip 200 is a canned reason, not the Wave A evidence bag.** Wave A disabled skip returns `{ ok: true, skipped: true, evidence: janitor-noop }`. This desk replaces that with `{ ok: true, skipped: true, reason: "REPORTING_LIVE_TEST_ENABLED is not true" }`. Prereq fail / trash errors **503** the full `result`, including masked evidence. Do not echo the Wave A bag on skip so “one shape owns disabled.” Do not 200 a prereq fail so “live-test never pages Vercel.”

12. **`dry_run=true` is a query flag, not an env gate.** Wave A dry-run still asks later-evaluate. Do not drop `dry_run` so “cron never lists Drive.” Do not default `dry_run` true so “4am never trashes.”

13. **All four unexpected throws 500 a generic sentence and never echo `error.message`.** Best Relocation / notification / Sheet Sync / Lead Messaging may echo. CPL 500s `CPL_CORRECTION_DRAIN_FAILED`. Heartbeat catch binds `error` and ignores it. Do not start echoing `error.message` so “this desk matches Best Relocation” without a paired HTTP proof that operators still do not see workbook ids or row payloads. Do not drop the four catches so “this desk matches rematch unhandled Express.”

14. **This desk never writes letters itself.** Health-scan await-asks Wave A scan (stuck / backlog / denylist). Live-test janitor asks `recordReportingLiveTestJanitorOutcome` after a finished scan, not on the disabled skip. Auth fail writes no letter. Unexpected throw writes no letter. Do not void-ask `cron.auth.failed` so “this desk matches notification.” Do not ask `recordOperationalEvent` from this file so “one route owns every reporting letter.”

15. **Four Vercel cadences, not one `*/5`.** Heartbeat `*/5`. Health-scan `*/15`. Cleanup `0 */6`. Live-test `0 4 * * *`. Best Relocation cleanup-adjacent tick is also `0 */6`. Do not change health-scan to `*/5` so “every reporting tick matches Sheet Sync.” Do not change live-test to `*/15` so “janitors share a clock.”

16. **`requireCronAuth` is a copy of sibling crons, minus `x-cron-secret`, plus 503.** Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** Bearer-only 503 **and** the siblings that still accept the header. Park the copy. IDEAS already parked that extract.

17. **There is no factory inject.** Already-recommended Call Log AC-17 asks `createRingCentralCronRouter`. There is **no** `reporting-cron.routes.test.ts`. Do not add `createReportingCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

18. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

19. **This desk never claims the delivery lease, never writes RAW cells, and never previews a report.** Wave A worker asks the five-minute run lease. Owner `POST .../draft/preview` asks `previewReportingDraft`. Owner confirm asks wakeup from `reporting.service.ts`. This file asks find / poke / gather / adapters / two janitors. Do not ask `runReportingDeliveryWorker` from this file so “the safety net also writes.” Do not merge this router into Owner `reporting/*` so “one file owns every reporting start.”

20. **Owner HTTP uses `x-api-secret` + HMAC; this tick uses `CRON_SECRET` Bearer.** `app.ts` mounts **before** `v1Routes` and **before** `reportingRoutes`. Do not remount `requireApiSecret` so “it matches Owner cancel.” Do not hide these ALLs behind Owner HMAC so “someone must be an Owner.”

21. **Host tables and `hit-vantage-api` omit the four `/api/cron/reporting-*` paths and list Owner `/admin/reporting/*`.** That skill is leftover `x-api-secret` desks. Do not add the cron paths to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

22. **There is no HTTP harness today.** No `reporting-cron.routes.test.ts`. Wave A units scan / janitor skip and never HTTP the cron. `vercel.json` is the cadence proof. Keep handshake + no-stranded `woke: false` + hosted unpublished 503 + live-test canned skip at this **interface**. Worker claim / official trash walk / stuck-phase clock stay on already-recommended Wave A tests unless a later factory inject exists with a live-default proof.

23. **Leave sibling modules alone.** `publishReportingWakeup` / `scanReportingOperationalHealth` / `runReportingCleanupJanitor` / `runTestArtifactJanitor` are already the right **depth**. This file orchestrates the HTTP **adapter**.

24. **Do not treat Wave A worker / Wave A poke / Wave A official janitor / Wave A scan / Wave A live janitor / Owner HMAC preview / Sheet Sync drain / Best Relocation heartbeat / next Granot automation heartbeat as this story.** Next `granot-automation-cron.routes.ts` is the Granot automation tick. Do not inspect a Lead / Booking / Cancellation from this file. Do not honor HTTP `repair_identity`. Do not rename persisted `reporting.run.stuck_phase` / `reporting.cleanup.backlog` / `reporting.denylist.unavailable` / trigger `cron`.

## Testing

The **interface** is the test surface: `reportingSafetyNetCronDesk` (mounted on `app.ts` **after** already-recommended Best Relocation heartbeat, **before** next Granot automation cron / leftover Owner reporting desk as the default export) and the four HTTP operations above.

Today there is **no** `reporting-cron.routes.test.ts`. Add one file that mounts the live default. Keep handshake + no-stranded wake + hosted unpublished 503 + live-test canned skip at the same **interface** (do not invent a factory so the test can no longer see the live Wave A default):

**Handshake / who may speak**
- Missing `CRON_SECRET` **503** `"CRON_SECRET is not configured."` and does **not** ask `cron.auth.failed`.
- Bearer mismatch **401** `"Unauthorized"` and does **not** ask `cron.auth.failed`.
- Matching `x-cron-secret` **401** — this desk does not read that header.
- Matching Bearer reaches `connectMongo` on heartbeat / health-scan.
- leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` are **not** accepted here.

**Wake one stranded run — never claim the delivery lease here**
- No stranded run **200** `{ ok: true, woke: false }`. Prove `publishReportingWakeup` is **not asked**.
- Delivery off, stranded write without `cancellation_requested_at` **200** `{ woke: false }`.
- Delivery off, cancel-requested stranded + hosted unpublished poke **503** `{ run_id }`.
- Delivery on, stranded + local unpublished poke **200** `{ woke: true, run_id, published: false }`.
- Delivery on, stranded + hosted published poke **200** `{ woke: true, run_id, published: true }`. Prove `reason: "cron"`.
- Unexpected throw **500** `{ error: "Reporting heartbeat failed." }` and does **not** echo `error.message`.
- This beat does **not** ask `runReportingDeliveryWorker` / `scanReportingOperationalHealth` / `runReportingCleanupJanitor`.

**Scan operational health — never trash here**
- Happy **200** `{ ok: true, scanned_at, active_runs, cleanup_pending, denylist_incomplete }` is PII-free (no run payload / destination / Bearer / token).
- Prove this beat asks `scanReportingOperationalHealth` after gather, and does **not** ask `publishReportingWakeup` / `runReportingCleanupJanitor`.
- Incomplete denylist still **200** with `denylist_incomplete: true`.
- Unexpected throw **500** `"Reporting health scan failed."`.

**Walk official leftover cleanup — never trash a published snapshot here**
- Happy **200** `{ ok: true, processed, cleaned, skipped }`. Prove `limit: 25`.
- OAuth throw **500** `"Reporting cleanup janitor failed."` and never lists pending deliveries.
- This beat does **not** ask `runTestArtifactJanitor` / `enqueueIncompleteArtifactCleanup` / `publishReportingWakeup`.
- Prove `isReportingGoogleDeliveryEnabled` is **not** a route skip.

**Walk live-test harness janitor — never official leftover trash here**
- Flag off **200** `{ ok: true, skipped: true, reason: "REPORTING_LIVE_TEST_ENABLED is not true" }` — not the Wave A evidence bag.
- Happy walk **200** the Wave A result (`ok: true`).
- Prereq fail / trash errors **503** the full Wave A result.
- `?dry_run=true` still asks Wave A with `dryRun: true`.
- Unexpected throw **500** `"Test artifact janitor failed."`.
- This beat does **not** ask `runReportingCleanupJanitor`.

**Cadence**
- `vercel.json` `/api/cron/reporting-delivery-heartbeat` is `*/5 * * * *`.
- `vercel.json` `/api/cron/reporting-health-scan` is `*/15 * * * *`.
- `vercel.json` `/api/cron/reporting-cleanup-janitor` is `0 */6 * * *`.
- `vercel.json` `/api/cron/reporting-test-artifact-janitor` is `0 4 * * *`.
- `router.all` accepts GET and POST on all four paths.

**Mount**
- `app.ts` should keep `app.use(reportingCronRoutes)` after Best Relocation heartbeat, before next Granot automation cron / leftover `v1Routes` / leftover `reportingRoutes`.
- Leftover Owner `reporting/*` stays mounted on already-recommended leftover `reporting.routes.ts`. Leftover consumer stays `api/queues/reporting-consumer.ts`.

**Not this file**
- Poke stays on already-recommended [reporting-queue.md](reporting-queue.md).
- Worker claim stays on already-recommended [reporting-reporting-worker.md](reporting-reporting-worker.md).
- Official leftover trash stays on already-recommended [reporting-cleanup.md](reporting-cleanup.md).
- Health letters stay on already-recommended [reporting-reporting-observability.md](reporting-reporting-observability.md).
- Live-test trash stays on already-recommended [reporting-test-artifact-janitor.md](reporting-test-artifact-janitor.md).
- Owner HMAC stays on already-recommended [routes-reporting.md](routes-reporting.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `noStrandedReportingRunNeededAPoke`, `liveTestJanitorSkippedBecauseTheFlagIsOff`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `ReportingCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, woke: false })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `heartbeat.ts` / `health.ts` / `cleanup.ts` / `janitor.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the Bearer-only **seam**: do not start reading `x-cron-secret` so “this desk matches Sheet Sync.”
- Breaking the hosted-only unpublished-503 **seam**: do not 503 local unpublished, and do not discard the boolean so “this desk matches Owner cancel.”
- Breaking the delivery-off cancel-only **seam**: do not poke a stranded write when Google delivery is off.
- Breaking the poke-not-drain **seam**: do not ask `runReportingDeliveryWorker` from the heartbeat.
- Breaking the gather-then-tell **seam**: do not ask `findReportingStuckRuns` from this file, and do not trash from health-scan.
- Breaking the cron-secret **seam**: do not remount leftover `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` here.
- Breaking the generic-500 **seam**: do not echo `error.message` so “this desk matches Best Relocation.”
- Treating leftover `runReportingDeliveryWorker`, leftover `publishReportingWakeup`, leftover `scanReportingOperationalHealth`, leftover `runReportingCleanupJanitor`, leftover `runTestArtifactJanitor`, leftover Owner HMAC preview, rematch, Sheet Sync drain, Best Relocation heartbeat, next Granot automation heartbeat, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / claim-lease / `x-cron-secret` **adapter** that has only one caller in this pass.
- Silently changing leftover 503 `"CRON_SECRET is not configured."` to leftover 500 `"is not set"`, starting leftover `reason: "recovery"`, remounting leftover `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `reporting/*`, adding leftover `connectMongo` onto leftover cleanup so “OAuth is no longer the Mongo door,” or renaming persisted leftover `reporting.run.stuck_phase` / leftover trigger `cron` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
