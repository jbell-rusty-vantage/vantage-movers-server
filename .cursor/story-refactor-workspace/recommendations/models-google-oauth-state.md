# Expiring hashed OAuth state

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GoogleOAuthState.ts`
- Knowledge: `docs/knowledge/services/reporting.md`

## Current storage contract

Unique nonce_hash, created_at without updatedAt and expires_at TTL0. Service owns issuance/hash/single-use/expiry; TTL cleanup is eventual.

## Remaining naming and organization work

Keep small row and explain hash/expiry evidence without service wrappers.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GoogleOAuthStateDocument`; `GoogleOAuthState`

## Parity checks for future implementation

Hash uniqueness; expiry required/TTL definition; timestamp shape; default connection; service rejects expired state before TTL deletion.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
