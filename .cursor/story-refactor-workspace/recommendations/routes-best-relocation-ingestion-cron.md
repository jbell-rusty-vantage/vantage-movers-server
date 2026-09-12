# After The Cron Secret Proves This Tick Is Ours, Recover A Stranded Best Relocation Run Then Claim A Due Connection And Queue A Schedule Run — Never Claim The Apply Lease Here, Never Inspect Sheets Here, Never Walk The Plan Here, Never Discard An Unpublished Wake-Up, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 25 of this service — `best-relocation-ingestion-cron.routes.ts`
- Remaining in this service: `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/best-relocation-ingestion-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (fenced Best Relocation inspect / preview / adopt / apply through canonical commands; Mongo domain documents are [System of Record](../../../../CONTEXT.md) and are written only through those commands; Best Relocation workbooks are the external evidence source; `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [Booking](../../../../CONTEXT.md) authority; **HTTP / queue / cron** row: Cron “Best Relocation ingest heartbeat — skips before source reads when gates are off”; `BEST_RELOCATION_INGEST_ENABLED` must be true before `application_enabled=true`, non-bootstrap apply, or retry; `application_enabled` also requires completed bootstrap; cadence 24 or 48 hours; route errors never expose provider or source details; this is not Sheet Sync and not Granot HTTP automation). Distinct from already-recommended Owner desk: [routes-ingestion.md](routes-ingestion.md) (`GET|PATCH /api/v1/admin/ingestion/*` after leftover `requireApiSecret` + HMAC; Owner preview / approve / retry **discard** `publishIngestionWakeup` and still **202**; **imports leftover `envGateEnabled` from this file**; **does not use `CRON_SECRET`**; **this file never asks HMAC**). Distinct from leftover queue consumer: `api/queues/best-relocation-ingestion-consumer.ts` (`runBestRelocationIngestionWorker`, payload ignored, leftover `lease_busy` throws so Vercel retries — **does not import this file**). Distinct from leftover CLI dry-run: `scripts/best-relocation-sheet-ingest.ts` (`pnpm ingest:best-relocation -- --dry-run`; live apply retired — **does not import this file**). Distinct from already-recommended Wave A claim / inspect / lock / apply: [ingestion-worker.md](ingestion-worker.md) (`runBestRelocationIngestionWorker` — leftover `deploymentGateEnabled` is a twin of leftover `envGateEnabled`; leftover worker stamps leftover `last_successful_run_at`; **this file never asks the worker**). Distinct from already-recommended Wave A walk: [ingestion-apply-plan.md](ingestion-apply-plan.md) (`applyBestRelocationPlan` — **this file never asks it**). Distinct from already-recommended Wave A persist: [ingestion-repository.md](ingestion-repository.md) (`ensureBestRelocationConnection` / `oldestRecoverableIngestionRun` / `claimDueBestRelocationConnection` / `createQueuedIngestionRun` — this file **asks** those after leftover `connectMongo`). Distinct from already-recommended Wave A poke: [ingestion-queue.md](ingestion-queue.md) (`publishIngestionWakeup` — this file **asks** leftover `reason: "recovery"` then leftover `reason: "schedule"` and **503**s unpublished; leftover `reason: "cron"` is unused). Distinct from already-recommended Wave A letters: [ingestion-health.md](ingestion-health.md) (`emitIngestionHealthSignal` — **this file never asks it**; this file **awaits** leftover `recordOperationalEvent` leftover `best_relocation_ingestion.success_stale` directly). Distinct from already-recommended leftover letters persist: [observability-record-operational-event.md](observability-record-operational-event.md) (this file **asks** it only on the 30-hour stale beat — **not** on auth fail / unexpected throw; already-recommended notification cron **void-asks** leftover `cron.auth.failed` / leftover `notification.digest_cron.failed`). Distinct from already-recommended leftover speaker: [durable-work-actors.md](durable-work-actors.md) (`createBestRelocationIngestionActor` leftover `heartbeat:<iso>` / leftover origin `external_sheet_ingestion` — **this file asks it**; leftover HMAC fold is leftover Owner desk). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (mode gate **on the route**, no-op unless `queued`, HTTP `{ skipped: true }`, **never publishes** — **does not import this file**). Distinct from already-recommended Lead Messaging cron: [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) (always-ask drain after leftover `connectMongo`, **200** `{ summary }`, **500** may echo `error.message`, **no** letter from the route — **does not import this file**). Distinct from already-recommended CPL cron: [routes-cpl-correction-cron.md](routes-cpl-correction-cron.md) (`connectMongo` then leftover `runDue` leftover `limit: 5`, **500** generic `CPL_CORRECTION_DRAIN_FAILED` — **does not import this file**). Distinct from already-recommended notification cron: [routes-notification-cron.md](routes-notification-cron.md) (daily letter then retry, **no** leftover `connectMongo` on the route, disabled letter is still **200** with leftover `digest.skipped`, **void** letters — **does not import this file**). Distinct from already-recommended rematch cron: [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (flag default **on**, HTTP `{ skipped: true }` when off — **does not import this file**). Distinct from already-recommended Call Log cron: [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (`lease_held` **200** + factory inject; flags default **false** — **does not import this file**). Distinct from leftover Vercel schedule: `vercel.json` path `/api/cron/best-relocation-ingest-heartbeat` at `0 */6 * * *` UTC (every six hours — **not** the 24/48-hour connection cadence). Distinct from leftover env: leftover `BEST_RELOCATION_INGEST_ENABLED` must be leftover `"true"` (trim / lower) — **this file exports leftover `envGateEnabled`**. Distinct from other secrets: leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one Owner-desk import plus one helper-unit test.** `src/app.ts` **asks** the default export (`app.use(bestRelocationIngestionCronRoutes)` on line 64 — **after** already-recommended Twilio desks / already-recommended notification cron, **before** next reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1, already-recommended Owner ingestion desk). Already-recommended `src/routes/ingestion.routes.ts` **asks** leftover exported `envGateEnabled` (GET connection paints leftover `env_gate_enabled`; PATCH / retry refuse leftover enable when the gate is off). Tests: `src/services/ingestion/ingestion.test.ts` **asks** leftover exported `envGateEnabled` / leftover `ingestionHeartbeatSkipReason` (“heartbeat gates skip before source reads”) — it does **not** HTTP the cron. There is **no** `best-relocation-ingestion-cron.routes.test.ts`. Operator `hit-vantage-api` lists Owner `/admin/ingestion/*`, **not** `/api/cron/best-relocation-ingest-heartbeat`. Host public/unguarded tables omit this path. Not this **interface**: leftover `runBestRelocationIngestionWorker` itself, leftover `applyBestRelocationPlan` itself, leftover `emitIngestionHealthSignal` itself, leftover `inspectBestRelocationSources` itself, leftover CLI dry-run itself, leftover Owner HMAC itself.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs leftover `requireApiSecret` vs Owner HMAC; leftover `connectMongo` **then** leftover `ensureBestRelocationConnection` **then** leftover env skip vs knowledge / leftover test title “skips before source reads”; leftover recovery unpublished **503** **exits before** leftover stale letter **and** leftover due claim vs leftover recovery published **continues**; leftover Owner HTTP **discards** leftover wakeup vs this desk **503**; leftover `application_enabled` + 30-hour leftover `last_successful_run_at` **awaits** leftover `best_relocation_ingestion.success_stale` vs already-recommended notification cron **void** letters vs already-recommended Wave A health (never this key); leftover claim miss **200** `{ skipped: true, reason: "application_disabled_or_not_due" }` vs leftover exported helper leftover `application_disabled` | leftover `not_due` (unused by HTTP); leftover published schedule **202** `{ skipped: false, run_id, next_due_at, queue_published }` vs leftover env skip **200** `{ skipped: true, reason: "environment_disabled" }`; unexpected throw **500** `{ error: error.message }` (or `"Ingestion heartbeat failed"`) vs already-recommended CPL generic `CPL_CORRECTION_DRAIN_FAILED`; leftover `envGateEnabled` export vs leftover worker leftover `deploymentGateEnabled` copy; no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; leftover six-hour Vercel tick vs leftover 24/48-hour cadence CAS. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no leftover apply-walk **seam**. There is no leftover apply-lease **seam**.
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as after the cron secret proves this tick is ours, recover a stranded Best Relocation run then claim a due connection and queue a schedule run — never claim the apply lease here, never inspect sheets here, never walk the plan here, never discard an unpublished wake-up, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `recover.ts` / `schedule.ts` / `create.ts` / `update.ts` / `delete.ts`. Plant / recover / claim / queue stay already-recommended `repository.ts`. Wakeup stays already-recommended `queue.ts`. Worker claim stays already-recommended `worker.ts`. Owner HMAC stays already-recommended `ingestion.routes.ts`. Reporting heartbeat stays next `reporting-cron.routes.ts`.

`router.all("/api/cron/best-relocation-ingest-heartbeat")` is an HTTP verb. The owner question is: *Vercel just woke us every six hours — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. Open Mongo and plant or find the one Best Relocation connection. If `BEST_RELOCATION_INGEST_ENABLED` is not true, answer skipped `environment_disabled` — we already planted the row. If a stranded queued or expired-lease run exists, poke the worker as recovery; unpublished is 503 and we stop before the stale letter and the due claim. If application is on and there has been no successful run in thirty hours, write `success_stale` and wait for that letter. Then try to claim the connection when cadence is due. If we cannot, answer skipped `application_disabled_or_not_due` — recovery and the stale letter already happened. If we claimed, insert a queued schedule run, poke the worker, unpublished 503, published 202 with `run_id`. Do not claim the five-minute apply lease. Do not inspect sheets. Do not walk the plan. Do not discard an unpublished wakeup the way Owner HTTP does. Do not compare `x-api-secret`.*

Who plant the one connection / find the oldest stranded run / claim cadence / insert a queued run already lives in already-recommended `repository.ts`. Who poke the worker already lives in already-recommended `queue.ts`. Who take the five-minute apply lease already lives in already-recommended `worker.ts`. Who mint the system speaker already lives in already-recommended `actors.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, recover a stranded Best Relocation run then claim a due connection and queue a schedule run” story, not “a cron CRUD dump,” and not Claim The Next Best Relocation Run / Apply The Locked Plan / Show The Owner The Connection themselves:

1. **Wake this Best Relocation ingest heartbeat — recover stranded work, then queue a due schedule run** — `ALL /api/cron/best-relocation-ingest-heartbeat`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }` — **does not** leftover `recordOperationalEvent`. Mismatch **401** `{ ok: false, error: "Unauthorized" }` — **does not** leftover `recordOperationalEvent`. Mint leftover `createBestRelocationIngestionActor("heartbeat:" + now.toISOString())`. **Ask** leftover `connectMongo`. **Ask** leftover `ensureBestRelocationConnection(actor)` (upsert leftover `ExternalDataConnection` leftover key leftover `best_relocation`, leftover `$set` leftover `updated_actor`). Then leftover `envGateEnabled()` (leftover `BEST_RELOCATION_INGEST_ENABLED` trim / lower === leftover `"true"`). Gate off **200** `{ ok: true, skipped: true, reason: "environment_disabled" }` — **does not** leftover recover, leftover write stale, leftover claim. Gate on: **ask** leftover `oldestRecoverableIngestionRun(now)` (oldest leftover `queued`, or leftover `inspecting` / leftover `planning` / leftover `applying` with leftover missing / leftover expired leftover `leased_until`). Hit **asks** leftover `publishIngestionWakeup({ reason: "recovery", run_hint })`; unpublished **503** `{ ok: false, error: "Queued ingestion recovery could not publish a worker wakeup.", run_id }` and **returns** — **does not** leftover write stale, leftover claim. Published recovery **continues**. Then if leftover `connection.application_enabled` **and** (leftover `last_successful_run_at` missing **or** older than leftover `30 * 60 * 60 * 1000` ms) **await-asks** leftover `recordOperationalEvent` (`level: "error"`, leftover `eventKey: "best_relocation_ingestion.success_stale"`, leftover `category: "cron"`, leftover `workflow: "best_relocation_ingestion"`, leftover `notificationCandidate: true`, leftover `details.last_successful_run_at`). Then **asks** leftover `claimDueBestRelocationConnection({ now, actor })` (leftover `application_enabled: true` + leftover non-null leftover `application_enabled_actor` + leftover `next_due_at` null / missing / `<= now`, leftover CAS leftover `next_due_at` = now + leftover `cadence_hours`). Miss **200** `{ ok: true, skipped: true, reason: "application_disabled_or_not_due" }`. Hit **asks** leftover `createQueuedIngestionRun({ connection_id, trigger: "schedule", actor, initiator: claim.initiator, now })` then leftover `publishIngestionWakeup({ reason: "schedule", run_hint: queued.run_id })`. Unpublished **503** `{ ok: false, error: "Ingestion run was queued but its worker wakeup was not published.", run_id }` — the leftover queued row **already stands**. Published **202** `{ ok: true, skipped: false, run_id, next_due_at: claim.next_due_at, queue_published: true }`. Unexpected throw **500** `{ ok: false, error: error.message }` (or `"Ingestion heartbeat failed"` when the throw is not an `Error`) — **does not** leftover `recordOperationalEvent`. This beat does **not** **ask** leftover `runBestRelocationIngestionWorker`. This beat does **not** **ask** leftover `applyBestRelocationPlan`. This beat does **not** **ask** leftover `inspectBestRelocationSources`. This beat does **not** **ask** leftover `emitIngestionHealthSignal`. This beat does **not** compare leftover `x-api-secret`. This beat does **not** leftover `ask` leftover `ingestionHeartbeatSkipReason` (exported, unused by HTTP).

`requireCronAuth` / leftover exported `envGateEnabled` / leftover exported `ingestionHeartbeatSkipReason` are beats inside this operation, not extra owner stories. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second leftover apply-lease operation. Wave A leftover worker elects leftover `ingestion:best_relocation:apply`. There is no third leftover inspect operation. There is no fourth leftover Owner HMAC operation. There is no fifth leftover Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, recover a stranded Best Relocation run then claim a due connection and queue a schedule run — never claim the apply lease here, never inspect sheets here, never walk the plan here, never discard an unpublished wake-up, never use the API secret.” Already-recommended plant / recover / claim / queue / poke / leftover worker / leftover Owner desk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationIngestionCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** leftover recover then leftover claim. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner preview.” Do not invent a leftover apply **adapter** so “the heartbeat can walk actions without the worker.” Do not invent a leftover health **adapter** so “`success_stale` lives on Wave A emit.” Do not invent a CRUD folder so `recover.ts` / `schedule.ts` / `cron.ts` each get a file.

Do not move leftover `claimDueBestRelocationConnection` into this file so “the route owns cadence.” Do not move leftover `envGateEnabled` into leftover `ingestion.routes.ts` in this rename so “the desk owns the gate” without a paired HTTP proof that GET leftover `env_gate_enabled` still reads this export. Do not move leftover `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside leftover `v1.routes.ts` so “one file owns every ingest start.” Do not merge this router into leftover `ingestion.routes.ts` so “one file owns recover.” Do not merge this router into leftover `notification-cron.routes.ts` so “one file owns every `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `bestRelocationIngestHeartbeatCronDesk` | `app.ts` mounts the instance **after** Twilio desks / already-recommended notification cron, **before** next reporting cron / leftover Owner ingestion desk |
| `ALL /api/cron/best-relocation-ingest-heartbeat` (today unexported handler) | `wakeThisBestRelocationIngestHeartbeatOverHttp` | auth **then** plant **then** env skip **or** recover **then** stale **then** claim **or** 202 |
| `envGateEnabled` | `bestRelocationIngestEnvGateIsOn` | leftover Owner desk paints leftover `env_gate_enabled`; leftover `ingestion.test.ts` already imports this fold |
| `ingestionHeartbeatSkipReason` | `nameWhyThisBestRelocationHeartbeatWouldSkip` | leftover `ingestion.test.ts` already units this helper — keep as a one-line alias until that test migrates onto HTTP |

Keep the default export as a one-line alias until `app.ts` migrates. Keep leftover `envGateEnabled` as a one-line alias until leftover `ingestion.routes.ts` and leftover `ingestion.test.ts` migrate. Do not make callers learn leftover `leased_until` / leftover `application_enabled_actor` / leftover `cadence_hours` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createBestRelocationIngestionCronRouter({ claimDue, publish })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after a published schedule poke:

```ts
type BestRelocationScheduleRunQueuedOverHttp = {
  ok: true
  skipped: false
  run_id: string
  next_due_at: Date
  queue_published: true
}
```

That is the **202** handoff from “Vercel woke us and cadence was due” to “a leftover `queued` leftover `schedule` row exists and this host published the poke.” Do **not** add leftover `plan_checksum` onto that bag. Do **not** collapse leftover `{ skipped: true, reason: "environment_disabled" }` into leftover `{ skipped: true, reason: "application_disabled_or_not_due" }` so “one skip owns every gate.” Do **not** copy RingCentral `{ reason: "lease_held" }` onto unpublished **503** so “every cron maps overlap.” Do **not** add leftover workbook ids / leftover command payloads onto the **202** so “the owner can open the sheet from the cron body.” Do **not** add leftover `queue_published: false` onto a **202** so “this desk matches leftover Owner preview.”

Leave leftover `ensureBestRelocationConnection` / leftover `oldestRecoverableIngestionRun` / leftover `claimDueBestRelocationConnection` / leftover `createQueuedIngestionRun` on already-recommended leftover `repository.ts`. Leave leftover `publishIngestionWakeup` on already-recommended leftover `queue.ts`. Leave leftover `runBestRelocationIngestionWorker` on already-recommended leftover `worker.ts`. Leave leftover `createBestRelocationIngestionActor` on already-recommended leftover `actors.ts`. Leave leftover Owner HMAC on already-recommended leftover `ingestion.routes.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// best-relocation-ingestion-cron.routes.ts
// Vercel just woke us every six hours — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// Open Mongo and plant or find the one Best Relocation connection.
// If BEST_RELOCATION_INGEST_ENABLED is not true, answer skipped environment_disabled.
// If a stranded queued or expired-lease run exists, poke the worker as recovery.
// Unpublished recovery is 503 and we stop before the stale letter and the due claim.
// If application is on and there has been no successful run in thirty hours,
// write success_stale and wait for that letter.
// Then try to claim the connection when cadence is due.
// If we cannot, answer skipped application_disabled_or_not_due.
// If we claimed, insert a queued schedule run and poke the worker.
// Unpublished schedule is 503 — the queued row already stands.
// Published is 202 with run_id.
// Do not claim the five-minute apply lease.
// Do not inspect sheets.
// Do not walk the plan.
// Do not discard an unpublished wakeup the way Owner HTTP does.
// Do not compare x-api-secret.

export default acceptThisBestRelocationIngestHeartbeatCronDesk()
export const envGateEnabled = bestRelocationIngestEnvGateIsOn
export const ingestionHeartbeatSkipReason = nameWhyThisBestRelocationHeartbeatWouldSkip

function acceptThisBestRelocationIngestHeartbeatCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/best-relocation-ingest-heartbeat",
    proveThisCronTickIsOurs,
    wakeThisBestRelocationIngestHeartbeatOverHttp,
  )
  return desk
}

// ── 1. Wake this Best Relocation ingest heartbeat ─────────

async function wakeThisBestRelocationIngestHeartbeatOverHttp(_req, res) {
  const now = new Date()
  const actor = nameThisHeartbeatAsTheBestRelocationSystemSpeaker(now)
  try {
    await openMongoForThisHeartbeat()
    const connection = await plantOrFindTheBestRelocationConnection(actor)
    if (!bestRelocationIngestEnvGateIsOn()) {
      return thisHeartbeatSkippedBecauseTheEnvGateIsOff(res)
    }
    const strandedId = await findTheOldestStrandedIngestionRun(now)
    if (strandedId) {
      const recovered = await pokeTheWorkerToRecoverThisStrandedRun(strandedId)
      if (!recovered) return recoveryWakeupCouldNotBePublished(res, strandedId)
    }
    if (applicationIsOnAndSuccessIsOlderThanThirtyHours(connection, now)) {
      await writeThatBestRelocationSuccessIsStale(connection) // await, not void
    }
    const claim = await claimTheBestRelocationConnectionWhenCadenceIsDue(now, actor)
    if (!claim) return thisHeartbeatSkippedBecauseApplicationIsOffOrNotDue(res)
    const queued = await queueAScheduleRunForTheClaimedConnection(claim, actor, now)
    const published = await pokeTheWorkerForThisScheduleRun(queued.run_id)
    if (!published) return scheduleWakeupCouldNotBePublished(res, queued.run_id)
    return theScheduleRunWasQueuedAndTheWorkerWasPoked(res, queued, claim)
  } catch (error) {
    return heartbeatFailedAndMayEchoTheMessage(res, error)
  }
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) return cronIsMisconfigured(res) // "CRON_SECRET is not set"
  if (bearerMatches(req, expected) || headerSecretMatches(req, expected)) {
    return next()
  }
  return refuseAnUnauthorizedCronTick(res)
}

function bestRelocationIngestEnvGateIsOn(value = process.env.BEST_RELOCATION_INGEST_ENABLED) {
  return value?.trim().toLowerCase() === "true"
}

function nameWhyThisBestRelocationHeartbeatWouldSkip(input) {
  if (!input.env_enabled) return "environment_disabled"
  if (!input.application_enabled) return "application_disabled"
  if (input.next_due_at && input.next_due_at.getTime() > input.now.getTime()) return "not_due"
  return null
}
```

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500 `"CRON_SECRET is not set"`, not 401, and writes no letter. A mismatch is 401. Open Mongo and plant the one connection. Env off is 200 `environment_disabled` after that plant. A stranded run gets a recovery poke; unpublished is 503 and skips stale + claim. Published recovery continues. Application on and no success in thirty hours writes `success_stale` and waits. Claim miss is 200 `application_disabled_or_not_due`. Claim hit queues `schedule` and pokes; unpublished is 503 with the row already saved; published is 202. Do not claim the apply lease. Do not inspect sheets. Do not walk the plan. Do not discard an unpublished wakeup. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/best-relocation-ingest-heartbeat")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge and the leftover test title say “skips before source reads when gates are off.” HTTP plants the connection first.** Leftover `connectMongo` + leftover `ensureBestRelocationConnection` run **before** leftover `envGateEnabled`. Env-off still leftover upserts leftover `best_relocation` and leftover `$set`s leftover `updated_actor` as leftover `heartbeat:<iso>`. There is **no** Google read on this desk either way — “source reads” means leftover sheets, not Mongo. Do not move leftover ensure after the gate so “disabled never plants” without a paired HTTP proof that leftover Owner GET leftover `findOne` still paints a synthetic empty connection when no row exists. Do not skip leftover `connectMongo` on env-off so “this desk matches leftover notification cron” without a paired proof that leftover ensure is gone too.

2. **Leftover `ingestionHeartbeatSkipReason` is unused by HTTP.** Leftover `ingestion.test.ts` units leftover `environment_disabled` / leftover `application_disabled` / leftover `not_due`. The handler leftover collapses leftover application-off and leftover not-due into leftover `application_disabled_or_not_due` after leftover `claimDue` returns leftover `null`. Leftover claim also leftover requires leftover `application_enabled_actor` leftover `$ne: null` — the helper never names that. Do not start leftover **asking** the helper on the route so “HTTP matches the test” without a paired proof that leftover `application_enabled: true` + leftover null leftover actor still leftover 200s the same leftover collapsed reason (leftover claim leftover null). Do not split leftover HTTP leftover `application_disabled` vs leftover `not_due` so “the helper wins” without a paired product decision. Keep the export as an alias until the leftover unit test migrates onto HTTP.

3. **Published recovery continues into stale + claim.** Unpublished recovery **503**s and leftover **exits**. Published recovery leftover **does not** leftover return — one tick may leftover poke leftover `recovery` **and** leftover queue leftover `schedule` **and** leftover poke leftover `schedule`. Leftover consumer leftover ignores leftover `run_hint` and leftover claims leftover approved leftover applying first, then leftover queued. Do not leftover return **200** `{ recovered: true }` after a published recovery so “one tick owns one poke” without a product decision. Do not leftover skip leftover claim when leftover recovery leftover published so “stranded work owns the six hours.”


4. **Unpublished wakeup is 503; Owner HTTP discards the boolean and still 202.** Wave A `publishIngestionWakeup` never throws; a local or non-hosted host returns `false` (two-env publish gate). Env-on plus a stranded run **503**s locally. Env-on plus a due claim **inserts** the `queued` row **then 503**s. Env-off is **200** skipped (no poke). Do not discard the boolean so “this desk matches preview.” Do not skip `createQueuedIngestionRun` until publish succeeds so “no orphan queued row” without a paired recover proof that Mongo still owns the run when Vercel is down.

5. **Stale letter is 30 hours, not `cadence_hours`.** Connection cadence is 24 or 48. A 48-hour host writes `success_stale` at 30 hours even when `next_due_at` is still in the future (claim will skip). Missing `last_successful_run_at` also writes when `application_enabled`. Wave A worker stamps `last_successful_run_at` on completed apply. Do not change 30 hours to `cadence_hours` so “one clock owns stale” without a product decision. Do not skip the letter when `next_due_at > now` so “not-due is quiet.”

6. **This desk awaits `recordOperationalEvent`. Already-recommended notification cron voids.** The stale letter **blocks** the heartbeat JSON until Mongo persist and leftover policy return. Auth fail writes **no** letter. Unexpected throw writes **no** letter. Wave A health never names `success_stale`. The letter is `notificationCandidate: true`, `category: "cron"`, `workflow: "best_relocation_ingestion"`. Do not void the stale letter so “this desk matches notification cron” without a paired proof that Owner email still fires after **202**. Do not ask `emitIngestionHealthSignal` so “one health file owns stale.”

7. **Route 500 may echo `error.message`.** Already-recommended Lead Messaging / Sheet Sync / notification do the same. Already-recommended CPL **500**s generic `CPL_CORRECTION_DRAIN_FAILED`. Already-recommended Owner ingestion desk `sendError` **never** echoes `error.message` (**500** `"Ingestion request failed"`). Do not sanitize this 500 so “this desk matches Owner hide” without a paired HTTP proof that operators still do not see workbook ids or customer rows on the cron JSON. The **503** strings are already generic.

8. **`envGateEnabled` lives here; the worker copies `deploymentGateEnabled`.** Same `BEST_RELOCATION_INGEST_ENABLED === "true"` fold. Owner desk **imports this export**. The worker does not. Do not import `envGateEnabled` into `worker.ts` so “one helper owns both trees” — Wave A already locked the twin. Do not move the export onto `ingestion.routes.ts` in this rename.

9. **Cadence CAS is 24/48 hours; Vercel ticks every six hours.** `vercel.json` is `0 */6 * * *`. Claim `$set`s `next_due_at` = now + `cadence_hours`. The six-hour tick recovers stranded work between due claims. Do not change Vercel to `0 */24 * * *` so “cron matches cadence.” Do not ask `claimDue` every six hours without the CAS fence.

10. **`requireCronAuth` is a copy of sibling crons, without letters.** Rematch / RingCentral / Sheet Sync / Lead Messaging / CPL use the same Bearer-or-header 500/401 and do **not** write `cron.auth.failed`. Notification **does**. Missing-secret copy is `"CRON_SECRET is not set"` (matches Lead Messaging / Sheet Sync / rematch; CPL says `"is not configured"`). Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy. IDEAS already parked that extract.

11. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. There is **no** `best-relocation-ingestion-cron.routes.test.ts`. Do not add `createBestRelocationIngestionCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

12. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

13. **This desk never claims the apply lease, never inspects sheets, and never walks the plan.** Wave A worker **asks** `ingestion:best_relocation:apply`. Owner `POST .../inspect` **asks** `inspectBestRelocationSources`. `applyBestRelocationPlan` lives on Wave A. This file **asks** plant / recover / poke / claim / queue. Do not **ask** `runBestRelocationIngestionWorker` from this file so “the safety net also applies.” Do not merge this router into Owner `ingestion/*` so “one file owns every ingest start.”

14. **Owner HTTP uses `x-api-secret` + HMAC; this tick uses `CRON_SECRET`.** `app.ts` mounts **before** `v1Routes` and **before** `ingestionRoutes`. Do not remount `requireApiSecret` so “it matches Owner preview.” Do not hide this ALL behind Owner HMAC so “someone must be an Owner.”

15. **`reason: "cron"` is unused.** Wave A poke union includes `cron`. This file **asks** `recovery` then `schedule`. Do not start `reason: "cron"` so “the union wins.”

16. **Host tables and `hit-vantage-api` omit `/api/cron/best-relocation-ingest-heartbeat` and list Owner `/admin/ingestion/*`.** That skill is leftover `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount leftover `requireApiSecret` so “the host table wins.”

17. **There is no HTTP harness today.** No `best-relocation-ingestion-cron.routes.test.ts`. Leftover `ingestion.test.ts` units `envGateEnabled` / `ingestionHeartbeatSkipReason` and never HTTP the cron. `vercel.json` `0 */6 * * *` is the cadence proof. Keep handshake + env skip after plant + unpublished recovery 503 + published recovery continues + unpublished schedule 503 after queue at this **interface**. Worker claim / apply walk / Owner HMAC stay on already-recommended Wave A / Owner desk tests unless a later factory inject exists with a live-default proof.

18. **Leave sibling modules alone.** `ensureBestRelocationConnection` / `oldestRecoverableIngestionRun` / `claimDueBestRelocationConnection` / `createQueuedIngestionRun` / `publishIngestionWakeup` are already the right **depth**. This file orchestrates the HTTP **adapter**.

19. **Do not treat Wave A worker / Wave A apply / Wave A health / Owner HMAC preview / Sheet Sync drain / Lead Messaging drain / CPL drain / notification letter / Call Log sweep / next reporting heartbeat as this story.** Next `reporting-cron.routes.ts` is the reporting desk tick. Do not inspect a Lead / Booking / Cancellation from this file. Do not honor HTTP `repair_identity`. Do not rename persisted leftover `best_relocation_ingestion.success_stale` / leftover `queued` / leftover trigger `schedule`.

## Testing

The **interface** is the test surface: `bestRelocationIngestHeartbeatCronDesk` (mounted on `app.ts` **after** Twilio desks / already-recommended notification cron, **before** next reporting cron / leftover Owner ingestion desk as the default export), leftover `envGateEnabled` (Owner desk + leftover unit test), leftover `ingestionHeartbeatSkipReason` (leftover unit test until it migrates), and the one HTTP operation above.

Today there is **no** `best-relocation-ingestion-cron.routes.test.ts`. Add one file that mounts the live default. Keep handshake + env-off plant + recovery 503 + schedule 202 at the same **interface** (do not invent a factory so the test can no longer see the live Wave A default):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"` and does **not** **ask** leftover `cron.auth.failed`.
- Bearer mismatch **401** `"Unauthorized"` and does **not** **ask** leftover `cron.auth.failed`.
- Matching `x-cron-secret` reaches leftover `connectMongo`.
- leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` are **not** accepted here.

**Wake the heartbeat — never claim the apply lease here**
- Env off **200** `{ ok: true, skipped: true, reason: "environment_disabled" }` **after** leftover `ensureBestRelocationConnection`. Prove leftover `oldestRecoverableIngestionRun` / leftover `claimDue` / leftover `publishIngestionWakeup` are **not asked**.
- Env on, stranded run, unpublished poke **503** `{ run_id }` and **does not ask** leftover stale letter / leftover `claimDue`.
- Env on, stranded run, published poke **continues** into leftover stale (if due) then leftover claim.
- Env on, `application_enabled`, `last_successful_run_at` older than 30 hours **awaits** leftover `best_relocation_ingestion.success_stale` with leftover `notificationCandidate: true` even when leftover claim later skips.
- Leftover claim miss **200** `{ ok: true, skipped: true, reason: "application_disabled_or_not_due" }` — not leftover `application_disabled` / leftover `not_due`.
- Leftover claim hit + published poke **202** `{ ok: true, skipped: false, run_id, next_due_at, queue_published: true }`. Prove leftover `createQueuedIngestionRun` leftover `trigger: "schedule"`.
- Leftover claim hit + unpublished poke **503** with leftover `run_id` — the leftover queued row already stands.
- Unexpected throw **500** `{ error: error.message }` (or `"Ingestion heartbeat failed"`) and **does not ask** leftover `recordOperationalEvent`.
- This beat does **not** **ask** leftover `runBestRelocationIngestionWorker` / leftover `applyBestRelocationPlan` / leftover `inspectBestRelocationSources` / leftover `emitIngestionHealthSignal`.
- Happy **202** / skip **200** / **503** bodies are PII-free (no workbook id / customer row / Bearer / token).

**Cadence**
- `vercel.json` `/api/cron/best-relocation-ingest-heartbeat` is `0 */6 * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(bestRelocationIngestionCronRoutes)` after Twilio desks / notification cron, before reporting cron / leftover `v1Routes` / leftover `ingestionRoutes`.
- Leftover Owner `ingestion/*` stays mounted on already-recommended leftover `ingestion.routes.ts`. Leftover consumer stays `api/queues/best-relocation-ingestion-consumer.ts`.

**Not this file**
- Plant / recover / claim / queue stay on already-recommended [ingestion-repository.md](ingestion-repository.md).
- Wakeup stays on already-recommended [ingestion-queue.md](ingestion-queue.md).
- Worker claim stays on already-recommended [ingestion-worker.md](ingestion-worker.md).
- Apply walk stays on already-recommended [ingestion-apply-plan.md](ingestion-apply-plan.md).
- Health letters stay on already-recommended [ingestion-health.md](ingestion-health.md).
- Owner HMAC stays on already-recommended [routes-ingestion.md](routes-ingestion.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `thisHeartbeatSkippedBecauseTheEnvGateIsOff`, `recoveryWakeupCouldNotBePublished`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

Keep leftover `ingestion.test.ts` helper units only until the HTTP file exists; do not add more helper-only cases.

## What I would not do

- A `BestRelocationIngestionCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, skipped: false, run_id })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `recover.ts` / `schedule.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the plant-then-env-gate **seam**: do not skip leftover `ensureBestRelocationConnection` on env-off so “knowledge’s skip-before-reads becomes a Mongo skip.”
- Breaking the unpublished-503 **seam**: do not discard leftover `publishIngestionWakeup` so “this desk matches Owner preview.”
- Breaking the recovery-then-claim **seam**: do not return after a published recovery so “one tick owns one poke,” and do not claim before recover.
- Breaking the cron-secret **seam**: do not remount leftover `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` here.
- Breaking the await-stale-letter **seam**: do not void leftover `recordOperationalEvent` so “this desk matches notification cron.”
- Treating leftover `runBestRelocationIngestionWorker`, leftover `applyBestRelocationPlan`, leftover `inspectBestRelocationSources`, leftover `emitIngestionHealthSignal`, leftover Owner HMAC preview, rematch, Sheet Sync drain, Lead Messaging drain, CPL drain, notification letter, Call Log sweep, next reporting heartbeat, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / apply-lease / health-emit **adapter** that has only one caller in this pass.
- Silently changing leftover 30 hours to leftover `cadence_hours`, starting leftover `reason: "cron"`, remounting leftover `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `ingestion/*`, importing leftover `envGateEnabled` into leftover `worker.ts`, or renaming persisted leftover `best_relocation_ingestion.success_stale` / leftover trigger `schedule` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
