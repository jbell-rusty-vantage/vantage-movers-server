# W-02-02 — Receipt apply redacts only when payload_sha256 is absent

- **Severity:** warning
- **Status:** open
- **Opened:** 2026-08-14 (Unit 02 review)
- **Suggested window:** Unit 03 capture path, or the next edit to receipt apply / `fillLegacyWebhookReceiptV2Fields`

## Contract

Section 34.1: remove any persisted `x-api-secret` keys before hashing/backfill; report count only, never value. UNIT-02 §6.6 also strips `authorization`, `cookie`, and `set-cookie` variants. Evidence already present must not be rewritten (UNIT-02 §6.7 / completion report).

## Current behavior

`absentLegacyV2Fields` copies redacted `headers` / `payload` / `payload_sha256` only when `payload_sha256 == null`. `--report` still counts forbidden keys on every row. `--apply` is a no-op for already-current v2 rows, including rows whose hash was computed before secrets were stripped.

Current production rows have no `payload_sha256`, so the first apply will redact and hash. Mongoose inserts always run `redactCredentialKeys` / `hashCredentialRedactedPayload` on create.

The gap is a later row that already has a valid hash and still contains a forbidden key: `--report` counts it; `--apply` leaves the secret in place.

## Suggested fix

Keep “do not rewrite present v2 evidence” for source/channel/auth/processing. For credential keys, either:

1. apply a keys-only `$unset` / rewrite when `--report` credential counts are non-zero and the row is otherwise current, then re-hash; or
2. fail `--verify` when a received row still has forbidden keys, so the gap cannot stay silent.

Unit 03 should keep using `receiptEvidence.ts` on the live capture path so new rows never persist those keys.

## Files

- `src/services/granotLifecycle/receiptCompatibility.ts` (`absentLegacyV2Fields`)
- `scripts/migrations/granot-lifecycle-receipts.lib.ts`
- `src/models/GranotObservationReceipt.ts` (mongoose create path is already redacting)
