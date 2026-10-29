# Immutable causal Decision per Observation attempt

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/SynchronizationDecision.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`, `docs/knowledge/granot-lifecycle/drainer.md`, `docs/knowledge/granot-lifecycle/processor.md`, `docs/knowledge/granot-lifecycle/projections.md`

## Current storage contract

Append-only unique observation_id+attempt, safe outcome/reason/match/gate/effect summaries/refs. No full desired patch/contact. Selected getter and autoIndex=false remain; receipt latest pointer is separate mutable work state.

These guards apply to the listed Mongoose document and query operations; they do not establish database-level immutability for raw writes or unlisted operations.

## Remaining naming and organization work

Name causal schema families/immutability guards, preserve enums/indexes. No planner/drainer policy or Lead change in schema.

No schema, collection, index, default, enum or model-registration change is authorized. Keep clear public model names. Preserve importing callers and guarded writes; retain exact aliases if an exported helper changes.

## Current exports

`SynchronizationMatchMethod`; `SynchronizationEffectKind`; `SynchronizationDecisionSourceScope`; `SynchronizationDecisionSourcePolicy`; `SynchronizationDecisionCandidate`; `SynchronizationDecisionEvaluatedGate`; `SynchronizationDecisionEffect`; `SynchronizationDecisionDocument`; `SYNCHRONIZATION_DECISION_COLLECTION`; `SYNCHRONIZATION_DECISION_MODEL_NAME`; `SYNCHRONIZATION_DECISION_INDEXES`; `SynchronizationDecision`; `getSynchronizationDecisionModel`

## Parity checks for future implementation

Unique attempt; gates/effects; mutation/replace/delete rejected; no job uniqueness; selected DB; no receipt pointer stamp.

Use schema validation/declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require proof. Declared indexes do not prove production installation. Inspect existing tests before relying on them; no runtime/production checks ran for this refresh.
