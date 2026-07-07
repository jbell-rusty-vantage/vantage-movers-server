# Lead Source Company Next Targeted Pass Handoff

## Context

This handoff is for one more targeted pass on the `LeadSourceCompany` production-readiness work across:

- `vantage-main-server`
- `vantage-admin`
- `granot_sync_extensions_and_services`

The working trees are intentionally very dirty. The owner expects the current feature work in `vantage-main-server` and `vantage-admin` to be committed together and merged into `main`. The Granot extension can remain on `main`.

Use this file as the continuation from:

- `vantage-main-server/.cursor/lead-source-company-handoff.md`
- `vantage-main-server/.cursor/lead-source-company-final-pass-handoff.md`

## What The Latest Pass Completed

### Backend

Files updated in the latest targeted pass:

- `api/services/leads/formLead.service.ts`
- `api/services/leads/callLead.service.ts`
- `api/services/leads/duplicateLead.service.ts`
- `api/services/ringcentral/ringcentral-duplicate-guard.ts`
- `api/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- `api/services/bookings/bookingSourceResolver.ts`
- `api/validation/v1/leads.validation.ts`
- `api/services/search/formLeadBrowse.service.ts`
- `api/services/search/callLeadBrowse.service.ts`
- `api/services/admin/adminExport.service.ts`
- `api/services/admin/adminSearch.service.ts`

Implemented:

- Form/call lead update paths now re-run `resolveLeadSourceAssignment()` when source-affecting fields change:
  - `source_company`
  - `company_slug`
  - `source_granularity_key`
  - `source_company_site`
  - location/local fields that affect source granularity selection
- Update paths recompute CPL from the resolved granularity when assignment refreshes.
- Duplicate/form-fill helpers now accept a relation-aware source scope and prefer `lead_source_company`, falling back to legacy `source_company`.
- Form lead create passes the resolved relation into duplicate and form-fill matching.
- Call lead create and RingCentral-created call leads pass the resolved relation into form-fill matching.
- RingCentral duplicate classification accepts `leadSourceCompany` and queries by relation first with slug fallback.
- RingCentral ingest resolves the catalog source before duplicate classification.
- Booking unmatched call-lead bootstrap now writes the full assignment fields:
  - `source_company`
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
  - `cpl`
- Extension browse schemas now accept:
  - `lead_source_company`
  - `source_granularity_key`
- Extension browse services now apply those filters.
- Admin CSV exports for form/call leads now include source relation and snapshot columns.
- Global admin search now searches source snapshot fields and prefers snapshot/catalog labels in secondary display.

### Admin

Files added/updated in the latest targeted pass:

- `app/(dashboard)/settings/page.tsx`
- `components/settings/settings-tabs.tsx`
- `components/settings/source-company-manager.tsx`
- `components/settings/cpl-rate-manager.tsx`

Implemented:

- Settings is now tabbed:
  - `Source Company`
  - `Catalog`
  - `CPL Rate`
- `Source Company` is the first/default tab.
- CPL tab is marked as legacy compatibility and points owners toward Source Company granularities for new CPL edits.
- Source Company manager now supports:
  - `sheet_config.spreadsheet_id`
  - `sheet_config.has_bad_tabs`
  - explicit `default_form_granularity_key`
  - explicit `default_call_granularity_key`
  - adding a granularity to an existing company
  - editing granularity key
  - editing granularity channel
  - editing granularity `local`
  - editing granularity `source_sites`
  - editing granularity `sheet_tab_name`
  - editing granularity aliases, inbound numbers, CPL, priority, active state

### Granot Extension

Files updated in the latest targeted pass:

- `src/workflows/form-leads/fallback-resolve.ts`
- `src/test/form-leads-fallback-resolve.test.ts`
- `src/api/formLeads.ts`
- `src/api/leadBrowse.ts`
- `src/entrypoints/popup/workspaces/search/render.ts`
- `src/api/callLeads.ts`
- `src/entrypoints/popup/ui/leadMessaging.ts`
- `src/test/lead-messaging.test.ts`

Implemented:

- Form fallback source lookup is now case-insensitive.
- Fallback map now covers:
  - Main Site Forms/Inbounds
  - GetMovers and Get Movers variants
  - Best Relocation and BestRelocation variants
  - TBM Prime Inbounds
  - existing TBM, Top10, and 10best labels
- Form fallback search match types now carry source relation/snapshot fields.
- Search workspace browse types now carry:
  - `lead_source_company`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Search result cards now display source labels in this precedence:
  - `crm_source_label_snapshot`
  - `source_granularity_label_snapshot`
  - `source_company_label_snapshot`
  - `source_company`
- Call enrichment/reconciliation result types now carry source relation/snapshot fields.
- Source mismatch detection now watches:
  - `source_company`
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Mismatch copy now references the matched Vantage source and can show returned snapshot/granularity labels.

## Verification From Latest Pass

Passed:

- `vantage-admin`: `pnpm typecheck`
- `granot_sync_extensions_and_services`: `pnpm compile`
- `granot_sync_extensions_and_services`: focused tests
  - `pnpm test -- src/test/form-leads-fallback-resolve.test.ts src/test/lead-messaging.test.ts`
  - Result: 15 files passed, 144 tests passed
- `vantage-main-server`: RingCentral duplicate guard focused test
  - `node --import tsx --import ./scripts/test-setup.ts --test "api/services/ringcentral/ringcentral-duplicate-guard.test.ts"`
  - Result: 9 tests passed
- IDE diagnostics reported no linter errors on latest edited files.

Still blocked:

- `vantage-main-server`: `pnpm typecheck` still fails only on known unrelated `scripts/dev_ops` issues:
  - `scripts/dev_ops/backfill-tbm-prime-updated-calls-via-api.ts`
    - missing `./google_sheets/google-sheets-auth`
    - implicit `any` parameters
  - `scripts/dev_ops/strip-markdown-to-txt.ts`
    - `import.meta` not allowed under current CommonJS output

These are the same unrelated typecheck blockers documented in prior handoffs.

## Highest Priority Remaining Work

The next pass should focus on the remaining deeper production-readiness items. Avoid broad refactors. Prefer small, verifiable changes that complete one surface at a time.

### 1. Enrichment And Reconciliation Source Assignment

Files:

- `api/services/enrichment/callLeadEnrichmentRows.ts`
- `api/services/enrichment/callLeadEnrichment.service.ts`
- `api/services/reconciliation/bookedCallLeadRows.ts`
- `api/services/reconciliation/bookedCallLeadReconciliation.service.ts`

Current gap:

- Row parsing still maps CRM source labels to static slugs.
- Lead updates still write `source_company` only.
- Source compatibility checks are slug-only.
- CPL recompute still uses static slug helpers.

Required:

- Resolve CRM row source via catalog:
  - `resolveLeadSource({ channel: "call", value: row.source })`
  - or `resolveLeadSourceAssignment({ channel: "call", value: row.source })` where assignment fields are needed.
- When enrichment/reconciliation changes a call lead source, write all assignment fields:
  - `source_company`
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Recompute CPL from the resolved granularity.
- Make compatibility checks relation/granularity-aware with legacy slug fallback.
- Preserve existing phone/job matching semantics.

Suggested approach:

- Add a parsed row source object beside the current `source_company`.
- Keep legacy `source_company` on parsed rows for compatibility, but use catalog resolution when writing.
- Update mismatch/warning messages to include CRM label and matched Vantage snapshot/granularity label where possible.
- Extend existing reconciliation tests:
  - `api/services/reconciliation/bookedCallLeadReconciliation.service.test.ts`

### 2. Booking Override And Mirror Completion

Files:

- `api/services/bookings/bookedLeadFromSource.service.ts`
- `api/services/bookings/bookingMirror.service.ts`
- `api/services/bookings/leadlessBooking.service.ts`
- `api/services/bookings/bookedLead.service.ts`

Current state:

- Unmatched call-lead bootstrap was fixed in `bookingSourceResolver.ts`.
- Other booking source override/mirror paths still need confirmation and likely catalog assignment.

Required:

- If a booking workflow mutates an attached source lead's source, apply full assignment fields rather than only `source_company`.
- Booking mirror should recompute source-lead CPL from resolved granularity when source changes.
- Leadless booking should store canonical owner/CRM labels consistently.
- `BookedLead.source` should prefer a human/canonical source label, not raw slugs, where owner-facing behavior expects labels.

### 3. Operational Source Display And Detail Metadata

Repo: `vantage-admin`

File:

- `components/operational/operational-resource-page.tsx`

Required:

- Source columns should display labels in this precedence:
  - `crm_source_label_snapshot`
  - `source_granularity_label_snapshot`
  - `source_company_label_snapshot`
  - catalog lookup
  - raw slug fallback
- Add a `Source metadata` section for form/call lead detail when fields exist:
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Add/confirm operational source granularity filter if backend admin browse supports it.
- Ensure edit fields do not replace dynamic labels with legacy static defaults.

### 4. Analytics Label And Granularity Polish

Backend files:

- `api/services/analytics/leadCost.service.ts`
- `api/services/analytics/sourcePerformance.service.ts`
- `api/services/analytics/overview.service.ts`
- `api/services/analytics/cancellationAnalytics.service.ts`
- `api/services/analytics/receiverAgentPerformance.service.ts`
- `api/services/admin/agentBrowseMetrics.service.ts`
- `api/services/analytics/analyticsExport.service.ts`

Admin files:

- `components/analytics/analytics-dashboard.tsx`
- `components/dashboard/home-overview.tsx`
- `lib/api/facets.ts`

Required:

- Prefer snapshot labels in source display fields:
  - `crm_source_label_snapshot`
  - `source_granularity_label_snapshot`
  - `source_company_label_snapshot`
- Add or expose source granularity dimensions where reports currently group only by slug.
- Thread `source_granularity_key` into agent browse metrics.
- Add analytics export columns where source granularity filters/grouping are relevant.
- In UI, keep time `granularity` visually distinct from `source_granularity_key`.

### 5. Admin Facets And Exact Granularity Filtering

Backend files:

- `api/services/admin/adminBrowse.service.ts`
- `api/services/admin/adminFacets.service.ts`
- `api/validation/v1/admin.validation.ts`

Current state:

- Admin browse already includes `source_granularity_key` in string filters.
- It may still be substring-based through generic `orContains`.

Required:

- Make `source_granularity_key` an exact match filter.
- Ensure `lead_source_company` ObjectId filter is accepted and safe.
- Admin facets should expose useful source company + granularity data, not only flat CRM labels.

### 6. DB-Driven Sheet Routing

Files:

- `api/config/domain/runtime.ts`
- `api/services/googleSheets/targets.ts`
- `api/services/googleSheets/googleSheets.service.ts`
- `api/services/sheetSync/drainer/jobPlanner.ts`
- `api/services/googleSheets/types.ts`

Current gap:

- `LeadSourceCompany.sheet_config.spreadsheet_id`, `sheet_config.has_bad_tabs`, and granularity `sheet_tab_name` are editable/stored but not fully used for routing.

Required:

- Use DB `sheet_config` for per-source routing where possible.
- Use granularity `sheet_tab_name` for source-specific tabs where possible.
- Fall back to env/static config for seeded legacy sources.
- Preserve master-sheet sync behavior.
- Preserve row projection snapshot behavior.

Important:

- This likely requires async target planning. Avoid turning small sync helpers into ad hoc DB readers without tracing sheet-sync drainer behavior.

### 7. Propagation Job

This remains the largest merge-readiness gap if owners can edit labels or CPL before/after production push.

Required behavior:

- Owner-triggerable from Source Company settings.
- Given a company or granularity change:
  - Rewrite existing lead snapshots.
  - Recompute CPL where granularity CPL changed.
  - Enqueue sheet resyncs for affected leads.
  - Track progress/status/errors.
  - Safe to rerun.

Suggested backend files:

- New service:
  - `api/services/leadSourceCompanies/sourcePropagation.service.ts`
- Existing route integration:
  - `api/routes/v1.routes.ts`
- Sheet sync reuse:
  - `api/services/sheetSync/sheetSyncOutbox.service.ts`
  - `api/services/sheetSync/drainer/jobPlanner.ts`

Suggested admin files:

- `components/settings/source-company-manager.tsx`
- `lib/api/sourceCompanies.ts`
- `lib/query/keys.ts`

### 8. Granot CSV Catalog Link

Files:

- `api/services/granotCrmCsv/registry.ts`
- `api/models/GranotCrmSource.ts`

Current gap:

- `GranotCrmSource` still stores source labels/slugs without catalog relation.

Required:

- Add catalog relation fields if useful:
  - `lead_source_company`
  - `source_granularity_key`
  - possibly `source_granularity_id`
- Seed/update registry entries from catalog where possible.
- Preserve upload behavior and existing workspace slug behavior.

## Suggested Next Pass Order

1. Enrichment/reconciliation assignment and tests.
2. Booking override/mirror completion.
3. Operational source display/detail metadata.
4. Admin exact granularity filtering/facets.
5. Analytics source label/granularity polish.
6. DB sheet routing.
7. Propagation job.
8. Granot CSV catalog relation.

If time is limited, prioritize items 1-4 first. They are the most likely to affect day-to-day correctness after merge.

## Recommended Verification For Next Pass

Backend:

- Focused tests for:
  - form lead update with only `source_granularity_key`
  - call lead update with only `source_granularity_key`
  - duplicate/form-fill matching by relation
  - booking unmatched call-lead source assignment
  - enrichment/reconciliation source assignment fields
  - admin browse exact `source_granularity_key`
  - admin export/search source snapshot fields
- Run:
  - `node --import tsx --import ./scripts/test-setup.ts --test "api/services/leadSourceCompanies/leadSourceCompany.service.test.ts"`
  - `node --import tsx --import ./scripts/test-setup.ts --test "api/services/ringcentral/ringcentral-duplicate-guard.test.ts"`
  - any added enrichment/reconciliation/booking/admin tests
  - `pnpm typecheck`
- If `pnpm typecheck` still fails only on `scripts/dev_ops`, document that explicitly.

Admin:

- `pnpm typecheck`
- Manual Settings check:
  - switch tabs
  - edit source company sheet config
  - add/edit granularity
  - set default form/call granularity
- Manual operational check:
  - source labels show snapshots/catalog labels
  - detail panel shows Source metadata
  - edit prefill preserves dynamic labels

Extension:

- `pnpm compile`
- `pnpm test`
- Manual check:
  - ambiguous form fallback with Main Site/Get Movers/Best Relocation/TBM Prime labels
  - search workspace source labels use snapshots
  - call mismatch copy reacts to relation/snapshot fields

## Known Dirty Working Tree Reminder

Do not revert unrelated changes. Many files were already modified/untracked before the latest pass, including the original model implementation and second-pass fixes.

Current latest-pass additions include:

- `vantage-admin/components/settings/settings-tabs.tsx`
- this handoff file

The full dirty tree spans many files in all three repos. Treat it as feature work to be committed together unless the owner says otherwise.

