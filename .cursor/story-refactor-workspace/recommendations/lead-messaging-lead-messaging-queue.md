# Publish a durable-message wake-up

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leadMessaging/leadMessagingQueue.service.ts`
- Knowledge: `docs/knowledge/services/lead-messaging.md`

## Current operation and boundaries

The queue transports { kind: lead_messaging_wakeup, reason }; optional idempotencyKey is a send option, not a message id in the payload; durable LeadMessage state and drain remain authority. Publishing failure cannot turn accepted SMS into a domain failure.

The current publisher imports send and topic configuration directly; it does not expose an injected send/topic dependency.

## Remaining recommendation

Keep this small provider adapter and current direct send/topic dependencies. Rename only to expose wake-up semantics; do not move capacity/retry/sending into queue publisher.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`LeadMessagingWakeupReason`; `publishLeadMessagingWakeup`

## Parity proof

Exact payload/topic; mode/test posture; send failure bounded/logged; no Twilio call or duplicate message intent.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
