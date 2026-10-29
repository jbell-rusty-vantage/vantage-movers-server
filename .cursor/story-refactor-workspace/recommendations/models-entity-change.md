# Append-only domain Change evidence

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/EntityChange.ts`
- Knowledge: `docs/knowledge/services/domain-commands.md`

## Current storage contract

EntityChange validates revision/provenance/field value modes and refuses later mutation/replace/delete. Selected getter/autoIndex=false support command transactions. This is not retired Operational Events.

These guards apply to the listed Mongoose document and query operations; they do not establish database-level immutability for raw writes or unlisted operations.

## Remaining naming and organization work

Name validation rules and append-only guards distinctly; keep index/constants and redacted/hash modes. Preserve granot_form_sibling path ownership in domainCommands.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`ENTITY_CHANGE_SOURCE_SYSTEMS`; `EntityChangeSourceSystem`; `ENTITY_CHANGE_VALUE_MODES`; `EntityChangeValueMode`; `DELETED_ENTITY_CHANGE_PATH`; `EntityChangeField`; `EntityChangeProvenance`; `EntityChangeDocument`; `ENTITY_CHANGE_COLLECTION`; `ENTITY_CHANGE_MODEL_NAME`; `ENTITY_CHANGE_INDEXES`; `EntityChange`; `getEntityChangeModel`

## Parity checks for future implementation

Revision chain; immutable methods; deletion sentinel; modes; unique aggregate revision; selected DB; no forbidden raw contact.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
