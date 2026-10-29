# Lifecycle catalogs, provenance and revision guards

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/granotLifecycleSchemas.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/capture.md`, `docs/knowledge/granot-lifecycle/revisions.md`

## Current storage contract

Current channel/action/outcome catalogs, field definitions and guards remain shared storage contracts. Assignable Call origins still allow non-RingCentral legacy create paths; best_relocation_sheet is not proof ingest is live. Form/Call ingress snapshots differ.

Lead provenance and aggregate revision checks are document pre-validation hooks; they do not guard direct query or raw writes.

## Remaining naming and organization work

Group catalog families/guard stories without changing persisted enums or duplicating ownership in Admin/clients. Preserve current allowlists, immutable ingress/revision pairing and channel operation shape checks.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`RECEIPT_WORK_STATES`; `AUTHENTICATION_METHODS`; `PAYLOAD_KINDS`; `OBSERVATION_CHANNELS`; `ROUTE_EVENT_CLASSES`; `CHANNEL_OPERATION_KINDS`; `OBSERVATION_KINDS`; `NORMALIZATION_RESULTS`; `NORMALIZATION_ISSUE_CODES`; `GRANOT_BOOKING_ACTIONS`; `NORMALIZATION_ISSUE_SEVERITIES`; `SYNCHRONIZATION_OUTCOMES`; `SYNCHRONIZATION_REASON_CODES`; `EXECUTION_MODES`; `SYNCHRONIZATION_MATCH_METHODS`; `SYNCHRONIZATION_EFFECT_KINDS`; `ENTITY_REF_MODELS`; `GRANOT_RECONCILIATION_CASE_STATES`; `GRANOT_RECONCILIATION_ACTION_KINDS`; `GRANOT_RECONCILIATION_EVIDENCE_ACTIONS`; `GRANOT_BOOKING_RECONCILIATION_MODES`; `GRANOT_BOOKING_RECONCILIATION_OUTCOMES`; `GRANOT_RELEASE_RECONCILIATION_OUTCOMES`; `GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES`; `GRANOT_LIFECYCLE_DISPOSITIONS`; `GRANOT_LEAD_MODELS`; `AGGREGATE_REVISION_FIELD_NAMES`; `isNonnegativeIntegerRevision`; `aggregateRevisionSchemaFields`; `FORM_LEAD_INGESTION_ORIGINS`; `CALL_LEAD_INGESTION_ORIGINS`; `ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS`; `ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS`; `INGESTED_EVIDENCE_STATUSES`; `CURRENT_CONTACT_SOURCE_SYSTEMS`; `CURRENT_MOVE_SOURCE_SYSTEMS`; `RINGCENTRAL_CONVERGENCE_STATES`; `RECEIVER_AGENT_SOURCES`; `LEAD_PROVENANCE_FIELD_NAMES`; `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS`; `sharedLeadProvenanceSchemaFields`; `formLeadProvenanceSchemaFields`; `callLeadProvenanceSchemaFields`; `applyLeadProvenanceGuards`; `applyAggregateRevisionGuards`; `RECORD_LINK_STATES`; `GRANOT_LIFECYCLE_ACTIVATION_KEY`; `granotReceiptLastErrorSchema`; `granotReceiptProcessingSchema`; `assertChannelOperationId`; `isAutomationOperationId`; `assertReceiptChannelShape`

## Parity checks for future implementation

Origin matrix; immutable snapshot/history boundary; new legacy_unknown denied; revision fields paired; operation id length/control/bidi; webhook/channel shape; no qualification/schema redesign.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
