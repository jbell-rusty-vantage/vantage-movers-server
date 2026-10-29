# Form Lead identity on selected Mongo

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/FormLead.ts`
- Knowledge: `docs/knowledge/services/form-lead.md`

## Current storage contract

form_leads requires name/phone/zips, permits absent move size/date/job and keeps not_found sentinel, provenance/revision guards, optimisticConcurrency/autoIndex=false. Four S08 indexes are nonunique; ref_no differs from lid/job.

Provenance immutability is implemented by Mongoose schema guards on specified paths and operations, not a database-level restriction on raw writes.

## Remaining naming and organization work

Rename normalizeEmployeeBookingFields to describe folding lid/phone/name/job for every Form. Preserve default model/getter, named/supplemental indexes and separate Call storage; remove obsolete historical-model advice.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`FORM_LEAD_UNKNOWN_STATE`; `FORM_LEAD_S08_INDEXES`; `FormLeadDocument`; `FormLead`; `getFormLeadModel`

## Parity checks for future implementation

Minimum/optional fields; sentinel/ref_no defaults; normalized identity; immutable snapshots; new-row legacy restriction; no unique Lead job; selected DB; __v distinct; no CRM/Sheets.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
