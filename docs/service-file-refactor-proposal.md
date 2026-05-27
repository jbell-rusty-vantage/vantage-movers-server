# Service File Refactor Proposal

## Purpose

This document proposes a granular refactor plan for the current large service files and nearby utilities:

- `api/services/v1.service.ts`
- `api/services/googleSheets.service.ts`
- `api/utils/`

It is a planning document only. It does not require code changes now. The intent is to make future edits safer by giving each business process and integration a clear home, while preserving the existing API behavior, Mongo collections, Google Sheets contracts, and Google Form workflows.

## Guiding Principles

- Keep the public route surface stable while moving internals.
- Prefer business-domain folders over generic `helpers` folders.
- Keep Mongo as the source of truth; CRM and Google Sheets remain side effects.
- Put mode-aware configuration in `api/config/`, not inside services.
- Keep row projection and sheet target resolution close to the Sheets integration, not in general utils.
- Keep routes thin: auth, validation, service call, response envelope.
- Extract in small stages with compatibility re-exports from `v1.service.ts` until routes are migrated.
- Do not split files just to reduce line count; split where ownership, testing, or production safety improves.

## Current Problem Shape

### `v1.service.ts`

`v1.service.ts` is currently the operational center for too many concerns:

- Form lead create/update, duplicate detection, CRM decision, call-lead form-fill marking.
- Call lead create/update, location derivation, CPL derivation, matching against form fills.
- Booking create/upsert/update/from-source, source lead resolution, customer creation, agent allocation, booking flag mirroring.
- Cancellation create/update/delete, booking and source lead consistency.
- Customer CRUD.
- List/find endpoints.
- Cascade deletes and sheet delete sequencing.
- Location, state, source company, object-id, duplicate-key, phone matching, and common input helpers.
- Background Google Sheets sync scheduling and sync persistence.

This makes it hard for an agent to know whether an edit is touching intake, booking graph consistency, sheet side effects, or generic domain helpers.

### `googleSheets.service.ts`

`googleSheets.service.ts` currently combines:

- Google auth client creation.
- Auth diagnostics and missing-config errors.
- Public sync/delete functions for each document type.
- Sheet target resolution for master/source/booked/cancelled/duplicate tabs.
- Tab creation and header maintenance.
- Row upsert, append, lookup, known-row verification, and delete.
- Sheet row projection for form leads, call leads, booked leads, and cancellations.
- Cell formatting and legacy trailing-cell cleanup.

This is a good integration boundary, but the file is doing adapter, coordinator, mapping, target config, and formatting work at the same time.

### `api/utils/`

Current utilities are mixed:

- `phone.ts` is a true shared domain utility.
- `pickupZipState.ts` and `stateNamesToCodes.ts` are location utilities with external HTTP behavior.
- `googleSheetsRanges.ts` and `googleSheetsDiagnostics.ts` belong to the Google Sheets integration.
- `sanitizeFormLeadForLog.ts` belongs to logging/PII sanitization.
- `ids.ts` is lead ID generation.
- `sheetRows.ts` looks stale or misplaced: current runtime sync builds rows inside `googleSheets.service.ts`, while this file exports older row formatting behavior and constants.

## Proposed Target Structure

This keeps `api/services/` as the service layer, but turns it into service-specific folders. It also introduces domain-specific config and utils folders without forcing a large framework-style architecture.

```text
api/
  config/
    domain.ts                         # temporary compatibility barrel
    domain/
      constants.ts                    # source companies, lead models, local types, tab names
      sources.ts                      # source labels, aliases, source normalization
      sheets.ts                       # sheet headers, target env var names, tab constants
      cpl.ts                          # CPL lookup and env-backed defaults
      runtime.ts                      # TEST_MODE, DB name, runtime sheet env var resolution
      googleAuth.ts                   # service-account env var selection only

  services/
    v1.service.ts                     # temporary compatibility barrel for current route imports
    errors/
      AppError.ts                     # future shared error base
      serviceErrors.ts                # NotFound, Conflict, BadRequest, ExternalService

    leads/
      formLead.service.ts             # create/update/find/delete FormLead use cases
      callLead.service.ts             # create/update/find/delete CallLead use cases
      sourceLeadLookup.service.ts     # getLinkedLead, resolveSourceLeadById
      duplicateLead.service.ts        # form duplicate and form_fill matching
      leadLocation.service.ts         # required/optional location resolution for leads
      leadSyncPolicy.ts               # when lead changes require sheet sync

    bookings/
      bookedLead.service.ts           # create/update/delete/list booked leads
      bookedLeadFromSource.service.ts # Google Form/source booking flow
      bookingSourceResolver.ts        # resolveBookingSourceLead, call lead phone/job matching
      bookingMirror.service.ts        # mirror booking flags to source leads
      bookingWarnings.ts              # zero binder warnings, booking-specific messages

    cancellations/
      cancelledLead.service.ts        # create/update/delete/list cancelled leads
      cancellationResolver.ts         # resolve booked lead for cancellation
      cancellationMirror.service.ts   # mirror cancellation state to booking/source lead

    customers/
      customer.service.ts             # customer CRUD and customer-from-lead upsert

    agents/
      agentAllocation.service.ts      # resolve/upsert/patch allocations
      agentName.ts                    # normalize agent names

    sheetSync/
      sheetSyncCoordinator.ts         # scheduleFullSheetSyncProcess, run process, log context
      sheetSyncPersistence.ts         # syncAndStore, merge sheet_sync entries
      sheetSyncJobs.ts                # FullSheetSyncJob types and constructors

    googleSheets/
      googleSheets.service.ts         # public facade: sync/delete/ensure tabs
      auth.ts                         # getSheetsClient and service account parsing
      targets.ts                      # master/source/booked/cancelled target builders
      syncRows.ts                     # syncRowToTargets and per-target result handling
      deleteRows.ts                   # deleteRowsFromTargets and delete target reconstruction
      rowLookup.ts                    # findRowNumberByMongoId, rowNumberContainsMongoId
      tabs.ts                         # ensureTabsAndHeaders, ensureTab, clear legacy cells
      projections/
        formLeadRow.ts
        callLeadRow.ts
        bookedLeadRow.ts
        cancelledLeadRow.ts
        cells.ts                      # date, timestamp, boolean/status/number formatting
      types.ts                        # SyncTarget, SheetTabConfig, sheet source types

    crm/
      crm.service.ts                  # existing Granot facade
      formLeadPayload.ts              # splitName, format move date, payload builder

  utils/
    phone.ts
    ids.ts
    objectId.ts                       # sameObjectId/objectIdToString if used outside one domain
    logging/
      sanitizeForLog.ts               # generic PII helpers
      sanitizeFormLeadForLog.ts       # compatibility or form-lead-specific wrapper
    location/
      pickupZipState.ts
      stateNamesToCodes.ts
    googleSheets/
      ranges.ts                       # moved from googleSheetsRanges.ts
      diagnostics.ts                  # moved from googleSheetsDiagnostics.ts
```

## `v1.service.ts` Refactor Plan

### Keep A Compatibility Barrel First

For the first phase, keep `api/services/v1.service.ts` as a facade that re-exports the same functions used by `api/routes/v1.routes.ts` and other services. This reduces route churn and lets each extraction be tested independently.

Target facade responsibilities:

- Export current route-facing functions.
- Export `V1ServiceError` or its replacement until routes switch to shared errors.
- Re-export sheet-sync scheduling functions used by enrichment/reconciliation services.
- Contain no business logic after migration.

### Proposed Extraction Groups

| Current Responsibility | Proposed Location | Notes |
| --- | --- | --- |
| `createFormLead`, `updateFormLead`, `findAllFormLeads`, `findFormLead`, `deleteFormLead` | `services/leads/formLead.service.ts` | Owns FormLead persistence and form-specific defaults. Calls duplicate and sheet sync services. |
| `createCallLead`, `updateCallLead`, `findAllCallLeads`, `deleteCallLead` | `services/leads/callLead.service.ts` | Owns CallLead persistence, form-fill flag, location/CPL updates. |
| `isDuplicateFormLead`, `hasFormFillForCallLead`, `markMatchingCallLeadsWithFormFill` | `services/leads/duplicateLead.service.ts` | Shared by form and call lead flows. Keep matching rules testable. |
| `resolveRequiredLocation`, `resolveOptionalLocation`, `deriveLocal`, `deriveFormLeadLocal`, `normalizeState` | `services/leads/leadLocation.service.ts` or `utils/location/leadLocation.ts` | Prefer service-local if only leads use it; promote later if scripts/reconciliation need it. |
| `getLinkedLead`, `resolveSourceLeadById` | `services/leads/sourceLeadLookup.service.ts` | Shared by booking, cancellation, sync, and delete flows. |
| `createBookedLead`, `updateBookedLead`, `deleteBookedLead`, `findAllBookedLeads` | `services/bookings/bookedLead.service.ts` | Owns booking lifecycle after source lead is known. |
| `createBookedLeadFromSource`, `resolveBookingSourceLead`, `effectiveBookingSourceCompany`, phone/job matching helpers | `services/bookings/bookedLeadFromSource.service.ts` and `bookingSourceResolver.ts` | This is a Google Form/business-process workflow and deserves its own file. |
| `deriveBookedLeadAgentAllocations`, `resolveAgentAllocations`, `upsertAgentByName`, `patchAgentAllocations`, `resolveTotalBinderAmount` | `services/agents/agentAllocation.service.ts` | Agent allocation is a subdomain of bookings but will be reused by historical repair and analytics concepts. |
| `createCancelledLead`, `updateCancelledLead`, `deleteCancelledLead`, `findAllCancelledLeads` | `services/cancellations/cancelledLead.service.ts` | Keep cancellation lifecycle independent from booking create/update. |
| `resolveBookedLeadForCancellation`, `getBookedLeadForCancellation` | `services/cancellations/cancellationResolver.ts` | Make conflict behavior obvious and testable. |
| `mirrorBookingToLead`, `refreshAttachedBookingFromLead`, `clearBookingFromLead` | `services/bookings/bookingMirror.service.ts` | Owns source lead flags derived from booking state. |
| `mirrorCancellationToLead`, `clearCancellationFromLead` | `services/cancellations/cancellationMirror.service.ts` | Owns source lead cancellation flags. |
| `createCustomer`, `updateCustomer`, `findAllCustomers`, `deleteCustomer`, `upsertCustomerFromLead` | `services/customers/customer.service.ts` | Include cascade delete only if it remains customer-owned; otherwise move cascade orchestration to a delete service. |
| `scheduleFullSheetSyncProcess`, `runFullSheetSyncProcess`, `syncBookingAndSource`, `syncSourceLead`, `syncAndStore` | `services/sheetSync/*` | This is the highest-value extraction because many services need sync without owning implementation. |
| `sameObjectId`, `objectIdToString` | `utils/objectId.ts` if reused, otherwise keep private in source lookup/mirror files | Do not create generic utils until there are multiple call sites. |
| `parseSourceCompany` | `config/domain/sources.ts` or `services/leads/sourceCompany.ts` | Since it throws service errors, keep a thin service wrapper over pure domain normalization. |

### Suggested Future Public Service API

The routes should eventually import from domain-specific facades instead of `v1.service.ts`:

```text
services/leads/formLead.service.ts
  createFormLead(input)
  updateFormLead(id, input)
  findAllFormLeads()
  findFormLead(id)
  deleteFormLead(id, options)

services/leads/callLead.service.ts
  createCallLead(input)
  updateCallLead(id, input)
  findAllCallLeads()
  deleteCallLead(id, options)

services/bookings/bookedLead.service.ts
  createBookedLead(input)
  createBookedLeadFromSource(input)
  updateBookedLead(id, input)
  findAllBookedLeads()
  deleteBookedLead(id, options)

services/cancellations/cancelledLead.service.ts
  createCancelledLead(input)
  updateCancelledLead(id, input)
  findAllCancelledLeads()
  deleteCancelledLead(id)

services/customers/customer.service.ts
  createCustomer(input)
  updateCustomer(id, input)
  findAllCustomers()
  deleteCustomer(id, options)
```

Use options objects for deletes over positional booleans:

```ts
deleteFormLead(id, { cascade: true })
deleteBookedLead(id, { cascade: true })
```

This makes future call sites safer and easier for agents to read.

## `googleSheets.service.ts` Refactor Plan

### Keep A Public Facade

Keep `services/googleSheets/googleSheets.service.ts` as the integration facade with the current public operations:

- `syncFormLeadToSheets`
- `syncCallLeadToSheets`
- `syncBookedLeadToSheets`
- `syncCancelledLeadToSheets`
- `deleteFormLeadFromSheets`
- `deleteCallLeadFromSheets`
- `deleteBookedLeadFromSheets`
- `deleteCancelledLeadFromSheets`
- `ensureAllConfiguredSheetTabs`

Then have `api/services/googleSheets.service.ts` temporarily re-export that facade so existing imports continue to work.

### Proposed Internal Modules

| Module | Owns | Should Not Own |
| --- | --- | --- |
| `auth.ts` | Sheets client cache, service account parsing, key-file fallback, one-time auth config logging. | Row projection, target decisions, sync logic. |
| `targets.ts` | Master/source/booked/cancelled target construction, tab/header lists, delete target reconstruction by `sheet_sync`. | Google API calls. |
| `syncRows.ts` | Per-target sync loop, result collection, target-level logging, calls to row upsert. | Row formatting or document-specific target choice. |
| `rowLookup.ts` | `Mongo ID` lookup, known row verification, row-number extraction behavior. | Header/tab creation. |
| `deleteRows.ts` | Delete sequencing and row lookup before delete. | Target construction rules. |
| `tabs.ts` | Ensure tabs, headers, legacy trailing-cell cleanup, add-sheet race handling. | Sync result persistence. |
| `projections/*.ts` | Convert typed documents to sheet rows. | Google API calls or env lookup. |
| `projections/cells.ts` | Date, timestamp, number, boolean/status, local, quoted, booked/cancelled cell formatting. | Business decisions about which targets receive a row. |
| `types.ts` | Sheet source input types, `SyncTarget`, `SheetTabConfig`. | Runtime behavior. |

### Sheet Projection Notes

Move these current functions into projection modules:

- `formLeadToRow` -> `projections/formLeadRow.ts`
- `callLeadToRow` -> `projections/callLeadRow.ts`
- `bookedLeadToRow` -> `projections/bookedLeadRow.ts`
- `cancelledLeadToRow` -> `projections/cancelledLeadRow.ts`
- `formatDateOnly`, `formatTimestamp`, `booleanCell`, `localCell`, `optionalLocalCell`, `bookedCell`, `bookedDateCell`, `overThresholdCell`, `cancelledCell`, `quotedCell`, `formatNumber`, `splitCell` -> `projections/cells.ts`

Do not move these into generic `api/utils/`. They are sheet presentation rules, not universal formatting rules.

### Target Resolution Notes

Move these current functions into `targets.ts`:

- `getLeadTargets`
- `getDeleteTargets`
- `deleteTargetKey`
- `getHeadersForSyncTarget`
- `getEnsureTabsForSyncTarget`
- `getMasterLeadsTabs`
- `getMasterBookedTabs`
- `getSourceLeadTabs`

This module should be the only place that knows names like `master_forms`, `source_forms`, `master_duplicates`, and `master_booked`.

### Row I/O Notes

Move these current functions into row I/O modules:

- `upsertRow`
- `findRowNumberByMongoId`
- `rowNumberContainsMongoId`
- `deleteSheetRow`
- `columnLetter`

`columnLetter` can stay private to row I/O unless other modules need it. `escapeSheetTitleForRange` and `extractRowNumberFromRange` already exist in utils and can move to `utils/googleSheets/ranges.ts`.

### Auth And Diagnostics Notes

`googleSheetsDiagnostics.ts` should move under `utils/googleSheets/diagnostics.ts` or `services/googleSheets/diagnostics.ts`. Since it interprets Google API errors and auth summaries, I prefer `services/googleSheets/diagnostics.ts` unless scripts also need it. If scripts need it, use `utils/googleSheets/diagnostics.ts`.

`auth.ts` should continue to enforce the current behavior: `SERVICE_ACCOUNT_LOCAL_FILE` is ignored in `TEST_MODE`.

## `api/config/` Refactor Plan

`api/config/domain.ts` is currently doing pure domain constants, env resolution, sheet config, source normalization, and CPL lookup. It should eventually become a compatibility barrel:

```ts
export * from "./domain/constants";
export * from "./domain/sources";
export * from "./domain/sheets";
export * from "./domain/cpl";
export * from "./domain/runtime";
export * from "./domain/googleAuth";
```

### Proposed Split

| New File | Contents |
| --- | --- |
| `config/domain/constants.ts` | `SOURCE_COMPANIES`, `LOCAL_TYPES`, `LEAD_MODELS`, `MOVE_SIZES`, `SHEET_SYNC_STATUSES`, type exports. |
| `config/domain/sources.ts` | `SOURCE_LABEL_TO_COMPANY`, `SOURCE_COMPANY_CONFIGS` aliases without env-derived CPL, source normalization helpers. |
| `config/domain/cpl.ts` | `getCplForSource` and env-derived CPL values. Consider lazy env reads instead of module-load constants. |
| `config/domain/sheets.ts` | `SHEET_TAB_NAMES`, sheet header arrays, sheet container env var names, target env var types. |
| `config/domain/runtime.ts` | `isTestMode`, `getMongoDatabaseName`, `MONGO_DATABASE_NAME`, `getRequiredEnv`, `getRuntimeSheetContainerEnvVar`. |
| `config/domain/googleAuth.ts` | `GOOGLE_SERVICE_ACCOUNT_ENV_VARS`, service-account env var selector functions. |

### Important Config Decision

Separate pure constants from environment reads. Pure constants are easy to import in tests and scripts. Runtime values should be resolved in one place and should be easy to log at startup or before a mutating script.

## `api/utils/` Refactor Plan

### Keep In Root Utils

- `phone.ts`: true shared utility used by models, search, enrichment, reconciliation, and lead services.
- `ids.ts`: keep here unless ID generation becomes lead-specific.
- `objectId.ts`: add only if object ID helpers are used by multiple service domains.

### Move Into Subfolders

```text
api/utils/location/
  pickupZipState.ts
  stateNamesToCodes.ts

api/utils/googleSheets/
  ranges.ts
  diagnostics.ts   # only if shared outside googleSheets service

api/utils/logging/
  sanitizeForLog.ts
  sanitizeFormLeadForLog.ts
```

### Review Or Remove

- `api/utils/sheetRows.ts` should be audited before moving. It currently exposes older form lead row formatting that does not match the newer status-string behavior in `googleSheets.service.ts`. If no runtime or script depends on `leadToSheetRow`, delete it during the refactor. If scripts need exported headers, expose headers from `api/config/domain/sheets.ts` instead.

## Recommended Extraction Order

### Phase 1: Low-Risk Preparatory Moves

1. Add tests or snapshots for sheet row projections before moving `googleSheets.service.ts`.
2. Create `services/googleSheets/projections/` and move cell/row builders first.
3. Create `services/googleSheets/targets.ts` and move target builders.
4. Keep `api/services/googleSheets.service.ts` as a re-export facade.
5. Audit and remove or replace `api/utils/sheetRows.ts`.

Why first: row projection and target resolution are pure or mostly pure. They are easier to test and reduce the largest integration file without touching service behavior.

### Phase 2: Extract Sheet Sync Coordination From `v1.service.ts`

1. Create `services/sheetSync/sheetSyncJobs.ts`.
2. Move `scheduleFullSheetSyncProcess`, `scheduleCallLeadSheetSync`, `scheduleBookingChainSheetSync`, `runFullSheetSyncProcess`, and `sheetSyncLogContext`.
3. Move `syncAndStore`, `syncSourceLead`, `syncBookingAndSource`, `syncSourceLeadById`, `syncBookingChainById`, and `syncCancellationChainById`.
4. Add request/run correlation fields to the job type later, but do not change behavior during the first move.

Why second: many domains depend on sync scheduling. Once this is independent, lead/booking/cancellation services can be extracted without circular ownership.

### Phase 3: Extract Lead Services

1. Move source lead lookup helpers.
2. Move duplicate/form-fill helpers.
3. Move location helpers.
4. Move form lead service.
5. Move call lead service.

Why third: bookings and cancellations depend on source lead lookup and source lead state.

### Phase 4: Extract Booking, Agent, Customer, Cancellation Services

1. Move agent allocation service and tests.
2. Move customer upsert and CRUD.
3. Move booking source resolver and booked-from-source workflow.
4. Move booked lead lifecycle.
5. Move cancellation resolver and cancelled lead lifecycle.
6. Move mirror services.

Why fourth: this area has the most graph consistency risk, so it should come after shared lookup/sync helpers are stable.

### Phase 5: Config Split And Error Model

1. Split `api/config/domain.ts` into a barrel after service imports are stable.
2. Introduce `AppError` and migrate `V1ServiceError` to compatibility mode.
3. Update route error mapping once services throw stable error types.

Why last: config imports are widely used. Error model changes affect route responses and tests, so they should happen after file ownership is clear.

## Testing Plan For The Refactor

Add tests around behavior before moving code:

- Sheet row projection tests for form, duplicate form, call, booked, and cancelled rows.
- Sheet target resolution tests for `TEST_MODE`, master/source targets, duplicate tabs, missing `not_provided` source sheet, and booked/cancelled targets.
- Lead location tests for unknown zip, same-state local, unknown form states, and optional call lead location.
- Booking agent allocation tests for split agents, duplicate normalized names, binder total mismatch, and zero binder warnings.
- Booking source resolver tests for call job-only, phone-only, phone+job, no match creates unmatched call lead, and source override.
- Cancellation resolver tests for booked ID, source lead ID, mismatch, already-cancelled booking, and missing booking.
- Sheet sync coordinator tests with mocked Google Sheets facade to verify job fan-out without touching real Sheets.

Run sequence during implementation:

```text
pnpm typecheck
pnpm test
```

For any integration smoke test that writes data, require explicit `TEST_MODE=true` and confirm selected database and sheet IDs first.

## Risks And Watchpoints

- Circular dependencies are the main risk. Avoid services importing broad facades from each other; import narrow helpers.
- Do not let `services/sheetSync` import route code or validation schemas.
- Do not let `services/googleSheets` import business lifecycle services. It should know how to sync passed documents, not when to sync them.
- Keep `bookedLeadFromSource` separate from generic booked lead creation because it contains Google Form and call-lead matching behavior.
- Keep historical scripts separate from runtime services unless a helper is pure and tested.
- Do not change sheet headers, tab names, or status cell text during file movement.
- Do not change CRM behavior during service extraction; handle CRM test gating as a separate config/error-handling task.

## Proposed End State

The end state should make the first place to look obvious:

- Lead intake issue: `services/leads/`
- Booking Google Form issue: `services/bookings/bookedLeadFromSource.service.ts`
- Agent split/binder issue: `services/agents/agentAllocation.service.ts`
- Cancellation issue: `services/cancellations/`
- Sheet row shape issue: `services/googleSheets/projections/`
- Sheet target/tab issue: `services/googleSheets/targets.ts`
- Sheet API failure issue: `services/googleSheets/auth.ts`, `tabs.ts`, `rowLookup.ts`, or `syncRows.ts`
- Background sync issue: `services/sheetSync/`
- Source company or sheet header issue: `config/domain/`
- Phone/location/log sanitization issue: `utils/phone.ts`, `utils/location/`, or `utils/logging/`

This layout should make future agent work faster because each folder corresponds to a business process or integration boundary, not just a technical layer.
