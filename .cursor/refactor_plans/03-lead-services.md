# 03 Lead Services Refactor

## Purpose

Extract form lead, call lead, source lookup, duplicate matching, and lead location behavior from `api/services/v1.service.ts` into `api/services/leads/`.

This task should happen after `services/sheetSync/` exists, because lead services schedule sheet syncs but should not own sync implementation.

## Read First

- `api/services/v1.service.ts`
- `api/models/FormLead.ts`
- `api/models/CallLead.ts`
- `api/validation/v1.validation.ts`
- `api/utils/phone.ts`
- `api/utils/pickupZipState.ts`
- `api/config/domain.ts`
- `api/services/sheetSync/` if already created

## Current Functions To Extract

Form lead lifecycle:

- `createFormLead`
- `updateFormLead`
- `findAllFormLeads`
- `findFormLead`
- `deleteFormLead`

Call lead lifecycle:

- `createCallLead`
- `updateCallLead`
- `findAllCallLeads`
- `deleteCallLead`

Shared lead helpers:

- `resolveRequiredLocation`
- `resolveOptionalLocation`
- `deriveLocal`
- `deriveFormLeadLocal`
- `normalizeState`
- `parseSourceCompany`
- `isDuplicateFormLead`
- `hasFormFillForCallLead`
- `markMatchingCallLeadsWithFormFill`
- `findBestCallLeadMatchByPhone`
- `compareCallLeadRecency`
- `getCallLeadTime`
- `buildPhoneRegex`
- `getLinkedLead`
- `resolveSourceLeadById`

## Target Files

```text
api/services/leads/
  formLead.service.ts
  callLead.service.ts
  sourceLeadLookup.service.ts
  duplicateLead.service.ts
  leadLocation.service.ts
  leadSourceCompany.ts
  leadPhoneMatching.ts
  index.ts
```

Suggested ownership:

- `formLead.service.ts`: form lead create/update/find/delete and CRM decision call if still colocated.
- `callLead.service.ts`: call lead create/update/find/delete and form-fill updates.
- `sourceLeadLookup.service.ts`: model-aware source lead lookups used by bookings, cancellations, deletes, and sync.
- `duplicateLead.service.ts`: form duplicate detection and form-fill matching.
- `leadLocation.service.ts`: zip/state normalization and local/long-distance derivation.
- `leadSourceCompany.ts`: service-level wrapper that converts unknown source values to `V1ServiceError` or future `AppError`.
- `leadPhoneMatching.ts`: phone regex and best-match helpers.

## Compatibility Exports

Keep these exported from `api/services/v1.service.ts` until routes migrate:

- `createFormLead`
- `updateFormLead`
- `findAllFormLeads`
- `findFormLead`
- `deleteFormLead`
- `createCallLead`
- `updateCallLead`
- `findAllCallLeads`
- `deleteCallLead`

Also keep any helpers that other current services import from `v1.service.ts`, especially sheet sync scheduling, until their own refactor docs migrate those imports.

## Agent Instructions

1. Move shared lead helpers first: source lookup, duplicate matching, location, and phone matching.
2. Move form lead lifecycle after duplicate and location helpers compile.
3. Move call lead lifecycle after form-fill helpers compile.
4. Keep `V1ServiceError` available from the existing service facade; do not introduce the full error model in this task.
5. Keep CRM submission behavior exactly as it is, even if the code remains a dependency of `formLead.service.ts`.
6. Keep delete cascade behavior unchanged; if delete code needs booking/customer helpers, use compatibility imports and leave deeper cleanup for later docs.
7. Re-export moved route-facing functions from `v1.service.ts`.
8. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Form lead duplicate detection must still mark duplicate form rows correctly.
- Creating a form lead must still optionally post to Granot CRM according to current inputs.
- Call leads must still require phone or job identity at validation level.
- Lead location and local/long-distance derivation must not change.
- `source_company` parsing must still reject unsupported values through the service error path.
- Sheet sync scheduling must happen at the same points as before.

## Suggested Tests

Focus tests on pure helpers and service outcomes:

- Source label and alias parsing.
- Required and optional location resolution.
- Form duplicate detection.
- Call lead form-fill matching by normalized phone.
- Delete cascade behavior for form and call leads.

## Handoff To Next Agent

Report:

- Which lead helpers are now safe to import from `services/leads/`.
- Whether `sourceLeadLookup.service.ts` is ready for booking and cancellation agents.
- Any code still left in `v1.service.ts` because it depends on booking or cancellation extraction.

The next agent should extract booking, agent, and customer services using the lead lookup helpers from this task.
