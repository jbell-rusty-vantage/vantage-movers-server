# After The Cron Secret Proves This Tick Is Ours, Email The Owner This Morning's Observational Card Then Retry Failed Delivery Rows — Never Build The Card Here, Never Talk To SendGrid Here, Never Pick Due Rows Here, Never Run The Named Daily-Owner Report, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 24 of this service — `notification-cron.routes.ts`
- Remaining in this service: `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/notification-cron.routes.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service and no Routes Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (cron routes stay thin: authenticate with `CRON_SECRET`, call digest/retry services, and record cron failures as operational events without awaiting anything that could block the response unnecessarily; best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron). Distinct from already-recommended morning letter + due-row picker: [observability-notification-digest.md](observability-notification-digest.md) (`sendDailyOwnerDigest` / `retryFailedNotifications` — this file **asks** both in one `try` after `requireCronAuth`; that file skips the letter without Mongo when email or the daily-letter flag is off, or when `ownerToEmails` is empty; otherwise **asks** leftover `getObservabilityOverview({})` then leftover `sendNotification` with `purpose: "daily_digest"`; retry finds due failed Delivery rows and **asks** leftover `retryNotificationDeliveryInPlace`; **this file never builds the card, never talks to SendGrid, never picks due rows, and never writes a Delivery row**. Wave A already said: a card throw skips retry; a skipped or failed letter does not). Distinct from already-recommended leftover Observational card: [observability-admin-observability.md](observability-admin-observability.md) (`getObservabilityOverview({})` is Eastern start-of-day through now — Wave A **asks** that card; leftover Owner HTTP `GET /api/v1/admin/observability/overview` **asks** it after leftover `requireApiSecret`; **this file never asks the card**). Distinct from already-recommended leftover Delivery row: [observability-email-notification.md](observability-email-notification.md) (Wave A **asks** `sendNotification` / `retryNotificationDeliveryInPlace`; **this file never imports it**). Distinct from already-recommended leftover immediate policy: [observability-notification-policy.md](observability-notification-policy.md) (`dispatchEventNotifications` — leftover `notification.*` / leftover category `notification` stay quiet; leftover `cron.auth.failed` is developer-only; **this file never asks policy** — leftover `recordOperationalEvent` does). Distinct from already-recommended leftover letters: [observability-record-operational-event.md](observability-record-operational-event.md) (this file **asks** it `void` on missing secret / mismatch / unexpected throw; Wave A digest **never** writes a letter; leftover record never throws). Distinct from already-recommended leftover named reports: [observability-operational-reports.md](observability-operational-reports.md) (`daily-owner-operational-summary` is a citeable run — **this file never runs it**). Distinct from already-recommended leftover Incident upsert: [observability-operational-incident.md](observability-operational-incident.md) (`digest_sent_at` lives on the Incident document; **this file never writes it**; leftover record may open/grow an Incident from this file’s letters). Distinct from already-recommended Owner mount: [routes-v1.md](routes-v1.md) (`GET /api/v1/admin/observability/{overview,facets,events,incidents,notifications,reports}` after leftover `requireApiSecret`; **does not import** this file). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (mode gate **on the route**, no-op unless `queued`, HTTP `{ skipped: true }` — **does not import** this file; **this file has no mode gate**). Distinct from already-recommended Lead Messaging cron: [routes-lead-messaging-cron.md](routes-lead-messaging-cron.md) (always-ask drain after `connectMongo`, **200** `{ summary }`, **500** may echo `error.message`, **no** letter from the route — **does not import** this file). Distinct from already-recommended CPL cron: [routes-cpl-correction-cron.md](routes-cpl-correction-cron.md) (`connectMongo` then `runDue` `limit: 5`, **500** generic `CPL_CORRECTION_DRAIN_FAILED`, **no** letter from the route — **does not import** this file). Distinct from already-recommended rematch cron: [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (flag default **on**, HTTP `{ skipped: true }` when off — **does not import** this file). Distinct from already-recommended Call Log cron: [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (`lease_held` **200** + factory inject; flags default **false** — **does not import** this file). Distinct from leftover Vercel schedule: `vercel.json` path `/api/cron/notifications-digest-daily` at `0 12 * * *` UTC. Distinct from unused leftover `getAlertEmailDailyDigestCronTime()` (default `"12:00"`) — Vercel owns the cadence; **this file never reads it**. Distinct from leftover email flags: leftover `EMAIL_NOTIFICATIONS_ENABLED` (default on) + leftover `EMAIL_NOTIFICATIONS_MODE` (default `log_only`) + leftover `ALERT_EMAIL_DAILY_DIGEST_ENABLED` (default on) live in `src/config/domain/observability.ts`; **this file never asks those helpers** — Wave A digest does. Distinct from other secrets: leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — it names “Workflow Observational” in the intro and does not define a morning letter; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(notificationCronRoutes)` on line 61 — **after** already-recommended RingCentral cron / rematch cron / Sheet Sync cron / Lead Messaging cron / CPL cron, **before** already-recommended Twilio desks, next Best Relocation / reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1). Wave A folder tests do **not** exist for digest (`notificationDigest.service.test.ts` is missing). Operator `hit-vantage-api` lists Owner `GET /api/v1/admin/observability/overview` and `GET .../notifications`, **not** `/api/cron/notifications-digest-daily`. Host public/unguarded tables omit this path. Not this **interface**: `sendDailyOwnerDigest` itself, `retryFailedNotifications` itself, leftover `getObservabilityOverview` itself, leftover `sendNotification` itself, leftover `retryNotificationDeliveryInPlace` itself, leftover `dispatchEventNotifications` itself, leftover `runOperationalReport` itself, leftover `isEmailNotificationsEnabled` / leftover `isAlertEmailDailyDigestEnabled` / leftover `getAlertEmailDailyDigestCronTime` themselves.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs leftover `requireApiSecret` vs Owner HMAC; always-ask letter-then-retry **200** `{ ok: true, digest, retry }` (disabled letter is still 200 with `digest.skipped === true`) vs already-recommended Sheet Sync **200** `{ skipped: true }` vs rematch flag-off skip vs Call Log `lease_held`; unexpected throw **500** `{ ok: false, error: error.message }` (or `"Notification digest failed"` when the throw is not an `Error`) vs already-recommended CPL generic `CPL_CORRECTION_DRAIN_FAILED`; card throw skips retry vs skipped/failed letter still retries; `void recordOperationalEvent` on auth fail + digest fail vs already-recommended CPL / Lead Messaging / Sheet Sync routes that never write a letter; no `connectMongo` on this desk vs already-recommended Lead Messaging / CPL cron that open Mongo here (Wave A letter may skip without Mongo; leftover overview / leftover retry connect themselves); no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; daily `0 12 * * *` UTC vs sibling `*/5`; no route-level email / digest-flag gate vs Wave A helpers. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no publish **seam**. There is no route-level mode **seam**. There is no queue-consumer **seam**.
- Split later (only if the file outgrows one sitting): this ~102-line file is one sitting if you read it as after the cron secret proves this tick is ours, email the owner this morning’s Observational card then retry failed Delivery rows — never build the card here, never talk to SendGrid here, never pick due rows here, never run the named daily-owner report, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `digest.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`. Letter / retry stay already-recommended `notificationDigest.service.ts`. Card stays already-recommended `adminObservability.service.ts`. SendGrid / in-place retry stay already-recommended `emailNotification.service.ts`. Letters persist stays already-recommended `recordOperationalEvent.ts`. Owner HTTP stays leftover `v1.routes.ts`. Best Relocation heartbeat stays next `best-relocation-ingestion-cron.routes.ts`.

`router.all("/api/cron/notifications-digest-daily")` is an HTTP verb. The owner question is: *Vercel just woke us at noon UTC — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured and write `cron.auth.failed` — do not pretend this is unauthorized, and do not page the owner. If it does not match, refuse it and write the same key as a warn. Then ask Wave A to email this Eastern morning’s Observational card. Then ask Wave A to retry recently failed Delivery rows. Echo both bags. A disabled letter is still 200 with `skipped: true` — not an HTTP skip. A throw from the card is 500 and skips retry. A skipped or failed letter still retries. Write `notification.digest_cron.failed` only on that unexpected throw, and do not wait for the letter to finish before answering. Do not build the card in this file. Do not talk to SendGrid. Do not pick due rows. Do not run the named daily-owner report. Do not stamp `digest_sent_at`. Do not compare `x-api-secret`.*

Who skip or stamp the morning letter / pick due Delivery rows already lives in already-recommended `notificationDigest.service.ts`. Who build the Eastern card already lives in already-recommended `adminObservability.service.ts`. Who talk to SendGrid / bump the same Delivery row already lives in already-recommended `emailNotification.service.ts`. Who write the happening down already lives in already-recommended `recordOperationalEvent.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, email the owner this morning’s Observational card then retry failed Delivery rows” story, not “a cron CRUD dump,” and not Email The Owner This Morning’s Observational Card / Retry Recently Failed Delivery Rows / Show The Observational Desk themselves:

1. **Wake this morning’s Observational letter and the due Delivery retries** — `ALL /api/cron/notifications-digest-daily`. `requireCronAuth` first. Missing `CRON_SECRET` **void-asks** leftover `recordOperationalEvent` (`level: "error"`, `eventKey: "cron.auth.failed"`, `category: "cron"`, `workflow: "notification_digest"`, `statusCode: 500`, `details.reason: "missing_cron_secret"`, `notificationCandidate: false`, `reportable: true`) and **500** `{ ok: false, error: "CRON_SECRET is not set" }`. Mismatch **void-asks** the same key as `level: "warn"`, `statusCode: 401`, `details.reason: "invalid_cron_secret"`, same `notificationCandidate: false` / `reportable: true`, and **401** `{ ok: false, error: "Unauthorized" }`. Then **asks** `sendDailyOwnerDigest()`, then `retryFailedNotifications()`, and **200** `{ ok: true, digest, retry }`. There is **no** HTTP `skipped`. Disabled / no-recipients letter is still **200** `{ digest: { skipped: true, reason: "digest_disabled" | "no_recipients", sent: false }, retry }` — this file still **asks** retry. Unexpected throw logs `notification.cron.digest.failed`, **void-asks** leftover `recordOperationalEvent` (`level: "error"`, `eventKey: "notification.digest_cron.failed"`, `category: "cron"`, `workflow: "notification_digest"`, `statusCode: 500`, `dedupeKey: notification.digest_cron.failed:${VERCEL_ENV ?? NODE_ENV ?? "development"}`, `notificationCandidate: true`, `details.causeMessage` / `errorMessage`), and **500** `{ ok: false, error: error.message }` (or `"Notification digest failed"` when the throw is not an `Error`). This beat does **not** **ask** leftover `connectMongo`. This beat does **not** **ask** leftover `getObservabilityOverview`. This beat does **not** **ask** leftover `sendNotification`. This beat does **not** **ask** leftover `retryNotificationDeliveryInPlace`. This beat does **not** **ask** leftover `runOperationalReport`. This beat does **not** **ask** leftover `isEmailNotificationsEnabled` / leftover `isAlertEmailDailyDigestEnabled` / leftover `getAlertEmailDailyDigestCronTime`. This beat does **not** **ask** leftover `getSheetSyncMode` / a rematch flag / a RingCentral flag. This beat does **not** compare leftover `x-api-secret`.

`requireCronAuth` is a beat inside this operation, not an extra owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second build-the-card operation. Wave A leftover overview lives on leftover Owner GET. There is no third talk-to-SendGrid operation. There is no fourth pick-due-rows operation. There is no fifth run-the-named-report operation. There is no sixth Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, email the owner this morning’s Observational card then retry failed Delivery rows — never build the card here, never talk to SendGrid here, never pick due rows here, never run the named daily-owner report, never use the API secret.” Already-recommended letter / retry / leftover card / leftover SendGrid / leftover letters persist already live in deeper **modules**. Do not pull those in. Do not invent a `NotificationCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** Wave A letter then retry. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner overview.” Do not invent a route-level email **adapter** so “this desk matches Sheet Sync queued-only.” Do not invent a lease **adapter** so “every cron elects one drain.” Do not invent a queue **adapter** so “every morning uses `@vercel/queue`.” Do not invent a CRUD folder so `digest.ts` / `retry.ts` / `cron.ts` each get a file.

Do not move `sendDailyOwnerDigest` into this file so “the route owns the letter.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside `v1.routes.ts` so “one file owns every Observational start.” Do not merge this router into leftover Owner `observability/*` so “one file owns the morning card and the desk.” Do not merge this router into already-recommended CPL / Lead Messaging cron so “one file owns every `CRON_SECRET` tick.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `morningObservationalLetterCronDesk` | `app.ts` mounts the instance **after** CPL cron, **before** Twilio desks / next Best Relocation cron |
| `ALL /api/cron/notifications-digest-daily` (today unexported handler) | `wakeThisMorningsObservationalLetterAndDueDeliveryRetriesOverHttp` | auth **then** letter **then** retry; no HTTP skip |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn leftover `DailyDigestResult` / leftover `digest_disabled` / leftover `ALERT_EMAIL_DAILY_DIGEST_CRON_TIME` / leftover `digest_sent_at` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createNotificationCronRouter({ sendDigest, retryFailed })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after Wave A returns both bags:

```ts
type MorningObservationalLetterFinishedOverHttp = {
  ok: true
  digest: { skipped: boolean; reason?: string; sent: boolean }
  retry: { retried: number }
}
```

That is the **200** handoff from “Vercel woke us” to “Wave A skipped or stamped the morning letter, then counted in-place retries.” Do **not** add `skipped: true` onto that bag so “this desk matches Sheet Sync / rematch.” Do **not** collapse `digest.skipped === true` into HTTP `{ reason: "digest_disabled" }` so “one skip owns disabled.” Do **not** copy RingCentral `{ reason: "lease_held" }` onto this desk so “every cron maps overlap.” Do **not** add `overview` / Incident titles / Owner emails / `body_text` onto the **200** so “the owner can see the letter on the cron body.”

Leave `sendDailyOwnerDigest` / `retryFailedNotifications` on already-recommended `notificationDigest.service.ts`. Leave leftover overview on already-recommended `adminObservability.service.ts`. Leave leftover SendGrid on already-recommended `emailNotification.service.ts`. Leave leftover letters persist on already-recommended `recordOperationalEvent.ts`. Leave Owner HTTP on leftover `v1.routes.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// notification-cron.routes.ts
// Vercel just woke us at noon UTC — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured and write cron.auth.failed.
// If it does not match, refuse it and write the same key as a warn.
// Ask Wave A to email this Eastern morning’s Observational card.
// Then ask Wave A to retry recently failed Delivery rows.
// Echo both bags.
// A disabled letter is still 200 with skipped true — not an HTTP skip.
// A throw from the card is 500 and skips retry.
// A skipped or failed letter still retries.
// Write notification.digest_cron.failed only on that unexpected throw.
// Do not wait for the letter write before answering.
// Do not build the card in this file.
// Do not talk to SendGrid.
// Do not pick due rows.
// Do not run the named daily-owner report.
// Do not stamp digest_sent_at.
// Do not compare x-api-secret.

export default acceptThisMorningObservationalLetterCronDesk()

function acceptThisMorningObservationalLetterCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/notifications-digest-daily",
    proveThisCronTickIsOurs,
    wakeThisMorningsObservationalLetterAndDueDeliveryRetriesOverHttp,
  )
  return desk
}

// ── 1. Wake this morning’s Observational letter and the due Delivery retries ─

async function wakeThisMorningsObservationalLetterAndDueDeliveryRetriesOverHttp(req, res) {
  try {
    const digest = await emailTheOwnerThisMorningsObservationalCard()
    const retry = await retryRecentlyFailedDeliveryRowsOnTheSameRow()
    return theMorningLetterAndRetriesFinished(res, digest, retry)
  } catch (error) {
    rememberTheMorningLetterTickThrew(req, error) // log + void-ask notification.digest_cron.failed
    return morningLetterFailedAndMayEchoTheMessage(res, error)
  }
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) {
    void writeThatTheCronSecretIsMissing(req) // cron.auth.failed, notificationCandidate false
    return cronIsMisconfigured(res) // "CRON_SECRET is not set"
  }
  if (bearerMatches(req, expected) || headerSecretMatches(req, expected)) {
    return next()
  }
  void writeThatTheCronSecretDidNotMatch(req) // cron.auth.failed warn
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500 `"CRON_SECRET is not set"` plus `cron.auth.failed`, not 401. A mismatch is 401 plus the same key as a warn. Neither auth letter pages the owner. Ask the morning letter, then ask retry, and echo `{ digest, retry }`. Disabled letter is still 200 with `digest.skipped`. A card throw is 500 that may echo `error.message`, skips retry, and writes `notification.digest_cron.failed` without waiting. Do not build the card. Do not talk to SendGrid. Do not pick due rows. Do not run the named daily-owner report. Do not stamp `digest_sent_at`. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/notifications-digest-daily")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk has no email or digest-flag gate; Sheet Sync and rematch do.** Already-recommended Sheet Sync **200** `{ skipped: true }` and never **asks** drain unless `queued`. Already-recommended rematch **200** `{ skipped: true }` when the flag is `false`. This file always **asks** Wave A letter then retry. Wave A letter returns `{ skipped: true, reason: "digest_disabled" }` when leftover email is off **or** leftover `ALERT_EMAIL_DAILY_DIGEST_ENABLED` is off (default **on**). Leftover `EMAIL_NOTIFICATIONS_MODE` defaults leftover `log_only`. A host with email off still **200**s `{ digest: { skipped: true, … }, retry: { retried: 0 } }`. Do not copy the Sheet Sync queued-only fence here so “every cron matches.” Do not **ask** leftover `isAlertEmailDailyDigestEnabled` on the route so “disabled never enters Wave A” without a paired HTTP proof that leftover retry still runs when the letter flag is off and email is on.

2. **One `try` wraps letter then retry. A card throw skips retry; a skipped letter does not.** Wave A leftover overview **can** throw (`connectMongo` + aggregates). Wave A leftover `sendNotification` never throws. CONTRADICTIONS already locked the Eastern SOD window. Do not split into two `try`s so “retry still runs after a card throw” without a product decision. Do not swallow the card throw as **200** `{ digest: { skipped: true, reason: "overview_failed" } }` so “the comment’s never-throw becomes true.”

3. **The file comment lies about “never throw out of the route.”** Both Wave A exports are best-effort and Wave A send never throws. This file still **500**s an unexpected throw. “Never throw” means the catch answers Express — not that Vercel sees 200. Do not drop the catch so “this desk matches rematch unhandled Express.” Do not 200 the catch so “cron never pages Vercel.”

4. **Route 500 may echo `error.message`.** Already-recommended Lead Messaging / Sheet Sync do the same. Already-recommended CPL **500**s generic `CPL_CORRECTION_DRAIN_FAILED`. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Already-recommended rematch has no try/catch. Do not sanitize this 500 so “this desk matches CPL” without a paired HTTP proof that operators still do not see an Owner email / Incident title / SendGrid body on the cron JSON. The leftover letter `details.causeMessage` already keeps the same text.

5. **This desk writes letters; already-recommended CPL / Lead Messaging / Sheet Sync crons do not.** Missing secret and mismatch write `cron.auth.failed` (`notificationCandidate: false`, `reportable: true`). Unexpected throw writes `notification.digest_cron.failed` (`notificationCandidate: true`, `dedupeKey` is env-wide). Already-recommended leftover policy lists leftover `cron.auth.failed` as developer-only. Leftover `notification.digest_cron.failed` starts with leftover `notification.`, so leftover policy stays quiet even though leftover `notificationCandidate` is true. Do not drop the prefix so “the owner gets paged when digest throws” without a product decision. Do not set leftover `notificationCandidate: false` on the digest-fail letter so “the field matches the fence.” Do not **await** leftover `recordOperationalEvent` so “the 500 waits for Mongo.”

6. **Auth letters never page the owner on today’s gates.** Missing secret is leftover `error` + leftover `notificationCandidate: false`. Mismatch is leftover `warn` + leftover `notificationCandidate: false`. Leftover immediate levels default leftover `critical`. Leftover min level defaults leftover `error`. Leftover policy needs leftover immediate level **or** leftover min-level **and** leftover candidate. Do not flip leftover `notificationCandidate: true` on auth so “someone hears about a missing secret” without a paired policy proof. Do not remove these letters so “this desk matches CPL silence.”

7. **This desk never opens Mongo.** Already-recommended Lead Messaging / CPL cron **ask** `connectMongo` here. Wave A letter may return skipped without Mongo. Leftover overview connects when the letter asks the card. Leftover retry connects when email is on. Do not add `connectMongo` here so “every cron matches Lead Messaging” without a paired proof that a `digest_disabled` tick still skips Mongo. Do not move leftover retry’s connect onto this desk so “the route owns the picker.”

8. **Cadence is daily noon UTC, not every five minutes.** `vercel.json` is `0 12 * * *`. Sibling drains are `*/5`. Leftover `getAlertEmailDailyDigestCronTime()` defaults leftover `"12:00"` and is unused. Do not start reading that helper so “env owns the schedule” — Vercel owns the path. Do not change the schedule to `*/5` so “every cron matches.” Do not treat leftover `"12:00"` as Eastern 12:00.

9. **The letter window is Eastern midnight-to-now, not last calendar day.** CONTRADICTIONS already locked this on Wave A digest. Vercel fires about 8am ET / 7am EST. Retry uses last-twenty-four-hours on Delivery `createdAt`. Do not silently change the letter window from this file so “the Wave A comment becomes true.”

10. **`requireCronAuth` is a copy of sibling crons, plus letters.** Rematch / RingCentral / Sheet Sync / Lead Messaging / CPL use the same Bearer-or-header 500/401 and do **not** write `cron.auth.failed`. This copy does. Missing-secret copy is `"CRON_SECRET is not set"` (matches Lead Messaging / Sheet Sync / rematch; CPL says `"is not configured"`). Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings that a missing secret still writes `cron.auth.failed` **only here**. Park the copy. IDEAS already parked that extract.

11. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. There is **no** `notification-cron.routes.test.ts`. Do not add `createNotificationCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

12. **`router.all` is GET-and-POST, not POST-only.** Vercel cron GETs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

13. **This desk never builds the card, never talks to SendGrid, never picks due rows, and never runs the named daily-owner report.** Leftover Owner overview **asks** leftover `getObservabilityOverview`. Wave A letter **asks** leftover `sendNotification` leftover `purpose: "daily_digest"`. Wave A retry **asks** leftover `retryNotificationDeliveryInPlace`. Leftover Owner `POST .../observability/reports/run` **asks** leftover `runOperationalReport`. This file **asks** two exports after auth. Do not **ask** leftover `getObservabilityOverview` from this file so “the safety net also refreshes the desk.” Do not merge this router into leftover Owner `observability/*` so “one file owns every Observational start.” Do not start leftover `daily-owner-operational-summary` so “the letter owns the report.” Do not start writing leftover `digest_sent_at`.

14. **Owner HTTP uses leftover `x-api-secret`; this tick uses `CRON_SECRET`.** `app.ts` mounts **before** leftover `v1Routes`. Do not remount leftover `requireApiSecret` so “it matches Owner overview.” Do not hide this ALL behind leftover Owner HMAC so “someone must be an Owner.”

15. **There is no queue consumer.** Sheet Sync / Lead Messaging / Granot lifecycle publish a wake-up and have `api/queues/*-consumer.ts`. The morning letter has neither. Do not add `publishNotificationDigestWakeup` in this rename so “every morning uses `@vercel/queue`.”

16. **Host tables and `hit-vantage-api` omit `/api/cron/notifications-digest-daily` and list Owner `GET /api/v1/admin/observability/overview` plus `GET .../notifications`.** That skill is leftover `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount leftover `requireApiSecret` so “the host table wins.”

17. **There is no harness today.** No `notification-cron.routes.test.ts`. No Wave A `notificationDigest.service.test.ts`. `vercel.json` `0 12 * * *` is the only cadence proof. Keep handshake + disabled-letter **200** + card-throw skips retry at this **interface**. Letter body / retry query / leftover `log_only` stay on already-recommended Wave A tests unless a later factory inject exists with a live-default proof.

18. **Leave sibling modules alone.** `sendDailyOwnerDigest` / `retryFailedNotifications` are already the right **depth**. This file orchestrates the HTTP **adapter**.

19. **Do not treat Wave A letter / Wave A retry / leftover card / leftover SendGrid / leftover named reports / leftover Owner HTTP / rematch / Sheet Sync drain / Lead Messaging drain / CPL drain / Call Log sweep / next Best Relocation heartbeat as this story.** Next `best-relocation-ingestion-cron.routes.ts` is the ingest heartbeat. Do not teach this file leftover `database_scope`. Do not email a Lead / Booking / Cancellation from this file. Do not change leftover `EMAIL_NOTIFICATIONS_MODE` default leftover `log_only`. Do not rename persisted leftover `notification.digest_cron.failed` / leftover `cron.auth.failed` / leftover `purpose: "daily_digest"` / leftover `digest_sent_at`.

## Testing

The **interface** is the test surface: `morningObservationalLetterCronDesk` (mounted on `app.ts` **after** CPL cron, **before** Twilio desks / next Best Relocation cron as the default export) and the one HTTP operation above.

Today there is **no** `notification-cron.routes.test.ts`. Add one file that mounts the live default. Keep handshake + disabled-letter **200** + card-throw skips retry at the same **interface** (do not invent a factory so the test can no longer see the live Wave A default):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"` and **asks** leftover `cron.auth.failed` with leftover `notificationCandidate: false`, leftover `details.reason: "missing_cron_secret"`, leftover `workflow: "notification_digest"`.
- Bearer mismatch **401** `"Unauthorized"` and **asks** leftover `cron.auth.failed` as leftover `warn`, leftover `details.reason: "invalid_cron_secret"`.
- Matching `x-cron-secret` **200**.
- leftover `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` are **not** accepted here.

**Wake the morning letter then retry — never build the card here**
- Disabled letter **200** `{ ok: true, digest: { skipped: true, reason: "digest_disabled", sent: false }, retry: { retried: 0 } }` — not `{ skipped: true }`. Prove the route still **asks** retry after the skipped letter.
- Letter flag off, email on **200** still **asks** retry (Wave A find still runs). Prove that on Wave A tests unless a later factory inject exists.
- Happy letter **200** `{ ok: true, digest: { skipped, reason?, sent }, retry: { retried } }` is PII-free (no Owner email / Incident title / `body_text` / Bearer / token).
- Card throw **500** `{ error: error.message }` (or `"Notification digest failed"`), **does not ask** retry, and **void-asks** leftover `notification.digest_cron.failed` with leftover `notificationCandidate: true` and leftover env `dedupeKey`.
- This beat does **not** **ask** leftover `getObservabilityOverview` / leftover `sendNotification` / leftover `retryNotificationDeliveryInPlace` / leftover `runOperationalReport` / leftover `connectMongo`.

**Cadence**
- `vercel.json` `/api/cron/notifications-digest-daily` is `0 12 * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(notificationCronRoutes)` after CPL cron, before Twilio desks / next Best Relocation cron / leftover `v1Routes`.
- Leftover Owner `observability/*` stays mounted on already-recommended public v1. There is no dedicated queue consumer.

**Not this file**
- Letter / retry stay on already-recommended [observability-notification-digest.md](observability-notification-digest.md).
- Card stays on already-recommended [observability-admin-observability.md](observability-admin-observability.md).
- SendGrid / in-place retry stay on already-recommended [observability-email-notification.md](observability-email-notification.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).
- Owner HTTP stays on already-recommended [routes-v1.md](routes-v1.md).
- Named reports stay on already-recommended [observability-operational-reports.md](observability-operational-reports.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `theMorningLetterAndRetriesFinished`, `rememberTheMorningLetterTickThrew`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `NotificationCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, digest, retry })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `digest.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the always-ask **seam**: do not copy Sheet Sync’s queued-only fence or rematch’s flag-off skip onto this desk.
- Breaking the one-try **seam**: do not split letter and retry into two catches so “retry still runs after a card throw,” and do not 200 a card throw so “the comment’s never-throw becomes true.”
- Breaking the letter-then-retry **seam**: do not ask retry first, and do not skip retry when the letter returns leftover `skipped`.
- Breaking the cron-secret **seam**: do not remount leftover `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / leftover `x-debug-token` here.
- Breaking the void-letter **seam**: do not `await recordOperationalEvent` so “the 500 waits for Mongo.”
- Treating `sendDailyOwnerDigest`, `retryFailedNotifications`, leftover `getObservabilityOverview`, leftover `sendNotification`, leftover `retryNotificationDeliveryInPlace`, leftover `runOperationalReport`, leftover Owner HTTP, rematch, Sheet Sync drain, Lead Messaging drain, CPL drain, Call Log sweep, next Best Relocation heartbeat, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / publish / route-level email / queue **adapter** that has only one caller in this pass.
- Silently reading leftover `getAlertEmailDailyDigestCronTime`, starting leftover `daily-owner-operational-summary`, writing leftover `digest_sent_at`, flipping leftover `notificationCandidate` on auth, dropping the leftover `notification.` prefix so “digest fail pages the owner,” remounting leftover `requireApiSecret`, extracting `requireCronAuth`, merging this router into Owner `observability/*`, changing leftover `EMAIL_NOTIFICATIONS_MODE` default leftover `log_only`, or renaming persisted leftover `notification.digest_cron.failed` / leftover `cron.auth.failed` / leftover `purpose: "daily_digest"` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
