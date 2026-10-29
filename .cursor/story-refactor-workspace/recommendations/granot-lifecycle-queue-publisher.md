# Publish a receipt-id wake after durable capture

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/services/granotLifecycle/queuePublisher.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/automation-apply.md`, `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/drainer.md`, `docs/knowledge/granot-lifecycle/extension-apply.md`, `docs/knowledge/services/form-lead.md`

## Current operation and boundaries

Queue delivery is best effort; Mongo receipt state and cron recovery are durable. Payload remains receipt_id only.

## Remaining recommendation

Keep one small adapter and existing injected send seam/topic selection. No processor, retry planner or receipt mutation belongs here.

Preserve compatibility aliases while live callers migrate. Stored command names, event keys, reason codes, collection names, checksums and DTO fields are contracts, not rename targets. No policy change, flag enablement, migration or production write is authorized.

## Current exports to account for

`GranotLifecycleReceiptWakeup`; `PublishGranotLifecycleReceiptWakeupDeps`; `publishGranotLifecycleReceiptWakeup`

## Parity proof

Exact payload; test/off-platform posture; failed send preserves capture and reports bounded failure metric/log.

Start with existing target unit/replica suites and direct importing callers. Add only missing behavior proofs for the selected cleanup; run affected suites and typecheck migrated callers. This documentation refresh ran no runtime tests.
