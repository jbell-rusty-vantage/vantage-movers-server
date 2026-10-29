# Inbound-number identity and validation posture

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/RingCentralInboundRoute.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`, `docs/knowledge/services/ringcentral-call-lead-qualification.md`

## Current storage contract

Unique phone locks after activation; RingCentral provider, inactive/unvalidated defaults and archive metadata. Separate temporal assignment; selected getter and sparse provider-id reads remain.

Registry activation sets phone_locked=true and Registry updates reject changes thereafter; the schema uses a conditional Mongoose immutable option keyed by phone_locked, not a raw database constraint.

## Remaining naming and organization work

Clarify phone-lock/validation/activation evidence; never auto-activate or resolve source in hook.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`RingCentralInboundRouteDocument`; `RingCentralInboundRoute`; `getRingCentralInboundRouteModel`

## Parity checks for future implementation

Phone unique/lock; provider enum; defaults; sparse/read indexes; selected DB; no RC call/assignment write.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
