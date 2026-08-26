# Wake The Drain For This Webhook Receipt — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 2 of this service — `queuePublisher.ts`
- Remaining in this service: `extensionApply.ts`, `automationApply.ts`, `automationCompatibility.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/queuePublisher.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md` (Queue wake-up). Distinct from the claim/drain: `docs/knowledge/granot-lifecycle/drainer.md` + `api/queues/granot-lifecycle-consumer.ts`. Distinct from receipt insert: `recommendations/granot-lifecycle-capture.md`. Distinct from Owner extension apply: `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from HTTP automation apply: `docs/knowledge/granot-lifecycle/automation-apply.md`. Distinct from Sheet Sync wake-up: `src/services/sheetSync/sheetSyncQueue.service.ts`. Distinct from CRM Posting: `docs/knowledge/services/form-lead.md`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Observation Channel / System of Record — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/granot-webhook.routes.ts` (after `captureGranotLifecycleWebhookReceipt` commits; `202` whether this returns `{ published: false }` or throws). Tests: `queuePublisher.test.ts`, `granot-webhook.routes.test.ts` (injected `publish`). Config gates live in `config/domain/granotWebhook.ts` (`shouldPublishGranotLifecycleQueue`, `getGranotLifecycleQueueTopic`). Consumer: `api/queues/granot-lifecycle-consumer.ts` (`parseReceiptWakeup` then `drainRequestedReceipt`). Not callers: `capture.ts`, `extensionApply.ts`, `automationApply.ts`, `operations.ts` requeue, five-minute cron.
- Seams callers need: after-commit best-effort wake-up vs skip this environment vs fail without throwing; injected `shouldPublish` / `send` for tests; payload is exactly `{ receipt_id }`
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `publish.ts` / `skip.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`publishGranotLifecycleReceiptWakeup` is executor mechanics. The owner question is: *the webhook receipt is already saved. Try to wake the drain so someone looks at this receipt soon. If we cannot publish, the receipt still stands and Granot still hears `202`. The five-minute cron will find due work.*

Receipt insert, secret compare, claim/drain, Observation normalize, Owner apply, and Sheet Sync wake-up already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a queue CRUD service,” and not capture / claim / drain:

1. **Wake the drain for this webhook receipt** — accept only a `receipt_id`. Rebuild the payload as exactly `{ receipt_id }` (drop anything else). Ask the config gate whether this environment may publish (not the test runner, not `TEST_MODE`, hosted Vercel function, approved `VERCEL_ENV`). If not, log a masked skip and return `{ published: false }` — no send, no failure metric, no operational event. If yes, `send` the env-scoped topic (`granot-lifecycle-events` on the live Vercel topic, otherwise `granot-lifecycle-events-dev`, unless `GRANOT_LIFECYCLE_QUEUE_TOPIC` overrides). Success logs a masked id and returns `{ published: true }`. Send throw increments `granot_lifecycle` queue-publish failures, writes a PII-safe error log, emits `granot_lifecycle.queue.publish_failed` with `channel: "granot_webhook"`, and still returns `{ published: false }`. This function never throws. It never claims. It never writes a receipt, Lead, or Booking. Telemetry is hardcoded `observation_channel: "granot_webhook"` because the only live caller is the webhook route.

There is no second mutate operation. Channel apply enters `claimAndProcessOrPoll` directly. Owner requeue sets the receipt `pending` and does not publish. Cron scans due Mongo work. Sheet Sync publishes `{ kind, reason, run_hint }`, not a receipt id.

## Organization

Keep one file. This is the screenplay for “wake the drain for this webhook receipt.” Config gates, Vercel `send`, claim/drain, and receipt insert already live in deeper **modules**. Do not pull those in. Do not invent a `GranotQueuePublisherService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a best-effort wake-up after commit, not a Domain Command. Do not invent a Sheet-Sync-shaped `{ kind, reason }` **seam** that has only one real adapter here.

Do not split this ~70-line file into skip / send / fail folders. Those are beats of one wake-up. Do not move the function into `capture.ts` “because knowledge lists it on the capture stack.” Do not move it into `drainer.ts` “because the consumer already claims.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `publishGranotLifecycleReceiptWakeup` | `wakeTheDrainForThisWebhookReceipt` | webhook route after commit; tests inject skip / send / throw |
| `GranotLifecycleReceiptWakeup` | `ReceiptWakeup` | consumer `parseReceiptWakeup` accepts only `{ receipt_id }` |
| `PublishGranotLifecycleReceiptWakeupDeps` | `WakeTheDrainDeps` | test **seam**: override the config gate and Vercel `send` |

Keep the old names as one-line aliases until the webhook router migrates. Do not make callers learn `VERCEL_REGION` / `queuePublishFailuresTotal` / `@vercel/queue` as the domain language.

`shouldPublish` / `send` on the deps bag stay test **seams**. They are not a second public operation. Default remains `shouldPublishGranotLifecycleQueue` and Vercel `send`.

**No class for the workflow.** The type that *does* earn a name is the wake-up bag the consumer will parse:

```ts
type ReceiptWakeup = {
  receipt_id: string
}
```

That is the handoff from “the webhook receipt is saved” to “a later invocation may claim this id.” Do **not** add `kind` / `reason` / `run_hint` so “every Vantage wake-up looks like Sheet Sync,” and do **not** add `observation_channel` onto the payload so “the consumer knows it is a webhook” — `parseReceiptWakeup` fails closed when keys are not exactly `receipt_id`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queuePublisher.ts
// The webhook receipt is already saved.
// Try to wake the drain for that receipt id.
// If this environment must not publish, skip.
// If Vercel Queue is down, swallow the failure.
// Granot still hears 202. The cron will find due work.
// This file does not insert a receipt.
// This file does not claim or process.
// Channel apply does not call this file.

// ── 1. Wake the drain for this webhook receipt ────────────

export async function wakeTheDrainForThisWebhookReceipt(message, deps?)

function takeOnlyTheReceiptId(message)            // rebuild { receipt_id }
function thisEnvironmentMustNotPublish()          // sibling config gate
function rememberWeSkippedTheWakeup(receipt_id)   // masked log; no metric
async function sendTheReceiptIdToTheLifecycleTopic(wakeup)
function rememberTheWakeupWentOut(receipt_id)
async function rememberTheWakeupFailedWithoutThrowing(receipt_id, error)
  // metric + safe log + granot_lifecycle.queue.publish_failed
```

Read the primary path out loud: *Granot posted lead-created. The route already kept the receipt and has a receipt id. Ask whether this host may wake the drain. On the approved Vercel host, send exactly that id — nothing else — on the lifecycle topic. If the send throws, count the failure, tell observability, and return unpublished. Either way the route answers 202. Local, preview, tests, and TEST_MODE skip the send. The five-minute cron still scans due receipts. The owner’s extension apply never comes through here.*

That is the operation. `deps.send` is not a different story. `claimAndProcessOrPoll` is not this wake-up.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The name is generic; the telemetry is webhook-only.** Every skip, success, and failure log stamps `observation_channel: "granot_webhook"`. The only live caller is the webhook route. Channel apply never publishes. Do not start calling this from `extensionApply` / `automationApply` so “every receipt wakes the queue,” and do not take a channel argument so “the function matches its name.” If a later story needs a channel wake-up, that is a different **adapter** — today’s apply path claims instead.

2. **This file never throws; the route still catches.** `wakeTheDrainForThisWebhookReceipt` swallows send errors. The webhook route wraps `publish` in its own `try/catch` so an injected adapter that *does* throw cannot change `202`. Route tests lock both `{ published: false }` and a thrown `publisher leaked`. Do not delete the route catch so “the publisher is honest,” and do not start throwing from this file so “the route can distinguish skip from fail.”

3. **Skip and fail both return `{ published: false }`.** The route ignores the boolean. Skip must not increment failures or emit `publish_failed`. Fail must do both and still not throw. Do not return `skipped | failed | published` on the HTTP body so “Granot can see why,” and do not increment the failure metric on skip so “every unpublished look like an outage.”

4. **The payload is rebuilt, not forwarded.** `takeOnlyTheReceiptId` drops extra keys. `parseReceiptWakeup` throws unless the unwrapped body has exactly one key, `receipt_id`, and that value is a Mongo ObjectId (or a Vercel `{ data: { receipt_id } }` wrapper). Do not send the Granot body, headers, route class, or hash so “the consumer has evidence,” and do not wrap the send in `{ data }` here so “we match Vercel’s envelope” — unwrap lives on the drain side.

5. **Do not copy the Sheet Sync wake-up.** `publishSheetSyncWakeup` sends `{ kind: "sheet_sync_wakeup", reason, run_hint }` and may pass `idempotencyKey` so bursts coalesce. This file sends `{ receipt_id }` and has no debounce key. Two webhook deliveries are two receipts. Do not add `kind` / `reason` so “every queue looks the same” (`parseReceiptWakeup` would refuse), and do not add Sheet-Sync-style idempotency so “identical Granot retries collapse” (webhook capture already stored two rows).

6. **Publish stays after commit, outside capture.** Knowledge capture Role names this file on the capture stack. `capture.ts` never publishes. The previous pass already recorded that fight. Do not move `wakeTheDrainForThisWebhookReceipt` into `keepThisWebhookDeliveryAsAGranotObservationReceipt` so the Role line “wins,” and do not publish from a capture `catch` so “the cron will find a receipt we never wrote.”

7. **Channel apply, Owner requeue, and cron are other wake paths.** Extension / automation capture then `claimAndProcessOrPoll`. Requeue sets `pending` / due-now and does not publish. Cron `/api/cron/granot-lifecycle-drain` scans due work. Do not publish from those **modules** so “every entry uses the queue,” and do not delete this file so “cron is enough” — the approved Vercel host still wants the faster wake-up.

8. **Config gates stay in `granotWebhook.ts`.** Test runner, `TEST_MODE`, `VERCEL === "1"`, nonempty `VERCEL_REGION`, and approved `VERCEL_ENV` are the sibling’s **interface**. Preview/staging never publish. This file only asks `thisEnvironmentMustNotPublish()`. Do not inline the env reads so “the publisher is self-contained,” and do not honor `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` so “local queue testing works the same.”

9. **Two `maskLifecycleId` functions.** `safeLogging.ts` masks logs as `abcd…wxyz` (or `…` when short). `observability.ts` masks event details as `abcdef...wxyz` (or `***` when length ≤ 10). This file uses the log helper; `emitGranotLifecycleEvent` re-masks `details.receipt_id` and `entity.id`. Tests lock the event shape (`receip...iled` for `receipt-failed`). Do not pre-mask the event `details` so “we are extra safe” (double-mask would break the test and the catalog), and do not collapse the two helpers so “one mask wins.”

10. **This file does not validate ObjectId.** Capture already inserted a real id. Publisher tests send `receipt-1`. `parseReceiptWakeup` refuses a non-ObjectId *on consume*. Do not add `mongoose.isValidObjectId` here so “bad ids never queue,” and do not relax the consumer so synthetic test ids “can drain.”

11. **Failure telemetry must stay PII-safe.** `safeLifecycleFailureLog` keeps `error_code`, not the thrown message. Observability drops forbidden keys (`payload`, `secret`, `job_no`, `message`, …). The failure test already locks `synthetic-queue-unavailable` out of the captured event JSON. Do not attach `err: error` the way Sheet Sync does so “debug is easier.”

12. **Leave sibling modules alone.** `shouldPublishGranotLifecycleQueue` / `getGranotLifecycleQueueTopic` stay in config. `incrementGranotLifecycleQueuePublishFailures` stays in `metrics.ts`. `emitGranotLifecycleEvent` stays in `observability.ts`. `parseReceiptWakeup` / `drainRequestedReceipt` stay in `drainer.ts`. `keepThisWebhookDeliveryAsAGranotObservationReceipt` stays in `capture.ts`. This file orchestrates gate → strip id → send or swallow.

13. **Do not treat Follow Up enrichment, Booked Jobs recon, CRM Posting, or Owner Booking commands as this story.** Those write Leads or Bookings. This file sends an id. Do not write a whole-folder recommendation for `granotLifecycle`.

## Testing

The **interface** is the test surface: `wakeTheDrainForThisWebhookReceipt` (today `publishGranotLifecycleReceiptWakeup`). `{ published: true | false }` and the sent `{ receipt_id }` are part of that **interface**.

Today’s `queuePublisher.test.ts` already locks test-runner skip (injected `send` is not called), exact `{ receipt_id }` when the gate is forced on, and fail-closed (no throw, failure metric 1, `granot_lifecycle.queue.publish_failed`, masked details, no secret/error text). Keep those. Add the gaps that name the operation:

**Wake the drain for this webhook receipt**
- Forced-on send uses the topic from `getGranotLifecycleQueueTopic()` and a payload whose keys are exactly `["receipt_id"]`.
- Extra fields on the input message are not sent.
- Skip (default test-runner gate, or injected `shouldPublish: () => false`) → `{ published: false }`, send not called, failures stay 0, no operational event.
- Send throw → `{ published: false }`, failures 1, event `channel: "granot_webhook"`, thrown message absent from the serialized event.
- This file does not throw. Do not re-test the route’s `202` envelope here — `granot-webhook.routes.test.ts` already locks capture-fail `503` / no publish, and publish-fail or publish-throw still `202` with the same `receipt_id`.

Do **not** add a test per helper (`takeOnlyTheReceiptId`, `thisEnvironmentMustNotPublish`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test secret compare, `VERCEL_ENV` matrix (that is `granotWebhook.test.ts`), `parseReceiptWakeup` ObjectId refuse, `claimAndProcessOrPoll`, Owner requeue, Sheet Sync `publishSheetSyncWakeup`, or `applyExtensionGranotItem` here. Do not add a test that channel capture publishes — it must not.

## What I would not do

- A `GranotQueuePublisherService` class with `publish` / `skip` / `fail`.
- Thirty two-line functions that only wrap `send()`.
- Moving this into a CRUD folder, or into `capture.ts` / `drainer.ts` “for cleanliness.”
- Publishing from capture, channel apply, requeue, or cron.
- Sending the Granot body, a Sheet-Sync `{ kind, reason }` bag, or an idempotency key.
- Throwing on send failure, or making `202` wait on `{ published: true }`.
- Teaching CRM Posting, Follow Up enrichment, or Booked Jobs recon to wake this queue.
- Writing a whole-folder recommendation for `granotLifecycle`.
