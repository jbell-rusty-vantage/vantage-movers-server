# WordPress test-form receipt and conditional Lead attachment

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/WordpressFormSubmissionReceipt.ts`
- Knowledge: `docs/knowledge/services/form-lead.md`

## Current storage contract

Test-form-only form_path=test with submission/received identity, processing and optional Form Lead ref. The document pre-validation hook rejects changes to ingress fields and clearing a modified lead_ref; it does not compare an existing non-null reference with a replacement or guard query updates. The receipt service separately attaches only when lead_ref is null or already points to the same Lead; a conflicting existing link is returned unchanged. autoIndex=false with a named unique submission index and a nonunique partial Lead-ref index.

## Remaining naming and organization work

Separate ingress, outcome and link; preserve selected getter/catalog. No widening live form capture or emitting timeline events in schema.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION`; `WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME`; `WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES`; `WordpressFormSubmissionReceiptDocument`; `WordpressFormSubmissionReceipt`; `getWordpressFormSubmissionReceiptModel`

## Parity checks for future implementation

Test enum; index definitions; document validation of ingress and clearing lead_ref; service conditional attach blocks repointing, while the model hook does not guard query updates; timestamps/selected DB; timeline needs actual receipt, model never ingests Lead.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
