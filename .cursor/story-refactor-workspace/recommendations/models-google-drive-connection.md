# Owner OAuth connection storage

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GoogleDriveConnection.ts`
- Knowledge: `docs/knowledge/services/reporting.md`

## Current storage contract

Connection row has unique owner_email, encrypted token/scopes and created_at/updated_at clocks on default connection. It does not exchange/refresh credentials.

## Remaining naming and organization work

Group identity, encrypted credentials and lifecycle clocks. Preserve encryption boundary/uniqueness; no invented selected adapter.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GoogleDriveConnectionDocument`; `GoogleDriveConnection`

## Parity checks for future implementation

Required/defaults; unique Owner; ciphertext format; snake_case clocks; reuse; no raw-token projection or OAuth request.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
