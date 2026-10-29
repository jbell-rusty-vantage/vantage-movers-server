# Expiring Picker nonce evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GooglePickerNonce.ts`
- Knowledge: `docs/knowledge/services/reporting.md`

## Current storage contract

Nonce stores owner/action context, folder/spreadsheet kind, unique nonce_hash and TTL0 expires_at; only created_at auto clock. Service validates/consumes it.

## Remaining naming and organization work

Group nonce identity/intended action/expiry; keep separate from OAuth state and selection.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GooglePickerNonceDocument`; `GooglePickerNonce`

## Parity checks for future implementation

Kind/context; hash unique; TTL/clocks; no raw nonce or provider request.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
