# After The Cron Secret Proves This Tick Is Ours, Wake The Call Log Sweep If The Flag Is On And Map A Held Lease To A Safe Skip — Then Once A Day Snapshot Yesterday's Inbound Answered-Over-Two-Minutes Counts — Never Elect The Sweeper Here, Never Page Call Log Here, Never Create A Call Lead, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 19 of this service — `ringcentral-cron.routes.ts`
- Remaining in this service: `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/ringcentral-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 3: `GET|POST /api/cron/ringcentral-call-log-sync` Vercel every 30 minutes, `CRON_SECRET`; gated by leftover `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`; **the route is a trigger and mapper only; it coordinates nothing**; Mongo `key: "account"` elects the single winner; failed claim `{ ok: true, skipped: true, reason: "lease_held" }`; a disabled route never claims; cadence leftover `*/30 * * * *`; rollback leftover `0 */2 * * *` first, then leftover `RINGCENTRAL_CALL_LOG_SYNC_ENABLED=false`. Invariants: leftover Analytics reconcile is count-level only — **must not** create Call Leads; never create RingCentral Call Leads outside leftover `ingestRingCentralQualifiedCall`. Tests list leftover `ringcentral-cron.routes.test.ts` — auth, disabled skip, leftover `lease_held` skip, safe failure, leftover exact `vercel.json` entries). Distinct from already-recommended Wave A sweep: [ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (`runRingCentralCallLogSync` — this file **asks** it after leftover flag; that file elects, opens the twelve-hour window, pages Detailed inbound Voice, **asks** leftover vet / leftover promote, and moves the cursor only after a complete sweep; **this file never talks to leftover provider HTTP**). Distinct from already-recommended leftover lease/cursor: [ringcentral-call-log-sync-state-store.md](ringcentral-call-log-sync-state-store.md) (`acquireCallLogSyncLease` — leftover Wave A sweep **asks** it; **this file never imports that store**; leftover `lease_held` arrives as leftover `summary.skipReason`). Distinct from already-recommended leftover Call Log vet: [ringcentral-call-log-vetting.md](ringcentral-call-log-vetting.md) (**this file never unfolds a record**). Distinct from already-recommended leftover promote: [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (leftover sweep **asks** it with leftover `ingestionSource: "call_log_sync"`; **this file never asks it**). Distinct from already-recommended leftover count snapshot: [ringcentral-analytics-reconcile.md](ringcentral-analytics-reconcile.md) (`runRingCentralAnalyticsReconcile` — this file **asks** it after leftover `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED`; that file never pages Call Log and never promotes; leftover Wave A already says leftover enable skip lives here). Distinct from leftover Wave A flags: leftover `ringcentral-config.ts` (`isRingCentralCallLogSyncEnabled` / leftover `isRingCentralAnalyticsReconcileEnabled` both default **false** — this file **asks** those **before** leftover sweep / leftover snapshot). Distinct from already-recommended leftover inbound: [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md) (Validation-Token, always **200**, leftover candidate / session / leftover webhook ingest — **does not import** this file; **this file never echoes Validation-Token**). Distinct from already-recommended leftover local file: [routes-ringcentral-webhook-local.md](routes-ringcentral-webhook-local.md) (gitignored JSONL — **does not import** this file). Distinct from already-recommended leftover Owner inbound-number desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (after leftover `requireApiSecret` — **does not import** this file). Distinct from leftover Wave B sibling crons: next `booking-reconciliation-cron.routes.ts` / leftover `sheet-sync-cron.routes.ts` / leftover `lead-messaging-cron.routes.ts` / leftover `cpl-correction-cron.routes.ts` / leftover `notification-cron.routes.ts` / leftover `best-relocation-ingestion-cron.routes.ts` / leftover `reporting-cron.routes.ts` / leftover `granot-automation-cron.routes.ts` / leftover `granot-lifecycle-cron.routes.ts` (each copies leftover `requireCronAuth`; **none import** this file). Distinct from leftover local runner: `scripts/dev_ops/ringcentral/ringcentral-call-log-sync-run.ts` (**asks** leftover Wave A sweep, **not** this router). Distinct from leftover Wave A letters: [observability-record-operational-event.md](observability-record-operational-event.md) (this file **asks** leftover `recordOperationalEvent` `ringcentral.analytics_reconcile.failed` with leftover `notificationCandidate: true` only on leftover snapshot throw; leftover Call Log throw **does not ask** leftover letters here — leftover Wave A sweep already persisted leftover bounded failure). Distinct from leftover Wave B secret: leftover `requireApiSecret` / leftover HMAC / leftover Granot webhook secret / leftover Twilio signature / leftover live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Call Qualification](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [Call Lead Ingestion](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one HTTP test harness.** `src/app.ts` **asks** the default export (`app.use(ringCentralCronRoutes)` on line 56 — **after** leftover already-recommended RingCentral inbound / leftover Granot inbound / leftover RingCentral local, **before** leftover next booking-reconciliation / leftover sheet-sync / leftover lead-messaging / leftover CPL / leftover notification crons, leftover Twilio desks, leftover Best Relocation / reporting / Granot automation / Granot lifecycle crons, leftover Granot automation, leftover public v1). `src/routes/ringcentral-cron.routes.test.ts` **asks** leftover `createRingCentralCronRouter` with leftover injectable leftover `runCallLogSync` / leftover `callLogSyncEnabled` and leftover `analyticsReconcileEnabled: () => false` — leftover AC-17 names leftover auth / leftover disabled never-claims / leftover `lease_held` **200** / leftover generic **500** / leftover `vercel.json` leftover `*/30 * * * *` and leftover `0 6 * * *`. Operator `hit-vantage-api` does **not** list `/api/cron/ringcentral-*` (that skill is leftover `x-api-secret` desks). Host public/unguarded tables omit these paths. `package.json` has **no** `pnpm ringcentral:*` scripts. Not this **interface**: leftover `runRingCentralCallLogSync` itself, leftover `runRingCentralAnalyticsReconcile` itself, leftover `acquireCallLogSyncLease` itself, leftover `ingestRingCentralQualifiedCall` itself, leftover `vetRingCentralCallLogRecord` itself, leftover `isRingCentralCallLogSyncEnabled` itself.
- Seams callers need: leftover `CRON_SECRET` Bearer **or** leftover `x-cron-secret` vs leftover `requireApiSecret` vs leftover Granot webhook secret vs leftover RingCentral Validation-Token vs leftover Twilio signature; leftover factory inject (`createRingCentralCronRouter`) vs leftover webhook desks that export only the live `Router()`; leftover disabled **200** `{ skipped: true }` vs leftover `lease_held` **200** `{ skipped: true, reason: "lease_held" }` vs leftover Call Log throw **500** `"Call log sync failed"` vs leftover snapshot throw **500** leftover `error.message`; leftover Call Log never-letter-on-route vs leftover snapshot leftover `notificationCandidate: true` letter; leftover `router.all` (Vercel leftover GET) vs leftover webhook leftover POST-only; leftover flag default **false** vs leftover inbound leftover webhook default **true**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**.
- Split later (only if the file outgrows one sitting): this ~155-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake the Call Log sweep if the flag is on and map a held lease to a safe skip — then once a day snapshot yesterday's inbound answered-over-two-minutes counts — never elect the sweeper here, never page Call Log here, never create a Call Lead, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `sync.ts` / `reconcile.ts` / `create.ts` / `update.ts` / `delete.ts`. Sweep stays already-recommended `call-log-sync.service.ts`. Lease stays already-recommended `call-log-sync-state.store.ts`. Snapshot stays already-recommended `analytics-reconcile.service.ts`. Flags stay leftover `ringcentral-config.ts`. Inbound stays already-recommended `ringcentral-webhook.routes.ts`. Sibling leftover crons stay their own files.

`router.all("/api/cron/ringcentral-call-log-sync")` / `router.all("/api/cron/ringcentral-analytics-reconcile")` are HTTP verbs. The owner question is: *Vercel just woke us — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. If Call Log sync is off, answer skipped and do not ask the sweep — Mongo must not see a claim. If it is on, ask the sweep. When the sweep says another run still holds the account, answer skipped `lease_held` — never 500 overlap. When the sweep throws, answer a generic 500 and do not echo the provider body. Once a day, if Analytics reconcile is on, ask the count snapshot. If that snapshot throws, write the failed letter and echo the message. Do not elect the sweeper in this file. Do not page Call Log. Do not create a Call Lead. Do not compare `x-api-secret`.*

Who elect / page / promote already lives in already-recommended `call-log-sync.service.ts`. Who claim the account already lives in already-recommended `call-log-sync-state.store.ts`. Who snapshot counts already lives in already-recommended `analytics-reconcile.service.ts`. Who name the flags already lives in leftover `ringcentral-config.ts`. Do not pull those in.

## What this file actually does

Two operations of one “after the cron secret proves this tick is ours, wake the Call Log sweep if the flag is on and map a held lease to a safe skip — then once a day snapshot yesterday's inbound answered-over-two-minutes counts” story, not “a cron CRUD dump,” and not Elect The One Sweeper / Snapshot Yesterday's Counts themselves:

1. **Wake this Call Log sweep — or skip because the flag is off or another sweep still holds the account** — `ALL /api/cron/ringcentral-call-log-sync`. Leftover `requireCronAuth` first. Leftover missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }`. Leftover mismatch **401** `{ ok: false, error: "Unauthorized" }`. Then leftover `callLogSyncEnabled()` (default leftover `isRingCentralCallLogSyncEnabled`, leftover env default **false**). False **200** `{ ok: true, skipped: true, reason: "RINGCENTRAL_CALL_LOG_SYNC_ENABLED is not true" }` and **does not ask** leftover `runCallLogSync` — leftover comment: a disabled route never claims the lease. True **asks** leftover `runCallLogSync()`. Leftover `summary.skipped && summary.skipReason === "lease_held"` **200** `{ ok: true, skipped: true, reason: "lease_held", summary }`. Else **200** `{ ok: true, skipped: false, summary }`. Throw logs leftover `ringcentral.cron.call_log_sync.failed` with leftover `errorName` only and **500** `{ ok: false, error: "Call log sync failed" }` — **does not echo** leftover `error.message`. This beat does **not** **ask** leftover `acquireCallLogSyncLease`. This beat does **not** **ask** leftover `ingestRingCentralQualifiedCall`. This beat does **not** **ask** leftover `recordOperationalEvent`. This beat does **not** compare leftover `x-api-secret`.

2. **Wake this daily count snapshot — or skip because the flag is off** — `ALL /api/cron/ringcentral-analytics-reconcile`. Same leftover `requireCronAuth`. Then leftover `analyticsReconcileEnabled()` (default leftover `isRingCentralAnalyticsReconcileEnabled`, leftover env default **false**). False **200** `{ ok: true, skipped: true, reason: "RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED is not true" }` and **does not ask** leftover `runAnalyticsReconcile`. True **asks** leftover `runAnalyticsReconcile()` and **200** `{ ok: true, skipped: false, summary }`. Throw logs leftover `ringcentral.cron.analytics_reconcile.failed` with leftover `err`, **asks** leftover `recordOperationalEvent` leftover `ringcentral.analytics_reconcile.failed` (`category: "ringcentral"`, leftover `workflow: "ringcentral_analytics_reconcile"`, leftover `notificationCandidate: true`, leftover `dedupeKey` leftover `ringcentral.analytics_reconcile.failed:${VERCEL_ENV ?? NODE_ENV ?? "development"}`, leftover `details.causeMessage` / leftover `errorMessage` = leftover `error.message`), then **500** `{ ok: false, error: message }` — leftover **does echo** leftover `error.message`. This beat does **not** map leftover `lease_held` (leftover snapshot has no lease). This beat does **not** **ask** leftover `runCallLogSync`. This beat does **not** **ask** leftover `ingestRingCentralQualifiedCall`.

`requireCronAuth` / leftover injectable leftover `RingCentralCronRouteDeps` are beats inside these operations, not extra owner stories. Leftover `createRingCentralCronRouter` is the factory **adapter** leftover AC-17 already uses. The default export is leftover `createRingCentralCronRouter()` with live leftover Wave A defaults.

There is no third elect-the-sweeper operation. Leftover Mongo leftover `key: "account"` elects inside leftover Wave A. There is no fourth leftover inbound-webhook operation. There is no fifth leftover Owner inbound-number operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake the Call Log sweep if the flag is on and map a held lease to a safe skip — then once a day snapshot yesterday's inbound answered-over-two-minutes counts — never elect the sweeper here, never page Call Log here, never create a Call Lead, never use the API secret.” Already-recommended leftover sweep / leftover lease / leftover snapshot / leftover flags / leftover letters already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a leftover Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent a leftover HMAC **adapter** so “cron matches leftover Owner desks.” Do not invent a leftover lease **adapter** beside already-recommended leftover `acquireCallLogSyncLease`. Do not invent a CRUD folder so `sync.ts` / `reconcile.ts` each get a file.

Do not move leftover `runRingCentralCallLogSync` into this file so “the route owns the sweep.” Do not move leftover `runRingCentralAnalyticsReconcile` into this file so “the route owns the rollup.” Do not move leftover `requireCronAuth` into leftover `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** leftover sibling cron. Do not mount this router inside leftover `v1.routes.ts` so “one file owns every cron.” Do not merge this router into already-recommended leftover inbound so “one file owns hybrid Call Qualification.” Do not merge this router into leftover next `lead-messaging-cron.routes.ts` so “one file owns every `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createRingCentralCronRouter` | `acceptThisRingCentralCronDesk` | leftover AC-17 injects leftover sweep / leftover flags; leftover `app.ts` mounts leftover live defaults |
| `default` router | `ringCentralCronDesk` | leftover `createRingCentralCronRouter()` — leftover `app.ts` mounts the instance **after** leftover inbound, **before** leftover sibling crons |
| `RingCentralCronRouteDeps` | `InjectableCronWakeAdaptersForFileTests` | leftover test replaces leftover sweep / leftover flags; leftover snapshot stays disabled in today’s harness |
| `ALL /api/cron/ringcentral-call-log-sync` (today unexported handler) | `wakeThisCallLogSweepOverHttp` | leftover flag **then** leftover sweep **then** leftover `lease_held` map |
| `ALL /api/cron/ringcentral-analytics-reconcile` (today unexported handler) | `wakeThisDailyCountSnapshotOverHttp` | leftover flag **then** leftover snapshot **then** leftover failed letter |

Keep leftover `createRingCentralCronRouter` / leftover default as one-line aliases until leftover `app.ts` and leftover AC-17 migrate. Do not make callers learn leftover `skipReason` / leftover `leaseOwnerHash` / leftover `urlKey` as the domain language. Do **not** export leftover `requireCronAuth` so “the test can unit the helper.” Do **not** drop leftover factory inject in this rename so “this desk matches leftover inbound” — leftover AC-17 already **asks** it.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after leftover sweep says the account is held:

```ts
type CallLogSweepSkippedBecauseTheAccountLeaseIsHeldOverHttp = {
  ok: true
  skipped: true
  reason: "lease_held"
  summary: /* leftover PII-free WhetherTheSweepSkippedAdvancedOrFailed */
}
```

That is the **200** handoff from “Vercel woke us again while another sweep still owns the account” to “do not retry-storm, do not 500, do not claim.” Do **not** collapse leftover `lease_held` into leftover **500** so “overlap looks like failure.” Do **not** collapse leftover disabled skip into leftover `lease_held` so “one skip owns every no-op.” Do **not** add leftover `groups[]` onto leftover snapshot **200** so “the owner can see every company number on the cron body.”

Leave leftover `runRingCentralCallLogSync` on already-recommended leftover sweep. Leave leftover `acquireCallLogSyncLease` on already-recommended leftover state store. Leave leftover `runRingCentralAnalyticsReconcile` on already-recommended leftover snapshot. Leave leftover flags on leftover `ringcentral-config.ts`. Leave leftover inbound on already-recommended leftover `ringcentral-webhook.routes.ts`. Leave leftover sibling crons on their leftover next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-cron.routes.ts
// Vercel just woke us — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// If Call Log sync is off, answer skipped and do not ask the sweep.
// If it is on, ask the sweep.
// When another run still holds the account, answer skipped lease_held —
// never 500 overlap.
// When the sweep throws, answer a generic 500.
// Once a day, if Analytics reconcile is on, ask the count snapshot.
// If that snapshot throws, write the failed letter and echo the message.
// Do not elect the sweeper in this file.
// Do not page Call Log.
// Do not create a Call Lead.
// Do not compare x-api-secret.

export function acceptThisRingCentralCronDesk(deps = {}) {
  const wakeTheSweep = deps.runCallLogSync ?? runRingCentralCallLogSync
  const wakeTheSnapshot =
    deps.runAnalyticsReconcile ?? runRingCentralAnalyticsReconcile
  const callLogSweepIsOn =
    deps.callLogSyncEnabled ?? isRingCentralCallLogSyncEnabled
  const dailySnapshotIsOn =
    deps.analyticsReconcileEnabled ?? isRingCentralAnalyticsReconcileEnabled
  const desk = Router()
  desk.all(
    "/api/cron/ringcentral-call-log-sync",
    proveThisCronTickIsOurs,
    (req, res) => wakeThisCallLogSweepOverHttp(req, res, wakeTheSweep, callLogSweepIsOn),
  )
  desk.all(
    "/api/cron/ringcentral-analytics-reconcile",
    proveThisCronTickIsOurs,
    (req, res) =>
      wakeThisDailyCountSnapshotOverHttp(req, res, wakeTheSnapshot, dailySnapshotIsOn),
  )
  return desk
}

export default acceptThisRingCentralCronDesk()

// ── 1. Wake this Call Log sweep ───────────────────────────

async function wakeThisCallLogSweepOverHttp(req, res, wakeTheSweep, callLogSweepIsOn) {
  if (!callLogSweepIsOn()) {
    return skippedBecauseCallLogSyncIsOff(res)
  }

  try {
    const summary = await wakeTheSweep()
    if (theAccountLeaseIsStillHeld(summary)) {
      return skippedBecauseAnotherSweepStillOwnsTheAccount(res, summary)
    }
    return theSweepFinished(res, summary)
  } catch (error) {
    rememberTheSweepThrewWithoutTheProviderBody(error)
    return callLogSyncFailedWithoutEchoingTheThrow(res)
  }
}

// ── 2. Wake this daily count snapshot ─────────────────────

async function wakeThisDailyCountSnapshotOverHttp(
  req,
  res,
  wakeTheSnapshot,
  dailySnapshotIsOn,
) {
  if (!dailySnapshotIsOn()) {
    return skippedBecauseAnalyticsReconcileIsOff(res)
  }

  try {
    const summary = await wakeTheSnapshot()
    return theCountRollupWasStored(res, summary)
  } catch (error) {
    await writeDownThatTheDailyCountSnapshotFailed(req, error)
    return analyticsReconcileFailedAndEchoTheMessage(res, error)
  }
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

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches leftover `CRON_SECRET`. Missing secret is 500, not 401. A mismatch is 401. If leftover Call Log sync is off, 200 skipped and do not ask leftover sweep — Mongo must not see a claim. If it is on, ask leftover sweep. Leftover `lease_held` is 200 skipped, never 500. A throw is generic `"Call log sync failed"`. Once a day, if leftover Analytics reconcile is on, ask leftover snapshot. A snapshot throw writes leftover `ringcentral.analytics_reconcile.failed` and echoes leftover `error.message`. Do not elect. Do not page Call Log. Do not create a Call Lead. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/ringcentral-call-log-sync")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Overlap is a skip, never HTTP 500.** Leftover AC-17 and leftover knowledge lock leftover `lease_held` to leftover **200** `{ ok: true, skipped: true }`. Leftover Wave A already returned leftover `skipped` / leftover `skipReason`. This file only maps. Do not silently **500** leftover overlap so “Vercel retries a held lease.” Do not silently omit leftover `summary` on leftover `lease_held` so “one skip body owns disabled and held.”

2. **A disabled Call Log tick never claims.** Leftover flag is leftover **before** leftover `runCallLogSync`. Leftover Wave A elect lives inside leftover sweep. Do not silently **ask** leftover sweep when leftover flag is false so “the service can no-op.” Do not silently **ask** leftover `acquireCallLogSyncLease` from this file so “the route owns elect.”

3. **Call Log 500 is generic; leftover snapshot 500 echoes leftover `error.message`.** Leftover AC-17 proves leftover `"Call log sync failed"` hides leftover phone / leftover Bearer / leftover token. Leftover snapshot catch leftover `error.message` onto leftover HTTP **and** leftover letter leftover `causeMessage`. Leftover Wave A snapshot already named this as leftover Wave B. Do not silently sanitize leftover snapshot 500 in this rename so “one refuse owns both ticks” without a paired HTTP proof that leftover auto-resolve leftover `dedupeKey` still matches leftover Wave A leftover completed. Do not silently echo leftover Call Log leftover `error.message` so “one echo owns both ticks” — leftover AC-17 forbids it.

4. **Failure letter lives on leftover snapshot throw only.** Leftover Call Log throw leftover logs leftover `errorName` and stops. Leftover Wave A sweep already persisted leftover bounded leftover `lastError`. Leftover snapshot throw leftover **asks** leftover `recordOperationalEvent` leftover `notificationCandidate: true`. Leftover Wave A leftover completed leftover auto-resolves that leftover `dedupeKey`. Do not silently emit leftover `ringcentral.call_log_sync.failed` from this file so “one route owns every RingCentral letter.” Do not silently drop leftover snapshot letter so “this desk matches leftover Call Log silence.”

5. **Leftover snapshot has no leftover `lease_held` map.** Leftover Wave A leftover snapshot leftover `insertOne`s with no leftover unique window and no leftover lease. A second leftover 6am tick leftover writes a second row. Do not silently copy leftover Call Log leftover account lease onto leftover snapshot so “every cron elects.” Do not silently **200** leftover `{ skipped: true, reason: "lease_held" }` from leftover snapshot so “one skip owns both ticks.”

6. **`requireCronAuth` is a copy of leftover sibling crons.** Leftover sheet-sync / leftover booking-recon / leftover lead-messaging / leftover Granot lifecycle use leftover same leftover Bearer-or-header leftover 500/401. Leftover reporting leftover 503s leftover `"CRON_SECRET is not configured."` Leftover CPL leftover `"CRON_SECRET is not configured"`. Do not silently extract leftover shared leftover `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** leftover desk **and** leftover siblings. Park the copy.

7. **Factory inject is load-bearing here; leftover inbound has none.** Leftover AC-17 leftover **asks** leftover `createRingCentralCronRouter`. Leftover webhook desks leftover export only leftover live `Router()`. Do not drop leftover inject so “this desk matches leftover inbound.” Do not add leftover inject onto leftover inbound in this rename.

8. **Today’s harness never wakes leftover snapshot.** Leftover `analyticsReconcileEnabled: () => false` leftover plus leftover no leftover `runAnalyticsReconcile` inject. Leftover `vercel.json` leftover `0 6 * * *` is the only leftover snapshot proof. Do not treat leftover schedule-parse as leftover HTTP leftover snapshot. Add leftover flag-off / leftover 200 / leftover throw-letter proofs at leftover `wakeThisDailyCountSnapshotOverHttp`.

9. **`router.all` is leftover GET-and-POST, not leftover POST-only.** Leftover knowledge leftover `GET|POST`. Leftover Vercel leftover cron leftover GET. Leftover AC-17 leftover POSTs leftover Call Log only. Do not silently switch leftover `router.post` so “cron matches leftover Twilio.” Do not silently **405** leftover GET so “one verb owns every tick.”

10. **Both leftover flags default false.** Leftover inbound leftover webhook leftover defaults **true**. Leftover deploy leftover can leftover ship leftover wiring leftover dormant. Do not silently default leftover Call Log leftover on so “hybrid C is the checked-in posture.”

11. **This desk never creates a Call Lead and never talks leftover RingCentral REST.** Leftover sweep leftover **asks** leftover promote. Leftover snapshot leftover **asks** leftover Analytics Aggregate. This file leftover **asks** leftover those leftover two leftover exports only. Do not silently **ask** leftover `ingestRingCentralQualifiedCall` from this file so “one hop owns the Call Lead.” Do not merge this router into already-recommended leftover inbound so “one file owns hybrid Call Qualification.”

12. **This desk never uses leftover `x-api-secret`, leftover HMAC, leftover Granot webhook secret, leftover Twilio signature, or leftover live-host leftover `x-debug-token`.** Leftover `app.ts` leftover mounts leftover **before** leftover `v1Routes`. Leftover `CRON_SECRET` leftover is leftover handshake. Do not remount leftover `requireApiSecret` so “it matches leftover reporting.” Do not hide these leftover ALLs behind leftover Owner HMAC so “cron matches leftover admin.”

13. **Host tables and leftover `hit-vantage-api` omit `/api/cron/ringcentral-*`.** That skill leftover is leftover `x-api-secret` desks. Do not add leftover cron leftover paths to leftover `hit-vantage-api` in this rename. Do not remount leftover `requireApiSecret` so “the host table wins.”

14. **Leave sibling modules alone.** Leftover `runRingCentralCallLogSync` / leftover `runRingCentralAnalyticsReconcile` / leftover flags / leftover `recordOperationalEvent` are already the right **depth**. This file orchestrates the HTTP **adapter**.

15. **Do not treat leftover inbound / leftover local file / leftover Owner inbound-number / leftover Twilio voice / leftover SMS status / leftover sibling crons / leftover public v1 / leftover reporting / leftover Best Relocation / leftover Granot automation / leftover Granot lifecycle drain as this story.** Next leftover `booking-reconciliation-cron.routes.ts` leftover is leftover rematch. Later leftover `lead-messaging-cron.routes.ts` leftover is leftover drain. Do not teach this file leftover `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisRingCentralCronDesk` (mounted on `app.ts` **after** leftover inbound, **before** leftover sibling crons as the default export) and the two HTTP operations above.

Today `ringcentral-cron.routes.test.ts` names Call Log AC-17 through factory inject. Keep those proofs. Add snapshot HTTP at the same **interface** (do not boot live RingCentral, do not page Call Log in the route file):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"` and `runCount === 0`.
- Bearer mismatch **401** `"Unauthorized"` and `runCount === 0`.
- Matching `x-cron-secret` **200**.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / `x-debug-token` are **not** accepted here.

**Wake the Call Log sweep — never elect here**
- Disabled **200** `RINGCENTRAL_CALL_LOG_SYNC_ENABLED is not true` and never **asks** leftover sweep.
- `lease_held` **200** `{ ok: true, skipped: true, reason: "lease_held" }` and no `"error"`.
- Success **200** `{ skipped: false, summary }` is PII-free (no phone / caller / Bearer / token).
- Throw **500** `"Call log sync failed"` hides `error.message`.
- This beat does **not** **ask** leftover `acquireCallLogSyncLease` / leftover `ingestRingCentralQualifiedCall` / leftover `recordOperationalEvent`.

**Wake the daily count snapshot — never create a Call Lead**
- Disabled **200** `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED is not true` and never **asks** leftover snapshot.
- Success **200** `{ skipped: false, summary }` has no `groups` / no caller.
- Throw **asks** leftover `recordOperationalEvent` `ringcentral.analytics_reconcile.failed` `notificationCandidate: true` then **500** echoes `error.message`.
- This beat does **not** map `lease_held` and does **not** **ask** leftover `ingestRingCentralQualifiedCall`.

**Cadence**
- `vercel.json` `/api/cron/ringcentral-call-log-sync` is `*/30 * * * *`.
- `vercel.json` `/api/cron/ringcentral-analytics-reconcile` is `0 6 * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(ringCentralCronRoutes)` after leftover inbound, before leftover sibling crons / leftover `v1Routes`.
- Already-recommended leftover inbound and leftover next rematch stay mounted apart.

**Not this file**
- Sweep stays on already-recommended [ringcentral-call-log-sync.md](ringcentral-call-log-sync.md).
- Lease stays on already-recommended [ringcentral-call-log-sync-state-store.md](ringcentral-call-log-sync-state-store.md).
- Snapshot stays on already-recommended [ringcentral-analytics-reconcile.md](ringcentral-analytics-reconcile.md).
- Promote stays on already-recommended [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md).
- Inbound stays on already-recommended [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `theAccountLeaseIsStillHeld`, `callLogSyncFailedWithoutEchoingTheThrow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a second factory so “the test can no longer see the live Wave A defaults.” `app.ts` must still **ask** `createRingCentralCronRouter()`.

## What I would not do

- A `RingCentralCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, skipped: false, summary })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `sync.ts` / `reconcile.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the leftover `lease_held` **seam**: do not 500 leftover overlap.
- Breaking the leftover disabled-never-claims **seam**: do not leftover **ask** leftover sweep when leftover flag is leftover false.
- Breaking the leftover Call Log leftover generic-500 **seam**: do not leftover echo leftover `error.message`.
- Breaking the leftover cron-secret **seam**: do not remount leftover `requireApiSecret` leftover or leftover admit leftover HMAC / leftover Granot webhook secret / leftover Twilio signature / leftover `x-debug-token` leftover here.
- Treating leftover `runRingCentralCallLogSync`, leftover `runRingCentralAnalyticsReconcile`, leftover `acquireCallLogSyncLease`, leftover `ingestRingCentralQualifiedCall`, leftover inbound, leftover local file, leftover Owner inbound-number, leftover Twilio voice, leftover SMS status, leftover sibling crons, leftover public v1, leftover reporting, leftover Best Relocation, leftover Granot automation, leftover Granot lifecycle drain as this story.
- Inventing a leftover shared-cron-auth / leftover Domain Command / leftover Zod **adapter** that has only one leftover caller in this pass.
- Silently 500 leftover `lease_held`, leftover asking leftover sweep while leftover disabled, leftover merging this leftover router into leftover inbound, leftover creating a leftover Call Lead, leftover remounting leftover `requireApiSecret`, or leftover extracting leftover `requireCronAuth` leftover while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
