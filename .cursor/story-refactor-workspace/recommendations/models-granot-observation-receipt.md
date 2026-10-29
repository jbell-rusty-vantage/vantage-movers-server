# Immutable receipt evidence and mutable processing

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotObservationReceipt.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/drainer.md`

## Current storage contract

granot_webhook_receipts stores all channels with v2 evidence and nested processing. Mongoose query middleware restricts updates to processing paths, with timestamp exceptions; evidence replacement/deletion denied. Channel operation uniqueness differs from webhook delivery evidence.

The Mongoose query allowlist also permits updatedAt and $setOnInsert createdAt; guard scope is the specified model operations, not raw writes.

## Remaining naming and organization work

Name evidence/processing guards; preserve normalization/channel hooks/index catalog/selected getter. Do not rename collection or restore retired receipt list/SSE.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`GranotObservationReceiptAuthenticationMethod`; `GranotObservationReceiptProcessing`; `GranotObservationReceiptDocument`; `GRANOT_OBSERVATION_RECEIPT_COLLECTION`; `GRANOT_OBSERVATION_RECEIPT_MODEL_NAME`; `GRANOT_OBSERVATION_RECEIPT_INDEXES`; `GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS`; `assertAllowlistedReceiptProcessingUpdate`; `GranotObservationReceipt`; `getGranotObservationReceiptModel`

## Parity checks for future implementation

Channel shape; operation uniqueness; immutable evidence; processing operator allowlist; replace/delete denied; index declarations; selected DB; no auth/policy processor in model.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
