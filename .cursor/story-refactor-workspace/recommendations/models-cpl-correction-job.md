# Stamped-CPL correction request and progress

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CplCorrectionJob.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md`

## Current storage contract

Job freezes source/window/models/preview hash/request evidence while lease/status/counters progress. It corrects stored Lead snapshots for Sheets; Insights/Today/Desk already price schedule live.

The immutability described here is enforced through Mongoose schema options or document validation where present; it is not a database-level guarantee against raw writes.

## Remaining naming and organization work

Group immutable request/preview and mutable execution. Preserve selected-db getter, statuses and indexes; no schedule redesign.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CPL_CORRECTION_JOB_STATUSES`; `CplCorrectionJobStatus`; `CPL_CORRECTION_LEAD_MODELS`; `CplCorrectionLeadModel`; `CplCorrectionJobDocument`; `CplCorrectionJob`; `getCplCorrectionJobModel`

## Parity checks for future implementation

Window/hash immutability; status/counter defaults; lease indexes; selected DB; no correction or repricing from model.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
