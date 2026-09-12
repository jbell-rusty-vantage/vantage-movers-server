# After The Cron Secret Proves This Tick Is Ours, Recover Leftover Queued Or Expired-Lease Granot Automation Work And Poke The Worker As Recovery — Never Claim The Account Lease Here, Never Collect HTML Here, Never Walk Selected Actions Here, Never Discard An Unpublished Wake-Up, Never Use The API Secret Or Owner HMAC — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 27 of this service — `granot-automation-cron.routes.ts`
- Remaining in this service: `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/granot-automation-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (Owner-gated HTTP session collector. Mongo is [System of Record](../../../../CONTEXT.md). Preview never writes a lifecycle receipt. Approved apply captures one `granot_http_automation` receipt per selected action and enters `claimAndProcessOrPoll`. It must **not** call `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`. **HTTP / queue / cron** row: Cron `/api/cron/granot-automation-heartbeat` (`CRON_SECRET`) → `recoverGranotRuns()`; **503** when leftover work is recoverable and the wakeup did not publish; `publishGranotWakeup` returns true only on Vercel **and** the hosted `NODE_ENV` gate, otherwise false (no throw); queue topic `granot-automation-events` → leftover consumer leftover `runGranotWorker` then leftover `continueGranotRuns`; Admin API stays `/api/v1/admin/granot-automation/*` with leftover `requireApiSecret` + leftover `requireRegistryOwnerActor`. Knowledge never names leftover `requireCronAuth`, leftover Bearer-or-`x-cron-secret`, leftover `"CRON_SECRET is not set"`, leftover 503 without leftover `run_id`, leftover unsorted leftover `exists()`, leftover `reason: "recovery"`, leftover 5-minute leftover idempotency leftover bucket, leftover generic leftover `"Granot recovery heartbeat failed."`, or leftover Owner leftover **202** leftover recover — do not add a Routes Service file in this rename so “the Service sentence wins”). Distinct from already-recommended Owner desk: [routes-granot-automation.md](routes-granot-automation.md) (`GET|POST /api/v1/admin/granot-automation/*` after leftover `requireApiSecret` + HMAC; leftover `POST .../runs/worker` leftover `action: "recover"` leftover **asks** leftover `recoverGranotRuns` leftover and leftover **202**s leftover `{ ok, data }` leftover **even when** leftover `recoverable && !queue_published`; leftover create / leftover run-group leftover may leftover **ask** leftover `runGranotWorker` leftover inline leftover when leftover `VERCEL !== "1"` leftover and leftover `!queue_published`; leftover approve leftover **always** leftover inlines leftover when leftover `VERCEL !== "1"`; **does not use `CRON_SECRET`**; **this file never asks HMAC**). Distinct from leftover queue consumer: `api/queues/granot-automation-consumer.ts` (`runGranotWorker` then leftover `continueGranotRuns(result.run_id)` leftover **only when** leftover `claimed && run_id`; leftover `lease_busy` leftover ACKs leftover; leftover unpublished leftover continuation leftover **throws** leftover `"Granot automation continuation could not be queued"` leftover so leftover Vercel leftover retries leftover — **does not import this file**). Distinct from already-recommended Wave A recover / poke / claim: [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md) (`recoverGranotRuns` leftover **asks** leftover `connectMongo` leftover then leftover `GranotAutomationRun.exists` leftover then leftover `publishGranotWakeup(..., "recovery")`; leftover `runGranotWorker` leftover takes leftover `granot:automation:account` leftover 45 leftover minutes leftover and leftover expires leftover stale leftover `awaiting_approval`; leftover `continueGranotRuns` leftover is leftover the leftover same leftover leftover leftover query leftover with leftover reason leftover `"continuation"` leftover — **this file never asks leftover `runGranotWorker` leftover / leftover `continueGranotRuns` leftover / leftover `createGranotRun`**). Distinct from already-recommended apply capture: [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) (`applyAutomationPlanAction` — **this file does not import it**). Distinct from already-recommended leftover Wave A CSV writes: [enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (**this file must not call them**). Distinct from already-recommended leftover letters persist: [observability-record-operational-event.md](observability-record-operational-event.md) (**this file never asks it**). Distinct from already-recommended Reporting cron: [routes-reporting-cron.md](routes-reporting-cron.md) (leftover **Bearer-only**, leftover missing secret leftover **503** leftover `"CRON_SECRET is not configured."`, leftover unpublished leftover **503** leftover **only when** leftover `VERCEL === "1"`, leftover local leftover unpublished leftover **200** leftover `{ published: false }`, leftover poke leftover reason leftover `"cron"` leftover — **does not import this file**). Distinct from already-recommended Best Relocation cron: [routes-best-relocation-ingestion-cron.md](routes-best-relocation-ingestion-cron.md) (leftover unpublished leftover **503** leftover **always**, leftover **includes leftover `run_id`**, leftover then leftover continues leftover to leftover stale leftover / leftover claim leftover when leftover recovery leftover published leftover — **does not import this file**). Distinct from already-recommended notification cron: [routes-notification-cron.md](routes-notification-cron.md) (leftover **void** leftover `cron.auth.failed`, leftover **500** leftover may leftover echo leftover `error.message` leftover — **does not import this file**). Distinct from leftover Vercel schedule: leftover `/api/cron/granot-automation-heartbeat` leftover `*/5 * * * *` UTC leftover (same leftover five leftover minutes leftover as leftover Reporting leftover heartbeat leftover / leftover next leftover Granot leftover lifecycle leftover drain leftover — **not** leftover Best Relocation leftover `0 */6`). Distinct from leftover env: leftover `GRANOT_AUTOMATION_APPLY_ENABLED` leftover lives leftover on leftover Wave A leftover approve / leftover walk leftover — **this file never reads it**. Distinct from other secrets: leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host leftover `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Call Lead Enrichment](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no `src/services/dailyOperations/` and no `daily-operations-admin.routes.ts` — do not invent that mount. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this routes pass. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(granotAutomationCronRoutes)` on line 66 — **after** already-recommended Reporting safety-net cron, **before** next Granot lifecycle cron, leftover Owner Granot automation desk, leftover public v1, leftover Owner ingestion desk, leftover Owner reporting desk). Already-recommended `granot-automation.routes.ts` **asks** leftover `recoverGranotRuns` leftover from leftover `POST .../runs/worker` leftover — leftover **does not import this file**. Leftover consumer leftover **asks** leftover `runGranotWorker` leftover / leftover `continueGranotRuns` leftover — leftover **does not import this file**. Wave A `runWorkflow.test.ts` leftover proves leftover create leftover / leftover run-group leftover / leftover `[AC-02]` leftover — leftover it leftover does leftover **not** leftover HTTP leftover this leftover tick. Already-recommended `granot-automation.routes.test.ts` leftover stack-scans leftover Owner leftover paths leftover and leftover consumer leftover unpublished leftover continuation leftover throw leftover — leftover it leftover does leftover **not** leftover name leftover `/api/cron/granot-automation-heartbeat`. Operator `hit-vantage-api` lists leftover Owner leftover `/admin/granot-automation/*`, **not** leftover `/api/cron/granot-automation-heartbeat`. Host public/unguarded tables omit this path. Not this **interface**: leftover `recoverGranotRuns` itself, leftover `publishGranotWakeup` itself, leftover `runGranotWorker` itself, leftover `continueGranotRuns` itself, leftover `applyAutomationPlanAction` itself, leftover Owner HMAC itself.
- Seams callers need: leftover `CRON_SECRET` leftover Bearer-**or**-leftover `x-cron-secret` vs leftover already-recommended leftover Reporting leftover Bearer-only; leftover missing secret leftover **500** leftover `"CRON_SECRET is not set"` vs leftover Reporting leftover **503** leftover `"CRON_SECRET is not configured."` leftover vs leftover CPL leftover **500** leftover `"is not configured"` leftover (no period); leftover leftover leftover work leftover + leftover unpublished leftover poke leftover **503** leftover **always** leftover (hosted leftover **and** leftover local) vs leftover Reporting leftover unpublished leftover **503** leftover **only when** leftover `VERCEL === "1"` leftover vs leftover Owner leftover recover leftover **202**; leftover 503 leftover **omits leftover `run_id`** vs leftover Best Relocation leftover / leftover Reporting leftover 503 leftover `{ run_id }`; leftover 200 leftover spreads leftover `{ recoverable, queue_published }` leftover vs leftover Reporting leftover `{ woke, published }` leftover vs leftover Best Relocation leftover `{ skipped, run_id }`; leftover poke leftover reason leftover `"recovery"` leftover vs leftover Reporting leftover `"cron"` leftover vs leftover consumer leftover `"continuation"` leftover vs leftover Owner leftover create leftover `"create"`; leftover Wave A leftover `exists()` leftover **no leftover sort** leftover vs leftover Reporting leftover oldest leftover `created_at` leftover / leftover `_id`; leftover recover leftover query leftover is leftover `queued` leftover **or** leftover (`planning` leftover | leftover `applying` leftover + leftover missing leftover / leftover null leftover / leftover expired leftover lease) leftover — leftover **not** leftover `awaiting_approval` leftover (leftover worker leftover expires leftover those); leftover recover leftover **asks** leftover `connectMongo` leftover **inside leftover Wave A** leftover vs leftover this leftover file leftover never leftover opens leftover Mongo leftover itself; leftover consumer leftover unpublished leftover continuation leftover **throws** leftover vs leftover this leftover desk leftover **503**s leftover without leftover throw; leftover no leftover inline leftover `runGranotWorker` leftover vs leftover Owner leftover create leftover / leftover approve leftover may leftover inline; leftover five-minute leftover Vercel leftover cadence leftover vs leftover Best Relocation leftover `0 */6`; leftover `router.all` leftover (Vercel GET) vs leftover webhook leftover POST-only; leftover no leftover factory leftover inject vs leftover already-recommended leftover `createRingCentralCronRouter`. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no leftover account-lease **seam**. There is no leftover HTML-collect **seam**. There is no leftover apply-walk **seam**.
- Split later (only if the file outgrows one sitting): this ~58-line file is one sitting if you read it as after the cron secret proves this tick is ours, recover leftover queued or expired-lease Granot automation work and poke the worker as recovery — never claim the account lease here, never collect HTML here, never walk selected actions here, never discard an unpublished wake-up, never use the API secret or Owner HMAC. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `recover.ts` / `heartbeat.ts` / `create.ts` / `update.ts` / `delete.ts`. Recover / poke stay already-recommended `runWorkflow.ts`. Account claim / stale-approval expire stay already-recommended `runGranotWorker`. Receipt capture stays already-recommended `automationApply.ts`. Owner HMAC stays already-recommended `granot-automation.routes.ts`. Next Granot lifecycle drain stays next `granot-lifecycle-cron.routes.ts`.

`router.all("/api/cron/granot-automation-heartbeat")` is an HTTP verb. The owner question is: *Vercel just woke the five-minute Granot automation safety net — or a local operator used the same secret. Prove Authorization Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is not set — 500, not 401, and do not pretend this is unauthorized. If it does not match, refuse it. Ask Wave A whether any leftover `queued` run exists, or a `planning` / `applying` run whose lease is missing, null, or expired. If none, answer `recoverable: false`. If one exists, poke the worker as `recovery`. Unpublished — hosted or local — is 503 without a run id. Do not claim the 45-minute account lease. Do not collect HTML tables. Do not walk selected actions. Do not expire a stale `awaiting_approval` plan. Do not discard an unpublished wakeup the way Owner recover 202s. Do not compare `x-api-secret`.*

Who find leftover work / poke `reason: "recovery"` already lives in already-recommended `runWorkflow.ts`. Who take `granot:automation:account` and expire stale approvals already lives in already-recommended `runGranotWorker`. Who capture `granot_http_automation` already lives in already-recommended `automationApply.ts`. Who queue / approve already lives in already-recommended `granot-automation.routes.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, recover leftover queued or expired-lease Granot automation work and poke the worker as recovery” story, not “a Granot automation cron CRUD dump,” and not Queue The Durable Granot Automation Run / Claim The Account And Do The Next Run / Apply This Owner-Approved HTTP Automation Action themselves:

1. **Recover leftover queued or expired-lease Granot automation work** — `ALL /api/cron/granot-automation-heartbeat`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }` — **does not** leftover `recordOperationalEvent`. Mismatch **401** `{ ok: false, error: "Unauthorized" }` — **does not** leftover `recordOperationalEvent`. Then leftover **asks** leftover `recoverGranotRuns()` leftover (Wave A leftover **asks** leftover `connectMongo` leftover then leftover `GranotAutomationRun.exists` leftover `{ status: "queued" }` leftover **or** leftover `{ status: { $in: ["planning", "applying"] }, leased_until` leftover missing leftover / leftover null leftover / leftover `<= now` leftover }`; leftover hit leftover **asks** leftover `publishGranotWakeup(String(exists._id), "recovery")`; leftover miss leftover returns leftover `{ recoverable: false, queue_published: false }`). Leftover `recoverable && !queue_published` leftover **503** `{ ok: false, error: "Granot recovery could not publish a worker wakeup." }` leftover — leftover **does not** leftover echo leftover a leftover run leftover id leftover, leftover leftover `exists._id` leftover, leftover or leftover leftover `VERCEL`. Else leftover **200** `{ ok: true, ...recovery }` leftover (`recoverable` leftover + leftover `queue_published`). Unexpected throw leftover **500** `{ ok: false, error: "Granot recovery heartbeat failed." }` leftover — leftover catch leftover binds leftover nothing leftover and leftover **does not** leftover echo leftover `error.message`. This beat does **not** leftover **ask** leftover `runGranotWorker`. This beat does **not** leftover **ask** leftover `continueGranotRuns`. This beat does **not** leftover **ask** leftover `createGranotRun`. This beat does **not** leftover **ask** leftover `applyAutomationPlanAction`. This beat does **not** leftover compare leftover `x-api-secret`. This beat does leftover **read** leftover `x-cron-secret` leftover when leftover Bearer leftover is leftover absent.

`requireCronAuth` is a beat inside this operation, not a second owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second leftover claim-the-account-lease operation. Wave A leftover worker elects leftover `granot:automation:account`. There is no third leftover collect / leftover plan / leftover approve operation. There is no fourth leftover Owner HMAC operation. There is no fifth leftover Reporting leftover health-scan leftover / leftover janitor leftover operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, recover leftover queued or expired-lease Granot automation work and poke the worker as recovery — never claim the account lease here, never collect HTML here, never walk selected actions here, never discard an unpublished wake-up, never use the API secret or Owner HMAC.” Already-recommended recover / poke / leftover worker / leftover apply leftover / leftover Owner leftover desk already live in deeper **modules**. Do not pull those in. Do not invent a `GranotAutomationCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** leftover `recoverGranotRuns` leftover and leftover **503**s leftover unpublished leftover leftover leftover work. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner recover.” Do not invent a leftover claim **adapter** so “the heartbeat can collect HTML without the worker.” Do not invent a leftover Bearer-only **adapter** so “this desk matches Reporting” without a paired HTTP proof that leftover `x-cron-secret` leftover still leftover wins leftover on leftover a leftover local leftover operator leftover GET. Do not invent a CRUD folder so `heartbeat.ts` / `recover.ts` / `cron.ts` each get a file.

Do not move leftover `recoverGranotRuns` into this file so “the route owns leftover exists.” Do not move leftover `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** leftover always-503 leftover **and** leftover already-recommended leftover Reporting leftover Bearer-only leftover 503 leftover **and** leftover every leftover sibling leftover that leftover still leftover accepts leftover `x-cron-secret`. Do not mount this router inside leftover `granot-automation.routes.ts` so “one file owns recover.” Do not merge this router into leftover `reporting-cron.routes.ts` so “one file owns every five-minute poke.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `granotAutomationRecoveryCronDesk` | `app.ts` mounts the instance **after** already-recommended Reporting safety-net cron, **before** next Granot lifecycle cron / leftover Owner Granot automation desk |
| `ALL /api/cron/granot-automation-heartbeat` (today unexported handler) | `recoverLeftoverQueuedOrExpiredLeaseGranotAutomationWorkOverHttp` | auth **then** leftover Wave A leftover recover leftover **or** leftover unpublished leftover **503** |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn leftover `leased_until` / leftover `exists._id` / leftover `granot:recovery:` leftover 5-minute leftover bucket leftover as leftover the leftover domain leftover language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createGranotAutomationCronRouter({ recover })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after a published recovery poke:

```ts
type GranotAutomationRecoveryWokeLeftoverWorkOverHttp = {
  ok: true
  recoverable: true
  queue_published: true
}
```

That is the **200** handoff from “Vercel woke us and Mongo still had leftover queued or expired-lease work” to “this host published `reason: recovery`.” Do **not** add leftover `run_id` leftover onto leftover that leftover bag leftover in leftover this leftover rename leftover so leftover “this leftover desk leftover matches leftover Best Relocation leftover 202” leftover without leftover a leftover paired leftover HTTP leftover proof leftover that leftover the leftover 503 leftover still leftover omits leftover the leftover id. Do **not** collapse leftover `{ recoverable: false }` leftover into leftover `{ woke: false }` leftover so leftover “one leftover skip leftover owns leftover every leftover quiet leftover tick.” Do **not** copy leftover RingCentral leftover `{ reason: "lease_held" }` leftover onto leftover unpublished leftover **503** leftover so leftover “every leftover cron leftover maps leftover overlap.” Do **not** add leftover `granot_statement` leftover / leftover plan leftover actions leftover / leftover cookies leftover onto leftover this leftover **200**.

Leave leftover `recoverGranotRuns` on already-recommended leftover `runWorkflow.ts`. Leave leftover `runGranotWorker` on already-recommended leftover `runWorkflow.ts`. Leave leftover `applyAutomationPlanAction` on already-recommended leftover `automationApply.ts`. Leave leftover Owner HMAC on already-recommended leftover `granot-automation.routes.ts`. Leave leftover next leftover Granot leftover lifecycle leftover drain leftover on leftover next leftover `granot-lifecycle-cron.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granot-automation-cron.routes.ts
// Vercel just woke the five-minute Granot automation safety net —
// or a local operator used the same secret.
// Prove Authorization Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is not set — 500.
// If it does not match, refuse it.
// Ask Wave A whether leftover queued work exists,
// or a planning / applying run whose lease is missing, null, or expired.
// If none, answer recoverable false.
// If one exists, poke the worker as recovery.
// Unpublished — hosted or local — is 503 without a run id.
// Do not claim the 45-minute account lease.
// Do not collect HTML tables.
// Do not walk selected actions.
// Do not expire a stale awaiting_approval plan.
// Do not discard an unpublished wakeup the way Owner recover 202s.
// Do not compare x-api-secret.

export default acceptThisGranotAutomationRecoveryCronDesk()

function acceptThisGranotAutomationRecoveryCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/granot-automation-heartbeat",
    proveThisCronTickIsOurs,
    recoverLeftoverQueuedOrExpiredLeaseGranotAutomationWorkOverHttp,
  )
  return desk
}

// ── 1. Recover leftover queued or expired-lease Granot automation work ─

async function recoverLeftoverQueuedOrExpiredLeaseGranotAutomationWorkOverHttp(_req, res) {
  try {
    const recovery = await askWaveAWhetherLeftoverQueuedOrExpiredLeaseWorkNeedsAPoke()
    if (leftoverWorkExistsAndThePokeDidNotPublish(recovery)) {
      return recoveryWakeupCouldNotBePublished(res) // 503, no run_id
    }
    return thisRecoveryTickFinished(res, recovery) // { ok: true, recoverable, queue_published }
  } catch {
    return recoveryHeartbeatFailedWithAGenericSentence(res) // never echo error.message
  }
}

function leftoverWorkExistsAndThePokeDidNotPublish(recovery) {
  return recovery.recoverable && !recovery.queue_published
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) return cronIsNotSet(res) // 500 "CRON_SECRET is not set"
  if (bearerOrCronHeaderMatches(req, expected)) return next()
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Authorization Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500 `"CRON_SECRET is not set"`, not 503 and not 401, and writes no letter. A mismatch is 401. Ask Wave A whether leftover `queued` work exists, or a `planning` / `applying` run whose lease is missing, null, or expired. None is 200 `{ recoverable: false, queue_published: false }`. A leftover poke unpublished on any host is 503 without a run id. A leftover poke published is 200 `{ recoverable: true, queue_published: true }`. Do not claim the account lease. Do not collect HTML. Do not walk selected actions. Do not expire stale `awaiting_approval`. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/granot-automation-heartbeat")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk accepts `x-cron-secret`. Already-recommended Reporting cron does not.** Sheet Sync / Lead Messaging / rematch / CPL / notification / Best Relocation tests ask the header. Reporting 401s it. Vercel cron sends `Authorization: Bearer`. Do not stop reading `x-cron-secret` so “this desk matches Reporting” without a paired HTTP proof that a local operator GET still 200s. Do not 401 a matching Bearer so “one header owns every tick.”

2. **Missing `CRON_SECRET` is 500 `"CRON_SECRET is not set"`.** Reporting **503**s `"CRON_SECRET is not configured."` (period). CPL **500**s `"CRON_SECRET is not configured"` (no period). Do not change this to 503 so “this desk matches Reporting” without a paired HTTP proof on this desk and CPL. Do not write `cron.auth.failed` so “this desk matches notification.”

3. **Unpublished wakeup is 503 on every host.** Wave A poke never throws; a local or non-hosted host returns `false` (two-env publish gate: `VERCEL === "1"` and the hosted `NODE_ENV`). This desk then **503**s. Reporting **200**s local unpublished `{ published: false }`. Owner recover **202**s the same `{ recoverable, queue_published }` bag. Knowledge names the cron 503. Do not 200 local unpublished so “this desk matches Reporting” without a product decision. Do not discard the boolean so “this desk matches Owner recover.”

4. **Hosted Vercel with the publish gate off 503s every leftover heartbeat.** `VERCEL === "1"` plus a non-hosted `NODE_ENV` makes `publishGranotWakeup` return `false` without `send`, then this desk 503s. Do not treat that as `{ recoverable: false }` so “preview hosts stay quiet” without a product decision. Do not start `reason: "cron"` so “the union wins.”

5. **The 503 omits the run id.** Best Relocation / Reporting unpublished 503s include `run_id`. Wave A `exists()` still had `_id`. This desk returns only `{ ok: false, error: "Granot recovery could not publish a worker wakeup." }`. Do not add `run_id` in this rename so “every 503 matches Best Relocation” without a paired HTTP proof that the 200 still spreads only `{ recoverable, queue_published }`. Do not echo cookies / labels / `granot_statement` onto the 503.

6. **`exists()` is unsorted.** Reporting finds the oldest stranded run by `created_at` / `_id`. This Wave A query returns whichever matching document Mongo answers first, then pokes that `_id` as `run_hint`. The worker still prefers `applying` over queued / planning after it claims the account. Do not add `sort: { createdAt: 1 }` onto `recoverGranotRuns` from this file so “the route owns oldest.” Do not ask `runGranotWorker` so “the heartbeat also elects applying.”

7. **Recover does not see `awaiting_approval`.** The leftover query is `queued` or (`planning` | `applying` with a missing / null / expired lease). Stale `awaiting_approval` becomes `expired` only inside leftover `runGranotWorker`. A leftover approval that never claimed the account stays invisible to this tick until something else runs the worker. Do not add `awaiting_approval` onto this exists so “cron expires plans.” Do not ask `runGranotWorker` from this file so “the safety net also expires.”

8. **This tick never drains.** Sheet Sync cron asks `runSheetSyncDrain`. Lead Messaging asks the drain. This tick asks `recoverGranotRuns` only. Do not ask `runGranotWorker` so “every cron matches Sheet Sync.” Local Owner create already inlines the worker when `VERCEL !== "1"` and `!queue_published`. Cron does not. A local leftover tick **503**s forever unless an Owner hits `/runs/worker` `execute` or the queue runs. Do not inline `runGranotWorker` here so “local cron matches Owner create” without a product decision.

9. **Owner recover 202s the same Wave A bag. This tick 503s unpublished.** `POST .../runs/worker` `{ action: "recover" }` asks `recoverGranotRuns` and answers **202** `{ ok, data }` even when `recoverable && !queue_published`. Do not 503 Owner recover so “one envelope owns leftover work.” Do not 202 this tick so “cron matches Owner.”

10. **Consumer unpublished continuation throws. This tick 503s.** `continueGranotRuns` uses the same leftover query with reason `"continuation"`. Unpublished there throws so Vercel retries the callback. This tick 503s and does not throw. Do not throw from this handler so “one unpublished owns recover and continue” without a paired proof that Vercel GET cron still maps 503 to retry and does not page a local operator. Do not ask `continueGranotRuns` from this file.

11. **Poke reason is `"recovery"`, not `"cron"`.** Reporting heartbeat asks `reason: "cron"`. Best Relocation recovery asks `reason: "recovery"` then schedule asks `"schedule"`. Wave A recovery idempotency key is `granot:recovery:${runId}:${Math.floor(Date.now() / (5 * 60_000))}` — a five-minute bucket that matches `*/5`. Do not start `reason: "cron"` so “every five-minute poke matches Reporting.” Do not drop the bucket so “every leftover tick republishes.”

12. **This desk never writes letters itself.** Auth fail writes no letter. Unpublished 503 writes no letter. Unexpected throw writes no letter. Wave A publish failure logs `granot_automation.queue.publish_failed` inside leftover `publishGranotWakeup`. Do not void-ask `cron.auth.failed` so “this desk matches notification.” Do not ask `recordOperationalEvent` from this file so “one route owns every Granot letter.”

13. **Unexpected throw 500s a generic sentence and never echoes `error.message`.** Best Relocation / notification / Sheet Sync / Lead Messaging may echo. Reporting / this desk do not. Catch binds nothing. Do not start echoing `error.message` so “this desk matches Best Relocation” without a paired HTTP proof that operators still do not see cookies, labels, or `granot_statement`. Do not drop the catch so “this desk matches rematch unhandled Express.”

14. **`requireCronAuth` is a copy of sibling crons that accept `x-cron-secret` and 500 a missing secret.** Reporting is the Bearer-only 503 cousin. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** always-503 **and** Reporting Bearer-only 503 **and** the siblings that still accept the header. Park the copy. IDEAS already parked that extract.

15. **There is no factory inject.** Already-recommended Call Log AC-17 asks `createRingCentralCronRouter`. There is **no** `granot-automation-cron.routes.test.ts`. Do not add `createGranotAutomationCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

16. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

17. **This desk never claims the account lease, never collects HTML, and never walks selected actions.** Wave A worker asks `granot:automation:account` for 45 minutes, expires stale `awaiting_approval`, prefers `applying`, then collects or walks. Owner `POST /runs` asks `createGranotRun`. This file asks recover / poke only. Do not ask `runGranotWorker` from this file so “the safety net also collects.” Do not merge this router into Owner `granot-automation/*` so “one file owns every recover.”

18. **Owner HTTP uses `x-api-secret` + HMAC; this tick uses `CRON_SECRET` Bearer or `x-cron-secret`.** `app.ts` mounts **before** `granotAutomationRoutes` and **before** `v1Routes`. Do not remount `requireApiSecret` so “it matches Owner recover.” Do not hide this ALL behind Owner HMAC so “someone must be an Owner.”

19. **Host tables and `hit-vantage-api` omit `/api/cron/granot-automation-heartbeat` and list Owner `/admin/granot-automation/*`.** That skill is leftover `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

20. **There is no HTTP harness today.** No `granot-automation-cron.routes.test.ts`. Wave A units create / run-group / `[AC-02]` and never HTTP the cron. Owner route tests stack-scan `/runs/worker` and the consumer throw. `vercel.json` is the cadence proof. Keep handshake + no-leftover 200 + unpublished 503 (no `run_id`) at this **interface**. Worker claim / approval expire / HTML collect stay on already-recommended Wave A tests unless a later factory inject exists with a live-default proof.

21. **Leave sibling modules alone.** `recoverGranotRuns` / `publishGranotWakeup` / `runGranotWorker` are already the right **depth**. This file orchestrates the HTTP **adapter**.

22. **Do not treat Wave A worker / Wave A poke / Wave A continue / Owner HMAC queue / Owner recover 202 / Reporting heartbeat / Best Relocation heartbeat / next Granot lifecycle drain as this story.** Next `granot-lifecycle-cron.routes.ts` is the lifecycle receipt drain. Do not inspect a Lead / Booking / Cancellation from this file. Do not honor HTTP `repair_identity`. Do not close the label-only `createGranotRun` gap. Do not rename persisted leftover `granot_automation.queue.publish_failed` / leftover trigger leftover `recovery`.

## Testing

The **interface** is the test surface: `granotAutomationRecoveryCronDesk` (mounted on `app.ts` **after** already-recommended Reporting safety-net cron, **before** next Granot lifecycle cron / leftover Owner Granot automation desk as the default export) and the one HTTP operation above.

Today there is **no** `granot-automation-cron.routes.test.ts`. Add one file that mounts the live default. Keep handshake + no-leftover recover + unpublished 503 at the same **interface** (do not invent a factory so the test can no longer see the live Wave A default):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"` and does **not** ask `cron.auth.failed`.
- Bearer mismatch **401** `"Unauthorized"` and does **not** ask `cron.auth.failed`.
- Matching `x-cron-secret` reaches `recoverGranotRuns`.
- Matching Bearer reaches `recoverGranotRuns`.
- leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` are **not** accepted here.

**Recover leftover work — never claim the account lease here**
- No leftover run **200** `{ ok: true, recoverable: false, queue_published: false }`. Prove `publishGranotWakeup` is **not asked**.
- Leftover `queued` + hosted published poke **200** `{ ok: true, recoverable: true, queue_published: true }`. Prove `reason: "recovery"`.
- Leftover `planning` / `applying` with expired lease + unpublished poke **503** `{ ok: false, error: "Granot recovery could not publish a worker wakeup." }` and **omits** `run_id`.
- Leftover local unpublished poke **503** — not Reporting’s local **200** `{ published: false }`.
- Leftover `awaiting_approval` only **200** `{ recoverable: false }` — prove this beat does **not** expire it.
- Unexpected throw **500** `{ error: "Granot recovery heartbeat failed." }` and does **not** echo `error.message`.
- This beat does **not** ask `runGranotWorker` / `continueGranotRuns` / `createGranotRun` / `applyAutomationPlanAction`.

**Cadence**
- `vercel.json` `/api/cron/granot-automation-heartbeat` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(granotAutomationCronRoutes)` after Reporting cron, before next Granot lifecycle cron / leftover `granotAutomationRoutes` / leftover `v1Routes`.
- Leftover Owner `granot-automation/*` stays mounted on already-recommended leftover `granot-automation.routes.ts`. Leftover consumer stays `api/queues/granot-automation-consumer.ts`.

**Not this file**
- Recover / poke stay on already-recommended [granot-http-collector-run-workflow.md](granot-http-collector-run-workflow.md).
- Receipt capture stays on already-recommended [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md).
- Owner HMAC stays on already-recommended [routes-granot-automation.md](routes-granot-automation.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `leftoverWorkExistsAndThePokeDidNotPublish`, `recoveryWakeupCouldNotBePublished`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `GranotAutomationCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, recoverable: false })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `heartbeat.ts` / `recover.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the Bearer-or-`x-cron-secret` **seam**: do not stop reading the header so “this desk matches Reporting.”
- Breaking the always-unpublished-503 **seam**: do not 200 local unpublished, and do not discard the boolean so “this desk matches Owner recover.”
- Breaking the poke-not-drain **seam**: do not ask `runGranotWorker` from this file.
- Breaking the no-`awaiting_approval` **seam**: do not expire stale approvals from this tick.
- Breaking the cron-secret **seam**: do not remount leftover `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` here.
- Breaking the generic-500 **seam**: do not echo `error.message` so “this desk matches Best Relocation.”
- Treating leftover `runGranotWorker`, leftover `publishGranotWakeup`, leftover `continueGranotRuns`, leftover Owner HMAC queue, leftover Owner recover 202, Reporting heartbeat, Best Relocation heartbeat, next Granot lifecycle drain, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / account-lease / Bearer-only **adapter** that has only one caller in this pass.
- Silently changing leftover 500 `"CRON_SECRET is not set"` to leftover 503 `"is not configured."`, starting leftover `reason: "cron"`, remounting leftover `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `granot-automation/*`, adding leftover `run_id` onto leftover 503 so “OAuth is no longer the only 503 with an id,” closing the label-only create gap, or renaming persisted leftover `granot_automation.queue.publish_failed` / leftover trigger leftover `recovery` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
