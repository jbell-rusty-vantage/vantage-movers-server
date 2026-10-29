# Translate approved delivery intent to Twilio

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leadMessaging/twilioAdapter.ts`
- Knowledge: `docs/knowledge/services/lead-messaging.md`

## Current operation and boundaries

Adapter builds provider create input, sends with credentials and verifies webhook signatures. Messaging service owns policy, quiet-hours decision, persistence, retry and uncertain delivery handling; adapter output preserves provider status/SID contract.

## Remaining recommendation

Keep TwilioSendInput/TwilioSendResult and createTwilioSender narrow. Name payload construction and signature validation plainly; do not move consent/capacity or domain retries here.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`TwilioSendResult`; `TwilioSendInput`; `TwilioSender`; `buildTwilioMessageCreateInput`; `createTwilioSender`; `validateTwilioWebhook`

## Parity proof

Messaging service versus sender selection; sendAt/schedule fields; immediate payload; provider response/status/SID; signature accepted/rejected; provider errors preserved for service classification; no raw secrets logged.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
