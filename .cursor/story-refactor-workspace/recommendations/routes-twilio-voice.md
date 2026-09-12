# After Twilio's Signature Proves This Voice Post Is Theirs, Dial The RingCentral Number We Already Chose, Remember Progress, Then Hang Up When The Forward Completes — Never Forward A Number That Is Not Ours, Never Stamp A Lead Message, Never Ingest A Call Lead, Never Use The API Secret Or The Cron Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 18 of this service — `twilio-voice.routes.ts`
- Remaining in this service: `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/twilio-voice.routes.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (Twilio is the provider, not the authority; Voice forwarding (`twilioVoice.ts`) is a separate webhook helper, not a Lead Message). The knowledge HTTP table names leftover SMS status `applyTwilioStatusCallback` and leftover drain — **it does not name** `/api/webhooks/twilio/voice*`. Distinct from leftover skipped TwiML / destination: leftover skipped `twilioVoice.ts` (`buildTwilioVoiceForwardResponse` Dial `answerOnBridge` + leftover `statusCallbackEvent` initiated/ringing/answered/completed + leftover `buildTwilioVoiceCompletedResponse` Hangup + leftover `isExpectedTwilioVoiceDestination` digits vs leftover `TWILIO_FROM_NUMBER` — this file **asks** those three after leftover signature; that file does **not** compare `x-twilio-signature` and does **not** answer HTTP). Distinct from leftover voice config: leftover `getTwilioVoiceConfig()` (`TWILIO_VOICE_WEBHOOK_URL` or leftover `DEFAULT_TWILIO_VOICE_WEBHOOK_URL` live API host, leftover `status` / `completed` derived from that pathname, leftover `TWILIO_VOICE_FORWARD_TO` or leftover `DEFAULT_TWILIO_VOICE_FORWARD_TO` `+18884862499`, leftover E.164 + leftover from≠forward loop throw — **this file never defaults the URLs itself**). Distinct from already-recommended signature: [lead-messaging-twilio-adapter.md](lead-messaging-twilio-adapter.md) (`validateTwilioWebhook` — this file **asks** it with leftover **three** leftover `getTwilioVoiceConfig()[urlKey]` URLs; leftover SMS status **asks** it with **no** `requestUrl`). Distinct from already-recommended SMS status desk: [routes-twilio-message-status.md](routes-twilio-message-status.md) (`POST /api/webhooks/twilio/message-status` leftover **404** unknown SID / leftover **204** found SID — **does not import** this file; **that file never writes TwiML**). Distinct from already-recommended remember / send-or-wake / claim-and-send / drain / accept-callback persist / owner retry: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (**this file never asks** `applyTwilioStatusCallback` / `createTwilioSender` / `runLeadMessagingDrain`). Distinct from leftover Wave B drain trigger: next `lead-messaging-cron.routes.ts` (`CRON_SECRET` **asks** `runLeadMessagingDrain("cron")` — **this file does not use `CRON_SECRET`**). Distinct from leftover queue consumer: `api/queues/lead-messaging-consumer.ts` (**does not import** this file). Distinct from already-recommended public v1 / Owner retry desk: [routes-v1.md](routes-v1.md) (`GET/POST /api/v1/admin/lead-messages*` after leftover `requireApiSecret` — **does not import** this file). Distinct from already-recommended Form Lead remember-then-dispatch: [form-lead.md](form-lead.md) (**this file never persists intent and never talks REST create**). Distinct from already-recommended Granot six gates: [lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (**this file never texts**). Distinct from already-recommended RingCentral inbound / local file: [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md) / [routes-ringcentral-webhook-local.md](routes-ringcentral-webhook-local.md) (Validation-Token echo, always **200**, leftover candidate / session / ingest — **this file never asks** leftover Call Lead ingest; a later leftover RingCentral inbound may see the forwarded leg). Distinct from leftover Wave B Call Log cron: next `ringcentral-cron.routes.ts` (`CRON_SECRET` — **this file does not use it**). Distinct from already-recommended Wave A letters: [observability-record-operational-event.md](observability-record-operational-event.md) (this file **asks** leftover `recordOperationalEvent` `twilio.voice.inbound_received` / `twilio.voice.progress` / `twilio.voice.completed` with leftover `notificationCandidate: false`; leftover letters **never throw** and leftover connect Mongo themselves). Distinct from leftover SMS letters: leftover `applyTwilioStatusCallback` **asks** leftover `recordStatusCallbackEvent` (`lead_message.status_updated` / `status_ignored` / `delivery_failed` — **this file never asks** those). Distinct from leftover Analytics cohort: already-recommended `analytics-sms-conversion.md` (**this file never reads that set**). Distinct from leftover Wave B secret: leftover `requireApiSecret` / leftover HMAC / leftover Granot webhook secret / leftover `CRON_SECRET` / leftover live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(twilioVoiceRoutes)` on line 63 — **after** leftover already-recommended `twilioMessageStatusRoutes`, leftover RingCentral / Granot inbound, leftover crons including leftover lead-messaging drain, leftover notification cron, **before** leftover Best Relocation / reporting / Granot automation crons, leftover Granot automation, leftover public v1, leftover Best Relocation, leftover reporting). Already-recommended Wave A folder tests prove leftover Dial / Hangup / leftover destination / leftover loop through leftover skipped `twilioVoice.test.ts` and leftover default-URL signature through leftover `twilioAdapter.test.ts`, not this router. Operator `hit-vantage-api` lists Owner `GET/POST /api/v1/admin/lead-messages*`, **not** `/api/webhooks/twilio/voice*`. Host unguarded table also omits these paths (mounted before leftover `v1Routes`, so leftover `requireApiSecret` never runs). `app.ts` already mounts leftover `express.urlencoded({ extended: true })` — Twilio posts form fields, not JSON. Not this **interface**: leftover `buildTwilioVoiceForwardResponse` itself, leftover `buildTwilioVoiceCompletedResponse` itself, leftover `isExpectedTwilioVoiceDestination` itself, leftover `validateTwilioWebhook` itself, leftover `getTwilioVoiceConfig` itself, leftover `recordOperationalEvent` itself, leftover `applyTwilioStatusCallback`, leftover `runLeadMessagingDrain`.
- Seams callers need: `app.ts` **before** public v1 vs Owner desks **after** the secret; leftover Twilio signature (`x-twilio-signature` + leftover **three** leftover voice URLs) vs leftover SMS default `TWILIO_STATUS_CALLBACK_URL` vs leftover Granot webhook secret vs leftover RingCentral Validation-Token vs leftover `CRON_SECRET`; leftover inbound **200** `text/xml` Dial vs leftover progress **204** empty vs leftover completed **200** `text/xml` Hangup vs leftover SMS **404** unknown SID / leftover SMS **204** found SID vs leftover RingCentral / local-file always **200** vs leftover Granot **202** only after commit / **503** on capture throw; leftover inbound unexpected `To` **400** `"Unexpected called number"` vs leftover progress / completed which **do not** re-check destination; leftover missing `TWILIO_PRIMARY_AUTH_TOKEN` / leftover `TWILIO_FROM_NUMBER` / leftover invalid or loop leftover `TWILIO_VOICE_FORWARD_TO` **500** `"Webhook configuration error"` vs leftover bad signature **403**; leftover letters **never throw** (no route try/catch) vs leftover SMS apply throw **500**; leftover `stringParams` form fold vs leftover JSON Zod. There is no factory inject **seam**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no GET reachability **seam**. There is no `connectMongo` **seam** on this router.
- Split later (only if the file outgrows one sitting): this ~131-line file is one sitting if you read it as after Twilio's signature proves this voice post is theirs, Dial the RingCentral number we already chose, remember progress, then hang up when the forward completes — never forward a number that is not ours, never stamp a Lead Message, never ingest a Call Lead, never use the API secret or the cron secret. Do not split. Never `post.ts` / `webhook.ts` / `forward.ts` / `status.ts` / `completed.ts` / `create.ts` / `update.ts` / `delete.ts`. Signature stays already-recommended `twilioAdapter.ts`. Dial / Hangup / leftover destination stay leftover skipped `twilioVoice.ts`. Voice URLs / leftover loop stay leftover `getTwilioVoiceConfig`. SMS status stays already-recommended `twilio-message-status.routes.ts`. Drain trigger stays leftover next `lead-messaging-cron.routes.ts`. Call Log stays leftover next `ringcentral-cron.routes.ts`.

`router.post("/api/webhooks/twilio/voice")` is an HTTP verb. The owner question is: *Someone just called the Twilio number we send confirmation SMS from. Prove the signature against the exact voice URL we told Twilio, using the primary token. If the token, the from-number, or the forward config is missing or looping, say the webhook is misconfigured — do not pretend this is a forged post. If the signature is wrong, refuse it. If they called a number that is not ours, refuse the Dial. Then write down that we are forwarding, and answer Dial TwiML that bridges to the RingCentral number we already chose. When Twilio later posts progress against the status URL, write that down and answer 204. When the Dial finishes, write that down and answer Hangup so the parent call ends. Do not stamp a Lead Message. Do not create a Call Lead. Do not talk RingCentral REST. Do not compare `x-api-secret`. Do not teach this file `CRON_SECRET`.*

Who prove the signature already lives in already-recommended `twilioAdapter.ts`. Who write Dial / Hangup / leftover destination already lives in leftover skipped `twilioVoice.ts`. Who never walk an SMS status backward already lives in already-recommended `leadMessaging.service.ts`. Who drain due rows already lives in leftover next `lead-messaging-cron.routes.ts`. Who ingest a qualified RingCentral session already lives in leftover Wave A Call Lead ingest / leftover next Call Log cron. Do not pull those in.

## What this file actually does

Three operations of one “after Twilio's signature proves this voice post is theirs, Dial the RingCentral number we already chose, remember progress, then hang up when the forward completes” story, not “a webhook CRUD dump,” and not Remember The Outbound Confirmation SMS / Stamp This SMS Status / Drain Due Messages / Ingest This RingCentral Call themselves:

1. **Forward this inbound Twilio voice call** — `POST /api/webhooks/twilio/voice`. Fold leftover form body through leftover `stringParams`. **Ask** leftover `validateVoiceRequest` with leftover `webhookUrl` (leftover `getTwilioVoiceConfig().webhookUrl`). Validate throw logs `twilio.voice.webhook.config_invalid` and **500** `"Webhook configuration error"`. False logs `twilio.voice.signature_invalid` and **403** `"Forbidden"`. Then **ask** leftover `isExpectedTwilioVoiceDestination(params.To)` (digits vs leftover `TWILIO_FROM_NUMBER`). False logs `twilio.voice.unexpected_destination` with leftover `maskPhoneForLog` on `To` (logger only — **not** a leftover letter) and **400** `"Unexpected called number"`. Then leftover `getTwilioVoiceConfig()` again for leftover `forwardTo`. **Ask** leftover `recordOperationalEvent` `twilio.voice.inbound_received` (`category: "messaging"`, leftover `workflow: "twilio_voice_forwarding"`, leftover `notificationCandidate: false`, leftover entity `twilio_call` / leftover `CallSid`, leftover `leadIdentity.phone` = leftover `From`). Answer leftover **200** `text/xml` leftover `buildTwilioVoiceForwardResponse()` (Dial leftover `forwardTo`, leftover `action` leftover completed URL, leftover `statusCallback` leftover status URL). This beat does **not** **ask** `applyTwilioStatusCallback`. This beat does **not** **ask** `createTwilioSender`. This beat does **not** **ask** `runLeadMessagingDrain`. This beat does **not** **ask** leftover Call Lead ingest. This beat does **not** **ask** leftover `connectMongo` (leftover letters connect themselves). This beat does **not** compare leftover SMS `TWILIO_STATUS_CALLBACK_URL`.

2. **Remember this Twilio voice progress callback** — `POST /api/webhooks/twilio/voice/status`. Same leftover `stringParams` + leftover `validateVoiceRequest` with leftover `statusCallbackUrl`. Then leftover `recordVoiceCallback(..., "progress")` → leftover letter `twilio.voice.progress` (leftover `DialCallSid` / leftover `ParentCallSid`, leftover `CallStatus` / leftover `DialCallStatus`, leftover `DialCallDuration`). Answer leftover **204** empty. This beat does **not** re-check leftover destination. This beat does **not** write TwiML. This beat does **not** stamp a Lead Message.

3. **Hang up after the forwarded call completes** — `POST /api/webhooks/twilio/voice/completed`. Same leftover fold + leftover `validateVoiceRequest` with leftover `completedCallbackUrl`. Then leftover `recordVoiceCallback(..., "completed")` → leftover letter `twilio.voice.completed`. Answer leftover **200** `text/xml` leftover `buildTwilioVoiceCompletedResponse()` (Hangup). This beat does **not** re-check leftover destination. This beat does **not** Dial again. This beat does **not** ingest a Call Lead.

`validateVoiceRequest` / `recordVoiceCallback` / leftover `stringParams` / leftover `validateTwilioWebhook` / leftover TwiML builders are beats inside these operations, not extra owner stories. The default export is the `Router()` instance — there is **no** factory inject.

There is no fourth GET reachability operation. Leftover RingCentral inbound has a GET ready; this desk does not. There is no fifth SMS-status operation. Stamp-the-Lead-Message lives on already-recommended `twilio-message-status.routes.ts`.

## Organization

Keep one file. This is the screenplay for “after Twilio's signature proves this voice post is theirs, Dial the RingCentral number we already chose, remember progress, then hang up when the forward completes — never forward a number that is not ours, never stamp a Lead Message, never ingest a Call Lead, never use the API secret or the cron secret.” Already-recommended signature / leftover TwiML / leftover destination / leftover voice URLs / leftover letters / leftover SMS status already live in deeper **modules**. Do not pull those in. Do not invent a `TwilioVoiceRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches leftover Granot webhook tests” without adding a paired HTTP proof. Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover Zod **adapter** so “Twilio form fields 400 on unknown keys.” Do not invent a CRUD folder so `forward.ts` / `status.ts` / `completed.ts` each get a file.

Do not move leftover `validateTwilioWebhook` into this file so “the route owns validateRequest.” Do not move leftover Dial / Hangup into this file so “the route owns TwiML.” Do not move leftover `isExpectedTwilioVoiceDestination` into this file so “the route owns digits.” Do not mount this router inside leftover `v1.routes.ts` so “one file owns every webhook.” Do not merge this router into already-recommended `twilio-message-status.routes.ts` so “one file owns every Twilio POST.” Do not merge this router into leftover next `lead-messaging-cron.routes.ts` so “one file owns hybrid Lead Messaging.” Do not merge this router into leftover next `ringcentral-cron.routes.ts` so “one file owns every RingCentral hop.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `twilioVoiceDesk` | `app.ts` mounts the instance **after** leftover SMS status, **before** leftover public v1 |
| `POST /api/webhooks/twilio/voice` (today unexported handler) | `forwardThisInboundTwilioVoiceCallOverHttp` | leftover voice `webhookUrl` signature **then** leftover destination **then** leftover Dial TwiML |
| `POST /api/webhooks/twilio/voice/status` (today unexported handler) | `rememberThisTwilioVoiceProgressOverHttp` | leftover voice `statusCallbackUrl` signature **then** leftover letter **then** leftover **204** |
| `POST /api/webhooks/twilio/voice/completed` (today unexported handler) | `hangUpAfterTheForwardedCallCompletesOverHttp` | leftover voice `completedCallbackUrl` signature **then** leftover letter **then** leftover Hangup TwiML |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `urlKey` / `phase` / `answerOnBridge` as the domain language. Do **not** export `stringParams` / `validateVoiceRequest` / `recordVoiceCallback` so “the test can unit the helper.” Do **not** add `createTwilioVoiceRouter({ validate, forward, hangup })` in this rename so “this desk matches leftover Granot” without a paired HTTP proof that live default still **asks** leftover Wave A signature + leftover skipped TwiML.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after we answer Dial:

```ts
type ForwardedTwilioVoiceCallOverHttp = void
```

That is the **200** `text/xml` handoff from “Twilio may Dial the RingCentral number we already chose” to “progress and completed will post to the two leftover URLs that leftover TwiML already named.” Do **not** add `forward_to` onto that HTTP body (Twilio must not learn a JSON bag). Do **not** collapse leftover inbound **200** Dial into leftover **204** so “one empty owns every Twilio POST.” Do **not** collapse leftover progress **204** into leftover **200** `{ ok: true }` so “Twilio JSON matches leftover RingCentral.” Do **not** collapse leftover unexpected `To` **400** into leftover **403** so “one refuse owns every miss.”

Leave `validateTwilioWebhook` on already-recommended `twilioAdapter.ts`. Leave Dial / Hangup / leftover destination on leftover skipped `twilioVoice.ts`. Leave leftover URLs / leftover loop on leftover `getTwilioVoiceConfig`. Leave SMS status on already-recommended `twilio-message-status.routes.ts`. Leave drain on leftover next `lead-messaging-cron.routes.ts`. Leave Call Log on leftover next `ringcentral-cron.routes.ts`. Leave Owner retry on already-recommended `v1.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// twilio-voice.routes.ts
// Someone just called the Twilio number we send confirmation SMS from.
// Prove the signature against the exact voice URL we told Twilio.
// If the token, the from-number, or the forward config is missing
// or looping, say the webhook is misconfigured.
// If the signature is wrong, refuse it.
// If they called a number that is not ours, refuse the Dial.
// Write down that we are forwarding.
// Answer Dial TwiML that bridges to the RingCentral number
// we already chose.
// When Twilio later posts progress, write that down and answer 204.
// When the Dial finishes, write that down and answer Hangup.
// Do not stamp a Lead Message.
// Do not create a Call Lead.
// Do not talk RingCentral REST.
// Do not compare x-api-secret.
// Do not teach this file CRON_SECRET.

export function acceptThisTwilioVoiceDesk() {
  const desk = Router()
  desk.post("/api/webhooks/twilio/voice", forwardThisInboundTwilioVoiceCallOverHttp)
  desk.post("/api/webhooks/twilio/voice/status", rememberThisTwilioVoiceProgressOverHttp)
  desk.post(
    "/api/webhooks/twilio/voice/completed",
    hangUpAfterTheForwardedCallCompletesOverHttp,
  )
  return desk
}

export default acceptThisTwilioVoiceDesk()

// ── 1. Forward this inbound Twilio voice call ─────────────

async function forwardThisInboundTwilioVoiceCallOverHttp(req, res) {
  const params = stringFieldsFromTheFormBody(req.body)
  if (!proveThisVoicePostIsReallyFromTwilio(req, params, "webhookUrl", res)) return

  if (!thisCallLandedOnTheTwilioNumberWeOwn(params.To)) {
    rememberTheyCalledANumberThatIsNotOurs(params)
    return refuseADialForANumberThatIsNotOurs(res)
  }

  const voice = readTheVoiceForwardWeAlreadyChose()
  await writeDownThatWeAreForwardingThisCall(req, params, voice.forwardTo)
  return answerDialTwiMLThatBridgesToRingCentral(res)
}

// ── 2. Remember this Twilio voice progress ────────────────

async function rememberThisTwilioVoiceProgressOverHttp(req, res) {
  const params = stringFieldsFromTheFormBody(req.body)
  if (!proveThisVoicePostIsReallyFromTwilio(req, params, "statusCallbackUrl", res)) {
    return
  }
  await writeDownThisVoiceForwardingPhase(req, params, "progress")
  return acceptedProgressBecauseTheSignatureHeld(res)
}

// ── 3. Hang up after the forwarded call completes ─────────

async function hangUpAfterTheForwardedCallCompletesOverHttp(req, res) {
  const params = stringFieldsFromTheFormBody(req.body)
  if (!proveThisVoicePostIsReallyFromTwilio(req, params, "completedCallbackUrl", res)) {
    return
  }
  await writeDownThisVoiceForwardingPhase(req, params, "completed")
  return answerHangupTwiMLSoTheParentCallEnds(res)
}

function proveThisVoicePostIsReallyFromTwilio(req, params, urlKey, res) {
  try {
    const proven = proveThisCallbackIsReallyFromTwilio(
      readTheTwilioSignature(req),
      params,
      readTheVoiceForwardWeAlreadyChose()[urlKey],
    )
    if (!proven) {
      rememberTheVoiceSignatureWasWrong(urlKey, params)
      refuseAForgedVoicePost(res)
    }
    return proven
  } catch (error) {
    rememberTheVoiceUrlTokenOrForwardIsMissing(error)
    webhookIsMisconfigured(res)
    return false
  }
}
```

Read the desk path out loud: *Someone called the Twilio from-number. Prove `x-twilio-signature` against that leftover voice URL and the primary token. Missing token, from-number, or a looping leftover forward is 500, not 403. A bad signature is 403. If `To` is not leftover `TWILIO_FROM_NUMBER`, refuse the Dial. Write down `twilio.voice.inbound_received`. Answer Dial TwiML that bridges to leftover `forwardTo` and names leftover `/status` and leftover `/completed`. Later progress against leftover `statusCallbackUrl` writes `twilio.voice.progress` and answers 204 — no TwiML, no destination re-check. Later completed against leftover `completedCallbackUrl` writes `twilio.voice.completed` and answers Hangup. Do not stamp a Lead Message. Do not ingest a Call Lead. Do not compare `x-api-secret`.*

That is the operation. `router.post("/api/webhooks/twilio/voice")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Three leftover voice URLs, never leftover SMS `TWILIO_STATUS_CALLBACK_URL`.** Leftover `validateVoiceRequest` **asks** leftover `validateTwilioWebhook(signature, params, getTwilioVoiceConfig()[urlKey])`. Already-recommended SMS status omits the third argument on purpose. Do not silently drop `requestUrl` so “one default URL owns every Twilio POST.” Do not silently pass leftover `TWILIO_STATUS_CALLBACK_URL` so “one bag owns both reads.” Already-recommended adapter CONTRADICTIONS says those reads stay apart.

2. **Destination is an inbound Dial fence, not a progress / completed fence.** Leftover `isExpectedTwilioVoiceDestination` runs only on leftover `/voice`. Leftover `/status` and leftover `/completed` already signed against leftover derived URLs. Do not silently add leftover destination onto progress so “one fence owns every POST” — Twilio’s Number status callback `To` is leftover `forwardTo` (RingCentral), not leftover `fromNumber`. Do not silently **400** leftover completed because leftover `To` is leftover RingCentral.

3. **200 Dial / 204 progress / 200 Hangup are not leftover SMS 404 / 204.** Leftover SMS **404**s an unknown SID so Twilio retries the persist race, then **204**s a found row even when leftover apply ignored rank. This desk has no Lead Message row. Do not silently **404** inbound so “every Twilio POST matches leftover SMS.” Do not silently **204** inbound Dial so “one empty owns every Twilio POST” — Twilio needs leftover TwiML to Dial. Do not silently **200** `{ ok: true }` so “Twilio JSON matches leftover RingCentral.”

4. **`stringParams` is a copy of already-recommended leftover SMS status.** Same object / array / string-value fold. CONTRADICTIONS already names this. Do not silently extract a shared helper in this rename so “one helper owns every Twilio POST” without a paired HTTP proof on **both** desks. Park the copy.

5. **Letters live on this router; leftover SMS letters live on leftover apply.** This file **asks** leftover `recordOperationalEvent` `twilio.voice.*` and leftover `notificationCandidate: false`. Already-recommended SMS status does **not** **ask** leftover `recordOperationalEvent` (leftover apply **asks** leftover `recordStatusCallbackEvent`). Leftover unexpected destination is leftover `logger.warn` only. Do not silently emit leftover `lead_message.*` from this file so “one route owns every Twilio letter.” Do not silently open an Incident on leftover inbound so “every call pages the owner” — leftover `notificationCandidate` is already false.

6. **Inbound letter details keep raw `from` / `to` / `forward_to`; leftover unexpected-destination warn masks `To`.** Leftover `leadIdentity.phone` is leftover `From`. Do not log leftover `req.body` whole so “the test can see the form.” Do not silently mask leftover letter `details` in this rename so “one mask owns every phone” without a paired letter proof — leftover Wave A letters already persist leftover identity.

7. **Leftover `recordOperationalEvent` never throws.** Already-recommended leftover write-this-happening-down catches and returns `null`. This router has no try/catch around leftover letters. Leftover SMS apply throw **500**s `"Callback processing failed"`. Do not silently wrap leftover letters so “this desk matches leftover SMS 500” — that would invent a fail closed leftover Dial does not have. Leftover letters leftover connect Mongo themselves. Do not add leftover `connectMongo` to this router so “this desk matches leftover SMS.”

8. **Leftover loop / leftover E.164 live on leftover `getTwilioVoiceConfig`, not this file.** Leftover `validateVoiceRequest` already **asks** leftover config before leftover signature (third-arg evaluate). A leftover from=forward throw is leftover **500** config, not leftover **400** destination. Do not silently **400** a loop so “one refuse owns every bad number.” Do not move leftover loop into this file so “the route owns E.164.”

9. **This desk never creates a Call Lead and never talks RingCentral REST.** Leftover Dial leftover `forwardTo` is leftover RingCentral’s number. A later leftover RingCentral inbound / leftover Call Log may see that leg. Do not silently **ask** leftover `ingestRingCentralCallLead` from this file so “one hop owns the Call Lead.” Do not merge this router into leftover next `ringcentral-cron.routes.ts` so “one file owns every RingCentral hop.”

10. **There is no factory inject and no route test.** Leftover Granot webhook tests inject `capture` / `publish`. Leftover SMS status, leftover RingCentral inbound, and leftover local-file also export only the live `Router()`. Do not add `createTwilioVoiceRouter` in this rename without a paired HTTP proof. Today there is **no** `twilio-voice.routes.test.ts`. Leftover `twilioVoice.test.ts` names leftover Dial / Hangup / leftover destination / leftover loop through leftover skipped TwiML, not this HTTP desk.

11. **This desk never uses the API secret, HMAC, Granot webhook secret, the cron secret, or the live-host debug token.** `app.ts` mounts it after leftover SMS status, before leftover public v1. Signature is handshake, not leftover `x-api-secret`. Do not remount `requireApiSecret` so “it matches leftover reporting.” Do not teach this file `CRON_SECRET` so “one file owns hybrid Lead Messaging.” Do not hide these POSTs behind leftover Owner HMAC so “voice matches leftover admin retry.”

12. **Host unguarded table and operator skill omit `/api/webhooks/twilio/voice*`.** Same leftover omit as leftover SMS status. Do not remount leftover `requireApiSecret` so “the host table wins.” Do not add these POSTs to leftover `hit-vantage-api` in this rename (that skill is leftover `x-api-secret` desks).

13. **Leave sibling modules alone.** `validateTwilioWebhook` / leftover skipped TwiML / leftover `getTwilioVoiceConfig` / leftover `recordOperationalEvent` / leftover SMS status are already the right **depth**. This file orchestrates the HTTP **adapter**.

14. **Do not treat leftover remember / leftover REST create / leftover Granot create-if-missing / leftover Owner retry / leftover drain / leftover SMS status / leftover Granot inbound / leftover RingCentral inbound / leftover Call Lead ingest / leftover Call Log cron / leftover CRM Posting / leftover public v1 / leftover reporting / leftover Best Relocation / leftover Granot automation as this story.** Next `ringcentral-cron.routes.ts` is leftover Call Log / leftover analytics reconcile. Later `lead-messaging-cron.routes.ts` is the drain trigger. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisTwilioVoiceDesk` (mounted on `app.ts` **after** leftover SMS status, **before** leftover public v1 as the default export) and the three HTTP operations above.

Today there is **no** `twilio-voice.routes.test.ts`. Wave A file tests prove leftover Dial / Hangup / leftover destination / leftover loop / leftover default-URL signature through those **interfaces**. Add an HTTP proof that names the operation (do not boot live Twilio, do not place a phone call, do not walk leftover RingCentral REST in the route file):

**Handshake / who may speak**
- This desk is mounted from `app.ts` **after** leftover `twilioMessageStatusRoutes`, **before** leftover `v1Routes`.
- POST with a missing leftover token / leftover `TWILIO_FROM_NUMBER` / leftover invalid or looping leftover `TWILIO_VOICE_FORWARD_TO` **500** `"Webhook configuration error"` and does **not** answer leftover TwiML.
- POST with a bad `x-twilio-signature` **403** `"Forbidden"` and does **not** answer leftover TwiML.
- Inbound **asks** leftover `validateTwilioWebhook(signature, params, leftover webhookUrl)`. Progress **asks** leftover `statusCallbackUrl`. Completed **asks** leftover `completedCallbackUrl`. None omit the third argument (leftover SMS default URL).
- `requireApiSecret` / Owner HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` are **not** accepted here.

**Dial, then hang up — never stamp, never ingest**
- Inbound leftover `To` that is not leftover `TWILIO_FROM_NUMBER` **400** `"Unexpected called number"` and does **not** **ask** leftover `buildTwilioVoiceForwardResponse`.
- Inbound leftover proven + leftover expected `To` **asks** leftover `recordOperationalEvent` `twilio.voice.inbound_received` then leftover **200** `text/xml` leftover Dial (leftover `forwardTo`, leftover completed `action`, leftover status `statusCallback`).
- Progress leftover proven **asks** leftover letter `twilio.voice.progress` then leftover **204** empty and does **not** re-check leftover destination and does **not** write TwiML.
- Completed leftover proven **asks** leftover letter `twilio.voice.completed` then leftover **200** `text/xml` leftover Hangup and does **not** Dial again.
- This beat does **not** ask `applyTwilioStatusCallback` / `shouldApplyTwilioStatus` / `runLeadMessagingDrain` / `requestLeadMessageRetry` / `createTwilioSender` / leftover Call Lead ingest / leftover `connectMongo`.

**Logs / letters**
- Leftover unexpected-destination warn masks `To`.
- Leftover letters use leftover `notificationCandidate: false` and leftover `workflow: "twilio_voice_forwarding"`.
- Leftover letters never throw; a leftover letter miss must not 500 leftover Dial.

**Mount**
- `app.ts` should keep `app.use(twilioVoiceRoutes)` after leftover SMS status, before leftover `v1Routes`.
- Leftover already-recommended SMS status and leftover next drain / leftover next Call Log stay mounted apart and are not this desk.

**Not this file**
- Signature stays on already-recommended [lead-messaging-twilio-adapter.md](lead-messaging-twilio-adapter.md).
- Dial / Hangup / leftover destination stay on leftover skipped `twilioVoice.ts`.
- Voice URLs / leftover loop stay on leftover `getTwilioVoiceConfig`.
- SMS status stays on already-recommended [routes-twilio-message-status.md](routes-twilio-message-status.md).
- Drain trigger stays on next `lead-messaging-cron.routes.ts`.
- Call Log stays on next `ringcentral-cron.routes.ts`.
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`stringFieldsFromTheFormBody`, `proveThisVoicePostIsReallyFromTwilio`, `writeDownThisVoiceForwardingPhase`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory inject in this rename so “the test can no longer see the live leftover TwiML default.” If a later implementer adds inject, the HTTP proof must still name the live default.

## What I would not do

- A `TwilioVoiceRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.type("text/xml").status(200).send()`.
- Moving this into a CRUD folder (`post.ts` / `webhook.ts` / `forward.ts` / `status.ts` / `completed.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the inbound-destination **seam**: do not Dial a `To` that is not leftover `TWILIO_FROM_NUMBER`.
- Breaking the progress/completed **seam**: do not re-check leftover `fromNumber` on leftover `/status` (leftover `To` there is leftover RingCentral).
- Breaking the Dial-TwiML **seam**: do not 204 inbound so “this desk matches leftover SMS found-SID.”
- Breaking the unguarded-inbound **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` here.
- Treating leftover `validateTwilioWebhook`, leftover skipped TwiML, leftover `getTwilioVoiceConfig`, leftover `recordOperationalEvent`, leftover SMS status, leftover remember / leftover REST create / leftover Granot create-if-missing / leftover Owner retry / leftover drain / leftover Granot inbound / leftover RingCentral inbound / leftover Call Lead ingest / leftover Call Log cron / leftover CRM Posting / leftover public v1 / leftover reporting / leftover Best Relocation / leftover Granot automation / leftover webhook / cron routers as this story.
- Inventing a leftover factory-inject / leftover cron-secret / leftover Zod / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently 204 inbound Dial, 404 a voice post, asking leftover SMS apply, remounting `requireApiSecret`, teaching this file `CRON_SECRET`, merging this router into leftover SMS status, or ingesting a Call Lead while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
