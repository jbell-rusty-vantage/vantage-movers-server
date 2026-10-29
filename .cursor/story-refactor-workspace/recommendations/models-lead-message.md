# Durable outbound message and provider outcomes

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/LeadMessage.ts`
- Knowledge: `docs/knowledge/services/lead-messaging.md`

## Current storage contract

Stores legacy form_lead/additive lead_ref, intent/body/recipient, statuses/attempts/history, SIDs/scheduling/lease. Observation+purpose and Twilio SID uniqueness differ. ensureLeadMessageToIndex is current: recovery creates destination index, reads do not.

## Remaining naming and organization work

Group intent/delivery/schedule/retry; retain getter/createLeadMessage session. Preserve index promise/reset-after-failure and name; no old Form ref removal or new send service.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`LeadMessageAttempt`; `LeadMessageStatusEvent`; `LeadMessageLeadRef`; `LeadMessageDocument`; `ensureLeadMessageToIndex`; `LeadMessage`; `getLeadMessageModel`; `createLeadMessage`

## Parity checks for future implementation

Selected/default DB; save session; unique SID/observation-purpose; to index creation/retry; schedule/status fields; no Twilio call here.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
