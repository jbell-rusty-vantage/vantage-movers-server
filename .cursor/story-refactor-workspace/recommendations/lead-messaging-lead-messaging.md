# Persist, dispatch and reconcile one Lead Message

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leadMessaging/leadMessaging.service.ts`
- Knowledge: `docs/knowledge/services/lead-messaging.md`

## Current operation and boundaries

Intent precedes sending. Lease/capacity and definite-unsent retry differ from uncertain provider acceptance. Midnight–6:59 New York may schedule at8 when enabled. Callbacks match current SID and advance status monotonically; accepted outcome cannot be flipped by later logging failure.

## Remaining recommendation

Organize persist intent, capacity reservation, dispatch, drain/recovery, callback and explicit manual retry as domain operations. Keep Twilio adaptation separate. Preserve public APIs, statuses, scheduling assertions, unique identities and one durable row.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`PersistFormLeadMessageInput`; `PersistGranotLeadMessageInput`; `PersistLeadMessageInput`; `LeadMessagingOutcome`; `assertTwilioScheduleLeadTime`; `persistLeadMessageIntent`; `buildLeadMessageTwilioSendInput`; `dispatchOrQueuePersistedLeadMessage`; `dispatchPersistedLeadMessage`; `queueInitialLeadMessage`; `runLeadMessagingDrain`; `applyTwilioStatusCallback`; `listLeadMessages`; `getLeadMessage`; `requestLeadMessageRetry`; `shouldApplyTwilioStatus`; `normalizeSmsDestination`; `reserveLeadMessagingCapacity`; `classifyLeadMessagingFailure`

## Parity proof

Form versus Granot refs; capacity bucket races; scheduled lead-time; definite-unsent retry bound; timeout/5xx uncertain no auto-resend; expired sending lease uncertain; stale SID ignored; terminal callback monotonic; manual retry requires no SID/allowed status/count.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
