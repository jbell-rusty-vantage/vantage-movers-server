# Refactor Plans Index

This folder breaks the service, utility, validation, and configuration refactor into bounded agent handoffs. Each document is intended to be usable as a standalone prompt for one agent, while still preserving the overall migration order.

## Goal

Reassemble the current large service and support files into clear modules without changing public API behavior, Mongo schemas, Google Sheets contracts, CRM behavior, or Google Form workflows.

Primary source files:

- `api/services/v1.service.ts`
- `api/services/googleSheets.service.ts`
- `api/services/*.service.ts`
- `api/utils/*`
- `api/validation/v1.validation.ts`
- `api/config/domain.ts`

Reference planning docs:

- `docs/refactor-and-agentic-documentation-plan.md`
- `docs/service-file-refactor-proposal.md`

## Agent Smart Zone Rule

Keep each handoff under about 300k input tokens. Do not give an agent the whole repo unless the task requires it. For each task, provide only:

- This index.
- The specific plan document for the unit.
- The files listed in that plan's "Read First" section.
- Any tests listed in that plan.

## Recommended Execution Order

1. `01-google-sheets-service.md`
2. `02-sheet-sync-coordinator.md`
3. `03-lead-services.md`
4. `04-booking-agent-customer-services.md`
5. `05-cancellation-services.md`
6. `06-search-enrichment-reconciliation-services.md`
7. `07-utils.md`
8. `08-validation.md`
9. `09-configuration.md`
10. `11-crm-service.md`
11. `10-error-model-and-facades.md`

The order is intentionally conservative: extract pure Sheets and sync pieces first, then business services, then validation/config/error cleanup after import ownership is clearer.

`11-crm-service.md` can run after the lead-service extraction or near the end. It is numbered separately because the existing CRM file is already small, but it deserves its own handoff so CRM payload and secret-handling behavior do not get mixed into form lead movement.

## Universal Handoff Instructions

Every implementation agent should follow these rules:

- Preserve current route contracts and exported function names unless the plan explicitly says to update imports.
- Keep compatibility barrels during migration, especially `api/services/v1.service.ts`, `api/services/googleSheets.service.ts`, and `api/config/domain.ts`.
- Do not change sheet headers, tab names, CRM payload fields, Mongo model names, or validation semantics during file movement.
- Do not introduce production writes as part of tests or smoke checks.
- Prefer moving code first, then improving names or abstractions in a later pass.
- Run `pnpm typecheck` and `pnpm test` when the task is large enough to affect imports or behavior.
- If a task uncovers stale code, document it in the plan or PR notes before deleting it.

## Target Folder Shape

```text
api/
  config/
    domain.ts
    domain/
      constants.ts
      sources.ts
      sheets.ts
      cpl.ts
      runtime.ts
      googleAuth.ts
  services/
    v1.service.ts
    errors/
    leads/
    bookings/
    cancellations/
    customers/
    agents/
    sheetSync/
    googleSheets/
    crm/
  utils/
    phone.ts
    ids.ts
    objectId.ts
    location/
    googleSheets/
    logging/
  validation/
    v1.validation.ts
    v1/
      common.ts
      leads.validation.ts
      bookings.validation.ts
      cancellations.validation.ts
      customers.validation.ts
      operations.validation.ts
```

## Stop Conditions

An agent should stop and report back instead of pushing through if:

- Moving a module requires changing route behavior.
- A circular dependency appears between service folders.
- A test requires real Google Sheets, CRM, or production Mongo writes.
- Sheet output differs only because code was moved.
- The task grows beyond the intended file set.
