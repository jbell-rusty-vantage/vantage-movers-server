# routes-twilio-voice

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/twilio-voice.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

2. **Remember this Twilio voice progress callback** — `POST /api/webhooks/twilio/voice/status`. Same leftover `stringParams` + leftover `validateVoiceRequest` with leftover `statusCallbackUrl`. Then leftover `recordVoiceCallback(..., "progress")` → leftover letter `twilio.voice.progress` (leftover `DialCallSid` / leftover `ParentCallSid`, leftover `CallStatus` / leftover `DialCallStatus`, leftover `DialCallDuration`). Answer leftover **204** empty. This beat does **not** re-check leftover destination. This beat does **not** write TwiML. This beat does **not** stamp a Lead Message.

3. **Hang up after the forwarded call completes** — `POST /api/webhooks/twilio/voice/completed`. Same leftover fold + leftover `validateVoiceRequest` with leftover `completedCallbackUrl`. Then leftover `recordVoiceCallback(..., "completed")` → leftover letter `twilio.voice.completed`. Answer leftover **200** `text/xml` leftover `buildTwilioVoiceCompletedResponse()` (Hangup). This beat does **not** re-check leftover destination. This beat does **not** Dial again. This beat does **not** ingest a Call Lead.

`validateVoiceRequest` / `recordVoiceCallback` / leftover `stringParams` / leftover `validateTwilioWebhook` / leftover TwiML builders are beats inside these operations, not extra owner stories. The default export is the `Router()` instance — there is **no** factory inject.

There is no fourth GET reachability operation. Leftover RingCentral inbound has a GET ready; this desk does not. There is no fifth SMS-status operation. Stamp-the-Lead-Message lives on already-recommended `twilio-message-status.routes.ts`.

1. **Three leftover voice URLs, never leftover SMS `TWILIO_STATUS_CALLBACK_URL`.** Leftover `validateVoiceRequest` **asks** leftover `validateTwilioWebhook(signature, params, getTwilioVoiceConfig()[urlKey])`. Already-recommended SMS status omits the third argument on purpose. Do not silently drop `requestUrl` so “one default URL owns every Twilio POST.” Do not silently pass leftover `TWILIO_STATUS_CALLBACK_URL` so “one bag owns both reads.” Already-recommended adapter CONTRADICTIONS says those reads stay apart.

2. **Destination is an inbound Dial fence, not a progress / completed fence.** Leftover `isExpectedTwilioVoiceDestination` runs only on leftover `/voice`. Leftover `/status` and leftover `/completed` already signed against leftover derived URLs. Do not silently add leftover destination onto progress so “one fence owns every POST” — Twilio’s Number status callback `To` is leftover `forwardTo` (RingCentral), not leftover `fromNumber`. Do not silently **400** leftover completed because leftover `To` is leftover RingCentral.

4. **`stringParams` is a copy of already-recommended leftover SMS status.** Same object / array / string-value fold. CONTRADICTIONS already names this. Do not silently extract a shared helper in this rename so “one helper owns every Twilio POST” without a paired HTTP proof on **both** desks. Park the copy.

8. **Leftover loop / leftover E.164 live on leftover `getTwilioVoiceConfig`, not this file.** Leftover `validateVoiceRequest` already **asks** leftover config before leftover signature (third-arg evaluate). A leftover from=forward throw is leftover **500** config, not leftover **400** destination. Do not silently **400** a loop so “one refuse owns every bad number.” Do not move leftover loop into this file so “the route owns E.164.”
