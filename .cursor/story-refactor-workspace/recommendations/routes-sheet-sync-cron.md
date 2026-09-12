# After The Cron Secret Proves This Tick Is Ours, Wake The Sheet Sync Outbox Drain If Mode Is Queued — Never Hold The Drain Seat Here, Never Publish A Wake-Up, Never Write A Sheet Row, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 21 of this service — `sheet-sync-cron.routes.ts`
- Remaining in this service: `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/sheet-sync-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (HTTP table: `GET/ALL /api/cron/sheet-sync-drain` → `runSheetSyncDrain("cron")`, Bearer or `x-cron-secret` = `CRON_SECRET`, **no-op unless `SHEET_SYNC_MODE=queued`**. End-to-end: cron is the five-minute safety net after queue wake-up; Mongo still owns due / coalesce / priority / lease / quota. Modes: `legacy` is default and unknown fallback; `queued` is opt-in; `disabled` persist/finalize log only. Drainer: queue / cron / admin retry all enter `runSheetSyncDrain`; global lease `sheet-sync:drain`; skip `{ skipped: true }` if another drain holds it). Distinct from already-recommended drain: [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (`runSheetSyncDrain` — this file **asks** it with `"cron"` after the mode gate; that file takes `sheet-sync:drain`, claims due jobs, **asks** planner + batch writer; **this file never acquires the seat and never writes a tab**. Wave A already said: cron returns `{ ok: true, skipped: false, summary }` even when `summary.ok === false`; only an unexpected throw is 500; the mode gate lives on the route, not in the drain). Distinct from already-recommended wake-up: [sheet-sync-queue.md](sheet-sync-queue.md) (`publishSheetSyncWakeup` — cron **does not import** it; `reason: "cron"` is on the union and has no publisher). Distinct from already-recommended persist / finalize: [sheet-sync-coordinator.md](sheet-sync-coordinator.md) (outbox in the same Mongo write, then after-commit wake-up or legacy `waitUntil` — **does not import** this file). Distinct from already-recommended outbox: [sheet-sync-outbox.md](sheet-sync-outbox.md) (**this file never enqueues**). Distinct from already-recommended Admin desk: [admin-sheet-sync.md](admin-sheet-sync.md) (`POST /api/v1/admin/sheet-sync/retry` **asks** `retrySheetSyncJobs` then `runSheetSyncDrain("admin")` via `waitUntil` — **no mode gate** on retry; **does not import** this file; Admin may retry; Owner `contains` is leftover and does not drain). Distinct from already-recommended Owner mount: [routes-v1.md](routes-v1.md) (Admin `sheet-sync/{health,jobs,runs,retry}` after `requireApiSecret` — **does not import** this file). Distinct from the dedicated consumer: `api/queues/sheet-sync-consumer.ts` (`runSheetSyncDrain("queue")`, payload ignored, **not** mounted on Express — **does not import** this file). Distinct from mode config: `getSheetSyncMode()` (`legacy` default / unknown fallback; runtime override `getRuntimeDomainOverrides().sheetSyncMode` — this file **asks** that **before** drain). Distinct from sibling crons: already-recommended [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (rematch flag default **on**, no try/catch, held seat is zeros + HTTP `skipped: false` — **does not import** this file) / already-recommended [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (Call Log `lease_held` **200** + factory inject; flags default **false** — **does not import** this file) / next `lead-messaging-cron.routes.ts` / `cpl-correction-cron.routes.ts` / `notification-cron.routes.ts` / `best-relocation-ingestion-cron.routes.ts` / `reporting-cron.routes.ts` / `granot-automation-cron.routes.ts` / `granot-lifecycle-cron.routes.ts` (each copies `requireCronAuth`; **none import** this file). Distinct from already-recommended letters: [observability-record-operational-event.md](observability-record-operational-event.md) (drain **asks** `sheet_sync.drain.failed` / completed / partial-failure; **this file never asks letters** — it only logs `sheet_sync.cron.drain.failed` on an unexpected throw). Distinct from other secrets: `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` names Sheet Sync in the intro and points at a parent glossary that is not in this tree — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one HTTP test harness.** `src/app.ts` **asks** the default export (`app.use(sheetSyncCronRoutes)` on line 58 — **after** already-recommended RingCentral cron / already-recommended booking-reconciliation cron, **before** next lead-messaging / CPL / notification crons, Twilio desks, Best Relocation / reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1). `src/routes/sheet-sync-cron.routes.test.ts` **asks** the live default export — missing `CRON_SECRET` **500**, Bearer mismatch **401**, `SHEET_SYNC_MODE=legacy` **200** skipped (reason matches `/legacy/`), Bearer match with `disabled` **200** skipped. Operator `hit-vantage-api` lists Owner/Admin `POST /api/v1/admin/sheet-sync/retry`, **not** `/api/cron/sheet-sync-drain`. Host public/unguarded tables omit this path. Not this **interface**: `runSheetSyncDrain` itself, `publishSheetSyncWakeup` itself, `retrySheetSyncJobs` itself, `persistSheetSyncIntent` itself, `acquireLease` itself, `getSheetSyncMode` itself, the queue consumer itself.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs `requireApiSecret` vs Owner HMAC vs Granot webhook secret vs RingCentral Validation-Token vs Twilio signature; non-queued **200** `{ skipped: true, reason: SHEET_SYNC_MODE is "…" }` vs drain **200** `{ skipped: false, summary }` (even when `summary.skipped === true` or `summary.ok === false`) vs unexpected throw **500** `error.message`; no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; mode default **legacy** vs rematch flag default **on** vs RingCentral flags default **false**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no publish **seam**.
- Split later (only if the file outgrows one sitting): this ~62-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake the Sheet Sync outbox drain if mode is queued — never hold the drain seat here, never publish a wake-up, never write a sheet row, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`. Drain stays already-recommended `drainer/runSheetSyncDrain.ts`. Wake-up stays already-recommended `sheetSyncQueue.service.ts`. Mode stays `getSheetSyncMode`. Admin retry stays already-recommended `adminSheetSync.service.ts`. Lead Messaging drain stays next `lead-messaging-cron.routes.ts`.

`router.all("/api/cron/sheet-sync-drain")` is an HTTP verb. The owner question is: *Vercel just woke us — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. If Sheet Sync is not queued, answer skipped and do not ask the drain — Mongo must not see a seat claim. If it is queued, ask the drain with trigger `cron` and echo the summary. A held drain seat is inside that summary, not an HTTP skip. A handled drain failure is still 200 with `summary.ok === false`. Only an unexpected throw is 500, and that 500 may echo the message. Do not hold the drain seat in this file. Do not publish a wake-up. Do not write a sheet row. Do not compare `x-api-secret`.*

Who take the global seat / claim due jobs / plan / batch-write already lives in already-recommended `runSheetSyncDrain`. Who name the mode already lives in `getSheetSyncMode`. Who publish the wake-up already lives in already-recommended `publishSheetSyncWakeup`. Who re-arm failed jobs from the Admin Dashboard already lives in already-recommended `retrySheetSyncJobs`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, wake the Sheet Sync outbox drain if mode is queued” story, not “a cron CRUD dump,” and not Drain Due Sheet-Sync Jobs / Wake The Drain / Watch The Outbox From The Admin Dashboard themselves:

1. **Wake this Sheet Sync outbox drain — or skip because mode is not queued** — `ALL /api/cron/sheet-sync-drain`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }`. Mismatch **401** `{ ok: false, error: "Unauthorized" }`. Then `getSheetSyncMode()`. `mode !== "queued"` **200** `{ ok: true, skipped: true, reason: \`SHEET_SYNC_MODE is "${mode}"\` }` and **does not ask** `runSheetSyncDrain` — knowledge: the cron is a no-op unless queued; Wave A drain already said the mode gate lives on the route. File comment: the queue consumer normally drains within seconds; this tick recovers jobs whose wake-up publish failed (or never fired in legacy/local). Else **asks** `runSheetSyncDrain("cron")` and **200** `{ ok: true, skipped: false, summary }` — Wave A already locked that HTTP `skipped` stays `false` even when `summary.ok === false` or `summary.skipped === true` (held `sheet-sync:drain`). Unexpected throw logs `sheet_sync.cron.drain.failed` and **500** `{ ok: false, error: error.message }` (or `"Sheet sync drain failed"` when the throw is not an `Error`). This beat does **not** map a held drain seat onto HTTP `{ skipped: true, reason: "lease_held" }`. This beat does **not** **ask** `acquireLease`. This beat does **not** **ask** `publishSheetSyncWakeup`. This beat does **not** **ask** `retrySheetSyncJobs`. This beat does **not** **ask** `recordOperationalEvent`. This beat does **not** compare `x-api-secret`.

`requireCronAuth` is a beat inside this operation, not an extra owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second hold-the-seat operation. Wave A drain elects `sheet-sync:drain`. There is no third publish-a-wake-up operation. There is no fourth Admin retry operation. There is no fifth Lead Messaging drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake the Sheet Sync outbox drain if mode is queued — never hold the drain seat here, never publish a wake-up, never write a sheet row, never use the API secret.” Already-recommended drain / wake-up / persist / outbox / Admin retry / the mode already live in deeper **modules**. Do not pull those in. Do not invent a `SheetSyncCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** Wave A drain. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner desks.” Do not invent a lease **adapter** beside already-recommended drain `acquireLease`. Do not invent a publish **adapter** beside already-recommended `publishSheetSyncWakeup`. Do not invent a CRUD folder so `drain.ts` / `cron.ts` each get a file.

Do not move `runSheetSyncDrain` into this file so “the route owns the drain.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside `v1.routes.ts` so “one file owns every cron.” Do not merge this router into already-recommended Admin `sheet-sync/retry` so “one file owns every drain start.” Do not merge this router into the queue consumer so “one hop owns every wake.” Do not merge this router into already-recommended rematch cron so “one file owns every five-minute `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `sheetSyncDrainCronDesk` | `app.ts` mounts the instance **after** rematch cron, **before** next lead-messaging cron |
| `ALL /api/cron/sheet-sync-drain` (today unexported handler) | `wakeThisSheetSyncOutboxDrainOverHttp` | mode **then** drain **or** skipped |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `sheet-sync:drain` / `coalescing_key` / `target_hints` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createSheetSyncCronRouter({ runDrain, sheetSyncMode })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after mode is not queued:

```ts
type SheetSyncDrainSkippedBecauseModeIsNotQueuedOverHttp = {
  ok: true
  skipped: true
  reason: `SHEET_SYNC_MODE is "${"legacy" | "disabled"}"`
}
```

That is the **200** handoff from “Vercel woke us while Sheet Sync is still legacy (or disabled)” to “do not claim the drain seat.” Unknown `SHEET_SYNC_MODE` already folded to `"legacy"` inside `getSheetSyncMode` — do **not** echo the raw nonsense string so “the reason tells the operator what they typed.” Do **not** collapse a held drain seat (`summary.skipped === true` with HTTP `skipped: false`) into this skip so “one skip owns disabled and a held seat.” Do **not** copy RingCentral `{ reason: "lease_held" }` onto this desk so “every cron maps overlap.” Do **not** add `jobs[]` onto the **200** so “the owner can see every due Lead on the cron body.”

Leave `runSheetSyncDrain` on already-recommended drain. Leave `getSheetSyncMode` on `sheetSync.ts`. Leave wake-up on already-recommended `sheetSyncQueue.service.ts`. Leave Admin retry on already-recommended `adminSheetSync.service.ts`. Leave the consumer on `api/queues/sheet-sync-consumer.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sheet-sync-cron.routes.ts
// Vercel just woke us — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// If Sheet Sync is not queued, answer skipped and do not ask the drain.
// If it is queued, ask the drain with trigger cron and echo the summary.
// A held drain seat is inside that summary, not an HTTP skip.
// A handled drain failure is still 200 with summary.ok false.
// Only an unexpected throw is 500.
// Do not hold the drain seat in this file.
// Do not publish a wake-up.
// Do not write a sheet row.
// Do not compare x-api-secret.

export default acceptThisSheetSyncDrainCronDesk()

function acceptThisSheetSyncDrainCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/sheet-sync-drain",
    proveThisCronTickIsOurs,
    wakeThisSheetSyncOutboxDrainOverHttp,
  )
  return desk
}

// ── 1. Wake this Sheet Sync outbox drain ──────────────────

async function wakeThisSheetSyncOutboxDrainOverHttp(req, res) {
  if (!sheetSyncIsQueued()) {
    return skippedBecauseSheetSyncIsNotQueued(res)
  }

  try {
    const summary = await drainDueSheetSyncJobs("cron")
    return theDrainFinishedOrReturnedAHandledFailure(res, summary)
  } catch (error) {
    rememberTheCronTickThrew(req, error)
    return sheetSyncDrainFailedAndEchoTheMessage(res, error)
  }
}

function sheetSyncIsQueued() {
  return getSheetSyncMode() === "queued"
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) {
    return cronIsMisconfigured(res)
  }
  if (bearerMatches(req, expected) || headerSecretMatches(req, expected)) {
    return next()
  }
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500, not 401. A mismatch is 401. If Sheet Sync is not queued, 200 skipped and do not ask drain — Mongo must not see a seat claim. If it is queued, ask drain with `"cron"` and echo the summary. A held seat is `summary.skipped === true` with HTTP `skipped: false`, not `lease_held`. A handled run failure is 200 with `summary.ok === false`. An unexpected throw is 500 and may echo `error.message`. Do not hold the seat. Do not publish. Do not write a sheet row. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/sheet-sync-drain")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The route refuses when mode is not queued; the drain does not.** This file **200** `{ skipped: true }` and never **asks**. Wave A drain still runs if the consumer or Admin retry reach it on a legacy host. Wave A drain already said leave both. Do not add `getSheetSyncMode()` inside `runSheetSyncDrain` so “disabled never drains.” Do not delete this fence so “the service already checked.”

2. **Mode defaults to `legacy`.** Unknown values fall back to `legacy`. `queued` is opt-in. Already-recommended rematch defaults **on**. Already-recommended RingCentral flags default **false**. Knowledge locks this default so a deploy without the env still uses `waitUntil`. Do not default queued so “the safety net always claims.” Do not treat unknown as `disabled` so “nonsense looks like a kill switch.”

3. **A held drain seat is not HTTP `lease_held`.** Drain miss returns `{ ok: true, skipped: true, runId: null, claimed: 0, … }`. This file **200** `{ skipped: false, summary }`. Already-recommended Call Log maps `summary.skipReason === "lease_held"` onto **200** `{ skipped: true, reason: "lease_held" }`. Already-recommended rematch held seat is zeros with HTTP `skipped: false`. Do not copy the Call Log map here so “every cron elects the same skip.” Do not **500** the held-seat summary so “overlap looks like failure.” Do not collapse it into the mode skip so “one skip owns legacy and a held seat.”

4. **Handled drain failure is HTTP 200.** Wave A drain’s own catch returns `{ ok: false, … }` and does not throw — leftover `processing` already went to `retrying` and `sheet_sync.drain.failed` already paged. This file still **200** `{ skipped: false, summary }`. Wave A already said do not 500 `summary.ok === false` so “Vercel retries the cron.” Do not throw from the drain on a handled run failure so “the consumer can crash-retry.”

5. **Route 500 is only an unexpected throw, and it echoes `error.message`.** `connectMongo` / `acquireLease` / `SheetSyncRun.create` sit **before** Wave A’s inner try — those throws reach this catch. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Already-recommended rematch has no try/catch. Next lead-messaging cron also echoes `error.message`. Do not sanitize this 500 so “this desk matches Call Log silence” without a paired HTTP proof that operators still see why the safety net died. Do not drop the catch so “this desk matches rematch unhandled Express.”

6. **This desk never writes the failed letter.** Wave A drain already persisted `sheet_sync.drain.failed` (`notificationCandidate: true`) inside its catch. This file only logs `sheet_sync.cron.drain.failed`. Do not **ask** `recordOperationalEvent` from this file so “one route owns every Sheet Sync letter.” Do not drop Wave A’s letter so “the cron log is enough.”

7. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today’s harness mounts the live default and proves auth plus non-queued skip. Disabled / legacy skip is already testable by setting `SHEET_SYNC_MODE` — `getSheetSyncMode` reads env (and runtime override) at request time, and this file will not **ask** drain. Do not add `createSheetSyncCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

8. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / lead-messaging / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

9. **`router.all` is GET-and-POST, not POST-only.** Knowledge names `GET/ALL`. Vercel cron GETs. Today’s harness POSTs only. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

10. **Trigger is the string `"cron"`.** Drain never asks `deriveTrustedOwnerActor`. Do not stamp `owner:cron` so “history looks like the Admin desk.” Do not import Owner HMAC so “someone must be an Owner.”

11. **This desk never publishes, never enqueues, never writes a tab, and never re-arms failed jobs.** Wake-up **asks** `@vercel/queue`. Admin retry **asks** `updateMany` then `waitUntil(drain("admin"))`. Drain **asks** planner + batch writer. This file **asks** one export. Do not **ask** `publishSheetSyncWakeup` from this file so “the safety net also pokes the queue.” Do not merge this router into already-recommended Admin `sheet-sync/retry` so “one file owns every drain start.” Do not call `writeBatchedTargets` from this file so “one hop owns the tab.”

12. **Admin retry has no mode gate; this tick does.** Health **shows** mode. Retry still starts the drain. The consumer also **asks** drain whenever it runs. Do not add `SHEET_SYNC_MODE` onto Admin retry so “retry matches cron.” Do not delete this fence so “every start matches retry.”

13. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches Admin retry.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.”

14. **Host tables and `hit-vantage-api` omit `/api/cron/sheet-sync-drain` and list Admin `POST .../sheet-sync/retry`.** That skill is `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

15. **Today’s harness never wakes drain and never proves a queued tick.** Auth 500/401 plus legacy / disabled skip. `vercel.json` `*/5 * * * *` is the only cadence proof. Do not treat schedule-parse as HTTP drain. Keep the non-queued skip at this **interface**. Queued four-count **200** and held-seat `summary.skipped` stay on already-recommended drain tests unless a later factory inject exists with a live-default proof.

16. **Leave sibling modules alone.** `runSheetSyncDrain` / `getSheetSyncMode` are already the right **depth**. This file orchestrates the HTTP **adapter**.

17. **Do not treat persist / wake-up / Admin retry / the queue consumer / rematch / Call Log sweep / Lead Messaging drain / Granot lifecycle drain as this story.** Next `lead-messaging-cron.routes.ts` is due SMS. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `sheetSyncDrainCronDesk` (mounted on `app.ts` **after** rematch cron, **before** next lead-messaging cron as the default export) and the one HTTP operation above.

Today `sheet-sync-cron.routes.test.ts` names missing-secret **500**, Bearer-mismatch **401**, `legacy` skip **200**, and Bearer + `disabled` skip **200** through the live default. Keep those proofs. Add the unknown-mode fold at the same **interface** (do not boot drain, do not claim the seat in the route file):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"`.
- Bearer mismatch **401** `"Unauthorized"`.
- Matching `x-cron-secret` **200**.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` are **not** accepted here.

**Wake drain — never hold the seat here**
- `SHEET_SYNC_MODE=legacy` (or missing / unknown) **200** `{ ok: true, skipped: true, reason }` matching `/legacy/` and never **asks** drain (no Mongo connect from this tick).
- `SHEET_SYNC_MODE=disabled` **200** `{ skipped: true, reason }` matching `/disabled/`.
- Queued success **200** `{ skipped: false, summary }` echoes Wave A counts (`claimed` / `synced` / `failed` / `deferred`) and is PII-free (no phone / Lead id / spreadsheet id / Bearer / token). Prove the counts on already-recommended drain unless a later factory inject exists.
- A held drain seat is **200** `{ skipped: false, summary: { ok: true, skipped: true, runId: null, claimed: 0, … } }`, not `{ reason: "lease_held" }`. That mapping lives in drain, not here — do not invent it on this desk.
- Handled `summary.ok === false` is still **200** `{ skipped: false, summary }`, not HTTP 500.
- Unexpected throw **500** may echo `error.message`.
- This beat does **not** **ask** `acquireLease` / `publishSheetSyncWakeup` / `retrySheetSyncJobs` / `recordOperationalEvent`.

**Cadence**
- `vercel.json` `/api/cron/sheet-sync-drain` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(sheetSyncCronRoutes)` after rematch cron, before next lead-messaging cron / `v1Routes`.
- Already-recommended Admin `sheet-sync/*` and the dedicated queue consumer stay mounted apart (consumer is not on Express).

**Not this file**
- Drain stays on already-recommended [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md).
- Wake-up stays on already-recommended [sheet-sync-queue.md](sheet-sync-queue.md).
- Persist / finalize stays on already-recommended [sheet-sync-coordinator.md](sheet-sync-coordinator.md).
- Admin retry stays on already-recommended [admin-sheet-sync.md](admin-sheet-sync.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `sheetSyncIsQueued`, `skippedBecauseSheetSyncIsNotQueued`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `SheetSyncCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, skipped: false, summary })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the non-queued-never-claims **seam**: do not **ask** drain when mode is not `queued`.
- Breaking the held-seat **seam**: do not map drain `summary.skipped` onto HTTP `lease_held`, and do not **500** overlap.
- Breaking the handled-failure **seam**: do not 500 `summary.ok === false`.
- Breaking the cron-secret **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` here.
- Treating `runSheetSyncDrain`, `publishSheetSyncWakeup`, `retrySheetSyncJobs`, `persistSheetSyncIntent`, the queue consumer, rematch, Call Log sweep, next Lead Messaging drain, Granot lifecycle drain, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / publish **adapter** that has only one caller in this pass.
- Silently defaulting mode to `queued`, copying RingCentral `lease_held`, merging this router into Admin retry, publishing a wake-up, remounting `requireApiSecret`, or extracting `requireCronAuth` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
