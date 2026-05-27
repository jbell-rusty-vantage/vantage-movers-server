# 11 CRM Service Refactor

## Purpose

Keep the Granot CRM integration small, explicit, and separate from form lead lifecycle code.

`api/services/crm.service.ts` is already much narrower than `v1.service.ts`, so this task is mostly about folder placement, payload ownership, config safety, and preserving the form lead submission contract.

## Read First

- `api/services/crm.service.ts`
- `api/services/v1.service.ts`
- `api/models/FormLead.ts`
- `api/validation/v1.validation.ts`
- `.cursor/rules/form-lead-granot-crm.mdc`
- `docs/refactor-and-agentic-documentation-plan.md`

## Current Responsibilities

`crm.service.ts` currently owns:

- CRM endpoint construction from `CRM_API_ID` and `CRM_MOVER_REF`.
- Default form lead CRM label.
- Name splitting for first/last names.
- Move date formatting.
- Granot form lead payload construction.
- HTTP submission.

## Target Files

```text
api/services/crm/
  crm.service.ts
  formLeadPayload.ts
  crmConfig.ts
  types.ts
  index.ts
```

Suggested ownership:

- `crm.service.ts`: public `submitFormLeadToCrm` facade and HTTP call.
- `formLeadPayload.ts`: `splitNameForCrm`, `formatCrmMoveDate`, and `buildCrmFormLeadPayload`.
- `crmConfig.ts`: endpoint construction and env var validation for CRM credentials.
- `types.ts`: payload input/output types if they become useful across files.
- `index.ts`: narrow exports.

Keep this compatibility file until imports migrate:

```text
api/services/crm.service.ts
```

## Compatibility Exports

Preserve:

- `CRM_FORM_LEAD_ENDPOINT`
- `CRM_FORM_LEAD_LABEL`
- `splitNameForCrm`
- `formatCrmMoveDate`
- `buildCrmFormLeadPayload`
- `submitFormLeadToCrm`

If endpoint construction moves to `crmConfig.ts`, keep the exported endpoint name until all imports are migrated.

## Agent Instructions

1. Move payload-building helpers first.
2. Move CRM config second; do not change which env vars are used.
3. Move submit function last.
4. Keep `api/services/crm.service.ts` as a compatibility re-export.
5. Do not change the form lead fields sent to Granot.
6. Do not add retry behavior in this task.
7. Do not alter `post_to_granot` behavior in form lead creation.
8. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- CRM payload shape must not change.
- Name splitting must not change.
- Move date formatting must not change.
- Endpoint credentials must not be logged.
- Form lead creation must still treat CRM submission as the same side effect it is today.

## Suggested Tests

- Name splitting.
- Move date formatting.
- Payload construction from a representative form lead.
- Submit function with `fetch` mocked if the repo already uses a compatible pattern.

## Handoff To Next Agent

Report:

- Whether `api/services/crm.service.ts` remains a re-export facade.
- Whether CRM config still reads env at module load.
- Any sensitive logging concerns found during the move.

This task can run after `03-lead-services.md` or before `10-error-model-and-facades.md`.
