# Temporal inbound number to Call-feed interval

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/RingCentralInboundRouteAssignment.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`, `docs/knowledge/services/ringcentral-call-lead-qualification.md`

## Current storage contract

Immutable route/company/feed/from, closure via until and active=false; partial unique open interval per route. Qualification reads source assignment snapshot; model does not activate/reassign.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Name interval identity versus closure; preserve getter/indexes and separate route card/history.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`RingCentralInboundRouteAssignmentDocument`; `RingCentralInboundRouteAssignment`; `getRingCentralInboundRouteAssignmentModel`

## Parity checks for future implementation

Immutable identity/from; open partial unique; route/from/until/feed-active indexes; selected DB; no qualification/source resolution.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
