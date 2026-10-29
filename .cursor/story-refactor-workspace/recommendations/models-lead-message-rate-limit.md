# Hashed capacity bucket evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/LeadMessageRateLimit.ts`
- Knowledge: `docs/knowledge/services/lead-messaging.md`

## Current storage contract

String-key destination/hourly buckets store count/reservation and expires_at TTL, not raw destination phone. Reservation/normalization are messaging-service policy; selected getter remains.

Destination bucket id uses SHA-256 of the destination; hourly bucket id embeds the UTC hour rather than a hash.

## Remaining naming and organization work

Keep small bucket model and current key/TTL formats; no message-row merge.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`LeadMessageRateLimitDocument`; `LeadMessageRateLimit`; `getLeadMessageRateLimitModel`

## Parity checks for future implementation

Kinds/defaults; destination hash and UTC-hour id; TTL0; selected DB; no reserve/send/normalize in schema.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
