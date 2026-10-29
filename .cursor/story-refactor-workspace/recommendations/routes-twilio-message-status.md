# routes-twilio-message-status

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/twilio-message-status.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: the router/default export.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

1. **404 is the persist-SID race, not a Granot / RingCentral copy.** Leftover apply returns `false` only when no Lead Message has this SID on `twilio_message_sid` or `twilio_message_sids`. Leftover RingCentral inbound and leftover local-file both answer 200 after a keep/append miss so they do not retry-storm. Leftover Granot inbound **503**s a capture throw. Do not silently **204** an unknown SID so “this desk matches leftover RingCentral always-200” — claim-and-send may not have written the SID yet. Do not silently **202** so “every inbound webhook matches leftover Granot.” Do not silently **200** `{ ok: true }` so “Twilio JSON matches leftover RingCentral.”

2. **204 means we found the SID, not that the status moved.** Leftover apply returns `true` after SID-mismatch history, after an unknown incoming status (history only), and after a rank filter that does not `$set` `status`. The route then **204**s. Do not silently **409** an ignored callback so “Twilio retries until the rank moves.” Do not add `applied` onto the HTTP body so “the owner can see whether it counted.”

4. **Signature throw is config, false is forged.** Leftover `validateTwilioWebhook` throws via leftover `getRequiredEnv` when `TWILIO_PRIMARY_AUTH_TOKEN` or leftover default `TWILIO_STATUS_CALLBACK_URL` is missing. Leftover voice uses the same 500 / 403 map with three leftover URLs. Do not silently 403 a missing URL so “one refuse owns every miss.” Do not pass leftover `getLeadMessagingCredentials().statusCallbackUrl` as `requestUrl` so “one bag owns both reads” — already-recommended adapter CONTRADICTIONS says those reads stay apart.

6. **`stringParams` is a copy of leftover next voice.** Same object / array / string-value fold. Do not silently extract a shared helper in this rename so “one helper owns every Twilio POST” without a paired HTTP proof on **both** desks. Park the copy.

8. **Phones are masked; the SMS body is never logged.** Leftover `maskPhoneForLog` on `To` / `From`. Do not log `ErrorMessage` as a customer quote. Do not log leftover `req.body` whole so “the test can see the form.”

9. **`connectMongo` is this desk’s live-connection beat.** Leftover apply assumes a model. Leftover Granot inbound does not call `connectMongo` in the router (capture does). Do not drop the connect so “apply owns Mongo.” Do not move leftover apply into this file so “the route owns the write.”

12. **Leave sibling modules alone.** `validateTwilioWebhook` / `applyTwilioStatusCallback` / leftover next voice / leftover next drain are already the right **depth**. This file orchestrates the HTTP **adapter**.
