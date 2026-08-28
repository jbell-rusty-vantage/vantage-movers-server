# Hand Twilio The SMS (Now Or Scheduled), Then Only Believe A Callback We Can Prove Is Theirs — operational story

- Status: recommended
- Service: `leadMessaging` (Wave A, visited after this pass)
- Pass: 4 of this service — `twilioAdapter.ts`
- Remaining in this service: none (`quietHours.ts` / `messageBuilder.ts` / `twilioVoice.ts` / `index.ts` skipped on open)
- Target: `src/services/leadMessaging/twilioAdapter.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (Twilio is the provider, not the authority; quiet hours is Message Scheduling `sendAt`). Distinct from remember / send-or-wake / claim-and-send / drain / callback persist / owner retry: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from Granot six gates / CRM Source template / always-append STOP: [recommendations/lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md). Distinct from queue publish env gate: [recommendations/lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md). Distinct from Eastern midnight–7 / 8:00 AM wall clock: skipped `quietHours.ts`. Distinct from public-form template v2: skipped `messageBuilder.ts`. Distinct from voice TwiML (not a Lead Message): skipped `twilioVoice.ts` — that file writes Dial / hangup; this file only checks the signature those voice routes share. Distinct from credential bag / quiet-hours flag: `config/domain/leadMessaging.ts` `getLeadMessagingCredentials`. Distinct from Analytics `sms-successfully-sent-then-booked`. This checkout’s `CONTEXT.md` does not define Lead Message / confirmation SMS / quiet hours — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Knowledge `applies_to` names the remember/send file, Granot sibling, quiet hours, queue, and config — not this adapter. Do not add this path to knowledge in this rename.
- Callers: **three runtime import sites plus the barrel and one folder test.** Claim-and-send: `leadMessaging.service.ts` `dispatchPersistedLeadMessage` imports `createTwilioSender` / `TwilioSender` / `TwilioSendInput` by path (not the barrel) and calls `sender ?? createTwilioSender()` after the 60s lease; quiet-hours `sendAt` is already decided by sibling `buildLeadMessageTwilioSendInput`. Status webhook: `routes/twilio-message-status.routes.ts` calls `validateTwilioWebhook(signature, params)` with no URL (default `TWILIO_STATUS_CALLBACK_URL`), then `applyTwilioStatusCallback` — false → 403, throw → 500 config-invalid. Voice: `routes/twilio-voice.routes.ts` calls `validateTwilioWebhook(signature, params, getTwilioVoiceConfig()[urlKey])` for inbound / status / completed (three configured URLs), then skipped `twilioVoice.ts` TwiML — same false→403 / throw→500 map. Barrel: `leadMessaging/index.ts` re-exports `buildTwilioMessageCreateInput` and `validateTwilioWebhook` only — not the sender. Test: `twilioAdapter.test.ts` (immediate vs scheduled payload; default-URL signature). Sibling `leadMessaging.service.test.ts` injects a fake `TwilioSender` and never constructs the real client. Not callers: `granotCreatedLead.ts`, `leadMessagingQueue.service.ts`, `formLead.service.ts`, `createLeadFromGranot.ts`, admin list/retry, queue consumer, cron drain, `scripts/dev_ops/twilio/`. `getLeadMessagingCredentials` is config, not this **interface**.
- Seams callers need: claimed-row send input vs Twilio REST create; immediate from-number shape vs scheduled Messaging Service + `scheduleType: "fixed"`; injectable `TwilioSender` vs real client (10s timeout); webhook signature vs later status persist; default status-callback URL vs voice’s three configured URLs; missing env throws (500), bad signature returns false (403)
- Split later (only if the file outgrows one sitting): keep one file — this ~97-line module is one screenplay. If it later splits: `shapeTheTwilioSmsCreate.ts` / `handTwilioTheSms.ts` / `checkThatThisWebhookIsReallyFromTwilio.ts` — story files, never `create.ts` / `send.ts` / `validate.ts` / `update.ts` / `delete.ts`, and never merge claim/persist, Granot gates, queue publish, Eastern clock, public-form template v2, or voice TwiML into this file

`createTwilioSender` / `buildTwilioMessageCreateInput` / `validateTwilioWebhook` are executor mechanics. The owner question is: *We already claimed the Lead Message. Talk to Twilio. If the sibling said this is Eastern night, the create still happens now — scheduled for 8:00 AM — and we need a Messaging Service for that. Give us back only the SID and what Twilio said. When Twilio later posts to our webhook, check the signature against the exact URL and the primary token. Voice uses that same check with its own three URLs. This file does not claim. This file does not persist accepted or uncertain. This file does not classify 429 vs timeout. This file does not write TwiML.*

Claim/persist, Granot gates, queue publish, Eastern clock, public-form copy, and voice TwiML already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “talk to Twilio, then only believe a callback we can prove is theirs” story, not “a Twilio CRUD helper,” and not claim / persist / TwiML:

1. **Shape the Twilio SMS create** — pure. Immediate: `to` / `from` / `body` / `statusCallback` only — no `scheduleType`, no `sendAt`, no Messaging Service key. Scheduled: same four fields plus `messagingServiceSid`, `scheduleType: "fixed"`, and `sendAt`. `sendAt` without a Messaging Service throws (`TWILIO_MESSAGING_SERVICE_SID is required to schedule an SMS`). This beat does not read env. This beat does not call Twilio. Quiet hours already decided `sendAt` on the sibling.

2. **Hand Twilio the SMS** — load Account SID + primary auth token from `getLeadMessagingCredentials()`, build a Twilio REST client with a hardcoded 10-second timeout, return a `TwilioSender`. The function builds the create (operation 1), logs start (`twilio.message.send.started` or `twilio.message.schedule.started`) with phones masked and `send_at`, calls `client.messages.create`, logs accept with SID + provider status + masked `to`, and returns `{ sid, status }`. It does not persist. It does not classify. It does not write a Lead Message. `fromNumber` / `statusCallbackUrl` / `messagingServiceSid` on the credentials bag are unused here — those already sit on the sibling’s send input.

3. **Check that this webhook is really from Twilio** — `twilio.validateRequest` with `TWILIO_PRIMARY_AUTH_TOKEN` and the exact URL. Default URL is `TWILIO_STATUS_CALLBACK_URL` (status webhook). Optional `requestUrl` is the voice **seam** (inbound / status / completed). Returns `true` / `false`. Missing env throws via `getRequiredEnv` — routes map that to 500, not 403. This beat does not persist `delivered`. This beat does not write TwiML.

There is no fourth mutate operation. `TwilioSendInput` / `TwilioSender` / `TwilioSendResult` are the handoff types, not public operations.

## Organization

Keep one file as the screenplay for “hand Twilio the SMS (now or scheduled), then only believe a callback we can prove is theirs.” Claim/persist, quiet-hours clock, queue publish, Granot gates, and voice TwiML already live in deeper **modules**. Do not pull those in. Do not invent a `TwilioAdapterService` class. Do not invent a canonical-command `begin` / `complete` **seam** — the sibling already claimed the row; this file is the provider talk. Do not invent a second quiet-hours **adapter** beside `resolveLeadSmsQuietHoursDeferral`. Do not invent a second voice-signature **adapter** beside the optional `requestUrl`. Do not invent a retry-class **adapter** beside sibling `classifyLeadMessagingFailure`.

Do not move REST create into `leadMessaging.service.ts` so “claim owns Twilio.” Do not move signature check onto the status route so “the webhook owns validateRequest.” Do not move TwiML here so “one Twilio folder.” Do not split `create.ts` / `send.ts` / `validate.ts`. Do not silently treat quiet hours as a client delay. Do not silently persist `accepted` here.

**External interface** stays small (this is the test surface). Shape, REST create, and signature check are one story’s Twilio talk, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildTwilioMessageCreateInput` | `shapeTheTwilioSmsCreate` | real sender + folder tests; immediate vs scheduled shape |
| `createTwilioSender` | `handTwilioTheSms` | sibling claim-and-send default; tests inject a fake `TwilioSender` |
| `validateTwilioWebhook` | `checkThatThisWebhookIsReallyFromTwilio` | status webhook (default URL) + voice (three `requestUrl`s) |
| `TwilioSendInput` | `TwilioSmsCreate` | sibling quiet-hours send input → this create |
| `TwilioSender` | `TwilioSender` | injectable **adapter** for claim-and-send + folder tests |
| `TwilioSendResult` | `TwilioAcceptedSms` | `{ sid, status }` only; persist stays on the sibling |

Keep the old names as one-line aliases until claim-and-send, the status webhook, voice routes, and the barrel migrate. Do not make callers learn `getLeadMessagingCredentials` / `twilio.validateRequest` / `timeout: 10_000` as the domain language.

**Principle: old exports stay as aliases.** `createTwilioSender` remains the imported name until `dispatchPersistedLeadMessage` points at the story name. `validateTwilioWebhook` remains the imported name until the two webhook routes migrate.

**No class for the workflow.** The type that *does* earn a name is the accepted-create handoff the sibling already persists as `twilio_message_sid` + `provider_status`:

```ts
type TwilioAcceptedSms = {
  sid: string
  status: string
}
```

That is the handoff from “Twilio took the create” to “claim-and-send may remember `accepted` (or `sent` if Twilio already said sent).” Do **not** add `body` so “the adapter can log the text,” do **not** add `message_id` so “Twilio can persist the row,” and do **not** add `error_code` so “the adapter owns 429.”

`TwilioSendInput` stays the sibling’s quiet-hours **adapter**. It is not a second public operation. The Eastern clock is not this bag.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// twilioAdapter.ts
// We already claimed the Lead Message.
// Talk to Twilio.
// If the sibling said this is Eastern night, create now — scheduled for 8:00 AM.
// Require a Messaging Service for that.
// Give back only the SID and what Twilio said.
// When Twilio later posts, check the signature against the exact URL
// and the primary token.
// Voice uses that same check with its own three URLs.
// This file does not claim.
// This file does not persist accepted or uncertain.
// This file does not classify 429 vs timeout.
// This file does not write TwiML.

// ── 1. Shape the Twilio SMS create ────────────────────────

export function shapeTheTwilioSmsCreate(input)
export const buildTwilioMessageCreateInput = shapeTheTwilioSmsCreate

function thisCreateIsImmediate(input)
function refuseAScheduledCreateWithoutAMessagingService(input)

// ── 2. Hand Twilio the SMS ────────────────────────────────

export function handTwilioTheSms()
export const createTwilioSender = handTwilioTheSms

function openTheTwilioRestClientWithATenSecondTimeout()
async function createTheSmsAndTakeOnlySidAndStatus(input)
function rememberTheCreateStartedWithPhonesMasked(input, payload)
function rememberTwilioAcceptedWithPhonesMasked(input, payload, result)

export type TwilioSmsCreate = { /* today's TwilioSendInput */ }
export type TwilioSender = (input: TwilioSmsCreate) => Promise<TwilioAcceptedSms>
export type TwilioAcceptedSms = { sid: string; status: string }

// ── 3. Check that this webhook is really from Twilio ──────

export function checkThatThisWebhookIsReallyFromTwilio(signature, params, requestUrl?)
export const validateTwilioWebhook = checkThatThisWebhookIsReallyFromTwilio

function theStatusCallbackUrlUnlessVoicePassedItsOwn(requestUrl)
```

Read the primary path out loud: *The Lead Message is already claimed. The sibling already decided whether this create is immediate or scheduled for 8:00 AM Eastern. Shape Twilio’s create — four fields when it is now; those four plus a Messaging Service and `scheduleType: "fixed"` when it is overnight. Missing Messaging Service fails closed. Open the REST client with a 10-second timeout. Log start with phones masked, never the body. Call `messages.create`. Log accept with the SID. Give back `{ sid, status }` and stop. When Twilio later posts to `/api/webhooks/twilio/message-status`, check the signature against `TWILIO_STATUS_CALLBACK_URL` and the primary token. Voice posts to three other URLs and passes each one in. A bad signature is 403. A missing token or URL is 500. Persist `delivered` stays on the sibling. Dial / hangup stay on skipped `twilioVoice.ts`.*

That is the operation. `createTwilioSender` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The credentials bag is mostly unused.** `handTwilioTheSms` calls `getLeadMessagingCredentials()` and uses only `accountSid` + `authToken`. `fromNumber`, `statusCallbackUrl`, and `messagingServiceSid` already sit on the sibling’s send input. Do not start sending `credentials.fromNumber` so “the adapter owns From,” and do not drop the bag so “the sender reads `process.env` like the webhook.”

2. **Webhook validation does not use the credentials bag.** It calls `getRequiredEnv("TWILIO_PRIMARY_AUTH_TOKEN")` and `getRequiredEnv("TWILIO_STATUS_CALLBACK_URL")`. Same token, same default URL, different read. Voice’s `requestUrl` would be lost if this switched to `credentials.statusCallbackUrl` alone. Do not unify the reads so “one bag owns both.”

3. **Claim-and-send re-reads `TWILIO_STATUS_CALLBACK_URL` from `process.env`** and throws if missing, before this sender runs. The sender never looks at `credentials.statusCallbackUrl`. Two fail-closed reads. Do not move the callback URL into `handTwilioTheSms` so “the adapter owns the callback.”

4. **Two Messaging Service error strings.** Sibling quiet-hours: `TWILIO_MESSAGING_SERVICE_SID is required to defer SMS during Eastern quiet hours`. This file: `… is required to schedule an SMS`. Same require, different copy. Do not unify so “one error wins” in this rename — the sibling error is the overnight story; this file’s error is the Twilio shape.

5. **Scheduled payload still includes `from`.** Message Scheduling with a Messaging Service typically uses the service, not From. Today’s create sends both. Do not drop `from` so “Messaging Service owns the number.”

6. **Immediate payload omits the schedule keys entirely.** Tests lock that the object has no `scheduleType` / `sendAt` / `messagingServiceSid`, not `undefined`. Keep that. Do not send `scheduleType: undefined` so “one object shape.”

7. **This file throws; it does not classify.** 429 / timeout / 5xx / `ECONNRESET` stay on sibling `classifyLeadMessagingFailure`. The 10-second client timeout is why a hung create becomes uncertain, not retry. Do not classify here so “the adapter owns retry,” and do not raise the timeout so “uncertain happens less.”

8. **This file does not persist.** `{ sid, status }` only. Lease miss / persist-of-accept miss / `uncertain` stay on the sibling. Do not write `accepted` here so “Twilio owns the row.”

9. **Missing env throws; a bad signature returns false.** Routes map throw → 500 `Webhook configuration error`, false → 403 `Forbidden`. Do not return `false` on missing token so “invalid config looks like a forged callback.”

10. **Status webhook never passes `requestUrl`.** It always validates against `TWILIO_STATUS_CALLBACK_URL`. Voice always passes the configured URL for that callback. Twilio signs the URL the Console posted to. Do not start using `req.originalUrl` so “we match the request host” — a preview host vs the configured callback URL would silently 403 or accept the wrong host.

11. **Voice shares the signature check and is not a Lead Message.** Inbound / status / completed call this file, then skipped `twilioVoice.ts` writes Dial / hangup. Do not move TwiML here so “one Twilio folder,” and do not add `validateTwilioVoiceWebhook` so “voice has its own check.”

12. **The barrel exports shape + signature, not the sender.** Sibling claim-and-send imports `createTwilioSender` by path. Do not add `handTwilioTheSms` to `leadMessaging/index.ts` so “the barrel owns Twilio.”

13. **`createTwilioSender` has no interface test.** Folder tests lock payload shape and the default-URL signature. REST create is untested; sibling injects a fake `TwilioSender`. The signature test never passes `requestUrl` (the voice **seam**) and sets unused `TWILIO_ACCOUNT_SID` / `TWILIO_FROM_NUMBER`. Do not add a live Twilio network test.

14. **Logs mask phones and never the body.** Start / accept include `to` / `from` / `send_at` / `message_sid` / `status`. Do not log `body` so “ops can see the text,” and do not drop `send_at` so “schedule looks like send.”

15. **10-second timeout is hardcoded.** Not in the credentials bag. Do not make it an env so “ops can tune” in this rename.

16. **Knowledge `applies_to` omits this file.** Primary code lists remember/send, Granot sibling, quiet hours, queue, and config. Do not add `twilioAdapter.ts` to knowledge in this pass (Cloud must not edit `docs/knowledge`). Leave the gap visible.

17. **Leave sibling modules alone.** `buildLeadMessageTwilioSendInput` / `assertTwilioScheduleLeadTime` / `classifyLeadMessagingFailure` / `applyTwilioStatusCallback` stay on `leadMessaging.service.ts`. `resolveLeadSmsQuietHoursDeferral` stays on skipped `quietHours.ts`. `getLeadMessagingCredentials` stays in config. Voice TwiML stays on skipped `twilioVoice.ts`. This file orchestrates shape → REST create, and separately signature check.

18. **Do not treat quiet hours as a client sleep.** Overnight is Message Scheduling on the create. Do not `setTimeout` until 8:00 AM so “the adapter waits until morning.”

## Testing

The **interface** is the test surface: `shapeTheTwilioSmsCreate`, `handTwilioTheSms`, `checkThatThisWebhookIsReallyFromTwilio` (today `buildTwilioMessageCreateInput`, `createTwilioSender`, `validateTwilioWebhook`). `{ sid, status }` and `true | false` are part of that **interface**.

Today’s `twilioAdapter.test.ts` already names immediate vs scheduled payload (including the missing-Messaging-Service throw) and default-URL signature true/false. That is a strong start for shape + the status-webhook **adapter** and still not the whole story. The factory has no test. The voice `requestUrl` **seam** has no test. Sibling remember/send tests inject a fake sender and never construct the real client. That is correct for claim-and-send and not enough for this provider talk. Add tests that name the operation. Do not add a test per helper. Do not add a live Twilio network test.

**Shape the Twilio SMS create**
- Immediate input → exactly `to` / `from` / `body` / `statusCallback`. No schedule keys.
- `sendAt` + Messaging Service → those four plus `messagingServiceSid`, `scheduleType: "fixed"`, same `sendAt` Date.
- `sendAt` without Messaging Service → throws `/TWILIO_MESSAGING_SERVICE_SID/`.
- This function does not read env.

**Hand Twilio the SMS**
- Factory returns a function. Missing Account SID / primary token fail closed via `getLeadMessagingCredentials` (do not call Twilio).
- Injected client / fake `TwilioSender` stays the claim-and-send **adapter** — prove the sibling still accepts `{ sid, status }`.
- Do not hit Twilio’s network from this folder.

**Check that this webhook is really from Twilio**
- Default URL + primary token + matching signature → `true`.
- Tampered params → `false` (not a throw).
- Missing token or default URL → throw (routes map to 500, not 403).
- `requestUrl` override (voice **seam**) validates against that URL, not `TWILIO_STATUS_CALLBACK_URL`.
- Do not prove persist `delivered` here — that stays on sibling `applyTwilioStatusCallback`.

**Not this interface**
- Remember / send-or-wake / claim / drain / callback persist / retry stay on [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md).
- Granot six gates / STOP stay on [recommendations/lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md).
- Queue publish env gate stays on [recommendations/lead-messaging-lead-messaging-queue.md](lead-messaging-lead-messaging-queue.md).
- Eastern clock stays on skipped `quietHours.ts`.
- Public-form template v2 stays on skipped `messageBuilder.ts`.
- Voice Dial / hangup / expected-destination stay on skipped `twilioVoice.ts`.
- Credential bag shape stays on `leadMessaging.test.ts`.
- Status 204 / 404 “Message not recorded yet” stay on the status-webhook **adapter**.

Do **not** add a test per helper (`thisCreateIsImmediate`, `rememberTheCreateStartedWithPhonesMasked`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`TwilioSender` stays exported because claim-and-send’s injected sender is a second real **adapter**, not a test leak.

## What I would not do

- A `TwilioAdapterService` class with `create` / `send` / `validate` / `update` / `delete`.
- Thirty two-line functions that only wrap `client.messages.create` or `twilio.validateRequest`.
- Moving this into a CRUD folder, or into `leadMessaging.service.ts` / the webhook routes “for cleanliness.”
- Breaking the claim / Twilio-create / persist-accept **seam**. This file returns `{ sid, status }`. The sibling remembers `accepted` / `uncertain`.
- Treating Granot gates, queue publish, Eastern clock, public-form copy, voice TwiML, or callback persist as this story.
- Inventing a second signature **seam** that has only one **adapter** (voice already passes `requestUrl`).
- Inventing a retry-class **seam** beside `classifyLeadMessagingFailure`.
- Silently “fixing” scheduled creates by dropping `from`, unifying the two Messaging Service errors, or validating against `req.originalUrl`, while recommending a rename.
- Jumping to `sheetSync` while this file was unchecked (it is this pass).
- Writing a whole-folder recommendation for `leadMessaging`.
- Logging the SMS body.
- Sleeping until 8:00 AM Eastern inside the client.
- Failing Form Lead create because Twilio threw — that containment stays on the sibling.
