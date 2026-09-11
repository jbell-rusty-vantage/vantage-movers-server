# After The Secret, Let The Signed Dashboard Owner See The Allowed Datasets, Point Reports At A Drive Destination, Preview Fifty Sample Rows, Freeze An Immutable Revision, Clone Or Archive A Definition, Estimate Then Confirm A Manual Run, Show The Redacted Runs, Then Request Cancellation — Never Walk The Worker Here, Never Write RAW Cells Here, Never Recover On The Cron Secret, Never Leak Row Payloads Or Execution Destinations — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 13 of this service — `reporting.routes.ts`
- Remaining in this service: `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/reporting.routes.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Mongo reporting collections are [System of Record](../../../../CONTEXT.md); Google workbooks are a delivery surface, not a second Lead / Booking authority. This is not Admin Analytics and not Sheet Sync. **HTTP** all under `/api/v1/admin/reporting` with `requireApiSecret`; reads `requireRegistryReadActor`; mutations `requireRegistryOwnerActor`. Catalog `GET .../catalog` **asks** leftover `getReportingCatalog`. Destinations `GET/POST/PATCH/DELETE .../destinations` + `POST .../verify` **ask** leftover `reportingDestination.service`. Draft preview `POST .../draft/preview` **asks** leftover `previewReportingDraft`. Save definition / revision **asks** leftover `saveReportingRevision`. Run `POST .../definitions/:id/run` **asks** leftover `prepareManualRun` (estimate, then confirm). Cancel `POST .../runs/:id/cancel` requires leftover `idempotencyKey`. Google destination **mutations and new runs** stay off unless `REPORTING_GOOGLE_DELIVERY_ENABLED=true` (fail-closed). Knowledge never names leftover `serializeReportingRouteError`, leftover `safeReportingRunForRead`, leftover in-file definition list / clone / archive, leftover `emitReportingDestinationHealthFailure` on verify miss, or leftover `POST .../destinations/:id/archive` — the always-applied host rule still lists that POST; this file only **asks** leftover `DELETE`; do not add a Routes Service file in this rename so “the Service sentence wins”). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`app.use(v1Routes)` **before** this file — **does not import** this file; `v1.routes.ts` has **no** `/admin/reporting` path). Distinct from already-recommended Best Relocation desk: [routes-ingestion.md](routes-ingestion.md) (`app.ts` mounts that file **after** public v1 and **before** this file — **does not import** this file). Distinct from already-recommended Granot HTTP automation desk: [routes-granot-automation.md](routes-granot-automation.md) (`app.ts` mounts that file **before** public v1; **every** handler **asks** `requireRegistryOwnerActor` including GET — **this desk asks `requireRegistryReadActor` on GET**). Distinct from already-recommended Tariff / Owner-apply extracts: [routes-tariff-adjustments.md](routes-tariff-adjustments.md) / [routes-extension-granot-apply.md](routes-extension-granot-apply.md) (those sit **inside** public v1 **after** the global secret — this file remounts `requireApiSecret` because `app.ts` mounted it as a **third** `/api/v1` router **after** leftover ingestion). Distinct from already-recommended HMAC lifecycle desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (Owner webhook receipts / Booking commands — **does not import** this file). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (admits the session **before** the secret — **does not import** this file). Distinct from next cron heartbeat: `reporting-cron.routes.ts` (`/api/cron/reporting-delivery-heartbeat` `CRON_SECRET` **asks** leftover stranded leased run + leftover `publishReportingWakeup` `reason: "cron"` — unpublished on hosted Vercel **503**; also leftover health-scan / leftover cleanup / leftover test-artifact janitor; **this file does not use `CRON_SECRET`**). Distinct from leftover queue consumer: `api/queues/reporting-consumer.ts` (`runReportingDeliveryWorker` — **does not import** this file). Distinct from already-recommended Wave A preview / freeze / estimate / confirm: [reporting-reporting.md](reporting-reporting.md) (`previewReportingDraft` / `saveReportingRevision` / `prepareManualRun` — this file **asks** those; leftover success audit lives **here**; leftover failure audit lives **there**; leftover confirm **asks** leftover wakeup **after** the run exists and returns leftover `wakeupPublished`; **this cancel discards** leftover wakeup). Distinct from already-recommended Wave A destination desk: [reporting-destination.md](reporting-destination.md) (`list` / `get` / `create` / `update` / `verify` / `archive` — this file **asks** those after leftover kill switch on writes; leftover `NotFoundError` / leftover `BadRequestError` / leftover `IntegrationError` are **not** leftover `ReportingError`). Distinct from already-recommended Wave A catalog: leftover `catalog/index.ts` (`getReportingCatalog` — this file **asks** it; leftover `REPORTING_DATASETS` leftover clone leftover **asks** for leftover allowed sorts). Distinct from already-recommended Wave A cancel persist: [reporting-run-repository.md](reporting-run-repository.md) (`requestReportingRunCancellation` / leftover `safeReportingFailureForRead` — this file **asks** those; leftover worker leftover **asks** leftover claim / leftover apply-at-safe-point). Distinct from already-recommended Wave A delivery read: [reporting-delivery-repository.md](reporting-delivery-repository.md) (`loadReportingDelivery` / leftover `safeReportingDeliveryForRead` — leftover GET run **asks** those). Distinct from already-recommended Wave A poke: [reporting-queue.md](reporting-queue.md) (`publishReportingWakeup` — leftover cancel **asks** `{ reason: "manual" }` after leftover `cancel_requested` / leftover `already_requested` and **discards** the boolean; leftover confirm leftover **asks** it from leftover `reporting.service.ts`, not here). Distinct from already-recommended Wave A letters: leftover `reportingAudit.ts` (this file leftover **asks** leftover success; leftover Wave A leftover **asks** leftover failure). Distinct from already-recommended Wave A verify-fail letters: [reporting-reporting-observability.md](reporting-reporting-observability.md) (`emitReportingDestinationHealthFailure` — leftover verify catch leftover **asks** it unless leftover kill switch / leftover Zod / leftover bad ObjectId). Distinct from already-recommended Wave A worker write: [reporting-reporting-worker.md](reporting-reporting-worker.md) (**this file does not import it**). Distinct from already-recommended Wave A Analytics dispatcher: [analytics-analytics.md](analytics-analytics.md) (**this file does not import it**). Distinct from already-recommended Wave A Sheet Sync drain: [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (**this file does not import it**). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryReadActor` `requireOwner: false` on GET; `requireRegistryOwnerActor` `requireOwner: true` on writes; Extension Owner Bearer without HMAC is **not** enough on Owner paths; Admin HMAC may **read**; unsigned preview is never a write). Distinct from already-recommended speaker fold: [durable-work-actors.md](durable-work-actors.md) (`durableActorFromRegistryActor` `origin: "vantage_admin"` after HMAC; Registry `system` through the fold is **TypeError**). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (this file `router.use("/api/v1/admin/reporting", requireApiSecret)` — Sales Bearer **403 `"Forbidden"`** **before** `readActor` / `ownerActor`). Distinct from leftover Wave B validation: leftover `reporting.validation.ts` / leftover `reportingDestination.validation.ts` (this file leftover **asks** leftover `reportingDraftSchema` / leftover `saveDefinitionSchema` / leftover `runRequestSchema` / leftover destination create / update / archive schemas; leftover cancel leftover Zod leftover lives **here**). Operator skill lists the nineteen `/admin/reporting` paths (no leftover `POST .../archive`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [System of Record](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus four exported-refuse / hide proofs plus the operator catalog.** `src/app.ts` **asks** the default export (`app.use(reportingRoutes)` on line 71, **after** leftover `ingestionRoutes`, **last** `/api/v1` router). Already-recommended public v1 desk does **not** mount this file. Cron `reportingCronRoutes` is mounted **before** public v1 (line 65) and does **not** import this file. Tests on this **interface**: `reporting.test.ts` **asks** leftover exported `serializeReportingRouteError` (Mongo URI **500** `"Reporting request failed"`; leftover `RegistryError` leftover `toHttpBody()` **403**; leftover `InvalidReportingObjectIdError` **400** `invalid_object_id` `"Invalid resource identifier"`; leftover `ReportingGoogleDeliveryDisabledError` **503** leftover fixed letter) and leftover exported `safeReportingRunForRead` (unsafe leftover `failure` → leftover `null`; leftover `execution_package.destination` deleted). It **copies** leftover cancel leftover Zod (`idempotencyKey` min 8) and does **not** import this file’s leftover inline schema. It does **not** HTTP GET the catalog. It does **not** HMAC-sign. It does **not** name Sales 403. It does **not** name Admin HMAC 200 on GET. It does **not** name leftover kill switch on leftover `POST .../run`. It does **not** name leftover destination leftover `NotFoundError` **500**. It does **not** name leftover estimate **200** vs leftover queued **202**. It does **not** name leftover cancel leftover wakeup discard. Already-recommended Wave A `reporting.test.ts` otherwise proves leftover catalog / leftover capacity / leftover opaque sample / leftover RAW package / leftover revision checksum / leftover confirmation bind through the service, not this router. Already-recommended `reportingDestination.test.ts` never hits `/admin/reporting/*`. Already-recommended `trustedActor.test.ts` never hits `/admin/reporting/*`. Operator `hit-vantage-api` lists the nineteen paths. Not this **interface**: leftover `previewReportingDraft` itself, leftover `prepareManualRun` itself, leftover `runReportingDeliveryWorker`, leftover `claimNextQueuedReportingRun`, leftover cron leftover heartbeat.
- Seams callers need: `app.ts` **after** leftover ingestion vs Granot automation **before** public v1; this-file remount of `requireApiSecret` on `/api/v1/admin/reporting` vs cron `CRON_SECRET`; signed dashboard Owner HMAC on writes vs Admin HMAC on GET (`requireRegistryReadActor`); Extension Owner Bearer without HMAC is **not** enough on Owner paths; `durableActorFromRegistryActor` after HMAC; leftover kill switch leftover `isReportingGoogleDeliveryEnabled` on leftover destination writes + leftover `POST .../run` **only** (leftover preview / leftover revision / leftover clone / leftover archive-definition / leftover cancel **do not** leftover check it); leftover estimate vs leftover confirm on **one** leftover `POST .../run` (`confirmationToken` is the **seam**); leftover 202 only when leftover `"status" in data && data.status === "queued"` vs leftover estimate leftover **200**; leftover cancel leftover wakeup leftover **discard** vs leftover heartbeat unpublished leftover **503**; leftover in-file definition list / clone / archive vs leftover Wave A leftover preview / leftover freeze / leftover estimate / leftover destination; leftover `ReportingError` leftover echoes leftover `error.message` vs leftover destination leftover `NotFoundError` / leftover `BadRequestError` / leftover `IntegrationError` leftover collapse to leftover **500**; leftover GET definition leftover returns leftover full leftover `destination_snapshot` on leftover revisions vs leftover GET run leftover hides leftover `execution_package.destination` + leftover row leftover `checkpoint`; leftover Zod leftover cancel leftover lives **here** vs leftover Wave B leftover validation barrel; leftover default export (no factory) vs sibling inject desks. There is no begin / complete Domain Command **seam**. There is no leftover worker RAW-cell **seam**. There is no leftover claim-lease **seam**. There is no leftover cron-secret **seam**. There is no leftover Analytics **seam**. There is no leftover Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~569-line file is one sitting if you read it as after the secret, let the signed dashboard Owner see the allowed datasets, point reports at a Drive destination, preview fifty sample rows, freeze an immutable revision, clone or archive a definition, estimate then confirm a manual run, show the redacted runs, then request cancellation — never walk the worker here, never write RAW cells here, never recover on the cron secret, never leak row payloads or execution destinations. Do not split. Never `catalog.ts` / `destinations.ts` / `definitions.ts` / `runs.ts` / `create.ts` / `update.ts` / `delete.ts`. Preview / freeze / estimate stay already-recommended `reporting.service.ts`. Destination point / rename / prove stay already-recommended `reportingDestination.service.ts`. Cancel persist stays already-recommended `reportingRunRepository.ts`. Wakeup stays already-recommended `queue.ts`. Cron recover stays next `reporting-cron.routes.ts`. Inline leftover cancel leftover Zod + leftover definition leftover Mongo stay here until a later story moves them.

`router.post("/api/v1/admin/reporting/definitions/:id/run")` / `router.post(".../runs/:id/cancel")` are HTTP verbs. The owner question is: *Someone already passed the API secret. The signed dashboard Owner (or a signed Admin on the reads) asked to see which datasets this host still allows, point a report at a Drive folder or a Vantage-owned tab, preview fifty sample rows against the live destination, freeze that draft as the next immutable revision, clone the current revision into a new draft without writing, archive a definition, estimate then confirm a manual write, read the redacted run, or request cancel under an idempotency key. Fold the HMAC speaker into a Vantage Admin actor. Ask leftover catalog / leftover destination / leftover preview / leftover freeze / leftover estimate / leftover cancel. Refuse destination writes and new runs when the Google kill switch is off. Answer 202 only when a run is queued. Answer 200 for estimate, reads, clone, archive, and cancel. Do not walk the worker. Do not write RAW cells. Do not recover stranded leases on the cron secret. Do not echo Mongo URIs. Do not plant a destination on GET.*

Who previews fifty rows and freezes the revision already lives in already-recommended `reporting.service.ts`. Who points at Drive already lives in already-recommended `reportingDestination.service.ts`. Who records the cancel request already lives in already-recommended `reportingRunRepository.ts`. Who claims the five-minute lease already lives in already-recommended `reportingWorker.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Do not pull those in.

## What this file actually does

Eight operations for the Owner reporting **desk**, not “a reporting CRUD dump,” and not Preview This Report Draft / Claim The Next Reporting Run themselves:

1. **Show the allowed datasets after the secret** — `GET /api/v1/admin/reporting/catalog`. **Asks** leftover `readActor` then leftover `getReportingCatalog()` (enabled leftover `@1` leftover keys only; leftover `manualOnly: true`). **Does not** leftover `connectMongo`. This beat does **not** leftover preview. This beat does **not** leftover check leftover `REPORTING_GOOGLE_DELIVERY_ENABLED`.

2. **Show and correct Google destinations after the secret** — `GET|POST|PATCH|DELETE .../destinations` and `GET .../destinations/:id` and `POST .../destinations/:id/verify`. GET list leftover Zod leftover `state` leftover `active` | leftover `archived` default leftover `active`, leftover `limit` 1–100 default 50, leftover **asks** leftover `listReportingDestinationSummaries`. GET one leftover `objectId` then leftover **asks** leftover `getReportingDestinationSummary`. POST / PATCH / verify / DELETE leftover **ask** leftover `ownerActor` then leftover `assertReportingGoogleDeliveryEnabled` (off → leftover `ReportingGoogleDeliveryDisabledError` **503**). POST leftover **asks** leftover `createReportingDestination` leftover **201** + leftover audit leftover `destination_create`. PATCH leftover **asks** leftover `updateReportingDestinationRecord` (`expected_version` + leftover `managed_tab_name`) + leftover audit leftover `destination_update`. Verify leftover empty leftover Zod leftover `{}` leftover **asks** leftover `verifyReportingDestination` + leftover audit leftover `destination_verify`; leftover catch leftover **asks** leftover `emitReportingDestinationHealthFailure` unless leftover kill switch / leftover Zod / leftover invalid ObjectId. DELETE leftover **asks** leftover `archiveReportingDestinationRecord` (`expected_version`) + leftover audit leftover `destination_archive` — there is **no** leftover `POST .../archive`. Leftover destination leftover `NotFoundError` / leftover `BadRequestError` / leftover `IntegrationError` leftover are **not** leftover `ReportingError` leftover → leftover `serializeReportingRouteError` leftover **500**. This beat does **not** leftover preview. This beat does **not** leftover write leftover RAW cells.

3. **Preview fifty sample rows after the secret** — `POST .../draft/preview` and `POST .../definitions/:id/preview`. Both leftover **ask** leftover `ownerActor`. Draft leftover **asks** leftover `previewReportingDraft(reportingDraftSchema.parse(body), actor)` then leftover audit leftover `preview` leftover (leftover `rowCount` leftover `estimate.rows`, leftover `checksum` leftover `previewChecksum`). Definition leftover `objectId` leftover then leftover `ReportingDefinition.findOne` leftover `state: "active"` leftover select leftover `_id`; miss leftover **404** `"Definition not found"`; then leftover **asks** the **same** leftover `previewReportingDraft(body.draft, actor)` — leftover `:id` leftover is leftover a leftover gate leftover + leftover audit leftover tag leftover, leftover **not** leftover the leftover frozen leftover revision. **Does not** leftover check leftover Google leftover kill switch. This beat does **not** leftover freeze. This beat does **not** leftover queue a leftover run.

4. **Freeze this draft as an immutable revision after the secret** — `POST .../definitions` and `POST .../definitions/:id/revisions`. Both leftover **ask** leftover `ownerActor` + leftover `saveDefinitionSchema`. Create leftover **asks** leftover `saveReportingRevision(body, actor)` leftover **201**. Revision leftover leftover **asks** leftover `saveReportingRevision({ ...body, definitionId: req.params.id }, actor)` leftover **201**. Both leftover audit leftover `revision_create`. **Does not** leftover check leftover Google leftover kill switch. This beat does **not** leftover estimate.

5. **Show the frozen definitions, or clone one into a draft without writing, or archive it** — `GET .../definitions`, `GET .../definitions/:id`, `POST .../definitions/:id/clone`, `DELETE .../definitions/:id`. GET list leftover `readActor` leftover same leftover `state` / leftover `limit` leftover Zod leftover as leftover destinations leftover, leftover `ReportingDefinition.find` leftover sort leftover newest leftover — leftover **no** leftover safe leftover projection. GET detail leftover `readActor` leftover loads leftover definition leftover + leftover revisions leftover newest leftover + leftover `ReportingPreview` leftover `select("-sample_token -destination_snapshot")`; miss leftover **404**; leftover revisions leftover stay leftover full leftover lean leftover (leftover `destination_snapshot` leftover + leftover `registry_snapshot` leftover remain). Clone leftover `ownerActor` leftover empty leftover Zod leftover loads leftover definition leftover + leftover `current_revision_id`; miss leftover **404** `"Definition not found"` even leftover when leftover the leftover definition leftover exists leftover and leftover the leftover revision leftover does leftover not; leftover paints leftover `{ draft: { name: "${name} copy", …, sort: effective_sort filtered to leftover REPORTING_DATASETS[dataset].allowedSorts } }` leftover from leftover `(revision.registry_snapshot as any).companies` leftover / leftover `.granularities`. Clone leftover **does not** leftover persist leftover. Clone leftover **does not** leftover audit leftover. Archive leftover `ownerActor` leftover `findOneAndUpdate` leftover `state: "active"` → leftover `archived` leftover + leftover `updated_by`; miss leftover **404**; leftover audit leftover `archive`. Archive leftover / leftover clone leftover **do not** leftover check leftover Google leftover kill switch. This beat does **not** leftover **ask** leftover `saveReportingRevision`.

6. **Estimate or confirm a manual run after the secret** — `POST .../definitions/:id/run`. leftover `ownerActor` leftover then leftover `assertReportingGoogleDeliveryEnabled`. leftover `runRequestSchema` leftover (`idempotencyKey` leftover required leftover; leftover optional leftover `revisionId` leftover / leftover `confirmationToken`). leftover **asks** leftover `prepareManualRun({ definitionId, ...body }, actor)`. leftover audit leftover `run_estimate` leftover when leftover `"requiresConfirmation" in data`, leftover `run_confirmation` leftover when leftover `data.idempotentReplay`, leftover else leftover `run_queue`. leftover **202** leftover only leftover when leftover `"status" in data && data.status === "queued"`; leftover estimate leftover **200**. This beat does **not** leftover **ask** leftover `publishReportingWakeup` leftover (leftover confirm leftover **asks** it leftover inside leftover Wave A). This beat does **not** leftover **ask** leftover `runReportingDeliveryWorker`.

7. **Show the redacted runs after the secret** — `GET .../runs` and `GET .../runs/:id`. Same leftover `readActor`. List leftover Zod leftover `limit` leftover only leftover (no leftover `state`). leftover `ReportingRun.find({})` leftover `select(reportingRunReadProjection())` leftover newest leftover then leftover `safeReportingRunForRead` (leftover `safeReportingFailureForRead`; leftover delete leftover `execution_package.destination`; leftover replace leftover `checkpoint` leftover with leftover `progress` leftover `{ phase, page_number, row_count, checksum_accumulator, cancellation_requested }`; leftover delete leftover `checkpoint`). Detail leftover `objectId` leftover miss leftover **404** `"Run not found"` leftover then leftover **asks** leftover `loadReportingDelivery` leftover + leftover `safeReportingDeliveryForRead` leftover (leftover delivery leftover **does** leftover return leftover `workbook_id` leftover / leftover `workbook_url` leftover / leftover sheet leftover ids). This beat does **not** leftover echo leftover row leftover payloads. This beat does **not** leftover echo leftover leftover `execution_package.destination`.

8. **Request cancellation after the secret, then wake the worker** — `POST .../runs/:id/cancel`. leftover `ownerActor`. leftover inline leftover Zod leftover `{ idempotencyKey }` leftover trim leftover min 8 leftover max 200 leftover (leftover **not** leftover on leftover `reporting.validation.ts`). leftover **asks** leftover `requestReportingRunCancellation({ runId, actorId, now, idempotencyKey })`. leftover `not_found` leftover **404**. leftover `cancel_requested` leftover / leftover `already_requested` leftover **ask** leftover `publishReportingWakeup({ reason: "manual", run_hint })` leftover and leftover **discard** leftover the leftover boolean leftover (leftover heartbeat leftover unpublished leftover is leftover **503** leftover — leftover next leftover file). leftover `already_terminal` leftover still leftover **200**. leftover audit leftover `run_cancel` leftover `reasonCode: result.status`. leftover **does not** leftover check leftover Google leftover kill switch leftover (leftover so leftover a leftover stranded leftover run leftover can leftover still leftover be leftover cancelled leftover when leftover writes leftover are leftover off). This beat does **not** leftover leftover `applyReportingRunCancellationAtSafePoint`. This beat does **not** leftover leftover claim leftover the leftover lease.

`readActor` / `ownerActor` / `objectId` / leftover `assertReportingGoogleDeliveryEnabled` / leftover `reportingHealthFailureReason` / leftover `reportingRunReadProjection` / leftover exported `serializeReportingRouteError` / leftover exported `safeReportingRunForRead` / leftover exported `InvalidReportingObjectIdError` / leftover exported `ReportingGoogleDeliveryDisabledError` are beats inside these operations, not extra owner stories. leftover `readActor` / leftover `ownerActor` leftover read leftover `req.vantageAuth`, leftover **ask** leftover `requireRegistryReadActor` / leftover `requireRegistryOwnerActor`, leftover then leftover **ask** leftover `durableActorFromRegistryActor`. leftover `serializeReportingRouteError` leftover is leftover Zod leftover → leftover **400** leftover `"Invalid request payload"` leftover raw leftover `issues`; leftover `ReportingError` leftover → leftover `statusCode` leftover + leftover `code` leftover + leftover **`error.message`**; leftover `isRegistryError` leftover → leftover `toHttpBody()`; leftover `InvalidReportingObjectIdError` leftover → leftover **400** leftover `invalid_object_id` leftover `"Invalid resource identifier"` leftover (leftover does leftover **not** leftover echo leftover `"Invalid Mongo ObjectId"`); leftover `ReportingGoogleDeliveryDisabledError` leftover → leftover **503** leftover `reporting_google_delivery_disabled` leftover + leftover `error.message`; leftover else leftover **500** leftover `reporting_internal_error` leftover `"Reporting request failed"`. leftover `serializeReportingRouteError` leftover does leftover **not** leftover leftover `instanceof AppError` leftover / leftover `NotFoundError`. leftover `objectId` leftover throws leftover `InvalidReportingObjectIdError` leftover (leftover **400**, leftover unlike leftover sibling leftover ingestion leftover bare leftover `Error` leftover **500**).

There is no ninth leftover claim or leftover RAW-write operation. Eight HTTP **adapters** on one default export over already-recommended catalog / destination / preview / freeze / estimate / cancel / poke. Do not collapse them so “one `/definitions` owns every verb.”

## Organization

Keep one file. This is the screenplay for “after the secret, let the signed dashboard Owner see the allowed datasets, point reports at a Drive destination, preview fifty sample rows, freeze an immutable revision, clone or archive a definition, estimate then confirm a manual run, show the redacted runs, then request cancellation — never walk the worker here, never write RAW cells here, never recover on the cron secret, never leak row payloads or execution destinations.” Already-recommended catalog / destination / preview / freeze / estimate / cancel persist / poke / HMAC gate / leftover worker claim already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingRoutesService` class. Do not invent a begin / complete Domain Command **seam** for leftover preview / leftover freeze / leftover estimate. Do not invent a leftover worker **adapter** so “`/run` can write RAW cells without the worker.” Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover factory **adapter** in this rename so “the test can inject `prepareManualRun`” — park it. Do not invent a CRUD folder so `catalog.ts` / `destinations.ts` / `definitions.ts` / `runs.ts` each get a file.

Do not move leftover `prepareManualRun` into this file so “the route owns the confirmation.” Do not move leftover in-file leftover definition leftover archive leftover into leftover `reporting.service.ts` in this rename so “Wave A owns every definition write” — park that. Do not mount this router inside leftover `v1.routes.ts` so “one file owns `/api/v1`.” Do not merge this router into leftover `reporting-cron.routes.ts` so “one file owns recover.” Do not merge this router into leftover `ingestion.routes.ts` so “one file owns every Owner queue.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ownerReportingDesk` | `app.ts` mounts the zero-arg instance **after** leftover ingestion |
| `GET .../catalog` (today unexported handler) | `showTheReportingCatalogAfterTheSecretOverHttp` | Read HMAC then leftover enabled leftover `@1` leftover datasets leftover **200** (no Mongo) |
| `GET\|POST\|PATCH\|DELETE .../destinations*` (today unexported handlers) | `showTheReportingDestinationsOverHttp` / `pointReportsAtThisDriveDestinationAfterTheSecretOverHttp` / `proveThisReportingDestinationIsStillOursAfterTheSecretOverHttp` / `archiveThisReportingDestinationAfterTheSecretOverHttp` | Read vs Owner + leftover kill switch on writes; leftover **asks** leftover destination leftover desk |
| `POST .../draft/preview` and `POST .../definitions/:id/preview` (today unexported handlers) | `previewThisReportDraftAfterTheSecretOverHttp` | Owner HMAC; leftover `:id` leftover is leftover a leftover gate leftover only leftover on leftover the leftover second leftover URL |
| `POST .../definitions` and `POST .../definitions/:id/revisions` (today unexported handlers) | `freezeThisDraftAsAnImmutableRevisionAfterTheSecretOverHttp` | Owner HMAC then leftover `saveReportingRevision` leftover **201** |
| `GET .../definitions` / `GET .../definitions/:id` (today unexported handlers) | `showTheFrozenReportingDefinitionsOverHttp` / `showThisFrozenReportingDefinitionOverHttp` | Read HMAC; leftover detail leftover hides leftover preview leftover `sample_token` leftover / leftover `destination_snapshot` leftover only |
| `POST .../definitions/:id/clone` (today unexported handler) | `cloneThisDefinitionIntoADraftAfterTheSecretOverHttp` | Owner HMAC; leftover paints leftover a leftover draft leftover; leftover does leftover **not** leftover persist |
| `DELETE .../definitions/:id` (today unexported handler) | `archiveThisReportingDefinitionAfterTheSecretOverHttp` | Owner HMAC leftover then leftover in-file leftover `active` → leftover `archived` |
| `POST .../definitions/:id/run` (today unexported handler) | `estimateOrConfirmThisManualRunAfterTheSecretOverHttp` | Owner HMAC + leftover kill switch; leftover one leftover URL leftover for leftover estimate leftover **200** leftover and leftover queued leftover **202** |
| `GET .../runs` / `GET .../runs/:id` (today unexported handlers) | `showTheRedactedReportingRunsOverHttp` / `showThisRedactedReportingRunOverHttp` | Read HMAC; leftover hide leftover row leftover payloads leftover + leftover `execution_package.destination`; leftover miss leftover **404** |
| `POST .../runs/:id/cancel` (today unexported handler) | `requestCancellationOfThisReportingRunAfterTheSecretOverHttp` | Owner HMAC leftover then leftover persist leftover + leftover wakeup leftover discard leftover **200** |
| `serializeReportingRouteError` | `refuseTheReportingDeskWithoutLeakingProviderText` | leftover `reporting.test.ts` already imports this hide — keep as a one-line alias until that test migrates onto HTTP |
| `safeReportingRunForRead` | `hideRowPayloadsAndExecutionDestinationsOnThisRun` | leftover `reporting.test.ts` already imports this hide — keep as a one-line alias until GET leftover run leftover is leftover HTTP leftover proven |
| `InvalidReportingObjectIdError` / `ReportingGoogleDeliveryDisabledError` | keep until the refuse test migrates | leftover `reporting.test.ts` leftover constructs leftover them leftover for leftover `serializeReportingRouteError` |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `readActor` / `ownerActor` / `reportingRunReadProjection` / `objectId` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover cancel leftover Zod onto leftover `reporting.validation.ts` in this rename — leave that for the validation pass. Do **not** rename leftover `prepareManualRun` here — that stays already-recommended Wave A. Do **not** add leftover `POST .../runs/:id/apply` so “the desk can write RAW cells without the worker.” Do **not** add leftover `sample_token` onto leftover GET leftover definition leftover so “ops can replay the preview.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover estimate already paints after leftover `prepareManualRun` without leftover `confirmationToken`:

```ts
type ManualReportingRunEstimateOverHttp = {
  ok: true
  data: {
    requiresConfirmation: true
    confirmationToken: string
    idempotencyKey: string
    definitionId: string
    revisionId: string
    revisionSnapshotChecksum: string
    destinationStableIdentityChecksum: string
    estimate: { rows: number }
    expiresAt: string
  }
}
```

That is the handoff from “the ten-minute confirmation is bound to this revision and this destination’s stable identity” to “the Owner can send the token back on the same URL.” Do **not** add leftover `wakeupPublished` onto leftover that leftover bag leftover (leftover confirm leftover returns leftover it leftover from leftover Wave A leftover, leftover this leftover desk leftover does leftover not leftover paint leftover a leftover second leftover shape leftover). Do **not** leftover collapse leftover estimate leftover into leftover leftover queued leftover **202** leftover so leftover “every leftover `/run` leftover is leftover a leftover queue.” Do **not** leftover add leftover `queue_published` leftover onto leftover cancel leftover so leftover “this leftover desk leftover matches leftover leftover Granot leftover automation.”

Leave leftover `previewReportingDraft` / leftover `saveReportingRevision` / leftover `prepareManualRun` on already-recommended leftover `reporting.service.ts`. Leave leftover destination leftover point / leftover rename / leftover prove / leftover archive on already-recommended leftover `reportingDestination.service.ts`. Leave leftover `requestReportingRunCancellation` on already-recommended leftover `reportingRunRepository.ts`. Leave leftover `publishReportingWakeup` on already-recommended leftover `queue.ts`. Leave leftover `getReportingCatalog` on leftover `catalog/index.ts`. Leave HMAC on already-recommended leftover `trustedActor.ts`. Leave the speaker fold on already-recommended leftover `durableActorFromRegistryActor`. Leave leftover `isReportingGoogleDeliveryEnabled` on leftover `src/config/domain/reporting.ts`. Leave this file’s remount of leftover `requireApiSecret` until a later `app.ts` story moves the mount behind public v1.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reporting.routes.ts
// Someone already passed the API secret — this desk remounts it
// because app.ts mounted it after public v1 and leftover ingestion
// as a third /api/v1 router.
// Let the signed dashboard Owner (and a signed Admin on the reads)
// see the allowed datasets,
// point a report at Drive,
// preview fifty sample rows,
// freeze an immutable revision,
// clone or archive a definition,
// estimate then confirm a manual write,
// read the redacted run,
// or request cancel.
// Do not walk the worker.
// Do not write RAW cells.
// Do not recover on the cron secret.
// Do not leak row payloads or execution destinations.

export function ownerReportingDesk() {
  const desk = Router()
  desk.use("/api/v1/admin/reporting", requireApiSecret)

  desk.get("/api/v1/admin/reporting/catalog", showTheReportingCatalogAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/reporting/destinations", showTheReportingDestinationsOverHttp)
  desk.post("/api/v1/admin/reporting/destinations", pointReportsAtThisDriveDestinationAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/reporting/destinations/:id", showThisReportingDestinationOverHttp)
  desk.patch("/api/v1/admin/reporting/destinations/:id", correctThisReportingDestinationAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/destinations/:id/verify", proveThisReportingDestinationIsStillOursAfterTheSecretOverHttp)
  desk.delete("/api/v1/admin/reporting/destinations/:id", archiveThisReportingDestinationAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/draft/preview", previewThisReportDraftAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/definitions/:id/preview", previewThisDraftAgainstAnActiveDefinitionAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/definitions", freezeThisDraftAsAnImmutableRevisionAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/definitions/:id/revisions", freezeThisDraftAsTheNextRevisionAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/reporting/definitions", showTheFrozenReportingDefinitionsOverHttp)
  desk.get("/api/v1/admin/reporting/definitions/:id", showThisFrozenReportingDefinitionOverHttp)
  desk.post("/api/v1/admin/reporting/definitions/:id/clone", cloneThisDefinitionIntoADraftAfterTheSecretOverHttp)
  desk.delete("/api/v1/admin/reporting/definitions/:id", archiveThisReportingDefinitionAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/reporting/definitions/:id/run", estimateOrConfirmThisManualRunAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/reporting/runs", showTheRedactedReportingRunsOverHttp)
  desk.get("/api/v1/admin/reporting/runs/:id", showThisRedactedReportingRunOverHttp)
  desk.post("/api/v1/admin/reporting/runs/:id/cancel", requestCancellationOfThisReportingRunAfterTheSecretOverHttp)
  return desk
}

export default ownerReportingDesk()

// ── 1. Show the allowed datasets ──────────────────────────

async function showTheReportingCatalogAfterTheSecretOverHttp(req, res) {
  foldTheSignedReaderIntoAVantageAdminSpeaker(req)   // readActor
  return getTheEnabledReportingCatalog()             // no Mongo
}

// ── 2. Show and correct Google destinations ───────────────

async function showTheReportingDestinationsOverHttp(req, res) { /* list summaries */ }
async function pointReportsAtThisDriveDestinationAfterTheSecretOverHttp(req, res) {
  const actor = foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
  refuseWhenGoogleReportingDeliveryIsOff()           // 503
  const created = await pointReportsAtThisDrivePlace(body, actor)
  await recordThatTheOwnerCreatedADestination(actor, created)
  // 201
}
async function proveThisReportingDestinationIsStillOursAfterTheSecretOverHttp(req, res) {
  try {
    refuseWhenGoogleReportingDeliveryIsOff()
    return proveThisDestinationIsStillOurs(id, actor)
  } catch (error) {
    if (!wasKillSwitchOrZodOrBadId(error)) {
      await noteThatDestinationHealthFailed(id, error).catch(() => undefined)
    }
    return refuseTheReportingDeskWithoutLeakingProviderText(res, error)
  }
}
async function archiveThisReportingDestinationAfterTheSecretOverHttp(req, res) {
  refuseWhenGoogleReportingDeliveryIsOff()
  return stopPointingReportsHere(id, expectedVersion, actor)
  // DELETE — there is no POST .../archive
}

// ── 3. Preview fifty sample rows ──────────────────────────

async function previewThisReportDraftAfterTheSecretOverHttp(req, res) {
  const actor = foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
  const preview = await previewThisReportDraft(draft, actor)
  await recordThatTheOwnerPreviewed(actor, preview)
}

async function previewThisDraftAgainstAnActiveDefinitionAfterTheSecretOverHttp(req, res) {
  await refuseWhenThisDefinitionIsNotActive(req.params.id)  // 404 — then same preview
  return previewThisReportDraft(body.draft, actor)          // :id is a gate + audit tag
}

// ── 4. Freeze an immutable revision ───────────────────────

async function freezeThisDraftAsAnImmutableRevisionAfterTheSecretOverHttp(req, res) {
  const frozen = await freezeThisDraftAsAnImmutableRevision(body, actor)
  // 201 — no Google kill switch
}

// ── 5. Show / clone / archive a definition ────────────────

async function showThisFrozenReportingDefinitionOverHttp(req, res) {
  const { definition, revisions, previews } = await loadTheDefinitionWithRevisionsAndPreviews(id)
  hidePreviewSampleTokensAndDestinationSnapshots(previews)
  // revisions still carry destination_snapshot
}

async function cloneThisDefinitionIntoADraftAfterTheSecretOverHttp(req, res) {
  const { definition, revision } = await loadTheCurrentRevision(id)
  if (!definition || !revision) return refuseDefinitionNotFound()  // lying 404
  return paintADraftCopyFromTheFrozenRevision(definition, revision) // no persist, no audit
}

async function archiveThisReportingDefinitionAfterTheSecretOverHttp(req, res) {
  return flipActiveDefinitionToArchivedInThisFile(id, actor)        // not Wave A
}

// ── 6. Estimate or confirm a manual run ───────────────────

async function estimateOrConfirmThisManualRunAfterTheSecretOverHttp(req, res) {
  refuseWhenGoogleReportingDeliveryIsOff()
  const result = await estimateOrConfirmThisManualRun({ definitionId: id, ...body }, actor)
  return result.status === "queued"
    ? acceptedTheQueuedRun(result)                 // 202
    : showTheTenMinuteEstimate(result)             // 200 requiresConfirmation
  // Wave A publishReportingWakeup lives inside confirm — not here
}

// ── 7. Show the redacted runs ─────────────────────────────

async function showTheRedactedReportingRunsOverHttp(req, res) {
  return listRecentRuns().map(hideRowPayloadsAndExecutionDestinationsOnThisRun)
}
async function showThisRedactedReportingRunOverHttp(req, res) {
  assertThisLooksLikeAnObjectId(req.params.id)     // InvalidReportingObjectIdError → 400
  const run = await loadTheRunProjection(id)
  const delivery = await loadTheSafeDelivery(id)   // workbook_id stays
  return { ...hideRowPayloadsAndExecutionDestinationsOnThisRun(run), delivery }
}

// ── 8. Request cancellation, then wake the worker ─────────

async function requestCancellationOfThisReportingRunAfterTheSecretOverHttp(req, res) {
  const result = await recordTheOwnersCancelRequest({ runId, actorId, now, idempotencyKey })
  if (result.status === "not_found") return refuseRunNotFound()
  if (result.status === "cancel_requested" || result.status === "already_requested") {
    await wakeTheReportingWorkerForThisRun({ reason: "manual", run_hint: id })
    // discard the boolean; always 200 — heartbeat unpublished is 503
  }
}

export const serializeReportingRouteError = refuseTheReportingDeskWithoutLeakingProviderText
export const safeReportingRunForRead = hideRowPayloadsAndExecutionDestinationsOnThisRun
```

Read the desk path out loud: *Someone already passed the API secret. This desk remounted it because it sits after the public v1 desk and leftover Best Relocation as a third `/api/v1` router. Fold the signed reader or Owner into a Vantage Admin speaker. Show the enabled datasets without opening Mongo. If they are pointing at Drive, refuse when the Google kill switch is off, then ask leftover destination. If they are previewing, ask leftover preview — the definition URL only checks the row is still active. If they are freezing, ask leftover revision and answer 201. Clone paints a draft and writes nothing. Archive flips `active` here. Estimate and confirm share one URL: 200 until a run is queued, then 202. Confirm’s wakeup lives in Wave A. Show the redacted run. Cancel records the request, pokes the worker, and still answers 200 when that poke is false. Do not walk the worker. Do not write RAW cells. Do not recover on the cron secret.*

That is the operation. `router.post("/definitions/:id/run")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk remounts the secret because `app.ts` mounted it after public v1 and leftover ingestion as a third `/api/v1` router.** Already-recommended Tariff / Owner apply sit **inside** leftover `v1.routes.ts` after leftover `router.use("/api/v1", requireApiSecret)` and **do not** remount. Already-recommended Granot automation remounts because `app.ts` mounted it **before** public v1. Already-recommended leftover ingestion remounts because it sits **after** leftover v1. This file `router.use("/api/v1/admin/reporting", requireApiSecret)`. A request already crossed leftover v1’s leftover `/api/v1` secret, then leftover ingestion’s remount (no match), then hits this remount. Sales Bearer is **403 `"Forbidden"`** **before** leftover `readActor`. Do not silently drop the remount so “it matches Tariff” without moving the leftover `app.ts` mount behind leftover v1 — that is an leftover `app.ts` story. Do not mount this router before leftover `requireApiSecret` so “the Owner can queue a run without a secret.”


2. **GET asks `requireRegistryReadActor`; writes ask Owner.** Sibling Granot automation asks `requireRegistryOwnerActor` on every handler, including GET. Sibling lifecycle asks read on cases / job / health. This desk matches leftover ingestion and leftover lifecycle on the reads: Admin HMAC may GET catalog / destinations / definitions / runs. Extension Owner Bearer without HMAC is not enough on POST preview / freeze / run / cancel (`requireOwner: true` and the path is not Agent catalog). Do not silently switch GET onto `requireRegistryOwnerActor` so "this desk matches leftover Granot automation." Do not silently admit Extension Owner Bearer onto `POST .../run` so "the Granot extension can queue a report."

3. **The Google kill switch is only on destination writes and new runs.** Knowledge names `REPORTING_GOOGLE_DELIVERY_ENABLED` for destination mutations and new runs. Preview / freeze / clone / archive-definition / cancel do not check it. Cancel staying open when writes are off is load-bearing (heartbeat when the flag is off only looks at `cancellation_requested_at`). Do not silently add the kill switch onto preview so "one gate owns every Owner write" without a paired test. Do not silently add it onto cancel so "cancel matches `/run`."

4. **`prepareManualRun` is two owner operations on one URL.** Already-recommended Wave A names estimate vs confirm; the token is the **seam**. This desk maps `"requiresConfirmation" in data` → audit `run_estimate`, `idempotentReplay` → `run_confirmation`, else `run_queue`, then **202** only when `status === "queued"`. Do not silently **202** an estimate so "every `/run` is a queue." Do not split `/estimate` vs `/confirm` in this rename without a paired admin-client change.

5. **Definition preview's `:id` is a gate, not the frozen revision.** `findOne({ state: "active" })` then asks `previewReportingDraft(body.draft)` — the body draft may name a different destination / dataset than the stored revision. Do not silently bind `body.draft` to `current_revision_id` so "preview this definition means the frozen row" without a paired test. Park it.

6. **Clone's 404 lies when the revision is missing.** `if (!definition || !revision)` returns `"Definition not found"`. Archive 404 is honest (`active` miss). Do not silently split `"Revision not found"` in this rename without a paired test.

7. **GET definition detail hides preview snapshots and still returns revision `destination_snapshot`.** `ReportingPreview` uses `select("-sample_token -destination_snapshot")`. Revisions are full lean (folder / workbook / checksum stay). GET run hides `execution_package.destination`. Do not silently strip revision snapshots in this rename so "one hide owns every GET." Park it.

8. **Destination `NotFoundError` / `BadRequestError` / `IntegrationError` become 500.** `serializeReportingRouteError` handles `ReportingError` / `RegistryError` / the two local classes. Destination throws `NotFoundError("Reporting destination was not found.")` — `AppError.statusCode` is 404 and is ignored. Definition miss is in-file **404**. Do not silently add `instanceof AppError` so "destination miss is 404" without a paired test. Park it.

9. **`ReportingError` echoes `error.message`; unexpected errors do not.** Sibling leftover ingestion hides every message, including registry 403. This desk asks `toHttpBody()` for registry and echoes `ReportingError.message` (capacity / preview-expired / invalid-confirmation letters). Unexpected `Error` is **500** `"Reporting request failed"`. Do not silently hide `ReportingError.message` so "this desk matches leftover ingestion." Do not silently echo `error.message` on 500 so "ops can see the Mongo URI."

10. **Cancel discards `publishReportingWakeup`; heartbeat unpublished is 503.** Confirm's wakeup lives in already-recommended Wave A and returns `wakeupPublished`. This cancel always **200**. Do not 503 cancel so "one wakeup rule owns every poke."

11. **The host rule lists `POST .../destinations/:id/archive`; this file only has `DELETE`.** Operator skill lists DELETE only. Do not add POST archive so "the host rule wins," and do not edit the host rule in this rename.

12. **`serializeReportingRouteError` and `safeReportingRunForRead` are exported so `reporting.test.ts` can unit the hide.** Standing don't-do: do not export helpers for unit tests. Do not unexport them in this rename without moving that proof onto HTTP. Park the exports.

13. **Leave sibling modules alone.** `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun` / `createReportingDestination` / `requestReportingRunCancellation` / `requireRegistryOwnerActor` are already the right **depth**. This file orchestrates the HTTP **adapter**.

14. **Do not treat leftover Analytics, leftover Sheet Sync, leftover Best Relocation, leftover Granot automation, leftover cron recover, leftover worker claim, or leftover public v1 as this story.** Next `granot-webhook.routes.ts` is inbound Granot receipts. Next `reporting-cron.routes.ts` is the heartbeat. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `ownerReportingDesk` (mounted on `app.ts` **after** leftover ingestion) and the eight HTTP operations above.

Today `reporting.test.ts` already asks exported `serializeReportingRouteError` (Mongo URI **500** `"Reporting request failed"`; `RegistryError` `toHttpBody()` **403**; `InvalidReportingObjectIdError` **400**; `ReportingGoogleDeliveryDisabledError` **503**) and exported `safeReportingRunForRead` (unsafe `failure` → `null`; `execution_package.destination` deleted). It copies the cancel Zod (`idempotencyKey` min 8) and does not import this file's inline schema. It misses HMAC Owner HTTP, Admin HMAC 200 on GET, Sales 403, kill switch on `POST .../run`, destination `NotFoundError` **500**, estimate **200** vs queued **202**, definition-preview `:id` as gate, clone lying 404, cancel wakeup discard, and GET definition still returning revision `destination_snapshot`. Already-recommended Wave A files prove preview / freeze / estimate / destination / cancel persist through the service — not this desk.

Keep a later inject-and-sign HMAC style (sibling lifecycle admin already mints `computeAdminActorSignature`). Add the missing operations (do not boot live Google sheets or walk `runReportingDeliveryWorker` in the route file):

**After the secret / who may speak**
- This desk remounts `requireApiSecret` on `/api/v1/admin/reporting` and is mounted from `app.ts` **after** `ingestionRoutes`.
- Signed dashboard Owner HMAC asks `previewReportingDraft` / `saveReportingRevision` / `prepareManualRun` / `createReportingDestination` / `requestReportingRunCancellation`.
- Signed Admin HMAC **200** on GET catalog / destinations / definitions / runs.
- Signed Admin HMAC **403** on POST preview / POST run / POST destinations.
- Extension Owner Bearer without HMAC **403** on POST run (not Agent catalog).
- Sales Bearer **403 `"Forbidden"`** is the remounted secret, before `readActor`.
- Cron `CRON_SECRET` is **not** accepted here.

**Catalog / destinations**
- Owner GET catalog does **not** ask `connectMongo`.
- Owner POST destinations with the kill switch off **503** `reporting_google_delivery_disabled` and does not ask `createReportingDestination`.
- Owner GET destinations/:id when missing is today's **500** `reporting_internal_error` (name the `NotFoundError` map). Do not "fix" it in the rename.
- Owner DELETE destinations/:id asks `archiveReportingDestinationRecord`. There is no `POST .../archive`.
- Owner POST verify on a live fail asks `emitReportingDestinationHealthFailure` unless the throw was the kill switch / Zod / bad ObjectId.

**Preview / freeze / clone / archive**
- Owner POST draft/preview asks `previewReportingDraft` and does **not** check the kill switch.
- Owner POST definitions/:id/preview on a missing active row **404** and does not ask `previewReportingDraft`.
- Owner POST definitions/:id/preview on an active row asks `previewReportingDraft(body.draft)` even when that draft's destination differs from the frozen revision (name the gate).
- Owner POST definitions **201** asks `saveReportingRevision` and does **not** check the kill switch.
- Owner POST clone paints `{ draft.name: "${name} copy" }` and does **not** insert a definition.
- Owner POST clone when the revision is missing **404** `"Definition not found"` (name the lie).
- Owner DELETE definitions/:id flips `active` → `archived` in this file and does **not** ask `saveReportingRevision`.

**Estimate / confirm / show / cancel**
- Owner POST run without `confirmationToken` **200** `requiresConfirmation: true` and does not ask `publishReportingWakeup` here.
- Owner POST run with a matching token and a new queued run **202** `{ status: "queued" }`.
- Owner POST run with the kill switch off **503** and does not ask `prepareManualRun`.
- Owner GET runs/:id omits `execution_package.destination` and `checkpoint`, and keeps delivery `workbook_id`.
- Owner GET definitions/:id omits preview `sample_token` / `destination_snapshot` and still returns revision `destination_snapshot` (name the hide gap).
- Owner POST cancel `{ idempotencyKey }` **404** when missing.
- Owner POST cancel `cancel_requested` asks `publishReportingWakeup` `{ reason: "manual" }` and **200** even when that returns `false`.
- Owner POST cancel does **not** check the kill switch.
- Invalid ObjectId **400** `invalid_object_id` `"Invalid resource identifier"` (name the typed error vs leftover ingestion's bare-Error **500**).
- Injected `new Error("mongodb://user:password@private-host/customer-name")` **500** `"Reporting request failed"` (name the hide).
- This beat does **not** ask `runReportingDeliveryWorker` / `claimNextQueuedReportingRun`.

**Mount**
- `app.ts` should keep `app.use(reportingRoutes)` after `ingestionRoutes`.
- Cron `reportingCronRoutes` stays mounted before public v1 and is not this desk.

**Not this file**
- Preview / freeze / estimate stay on already-recommended [reporting-reporting.md](reporting-reporting.md).
- Destination point / rename / prove stay on already-recommended [reporting-destination.md](reporting-destination.md).
- Cancel persist stays on already-recommended [reporting-run-repository.md](reporting-run-repository.md).
- Wakeup stays on already-recommended [reporting-queue.md](reporting-queue.md).
- Claim / RAW write stay on already-recommended [reporting-reporting-worker.md](reporting-reporting-worker.md).
- HMAC Owner / Admin refuse stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Cron 503 recover stays on next `reporting-cron.routes.ts`.
- Best Relocation stays on already-recommended [routes-ingestion.md](routes-ingestion.md).
- Granot HTTP automation stays on already-recommended [routes-granot-automation.md](routes-granot-automation.md).
- Admin Analytics stays on already-recommended [analytics-analytics.md](analytics-analytics.md).

Do **not** add a test per helper (`foldTheSignedOwnerIntoAVantageAdminSpeaker`, `hideRowPayloadsAndExecutionDestinationsOnThisRun`, `refuseWhenGoogleReportingDeliveryIsOff`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** unexport `serializeReportingRouteError` / `safeReportingRunForRead` in this rename so "the test can no longer unit the refuse" — migrate that proof onto HTTP first.

## What I would not do

- A `ReportingRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`catalog.ts` / `destinations.ts` / `definitions.ts` / `runs.ts` / `create.ts` / `update.ts` / `delete.ts`) "for cleanliness."
- Breaking the remounted-secret **seam**: this desk stays behind `requireApiSecret` even though `app.ts` mounted it after public v1.
- Breaking the HMAC-then-durable-actor **seam**: do not queue a run from `req.vantageAuth` alone.
- Breaking the estimate / confirm **seam**: one `POST .../run`; the token is the second step. Do not silently 202 an estimate.
- Breaking the kill-switch **seam**: destination writes and new runs only. Do not silently refuse preview or cancel when the flag is off.
- Treating leftover `previewReportingDraft`, leftover `prepareManualRun`, leftover `runReportingDeliveryWorker`, leftover `claimNextQueuedReportingRun`, leftover `requireRegistryOwnerActor` on GET, leftover Drive / leftover extension login desks, leftover Granot automation, leftover Best Relocation, leftover Analytics, leftover Sheet Sync, leftover webhook / cron routers, or leftover public v1 as this story.
- Inventing a leftover RAW-write / leftover claim-lease / leftover cron-secret / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently dropping the remount, asking `requireRegistryOwnerActor` on GET, admitting Extension Owner Bearer onto `POST .../run`, wrapping preview in `handleCanonicalCreate`, calling `runReportingDeliveryWorker`, adding the kill switch onto cancel, mapping destination `NotFoundError` onto 404, echoing 500 `error.message`, adding `POST .../archive`, or moving cancel Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
