# Send the separately gated Granot-created confirmation

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/leadMessaging/granotCreatedLead.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/services/lead-messaging.md`

## Current operation and boundaries

Six gate checks protect post-commit confirmation: messaging mode, explicit Granot flag, create_if_missing policy, source outbound_sms, consent basis and destination. Despite the gate name destination_and_capacity, its check only requires a nonblank destination; capacity is handled downstream by Lead Messaging. Template permits first_name/company and appends STOP language. Stored daily_cap is not a working source-level limiter.

## Remaining recommendation

Keep gate evaluation/render/send separate and name context loading by current policy lookup. Retain unique observation+purpose replay and route messages through durable LeadMessage; do not create policy inside Lead creation or copy Form sms_consent into Granot eligibility.

Keep aliases exact while importing callers migrate. Stored enums, ids, event keys, DTOs and error shapes are contracts; naming work must preserve transaction sessions and side-effect order. This recommendation authorizes no behavior change, migration, flag enablement or external write.

## Current exports

`GRANOT_LEAD_CREATED_SMS_OPT_OUT`; `GRANOT_LEAD_CREATED_SMS_MESSAGE_KEY`; `DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE`; `GranotSmsGate`; `GranotSmsEvaluation`; `GranotCreatedLeadSmsInput`; `evaluateGranotLeadSmsGates`; `renderGranotLeadSmsBody`; `unknownOutboundSmsPlaceholders`; `sendGranotCreatedLeadConfirmation`

## Parity proof

Each first blocker; placeholders/STOP text; invalid refs; duplicate unique replay; missing phone; quiet-hours path; failed text cannot affect committed Lead/link/Decision/Sheets.

Start from existing target tests and actual importing callers. Add only missing outcome proofs for the chosen cleanup, run affected suites and typecheck migrated callers. This recommendation refresh ran no runtime tests.
