# Ringcentral Webhook Subscriptions

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/webhook-subscriptions.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations and constants: `buildRingCentralTelephonyEventFilters`, `storeRingCentralWebhookSubscriptionMetadata`, `buildRingCentralWebhookSubscriptionMetadata`, `listStoredRingCentralWebhookSubscriptionIds`, `listStoredRingCentralWebhookSubscriptionMeta`, `findStoredSubscriptionVerificationToken`, `recordStoredSubscriptionDeliveryRefusal`, `findStoredSubscriptionDeliveryRefusals`, `markStoredRingCentralWebhookSubscriptionStatus`, `LOCAL_SUBSCRIPTION_METADATA_PATH`, `DELIVERY_REFUSAL_RECENT_KEPT`.

## Current operation and naming boundary

Filter mode `all` is account telephony without direction/recording filters; `account` is inbound; per-number loads current route numbers. Keep subscription purpose (`calls`/`rep_sms`), verification token, expiration and refusal metadata. Mongo storage can fall back to the local metadata file; that fallback serializes the provider-derived metadata rather than the additional purpose/token bag, so it is not equivalent lifecycle ownership evidence. Preserve bounded recent refusal history and lookup/status APIs. This module stores subscription metadata and builds filters; it does not prove call completion or authorize Lead creation.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
