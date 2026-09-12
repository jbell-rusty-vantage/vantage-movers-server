# After Twilio's Signature Proves This Status Is Theirs, Stamp It On The Lead Message We Already Remember — Never Walk A Status Backward, Never 204 A Sid We Have Not Recorded Yet, Never Write Voice TwiML, Never Use The API Secret Or The Cron Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 17 of this service — `twilio-message-status.routes.ts`
- Remaining in this service: `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/twilio-message-status.routes.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (Twilio is the provider, not the authority; Mongo `lead_messages` is the book; Provider callback row names `applyTwilioStatusCallback`; status callbacks apply only to the current `twilio_message_sid` and never move backward; terminal `delivered` / `read` / `failed` / `undelivered` / `canceled` ignore later callbacks; `scheduled` may advance to queued, sent, or failed; SID-mismatch history is recorded but does not change `status`; voice forwarding is a separate webhook helper, not a Lead Message). Distinct from already-recommended remember / send-or-wake / claim-and-send / drain / accept-callback persist / owner retry: [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) (`applyTwilioStatusCallback` — this file **asks** it after leftover signature; that file does **not** compare `x-twilio-signature` and does **not** answer HTTP). Distinct from already-recommended signature: [lead-messaging-twilio-adapter.md](lead-messaging-twilio-adapter.md) (`validateTwilioWebhook` — this file **asks** it with **no** `requestUrl`, so leftover default is `TWILIO_STATUS_CALLBACK_URL`; that file never writes a Lead Message). Distinct from leftover Wave B voice desk: next `twilio-voice.routes.ts` (same leftover `validateTwilioWebhook` with **three** leftover `getTwilioVoiceConfig()` URLs, then leftover skipped `twilioVoice.ts` Dial / hangup + leftover `recordOperationalEvent` `twilio.voice.*` — **does not import** this file; **this file never writes TwiML**). Distinct from leftover Wave B drain trigger: next `lead-messaging-cron.routes.ts` (`CRON_SECRET` **asks** `runLeadMessagingDrain("cron")` — **this file does not use `CRON_SECRET`**). Distinct from leftover queue consumer: `api/queues/lead-messaging-consumer.ts` (`runLeadMessagingDrain("queue")` — **does not import** this file). Distinct from already-recommended public v1 / Owner retry desk: [routes-v1.md](routes-v1.md) (`GET/POST /api/v1/admin/lead-messages*` after leftover `requireApiSecret` — **does not import** this file). Distinct from already-recommended Form Lead remember-then-dispatch: [form-lead.md](form-lead.md) (`persistLeadMessageIntent` in the write, `dispatchOrQueuePersistedLeadMessage` after commit — **this file never persists intent and never talks REST create**). Distinct from already-recommended Granot six gates: [lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (**this file never texts**). Distinct from already-recommended Granot inbound: [routes-granot-webhook.md](routes-granot-webhook.md) (webhook secret, `202` only after commit, `503` on capture throw — **does not import** this file). Distinct from already-recommended RingCentral inbound / local file: [routes-ringcentral-webhook.md](routes-ringcentral-webhook.md) / [routes-ringcentral-webhook-local.md](routes-ringcentral-webhook-local.md) (Validation-Token echo, always **200** — **this file 403s a bad signature, 404s an unknown SID, 204s a found row**). Distinct from leftover Wave A letters: [observability-record-operational-event.md](observability-record-operational-event.md) (**this file never asks** `recordOperationalEvent`; leftover `applyTwilioStatusCallback` **asks** leftover `recordStatusCallbackEvent` `lead_message.status_updated` / `status_ignored` / `delivery_failed`). Distinct from leftover Analytics cohort: already-recommended `analytics-sms-conversion.md` (`SUCCESSFUL_LEAD_MESSAGE_STATUSES` — **this file never reads that set**). Distinct from leftover Wave B secret: leftover `requireApiSecret` / leftover HMAC / leftover Granot webhook secret / leftover `CRON_SECRET` / leftover live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md) / [Call Lead](../../../../CONTEXT.md) / [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount. No dedicated route test.** `src/app.ts` **asks** the default export (`app.use(twilioMessageStatusRoutes)` on line 62 — **after** leftover RingCentral / Granot inbound, leftover RingCentral local, leftover crons including leftover lead-messaging drain, leftover notification cron, **before** leftover next `twilioVoiceRoutes`, leftover Best Relocation / reporting / Granot automation crons, leftover Granot automation, leftover public v1, leftover Best Relocation, leftover reporting). Already-recommended Wave A folder tests prove leftover accept-callback rank / leftover signature through those **interfaces**, not this router. `leadMessaging.service.test.ts` names leftover `shouldApplyTwilioStatus` only — it does **not** HTTP-post this path and leftover `applyTwilioStatusCallback` never calls that helper. `twilioAdapter.test.ts` names leftover default-URL signature only. Operator `hit-vantage-api` lists Owner `GET/POST /api/v1/admin/lead-messages*`, **not** `/api/webhooks/twilio/message-status`. Host unguarded table also omits this path (mounted before leftover `v1Routes`, so leftover `requireApiSecret` never runs). `app.ts` already mounts leftover `express.urlencoded({ extended: true })` — Twilio posts form fields, not JSON. Not this **interface**: leftover `applyTwilioStatusCallback` itself, leftover `validateTwilioWebhook` itself, leftover `shouldApplyTwilioStatus`, leftover `runLeadMessagingDrain`, leftover `requestLeadMessageRetry`, leftover `persistLeadMessageIntent`, leftover `createTwilioSender`.
- Seams callers need: `app.ts` **before** public v1 vs Owner desks **after** the secret; leftover Twilio signature (`x-twilio-signature` + leftover default `TWILIO_STATUS_CALLBACK_URL`) vs leftover Granot webhook secret vs leftover RingCentral Validation-Token vs leftover `CRON_SECRET`; leftover 404 `"Message not recorded yet"` vs leftover RingCentral / local-file always **200** vs leftover Granot **202** only after commit / **503** on capture throw; leftover **204** empty after a found SID (even when leftover apply ignored the status) vs leftover **204** meaning “status advanced”; leftover missing `TWILIO_PRIMARY_AUTH_TOKEN` / `TWILIO_STATUS_CALLBACK_URL` **500** `"Webhook configuration error"` vs leftover bad signature **403**; leftover `connectMongo` **before** leftover apply vs leftover apply assuming a live connection; leftover form `stringParams` vs leftover JSON Zod. There is no factory inject **seam**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no GET reachability **seam**.
- Split later (only if the file outgrows one sitting): this ~96-line file is one sitting if you read it as after Twilio's signature proves this status is theirs, stamp it on the Lead Message we already remember — never walk a status backward, never 204 a SID we have not recorded yet, never write voice TwiML, never use the API secret or the cron secret. Do not split. Never `post.ts` / `webhook.ts` / `callback.ts` / `create.ts` / `update.ts` / `delete.ts`. Signature stays already-recommended `twilioAdapter.ts`. Never-backward persist stays already-recommended `leadMessaging.service.ts`. Voice stays leftover next `twilio-voice.routes.ts`. Drain trigger stays leftover next `lead-messaging-cron.routes.ts`.

`router.post("/api/webhooks/twilio/message-status")` is an HTTP verb. The owner question is: *Twilio just POSTed what happened to a confirmation SMS we already remembered. Prove the signature against the status-callback URL we told them, using the primary token. If the token or URL is missing, say the webhook is misconfigured — do not pretend this is a forged post. If the signature is wrong, refuse it. If MessageSid or MessageStatus is missing, refuse the body. Then find the Lead Message by that SID. If we have not recorded the SID yet, answer 404 so Twilio retries — a callback can beat claim-and-send. If we have the row, answer 204 even when this status must not move the row backward. Do not write TwiML. Do not drain due texts. Do not retry a failed text. Do not compare `x-api-secret`. Do not teach this file `CRON_SECRET`.*

Who prove the signature already lives in already-recommended `twilioAdapter.ts`. Who never walk a status backward already lives in already-recommended `leadMessaging.service.ts`. Who write Dial / hangup already lives in leftover skipped `twilioVoice.ts`. Who drain due rows already lives in leftover next `lead-messaging-cron.routes.ts`. Do not pull those in.

## What this file actually does

One operation of one “after Twilio's signature proves this status is theirs, stamp it on the Lead Message we already remember” story, not “a webhook CRUD dump,” and not Remember The Outbound Confirmation SMS / Hand Twilio The SMS / Drain Due Messages / Forward This Inbound Call themselves:

1. **Accept this Twilio message-status after proving the signature** — `POST /api/webhooks/twilio/message-status`. Read `x-twilio-signature`. Fold leftover form body through leftover `stringParams` (string values only). **Ask** leftover `validateTwilioWebhook(signature, params)` with **no** third argument — leftover default is `TWILIO_STATUS_CALLBACK_URL`. Validate throw logs `lead_messaging.callback.config_invalid` and **500** `"Webhook configuration error"`. False logs `twilio.message_status.signature_invalid` and **403** `"Forbidden"`. Missing `MessageSid` or `MessageStatus` logs `twilio.message_status.missing_params` and **400** `"Missing MessageSid or MessageStatus"`. Then log `twilio.message_status.received` with leftover `maskPhoneForLog` on `To` / `From` (never the SMS body). **Ask** leftover `connectMongo()`, then leftover `applyTwilioStatusCallback({ messageSid, messageStatus, errorCode: parseOptionalNumber(ErrorCode), errorMessage: ErrorMessage || null })`. False logs `twilio.message_status.not_found` and **404** `"Message not recorded yet"`. True logs `twilio.message_status.processed` and **204** empty. Apply throw logs `lead_messaging.callback.failed` and **500** `"Callback processing failed"`. This beat does **not** pass a voice `requestUrl`. This beat does **not** **ask** `shouldApplyTwilioStatus`. This beat does **not** **ask** `runLeadMessagingDrain`. This beat does **not** **ask** `requestLeadMessageRetry`. This beat does **not** **ask** `createTwilioSender`. This beat does **not** **ask** `recordOperationalEvent` (leftover apply **asks** leftover `recordStatusCallbackEvent`). This beat does **not** write TwiML.

`stringParams` / `parseOptionalNumber` / leftover `validateTwilioWebhook` / leftover `applyTwilioStatusCallback` are beats inside this operation, not extra owner stories. The default export is the `Router()` instance — there is **no** factory inject.

There is no second GET reachability operation. Leftover RingCentral inbound has a GET ready; this desk does not. There is no third voice operation. Dial / hangup live on leftover next `twilio-voice.routes.ts`.

## Organization

Keep one file. This is the screenplay for “after Twilio's signature proves this status is theirs, stamp it on the Lead Message we already remember — never walk a status backward, never 204 a SID we have not recorded yet, never write voice TwiML, never use the API secret or the cron secret.” Already-recommended signature / never-backward persist / leftover voice TwiML / leftover drain already live in deeper **modules**. Do not pull those in. Do not invent a `TwilioMessageStatusRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches leftover Granot webhook tests” without adding a paired HTTP proof. Do not invent a leftover cron **adapter** so “this desk owns `CRON_SECRET`.” Do not invent a leftover Zod **adapter** so “Twilio form fields 400 on unknown keys.” Do not invent a CRUD folder so `post.ts` / `webhook.ts` each get a file.

Do not move leftover `validateTwilioWebhook` into this file so “the route owns validateRequest.” Do not move leftover `applyTwilioStatusCallback` into this file so “the route owns never-backward.” Do not mount this router inside leftover `v1.routes.ts` so “one file owns every webhook.” Do not merge this router into leftover next `twilio-voice.routes.ts` so “one file owns every Twilio POST.” Do not merge this router into leftover next `lead-messaging-cron.routes.ts` so “one file owns hybrid Lead Messaging.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `twilioMessageStatusDesk` | `app.ts` mounts the instance **after** leftover crons, **before** leftover voice and leftover public v1 |
| `POST /api/webhooks/twilio/message-status` (today unexported handler) | `acceptThisTwilioMessageStatusOverHttp` | leftover signature **then** leftover apply; **404** unknown SID; **204** found SID |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `storedRawEvent` / `matched` / `provider_status` as the domain language. Do **not** export `stringParams` / `parseOptionalNumber` so “the test can unit the helper.” Do **not** add `createTwilioMessageStatusRouter({ validate, apply })` in this rename so “this desk matches leftover Granot” without a paired HTTP proof that live default still **asks** leftover Wave A signature + apply.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after a found SID:

```ts
type AcceptedTwilioMessageStatusOverHttp = void
```

That is the **204** empty handoff from “Twilio may stop retrying this SID” to “we already remembered a Lead Message for this SID (leftover apply may have advanced `status`, or only appended history).” Do **not** add `applied: boolean` onto that bag (Twilio must not learn whether the rank moved). Do **not** collapse leftover **404** `"Message not recorded yet"` into **204** so “this desk matches leftover RingCentral always-200.” Do **not** collapse leftover **403** into leftover **500** so “one status owns every refuse.”

Leave `validateTwilioWebhook` on already-recommended `twilioAdapter.ts`. Leave `applyTwilioStatusCallback` on already-recommended `leadMessaging.service.ts`. Leave voice on leftover next `twilio-voice.routes.ts`. Leave drain on leftover next `lead-messaging-cron.routes.ts`. Leave Owner retry on already-recommended `v1.routes.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// twilio-message-status.routes.ts
// Twilio just POSTed what happened to a confirmation SMS
// we already remembered.
// Prove the signature against the status-callback URL we told them.
// If the token or URL is missing, say the webhook is misconfigured.
// If the signature is wrong, refuse it.
// If MessageSid or MessageStatus is missing, refuse the body.
// Find the Lead Message by that SID.
// If we have not recorded the SID yet, answer 404 so Twilio retries.
// If we have the row, answer 204 even when this status
// must not move the row backward.
// Do not write TwiML.
// Do not drain due texts.
// Do not retry a failed text.
// Do not compare x-api-secret.
// Do not teach this file CRON_SECRET.

export function acceptThisTwilioMessageStatusDesk() {
  const desk = Router()
  desk.post(
    "/api/webhooks/twilio/message-status",
    acceptThisTwilioMessageStatusOverHttp,
  )
  return desk
}

export default acceptThisTwilioMessageStatusDesk()

// ── 1. Accept this Twilio message-status ──────────────────

async function acceptThisTwilioMessageStatusOverHttp(req, res) {
  const params = stringFieldsFromTheFormBody(req.body)
  const signature = readTheTwilioSignature(req)

  let proven = false
  try {
    proven = proveThisStatusCallbackIsReallyFromTwilio(signature, params)
  } catch (error) {
    rememberTheStatusCallbackUrlOrTokenIsMissing(error)
    return webhookIsMisconfigured(res)
  }
  if (!proven) {
    rememberTheSignatureWasWrong()
    return refuseAForgedStatusCallback(res)
  }

  const messageSid = params.MessageSid
  const messageStatus = params.MessageStatus
  if (!messageSid || !messageStatus) {
    rememberTheBodyWasMissingSidOrStatus(messageSid, messageStatus)
    return refuseAStatusCallbackWithoutSidOrStatus(res)
  }

  rememberWeReceivedThisStatusWithPhonesMasked(params, messageSid, messageStatus)

  try {
    await connectMongo()
    const weAlreadyRememberThisSid = await stampTwilioWordOnTheLeadMessageWeRemember({
      messageSid,
      messageStatus,
      errorCode: optionalNumber(params.ErrorCode),
      errorMessage: params.ErrorMessage || null,
    })
    if (!weAlreadyRememberThisSid) {
      rememberThisSidIsNotOnALeadMessageYet(messageSid, messageStatus)
      return askTwilioToRetryBecauseTheSidIsNotRecordedYet(res)
    }
    rememberWeProcessedThisStatus(messageSid, messageStatus)
    return acceptedBecauseWeAlreadyRememberThisSid(res)
  } catch (error) {
    rememberTheCallbackCouldNotBeApplied(error)
    return callbackProcessingFailed(res)
  }
}
```

Read the desk path out loud: *Twilio POSTed `/api/webhooks/twilio/message-status`. Prove `x-twilio-signature` against `TWILIO_STATUS_CALLBACK_URL` and the primary token. Missing token or URL is 500, not 403. A bad signature is 403. Then require MessageSid and MessageStatus. Connect Mongo. Ask leftover apply to stamp this word on the Lead Message we already remembered — never backward, history-only on an old SID. If no row has that SID yet, answer 404 `"Message not recorded yet"` so Twilio retries the race with claim-and-send. If we have the row, answer 204 even when leftover apply only appended history. Do not write TwiML. Do not drain. Do not compare `x-api-secret`.*

That is the operation. `router.post("/api/webhooks/twilio/message-status")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **404 is the persist-SID race, not a Granot / RingCentral copy.** Leftover apply returns `false` only when no Lead Message has this SID on `twilio_message_sid` or `twilio_message_sids`. Leftover RingCentral inbound and leftover local-file both answer 200 after a keep/append miss so they do not retry-storm. Leftover Granot inbound **503**s a capture throw. Do not silently **204** an unknown SID so “this desk matches leftover RingCentral always-200” — claim-and-send may not have written the SID yet. Do not silently **202** so “every inbound webhook matches leftover Granot.” Do not silently **200** `{ ok: true }` so “Twilio JSON matches leftover RingCentral.”

2. **204 means we found the SID, not that the status moved.** Leftover apply returns `true` after SID-mismatch history, after an unknown incoming status (history only), and after a rank filter that does not `$set` `status`. The route then **204**s. Do not silently **409** an ignored callback so “Twilio retries until the rank moves.” Do not add `applied` onto the HTTP body so “the owner can see whether it counted.”

3. **This desk never asks `shouldApplyTwilioStatus`.** That helper is leftover exported and folder-tested. Leftover apply rebuilds rank with `allowedCurrent` and never calls it. CONTRADICTIONS already names this. Do not silently wire the helper from this file so “one rank function wins.”

4. **Signature throw is config, false is forged.** Leftover `validateTwilioWebhook` throws via leftover `getRequiredEnv` when `TWILIO_PRIMARY_AUTH_TOKEN` or leftover default `TWILIO_STATUS_CALLBACK_URL` is missing. Leftover voice uses the same 500 / 403 map with three leftover URLs. Do not silently 403 a missing URL so “one refuse owns every miss.” Do not pass leftover `getLeadMessagingCredentials().statusCallbackUrl` as `requestUrl` so “one bag owns both reads” — already-recommended adapter CONTRADICTIONS says those reads stay apart.

5. **This desk never passes a voice URL.** Leftover next voice **asks** leftover `validateTwilioWebhook(signature, params, getTwilioVoiceConfig()[urlKey])`. This file omits the third argument on purpose. Do not silently pass leftover `TWILIO_VOICE_WEBHOOK_URL` so “one URL owns every Twilio POST.” Do not merge this router into leftover next voice so “one file owns every Twilio signature.”

6. **`stringParams` is a copy of leftover next voice.** Same object / array / string-value fold. Do not silently extract a shared helper in this rename so “one helper owns every Twilio POST” without a paired HTTP proof on **both** desks. Park the copy.

7. **Letters live on leftover apply, not this router.** This file logs `twilio.message_status.*` / `lead_messaging.callback.*` and does **not** **ask** `recordOperationalEvent`. Leftover apply **asks** leftover `recordStatusCallbackEvent` (`lead_message.status_updated` / `status_ignored` / `lead_message.delivery_failed`). Leftover next voice **asks** leftover `recordOperationalEvent` `twilio.voice.*` from the route. Do not silently emit those letters from this file so “one route owns every Twilio letter.”

8. **Phones are masked; the SMS body is never logged.** Leftover `maskPhoneForLog` on `To` / `From`. Do not log `ErrorMessage` as a customer quote. Do not log leftover `req.body` whole so “the test can see the form.”

9. **`connectMongo` is this desk’s live-connection beat.** Leftover apply assumes a model. Leftover Granot inbound does not call `connectMongo` in the router (capture does). Do not drop the connect so “apply owns Mongo.” Do not move leftover apply into this file so “the route owns the write.”

10. **There is no factory inject and no route test.** Leftover Granot webhook tests inject `capture` / `publish`. Leftover RingCentral inbound and leftover local-file also export only the live `Router()`. Do not add `createTwilioMessageStatusRouter` in this rename without a paired HTTP proof. Today there is **no** `twilio-message-status.routes.test.ts`.

11. **This desk never uses the API secret, HMAC, Granot webhook secret, the cron secret, or the live-host debug token.** `app.ts` mounts it after leftover crons, before leftover voice and leftover public v1. Signature is handshake, not leftover `x-api-secret`. Do not remount `requireApiSecret` so “it matches leftover reporting.” Do not teach this file `CRON_SECRET` so “one file owns hybrid Lead Messaging.” Do not hide this POST behind leftover Owner HMAC so “status matches leftover admin retry.”

12. **Leave sibling modules alone.** `validateTwilioWebhook` / `applyTwilioStatusCallback` / leftover next voice / leftover next drain are already the right **depth**. This file orchestrates the HTTP **adapter**.

13. **Do not treat leftover remember / leftover REST create / leftover Granot create-if-missing / leftover Owner retry / leftover drain / leftover next voice / leftover Granot inbound / leftover RingCentral inbound / leftover CRM Posting / leftover public v1 / leftover reporting / leftover Best Relocation / leftover Granot automation as this story.** Next `twilio-voice.routes.ts` is Dial / hangup. Next `lead-messaging-cron.routes.ts` is the drain trigger. Do not teach this file `CRON_SECRET`. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `acceptThisTwilioMessageStatusDesk` (mounted on `app.ts` **after** leftover crons, **before** leftover voice and leftover public v1 as the default export) and the one HTTP operation above.

Today there is **no** `twilio-message-status.routes.test.ts`. Wave A file tests prove leftover rank helper / leftover default-URL signature through those **interfaces**. Add an HTTP proof that names the operation (do not boot live Twilio, do not send an SMS, do not walk `createTwilioSender` in the route file):

**Handshake / who may speak**
- This desk is mounted from `app.ts` **after** leftover `leadMessagingCronRoutes` / leftover `notificationCronRoutes`, **before** leftover `twilioVoiceRoutes` and leftover `v1Routes`.
- POST with a missing leftover token or leftover `TWILIO_STATUS_CALLBACK_URL` **500** `"Webhook configuration error"` and does **not** ask leftover apply.
- POST with a bad `x-twilio-signature` **403** `"Forbidden"` and does **not** ask leftover apply.
- POST **asks** leftover `validateTwilioWebhook(signature, params)` with **no** third argument (leftover default URL), not leftover voice’s three URLs.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` are **not** accepted here.

**Stamp, never send**
- Missing `MessageSid` or `MessageStatus` **400** `"Missing MessageSid or MessageStatus"`.
- POST **asks** leftover `connectMongo` then leftover `applyTwilioStatusCallback` with leftover `ErrorCode` folded through leftover `parseOptionalNumber` and leftover `ErrorMessage || null`.
- Leftover apply `false` **404** `"Message not recorded yet"` and logs `twilio.message_status.not_found`.
- Leftover apply `true` **204** empty (including SID-mismatch / unknown status / no rank move).
- Apply throw **500** `"Callback processing failed"`.
- This beat does **not** ask `shouldApplyTwilioStatus` / `runLeadMessagingDrain` / `requestLeadMessageRetry` / `createTwilioSender` / `recordOperationalEvent` / leftover voice TwiML builders.

**Logs**
- Received log masks `To` / `From` and never writes the SMS body.

**Mount**
- `app.ts` should keep `app.use(twilioMessageStatusRoutes)` after leftover crons, before leftover voice and leftover `v1Routes`.
- Leftover next voice and leftover next drain stay mounted apart and are not this desk.

**Not this file**
- Signature stays on already-recommended [lead-messaging-twilio-adapter.md](lead-messaging-twilio-adapter.md).
- Never-backward persist stays on already-recommended [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md).
- Voice stays on next `twilio-voice.routes.ts`.
- Drain trigger stays on next `lead-messaging-cron.routes.ts`.
- Owner retry stays on already-recommended [routes-v1.md](routes-v1.md).

Do **not** add a test per helper (`stringFieldsFromTheFormBody`, `readTheTwilioSignature`, `optionalNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory inject in this rename so “the test can no longer see the live leftover apply default.” If a later implementer adds inject, the HTTP proof must still name the live default.

## What I would not do

- A `TwilioMessageStatusRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.status(204).send()`.
- Moving this into a CRUD folder (`post.ts` / `webhook.ts` / `callback.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the 404-unknown-SID **seam**: do not 204 a miss so “this desk matches leftover RingCentral always-200.”
- Breaking the 204-found-SID **seam**: do not 409 an ignored status so Twilio retry-storms a terminal row.
- Breaking the never-backward **seam**: do not apply rank in this file, and do not wire leftover `shouldApplyTwilioStatus` from the router.
- Breaking the unguarded-inbound **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / `CRON_SECRET` / leftover `x-debug-token` here.
- Treating leftover `validateTwilioWebhook`, leftover `applyTwilioStatusCallback`, leftover `shouldApplyTwilioStatus`, leftover remember / leftover REST create / leftover Granot create-if-missing / leftover Owner retry / leftover drain / leftover next voice / leftover Granot inbound / leftover RingCentral inbound / leftover CRM Posting / leftover public v1 / leftover reporting / leftover Best Relocation / leftover Granot automation / leftover webhook / cron routers as this story.
- Inventing a leftover factory-inject / leftover cron-secret / leftover Zod / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently 204 an unknown SID, 202 a keep, asking leftover drain, remounting `requireApiSecret`, teaching this file `CRON_SECRET`, merging this router into leftover next voice, or writing TwiML while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
