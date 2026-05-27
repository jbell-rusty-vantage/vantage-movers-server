# 08 Validation Refactor

## Purpose

Split `api/validation/v1.validation.ts` into domain-specific validation modules while preserving all exported schema and type names.

This should happen after service folders exist, so validation modules can mirror the domain boundaries without leading the architecture.

## Read First

- `api/validation/v1.validation.ts`
- `api/validation/v1.validation.test.ts`
- `api/routes/v1.routes.ts`
- `api/config/domain.ts`
- new service folders if available

## Current Responsibilities

`v1.validation.ts` currently owns:

- Shared scalar schemas: object IDs, source company strings, local type, lead model, move size, zip, dates, numbers, money, booleans.
- Shared refinement helpers: at least one field, search identity, call lead identity, call booking identity, binder total match.
- Form lead create/update/search schemas.
- Call lead create/update/search schemas.
- Call lead enrichment batch schemas.
- Booked call lead reconciliation batch schemas.
- Booked lead create/from-source/update schemas.
- Cancelled lead create/update schemas.
- Customer create/update schemas.
- Exported inferred input types for all route/service calls.

## Target Files

```text
api/validation/
  v1.validation.ts
  v1/
    common.ts
    leads.validation.ts
    bookings.validation.ts
    cancellations.validation.ts
    customers.validation.ts
    operations.validation.ts
```

Suggested ownership:

- `common.ts`: scalar schemas and generic refinements.
- `leads.validation.ts`: form lead and call lead create/update/search.
- `bookings.validation.ts`: booked lead and booked-from-source schemas, agent allocation input, binder total match.
- `cancellations.validation.ts`: cancellation schemas.
- `customers.validation.ts`: customer schemas.
- `operations.validation.ts`: enrichment and reconciliation batch schemas.
- `v1.validation.ts`: compatibility barrel exporting the same names as today.

## Public API To Preserve

Do not rename exported schemas or types:

- `objectIdSchema`
- `sourceCompanySchema`
- `localSchema`
- `leadModelSchema`
- `moveSizeSchema`
- all `create*Schema`, `update*Schema`, and `search*Schema` exports
- `callLeadEnrichmentBatchSchema`
- `bookedCallLeadReconciliationBatchSchema`
- all exported `*Input` and row input types

## Agent Instructions

1. Move common scalar schemas first.
2. Move lead schemas and types second.
3. Move booking schemas third.
4. Move cancellation and customer schemas fourth.
5. Move operational batch schemas last.
6. Keep `api/validation/v1.validation.ts` as a compatibility barrel.
7. Do not change Zod strictness, defaults, coercion, regexes, min/max values, or refinement messages.
8. Update tests only for import paths if needed.
9. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Form lead defaults must remain the same: `source_company`, `ref_no`, `crm_company_label`, and `post_to_granot`.
- Call lead create must still require `phone_number` or `job_no`.
- Booked-from-source discriminated union must stay keyed by `lead_type`.
- Booked-from-call must still require `call_job_no` or `call_phone_number`.
- Binder total refinement must remain unchanged.
- Cancellation create must still require `booked_lead` or `lead_id`.
- Batch sizes must remain min 1 and max 100.

## Suggested Tests

Use existing validation tests as the safety net. Add narrow tests only if a moved refinement was not previously covered:

- Boolean string preprocessing.
- Booked-from-source discriminated union.
- Binder total mismatch.
- Enrichment/reconciliation batch max size.

## Handoff To Next Agent

Report:

- Whether routes still import only from `api/validation/v1.validation.ts`.
- Which new validation modules map to which service folders.
- Any duplicated refinement helper that should be moved back into `common.ts`.

The next agent should split `api/config/domain.ts` using the same compatibility-barrel approach.
