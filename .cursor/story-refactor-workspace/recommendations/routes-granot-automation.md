# After The Secret, Let The Signed Dashboard Owner Keep The Exact Granot Labels, Queue A Durable Form Or Call Run Or A Correlated Group, Show The Redacted Run, Approve Selected Actions, Then Wake The Worker — Never Write A Lead, Never Call The Leftover CSV Writes, Never Capture A Receipt Here, Never Recover On The Cron Secret, Never Admit Admin Or Sales Or Leftover Employee, Never Close The Label-Only Gap — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 11 of this service — `granot-automation.routes.ts`
- Remaining in this service: `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/granot-automation.routes.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (Owner-gated HTTP session collector; Admin API `/api/v1/admin/granot-automation/runs`, `.../runs/sources`, `.../runs/:runId`, `.../runs/:runId/approve`, `.../runs/worker`, `.../run-groups`; **Auth** `requireApiSecret` + `requireRegistryOwnerActor` on **every** admin handler; `src/app.ts` mounts this router **before** v1; Preview never writes a lifecycle receipt; approved apply captures one `granot_http_automation` receipt per selected action and enters `claimAndProcessOrPoll`; it must **not** call `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`; `publishGranotWakeup` returns true only on Vercel **and** the hosted `NODE_ENV` gate, otherwise false (no throw); non-Vercel `POST /runs` and `POST /run-groups` then `runGranotWorker` inline; **known gap:** `createGranotRun` with `source_labels` only does **not** call `resolveGranotAutomationSources`; `GET .../runs/:runId?details=owner` redacts `granot_statement` and never projects receipt payloads). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`app.use(v1Routes)` **after** this file — **does not import** this file; `v1.routes.ts` has **no** `/granot-automation` path). Distinct from already-recommended Tariff / Owner-apply extracts: [routes-tariff-adjustments.md](routes-tariff-adjustments.md) / [routes-extension-granot-apply.md](routes-extension-granot-apply.md) (those sit **inside** public v1 **after** the global secret — this file remounts `requireApiSecret` because `app.ts` mounted it **before** that desk). Distinct from already-recommended HMAC lifecycle desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (Owner webhook receipts / Booking commands — **does not import** this file; leftover reads there **ask** `requireRegistryReadActor`, so Admin HMAC can see the intake queue — **this desk asks `requireRegistryOwnerActor` even on GET**). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (admits the session **before** the secret — **does not import** this file). Distinct from next cron heartbeat: `granot-automation-cron.routes.ts` (`/api/cron/granot-automation-heartbeat` `CRON_SECRET` **asks** `recoverGranotRuns` — **503** when recoverable and wakeup did not publish; **this file does not use `CRON_SECRET`**). Distinct from leftover queue consumer: `api/queues/granot-automation-consumer.ts` (`runGranotWorker` then `continueGranotRuns` — **does not import** this file). Distinct from already-recommended Wave A queue / lock / approve / walk: [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (`createGranotRun` / `createGranotRunGroup` / `approveGranotRun` / `runGranotWorker` / `getGranotRun` / `listGranotRuns` / `recoverGranotRuns` — this file **asks** those; it does **not** collect HTML, does **not** seal the plan, does **not** insert a receipt). Distinct from already-recommended Wave A labels: [granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md) (`listGranotAutomationSources` / `createGranotAutomationSource` — this file **asks** those; leftover 200 cap / exact-label conflict live there; unsafe-label / unique `supported_operations` Zod live **here**). Distinct from already-recommended apply capture: [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) (`applyAutomationPlanAction` — **this file does not import it**). Distinct from already-recommended Owner extension apply: [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) / [routes-extension-granot-apply.md](routes-extension-granot-apply.md) (`browser_extension` one-item / batch — **not** `granot_http_automation`). Distinct from leftover Wave A CSV writes: [enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (**this file must not call them**). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` `requireOwner: true` — Extension Owner Bearer without HMAC is **not** enough except the Agent-catalog mutation exception; Admin HMAC is **FORBIDDEN**; unsigned preview is never reached). Distinct from already-recommended speaker fold: [durable-work-actors.md](durable-work-actors.md) (`durableActorFromRegistryActor` `origin: "vantage_admin"` — this file **asks** it after HMAC; Registry `system` is **TypeError**). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (this file `router.use("/api/v1/admin/granot-automation", requireApiSecret)` — Sales Bearer **403 `"Forbidden"`** **before** `ownerActor`). Software map: [`.cursor/rules/granot-http-automation.mdc`](../../../.cursor/rules/granot-http-automation.mdc). Operator skill lists the eight `/granot-automation` paths. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead Enrichment](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one focused route test plus the operator catalog.** `src/app.ts` **asks** the default export (`app.use(granotAutomationRoutes)` on line 68, **after** `granotAutomationCronRoutes` / lifecycle cron, **before** `v1Routes`). Already-recommended public v1 desk does **not** mount this file. Tests on this **interface**: `granot-automation.routes.test.ts` (imports the default `routerModule`; stack-scan names `POST .../run-groups`, `POST|GET .../runs`, `GET|POST .../runs/sources`, `POST .../runs/worker`, `POST .../runs/:runId/approve`, `GET .../runs/:runId`; then **scans models / `sourceCatalog` / `runWorkflow.ts` / the consumer** for plan fields, the nine seed labels, the 200 cap, conflict message does **not** name `"TBM Forms"`, `[AC-35]` `redactPlanForDisplay` / `redactReceiptsForDisplay`, consumer `lease_busy`). It does **not** HTTP POST a run. It does **not** HMAC-sign. It does **not** name `details=owner`. It does **not** name `VERCEL !== "1"` inline worker. It does **not** name `source_labels` without `source_ids`. It does **not** name Sales 403. It does **not** name Admin HMAC 403. Already-recommended Wave A `runWorkflow.test.ts` / `sourceCatalog.test.ts` prove queue / resolve / 200 cap through the service, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/granot-automation/*`. Operator `hit-vantage-api` lists the eight paths. Not this **interface**: `createGranotRun` itself, `resolveGranotAutomationSources`, `applyAutomationPlanAction`, cron `recoverGranotRuns`, `continueGranotRuns`, `syncCallLeadEnrichment`.
- Seams callers need: `app.ts` **before** public v1 vs Tariff / Owner apply **inside** v1 after the global secret; this-file remount of `requireApiSecret` on `/api/v1/admin/granot-automation` vs cron `CRON_SECRET`; signed dashboard Owner HMAC (`requireRegistryOwnerActor` on **every** handler, including GET) vs lifecycle desk `requireRegistryReadActor` on reads; Extension Owner Bearer without HMAC is **not** enough (`requireOwner: true` and path is not Agent catalog); Admin HMAC **FORBIDDEN**; `durableActorFromRegistryActor` after HMAC vs `createBrowserExtensionOwnerInitiator`; Vercel wakeup vs local inline `runGranotWorker`; create / run-group inline only when `!queue_published` vs approve **always** inline when `VERCEL !== "1"` (does **not** check `queue_published`); `source_ids` **or** `source_labels` on one run vs run-group `source_ids` only; `source_ids` fail-closed vs label-only `createGranotRun` known gap (**leave it**); Express first-match `/sources` and `/worker` and `/:runId/approve` **before** `GET /:runId`; default export (no factory) vs sibling inject desks; `sendError` Zod **400** `INVALID_REQUEST` `"Invalid Granot automation request"` raw `issues` vs run / source conflict **409** vs collector **502** `"Granot provider request failed"` (hides `error.message`) vs registry `toHttpBody()` vs **500** `GRANOT_AUTOMATION_FAILED` `"Granot automation failed"` (**does not** echo `Error.message`); GET miss **404** `RUN_NOT_FOUND` in the handler. There is no begin / complete Domain Command **seam** in this file. There is no leftover CSV-write **seam**. There is no leftover receipt-capture **seam**. There is no leftover cron-secret **seam**.
- Split later (only if the file outgrows one sitting): this ~410-line file is one sitting if you read it as after the secret, let the signed dashboard Owner keep the exact Granot labels, queue a durable Form or Call run or a correlated group, show the redacted run, approve selected actions, then wake the worker — never write a Lead, never call the leftover CSV writes, never capture a receipt here, never recover on the cron secret, never admit Admin or Sales or leftover Employee, never close the label-only gap. Do not split. Never `sources.ts` / `runs.ts` / `approve.ts` / `worker.ts`. Queue / lock / approve / walk stay already-recommended `runWorkflow.ts`. Labels / fail-closed resolve stay already-recommended `sourceCatalog.ts`. Receipt capture stays already-recommended `automationApply.ts`. Cron recover stays next `granot-automation-cron.routes.ts`. Inline Zod window stays here until the validation pass.

`router.post("/api/v1/admin/granot-automation/runs")` / `router.post(".../approve")` are HTTP verbs. The owner question is: *Someone already passed the API secret. The signed dashboard Owner asked to keep these exact Granot Leads & Advertising labels, queue a durable Form or Call collection (or both as a correlated group), see the redacted run, approve selected update/syncable actions against the sealed checksum, or wake the worker. Parse the real MM/DD/YYYY window. Fold the HMAC Owner into a Vantage Admin speaker. Ask the already-recommended catalog or run. On a non-Vercel host, if create/group did not publish a wakeup, run the worker inline — and on approve, always run it. Answer 201 for a new label, 202 for queued work, 200 for reads. Do not write a Lead. Do not call leftover Follow Up CSV write. Do not insert a receipt here. Do not recover on the cron secret. Do not admit Admin HMAC, Sales, leftover Employee, or leftover secret-only past `ownerActor`. Do not close the label-only create gap in this rename.*

Who queues the `GranotAutomationRun` and seals schema 2 already lives in already-recommended `runWorkflow.ts`. Who keeps the exact labels already lives in already-recommended `sourceCatalog.ts`. Who captures `granot_http_automation` already lives in already-recommended `automationApply.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Do not pull those in.

## What this file actually does

Five operations for the Granot HTTP automation **desk**, not “a granot-automation CRUD dump,” and not Queue The Durable Granot Automation Run / Apply This Owner-Approved HTTP Automation Action themselves:

1. **Keep the exact Granot labels the Owner uses for HTTP automation** — `GET|POST /api/v1/admin/granot-automation/runs/sources`. `ownerActor` **before** list / create. GET optional `operation` `form_leads` | `call_leads`. **Ask** `listGranotAutomationSources`. POST Zod `label` 1–200 trim, refuse `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN`; `supported_operations` 1–2 unique `form_leads` / `call_leads`. **Ask** `createGranotAutomationSource` with `createdBy: actor`. Answer GET **200** `{ ok, data }`; POST **201**. This beat does **not** attach `granot_crm_source`. This beat does **not** seed the nine labels. This beat does **not** **ask** `resolveGranotAutomationSources`.

2. **Queue a durable Form or Call run, or a correlated group, after the secret** — `POST /api/v1/admin/granot-automation/runs` and `POST .../run-groups`. Same `ownerActor`. One-run Zod: `operation` one of `form_leads` / `call_leads`; `workflow` default `"preview"`; `from` / `to` real `MM/DD/YYYY` and `to >= from`; `source_ids` **or** `source_labels` (not both; one required); max 50 sources; optional filters default `date_factor=OPEN`, `type=ALL`, `status=10`. **Ask** `createGranotRun`. Run-group Zod: `operations` 1–2 unique; `source_ids` **required** (no labels); `validateDateWindow` same calendar refuse. **Ask** `createGranotRunGroup`. If `process.env.VERCEL !== "1"` and (one run `!data.queue_published` **or** group `data.runs.some(run => !run.queue_published)`): **ask** `runGranotWorker` (group loops `for (const _run of data.runs)` and **does not** pass `_run`). Answer **202** `{ ok, data }` plus `local_worker` / `local_workers`. This beat does **not** collect HTML. This beat does **not** close the label-only gap.

3. **Show the Owner the redacted run** — `GET /api/v1/admin/granot-automation/runs` and `GET .../runs/:runId`. Same `ownerActor`. List Zod `limit` 1–100 default 25. **Ask** `listGranotRuns`. One run Zod 24-hex `runId`; `details === "owner"` is the redacted-plan **seam**. **Ask** `getGranotRun`. Miss **404** `{ ok: false, code: "RUN_NOT_FOUND", error: "Granot automation run was not found." }`. This beat does **not** echo `granot_statement`. This beat does **not** project receipt payloads.

4. **Approve selected actions on the sealed apply plan after the secret** — `POST .../runs/:runId/approve`. `ownerActor`. 24-hex `runId`. Body `plan_checksum` 64-hex and `selected_action_ids` 1–5000 (uniqueness lives in already-recommended approve, not this Zod). **Ask** `approveGranotRun` with `approved_by: actor`. If `VERCEL !== "1"` **always** **ask** `runGranotWorker` and paint `local_worker` — **does not** read `queue_published`. Answer **202**. This beat does **not** walk selected actions. This beat does **not** **ask** `applyAutomationPlanAction`.

5. **Wake the worker, or recover leftover queued work, after the secret** — `POST .../runs/worker`. `ownerActor`. Body `{ action: "execute" | "recover" }` default `"execute"`. `recover` **asks** `recoverGranotRuns`; else **asks** `runGranotWorker`. Answer **202**. This beat does **not** **ask** `continueGranotRuns`. This beat does **not** 503 when recoverable and wakeup failed — that envelope lives on the next cron file.

`ownerActor` / `parseGranotDate` / `validateDateWindow` / `sendError` are beats inside these operations, not extra owner stories. `ownerActor` reads `req.vantageAuth`, **asks** `requireRegistryOwnerActor`, then **asks** `durableActorFromRegistryActor`. `sendError` is Zod → **400**; `GranotRunConflict` / `GranotAutomationSourceConflict` / `GranotAutomationSourceLimitReached` → **409**; `GranotAutomationSourceValidationError` → **400** plus `issues`; `GranotCollectorError` → **502** `"Granot provider request failed"`; `isRegistryError` → `error.statusCode` + `error.toHttpBody()`; else **500** `GRANOT_AUTOMATION_FAILED` `"Granot automation failed"`. They are private.

There is no sixth leftover CSV or receipt operation. Five HTTP **adapters** on one default export over already-recommended catalog + run. GET `/sources` and POST `/worker` stay registered **before** `/:runId` so Express first-match cannot steal `"sources"` as a run id. Do not collapse them so “one `/runs` owns every verb.”

## Organization

Keep one file. This is the screenplay for “after the secret, let the signed dashboard Owner keep the exact Granot labels, queue a durable Form or Call run or a correlated group, show the redacted run, approve selected actions, then wake the worker — never write a Lead, never call the leftover CSV writes, never capture a receipt here, never recover on the cron secret, never admit Admin or Sales or leftover Employee, never close the label-only gap.” Already-recommended queue / labels / apply capture / HMAC gate already live in deeper **modules**. Do not pull those in. Do not invent a `GranotAutomationRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a leftover CSV **adapter** so “`/runs` can still write Follow Up.” Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover factory **adapter** in this rename so “the test can inject `createGranotRun`” — park it. Do not invent a CRUD folder so `sources.ts` / `runs.ts` / `approve.ts` each get a file.

Do not move `createGranotRun` into this file so “the route owns the run.” Do not mount this router inside `v1.routes.ts` so “one file owns `/api/v1`.” Do not merge this router into `granot-automation-cron.routes.ts` so “one file owns recover.” Do not merge this router into `granot-lifecycle-admin.routes.ts` so “one file owns every Granot Owner path.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `ownerGranotHttpAutomationDesk` | `app.ts` mounts the zero-arg instance **before** public v1 |
| `GET .../runs/sources` (today unexported handler) | `showTheOwnerTheExactGranotLabelsTheyCanPickOverHttp` | Owner HMAC then list + optional operation filter **200** |
| `POST .../runs/sources` (today unexported handler) | `addAnExactGranotLabelTheOwnerDeclaredOverHttp` | unsafe-label Zod then create **201** `missing_reference` |
| `POST .../runs` (today unexported handler) | `queueADurableGranotAutomationRunAfterTheSecretOverHttp` | window + ids or labels then create + optional inline worker **202** |
| `POST .../run-groups` (today unexported handler) | `queueCorrelatedFormAndCallRunsFromTheSameSubmissionOverHttp` | `source_ids` only then group + optional inline workers **202** |
| `GET .../runs` / `GET .../runs/:runId` (today unexported handlers) | `showTheOwnerTheRedactedGranotAutomationRunsOverHttp` / `showThisRedactedGranotAutomationRunOverHttp` | list 1–100 vs one run + `details=owner` redaction **seam**; miss **404** |
| `POST .../runs/:runId/approve` (today unexported handler) | `approveSelectedActionsOnTheSealedApplyPlanAfterTheSecretOverHttp` | checksum + selected ids then approve + non-Vercel **always** inline worker **202** |
| `POST .../runs/worker` (today unexported handler) | `wakeTheGranotAutomationWorkerOrRecoverLeftoverWorkAfterTheSecretOverHttp` | `execute` vs `recover` **202** (no 503 envelope) |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `requestSchema` / `ownerActor` / `sendError` / `parseGranotDate` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename `createGranotRun` here — that stays already-recommended Wave A. Do **not** add `POST .../runs/:runId/apply` so “the desk can walk actions without the worker.” Do **not** add `granot_statement` onto `GET .../runs/:runId` so “ops can replay the session.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover create already paints when a non-Vercel host ran the worker inline:

```ts
type DurableGranotAutomationRunQueuedOverHttp = {
  ok: true
  data: {
    // today's createGranotRun / createGranotRunGroup bag
    queue_published: boolean
    local_worker?: unknown
    local_workers?: unknown[]
  }
}
```

That is the handoff from “the run document is queued” to “this host either published a wakeup or already claimed the account.” Do **not** add `granot_statement` onto that bag. Do **not** collapse `{ data }` into `{ data: { runs: [one] } }` so “every create is a group.”

Leave `createGranotRun` / `approveGranotRun` / `runGranotWorker` on already-recommended `runWorkflow.ts`. Leave `listGranotAutomationSources` / `createGranotAutomationSource` on already-recommended `sourceCatalog.ts`. Leave HMAC on already-recommended `trustedActor.ts`. Leave the speaker fold on already-recommended `durableActorFromRegistryActor`. Leave cron recover on next `granot-automation-cron.routes.ts`. Leave this file’s remount of `requireApiSecret` until a later `app.ts` story moves the mount behind public v1.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granot-automation.routes.ts
// Someone already passed the API secret — this desk remounts it
// because app.ts mounted us before the public v1 desk.
// The signed dashboard Owner is speaking.
// Let them keep the exact Granot labels.
// Let them queue a durable Form or Call run, or a correlated group.
// Let them see the redacted run.
// Let them approve selected actions.
// Let them wake the worker.
// Do not write a Lead.
// Do not call the leftover CSV writes.
// Do not capture a receipt here.
// Do not recover on the cron secret.
// Do not admit Admin, Sales, or leftover Employee.
// Do not close the label-only gap.

const ownerGranotHttpAutomationDesk = Router()
ownerGranotHttpAutomationDesk.use(
  "/api/v1/admin/granot-automation",
  requireApiSecret, // remount — we sit before public v1
)

// ── 1. Keep the exact Granot labels ───────────────────────

ownerGranotHttpAutomationDesk.get(
  "/api/v1/admin/granot-automation/runs/sources",
  showTheOwnerTheExactGranotLabelsTheyCanPickOverHttp,
)
ownerGranotHttpAutomationDesk.post(
  "/api/v1/admin/granot-automation/runs/sources",
  addAnExactGranotLabelTheOwnerDeclaredOverHttp,
)

// ── 2. Queue a durable run or a correlated group ──────────

ownerGranotHttpAutomationDesk.post(
  "/api/v1/admin/granot-automation/runs",
  queueADurableGranotAutomationRunAfterTheSecretOverHttp,
)
ownerGranotHttpAutomationDesk.post(
  "/api/v1/admin/granot-automation/run-groups",
  queueCorrelatedFormAndCallRunsFromTheSameSubmissionOverHttp,
)

// ── 3. Show the redacted run ──────────────────────────────

ownerGranotHttpAutomationDesk.get(
  "/api/v1/admin/granot-automation/runs",
  showTheOwnerTheRedactedGranotAutomationRunsOverHttp,
)
ownerGranotHttpAutomationDesk.get(
  "/api/v1/admin/granot-automation/runs/:runId",
  showThisRedactedGranotAutomationRunOverHttp,
)

// ── 4. Approve selected actions ───────────────────────────

ownerGranotHttpAutomationDesk.post(
  "/api/v1/admin/granot-automation/runs/:runId/approve",
  approveSelectedActionsOnTheSealedApplyPlanAfterTheSecretOverHttp,
)

// ── 5. Wake the worker or recover leftover work ───────────

ownerGranotHttpAutomationDesk.post(
  "/api/v1/admin/granot-automation/runs/worker",
  wakeTheGranotAutomationWorkerOrRecoverLeftoverWorkAfterTheSecretOverHttp,
)

export default ownerGranotHttpAutomationDesk

function foldTheSignedDashboardOwnerIntoAVantageAdminSpeaker(req) {
  return durableActorFromRegistryActor(
    requireRegistryOwnerActor(req, req.vantageAuth),
  )
}

async function queueADurableGranotAutomationRunAfterTheSecretOverHttp(req, res) {
  try {
    const actor = foldTheSignedDashboardOwnerIntoAVantageAdminSpeaker(req)
    const parsed = parseOneRunWindowAndSources(req.body) // ids XOR labels
    const data = await createGranotRun({ ...parsed, initiator: actor })
    if (!data.queue_published && thisHostIsNotVercel()) {
      const worker = await runGranotWorker()
      return res.status(202).json({ ok: true, data: { ...data, local_worker: worker } })
    }
    return res.status(202).json({ ok: true, data })
  } catch (error) {
    return refuseTheDesk(res, error)
  }
}

function refuseTheDesk(res, error) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_REQUEST",
      error: "Invalid Granot automation request",
      issues: error.issues,
    })
  }
  if (error instanceof GranotCollectorError) {
    return res.status(502).json({
      ok: false,
      code: error.code,
      error: "Granot provider request failed",
    })
  }
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody())
  }
  // conflicts 409 / source validation 400 / else 500 GRANOT_AUTOMATION_FAILED
}
```

Register `/sources` / `/worker` / `/:runId/approve` **before** `GET /:runId` in the live file (Express first-match). The sketch groups by story, not registration order.

Read the desk path out loud: *Someone already passed the API secret. This desk remounted it because it sits before the public v1 desk. Fold the signed dashboard Owner into a Vantage Admin speaker. If they are keeping labels, parse the unsafe-character refuse and ask the catalog. If they are queueing a run, parse a real calendar window and either source ids or source labels — do not close the label-only gap. If they are queueing a group, require source ids. If this host is not Vercel and the wakeup did not publish, run the worker inline. If they are approving, always run the worker inline on a non-Vercel host. Show the redacted run. Do not write a Lead. Do not recover on the cron secret.*

That is the operation. `router.post("/runs")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk remounts the secret because `app.ts` mounted it before public v1.** Already-recommended Tariff / Owner apply sit **after** `router.use("/api/v1", requireApiSecret)` and **do not** remount. This file `router.use("/api/v1/admin/granot-automation", requireApiSecret)`. Sales Bearer is **403 `"Forbidden"`** **before** `ownerActor`. Do not silently drop the remount so “it matches Tariff” without moving the `app.ts` mount behind v1 — that is an `app.ts` story. Do not mount this router before `requireApiSecret` so “the Owner can queue without a secret.”

2. **Every handler asks HMAC Owner, including GET.** Sibling lifecycle desk **asks** `requireRegistryReadActor` on cases / job / health, so Admin HMAC can see the intake queue. This desk **asks** `requireRegistryOwnerActor` on GET sources / list / detail. Extension Owner Bearer without HMAC falls through to `verifySignedActor` (`requireOwner: true` and path is not Agent catalog). Admin HMAC is **FORBIDDEN** even on GET. Unsigned preview is never reached. Knowledge already says Owner on every admin handler. Do not silently switch GET onto `requireRegistryReadActor` so “Admin can list runs.” Do not silently admit Extension Owner Bearer so “the Granot extension can queue a run.”

3. **Approve always inlines the worker on non-Vercel; create / group only inline when wakeup failed.** `POST /runs` checks `!data.queue_published && VERCEL !== "1"`. `POST /run-groups` checks `VERCEL !== "1" && data.runs.some(run => !run.queue_published)`. `POST .../approve` checks only `VERCEL !== "1"` and **always** **asks** `runGranotWorker`. Knowledge names the create / group inline; it does **not** name the approve-always-inline. Do not silently add the `queue_published` check onto approve so “one wakeup rule owns every 202” without a paired test. Do not silently drop create’s check so “local always runs the worker twice.”

4. **The run-group local-worker loop ignores each child.** `for (const _run of data.runs) { localWorkers.push(await runGranotWorker()) }` does not pass `_run`. Already-recommended `runGranotWorker` claims the account and picks the next run. The count of calls matches the child count, not a targeted id. Do not silently pass `run_id` into `runGranotWorker` so “each child is claimed” — that export does not take a run id. Park the unused `_run`.

5. **One-run Zod allows `source_labels` only; that is the known gap, not a route bug.** `requestSchema` requires `source_ids` **or** `source_labels`, not both. Run-group Zod requires `source_ids` and never accepts labels. Already-recommended `createGranotRun` skips `resolveGranotAutomationSources` on labels only. CONTRADICTIONS already records that. Do not silently refuse `source_labels` here so “the gap closes.” Do not silently call resolve from this file so “the route owns fail-closed.”

6. **Date-window and filters Zod are copied twice.** `requestSchema` inlines the calendar `superRefine`. Run-group **asks** `validateDateWindow`. Both copy the same `filters` object (`date_factor` / `type` / `department` / `state` / `status`). `parseGranotDate` is the one real calendar decision (UTC construct, then year/month/day must match). Do not silently move that Zod onto a new `validation/v1` barrel in this rename — leave the validation pass. Do not silently accept `YYYY-MM-DD` so “ISO owns Granot.”

7. **`sendError` hides provider text and does not echo 500 `error.message`.** Collector **502** is `"Granot provider request failed"` plus `error.code`. Unknown is **500** `GRANOT_AUTOMATION_FAILED` `"Granot automation failed"`. Sibling Tariff **500** echoes `error.message`. Sibling Owner apply rethrows. Sibling Job Number maps `"Internal error"` and logs. This desk does **not** `recordOperationalEvent`. Do not silently import the Tariff refuse so “one refuse owns every desk.” Do not silently leak `GranotCollectorError.message` so “ops can see the login page.” Park the 500 hide.

8. **The route test does not hit HTTP.** `granot-automation.routes.test.ts` stack-scans paths, then source-scans `runWorkflow.ts` / `sourceCatalog` / the consumer / the models. Sibling Tariff injects `appendRows` / `now` / `connect` and names 200 / 400. This file has **no** factory. Do not silently add `createGranotAutomationRouter(deps)` in this rename without a paired test that names HMAC Owner **202**, Admin **403**, label-only create, `details=owner` redaction, and non-Vercel inline worker. Park the missing inject **seam**.

9. **Unsafe-label refuse is Zod here; 200-cap / exact-label conflict are the catalog.** This file **asks** `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` from the model. Already-recommended `createGranotAutomationSource` owns `GRANOT_SOURCE_CATALOG_FULL` / `GRANOT_SOURCE_ALREADY_EXISTS`. The route test locks the conflict message does **not** name `"TBM Forms"` by constructing the class, not by POSTing. Do not silently re-check the 200 cap in this file so “the route owns the catalog.”

10. **Leave sibling modules alone.** `createGranotRun` / `listGranotAutomationSources` / `requireRegistryOwnerActor` / `durableActorFromRegistryActor` are already the right **depth**. This file orchestrates the HTTP **adapter**.

11. **Do not treat Owner apply, leftover CSV write, webhook capture, cron recover, or public v1 as this story.** Next `ingestion.routes.ts` is Best Relocation. Next `granot-automation-cron.routes.ts` is the heartbeat. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

12. **Do not silently restore a leftover Form / Call / Booked mutation bypass.** Knowledge: approved apply must not call `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`. This file already does not import those. Wave A `[AC-02]` already source-scans the run module. Do not add those imports so “preview can still write.”

## Testing

The **interface** is the test surface: `ownerGranotHttpAutomationDesk` (mounted on leftover `app.ts` **before** public v1) and the five HTTP operations above.

Today `granot-automation.routes.test.ts` already names the eight registered paths, then source-scans plan fields, nine seed labels, 200 cap, conflict message without `"TBM Forms"`, `[AC-35]` redaction helpers, and consumer `lease_busy`. It misses HMAC Owner HTTP, Admin HMAC 403, Sales 403, `details=owner`, label-only create, non-Vercel inline worker, approve-always-inline, Zod both-ids-and-labels 400, collector 502 hide, and 500 `GRANOT_AUTOMATION_FAILED`. Already-recommended Wave A files prove queue / resolve / apply through the service — not this desk.

Keep a later inject-and-sign HMAC style (sibling lifecycle admin already mints `computeAdminActorSignature`). Add the missing operations (do not boot Granot HTML, live credentials, or leftover CSV write in the route file):

**After the secret / who may speak**
- This desk remounts `requireApiSecret` on `/api/v1/admin/granot-automation` and is mounted from `app.ts` **before** `v1Routes`.
- Signed dashboard Owner HMAC **asks** `createGranotRun` / `listGranotAutomationSources` / `approveGranotRun`.
- Admin HMAC **403** `FORBIDDEN` (`Registry mutations require an Owner actor.`) on GET **and** POST.
- Extension Owner Bearer without HMAC **403** on POST `/runs` (not Agent catalog).
- Sales Bearer **403 `"Forbidden"`** is the remounted secret, before `ownerActor`.
- Cron `CRON_SECRET` is **not** accepted here.

**Keep the labels**
- Owner `GET .../runs/sources?operation=form_leads` **asks** `listGranotAutomationSources("form_leads")` and **200**.
- Owner `POST .../runs/sources` with a bidirectional-character label answers Zod **400** and does **not** **ask** `createGranotAutomationSource`.
- Injected catalog-full **409** `GRANOT_SOURCE_CATALOG_FULL`.

**Queue / show / approve / wake**
- Owner `POST .../runs` with `source_labels` **asks** `createGranotRun` (label-only gap stays open) and **202**.
- Owner `POST .../runs` with both `source_ids` and `source_labels` answers Zod **400** and does **not** **ask** `createGranotRun`.
- Owner `POST .../run-groups` without `source_ids` answers Zod **400**.
- Non-Vercel create with `queue_published: false` **asks** `runGranotWorker` once and paints `local_worker`.
- Non-Vercel approve **asks** `runGranotWorker` even when the approve bag has `queue_published: true`.
- Owner `GET .../runs/:runId?details=owner` **asks** `getGranotRun(id, true)` and the response omits `granot_statement`.
- Missing run **404** `RUN_NOT_FOUND`.
- Injected `GranotCollectorError` answers **502** `"Granot provider request failed"` and does **not** echo the provider page.
- Injected `new Error("sheet down")` answers **500** `GRANOT_AUTOMATION_FAILED` `"Granot automation failed"` (name the hide).
- This beat does **not** **ask** `updateFormLead` / `syncCallLeadEnrichment` / `applyAutomationPlanAction`.

**Mount**
- `app.ts` should keep `app.use(granotAutomationRoutes)` after the automation cron and before `v1Routes`.
- Express first-match: `/runs/sources` and `/runs/worker` stay registered before `GET /runs/:runId`.

**Not this file**
- Queue / lock / approve / walk stay on already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md).
- Labels / fail-closed resolve stay on already-recommended [granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md).
- Receipt capture stays on already-recommended [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md).
- HMAC Owner / Admin refuse stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Cron 503 recover stays on next `granot-automation-cron.routes.ts`.
- Owner extension apply stays on already-recommended [routes-extension-granot-apply.md](routes-extension-granot-apply.md).

Do **not** add a test per helper (`foldTheSignedDashboardOwnerIntoAVantageAdminSpeaker`, `parseOneRunWindowAndSources`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `GranotAutomationRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`sources.ts` / `runs.ts` / `approve.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the remounted-secret **seam**: this desk stays behind `requireApiSecret` even though `app.ts` mounted it before public v1.
- Breaking the HMAC-Owner-then-durable-actor **seam**: do not queue a run from `req.vantageAuth` alone.
- Treating leftover `createGranotRun`, leftover `resolveGranotAutomationSources`, leftover `applyAutomationPlanAction`, leftover `requireRegistryReadActor`, leftover Drive / leftover extension login desks, leftover Extension Users desk, leftover Granot lifecycle admin, leftover Owner apply, leftover ordinary Form POST, leftover webhook / cron routers, or leftover Best Relocation ingestion as this story.
- Inventing a leftover CSV / leftover receipt-capture / leftover cron-secret / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently dropping the remount, asking `requireRegistryReadActor` on GET, admitting Extension Owner Bearer onto `POST /runs`, wrapping the POST in `handleCanonicalCreate`, calling `updateFormLead` / `syncCallLeadEnrichment`, closing the label-only gap, adding `granot_statement` onto `details=owner`, echoing collector `error.message`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
