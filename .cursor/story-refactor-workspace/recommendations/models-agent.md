# Agent roster and Granot identity

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/Agent.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/identity.md`, `docs/knowledge/services/agent-allocation.md`, `docs/knowledge/services/catalog.md`

## Current storage contract

agents keeps unique normalized_name, nested uppercase Granot identity and legacy flat fallback, aliases, optional outreach_desk=auto/on/off and two query-time received-Lead virtuals. Nested username uniqueness is partial, never also sparse.

## Remaining naming and organization work

Clarify authoritative nested versus compatibility flat identity and optional Desk control. Keep model/type names and two virtuals; catalog mutations and username resolution stay in services.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`AgentDocument`; `Agent`

## Parity checks for future implementation

Defaults/name normalization; partial versus sparse index; virtual serialization; absent Desk interpreted by service; no dashboard role or Lead mutation.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
