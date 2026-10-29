# Granot extension login and session identity

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/ExtensionUser.ts`
- Knowledge: `docs/knowledge/services/extension-users.md`

## Current storage contract

roles[] uses CURRENT_EXTENSION_ROLES, legacy role still reads employee; optional agent_id/token_version and explicit snake_case clocks remain. This differs from dashboard roles. Save updates updated_at, email unique, versionKey=false.

## Remaining naming and organization work

Keep compatibility fields readable; name save-clock hook. Agent assignment, role migration and session invalidation remain services.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`EXTENSION_ROLES`; `LEGACY_EXTENSION_ROLES`; `STORED_EXTENSION_ROLES`; `ExtensionRole`; `ExtensionUserDocument`; `ExtensionUser`

## Parity checks for future implementation

Current/legacy roles; optional Agent; lowercased unique email; explicit clocks/token default; no password hashing or dashboard role change.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
