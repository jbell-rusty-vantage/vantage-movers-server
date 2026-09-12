# After The Granot Webhook Secret, Keep This Delivery As An Observation Receipt, Then Wake The Drain — Never Answer 202 Before Commit, Never Let A Failed Wake-Up Change The Receipt, Never Write A Lead Or Booking Here — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 14 of this service — `granot-webhook.routes.ts`
- Remaining in this service: `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/granot-webhook.routes.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/capture.md`](../../../docs/knowledge/granot-lifecycle/capture.md) (thin webhook route → webhook secret → keep a credential-redacted [Granot Observation Receipt](../../../../CONTEXT.md) → best-effort `{ receipt_id }` wake-up; `202` only after Mongo commit; capture is not a Lead / Booking / Cancellation write; payload keys are evidence, not a schema; `event_type` in the `202` body is the invoked route class). Distinct from already-recommended Wave A keep: [granot-lifecycle-capture.md](granot-lifecycle-capture.md) (`captureGranotLifecycleWebhookReceipt` — this file **asks** it; that file does **not** compare the secret and does **not** publish). Distinct from already-recommended Wave A poke: [granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md) (`publishGranotLifecycleReceiptWakeup` — this file **asks** it after commit; that file never throws and never claims). Distinct from already-recommended Owner apply desks: [routes-extension-granot-apply.md](routes-extension-granot-apply.md) / [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) / [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md) (those capture a channel receipt then **ask** `claimAndProcessOrPoll`; **this file never claims**). Distinct from already-recommended HMAC lifecycle desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (Owner historical receipts / live SSE / Booking commands after the API secret — **does not import** this file). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`app.use(v1Routes)` **after** this file — **does not import** this file; no `/api/webhooks/granot` path). Distinct from already-recommended Owner reporting / Best Relocation / Granot automation desks: [routes-reporting.md](routes-reporting.md) / [routes-ingestion.md](routes-ingestion.md) / [routes-granot-automation.md](routes-granot-automation.md) (those remount `requireApiSecret` on `/api/v1/admin/*` — **this file never uses that secret**). Distinct from leftover Wave B webhook secret: next `requireGranotWebhookSecret.ts` (this file **asks** it on every POST; missing config **500**; wrong / missing / nonscalar / mismatched dual secrets **401**; header and body `x-api-secret` are deleted before capture). Distinct from leftover Wave B cron drain: next `granot-lifecycle-cron.routes.ts` (`/api/cron/granot-lifecycle-drain` `CRON_SECRET` **asks** `drainDueReceipts("cron")` — **this file does not use `CRON_SECRET`**). Distinct from leftover queue consumer: `api/queues/granot-lifecycle-consumer.ts` (`{ receipt_id }` only, then `drainRequestedReceipt` — **does not import** this file). Distinct from next RingCentral inbound: next `ringcentral-webhook.routes.ts` (`/api/webhooks/ringcentral` — **does not import** this file). Distinct from leftover Wave A letters: [granot-lifecycle-observability.md](granot-lifecycle-observability.md) (`emitGranotLifecycleEvent` on capture **503** only) and leftover `metrics.ts` (`incrementGranotLifecycleCaptureFailures` on that same catch). Distinct from leftover Wave A CRM Posting: [crm-crm-service.md](crm-crm-service.md) / [form-lead.md](form-lead.md) (**this file never posts**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites Mongo as the book; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one inject-and-post proof.** `src/app.ts` **asks** the default export (`app.use(granotWebhookRoutes)` on line 54, **after** leftover RingCentral webhook, **before** leftover RingCentral local webhook, leftover crons, leftover Granot automation, leftover public v1, leftover Best Relocation, leftover reporting). Tests on this **interface**: `granot-webhook.routes.test.ts` **asks** leftover `createGranotWebhookRouter({ capture, publish })` and HTTP-posts the three paths. It names missing `GRANOT_WEBHOOK_SECRET` **500** `"Granot webhook authentication is not configured"` with neither capture nor publish; missing / wrong / nonscalar / mismatched dual secrets **401** `GRANOT_WEBHOOK_UNAUTHORIZED` and no receipt; header / JSON-body / form-body secrets **202** with `authentication_method` `header_secret` then `body_secret` then `body_secret`, credential stripped from payload and headers, and `{ receipt_id }` published; both valid secrets attach `header_secret` after the body is also validated; unused Granot fields stay as-is; capture uses the invoked route class; capture throw **503** `"Webhook receipt could not be stored"`, `incrementGranotLifecycleCaptureFailures` **1**, `granot_lifecycle.capture.failed` (not `queue.publish_failed`), no publish; publish `{ published: false }` and publish throw still **202** the same receipt. It does **not** name the `app.ts` mount order. It does **not** name `requireApiSecret` / HMAC / `CRON_SECRET` refused. It does **not** name `claimAndProcessOrPoll` absent. It does **not** name payload `event_type` losing to the route class when they disagree. Already-recommended Wave A `capture.test.ts` / `queuePublisher.test.ts` prove insert / skip / swallow through the services, not this router. Operator `hit-vantage-api` does **not** list `/api/webhooks/granot/*`. Not this **interface**: leftover `captureGranotLifecycleWebhookReceipt` itself, leftover `publishGranotLifecycleReceiptWakeup` itself, leftover `claimAndProcessOrPoll`, leftover `drainDueReceipts`, leftover `applyExtensionGranotItem`.
- Seams callers need: `app.ts` **before** public v1 vs Owner desks **after** the secret; this-file `requireGranotWebhookSecret` vs leftover `requireApiSecret` / leftover HMAC / leftover `CRON_SECRET` / leftover extension session; leftover factory `createGranotWebhookRouter({ capture, publish })` vs default export (live mount); leftover `202` only after leftover capture commit vs leftover wake-up **after** that commit; leftover live publisher leftover never throws vs leftover injected leftover throw leftover this file leftover swallows; leftover route `event_type` leftover table leftover vs leftover payload leftover `event_type` leftover as leftover evidence; leftover three leftover HTTP leftover adapters leftover over leftover one leftover handler leftover vs leftover channel leftover apply leftover (no leftover publish). There is no begin / complete Domain Command **seam**. There is no leftover claim-lease **seam**. There is no leftover Zod **seam**. There is no leftover HMAC Owner **seam**.
- Split later (only if the file outgrows one sitting): this ~128-line file is one sitting if you read it as after the Granot webhook secret, keep this delivery as an Observation Receipt, then wake the drain — never answer 202 before commit, never let a failed wake-up change the receipt, never write a Lead or Booking here. Do not split. Never `lead-created.ts` / `priority-updated.ts` / `booking-status-changed.ts` / `create.ts` / `update.ts` / `delete.ts`. Keep stays already-recommended `capture.ts`. Wake-up stays already-recommended `queuePublisher.ts`. Secret compare stays leftover `requireGranotWebhookSecret.ts`. Claim / drain stay already-recommended `drainer.ts` and leftover next cron. Owner apply stays already-recommended `extensionApply.ts` / `automationApply.ts`.

`router.post("/api/webhooks/granot/lead-created")` / `priority-updated` / `booking-status-changed` are HTTP verbs. The owner question is: *Granot just POSTed a delivery. Compare the webhook secret. Keep the credential-redacted body as a pending Observation Receipt under the route class this URL named. Answer 202 only after that insert commits. Then try to wake the drain with exactly `{ receipt_id }`. If the wake-up skips or throws, Granot still hears 202 and the receipt still stands. Do not schema-check unused Granot fields. Do not let payload `event_type` rename the route class. Do not claim the receipt here. Do not write a Lead or a Booking. Do not recover due work on the cron secret.*

Who keep the receipt already lives in already-recommended `capture.ts`. Who decide whether this host may publish already lives in already-recommended `queuePublisher.ts`. Who compare the webhook secret already lives in leftover `requireGranotWebhookSecret.ts`. Who claim due work already lives in already-recommended `drainer.ts`. Do not pull those in.

## What this file actually does

One operation with three HTTP **adapters**, not “a webhook CRUD dump,” and not Keep This Webhook Delivery / Wake The Drain themselves:

1. **Accept this Granot webhook as a pending Observation Receipt, then wake the drain** — `POST /api/webhooks/granot/lead-created` (`lead_created`), `POST .../priority-updated` (`priority_updated`), `POST .../booking-status-changed` (`booking_status_changed`). One table, one handler. **Asks** `requireGranotWebhookSecret`. Then `getGranotWebhookAuth(req)`; miss **401** `GRANOT_WEBHOOK_UNAUTHORIZED` (defense after the middleware already refused or attached). **Asks** `capture({ route_event_class, captured_at: new Date(), headers, payload: req.body, authentication_method })`. Capture throw **asks** `incrementGranotLifecycleCaptureFailures`, `safeLifecycleFailureLog` `granot_lifecycle.capture.failed`, `emitGranotLifecycleEvent` `granot_lifecycle.capture.failed` `category: "mongo"` `statusCode: 503`, then **503** `"Webhook receipt could not be stored"` — **no** publish. After commit **asks** `publish({ receipt_id })` inside try/catch; throw logs `granot_lifecycle.queue.publish_failed` and still **202**. Live publisher never throws (`{ published: false }` on skip / send fail). **202** `{ ok: true, accepted: true, event_type: route.event_type, receipt_id }`. Payload keys are evidence — the comment in this file says Granot may add or drop unused fields. This beat does **not** Zod-parse the body. This beat does **not** **ask** `claimAndProcessOrPoll`. This beat does **not** **ask** `normalizeGranotObservation`. This beat does **not** **ask** `createLeadFromGranot` / `synchronizeLeadFromGranot`.

`requireGranotWebhookSecret` / `getGranotWebhookAuth` / injected `capture` / injected `publish` are beats inside this operation, not extra owner stories. The factory defaults to `captureGranotLifecycleWebhookReceipt` and `publishGranotLifecycleReceiptWakeup`. The default export is `createGranotWebhookRouter()`.

There is no second claim or Lead-write operation. Three HTTP **adapters** on one factory over already-recommended keep / poke. Do not collapse them so “one `/webhooks/granot` owns every verb and the cron drain.”

## Organization

Keep one file. This is the screenplay for “after the Granot webhook secret, keep this delivery as an Observation Receipt, then wake the drain — never answer 202 before commit, never let a failed wake-up change the receipt, never write a Lead or Booking here.” Already-recommended keep / poke / claim / Owner apply already live in deeper **modules**. Do not pull those in. Do not invent a `GranotWebhookRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a leftover claim **adapter** so “the webhook can process without the drain.” Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover Zod **adapter** so “unused Granot fields 400.” Do not invent a CRUD folder so `lead-created.ts` / `priority-updated.ts` / `booking-status-changed.ts` each get a file.

Do not move leftover `captureGranotLifecycleWebhookReceipt` into this file so “the route owns the insert.” Do not move leftover `publishGranotLifecycleReceiptWakeup` into this file so “the route owns the topic.” Do not mount this router inside leftover `v1.routes.ts` so “one file owns every webhook.” Do not merge this router into leftover `extension-granot-apply.routes.ts` so “one file owns every Granot receipt.” Do not merge this router into leftover `granot-lifecycle-cron.routes.ts` so “one file owns capture and drain.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotWebhookRouter` | `acceptThisGranotWebhookAfterTheWebhookSecret` | tests inject `capture` / `publish`; live default **asks** Wave A |
| `default` router | `granotWebhookDesk` | `app.ts` mounts the zero-arg instance **before** public v1 |
| `POST .../lead-created` (today unexported handler) | `acceptThisLeadCreatedWebhookOverHttp` | route class `lead_created` — payload `event_type` is evidence |
| `POST .../priority-updated` (today unexported handler) | `acceptThisPriorityUpdatedWebhookOverHttp` | route class `priority_updated` |
| `POST .../booking-status-changed` (today unexported handler) | `acceptThisBookingStatusChangedWebhookOverHttp` | route class `booking_status_changed` |
| `GranotWebhookRouterDeps` | `AcceptThisGranotWebhookDeps` | test **seam**: override keep and poke |

Keep the factory and default export as one-line aliases until `app.ts` and `granot-webhook.routes.test.ts` migrate. Do not make callers learn `route_event_class` / `authentication_method` / `incrementGranotLifecycleCaptureFailures` as the domain language. Do **not** export the handler so “the test can unit the helper.” Do **not** add `claim` onto `GranotWebhookRouterDeps` so “the test can process here.” Do **not** add `queue_published` onto the `202` so “this desk matches leftover Granot automation.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff capture already paints after commit:

```ts
type AcceptedGranotWebhookOverHttp = {
  ok: true
  accepted: true
  event_type: "lead_created" | "priority_updated" | "booking_status_changed"
  receipt_id: string
}
```

That is the handoff from “the receipt is saved” to “Granot may stop retrying, and a later drain may claim this id.” Do **not** add `published` onto that bag (wake-up cannot change `202`). Do **not** collapse the three route classes into one `/api/webhooks/granot` so “the payload names the class.”

Leave `captureGranotLifecycleWebhookReceipt` on already-recommended `capture.ts`. Leave `publishGranotLifecycleReceiptWakeup` on already-recommended `queuePublisher.ts`. Leave secret compare on leftover `requireGranotWebhookSecret.ts`. Leave claim on already-recommended `drainer.ts`. Leave Owner apply on already-recommended `extensionApply.ts` / `automationApply.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granot-webhook.routes.ts
// Granot just POSTed a delivery.
// Compare the webhook secret.
// Keep the credential-redacted body as a pending Observation Receipt
// under the route class this URL named.
// Answer 202 only after that insert commits.
// Then try to wake the drain with exactly { receipt_id }.
// If the wake-up skips or throws, Granot still hears 202.
// Do not schema-check unused Granot fields.
// Do not let payload event_type rename the route class.
// Do not claim. Do not write a Lead or a Booking.

export function acceptThisGranotWebhookAfterTheWebhookSecret(deps = {}) {
  const keep = deps.capture ?? keepThisWebhookDeliveryAsAGranotObservationReceipt
  const wake = deps.publish ?? wakeTheDrainForThisWebhookReceipt
  const desk = Router()

  desk.post("/api/webhooks/granot/lead-created", acceptThisLeadCreatedWebhookOverHttp)
  desk.post("/api/webhooks/granot/priority-updated", acceptThisPriorityUpdatedWebhookOverHttp)
  desk.post("/api/webhooks/granot/booking-status-changed", acceptThisBookingStatusChangedWebhookOverHttp)
  return desk
}

export default acceptThisGranotWebhookAfterTheWebhookSecret()

// ── 1. Accept this Granot webhook, then wake the drain ───

async function acceptThisLeadCreatedWebhookOverHttp(req, res) {
  return acceptThisGranotWebhookOverHttp(req, res, "lead_created")
}
async function acceptThisPriorityUpdatedWebhookOverHttp(req, res) {
  return acceptThisGranotWebhookOverHttp(req, res, "priority_updated")
}
async function acceptThisBookingStatusChangedWebhookOverHttp(req, res) {
  return acceptThisGranotWebhookOverHttp(req, res, "booking_status_changed")
}

async function acceptThisGranotWebhookOverHttp(req, res, routeEventClass) {
  refuseWhenTheWebhookSecretIsMissing()          // middleware 500
  refuseWhenTheWebhookSecretDoesNotMatch()       // middleware 401; strip x-api-secret
  const auth = readTheProvenWebhookAuth(req)
  if (!auth) return refuseUnauthorizedAgain()    // defense after middleware

  let kept
  try {
    kept = await keepThisWebhookDeliveryAsAGranotObservationReceipt({
      route_event_class: routeEventClass,        // URL, never payload
      captured_at: new Date(),
      headers: req.headers,
      payload: req.body,                         // evidence, not a schema
      authentication_method: auth.authentication_method,
    })
  } catch (error) {
    rememberTheReceiptCouldNotBeStored(routeEventClass, error)
    return refuseStorageUnavailable()            // 503 — no wake-up
  }

  try {
    await wakeTheDrainForThisWebhookReceipt({ receipt_id: kept.receipt_id })
  } catch (error) {
    rememberTheWakeupLeakedWithoutChangingTheAnswer(kept.receipt_id, error)
  }

  return acceptedTheWebhook(routeEventClass, kept.receipt_id)  // 202
}

export const createGranotWebhookRouter = acceptThisGranotWebhookAfterTheWebhookSecret
```

Read the desk path out loud: *Granot POSTed one of the three URLs. The webhook secret middleware already compared header and/or body `x-api-secret`, stripped both, and attached the proven method — or answered 500 / 401. Read that proven auth again. Keep the body as a pending Observation Receipt under the route class this URL named. If storage throws, count a capture failure, tell the company, and answer 503 with no wake-up. After commit, try to wake the drain with only the receipt id. If that skip or throw happens, still answer 202 with the route class and the receipt id. Do not claim. Do not write a Lead.*

That is the operation. `router.post("/api/webhooks/granot/lead-created")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`202` cannot precede commit.** Knowledge and the software map lock this. Capture throw is **503** and never publishes. Do not silently **202** a capture miss so “Granot stops retrying while we have no receipt.” Do not silently **500** capture throw so “it matches leftover unconfigured secret.”

2. **A failed wake-up cannot change `202` or the receipt.** Live `publishGranotLifecycleReceiptWakeup` never throws — skip and send-fail return `{ published: false }` and already emit `granot_lifecycle.queue.publish_failed`. This file still try/catches a throw (inject only) and logs the same name **without** incrementing the queue-publish metric or emitting the event. Do not silently **503** a publish throw so “one failure letter owns keep and poke.” Do not silently drop the try/catch so “the live publisher never throws” without a paired test that the inject still **202**.

3. **The second `401` is defense after the middleware.** `requireGranotWebhookSecret` already returns or attaches `granotWebhookAuth`. `if (!auth)` is dead if that contract holds. Do not silently drop it in this rename without a note that Wave B middleware owns the compare.

4. **The three URLs share one handler through a table.** `route_event_class` comes from the table, never from payload `event_type`. Tests already lock unused fields and the invoked class. Do not silently split `lead-created.ts` so “each verb gets a file.” Do not silently let payload `event_type` win so “Granot can rename the class.”

5. **Payload keys are not schema-validated.** The comment in this file and the knowledge Service say Granot may add or drop unused fields (`service_type` / `cubic_rate`). Do not add Zod in this rename so “routes always validate.”

6. **This desk never claims.** Owner apply desks capture then **ask** `claimAndProcessOrPoll`. This file publishes `{ receipt_id }` and stops. Do not silently call `claimAndProcessOrPoll` here so “the webhook can process without the drain.”

7. **This desk never uses the API secret, HMAC, or the cron secret.** `app.ts` mounts it before public v1, after the RingCentral webhook. `requireGranotWebhookSecret` is the gate. Sales Bearer / Owner HMAC / `CRON_SECRET` are not this story. Do not remount `requireApiSecret` so “it matches leftover reporting.” Do not teach this file `CRON_SECRET` so “one file owns capture and drain.”

8. **Capture-fail letters live here; publish-fail letters live in Wave A.** This file increments `incrementGranotLifecycleCaptureFailures` and emits `granot_lifecycle.capture.failed` on storage throw. Live publish skip / send-fail increment and emit inside already-recommended `queuePublisher.ts`. The route catch for an injected throw only logs. Do not silently emit `queue.publish_failed` from this catch so “one letter owns both inject and live.” Park the gap.

9. **Leave sibling modules alone.** `captureGranotLifecycleWebhookReceipt` / `publishGranotLifecycleReceiptWakeup` / `requireGranotWebhookSecret` / `claimAndProcessOrPoll` are already the right **depth**. This file orchestrates the HTTP **adapter**.

10. **Do not treat leftover Owner apply, leftover HMAC receipts, leftover cron drain, leftover RingCentral inbound, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, or leftover Granot automation as this story.** Next `ringcentral-webhook.routes.ts` is inbound RingCentral. Next `granot-lifecycle-cron.routes.ts` is the five-minute drain. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisGranotWebhookAfterTheWebhookSecret` (mounted on `app.ts` **before** public v1 as the default export) and the one HTTP operation above.

Today `granot-webhook.routes.test.ts` already injects `capture` / `publish` and HTTP-posts the three paths. It names missing config **500**, the four **401** shapes, header / JSON-body / form-body **202** with credential strip, dual-secret `header_secret`, unused fields as-is, invoked route class, capture throw **503** with capture-fail metric + event and no publish, and publish `{ published: false }` / throw still **202**. That is already a real interface test. Keep it. Add the missing mount and refuse proofs (do not boot live Mongo or walk `claimAndProcessOrPoll` in the route file):

**After the webhook secret / who may speak**
- This desk **asks** `requireGranotWebhookSecret` and is mounted from `app.ts` **after** `ringCentralWebhookRoutes`, **before** `v1Routes`.
- Missing `GRANOT_WEBHOOK_SECRET` **500** `"Granot webhook authentication is not configured"` and reaches neither capture nor publisher.
- Missing / wrong / nonscalar / mismatched dual secrets **401** `GRANOT_WEBHOOK_UNAUTHORIZED` and create no receipt.
- Header secret, JSON-body secret, and form-body secret authenticate and strip `x-api-secret` before capture.
- Both valid secrets attach `header_secret` after the body is also validated.
- `requireApiSecret` / Owner HMAC / `CRON_SECRET` are **not** accepted here.

**Keep, then wake**
- Capture uses the invoked route class (`lead_created` / `priority_updated` / `booking_status_changed`), not payload `event_type`.
- Unused Granot field additions or omissions are captured as-is and still **202**.
- Capture throw **503** `"Webhook receipt could not be stored"`, increments capture failures, emits `granot_lifecycle.capture.failed`, and does **not** publish.
- Publish `{ published: false }` still **202** the same `receipt_id`.
- Injected publish throw still **202** the same `receipt_id` (name the route catch vs live publisher never throwing).
- This beat does **not** ask `claimAndProcessOrPoll` / `normalizeGranotObservation` / `createLeadFromGranot` / `synchronizeLeadFromGranot`.

**Mount**
- `app.ts` should keep `app.use(granotWebhookRoutes)` before `v1Routes`.
- Cron `granotLifecycleCronRoutes` stays mounted later and is not this desk.

**Not this file**
- Keep stays on already-recommended [granot-lifecycle-capture.md](granot-lifecycle-capture.md).
- Wake-up stays on already-recommended [granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md).
- Claim / drain stay on already-recommended [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md).
- Owner apply stays on already-recommended [routes-extension-granot-apply.md](routes-extension-granot-apply.md).
- HMAC receipts stay on already-recommended [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md).
- Cron drain stays on next `granot-lifecycle-cron.routes.ts`.
- RingCentral inbound stays on next `ringcentral-webhook.routes.ts`.
- Secret compare stays on leftover Wave B `requireGranotWebhookSecret.ts`.

Do **not** add a test per helper (`readTheProvenWebhookAuth`, `refuseStorageUnavailable`, `rememberTheWakeupLeakedWithoutChangingTheAnswer`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** drop the factory inject in this rename so “the test can no longer isolate keep from poke.”

## What I would not do

- A `GranotWebhookRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, accepted: true })`.
- Moving this into a CRUD folder (`lead-created.ts` / `priority-updated.ts` / `booking-status-changed.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the capture-then-**202** **seam**: do not answer 202 before the receipt commits.
- Breaking the best-effort wake-up **seam**: do not let publish skip or throw change `202` or the receipt.
- Breaking the webhook-secret **seam**: do not remount `requireApiSecret` or admit HMAC / `CRON_SECRET` here.
- Treating leftover `captureGranotLifecycleWebhookReceipt`, leftover `publishGranotLifecycleReceiptWakeup`, leftover `claimAndProcessOrPoll`, leftover `drainDueReceipts`, leftover `applyExtensionGranotItem`, leftover HMAC receipts, leftover RingCentral inbound, leftover CRM Posting, leftover public v1, leftover reporting, leftover Best Relocation, leftover Granot automation, leftover webhook / cron routers, or leftover Owner apply as this story.
- Inventing a leftover claim-lease / leftover cron-secret / leftover Zod / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently 202 a capture miss, 503 a publish throw, letting payload `event_type` rename the route class, adding Zod for unused Granot fields, calling `claimAndProcessOrPoll`, remounting `requireApiSecret`, teaching this file `CRON_SECRET`, or splitting the three URLs into three files while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
