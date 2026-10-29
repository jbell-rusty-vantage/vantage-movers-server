# Cancellation and durable correlation snapshots

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CancelledLead.ts`
- Knowledge: `docs/knowledge/services/cancellation-mirror.md`, `docs/knowledge/services/cancelled-lead.md`, `docs/knowledge/services/job-number-timeline.md`

## Current storage contract

cancelled_leads requires Booking/refund/cancel date, optional Lead. Four immutable-after-insert snapshots preserve job/normalized job/Lead ref/Booking creation after Booking deletion. Nonunique partial normalized-job-snapshot index and autoIndex=false remain.

The pre-validation document hook rejects changes on existing documents; it is not a query or raw-write guard. Raw Mongo writes are outside these model safeguards.

## Remaining naming and organization work

Separate mutable official fields from immutable ingress correlation and revision guard. Do not infer official refund/date or backfill snapshots from schema hooks.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX`; `CancelledLeadDocument`; `CancelledLead`

## Parity checks for future implementation

Legacy null read; snapshot insert then mutation rejection; nonunique index; optional Lead/default connection; timeline recovery does not invent Booking.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
