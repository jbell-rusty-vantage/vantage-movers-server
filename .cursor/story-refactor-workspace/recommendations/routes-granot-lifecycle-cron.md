# After The Cron Secret Proves This Tick Is Ours, Open Mongo And Drain Due Granot Observation Receipts — Never Claim One Receipt By Id Here, Never Publish A Wake-Up, Never Requeue A Dead Letter, Never Inspect The Statement, Never Use The API Secret Or Owner HMAC — operational story

- Status: recommended
- Service: `routes` (Wave B, visited after this pass)
- Pass: 28 of this service — `granot-lifecycle-cron.routes.ts`
- Remaining in this service: none — this was the last unchecked routes module
- Target: `src/routes/granot-lifecycle-cron.routes.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md) (fenced claim/lease shared by the queue consumer, five-minute cron, and Owner requeue. Queue messages are wake-ups only. Processing disabled means no claim; capture and due work remain intact. Due scan batch is 20 with concurrency 4. Last queue/cron run is derived from durable Operational Events. Knowledge lists this file as primary code next to `drainer.ts`, `operations.ts` requeue, and `api/queues/granot-lifecycle-consumer.ts` — they are siblings, not this pass. Knowledge never names `requireCronAuth`, Bearer-or-`x-cron-secret`, `"CRON_SECRET is not set"`, the HTTP body omitting `reason` / `trigger`, factory inject, or generic `"Granot lifecycle drain failed"` — do not add a Routes Service file in this rename so “the Service sentence wins”). Distinct from already-recommended Wave A claim: [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) (`drainDueReceipts("cron")` is the five-minute scan; `drainRequestedReceipt(..., "queue")` is the consumer; `claimAndProcessOrPoll` is Owner apply; `emitDrainRunEvent` writes `granot_lifecycle.{cron|queue}.run.{completed|failed}` — **this file asks the scan and the letter, never the one-id drain or the sync poll**). Distinct from already-recommended wake-up: [granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md) (after-commit `{ receipt_id }` poke; webhook still **202** when unpublished — **this file never publishes**). Distinct from leftover queue consumer: `api/queues/granot-lifecycle-consumer.ts` (`parseReceiptWakeup` → `drainRequestedReceipt(..., "queue")` → `emitDrainRunEvent`; failure **rethrows** after a zeroed failed letter — **does not import this file**). Distinct from already-recommended Owner desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (`POST .../receipts/:id/requeue` after HMAC Owner; requeue writes `pending` and **does not claim** — **does not import this file**). Distinct from already-recommended webhook: [routes-granot-webhook.md](routes-granot-webhook.md) (capture then poke; **202** after commit — **does not import this file**). Distinct from already-recommended Owner apply: [routes-extension-granot-apply.md](routes-extension-granot-apply.md) / [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) / [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) (`claimAndProcessOrPoll` after capture — **this file never asks them**). Distinct from already-recommended letters persist: [observability-record-operational-event.md](observability-record-operational-event.md) (`emitDrainRunEvent` asks it; **this file never asks it directly**). Distinct from already-recommended Granot automation cron: [routes-granot-automation-cron.md](routes-granot-automation-cron.md) (poke leftover automation work as `recovery`; never drains; unpublished **503** without `run_id`; **does not import this file**). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (mode gate before drain; **500** may echo `error.message`; no factory — **does not import this file**). Distinct from already-recommended Lead Messaging cron: [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) (`connectMongo` then drain; disabled is **200** `{ claimed: 0 }`, not HTTP `skipped`; **500** may echo `error.message` — **does not import this file**). Distinct from already-recommended Reporting cron: [routes-reporting-cron.md](routes-reporting-cron.md) (Bearer-only; missing secret **503** `"CRON_SECRET is not configured."` — **does not import this file**). Distinct from leftover Vercel schedule: `/api/cron/granot-lifecycle-drain` `*/5 * * * *` UTC (same five minutes as Granot automation heartbeat / Reporting heartbeat — **not** Best Relocation `0 */6`). Distinct from leftover flags: `GRANOT_LIFECYCLE_PROCESSING_ENABLED` defaults **true** on Wave A; this file never reads the env itself. Distinct from other secrets: `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Observation Receipt](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no `src/services/dailyOperations/` and no `daily-operations-admin.routes.ts` — do not invent that mount. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this routes pass. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one HTTP test harness.** `src/app.ts` **asks** the default export (`app.use(granotLifecycleCronRoutes)` on line 67 — **after** already-recommended Granot automation recovery cron, **before** leftover Owner Granot automation desk / leftover public v1 / leftover Owner ingestion desk / leftover Owner reporting desk). `src/routes/granot-lifecycle-cron.routes.test.ts` **asks** `createGranotLifecycleCronRouter({ connect, drain })` — missing `CRON_SECRET` **500**, Bearer mismatch **401**, Bearer match **200** bounded counters, `vercel.json` `*/5`. Wave A `drainer.test.ts` / `drainer.replica.test.ts` prove the scan / fence / processing-off skip — they do **not** HTTP this tick. Consumer tests prove `{ receipt_id }` — they do **not** import this file. Already-recommended `granot-lifecycle-admin.routes.test.ts` names Owner requeue — it does **not** name `/api/cron/granot-lifecycle-drain`. Operator `hit-vantage-api` lists Owner `/admin/granot-lifecycle/*`, **not** this path. Host public/unguarded tables omit this path. Not this **interface**: `drainDueReceipts` itself, `emitDrainRunEvent` itself, `drainRequestedReceipt` itself, `claimAndProcessOrPoll` itself, `requeueDeadLetterReceipt` itself, `publishGranotLifecycleReceiptWakeup` itself, Owner HMAC itself.
- Seams callers need: `CRON_SECRET` Bearer-**or**-`x-cron-secret` vs already-recommended Reporting Bearer-only; missing secret **500** `"CRON_SECRET is not set"` vs Reporting **503** `"CRON_SECRET is not configured."` vs CPL **500** `"is not configured"` (no period); `connectMongo` on this desk then `drainDueReceipts("cron")` vs consumer `connectMongo` then one-id drain vs already-recommended automation cron that never opens Mongo; processing-off **200** `{ skipped: true }` **without** Wave A `reason: "processing_disabled"` vs Sheet Sync route-level mode skip vs Lead Messaging disabled `{ claimed: 0 }` (no HTTP `skipped`); factory `createGranotLifecycleCronRouter({ connect, drain })` vs live default vs already-recommended `createRingCentralCronRouter` vs siblings with no factory; `emitDrainRunEvent` **not** injected vs `drain` injected; success letter even when `skipped: true` vs catch letter `granot_lifecycle.cron.run.failed` with zeros; generic **500** `"Granot lifecycle drain failed"` (no period, no `error.message`) vs consumer **rethrow**; `router.all` (Vercel GET) vs webhook POST-only; five-minute Vercel cadence vs Best Relocation `0 */6`. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no publish **seam**. There is no one-id claim **seam**. There is no requeue **seam**.
- Split later (only if the file outgrows one sitting): this ~99-line file is one sitting if you read it as after the cron secret proves this tick is ours, open Mongo and drain due Granot Observation Receipts — never claim one receipt by id here, never publish a wake-up, never requeue a dead letter, never inspect the statement, never use the API secret or Owner HMAC. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`. Due scan / fence stay already-recommended `drainer.ts`. One-id drain stays the leftover consumer. Owner requeue stays already-recommended `operations.ts`. Wake-up stays already-recommended `queuePublisher.ts`. Owner HMAC stays already-recommended `granot-lifecycle-admin.routes.ts`.

`router.all("/api/cron/granot-lifecycle-drain")` is an HTTP verb. The owner question is: *Vercel just woke the five-minute Granot lifecycle safety net — or a local operator used the same secret. Prove Authorization Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is not set — 500, not 401, and do not pretend this is unauthorized. If it does not match, refuse it. Open Mongo. Ask Wave A to scan due receipts with trigger `cron`. Echo the bounded counters. Write the completed letter even when processing is off and nothing was claimed. If the tick throws, write the failed letter with zeros and say the drain failed — do not echo the throw. Do not claim one receipt by id. Do not publish a wake-up. Do not put a dead letter back. Do not read `granot_statement`. Do not compare `x-api-secret`.*

Who scan twenty due ids / claim behind the fence / renew the lease / ask the processor already lives in already-recommended `drainer.ts`. Who drain one `{ receipt_id }` already lives in the leftover consumer. Who put a dead letter back already lives in already-recommended `operations.ts`. Who poke after webhook commit already lives in already-recommended `queuePublisher.ts`. Who sign Owner HMAC already lives in already-recommended `granot-lifecycle-admin.routes.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, open Mongo and drain due Granot Observation Receipts” story, not “a Granot lifecycle cron CRUD dump,” and not Claim This Due Receipt / Drain This Requested Receipt / Put This Dead Letter Back themselves:

1. **Drain due Granot Observation Receipts** — `ALL /api/cron/granot-lifecycle-drain`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }` — **does not** `recordOperationalEvent`. Mismatch **401** `{ ok: false, error: "Unauthorized" }` — **does not** `recordOperationalEvent`. Then **asks** `connectMongo()`. Then **asks** `drain()` (live default is `drainDueReceipts("cron")`). Then **asks** `emitDrainRunEvent(summary, false)` — event key `granot_lifecycle.cron.run.completed` even when `summary.skipped === true`. Then **200** `{ ok: true, skipped, scanned, claimed, completed, retried, dead_lettered, recovered, lease_lost }` — **omits** `trigger`, **omits** Wave A `reason: "processing_disabled"`, **omits** every receipt id / payload / `granot_statement`. Unexpected throw logs `granot_lifecycle.cron.drain.failed` through `safeLifecycleFailureLog` (bounded `error_code`, no raw message), **asks** `emitDrainRunEvent` with a zeroed `trigger: "cron"` bag and `failed: true` (`granot_lifecycle.cron.run.failed`), then **500** `{ ok: false, error: "Granot lifecycle drain failed" }` — catch binds `error` only for the safe log and **does not** echo `error.message`. This beat does **not** **ask** `drainRequestedReceipt`. This beat does **not** **ask** `claimAndProcessOrPoll`. This beat does **not** **ask** `requeueDeadLetterReceipt`. This beat does **not** **ask** `publishGranotLifecycleReceiptWakeup`. This beat does **not** compare `x-api-secret`. This beat does read `x-cron-secret` when Bearer is absent.

`requireCronAuth` is a beat inside this operation, not a second owner story. `createGranotLifecycleCronRouter` is the test **adapter**. The default export is `createGranotLifecycleCronRouter()` — the live `Router()` instance `app.ts` mounts.

There is no second one-id-drain operation. The leftover consumer elects `{ receipt_id }`. There is no third sync-claim-or-poll operation. Owner apply elects `claimAndProcessOrPoll`. There is no fourth Owner HMAC / requeue operation. There is no fifth automation-recovery poke operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, open Mongo and drain due Granot Observation Receipts — never claim one receipt by id here, never publish a wake-up, never requeue a dead letter, never inspect the statement, never use the API secret or Owner HMAC.” Already-recommended due scan / one-id drain / sync poll / requeue / wake-up / Owner HMAC already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner requeue.” Do not invent a publish **adapter** so “the safety net also pokes the queue.” Do not invent a one-id **adapter** so “cron matches the consumer.” Do not invent a Bearer-only **adapter** so “this desk matches Reporting” without a paired HTTP proof that `x-cron-secret` still wins on a local operator GET. Do not invent a CRUD folder so `drain.ts` / `cron.ts` / `heartbeat.ts` each get a file.

Do not move `drainDueReceipts` into this file so “the route owns the scan.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** generic-500 **and** already-recommended Reporting Bearer-only 503 **and** every sibling that still accepts `x-cron-secret`. Do not mount this router inside leftover `granot-lifecycle-admin.routes.ts` so “one file owns drain and requeue.” Do not merge this router into leftover `granot-automation-cron.routes.ts` so “one file owns every five-minute Granot poke.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `granotLifecycleDrainCronDesk` | `app.ts` mounts the instance **after** already-recommended Granot automation recovery cron, **before** leftover Owner Granot automation desk |
| `createGranotLifecycleCronRouter` | `acceptThisGranotLifecycleDrainCronDesk` | HTTP tests inject `connect` / `drain`; live default still **asks** Wave A |
| `GranotLifecycleCronRouteDeps` | `GranotLifecycleDrainCronSeamsForTests` | `{ connect?, drain? }` — **not** `{ emit }` |
| `ALL /api/cron/granot-lifecycle-drain` (today unexported handler) | `drainDueGranotObservationReceiptsOverHttp` | auth **then** open Mongo **then** scan **or** generic **500** |

Keep the default export as a one-line alias until `app.ts` migrates. Keep `createGranotLifecycleCronRouter` as the named factory until the route test migrates. Do not make callers learn `next_attempt_at` / `technical_attempts` / `LEASE_DURATION_MS` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** drop the factory so “this desk matches automation cron” without a paired HTTP proof that the injected `drain` still reaches the same **200** counters. Do **not** add `emit` onto `GranotLifecycleCronRouteDeps` in this rename so “the test can silence letters” without a paired proof that the live default still **asks** `emitDrainRunEvent`.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after a finished scan:

```ts
type GranotLifecycleDueReceiptsDrainedOverHttp = {
  ok: true
  skipped: boolean
  scanned: number
  claimed: number
  completed: number
  retried: number
  dead_lettered: number
  recovered: number
  lease_lost: number
}
```

That is the **200** handoff from “Vercel woke us and Wave A scanned due work” to “operators see bounded counters, never a statement.” Do **not** add `reason: "processing_disabled"` onto that bag in this rename so “HTTP matches Wave A” without a paired proof that today’s **200** still omits it. Do **not** add `trigger: "cron"` so “one field owns queue and cron.” Do **not** add `receipt_id` / `granot_statement` / payload onto that bag. Do **not** collapse `skipped: true` into Sheet Sync `{ reason: SHEET_SYNC_MODE is "…" }` so “one skip owns every quiet tick.”

Leave `drainDueReceipts` on already-recommended `drainer.ts`. Leave `drainRequestedReceipt` on the leftover consumer. Leave `claimAndProcessOrPoll` on already-recommended apply. Leave `requeueDeadLetterReceipt` on already-recommended `operations.ts`. Leave `publishGranotLifecycleReceiptWakeup` on already-recommended `queuePublisher.ts`. Leave Owner HMAC on already-recommended `granot-lifecycle-admin.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granot-lifecycle-cron.routes.ts
// Vercel just woke the five-minute Granot lifecycle safety net —
// or a local operator used the same secret.
// Prove Authorization Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is not set — 500.
// If it does not match, refuse it.
// Open Mongo.
// Ask Wave A to scan due receipts with trigger cron.
// Echo the bounded counters.
// Write the completed letter even when processing is off.
// If the tick throws, write the failed letter with zeros
// and say the drain failed — do not echo the throw.
// Do not claim one receipt by id.
// Do not publish a wake-up.
// Do not put a dead letter back.
// Do not read granot_statement.
// Do not compare x-api-secret.

export default acceptThisGranotLifecycleDrainCronDesk()

export function acceptThisGranotLifecycleDrainCronDesk(seams = {}) {
  const desk = Router()
  const openMongo = seams.connect ?? connectMongo
  const scanDueReceipts = seams.drain ?? (() => drainTheDueReceiptsAsCron())
  desk.all(
    "/api/cron/granot-lifecycle-drain",
    proveThisCronTickIsOurs,
    (req, res) => drainDueGranotObservationReceiptsOverHttp(req, res, { openMongo, scanDueReceipts }),
  )
  return desk
}

// ── 1. Drain due Granot Observation Receipts ──────────────

async function drainDueGranotObservationReceiptsOverHttp(_req, res, seams) {
  try {
    await seams.openMongo()
    const summary = await seams.scanDueReceipts()
    await rememberThisCronDrainFinished(summary) // emitDrainRunEvent(summary, false)
    return thisDrainTickFinished(res, pickBoundedCounters(summary))
  } catch (error) {
    logTheDrainFailureWithoutTheStatement(error) // granot_lifecycle.cron.drain.failed
    await rememberThisCronDrainFailedWithZeros()
    return drainFailedWithAGenericSentence(res) // 500, never echo error.message
  }
}

function pickBoundedCounters(summary) {
  return {
    skipped: summary.skipped,
    scanned: summary.scanned,
    claimed: summary.claimed,
    completed: summary.completed,
    retried: summary.retried,
    dead_lettered: summary.dead_lettered,
    recovered: summary.recovered,
    lease_lost: summary.lease_lost,
  }
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) return cronIsNotSet(res) // 500 "CRON_SECRET is not set"
  if (bearerOrCronHeaderMatches(req, expected)) return next()
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Authorization Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500 `"CRON_SECRET is not set"`, not 503 and not 401, and writes no letter. A mismatch is 401. Open Mongo. Ask Wave A to scan due receipts with trigger `cron`. Processing off is 200 `{ skipped: true }` without Wave A’s `reason`. A finished scan is 200 bounded counters plus a completed letter. A throw is a failed letter with zeros and 500 `"Granot lifecycle drain failed"` — never the throw text, never a statement. Do not claim one id. Do not publish. Do not requeue. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/granot-lifecycle-drain")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk accepts `x-cron-secret`. Already-recommended Reporting cron does not.** Sheet Sync / Lead Messaging / rematch / CPL / notification / Best Relocation / Granot automation tests ask the header. Reporting 401s it. Vercel cron sends `Authorization: Bearer`. Do not stop reading `x-cron-secret` so “this desk matches Reporting” without a paired HTTP proof that a local operator GET still 200s. Do not 401 a matching Bearer so “one header owns every tick.”

2. **Missing `CRON_SECRET` is 500 `"CRON_SECRET is not set"`.** Reporting **503**s `"CRON_SECRET is not configured."` (period). CPL **500**s `"CRON_SECRET is not configured"` (no period). The existing route test only asserts status 500 — not the sentence. Do not change this to 503 so “this desk matches Reporting” without a paired HTTP proof on this desk and CPL. Do not write `cron.auth.failed` so “this desk matches notification.”

3. **This tick drains. Already-recommended Granot automation cron only pokes.** Automation **asks** `recoverGranotRuns` and **503**s an unpublished leftover poke. This file **asks** `drainDueReceipts("cron")` and never publishes. Do not ask `publishGranotLifecycleReceiptWakeup` so “every five-minute Granot desk matches automation.” Do not 503 a processing-off skip so “quiet ticks look unpublished.”

4. **`connectMongo` lives on this desk and on the consumer, not inside Wave A drain.** Already-recommended Lead Messaging does the same. Already-recommended Sheet Sync drain connects itself; that cron does not. Already-recommended automation recover opens Mongo inside Wave A. Do not move `connectMongo` into `drainDueReceipts` in this rename so “every caller matches Sheet Sync” without a paired consumer + cron proof. Do not drop the connect so “drain already opened it.”

5. **Processing off is HTTP `skipped: true` and still writes a completed letter.** Wave A returns `{ skipped: true, reason: "processing_disabled", zeros }`. This file **200**s `skipped: true` and **asks** `emitDrainRunEvent(summary, false)` (`granot_lifecycle.cron.run.completed`). Lead Messaging disabled is `{ claimed: 0 }` with **no** HTTP `skipped`. Sheet Sync skips at the route before drain. Do not add a route-level flag read so “disabled never opens Mongo” without a paired proof that Wave A still owns the skip. Do not **401** processing-off so “off looks unauthorized.” Do not write the failed letter on a skip so “quiet ticks look broken.”

6. **HTTP omits Wave A `reason` and `trigger`.** `pickBoundedCounters` drops `reason: "processing_disabled"` and `trigger: "cron"`. Operators see `skipped: true` with no why. Do not add those fields in this rename so “HTTP matches the summary type” without a paired proof that today’s body still has exactly eight counters. Do not start echoing `granot_statement` so “the skip explains itself.”

7. **The factory injects `connect` / `drain` and never `emit`.** A successful stubbed drain still **asks** live `emitDrainRunEvent`. If that letter throws after a real scan, the catch writes a **failed** letter with zeros and **500**s a tick that already claimed work. The consumer has the same emit-after-success shape. Do not add `emit` onto the factory in this rename so “tests stay quiet” without a paired proof that `app.ts` still **asks** the live letter. Do not swallow an emit throw so “HTTP stays 200 after a finished scan” without a product decision.

8. **Unexpected throw 500s a generic sentence and never echoes `error.message`.** Lead Messaging / Sheet Sync / notification / Best Relocation may echo. Reporting / Granot automation / this desk do not. The catch uses `safeLifecycleFailureLog` (bounded `error_code`). Do not start echoing `error.message` so “this desk matches Lead Messaging” without a paired HTTP proof that operators still do not see cookies, labels, or `granot_statement`. Do not drop the catch so “this desk matches rematch unhandled Express.”

9. **The leftover consumer rethrows. This tick 500s.** Consumer failure emits a zeroed `trigger: "queue"` letter and **throws** so Vercel retries the callback. This tick emits a zeroed `trigger: "cron"` letter and answers 500. Do not throw from this handler so “one unpublished owns queue and cron” without a paired proof that Vercel GET cron still maps 500 to retry and does not page a local operator. Do not ask `drainRequestedReceipt` from this file.

10. **This desk never writes auth letters.** Missing secret / mismatch write no `cron.auth.failed`. Notification cron does. Do not void-ask `cron.auth.failed` so “this desk matches notification.” Do not ask `recordOperationalEvent` from this file so “one route owns every Granot letter” — Wave A `emitDrainRunEvent` already writes the run.

11. **There is no mode gate and no global drain seat on this route.** Processing default is **true**. Sheet Sync refuses unless `queued`. Call Log maps `lease_held` to HTTP skipped. This scan shares the receipt lease fence with the consumer; Mongo elects the winner. HTTP `skipped` means processing off, not a held seat. Do not copy Sheet Sync’s queued-only fence here. Do not copy Call Log `lease_held` onto a finished scan with `lease_lost > 0`.

12. **`requireCronAuth` is a copy of sibling crons that accept `x-cron-secret` and 500 a missing secret.** Reporting is the Bearer-only 503 cousin. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** generic-500 **and** Reporting Bearer-only 503 **and** the siblings that still accept the header. Park the copy. IDEAS already parked that extract.

13. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Today’s harness only POSTs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

14. **This desk never claims one receipt by id, never publishes, and never requeues.** Wave A scan finds up to 20 due ids, oldest `next_attempt_at` first, concurrency 4. Owner requeue writes `pending` and stops. Webhook poke is `{ receipt_id }` after commit. This file asks the scan only. Do not ask `claimAndProcessOrPoll` from this file so “the safety net also waits five seconds.” Do not merge this router into Owner `granot-lifecycle/*` so “one file owns every drain start.”

15. **Owner HTTP uses `x-api-secret` + HMAC; this tick uses `CRON_SECRET` Bearer or `x-cron-secret`.** `app.ts` mounts **before** `granotAutomationRoutes` and **before** `v1Routes`. Do not remount `requireApiSecret` so “it matches Owner requeue.” Do not hide this ALL behind Owner HMAC so “someone must be an Owner.”

16. **Host tables and `hit-vantage-api` omit `/api/cron/granot-lifecycle-drain` and list Owner `/admin/granot-lifecycle/*`.** That skill is `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

17. **The HTTP harness is thin.** It injects `connect` / `drain`, proves missing secret / 401 / Bearer **200** counters / `vercel.json` `*/5`, and asserts the body has no `"payload"` substring. It does not name `x-cron-secret`, GET, processing-off `skipped` without `reason`, `emitDrainRunEvent` keys, or the generic 500 sentence. Keep handshake + bounded **200** + generic 500 at this **interface**. Claim / fence / tenth-attempt dead-letter stay on already-recommended Wave A tests.

18. **Leave sibling modules alone.** `drainDueReceipts` / `emitDrainRunEvent` / `connectMongo` are already the right **depth**. This file orchestrates the HTTP **adapter**.

19. **Do not treat Wave A scan / Wave A one-id drain / Wave A sync poll / Owner requeue / webhook poke / Granot automation recovery / Sheet Sync drain / Lead Messaging drain as this story.** Do not inspect a Lead / Booking / Cancellation from this file. Do not honor HTTP `repair_identity`. Do not flip leftover effect flags. Do not reopen Wave A `connectBookingToLead.ts`. Do not rename persisted `granot_lifecycle.cron.run.completed` / `granot_lifecycle.cron.run.failed` / `granot_lifecycle.cron.drain.failed` while recommending a rename.

## Testing

The **interface** is the test surface: `granotLifecycleDrainCronDesk` (mounted on `app.ts` **after** already-recommended Granot automation recovery cron, **before** leftover Owner Granot automation desk as the default export) plus `acceptThisGranotLifecycleDrainCronDesk` (today `createGranotLifecycleCronRouter`) and the one HTTP operation above.

Today `granot-lifecycle-cron.routes.test.ts` mounts the factory with stubbed `connect` / `drain`. Keep handshake + bounded **200** + generic 500 at the same **interface**. Add the missing beats on that harness (do not invent a second factory so the test can no longer see live `emitDrainRunEvent`):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"` and does **not** ask `cron.auth.failed`.
- Bearer mismatch **401** `"Unauthorized"` and does **not** ask `cron.auth.failed`.
- Matching `x-cron-secret` reaches `connect` then `drain`.
- Matching Bearer reaches `connect` then `drain`.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` are **not** accepted here.

**Drain due receipts — never claim one id here**
- Injected scan **200** `{ ok: true, skipped, scanned, claimed, completed, retried, dead_lettered, recovered, lease_lost }` and **omits** `reason` / `trigger` / `payload` / `receipt_id` / `granot_statement`.
- Processing-off summary **200** `{ skipped: true }` plus `emitDrainRunEvent(summary, false)` — prove the completed key, not the failed key.
- Unexpected throw **500** `{ error: "Granot lifecycle drain failed" }`, **asks** `emitDrainRunEvent(zeros, true)`, and does **not** echo `error.message`.
- This beat does **not** ask `drainRequestedReceipt` / `claimAndProcessOrPoll` / `requeueDeadLetterReceipt` / `publishGranotLifecycleReceiptWakeup`.

**Cadence**
- `vercel.json` `/api/cron/granot-lifecycle-drain` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(granotLifecycleCronRoutes)` after Granot automation cron, before leftover `granotAutomationRoutes` / leftover `v1Routes`.
- Leftover Owner `granot-lifecycle/*` stays mounted on already-recommended leftover `granot-lifecycle-admin.routes.ts`. Leftover consumer stays `api/queues/granot-lifecycle-consumer.ts`.

**Not this file**
- Due scan / fence stay on already-recommended [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md).
- Wake-up stays on already-recommended [granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md).
- Owner HMAC / requeue stay on already-recommended [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `pickBoundedCounters`, `drainFailedWithAGenericSentence`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** drop the factory so “the test can no longer inject `drain`.” `app.ts` must still **ask** the default export.

## What I would not do

- A `GranotLifecycleCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, skipped: false })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `heartbeat.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the Bearer-or-`x-cron-secret` **seam**: do not stop reading the header so “this desk matches Reporting.”
- Breaking the scan-not-poke **seam**: do not ask `publishGranotLifecycleReceiptWakeup` from this file.
- Breaking the scan-not-one-id **seam**: do not ask `drainRequestedReceipt` / `claimAndProcessOrPoll` from this file.
- Breaking the cron-secret **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` here.
- Breaking the generic-500 **seam**: do not echo `error.message` so “this desk matches Lead Messaging.”
- Treating leftover `drainDueReceipts`, leftover `drainRequestedReceipt`, leftover `claimAndProcessOrPoll`, leftover Owner requeue, leftover webhook poke, leftover Granot automation recovery, Sheet Sync drain, or Lead Messaging drain as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / publish / one-id / Bearer-only **adapter** that has only one caller in this pass.
- Silently changing leftover 500 `"CRON_SECRET is not set"` to leftover 503 `"is not configured."`, adding leftover `reason` onto the **200**, remounting leftover `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `granot-lifecycle/*`, flipping leftover effect flags, reopening Wave A `connectBookingToLead.ts`, or renaming persisted leftover `granot_lifecycle.cron.run.completed` / leftover `granot_lifecycle.cron.run.failed` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` before this checklist row is marked.
- Writing a whole-folder recommendation for `routes`.
