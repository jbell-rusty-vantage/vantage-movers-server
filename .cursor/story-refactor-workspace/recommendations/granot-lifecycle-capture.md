# Persist redacted delivery or approved-operation evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/capture.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`, `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/drainer.md`, `docs/knowledge/granot-lifecycle/extension-apply.md`, `docs/knowledge/granot-lifecycle/normalization.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/services/form-lead.md`, `docs/knowledge/services/granot-http-collector.md`

## Current operation and boundaries

Webhook receipt commits before acknowledgment; route class and payload event_type remain distinct. Channel capture hashes the complete apply item and fences operation identity. Capture produces receipts, not Observations or domain effects; later receipt mutation is processing-only.

## Remaining recommendation

Keep webhook delivery and approved channel-operation entry points distinct over shared evidence rules. Group bounds/allowlists near builders; retain injected persistence, duplicate-race replay and checksum shape.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST`; `GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH`; `CaptureGranotLifecycleWebhookInput`; `CaptureGranotLifecycleWebhookResult`; `GranotObservationReceiptInsert`; `PersistGranotObservationReceipt`; `allowlistGranotWebhookHeaders`; `buildGranotObservationReceiptInsert`; `captureGranotLifecycleWebhookReceipt`; `ChannelObservationChannel`; `ChannelAuthenticationMethod`; `CaptureChannelOperationInput`; `CaptureChannelOperationResult`; `GranotChannelReceiptInsert`; `PersistGranotChannelReceipt`; `LoadChannelReceiptByOperation`; `buildGranotChannelReceiptInsert`; `captureChannelOperationReceipt`

## Parity proof

Credentials redacted; allowlisted headers only; commit failure prevents accepted acknowledgment; exact operation replay versus checksum conflict; channel shape validation; no processor invocation or Lead write.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
