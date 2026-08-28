# Wake The Drain For Due Lead Messages — Never Throw, Mongo Still Owns Who Sends — operational story

- Status: recommended
- Service: `leadMessaging` (Wave A, in-progress)
- Pass: 3 of this service — `leadMessagingQueue.service.ts`
- Remaining in this service: `twilioAdapter.ts` (`quietHours.ts` / `messageBuilder.ts` / `twilioVoice.ts` / `index.ts` skipped on open)
- Target: `src/services/leadMessaging/leadMessagingQueue.service.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (Queue publish is gated; Mongo still owns drain order). Distinct from remember / send-or-wake / claim-and-send / drain / callback / owner retry: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from Granot six gates / CRM Source template / always-append STOP: [recommendations/lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md). Distinct from Twilio REST create / webhook signature: later `twilioAdapter.ts`. Distinct from Eastern midnight–7 / 8:00 AM wall clock: skipped `quietHours.ts`. Distinct from public-form template v2: skipped `messageBuilder.ts`. Distinct from voice TwiML: skipped `twilioVoice.ts`. Distinct from Granot receipt-id wake-up: [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md) (`{ receipt_id }` only; consumer parses). Distinct from later Wave A Sheet Sync wake-up (`{ kind, reason, run_hint }` + operational event on fail). Distinct from five-minute cron `/api/cron/lead-messaging-drain` (drains; does not publish). This checkout’s `CONTEXT.md` does not define Lead Message / confirmation SMS / quiet hours — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy.
- Callers: **three runtime import sites, all in the sibling remember/send file. No barrel. No folder test.** After a retryable Twilio miss: `leadMessaging.service.ts` `handleDispatchFailure` publishes `reason: "retry"` with `lead-message-retry-${id}-${attempt_count}` when 429 / `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN` and attempts `< 4`. Queued mode after persist: `queueInitialLeadMessage` publishes `reason: "initial"` with `lead-message-initial-${messageId}` and **always** returns `{ status: "queued" }`. Owner retry: `requestLeadMessageRetry` publishes `reason: "manual_retry"` with `lead-message-manual-${id}-${manual_retry_count}` after the row is already `queued`. Consumer: `api/queues/lead-messaging-consumer.ts` ignores the payload and calls `runLeadMessagingDrain("queue")`. Cron: `routes/lead-messaging-cron.routes.ts` calls `runLeadMessagingDrain("cron")` and **does not** import this file. Config: `config/domain/leadMessaging.ts` `shouldPublishLeadMessagingQueue` / `getLeadMessagingQueueTopic` (tested in `leadMessaging.test.ts`). Not callers: `granotCreatedLead.ts` (sibling send-or-wake may reach `queueInitial` / retry), `formLead.service.ts`, `createLeadFromGranot.ts`, admin list/detail, Twilio status webhook, voice routes, the barrel `leadMessaging/index.ts`. There is no `leadMessagingQueue.service.test.ts`.
- Seams callers need: after-commit best-effort wake-up vs skip this environment vs fail without throwing; payload is a wake-up (`{ kind, reason }`), not a Lead Message id; idempotency is per row / attempt, not a burst coalesce; cron and the consumer drain Mongo and do not publish; Form Lead 201 / mint finalize must not wait on `{ published: true }`
- Split later (only if the file outgrows one sitting): keep one file — this ~40-line module is one screenplay. Never `publish.ts` / `skip.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge remember/send, Granot gates, Twilio REST, Eastern clock, Sheet Sync wake-up, or the cron drain into this file

`publishLeadMessagingWakeup` is executor mechanics. The owner question is: *The Lead Message is already saved. If this host is allowed to wake the drain, send a tiny wake-up on the Lead Messaging topic so someone looks at due rows soon. If we cannot publish, return false and do not throw. Mongo still owns who is due. The five-minute cron will find the work. This file does not claim. This file does not talk to Twilio. This file does not decide which Lead Message to send.*

Remember/send, Granot gates, Twilio REST, Eastern clock, Sheet Sync wake-up, and cron drain already live in other **modules**. Do not pull those in.

## What this file actually does

One operation, not “a queue CRUD service,” and not remember / claim / drain / Twilio:

1. **Wake the drain for due Lead Messages** — accept a reason (`initial` | `retry` | `manual_retry` | `cron`) and an optional idempotency key. Ask the sibling config gate whether this environment may publish (not `TEST_MODE`, not the test runner, hosted Vercel function, approved `VERCEL_ENV`). If not, return `false` — no send, no skip log, no operational event. If yes, `send` `{ kind: "lead_messaging_wakeup", reason }` on the env-scoped topic (`lead-messaging-events` when the publish gate’s host matches, otherwise `lead-messaging-events-dev`, unless `LEAD_MESSAGING_QUEUE_TOPIC` overrides), passing the idempotency key through. Success logs `lead_messaging.queue.published` and returns `true`. Send throw logs `lead_messaging.queue.publish_failed` with `err` and still returns `false`. This function never throws. It never claims. It never writes a Lead Message, Lead, or Booking. It never talks to Twilio.

There is no second mutate operation. The consumer ignores `kind` / `reason` and drains due Mongo. Cron never calls this file. `reason: "cron"` is on the union and has no publisher.

## Organization

Keep one file as the screenplay for “wake the drain for due Lead Messages — never throw, Mongo still owns who sends.” Config gates, Vercel `send`, remember/send, claim/drain, and Twilio REST already live in deeper **modules**. Do not pull those in. Do not invent a `LeadMessagingQueueService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a best-effort wake-up after the Lead Message is already saved, not a Domain Command. Do not invent a Granot `{ receipt_id }` **seam** that has only one **adapter** here — the consumer does not parse an id. Do not invent a Sheet-Sync operational-event **seam** beside `logger.error`.

Do not split this ~40-line file into skip / send / fail folders. Those are beats of one wake-up. Do not move the function into `leadMessaging.service.ts` so “send-or-wake owns publish.” Do not move it into the consumer so “the drain already runs.” Do not publish from cron so “every drain uses the queue.”

**External interface** stays small (this is the test surface). Gate, send, and swallow are one story’s wake-up, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `publishLeadMessagingWakeup` | `wakeTheDrainForDueLeadMessages` | sibling queued-mode initial, retryable miss, owner retry |
| `LeadMessagingWakeupReason` | `LeadMessagingWakeupReason` | four-reason union the payload carries; consumer does not branch on it |

Keep the old name as a one-line alias until the sibling remember/send file migrates. Do not make callers learn `VERCEL_REGION` / `@vercel/queue` / `LEAD_MESSAGING_QUEUE_TOPIC` as the domain language.

**Principle: old exports stay as aliases.** `publishLeadMessagingWakeup` remains the imported name until `queueInitialLeadMessage` / retry / owner retry point at the story name.

**No class for the workflow.** The type that *does* earn a name is the wake-up bag the consumer will keep ignoring:

```ts
type LeadMessagingWakeup = {
  kind: "lead_messaging_wakeup"
  reason: LeadMessagingWakeupReason
}
```

That is the handoff from “a Lead Message is due” to “a later invocation may drain whoever Mongo says is due.” Do **not** add `message_id` so “the consumer can claim this row,” do **not** add `run_hint` so “every Vantage wake-up looks like Sheet Sync,” and do **not** drop `kind` / `reason` so “the payload matches Granot `{ receipt_id }`.”

There is no deps bag today. Do not invent `WakeTheDrainDeps` unless a later test **adapter** needs to inject the config gate and Vercel `send`. Default remains `shouldPublishLeadMessagingQueue` and Vercel `send`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadMessagingQueue.service.ts
// The Lead Message is already saved.
// Try to wake the drain so someone looks at due rows soon.
// If this environment must not publish, skip.
// If Vercel Queue is down, swallow the failure.
// Mongo still owns who is due.
// The five-minute cron will find the work.
// This file does not claim.
// This file does not talk to Twilio.
// This file does not decide which Lead Message to send.
// Cron does not call this file.

// ── 1. Wake the drain for due Lead Messages ───────────────

export async function wakeTheDrainForDueLeadMessages(reason, idempotencyKey?)
export const publishLeadMessagingWakeup = wakeTheDrainForDueLeadMessages

function thisEnvironmentMustNotPublish()          // sibling config gate
async function sendTheWakeupOnTheLeadMessagingTopic(reason, idempotencyKey)
function rememberTheWakeupWentOut(reason, idempotencyKey)
function rememberTheWakeupFailedWithoutThrowing(reason, error)

export type LeadMessagingWakeupReason =
  | "initial"
  | "retry"
  | "manual_retry"
  | "cron"
```

Read the primary path out loud: *The confirmation SMS is already written. Queued mode (or a 429 retry, or the owner’s retry) asks this host to wake the drain. On the approved Vercel host, send `{ kind: "lead_messaging_wakeup", reason }` — not a Lead Message id — on the Lead Messaging topic, with a per-row idempotency key. If the send throws, log it and return false. Either way the Form Lead 201 and the minted Lead stay. Local, preview, tests, and TEST_MODE skip the send. The consumer ignores the payload and drains due Mongo. The five-minute cron still scans due rows and never publishes.*

That is the operation. `publishLeadMessagingWakeup` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The consumer ignores the payload.** `lead-messaging-consumer.ts` connects Mongo and calls `runLeadMessagingDrain("queue")`. It does not parse `kind` or `reason`. Mongo owns due / lease / limit. Do not start switching on `reason` so “the consumer knows why,” and do not send `message_id` so “the consumer can claim this row.” Granot’s consumer parses exactly `{ receipt_id }`. This drain is a scan, not an id claim.

2. **`cron` is on the reason union and never published.** The cron route drains directly. No caller passes `"cron"` into this file. Do not publish from `/api/cron/lead-messaging-drain` so “every drain uses the queue,” and do not delete `cron` from the union so “the type is honest” in this rename. Leave the unused reason visible.

3. **Skip returns `false` with no skip log.** Sheet Sync and Granot log a skip. This file `return false` on a closed gate. Fail logs `lead_messaging.queue.publish_failed`. Do not add a skip log so “we match Sheet Sync,” and do not increment a failure metric on skip so “every unpublished looks like an outage.”

4. **All three callers ignore the boolean.** `queueInitialLeadMessage` always returns `{ status: "queued" }`. Retry and owner retry await and discard. Form Lead Ingestion / mint finalize must not wait on a wake-up. Do not throw so “queued mode can fail the 201,” and do not change the sibling to return `unpublished` so “the 201 becomes honest.”

5. **No operational event on fail.** Sheet Sync writes `sheet_sync.queue.publish_failed`. Granot emits `granot_lifecycle.queue.publish_failed` and increments a metric. This file only `logger.error({ err })`. Do not add `recordOperationalEvent` so “every queue matches Sheet Sync” in this rename.

6. **Idempotency is per row / attempt, not a burst coalesce.** Keys are `lead-message-initial-${messageId}`, `lead-message-retry-${id}-${attempt_count}`, `lead-message-manual-${id}-${count}`. Sheet Sync may pass one debounce key so a burst collapses. Two Lead Messages are two wake-ups; the same row at a later attempt is a new key. Do not use a single `lead-messaging-wakeup` key so “all wake-ups collapse,” and do not drop the key so “every write wakes twice.”

7. **Publish stays after the Lead Message is saved, outside persist.** Knowledge Role names this file on the Lead Messaging stack. Persist never publishes. The previous pass already recorded send-or-wake as the after-commit **seam**. Do not move `wakeTheDrainForDueLeadMessages` into `rememberTheOutboundConfirmationSms` so the Role line “wins,” and do not publish from a persist `catch` so “the cron will find a row we never wrote.”

8. **Inline send can still wake on retry.** `queueInitialLeadMessage` is queued mode only. `handleDispatchFailure` publishes `retry` from claim-and-send, which inline mode also uses. Owner retry always publishes. Do not refuse `retry` when mode is `inline` so “inline never touches the queue,” and do not publish from every inline accept so “every send wakes.”

9. **The publish gate is independent of `LEAD_MESSAGING_MODE`.** Queued mode on a laptop still returns `false`. Disabled drain no-ops even if a leftover wake-up arrives. Do not require `mode === "queued"` inside this file so “disabled never wakes,” and do not honor a `SHEET_SYNC_QUEUE_LOCAL_PUBLISH`-shaped flag so “local queue testing works the same.” There is no local-publish escape hatch here.

10. **Config gates stay in `leadMessaging.ts`.** Test runner, `TEST_MODE`, `VERCEL === "1"`, nonempty `VERCEL_REGION`, and approved `VERCEL_ENV` are the sibling’s **interface**. Preview never publishes. This file only asks `thisEnvironmentMustNotPublish()`. Lead Messaging also refuses `isTestMode()` (Sheet Sync’s publish gate does not name that check). Do not drop the TEST_MODE refuse so “we match Sheet Sync,” and do not inline the env reads so “the publisher is self-contained.”

11. **This file does not validate a Lead Message id.** There is no id on the payload. Publisher callers already persisted the row. Do not add `mongoose.isValidObjectId` here so “bad ids never queue.”

12. **The barrel does not re-export this file.** Sibling remember/send imports the path. Do not add `publishLeadMessagingWakeup` to `leadMessaging/index.ts` so “the barrel owns messaging.”

13. **Leave sibling modules alone.** `shouldPublishLeadMessagingQueue` / `getLeadMessagingQueueTopic` stay in config. `queueInitialLeadMessage` / retry / owner retry stay in `leadMessaging.service.ts`. `runLeadMessagingDrain` stays the drain. `createTwilioSender` stays later `twilioAdapter.ts`. This file orchestrates gate → send or swallow.

14. **Do not treat quiet hours as a publish delay.** Overnight is Twilio Message Scheduling on claim-and-send. Do not hold the wake-up until 8:00 AM Eastern so “the queue waits until morning.”

## Testing

The **interface** is the test surface: `wakeTheDrainForDueLeadMessages` (today `publishLeadMessagingWakeup`). `true | false` and the sent `{ kind, reason }` are part of that **interface**.

There is no `leadMessagingQueue.service.test.ts`. Config tests lock topic + preview-off. Sibling remember/send tests never stub this file. That is not enough for a wake-up this small and this load-bearing. Add tests that name the operation. Do not add a test per helper.

**Wake the drain for due Lead Messages**
- Closed gate (default test runner / `TEST_MODE` / preview) → `false`, `send` not called, no `publish_failed` log.
- Forced-on send uses `getLeadMessagingQueueTopic()` and a payload whose keys are exactly `["kind", "reason"]` with `kind === "lead_messaging_wakeup"`.
- Success → `true` and `lead_messaging.queue.published`.
- Send throw → `false`, this file does not throw, `lead_messaging.queue.publish_failed` is logged, no operational event (today’s contract).
- Idempotency key is forwarded to `send` when present and omitted when absent.
- `reason: "cron"` is accepted if someone passes it; no runtime caller does.

**Not this interface**
- Remember / send-or-wake / claim / drain / callback / retry stay on [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md).
- Granot six gates / STOP stay on [recommendations/lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md).
- `VERCEL_ENV` topic matrix stays on `leadMessaging.test.ts`.
- Consumer drain / cron `202`-shaped JSON stay on those **adapters**.
- Granot `{ receipt_id }` wake-up stays on [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md).
- Sheet Sync `{ kind, reason, run_hint }` stays on later `sheetSync`.
- Webhook signature stays on later `twilioAdapter.ts`.

Do **not** add a test per helper (`thisEnvironmentMustNotPublish`, `rememberTheWakeupWentOut`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that cron publishes — it must not. Do not add a test that the consumer branches on `reason` — it must not.

## What I would not do

- A `LeadMessagingQueueService` class with `publish` / `skip` / `fail`.
- Thirty two-line functions that only wrap `send()`.
- Moving this into a CRUD folder, or into `leadMessaging.service.ts` / the consumer “for cleanliness.”
- Publishing from persist, cron, or the consumer.
- Sending a Lead Message id, a Granot `{ receipt_id }`, or a Sheet-Sync `run_hint`.
- Throwing on send failure, or making the Form Lead 201 / minted Lead wait on `{ published: true }`.
- Teaching quiet hours, Granot gates, or voice TwiML to wake this queue.
- Honoring a local-publish escape hatch this file does not have.
- Jumping to `sheetSync` while `twilioAdapter.ts` is unchecked.
- Writing a whole-folder recommendation for `leadMessaging`.
- Failing Form Lead create because Vercel Queue threw.
