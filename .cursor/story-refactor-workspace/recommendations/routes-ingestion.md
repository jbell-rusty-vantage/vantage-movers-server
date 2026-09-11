# After The Secret, Let The Signed Dashboard Owner Show And Correct The Best Relocation Connection, Inspect The Sheets Without Writing Identity Cells, Queue A Preview Or Bootstrap Or Manual Run, Approve The Sealed Checksum, Show The Redacted Runs, Retry A Failed Immutable Plan, Then Disposition An Open Conflict — Never Claim The Apply Lease Here, Never Walk The Plan Here, Never Honor HTTP Repair, Never Recover On The Cron Secret, Never Leak Workbook Ids Or Command Payloads — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 12 of this service — `ingestion.routes.ts`
- Remaining in this service: `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/ingestion.routes.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (fenced Best Relocation inspect / preview / adopt / apply through canonical commands; Mongo domain documents are [System of Record](../../../../CONTEXT.md) and are written only through those commands; Best Relocation workbooks are the external evidence source; `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [Booking](../../../../CONTEXT.md) authority; **HTTP** `GET|PATCH /api/v1/admin/ingestion/connections/best-relocation` Read actor / Owner actor; `POST .../inspect` read-only, `repair_identity=true` is Owner-gated and still **409**; `POST .../preview` Owner `bootstrap` / `dry_run` / default `manual` → `createQueuedIngestionRun` + **202**; `POST .../run` Owner `{ run_id, plan_checksum }` while `awaiting_approval`; `POST .../runs/:runId/retry` Owner + env gate; `GET .../conflicts` + `POST .../conflicts/:id/resolve` attach delegates to a canonical command; `BEST_RELOCATION_INGEST_ENABLED` must be true before `application_enabled=true`, non-bootstrap apply, or retry; `application_enabled` also requires completed bootstrap; cadence 24 or 48 hours; route errors never expose provider or source details; this is not Sheet Sync and not Granot HTTP automation). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`app.use(v1Routes)` **before** this file — **does not import** this file; `v1.routes.ts` has **no** `/admin/ingestion` path). Distinct from already-recommended Granot HTTP automation desk: [routes-granot-automation.md](routes-granot-automation.md) (`app.ts` mounts that file **before** public v1; **every** handler **asks** `requireRegistryOwnerActor` including GET — **this desk asks `requireRegistryReadActor` on GET / non-repair inspect**). Distinct from already-recommended Tariff / Owner-apply extracts: [routes-tariff-adjustments.md](routes-tariff-adjustments.md) / [routes-extension-granot-apply.md](routes-extension-granot-apply.md) (those sit **inside** public v1 **after** the global secret — this file remounts `requireApiSecret` because `app.ts` mounted it as a **second** `/api/v1` router **after** that desk). Distinct from already-recommended HMAC lifecycle desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (Owner webhook receipts / Booking commands — **does not import** this file). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (admits the session **before** the secret — **does not import** this file). Distinct from next cron heartbeat: `best-relocation-ingestion-cron.routes.ts` (`/api/cron/best-relocation-ingest-heartbeat` `CRON_SECRET` **asks** `oldestRecoverableIngestionRun` / `claimDueBestRelocationConnection` / `createQueuedIngestionRun` `schedule` — unpublished recover / schedule **503**; **this file does not use `CRON_SECRET`**; **this file imports leftover `envGateEnabled` from that file**). Distinct from leftover queue consumer: `api/queues/best-relocation-ingestion-consumer.ts` (`runBestRelocationIngestionWorker` — **does not import** this file). Distinct from leftover CLI dry-run: `scripts/best-relocation-sheet-ingest.ts` (`pnpm ingest:best-relocation -- --dry-run`; live apply retired — **does not import** this file). Distinct from already-recommended Wave A claim / inspect / lock / apply: [ingestion-worker.md](ingestion-worker.md) (`runBestRelocationIngestionWorker` — **this file does not import it**). Distinct from already-recommended Wave A walk: [ingestion-apply-plan.md](ingestion-apply-plan.md) (`applyBestRelocationPlan` — **this file does not import it**). Distinct from already-recommended Wave A persist: [ingestion-repository.md](ingestion-repository.md) (`ensureBestRelocationConnection` / `createQueuedIngestionRun` — this file **asks** those on PATCH + preview; GET connection / approve CAS / retry clone / conflict list **do not**). Distinct from already-recommended Wave A poke: [ingestion-queue.md](ingestion-queue.md) (`publishIngestionWakeup` — preview / approve / retry **ask** it after the run row exists and **discard** the boolean; Owner HTTP always **202**). Distinct from already-recommended Wave A letters: [ingestion-health.md](ingestion-health.md) (**this file never asks** emit). Distinct from already-recommended Wave A inspect: [best-relocation-sheet-ingest-provider.md](best-relocation-sheet-ingest-provider.md) (`inspectBestRelocationSources` — this file **asks** it with `repairIdentity: false` after **409** on `repair_identity=true`). Distinct from already-recommended Wave A attach: [domain-commands-bookings.md](domain-commands-bookings.md) (`attachBookingToLead` — this file **asks** it on `attach_booking`; `createLeadlessBooking` / leftover apply-plan **do not** live here). Distinct from already-recommended employee Owner desk: [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md) (pending employee Job cases on leftover `v1.routes.ts` — **not** `IngestionConflict`). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryReadActor` `requireOwner: false` on GET / non-repair inspect; `requireRegistryOwnerActor` `requireOwner: true` on PATCH / preview / approve / retry / resolve / repair inspect; Extension Owner Bearer without HMAC is **not** enough on Owner paths; Admin HMAC may **read**; unsigned preview is never a write). Distinct from already-recommended speaker fold: [durable-work-actors.md](durable-work-actors.md) (`durableActorFromRegistryActor` `origin: "vantage_admin"` after HMAC; `createBestRelocationIngestionActor` `origin: "external_sheet_ingestion"` is the **system** speaker on queued / retry / attach; Registry `system` through the fold is **TypeError**). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (this file `router.use("/api/v1/admin/ingestion", requireApiSecret)` — Sales Bearer **403 `"Forbidden"`** **before** `readActor` / `ownerActor`). Operator skill lists the ten `/admin/ingestion` paths. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one service-folder source-scan plus one exported-refuse proof plus the operator catalog.** `src/app.ts` **asks** the default export (`app.use(ingestionRoutes)` on line 70, **after** `v1Routes`, **before** `reportingRoutes`). Already-recommended public v1 desk does **not** mount this file. Cron `bestRelocationIngestionCronRoutes` is mounted **before** public v1 (line 64) and does **not** import this file except the leftover `envGateEnabled` **this file imports from it**. Tests on this **interface**: `ingestion.test.ts` source-scans this file for `canonicalDomainCommands.attachBookingToLead` and refuses `BookedLead.updateOne` / `models/BookedLead`; then **asks** leftover exported `sendError` with a 500 that names a workbook / email / Mongo URI and locks `{ ok: false, code: "ingestion_internal_error", error: "Ingestion request failed" }`. It does **not** HTTP GET the connection. It does **not** HMAC-sign. It does **not** name Sales 403. It does **not** name Admin HMAC 200 on GET. It does **not** name `repair_identity` **409**. It does **not** name preview **202**. It does **not** name approve checksum miss. It does **not** name retry without `application_enabled`. It does **not** name bad ObjectId **500**. Already-recommended Wave A `ingestion.test.ts` otherwise proves worker / apply / persist / health / heartbeat skip through the service and leftover cron exports, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/ingestion/*`. Operator `hit-vantage-api` lists the ten paths. Not this **interface**: leftover `runBestRelocationIngestionWorker` itself, leftover `applyBestRelocationPlan`, leftover `claimDueBestRelocationConnection`, leftover `inspectBestRelocationSources` with `repairIdentity: true`, leftover CLI dry-run.
- Seams callers need: `app.ts` **after** public v1 vs Granot automation **before** public v1; this-file remount of `requireApiSecret` on `/api/v1/admin/ingestion` vs cron `CRON_SECRET`; signed dashboard Owner HMAC on writes vs Admin HMAC on GET / non-repair inspect (`requireRegistryReadActor`); Extension Owner Bearer without HMAC is **not** enough on Owner paths; `durableActorFromRegistryActor` after HMAC vs `createBestRelocationIngestionActor` as the system speaker; leftover `envGateEnabled` imported from the next cron file vs leftover worker `deploymentGateEnabled` copy; GET connection `findOne` (no plant) vs PATCH / preview `ensureBestRelocationConnection`; preview `createQueuedIngestionRun` + wakeup vs approve in-file CAS `awaiting_approval` → `applying` + wakeup vs retry in-file `IngestionRun.create` `applying` + wakeup; Owner HTTP **always 202** and **discards** `publishIngestionWakeup`; heartbeat unpublished is **503** (next file); `repair_identity=true` Owner-gated **409** vs leftover worker fenced repair; leftover Zod inline here vs leftover Wave B validation barrel (none for this desk); leftover `sendError` Zod **400** `"Invalid request payload"` raw `issues` vs any `statusCode` + sanitized `code` vs **never** `error.message` (**500** `"Ingestion request failed"` `ingestion_internal_error`; **4xx** `"Ingestion request was rejected"` `ingestion_request_rejected` unless the throw already carried a matching `code`); leftover `assertObjectId` throws a bare `Error` → **500**; leftover default export (no factory) vs sibling inject desks. There is no begin / complete Domain Command **seam** except leftover `attach_booking` **asking** leftover `attachBookingToLead`. There is no leftover apply-walk **seam**. There is no leftover claim-lease **seam**. There is no leftover cron-secret **seam**. There is no leftover Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~654-line file is one sitting if you read it as after the secret, let the signed dashboard Owner show and correct the Best Relocation connection, inspect the sheets without writing identity cells, queue a preview or bootstrap or manual run, approve the sealed checksum, show the redacted runs, retry a failed immutable plan, then disposition an open conflict — never claim the apply lease here, never walk the plan here, never honor HTTP repair, never recover on the cron secret, never leak workbook ids or command payloads. Do not split. Never `connection.ts` / `runs.ts` / `conflicts.ts` / `create.ts` / `update.ts` / `delete.ts`. Queue / plant stay already-recommended `repository.ts`. Wakeup stays already-recommended `queue.ts`. Inspect stays already-recommended `provider.ts`. Attach stays already-recommended `bookings.ts`. Claim / walk stay already-recommended `worker.ts` / `applyPlan.ts`. Cron recover stays next `best-relocation-ingestion-cron.routes.ts`. Inline Zod window stays here until the validation pass.

`router.post("/api/v1/admin/ingestion/connections/best-relocation/preview")` / `router.post(".../run")` are HTTP verbs. The owner question is: *Someone already passed the API secret. The signed dashboard Owner (or a signed Admin on the reads) asked to see the one Best Relocation connection, turn scheduling on only after bootstrap and the env gate, inspect the two workbooks without writing vantage ids, queue a mutation-free preview or a later-approved bootstrap / manual run, approve the exact plan checksum, read the redacted run, retry a failed locked plan, or dismiss / attach an open conflict. Fold the HMAC speaker into a Vantage Admin actor. Mint a Best Relocation system speaker when the run or the attach must speak as sheet ingestion. Ask leftover plant / leftover queue / leftover inspect / leftover attach. Wake the worker and always answer 202 even when this host did not publish. Answer 200 for reads. Do not claim the five-minute apply lease. Do not walk the plan. Do not write identity cells because the Owner typed repair. Do not recover stranded work on the cron secret. Do not echo Google / customer / Mongo strings. Do not plant the connection on GET.*

Who plants the one connection and inserts a queued run already lives in already-recommended `repository.ts`. Who inspects the six tabs already lives in already-recommended `provider.ts`. Who claims the apply lease already lives in already-recommended `worker.ts`. Who attaches a leadless Booking already lives in already-recommended `bookings.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Do not pull those in.

## What this file actually does

Seven operations for the Best Relocation ingestion **desk**, not “an ingestion CRUD dump,” and not Claim The Next Best Relocation Run / Apply The Locked Plan themselves:

1. **Show and correct the one Best Relocation connection after the secret** — `GET|PATCH /api/v1/admin/ingestion/connections/best-relocation`. GET **asks** `readActor` then leftover `connectMongo` then leftover `ExternalDataConnection.findOne({ key: "best_relocation" })` — **does not** **ask** leftover `ensureBestRelocationConnection`. Miss paints a synthetic `{ key, application_enabled: false, cadence_hours: 24, next_due_at: null, bootstrap_completed_at: null, health: {} }`. Always adds leftover `env_gate_enabled` (`envGateEnabled()` from the next cron file) and leftover `configured_sources` (`resolveWorkbookIds` + leftover `maskSpreadsheetId`; catch → both books `configured: false`). PATCH **asks** `ownerActor`. Inline Zod `application_enabled` optional boolean + `cadence_hours` 24 | 48, strict, at least one key. `application_enabled === true` + leftover env off → **409** `"BEST_RELOCATION_INGEST_ENABLED must be true before activation."` Then leftover `ensureBestRelocationConnection` and leftover `findOneAndUpdate`. Enable filter also requires leftover `bootstrap_completed_at: { $type: "date" }`; miss → **409** `"Bootstrap adoption must complete before scheduling is enabled."` Enable `$set`s leftover `next_due_at: new Date()` and leftover `application_enabled_actor`. Disable clears leftover `application_enabled_actor`. Cadence-only `$set`s leftover `next_due_at` to now + hours. Leftover `safeConnection` strips leftover `workbook_env_keys` / leftover `created_actor` / leftover `updated_actor`. This beat does **not** claim cadence. This beat does **not** queue a run.

2. **Inspect the two Best Relocation workbooks without writing identity cells** — `POST .../connections/best-relocation/inspect`. Inline Zod `repair_identity` default `false`. `true` **asks** `ownerActor` then **409** `"Identity repair is available only inside a fenced bootstrap/apply run."` `false` **asks** `readActor` then leftover `inspectBestRelocationSources({ repairIdentity: false })`. **Does not** leftover `connectMongo`. This beat does **not** window. This beat does **not** plan. This beat does **not** honor HTTP repair.

3. **Queue a preview, bootstrap, or manual run after the secret, then wake the worker** — `POST .../connections/best-relocation/preview`. `ownerActor`. Inline Zod optional `bootstrap` / `dry_run`. Trigger is leftover `bootstrap` if `bootstrap`, else leftover `preview` if `dry_run`, else leftover `manual` — **both flags true prefers bootstrap**. Leftover `ensureBestRelocationConnection`. System speaker leftover `createBestRelocationIngestionActor(requestId)`. **Ask** leftover `createQueuedIngestionRun` (`queued`, schema 2). **Ask** leftover `publishIngestionWakeup({ reason: "manual", run_hint })` and **discard** the boolean. Answer **202** `{ run_id, status: "queued", approval_required: trigger !== "preview", trigger }`. This beat does **not** inspect sheets. This beat does **not** inline leftover `runBestRelocationIngestionWorker`. This beat does **not** check leftover `queue_published`.

4. **Approve the sealed apply plan after the secret, then wake the worker** — `POST .../connections/best-relocation/run`. `ownerActor`. Inline Zod 24-hex `run_id` + 64-hex `plan_checksum`. Load leftover `IngestionRun` `awaiting_approval` + that checksum. Miss → **409** `"Run is not awaiting approval or checksum does not match."` Leftover trigger not leftover `bootstrap`: leftover env off → **409** before apply; leftover `ExternalDataConnection.exists` `application_enabled: true` miss → **409** `"Application ingestion must be enabled before apply."` Bootstrap skips both gates. Open leftover `IngestionConflict` `blocking` | `critical` count > 0 → **409** `"Blocking ingestion conflicts must be dispositioned first."` CAS leftover `findOneAndUpdate` same status + checksum + leftover `trigger` → leftover `applying` + leftover `approval` `{ approved_at, approved_by: actor, checksum }` + clear leftover `lease_owner` / leftover `leased_until`. Lost CAS → **409** `"Run approval lost a concurrent state or checksum change."` **Ask** leftover `publishIngestionWakeup({ reason: "manual", run_hint })` and **discard**. Answer **202** `{ run_id, status: "applying" }`. This beat does **not** **ask** leftover `applyBestRelocationPlan`. This beat does **not** **ask** leftover `lockRunPlan`. This beat lives **in this file**, not leftover `repository.ts`.

5. **Show the Owner (or signed Admin) the redacted runs** — `GET .../runs` and `GET .../runs/:runId`. Same `readActor`. List leftover `IngestionRun` `adapter_key: "best_relocation"`, hide leftover `plan_snapshot` and leftover source snapshot ids, sort newest, leftover `limit` `Number(query) || 50` clamped 1–100 (**no Zod**). Detail leftover `assertObjectId` then leftover `findById` hiding leftover source snapshot ids, leftover `SourceRowReceipt` hide leftover `workbook_id` / leftover `last_applied_source_values`, cap 500. Miss → **404** `"Run not found"`. Leftover `safeRunDetail` also drops leftover plan `command_payload` / leftover `source_owned_values` and leftover `redactProvenance` to leftover `workbook_title` / leftover `tab` / leftover `sheet_row`. This beat does **not** echo leftover spreadsheet ids. This beat does **not** echo leftover command payloads.

6. **Retry a failed immutable-plan run after the secret** — `POST .../runs/:runId/retry`. `ownerActor`. Leftover env off → **409** `"BEST_RELOCATION_INGEST_ENABLED must be true before retry."` **Does not** check leftover `application_enabled` (leftover worker later leftover skips leftover `DEPLOYMENT_GATE_DISABLED`). Source must be leftover `failed` | leftover `completed_with_errors` with leftover `plan_snapshot` and leftover `plan_checksum` string. Else **409** `"Only failed immutable-plan runs can be retried."` Leftover `IngestionRun.create` copies leftover snapshot / checksum / counters, leftover `trigger: "retry"`, leftover `status: "applying"`, leftover `approval.retry_of`, system speaker + HMAC initiator. **Ask** leftover `publishIngestionWakeup({ reason: "retry" })` and **discard**. Answer **202** `{ run_id, status: "applying" }`. This beat does **not** **ask** leftover `createQueuedIngestionRun` (that leftover `retry` path is leftover worker when there is **no** locked plan).

7. **Show open conflicts, then dismiss them or attach the leadless Booking to the named Lead** — `GET .../conflicts` and `POST .../conflicts/:conflictId/resolve`. GET `readActor`, leftover Zod `status` `open` | `resolved` | `dismissed` default `open`, sort leftover `severity` desc + oldest, cap 200. Resolve `ownerActor`. Discriminated leftover Zod `dismiss` + leftover `note` vs leftover `attach_booking` + leftover `booking_id` / leftover `lead_model` `FormLead` | `CallLead` / leftover `lead_id` / leftover `expected_revision`. Open leftover conflict miss → **404** `"Conflict not found"`. `attach_booking` leftover `computeChecksum` `{ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 2, payload }` then **asks** leftover `canonicalDomainCommands.attachBookingToLead` with leftover `command_id` leftover `sha256("resolve:" + id + checksum)`, leftover `idempotency_key` `resolve-conflict:${id}`, leftover `origin: "external_sheet_ingestion"`, leftover `source_connection_key: "best_relocation"`. Then leftover `$set` leftover `dismissed` | leftover `resolved` + leftover `resolution` + leftover `resolver_actor`. This beat does **not** `$set` leftover `BookedLead` here. This beat does **not** mint a Lead. This beat does **not** work leftover employee `booking-lead-reconciliations`.

`readActor` / `ownerActor` / `requestId` / `configuredSourceSummary` / `safeConnection` / `safeRunDetail` / `redactProvenance` / `assertObjectId` / `sha256` / leftover exported `sendError` are beats inside these operations, not extra owner stories. `readActor` / `ownerActor` read leftover `req.vantageAuth`, **ask** leftover `requireRegistryReadActor` / leftover `requireRegistryOwnerActor`, then **ask** leftover `durableActorFromRegistryActor`. Leftover `sendError` is leftover Zod → **400**; else leftover `statusCode` or **500**; leftover `code` only when `/^[a-z0-9_]{1,64}$/i`; **never** leftover `error.message`. Leftover `sendError` does **not** leftover `isRegistryError` / leftover `toHttpBody()`. Leftover `sendError` does **not** leftover `recordOperationalEvent`. They are private except leftover `sendError` is **exported** so leftover `ingestion.test.ts` can unit the hide.

There is no eighth leftover claim or leftover walk operation. Seven HTTP **adapters** on one default export over already-recommended plant / queue / inspect / poke / attach. Do not collapse them so “one `/runs` owns every verb.”

## Organization

Keep one file. This is the screenplay for “after the secret, let the signed dashboard Owner show and correct the Best Relocation connection, inspect the sheets without writing identity cells, queue a preview or bootstrap or manual run, approve the sealed checksum, show the redacted runs, retry a failed immutable plan, then disposition an open conflict — never claim the apply lease here, never walk the plan here, never honor HTTP repair, never recover on the cron secret, never leak workbook ids or command payloads.” Already-recommended plant / queue / inspect / poke / attach / HMAC gate / leftover worker claim already live in deeper **modules**. Do not pull those in. Do not invent an `IngestionRoutesService` class. Do not invent a begin / complete Domain Command **seam** for preview / approve / retry. Do not invent a leftover apply **adapter** so “`/run` can walk actions without the worker.” Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover factory **adapter** in this rename so “the test can inject `createQueuedIngestionRun`” — park it. Do not invent a CRUD folder so `connection.ts` / `runs.ts` / `conflicts.ts` each get a file.

Do not move leftover `createQueuedIngestionRun` into this file so “the route owns the run.” Do not move leftover approve CAS into leftover `repository.ts` in this rename so “persist owns the checksum” — park that. Do not mount this router inside leftover `v1.routes.ts` so “one file owns `/api/v1`.” Do not merge this router into leftover `best-relocation-ingestion-cron.routes.ts` so “one file owns recover.” Do not merge this router into leftover `granot-automation.routes.ts` so “one file owns every Owner queue.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ownerBestRelocationIngestionDesk` | `app.ts` mounts the zero-arg instance **after** public v1 |
| `GET .../connections/best-relocation` (today unexported handler) | `showTheBestRelocationConnectionAfterTheSecretOverHttp` | Read HMAC then `findOne` + env gate + masked books **200** (no plant) |
| `PATCH .../connections/best-relocation` (today unexported handler) | `correctTheBestRelocationConnectionAfterTheSecretOverHttp` | Owner HMAC then env / bootstrap gates then leftover `$set` **200** |
| `POST .../inspect` (today unexported handler) | `inspectTheBestRelocationSheetsWithoutWritingIdentityCellsOverHttp` | `repair_identity` **409**; else read HMAC + leftover inspect **200** |
| `POST .../preview` (today unexported handler) | `queueABestRelocationPreviewBootstrapOrManualRunAfterTheSecretOverHttp` | Owner HMAC then leftover queue + leftover wakeup **202** |
| `POST .../run` (today unexported handler) | `approveTheSealedBestRelocationPlanAfterTheSecretOverHttp` | Owner HMAC then checksum CAS + leftover wakeup **202** |
| `GET .../runs` / `GET .../runs/:runId` (today unexported handlers) | `showTheRedactedBestRelocationRunsOverHttp` / `showThisRedactedBestRelocationRunOverHttp` | Read HMAC; list hides leftover `plan_snapshot`; detail leftover redacts leftover payloads; miss **404** |
| `POST .../runs/:runId/retry` (today unexported handler) | `retryThisFailedImmutableBestRelocationPlanAfterTheSecretOverHttp` | Owner HMAC + leftover env gate then leftover clone `applying` + leftover wakeup **202** |
| `GET .../conflicts` / `POST .../conflicts/:id/resolve` (today unexported handlers) | `showTheBestRelocationConflictsOverHttp` / `dismissOrAttachThisOpenBestRelocationConflictAfterTheSecretOverHttp` | Read vs Owner; leftover attach **asks** leftover `attachBookingToLead` |
| `sendError` | `refuseTheBestRelocationIngestionDeskWithoutLeakingProviderText` | leftover `ingestion.test.ts` already imports this hide — keep as a one-line alias until that test migrates onto HTTP |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `readActor` / `ownerActor` / `safeRunDetail` / `assertObjectId` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover `createQueuedIngestionRun` here — that stays already-recommended Wave A. Do **not** add leftover `POST .../runs/:runId/apply` so “the desk can walk actions without the worker.” Do **not** add leftover `workbook_id` onto leftover GET run so “ops can open the sheet.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover preview already paints after leftover queue:

```ts
type BestRelocationIngestionRunQueuedOverHttp = {
  ok: true
  data: {
    run_id: string
    status: "queued"
    approval_required: boolean
    trigger: "bootstrap" | "preview" | "manual"
  }
}
```

That is the handoff from “the run document is queued” to “the Owner can wait for leftover `awaiting_approval` or leftover `completed`.” Do **not** add leftover `plan_checksum` onto that bag. Do **not** add leftover `queue_published` onto that bag so “this desk matches leftover Granot automation.” Do **not** collapse leftover `{ approval_required: false }` preview into leftover `manual` so “every queue needs a later `/run`.”

Leave leftover `ensureBestRelocationConnection` / leftover `createQueuedIngestionRun` on already-recommended leftover `repository.ts`. Leave leftover `publishIngestionWakeup` on already-recommended leftover `queue.ts`. Leave leftover `inspectBestRelocationSources` on already-recommended leftover `provider.ts`. Leave leftover `attachBookingToLead` on already-recommended leftover `bookings.ts`. Leave HMAC on already-recommended leftover `trustedActor.ts`. Leave the speaker fold on already-recommended leftover `durableActorFromRegistryActor`. Leave leftover `envGateEnabled` on next leftover `best-relocation-ingestion-cron.routes.ts`. Leave this file’s remount of leftover `requireApiSecret` until a later `app.ts` story moves the mount behind public v1.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ingestion.routes.ts
// Someone already passed the API secret — this desk remounts it
// because app.ts mounted it after public v1 as a second /api/v1 router.
// Let the signed dashboard Owner (and a signed Admin on the reads)
// keep the one Best Relocation connection,
// inspect the two workbooks without writing vantage ids,
// queue a preview or a later-approved run,
// approve the exact checksum,
// read the redacted run,
// retry a failed locked plan,
// or dismiss / attach an open conflict.
// Do not claim the five-minute apply lease.
// Do not walk the plan.
// Do not honor HTTP repair.
// Do not recover on the cron secret.
// Do not leak workbook ids or command payloads.

export function ownerBestRelocationIngestionDesk() {
  const desk = Router()
  desk.use("/api/v1/admin/ingestion", requireApiSecret)

  desk.get("/api/v1/admin/ingestion/connections/best-relocation", showTheBestRelocationConnectionAfterTheSecretOverHttp)
  desk.patch("/api/v1/admin/ingestion/connections/best-relocation", correctTheBestRelocationConnectionAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/ingestion/connections/best-relocation/inspect", inspectTheBestRelocationSheetsWithoutWritingIdentityCellsOverHttp)
  desk.post("/api/v1/admin/ingestion/connections/best-relocation/preview", queueABestRelocationPreviewBootstrapOrManualRunAfterTheSecretOverHttp)
  desk.post("/api/v1/admin/ingestion/connections/best-relocation/run", approveTheSealedBestRelocationPlanAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/ingestion/runs", showTheRedactedBestRelocationRunsOverHttp)
  desk.get("/api/v1/admin/ingestion/runs/:runId", showThisRedactedBestRelocationRunOverHttp)
  desk.post("/api/v1/admin/ingestion/runs/:runId/retry", retryThisFailedImmutableBestRelocationPlanAfterTheSecretOverHttp)
  desk.get("/api/v1/admin/ingestion/conflicts", showTheBestRelocationConflictsOverHttp)
  desk.post("/api/v1/admin/ingestion/conflicts/:conflictId/resolve", dismissOrAttachThisOpenBestRelocationConflictAfterTheSecretOverHttp)
  return desk
}

export default ownerBestRelocationIngestionDesk()

// ── 1. Show and correct the one Best Relocation connection ─

async function showTheBestRelocationConnectionAfterTheSecretOverHttp(req, res) {
  foldTheSignedReaderIntoAVantageAdminSpeaker(req)   // readActor
  // findOne — do not plant
  // paint the synthetic empty card when missing
  // add env_gate_enabled + masked configured_sources
}

async function correctTheBestRelocationConnectionAfterTheSecretOverHttp(req, res) {
  foldTheSignedOwnerIntoAVantageAdminSpeaker(req)    // ownerActor
  refuseEnableWhenTheEnvGateIsOff(parsed)
  await plantOrFindTheBestRelocationConnection(actor)
  refuseEnableWhenBootstrapHasNotCompleted(parsed)
  // $set cadence / enable / disable
  hideWorkbookEnvKeysAndActors(connection)
}

// ── 2. Inspect without writing identity cells ─────────────

async function inspectTheBestRelocationSheetsWithoutWritingIdentityCellsOverHttp(req, res) {
  if (body.repair_identity) {
    foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
    return refuseHttpIdentityRepair()                // 409 — park it
  }
  foldTheSignedReaderIntoAVantageAdminSpeaker(req)
  return inspectTheTwoBestRelocationWorkbooks({ repairIdentity: false })
}

// ── 3. Queue preview / bootstrap / manual ─────────────────

async function queueABestRelocationPreviewBootstrapOrManualRunAfterTheSecretOverHttp(req, res) {
  const initiator = foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
  const trigger = preferBootstrapThenDryRunThenManual(body)  // both-true prefers bootstrap
  await plantOrFindTheBestRelocationConnection(initiator)
  const system = mintTheBestRelocationSystemSpeaker(req)
  const queued = await queueABestRelocationIngestionRun({ trigger, actor: system, initiator })
  await wakeTheBestRelocationWorkerForThisRun({ reason: "manual", run_hint: queued.run_id })
  // discard the boolean; always 202
}

// ── 4. Approve the sealed checksum ────────────────────────

async function approveTheSealedBestRelocationPlanAfterTheSecretOverHttp(req, res) {
  const actor = foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
  const candidate = await loadTheAwaitingRunWithThisChecksum(parsed)
  refuseNonBootstrapApplyWhenTheGatesAreOff(candidate)
  refuseWhenBlockingConflictsAreStillOpen(parsed.run_id)
  const approved = await flipAwaitingApprovalToApplyingUnderTheChecksum(parsed, actor)
  await wakeTheBestRelocationWorkerForThisRun({ reason: "manual", run_hint: parsed.run_id })
  // 202 applying
}

// ── 5. Show the redacted runs ─────────────────────────────

async function showTheRedactedBestRelocationRunsOverHttp(req, res) { /* hide plan_snapshot */ }
async function showThisRedactedBestRelocationRunOverHttp(req, res) {
  assertThisLooksLikeAnObjectId(req.params.runId)   // bare Error → 500 today
  return { run: hideWorkbookIdsAndCommandPayloads(run), receipts }
}

// ── 6. Retry a failed immutable plan ──────────────────────

async function retryThisFailedImmutableBestRelocationPlanAfterTheSecretOverHttp(req, res) {
  refuseRetryWhenTheEnvGateIsOff()                  // does not check application_enabled
  const source = await loadTheFailedLockedPlan(req.params.runId)
  const retry = await cloneTheLockedPlanAsAnApplyingRetry(source)
  await wakeTheBestRelocationWorkerForThisRun({ reason: "retry", run_hint: retry.id })
}

// ── 7. Disposition an open conflict ───────────────────────

async function dismissOrAttachThisOpenBestRelocationConflictAfterTheSecretOverHttp(req, res) {
  const initiator = foldTheSignedOwnerIntoAVantageAdminSpeaker(req)
  if (parsed.disposition === "attach_booking") {
    await attachThisLeadlessBookingToTheNamedLead({
      ...parsed,
      context: sheetIngestionContextForThisConflict(conflict, initiator),
    })
  }
  await markTheConflictDismissedOrResolved(parsed, initiator)
}

export const sendError = refuseTheBestRelocationIngestionDeskWithoutLeakingProviderText
```

Read the desk path out loud: *Someone already passed the API secret. This desk remounted it because it sits after the public v1 desk as a second `/api/v1` router. Fold the signed reader or Owner into a Vantage Admin speaker. If they are looking at the connection, do not plant the row. If they are turning scheduling on, refuse when the env gate is off or bootstrap has not completed. If they typed repair, answer 409. If they are queueing a run, prefer bootstrap over dry-run over manual, persist queued, poke the worker, and always answer 202. If they are approving, match the checksum, skip the gates for bootstrap, refuse open blocking conflicts, flip applying, and poke again. Show the redacted run. Retry only a failed locked plan — do not add `application_enabled` here. Attach goes through leftover `attachBookingToLead`. Do not claim the apply lease. Do not walk the plan. Do not recover on the cron secret.*

That is the operation. `router.post("/preview")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk remounts the secret because `app.ts` mounted it after public v1 as a second `/api/v1` router.** Already-recommended Tariff / Owner apply sit **inside** leftover `v1.routes.ts` after leftover `router.use("/api/v1", requireApiSecret)` and **do not** remount. Already-recommended Granot automation remounts because `app.ts` mounted it **before** public v1. This file `router.use("/api/v1/admin/ingestion", requireApiSecret)`. A request already crossed leftover v1’s leftover `/api/v1` secret, then fell through to this router, then hits the remount. Sales Bearer is **403 `"Forbidden"`** **before** leftover `readActor`. Do not silently drop the remount so “it matches Tariff” without moving the leftover `app.ts` mount behind leftover v1 — that is an leftover `app.ts` story. Do not mount this router before leftover `requireApiSecret` so “the Owner can queue without a secret.”

2. **GET / non-repair inspect ask leftover `requireRegistryReadActor`; writes ask leftover Owner.** Sibling leftover Granot automation **asks** leftover `requireRegistryOwnerActor` on **every** handler, including GET. Sibling leftover lifecycle desk **asks** leftover read on cases / job / health. This desk matches leftover lifecycle on the reads: leftover Admin HMAC may leftover GET leftover connection / leftover runs / leftover conflicts and leftover POST leftover inspect when leftover `repair_identity` is false. Leftover Extension Owner Bearer without HMAC is **not** enough on leftover PATCH / leftover preview / leftover approve / leftover retry / leftover resolve (`requireOwner: true` and path is not Agent catalog). Do not silently switch leftover GET onto leftover `requireRegistryOwnerActor` so “this desk matches leftover Granot automation.” Do not silently admit leftover Extension Owner Bearer onto leftover `POST .../preview` so “the Granot extension can queue a Best Relocation run.”

3. **GET connection does not plant the row; PATCH / preview do.** Leftover `findOne` miss paints a leftover synthetic card. Leftover `ensureBestRelocationConnection` leftover upserts leftover `best_relocation` only on leftover PATCH leftover / leftover preview leftover / leftover heartbeat. Do not silently leftover **ask** leftover ensure on leftover GET so “the first dashboard load plants the connection” without a paired test.

4. **Approve CAS and retry clone live in this file, not leftover `repository.ts`.** Leftover preview leftover **asks** leftover `createQueuedIngestionRun`. Leftover approve leftover `$set`s leftover `applying` here. Leftover retry leftover `IngestionRun.create`s leftover `applying` here (leftover worker leftover `retry` without a locked plan leftover **asks** leftover `createQueuedIngestionRun` leftover `queued`). Do not silently move leftover approve leftover CAS into leftover `repository.ts` in this rename so “persist owns the checksum.” Park it.

5. **Retry checks leftover env and not leftover `application_enabled`.** Knowledge leftover names leftover `BEST_RELOCATION_INGEST_ENABLED` before leftover retry. Leftover worker leftover later leftover skips leftover `DEPLOYMENT_GATE_DISABLED` when leftover application is off. Leftover approve leftover **does** leftover check leftover `application_enabled` on leftover non-bootstrap. Do not silently add leftover `application_enabled` onto leftover retry so “retry matches approve” without a paired test.

6. **`repair_identity=true` is Owner-gated and still leftover 409.** CONTRADICTIONS already records leftover three leftover inspects leftover / leftover HTTP leftover repair leftover 409. Do not silently leftover **ask** leftover `inspectBestRelocationSources({ repairIdentity: true })` so “the Owner can fill empty Call cells from the desk.”

7. **`bootstrap` + `dry_run` both true prefers leftover bootstrap.** Leftover Zod leftover allows leftover both. Do not silently leftover refuse leftover both so “one trigger owns the body” without a paired test.

8. **Leftover `assertObjectId` leftover throws a leftover bare `Error` → leftover 500 `ingestion_internal_error`.** Leftover `"Invalid Mongo ObjectId"` leftover never leftover carries leftover `statusCode`. Do not silently leftover map leftover that leftover throw onto leftover **400** in this rename without a paired test. Park it.

9. **`sendError` hides every message, including registry 403.** Sibling Granot automation **asks** `toHttpBody()`. Sibling Tariff **500** echoes `error.message`. This desk's **4xx** is `"Ingestion request was rejected"` unless the throw already carried a matching `code`. Knowledge already says route errors never expose provider or source details — keep that hide for Google / customer / Mongo strings. Do not silently import `toHttpBody()` so "one refuse owns every Owner desk." Do not silently echo `error.message` so "ops can see the workbook id."

10. **`sendError` is exported so `ingestion.test.ts` can unit the hide.** Standing don't-do: do not export helpers for unit tests. Do not unexport it in this rename without moving that proof onto HTTP. Park the export.

11. **`envGateEnabled` lives on the next cron file.** This file imports it. The worker has its own `deploymentGateEnabled` copy. Do not move `envGateEnabled` into this file so "the desk owns the gate." Leave it for the cron pass.

12. **Owner HTTP always answers 202 and discards `publishIngestionWakeup`.** Heartbeat unpublished is **503**. Do not 503 preview so "one wakeup rule owns every poke."

13. **Leave sibling modules alone.** `createQueuedIngestionRun` / `inspectBestRelocationSources` / `attachBookingToLead` / `requireRegistryOwnerActor` are already the right **depth**. This file orchestrates the HTTP **adapter**.

14. **Do not treat Granot automation, employee recon, CLI dry-run, cron recover, worker claim, or public v1 as this story.** Next `reporting.routes.ts` is Owner reports. Next `best-relocation-ingestion-cron.routes.ts` is the heartbeat. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `ownerBestRelocationIngestionDesk` (mounted on `app.ts` **after** public v1) and the seven HTTP operations above.

Today `ingestion.test.ts` already names `canonicalDomainCommands.attachBookingToLead` and refuses `BookedLead` writes in this file, then **asks** exported `sendError` with a 500 that names a workbook / email / Mongo URI and locks `"Ingestion request failed"`. It misses HMAC Owner HTTP, Admin HMAC 200 on GET, Sales 403, `repair_identity` **409**, preview **202**, approve checksum miss, retry without `application_enabled`, bad ObjectId **500**, GET connection no-plant, and wakeup discard. Already-recommended Wave A files prove claim / apply / persist / inspect through the service — not this desk.

Keep a later inject-and-sign HMAC style (sibling lifecycle admin already mints `computeAdminActorSignature`). Add the missing operations (do not boot live Google sheets or walk `applyBestRelocationPlan` in the route file):

**After the secret / who may speak**
- This desk remounts `requireApiSecret` on `/api/v1/admin/ingestion` and is mounted from `app.ts` **after** `v1Routes`.
- Signed dashboard Owner HMAC **asks** `createQueuedIngestionRun` / `ensureBestRelocationConnection` / `attachBookingToLead`.
- Signed Admin HMAC **200** on GET connection / runs / conflicts and POST inspect (`repair_identity` false).
- Signed Admin HMAC **403** on POST preview / PATCH enable / POST run.
- Extension Owner Bearer without HMAC **403** on POST preview (not Agent catalog).
- Sales Bearer **403 `"Forbidden"`** is the remounted secret, before `readActor`.
- Cron `CRON_SECRET` is **not** accepted here.

**Connection / inspect**
- Owner GET when no row paints `application_enabled: false` and does **not** **ask** `ensureBestRelocationConnection`.
- Owner PATCH `application_enabled: true` with env off **409** and does not `$set`.
- Owner PATCH enable without `bootstrap_completed_at` **409**.
- Owner POST inspect `{ repair_identity: true }` **409** and does not **ask** `inspectBestRelocationSources` with `repairIdentity: true`.
- Admin POST inspect `{}` **asks** `inspectBestRelocationSources({ repairIdentity: false })`.

**Queue / approve / show / retry / conflict**
- Owner POST preview `{ dry_run: true }` **asks** `createQueuedIngestionRun` `trigger: "preview"` and **202** `approval_required: false`.
- Owner POST preview `{ bootstrap: true, dry_run: true }` **asks** `trigger: "bootstrap"` (both-true prefers bootstrap).
- Owner POST preview **asks** `publishIngestionWakeup` `{ reason: "manual" }` and **202** even when that returns `false`.
- Owner POST run with a mismatched checksum **409** and does not **ask** wakeup.
- Owner POST run bootstrap does **not** **ask** `envGateEnabled` / `application_enabled`.
- Owner GET `.../runs/:id` omits `command_payload` / `workbook_id`.
- Owner POST retry on a `completed` run **409**.
- Owner POST retry does **not** check `application_enabled`.
- Owner POST resolve `attach_booking` **asks** `canonicalDomainCommands.attachBookingToLead` and does **not** `$set` `BookedLead`.
- Invalid ObjectId **500** `ingestion_internal_error` (name the bare-Error map).
- Injected `new Error("Google workbook 1abc failed for customer@example.com")` **500** `"Ingestion request failed"` (name the hide).
- This beat does **not** **ask** `runBestRelocationIngestionWorker` / `applyBestRelocationPlan`.

**Mount**
- `app.ts` should keep `app.use(ingestionRoutes)` after `v1Routes` and before `reportingRoutes`.
- Cron `bestRelocationIngestionCronRoutes` stays mounted before public v1 and is not this desk.

**Not this file**
- Plant / queue stay on already-recommended [ingestion-repository.md](ingestion-repository.md).
- Wakeup stays on already-recommended [ingestion-queue.md](ingestion-queue.md).
- Inspect stays on already-recommended [best-relocation-sheet-ingest-provider.md](best-relocation-sheet-ingest-provider.md).
- Claim / walk stay on already-recommended [ingestion-worker.md](ingestion-worker.md) / [ingestion-apply-plan.md](ingestion-apply-plan.md).
- Attach stays on already-recommended [domain-commands-bookings.md](domain-commands-bookings.md).
- HMAC Owner / Admin refuse stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Cron 503 recover stays on next `best-relocation-ingestion-cron.routes.ts`.
- Granot HTTP automation stays on already-recommended [routes-granot-automation.md](routes-granot-automation.md).
- Employee Owner desk stays on already-recommended [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md).

Do **not** add a test per helper (`foldTheSignedOwnerIntoAVantageAdminSpeaker`, `hideWorkbookIdsAndCommandPayloads`, `refuseHttpIdentityRepair`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** unexport `sendError` in this rename so "the test can no longer unit the refuse" — migrate that proof onto HTTP first.

## What I would not do

- An `IngestionRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`connection.ts` / `runs.ts` / `conflicts.ts` / `create.ts` / `update.ts` / `delete.ts`) "for cleanliness."
- Breaking the remounted-secret **seam**: this desk stays behind `requireApiSecret` even though `app.ts` mounted it after public v1.
- Breaking the HMAC-then-durable-actor **seam**: do not queue a run from `req.vantageAuth` alone.
- Treating leftover `createQueuedIngestionRun`, leftover `runBestRelocationIngestionWorker`, leftover `applyBestRelocationPlan`, leftover `inspectBestRelocationSources` with `repairIdentity: true`, leftover `requireRegistryOwnerActor` on GET, leftover Drive / leftover extension login desks, leftover Granot automation, leftover employee recon, leftover CLI dry-run, leftover webhook / cron routers, or leftover public v1 as this story.
- Inventing a leftover apply-walk / leftover claim-lease / leftover cron-secret / leftover Domain Command **adapter** (except the existing `attach_booking` **ask**) that has only one caller in this pass.
- Silently dropping the remount, asking `requireRegistryOwnerActor` on GET, admitting Extension Owner Bearer onto `POST .../preview`, wrapping preview in `handleCanonicalCreate`, calling `applyBestRelocationPlan`, honoring HTTP `repair_identity`, adding `application_enabled` onto retry, planting the connection on GET, echoing `error.message`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
