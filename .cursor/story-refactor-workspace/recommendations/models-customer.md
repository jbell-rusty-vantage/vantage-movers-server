# Customer contact and query-time relations

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/Customer.ts`
- Knowledge: `docs/knowledge/services/customer.md`

## Current storage contract

customers requires full_name and has optional indexed normalized_name/phone/email. Booking/Cancellation/Testimonial virtuals are query-time only; phone/email/name are not unique.

## Remaining naming and organization work

Keep small model together; clarify storage versus service upsert identity. No invented selected getter or dedup policy.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CustomerDocument`; `Customer`

## Parity checks for future implementation

Required name; lowercase email/name; optional contact; nonunique indexes; virtual serialization; model reuse; no provider merge.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
