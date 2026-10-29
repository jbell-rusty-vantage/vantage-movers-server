# Call Lead identity and original caller evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/CallLead.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`, `docs/knowledge/services/ringcentral-call-lead-qualification.md`

## Current storage contract

call_leads stays separate from form_leads, with autoIndex=false/optimisticConcurrency=true. Phone OR job required; legacy Granot job-only remains valid. Immutable provenance/original caller guard, unique sparse telephony session, nonunique job indexes and granot_form_sibling persist.

Mongoose schema/provenance guards cover specific operations; whole RingCentral replacement explicitly permits a filter asserting original_caller is absent. Raw Mongo writes are outside these model safeguards.

## Remaining naming and organization work

Rename normalizePhoneNumber hook to include job folding; keep requireLeadIdentity and replacement guard explicit. Preserve default model/selected-db getter; no unified Lead collection or new qualification requirement.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`CALL_LEAD_S08_INDEXES`; `CallLeadDocument`; `CallLead`; `getCallLeadModel`

## Parity checks for future implementation

Phone-only/job-only/neither; snapshots immutable; whole RingCentral replacement guard; session uniqueness differs from business Duplicate Lead; sibling marker; TEST_MODE binding; job nonunique.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
