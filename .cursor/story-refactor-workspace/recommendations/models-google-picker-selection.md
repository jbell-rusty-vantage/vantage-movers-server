# Validated Picker selection reference

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GooglePickerSelection.ts`
- Knowledge: `docs/knowledge/services/reporting.md`

## Current storage contract

Unique reference_hash and owner/resource/kind metadata with expires_at TTL; separate from nonce. Service consumes references and enforces ownership/expiry.

## Remaining naming and organization work

Keep selection evidence distinct from nonce/state; clarify fields while retaining default model and timestamp shape.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GooglePickerSelectionDocument`; `GooglePickerSelection`

## Parity checks for future implementation

Reference uniqueness; folder/spreadsheet; TTL/created_at; no invented updatedAt; no permission bypass.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
