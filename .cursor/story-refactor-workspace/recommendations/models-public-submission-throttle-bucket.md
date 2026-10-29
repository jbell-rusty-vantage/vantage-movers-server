# Employee-submit window counters

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/PublicSubmissionThrottleBucket.ts`
- Knowledge: `docs/knowledge/services/employee-bookings.md`

## Current storage contract

Unique key+window, count minimum0, expires_at TTL on default connection. Service hashes client identity, floors windows, checks thresholds and increments atomically.

## Remaining naming and organization work

Explain bucket evidence/expiry, not policy; keep small schema. No selected getter or raw client secret.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`PublicSubmissionThrottleBucketDocument`; `PublicSubmissionThrottleBucket`

## Parity checks for future implementation

Unique tuple; nonnegative count; TTL0; timestamps/reuse; no hashing/rate decision/request handling.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
