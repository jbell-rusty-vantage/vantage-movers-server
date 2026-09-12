# After The Cron Secret Proves This Tick Is Ours, Wake The Due Lead Message Drain — Never Claim A Row Here, Never Publish A Wake-Up, Never Talk To Twilio, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 22 of this service — `lead-messaging-cron.routes.ts`
- Remaining in this service: `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/lead-messaging-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (HTTP table: `ALL /api/cron/lead-messaging-drain` → `runLeadMessagingDrain("cron")` (`CRON_SECRET`). Queue row: `api/queues/lead-messaging-consumer.ts` → `runLeadMessagingDrain("queue")`. Mode: `LEAD_MESSAGING_MODE` is `disabled` (default / unknown), `inline`, or `queued`. Queue publish is gated; Mongo still owns drain order. Quiet hours is Message Scheduling `sendAt`, **not** a cron / `next_attempt_at` delay. Drain: expire leftover `sending` leases to `uncertain`, then claim due `pending` / `queued` / `retry_scheduled`. Disabled / test-mode drain returns `{ claimed: 0, outcomes: { disabled: 1 } }`). Distinct from already-recommended drain: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (`runLeadMessagingDrain` — this file **asks** it with `"cron"` after `connectMongo`; that file expires leftover `sending` to `uncertain`, claims up to `LEAD_MESSAGING_DRAIN_LIMIT` (25), **asks** claim-and-send; **this file never claims a row and never talks to Twilio**. Wave A already said: disabled / test-mode is `{ claimed: 0, outcomes: { disabled: 1 } }` and **does not rewrite** leftover `pending` to `skipped`). Distinct from already-recommended wake-up: [lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md) (`publishLeadMessagingWakeup` — cron **does not import** it; `reason: "cron"` is on the union and has no publisher; CONTRADICTIONS already locked: do not publish from this path so “every drain uses the queue”). Distinct from already-recommended remember / send-or-wake: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (`persistLeadMessageIntent` in the Form Lead write, `dispatchOrQueuePersistedLeadMessage` after commit — **does not import** this file). Distinct from already-recommended Granot six gates: [lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (**this file never texts**). Distinct from already-recommended Twilio REST / signature: [lead-messaging-twilio-adapter.md](lead-messaging-twilio-adapter.md) (drain **asks** `createTwilioSender` inside claim-and-send; **this file never imports it**). Distinct from already-recommended SMS status desk: [routes-twilio-message-status.md](routes-twilio-message-status.md) (`x-twilio-signature` then `applyTwilioStatusCallback` — **does not import** this file; **this file never stamps a status**). Distinct from already-recommended voice desk: [routes-twilio-voice.md](routes-twilio-voice.md) (**does not import** this file; **this file never writes TwiML**). Distinct from already-recommended Owner mount: [routes-v1.md](routes-v1.md) (`GET/POST /api/v1/admin/lead-messages*` after `requireApiSecret` — retry **asks** `requestLeadMessageRetry` then wakes the drain; **does not import** this file). Distinct from already-recommended Sheet Sync cron: [routes-sheet-sync-cron.md](routes-sheet-sync-cron.md) (mode gate **on the route**, no-op unless `queued`, HTTP `{ skipped: true }` — **does not import** this file; **this file has no mode gate** because leftover inline `pending` still must drain). Distinct from already-recommended rematch cron: [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (flag default **on**, HTTP `{ skipped: true }` when off — **does not import** this file). Distinct from already-recommended Call Log cron: [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (`lease_held` **200** + factory inject; flags default **false** — **does not import** this file). Distinct from the dedicated consumer: `api/queues/lead-messaging-consumer.ts` (`runLeadMessagingDrain("queue")`, payload ignored, **throws** on failure, **not** mounted on Express — **does not import** this file). Distinct from mode config: `getLeadMessagingMode()` (`disabled` default / unknown fallback; `inline` | `queued` are opt-in — **this file never asks** that; drain does). Distinct from sibling crons: next `cpl-correction-cron.routes.ts` / `notification-cron.routes.ts` / `best-relocation-ingestion-cron.routes.ts` / `reporting-cron.routes.ts` / `granot-automation-cron.routes.ts` / `granot-lifecycle-cron.routes.ts` (each copies `requireCronAuth`; **none import** this file). Distinct from already-recommended letters: [observability-record-operational-event.md](observability-record-operational-event.md) (drain **asks** `lead_messaging.drain.completed` after a live scan; disabled early-return **does not**; **this file never asks letters** — it only logs `lead_messaging.cron.completed` / `lead_messaging.cron.failed`). Distinct from other secrets: `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(leadMessagingCronRoutes)` on line 59 — **after** already-recommended RingCentral cron / rematch cron / Sheet Sync cron, **before** next CPL / notification crons, already-recommended Twilio desks, Best Relocation / reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1). Wave A folder tests prove drain / claim-and-send / quiet hours through `leadMessaging.service.test.ts`, not this router. Operator `hit-vantage-api` lists Owner `GET/POST /api/v1/admin/lead-messages*`, **not** `/api/cron/lead-messaging-drain`. Host public/unguarded tables omit this path. Not this **interface**: `runLeadMessagingDrain` itself, `publishLeadMessagingWakeup` itself, `dispatchPersistedLeadMessage` itself, `requestLeadMessageRetry` itself, `applyTwilioStatusCallback` itself, `createTwilioSender` itself, `getLeadMessagingMode` itself, the queue consumer itself.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs `requireApiSecret` vs Owner HMAC vs Granot webhook secret vs Twilio signature vs RingCentral Validation-Token; always-ask drain **200** `{ ok: true, summary }` (even when `summary.outcomes.disabled === 1`) vs already-recommended Sheet Sync **200** `{ skipped: true }` vs rematch flag-off skip vs Call Log `lease_held`; unexpected throw **500** `error.message`; `connectMongo` on this desk vs Wave A drain assuming a live connection; no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; mode default **disabled** vs Sheet Sync default **legacy** vs rematch flag default **on** vs RingCentral flags default **false**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**. There is no publish **seam**. There is no route-level mode **seam**.
- Split later (only if the file outgrows one sitting): this ~49-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake the due Lead Message drain — never claim a row here, never publish a wake-up, never talk to Twilio, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`. Drain stays already-recommended `leadMessaging.service.ts`. Wake-up stays already-recommended `leadMessagingQueue.service.ts`. Mode stays `getLeadMessagingMode`. Owner retry stays already-recommended `requestLeadMessageRetry` on public v1. SMS status stays already-recommended `twilio-message-status.routes.ts`. CPL drain stays next `cpl-correction-cron.routes.ts`.

`router.all("/api/cron/lead-messaging-drain")` is an HTTP verb. The owner question is: *Vercel just woke us — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. Then open Mongo and ask the drain with trigger `cron`. Echo the counts. Disabled messaging is still 200 with `claimed: 0` and `outcomes.disabled: 1` — not an HTTP skip. A leftover inline `pending` still must be found. An expired `sending` lease becomes uncertain inside the drain, not here. Only an unexpected throw is 500, and that 500 may echo the message. Do not claim a Lead Message in this file. Do not publish a wake-up. Do not talk to Twilio. Do not stamp a status. Do not retry a failed text. Do not compare `x-api-secret`.*

Who expire leftover `sending` / claim due rows / talk to Twilio already lives in already-recommended `runLeadMessagingDrain`. Who name the mode already lives in `getLeadMessagingMode`. Who publish the wake-up already lives in already-recommended `publishLeadMessagingWakeup`. Who retry a failed text from the Admin Dashboard already lives in already-recommended `requestLeadMessageRetry`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, wake the due Lead Message drain” story, not “a cron CRUD dump,” and not Drain Due Lead Messages / Wake The Drain / Remember The Outbound Confirmation SMS / Accept Twilio’s Word themselves:

1. **Wake this due Lead Message drain** — `ALL /api/cron/lead-messaging-drain`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }`. Mismatch **401** `{ ok: false, error: "Unauthorized" }`. Then **asks** `connectMongo()`, then `runLeadMessagingDrain("cron")`, logs `lead_messaging.cron.completed` with the summary spread (`claimed` / `outcomes` only), and **200** `{ ok: true, summary }`. There is **no** HTTP `skipped`. Disabled / test-mode inside Wave A drain is still **200** `{ summary: { claimed: 0, outcomes: { disabled: 1 } } }` — the route still opened Mongo. Unexpected throw logs `lead_messaging.cron.failed` and **500** `{ ok: false, error: error.message }` (or `"Lead messaging drain failed"` when the throw is not an `Error`). This beat does **not** **ask** `getLeadMessagingMode` before drain. This beat does **not** map a held per-row lease onto HTTP `{ skipped: true, reason: "lease_held" }` — there is no global drain seat. This beat does **not** **ask** `publishLeadMessagingWakeup`. This beat does **not** **ask** `dispatchPersistedLeadMessage`. This beat does **not** **ask** `requestLeadMessageRetry`. This beat does **not** **ask** `applyTwilioStatusCallback`. This beat does **not** **ask** `createTwilioSender`. This beat does **not** **ask** `recordOperationalEvent`. This beat does **not** compare `x-api-secret`.

`requireCronAuth` is a beat inside this operation, not an extra owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second hold-the-seat operation. Wave A drain elects each row’s 60s lease, not a global `lead-messaging:drain`. There is no third publish-a-wake-up operation. There is no fourth Owner retry operation. There is no fifth SMS-status operation. There is no sixth Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake the due Lead Message drain — never claim a row here, never publish a wake-up, never talk to Twilio, never use the API secret.” Already-recommended drain / wake-up / remember / claim-and-send / Twilio REST / Owner retry already live in deeper **modules**. Do not pull those in. Do not invent a `LeadMessagingCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** Wave A drain. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner desks.” Do not invent a route-level mode **adapter** so “this desk matches Sheet Sync queued-only.” Do not invent a lease **adapter** beside already-recommended per-row `LEAD_MESSAGING_LEASE_MS`. Do not invent a publish **adapter** beside already-recommended `publishLeadMessagingWakeup`. Do not invent a CRUD folder so `drain.ts` / `cron.ts` each get a file.

Do not move `runLeadMessagingDrain` into this file so “the route owns the drain.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside `v1.routes.ts` so “one file owns every cron.” Do not merge this router into already-recommended Owner `lead-messages/retry` so “one file owns every drain start.” Do not merge this router into the queue consumer so “one hop owns every wake.” Do not merge this router into already-recommended Sheet Sync cron so “one file owns every five-minute `CRON_SECRET` tick.” Do not merge this router into already-recommended SMS status so “one file owns hybrid Lead Messaging.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `leadMessagingDrainCronDesk` | `app.ts` mounts the instance **after** Sheet Sync cron, **before** next CPL cron |
| `ALL /api/cron/lead-messaging-drain` (today unexported handler) | `wakeThisDueLeadMessageDrainOverHttp` | auth **then** Mongo **then** drain; no HTTP skip |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `LEAD_MESSAGING_LEASE_MS` / `LEAD_MESSAGING_DRAIN_LIMIT` / `outcomes.disabled` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createLeadMessagingCronRouter({ runDrain, messagingMode })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after Wave A drain returns counts:

```ts
type LeadMessagingDrainFinishedOverHttp = {
  ok: true
  summary: { claimed: number; outcomes: Record<string, number> }
}
```

That is the **200** handoff from “Vercel woke us” to “Wave A scanned due rows (or immediately said disabled).” Do **not** add `skipped: true` onto that bag so “this desk matches Sheet Sync / rematch.” Do **not** collapse `outcomes.disabled === 1` into HTTP `{ reason: "messaging_disabled" }` so “one skip owns disabled.” Do **not** copy RingCentral `{ reason: "lease_held" }` onto this desk so “every cron maps overlap.” Do **not** add `messages[]` onto the **200** so “the owner can see every due phone on the cron body.”

Leave `runLeadMessagingDrain` on already-recommended remember/send. Leave `getLeadMessagingMode` on `leadMessaging.ts`. Leave wake-up on already-recommended `leadMessagingQueue.service.ts`. Leave Owner retry on already-recommended `requestLeadMessageRetry`. Leave the consumer on `api/queues/lead-messaging-consumer.ts`. Leave SMS status on already-recommended `twilio-message-status.routes.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// lead-messaging-cron.routes.ts
// Vercel just woke us — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// Open Mongo, then ask the drain with trigger cron and echo the counts.
// Disabled messaging is still 200 with claimed 0 and outcomes.disabled 1.
// A leftover inline pending still must be found.
// An expired sending lease becomes uncertain inside the drain, not here.
// Only an unexpected throw is 500.
// Do not claim a Lead Message in this file.
// Do not publish a wake-up.
// Do not talk to Twilio.
// Do not stamp a status.
// Do not retry a failed text.
// Do not compare x-api-secret.

export default acceptThisLeadMessagingDrainCronDesk()

function acceptThisLeadMessagingDrainCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/lead-messaging-drain",
    proveThisCronTickIsOurs,
    wakeThisDueLeadMessageDrainOverHttp,
  )
  return desk
}

// ── 1. Wake this due Lead Message drain ───────────────────

async function wakeThisDueLeadMessageDrainOverHttp(_req, res) {
  try {
    await openMongoForThisTick()
    const summary = await drainDueLeadMessages("cron")
    rememberTheCronTickFinished(summary)
    return theDrainFinished(res, summary)
  } catch (error) {
    rememberTheCronTickThrew(error)
    return leadMessagingDrainFailedAndEchoTheMessage(res, error)
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

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500, not 401. A mismatch is 401. Open Mongo, ask drain with `"cron"`, and echo `{ claimed, outcomes }`. Disabled is still 200 with `claimed: 0` and `outcomes.disabled: 1`, not HTTP `skipped`. Leftover inline `pending` still drains. An expired `sending` lease is `uncertain` inside Wave A, not `lease_held` here. An unexpected throw is 500 and may echo `error.message`. Do not claim a row. Do not publish. Do not talk to Twilio. Do not stamp a status. Do not retry. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/lead-messaging-drain")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk has no mode gate; Sheet Sync’s cron does.** Already-recommended Sheet Sync **200** `{ skipped: true }` and never **asks** drain unless `queued`. This file always **asks** `connectMongo` then drain. Wave A drain no-ops only when `disabled` / test-mode. Inline leftover `pending` and `retry_scheduled` still must send. Do not copy the Sheet Sync queued-only fence here so “every five-minute desk matches.” Do not add `getLeadMessagingMode()` on this route so “disabled never opens Mongo” without a paired HTTP proof that `inline` still drains leftover `pending`.

2. **Mode defaults to `disabled`.** Unknown values fall back to `disabled`. `inline` / `queued` are opt-in. Already-recommended Sheet Sync defaults **legacy**. Already-recommended rematch defaults **on**. Already-recommended RingCentral flags default **false**. Knowledge locks this default so a deploy without the env does not text. Do not default queued so “the safety net always claims.” Do not treat unknown as `inline` so “nonsense starts sending.”

3. **Disabled is not HTTP `skipped`.** Wave A drain returns `{ claimed: 0, outcomes: { disabled: 1 } }` and does **not** write `lead_messaging.drain.completed`. This file **200** `{ ok: true, summary }` and still logs `lead_messaging.cron.completed`. Do not add `skipped: true` / `reason: "messaging_disabled"` so “this desk matches rematch.” Do not **401** disabled so “off looks unauthorized.” Do not rewrite leftover `pending` to `skipped` from this file so “disabled means skipped” — Wave A already locked that lie.

4. **There is no global drain seat and no HTTP `lease_held`.** Each row takes a 60s lease inside claim-and-send. Two overlapping ticks can both scan; `findOne` + claim races per row. Already-recommended Call Log maps `skipReason === "lease_held"` onto **200** `{ skipped: true, reason: "lease_held" }`. Already-recommended Sheet Sync wraps a held `sheet-sync:drain` as HTTP `skipped: false` plus `summary.skipped`. Do not invent `lead-messaging:drain` in this rename so “every cron elects a seat.” Do not copy Call Log `lease_held` onto this desk so “overlap looks like a skip.”

5. **Quiet hours is not a cron delay.** Wave A already said `sendAt` is Message Scheduling. Drain does not look at the Eastern hour. A due overnight row still claims now and Twilio stores `sendAt` = 8:00 AM. Do not add `next_attempt_at` from this file so “the cron waits until 8.” Do not skip the tick before 7 Eastern so “we will not bother Twilio at night.”

6. **Route 500 is only an unexpected throw, and it echoes `error.message`.** `connectMongo` / Wave A `updateMany` / `findOne` / `recordOperationalEvent` can throw into this catch. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Already-recommended rematch has no try/catch. Already-recommended Sheet Sync also echoes `error.message`. The consumer **throws** so the queue can retry. Do not sanitize this 500 so “this desk matches Call Log silence” without a paired HTTP proof that operators still see why the safety net died. Do not drop the catch so “this desk matches rematch unhandled Express.” Do not rethrow so “this desk matches the consumer.”

7. **This desk never writes the completed letter.** Wave A drain already persisted `lead_messaging.drain.completed` (`notificationCandidate: false`) after a live scan. Disabled early-return does **not**. This file only logs `lead_messaging.cron.completed` (always, including disabled) and `lead_messaging.cron.failed`. Do not **ask** `recordOperationalEvent` from this file so “one route owns every Lead Messaging letter.” Do not drop Wave A’s letter so “the cron log is enough.”

8. **`connectMongo` lives on this desk and on the consumer, not inside Wave A drain.** Already-recommended Sheet Sync drain connects itself; that cron does not. SMS status also connects before apply. Do not move `connectMongo` into `runLeadMessagingDrain` in this rename so “every caller matches Sheet Sync” without a paired consumer + cron proof. Do not drop the connect so “drain already opened it.”

9. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today there is **no** `lead-messaging-cron.routes.test.ts`. Do not add `createLeadMessagingCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default.

10. **`requireCronAuth` is a copy of sibling crons.** Rematch / RingCentral / Sheet Sync / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

11. **`router.all` is GET-and-POST, not POST-only.** Knowledge names `ALL`. Vercel cron GETs. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

12. **Trigger is the string `"cron"`.** Drain’s letter `details.source` is that string. `source: "manual"` is on the union and has **no** HTTP caller. Do not stamp `owner:cron` so “history looks like the Admin desk.” Do not import Owner HMAC so “someone must be an Owner.” Do not add `POST /api/v1/admin/lead-messages/drain` in this rename so “manual becomes real.”

13. **This desk never publishes, never claims, never talks to Twilio, never stamps a status, and never retries a failed text.** Wake-up **asks** `@vercel/queue`. Owner retry **asks** `update` then `publishLeadMessagingWakeup("manual_retry")`. Drain **asks** claim-and-send. SMS status **asks** never-backward persist. This file **asks** one export after Mongo. Do not **ask** `publishLeadMessagingWakeup` from this file so “the safety net also pokes the queue” — CONTRADICTIONS already locked that. Do not merge this router into already-recommended Owner `lead-messages/retry` so “one file owns every drain start.” Do not call `createTwilioSender` from this file so “one hop owns the SMS.”

14. **Inline leftover `pending` is why this tick must not copy Sheet Sync’s queued-only fence.** Persist writes `pending` when mode is `inline`, `queued` when mode is `queued`. After-commit inline may throw and Wave A containment can say `failed` while the row is still in-flight. Cron is the five-minute safety net for that leftover, for a missed wake-up, and for `retry_scheduled`. Do not refuse `inline` so “only queued hosts drain.”

15. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches Owner retry.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.” Do not accept `x-twilio-signature` so “one Twilio secret owns hybrid messaging.”

16. **Host tables and `hit-vantage-api` omit `/api/cron/lead-messaging-drain` and list Owner `GET/POST /api/v1/admin/lead-messages*`.** That skill is `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

17. **Today there is no HTTP harness on this desk.** Auth 500/401, disabled **200** `{ claimed: 0, outcomes: { disabled: 1 } }`, and `router.all` GET are unproven here. `vercel.json` `*/5 * * * *` is the only cadence proof. Do not treat schedule-parse as HTTP drain. Keep handshake + disabled-counts at this **interface**. Claim / uncertain-lease / quiet-hours `sendAt` stay on already-recommended drain tests unless a later factory inject exists with a live-default proof.

18. **Leave sibling modules alone.** `runLeadMessagingDrain` / `getLeadMessagingMode` are already the right **depth**. This file orchestrates the HTTP **adapter**.

19. **Do not treat remember / wake-up / Owner retry / the queue consumer / SMS status / voice / rematch / Sheet Sync drain / Call Log sweep / next CPL drain as this story.** Next `cpl-correction-cron.routes.ts` is CPL corrections. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `leadMessagingDrainCronDesk` (mounted on `app.ts` **after** Sheet Sync cron, **before** next CPL cron as the default export) and the one HTTP operation above.

Today there is **no** `lead-messaging-cron.routes.test.ts`. Add handshake + disabled-counts through the live default. Do not invent a factory so “the test can no longer see the live Wave A default.”

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"`.
- Bearer mismatch **401** `"Unauthorized"`.
- Matching `x-cron-secret` **200**.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` are **not** accepted here.

**Wake drain — never claim a row here**
- Mode `disabled` (or missing / unknown) **200** `{ ok: true, summary: { claimed: 0, outcomes: { disabled: 1 } } }` — not `{ skipped: true }`. Prove the counts on already-recommended drain unless a later factory inject exists; this desk must still **ask** drain (Mongo connect happens).
- Mode `inline` or `queued` **200** `{ ok: true, summary }` echoes Wave A counts (`claimed` / `outcomes` keys such as `accepted` / `retry_scheduled` / `uncertain` / `failed`) and is PII-free (no phone / SMS body / Lead id / Bearer / token / SID). Prove the send outcomes on already-recommended drain.
- An expired `sending` lease is `uncertain` inside Wave A, not HTTP `{ reason: "lease_held" }`. Do not invent that mapping on this desk.
- Unexpected throw **500** may echo `error.message`.
- This beat does **not** **ask** `publishLeadMessagingWakeup` / `requestLeadMessageRetry` / `applyTwilioStatusCallback` / `createTwilioSender` / `recordOperationalEvent`.

**Cadence**
- `vercel.json` `/api/cron/lead-messaging-drain` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(leadMessagingCronRoutes)` after Sheet Sync cron, before next CPL cron / Twilio desks / `v1Routes`.
- Already-recommended Owner `lead-messages*` and the dedicated queue consumer stay mounted apart (consumer is not on Express).

**Not this file**
- Drain / claim-and-send / quiet hours stay on already-recommended [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md).
- Wake-up stays on already-recommended [lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md).
- Owner retry stays on already-recommended [routes-v1.md](routes-v1.md).
- SMS status stays on already-recommended [routes-twilio-message-status.md](routes-twilio-message-status.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `openMongoForThisTick`, `theDrainFinished`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `LeadMessagingCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, summary })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `drain.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the leftover-inline-pending **seam**: do not copy Sheet Sync’s queued-only fence onto this desk.
- Breaking the disabled-counts **seam**: do not map `outcomes.disabled` onto HTTP `skipped`, and do not rewrite leftover `pending` to `skipped` from this file.
- Breaking the no-global-seat **seam**: do not invent `lead-messaging:drain` or copy Call Log `lease_held`.
- Breaking the quiet-hours **seam**: do not add an overnight `next_attempt_at` so “the cron waits until 8.”
- Breaking the cron-secret **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` here.
- Treating `runLeadMessagingDrain`, `publishLeadMessagingWakeup`, `requestLeadMessageRetry`, `applyTwilioStatusCallback`, the queue consumer, SMS status, voice, rematch, Sheet Sync drain, Call Log sweep, next CPL drain, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject / publish / route-level mode **adapter** that has only one caller in this pass.
- Silently defaulting mode to `queued`, publishing a wake-up, remounting `requireApiSecret`, extracting `requireCronAuth`, or merging this router into Owner retry while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
