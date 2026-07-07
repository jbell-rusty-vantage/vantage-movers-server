# Lead Source Company Final Pass Handoff

## Context

This is the final completion pass for the `LeadSourceCompany` data-modeling work across:

- `vantage-main-server`
- `vantage-admin`
- `granot_sync_extensions_and_services`

The goal is to finish all remaining source-company integration work so the owner can push to `main` on all codebases.

Current branch state:

- `vantage-main-server`: still on `feature/lead-source-companies`
- `vantage-admin`: still on `feature/lead-source-companies`
- `granot_sync_extensions_and_services`: can be worked on `main`

Original handoff:

- `vantage-main-server/.cursor/lead-source-company-handoff.md`

Read that first for the first-pass model details, then use this document as the final-pass mission.

## What Changed In The Second Pass

The second pass audited backend, admin, and extension source assumptions and implemented several high-impact fixes.

Backend fixes already applied:

- `api/middleware/requireApiSecret.ts`
  - Scoped API keys now accept dynamic `company_slug` values.
  - Scoped API keys now support optional granularity scopes via `sourceGranularities`, `source_granularities`, `granularityKeys`, or `granularity_keys`.
  - Request scope extraction now checks `company_slug` before legacy `source_company`.
- `api/validation/v1/analytics.validation.ts`
  - Analytics query accepts `source_granularity_key`.
- `api/services/analytics/analyticsFilters.ts`
  - Lead analytics filters can match `source_granularity_key`.
  - Booked/cancelled analytics derive `source_granularity_key` from joined source leads.
  - Unknown dynamic source slugs no longer normalize to `not_provided`.
- `api/routes/ringcentral-webhook.routes.ts`
  - Webhook-normalized party events are enriched from the DB source catalog before candidate/session evaluation.
- `api/services/ringcentral/call-log-vetting.ts`
  - Call-log target detection now preserves an inbound target number even when it is not in the static map, allowing catalog resolution later.
- `api/services/ringcentral/call-log-sync.service.ts`
  - Call-log sync resolves target numbers through the DB catalog before rejecting unmatched target numbers.

Admin fixes already applied:

- `lib/api/facets.ts`
  - Production source-company options now come from `fetchLeadSourceCompanies()`.
  - Form/call CRM label options are built from catalog granularities.
  - `sourceGranularityOptions` are exposed for analytics.
- `components/operational/operational-resource-page.tsx`
  - Operational source filters/edit dropdowns use dynamic facet/catalog options where available.
  - Source label edit prefill now prefers `crm_source_label_snapshot` before legacy static helpers.
- `components/forms/booking-form.tsx`
  - Leadless/source-override source company picker uses active DB source companies, with referral preserved as a local special case.
- `components/analytics/analytics-dashboard.tsx`
  - Analytics UI includes `source_granularity_key` filter where relevant.

Verification already run after those edits:

- `vantage-admin`: `pnpm typecheck` passed.
- `vantage-main-server`: source-company resolver test passed.
- `vantage-main-server`: RingCentral focused tests passed:
  - `api/services/ringcentral/call-log-vetting.test.ts`
  - `api/services/ringcentral/call-candidate.test.ts`
- IDE lints reported no diagnostics on edited files.
- `vantage-main-server` full `pnpm typecheck` still fails only on known unrelated pre-existing issues:
  - `scripts/dev_ops/backfill-tbm-prime-updated-calls-via-api.ts`
  - `scripts/dev_ops/strip-markdown-to-txt.ts`

## Final Pass Goal

Make all applicable parts of the system conform to the new source-company model and prepare the codebases for mainline merge.

The next agent should prioritize correctness over adding more compatibility shims. If a path is now meant to be catalog-driven, make it catalog-driven and keep the legacy static source config only as a fallback for historical data and old payloads.

## Required Backend Work

### 1. Lead Update Resolver Triggers

Files:

- `api/services/leads/formLead.service.ts`
- `api/services/leads/callLead.service.ts`

Current gap:

- Update re-resolution triggers mostly when `source_company` changes or relation is missing.
- PATCH with only `company_slug`, `source_granularity_key`, or `source_company_site` can leave stale relation/snapshots/CPL.

Required:

- Re-run `resolveLeadSourceAssignment()` when any source-affecting field changes:
  - `source_company`
  - `company_slug`
  - `source_granularity_key`
  - `source_company_site`
  - relevant `local` changes
- Ensure CPL is recomputed from the resolved granularity.

### 2. Duplicate And Form-Fill Matching

Files:

- `api/services/leads/duplicateLead.service.ts`
- `api/services/ringcentral/ringcentral-duplicate-guard.ts`

Current gap:

- Duplicate/form-fill matching is still scoped by legacy `source_company` slug.

Required:

- Prefer `lead_source_company` relation when available.
- Fall back to `source_company` for historical/backfilled compatibility.
- Keep existing phone/email normalization behavior unchanged.

### 3. Booking And Leadless Source Resolution

Files to inspect and update:

- `api/services/bookings/bookingSourceResolver.ts`
- `api/services/bookings/bookedLead.service.ts`
- `api/services/bookings/bookedLeadFromSource.service.ts`
- `api/services/bookings/bookingMirror.service.ts`
- `api/services/bookings/leadlessBooking.service.ts`
- cancellation helpers only if source snapshots are affected

Current gaps:

- Unmatched call-lead bootstrap creates a `CallLead` with slug/CPL only.
- Booking source override writes `source_company` without relation/snapshot refresh.
- Booking mirror recomputes CPL from slug and ignores relation fields.
- Leadless booking source handling is not catalog-aware enough.

Required:

- Use `resolveLeadSourceAssignment()` whenever a booking workflow creates or mutates a source lead.
- Store canonical booking source labels consistently.
- Preserve existing booking/cancellation workflow behavior while making source fields relationally correct.

### 4. Enrichment, Reconciliation, And Granot CSV

Files to inspect and update:

- `api/services/enrichment/callLeadEnrichmentRows.ts`
- `api/services/enrichment/callLeadEnrichment.service.ts`
- `api/services/reconciliation/bookedCallLeadRows.ts`
- `api/services/reconciliation/bookedCallLeadReconciliation.service.ts`
- `api/services/granotCrmCsv/registry.ts`
- `api/models/GranotCrmSource.ts`

Current gaps:

- Granot row source labels resolve through static maps.
- Enrichment/reconciliation writes `source_company` only.
- Source compatibility checks compare slugs only.
- `GranotCrmSource` is not linked to catalog granularities.

Required:

- Resolve row `source` through `resolveLeadSource({ channel: "call", value: row.source })` where applicable.
- When source changes, write all assignment fields:
  - `source_company`
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Update CPL from the resolved granularity.
- Make source compatibility checks relation/granularity-aware with slug fallback.

### 5. Admin Browse/Search/Export/Facets

Files to inspect and update:

- `api/services/admin/adminBrowse.service.ts`
- `api/services/admin/adminSearch.service.ts`
- `api/services/admin/adminExport.service.ts`
- `api/services/admin/adminFacets.service.ts`
- `api/validation/v1/admin.validation.ts`
- `api/services/search/formLeadBrowse.service.ts`
- `api/services/search/callLeadBrowse.service.ts`
- `api/validation/v1/leads.validation.ts`

Required:

- Add exact `source_granularity_key` filtering where it is currently substring-based.
- Add `lead_source_company` and `source_granularity_key` filters to extension browse schemas/services.
- Add relation/snapshot fields to admin exports for form/call leads.
- Add snapshot fields to global admin search.
- Add useful granularity facet data, not just flat CRM source labels.

### 6. Analytics Completion

Files to inspect and update:

- `api/services/analytics/*`
- `api/services/admin/agentBrowseMetrics.service.ts`
- `api/services/analytics/analyticsExport.service.ts`

Current state:

- `source_granularity_key` filtering was added to core filters.
- Most reports still group by legacy company slug.
- Receiver-agent source label expressions still use static label helpers.

Required:

- Prefer snapshot labels in source display fields:
  - `crm_source_label_snapshot`
  - `source_granularity_label_snapshot`
  - `source_company_label_snapshot`
- Thread `source_granularity_key` into agent browse metrics.
- Add export columns where granularity filters/grouping are relevant.
- Decide whether to add parallel granularity reports or extend existing source-company reports with granularity fields.

### 7. Sheets Routing From DB Config

Files to inspect and update:

- `api/config/domain/runtime.ts`
- `api/services/googleSheets/targets.ts`
- `api/services/googleSheets/googleSheets.service.ts`
- `api/services/sheetSync/drainer/jobPlanner.ts`
- `api/services/googleSheets/types.ts`

Current gap:

- `LeadSourceCompany.sheet_config.spreadsheet_id` and `has_bad_tabs` are stored but not used for routing.

Required:

- Use DB `sheet_config` for per-source routing where possible.
- Fall back to env/static config for seeded legacy sources.
- Keep master sheet sync stable.
- Preserve row projection snapshot behavior, which is already partially correct.

### 8. Propagation Job

This is required before final merge if owners can edit labels/CPL.

Required behavior:

- Triggerable by owner from admin settings.
- Given a company/granularity change:
  - Rewrite existing lead snapshots.
  - Recompute CPL where the granularity CPL changed.
  - Enqueue sheet resyncs for affected leads.
  - Track progress/status/errors.

Recommended scope:

- Backend queued job or durable operation record.
- Admin UI button/status panel in Source Company settings.
- Safe to rerun.

## Required Admin Work

### 1. Settings Route UX Enhancement

The owner specifically wants the Settings route to be easier to use.

File:

- `vantage-admin/app/(dashboard)/settings/page.tsx`

Current state:

- Settings currently stacks multiple managers on one page.

Required:

- Convert Settings into a tabbed view with at least:
  - `Catalog`
  - `CPL Rate`
  - `Source Company`
- The owner should be able to switch between these easily without scrolling through all managers.

Suggested implementation:

- Add a small client component such as:
  - `components/settings/settings-tabs.tsx`
- Keep tab state in URL query or local component state.
- Ensure the active tab is visually clear.
- Keep layout consistent with the rest of `vantage-admin`.

Important product guidance:

- The `Source Company` tab is the new strategic home for source labels, granularities, CPL, aliases, RingCentral numbers, and sheet config.
- The `CPL Rate` tab is legacy/compatibility until consolidated.
- If time allows, make the CPL tab read-only or add a warning explaining that granular CPL is now managed under Source Company.

### 2. Source Company Manager Enhancements

File:

- `components/settings/source-company-manager.tsx`

Required improvements:

- Edit `sheet_config.spreadsheet_id`.
- Edit `sheet_config.has_bad_tabs`.
- Edit granularity `source_sites`.
- Edit granularity `sheet_tab_name`.
- Edit granularity `local` where relevant.
- Allow adding a new granularity to an existing company.
- Add explicit default form/call granularity selection instead of inferring first form/call.
- Add propagation trigger/status when backend support exists.
- Keep create/edit forms owner-friendly; avoid making the owner edit raw JSON.

### 3. Operational Display And Detail Polish

File:

- `components/operational/operational-resource-page.tsx`

Required:

- Display source columns using snapshot/catalog labels, not raw slugs where possible.
- Add a `Source metadata` detail section for form/call leads when fields exist:
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Ensure edit fields do not overwrite dynamic labels with legacy defaults.

### 4. Dashboard And Analytics Label Polish

Files:

- `components/dashboard/home-overview.tsx`
- `components/analytics/analytics-dashboard.tsx`
- `lib/api/facets.ts`

Required:

- Use catalog owner labels where available.
- Avoid showing raw slugs when a snapshot or catalog label exists.
- Keep `granularity` (time bucket) visually distinct from `source_granularity_key`.

### 5. CPL Manager Consolidation

Files:

- `components/settings/cpl-rate-manager.tsx`
- `lib/api/cplRates.ts`
- backend `api/services/cpl/cplRate.service.ts`

Required decision:

- Either keep the legacy CPL manager as compatibility/read-only, or fully align it with `LeadSourceCompany` granularities.
- Avoid two conflicting owner write paths for CPL.

## Required Granot Extension Work

Repo:

- `granot_sync_extensions_and_services`

Branch:

- Work can happen on `main`.

Required:

### 1. Form Fallback Source Map

Files:

- `src/workflows/form-leads/fallback-resolve.ts`
- tests under `src/test/*fallback*`

Current gap:

- `GRANOT_SOURCE_TO_COMPANY` is partial and case-sensitive.

Required:

- Replace or expand it to match backend label coverage:
  - Main Site Forms/Inbounds
  - GetMovers and Get Movers variants
  - Best Relocation and BestRelocation variants
  - TBM Prime Inbounds
  - existing TBM/Top10/10best labels
- Make lookup case-insensitive.
- Add tests for all important label families.

Preferred:

- Consume a lightweight backend source catalog endpoint if available.

### 2. Search Workspace Source Display

Files:

- `src/api/leadBrowse.ts`
- `src/entrypoints/popup/workspaces/search/render.ts`
- `src/entrypoints/popup/workspaces/search/actions.ts`

Required:

- Extend types for:
  - `lead_source_company`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Display snapshot labels instead of raw slugs.
- Clarify source filter behavior or replace free text with catalog dropdown when endpoint exists.

### 3. Call Enrichment/Reconciliation UX

Files:

- `src/entrypoints/popup/ui/leadMessaging.ts`
- `src/api/callLeads.ts`
- `src/workflows/call-leads/payloads.ts`

Required:

- Keep sending raw CRM `source` for compatibility.
- Broaden source mismatch detection to relation/snapshot field names:
  - `lead_source_company`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- Improve mismatch copy once backend returns richer parsed source metadata.

## Lightweight Catalog Endpoint

Strongly recommended for both admin and extension.

Backend route idea:

- `GET /api/v1/admin/source-companies/catalog`

Payload should be compact and owner/display friendly:

- company id
- `company_slug`
- `owner_label`
- aliases
- active
- sheet config summary if useful
- granularities:
  - id
  - `granularity_key`
  - channel
  - owner label
  - CRM label
  - aliases
  - active
  - CPL
  - local
  - source sites
  - inbound phone numbers
  - sheet tab name

Use it in:

- `vantage-admin` filters/dropdowns/display helpers.
- `granot_sync_extensions_and_services` source resolver/dropdowns.

## Verification Required Before Main

Backend:

- Add/extend tests for:
  - form lead create with legacy label
  - form lead create with `company_slug` + `source_granularity_key`
  - form lead update with only `source_granularity_key`
  - call lead create/update with granularity
  - duplicate/form-fill matching by relation
  - RingCentral DB-configured inbound number qualification
  - enrichment/reconciliation source assignment fields
  - booking unmatched call-lead source assignment
  - admin browse/export/search source fields
  - analytics `source_granularity_key` filters
  - propagation job
- Run focused tests.
- Run `pnpm typecheck`; if still blocked by unrelated `scripts/dev_ops` issues, either fix those or document why they are unrelated before merge.

Admin:

- `pnpm typecheck`
- Test Settings tabs manually.
- Test source-company create/edit.
- Test adding/editing granularities.
- Test operational filter/edit with a dynamic company.
- Test analytics source-company and source-granularity filters.

Extension:

- Run extension tests.
- Add fallback source tests for missing label families.
- Manual test:
  - fallback matching ambiguous form leads
  - search workspace source label display
  - call enrichment/reconciliation source mismatch copy

## Known Dirty Working Tree Warning

Both `vantage-main-server` and `vantage-admin` already contain many modified/untracked files from this feature branch. Do not revert unrelated work.

Recent second-pass touched files include:

Backend:

- `api/middleware/requireApiSecret.ts`
- `api/services/analytics/analyticsFilters.ts`
- `api/validation/v1/analytics.validation.ts`
- `api/routes/ringcentral-webhook.routes.ts`
- `api/services/ringcentral/call-log-vetting.ts`
- `api/services/ringcentral/call-log-sync.service.ts`

Admin:

- `lib/api/facets.ts`
- `components/operational/operational-resource-page.tsx`
- `components/forms/booking-form.tsx`
- `components/analytics/analytics-dashboard.tsx`

## Definition Of Done

This final pass is complete when:

- New owner-created source companies and granularities work across create/update, admin browse/edit/export/search, analytics, booking, enrichment/reconciliation, RingCentral, and sheets.
- Settings is tabbed and owner-friendly.
- Source Company settings can manage the full catalog shape needed by backend behavior.
- Existing lead snapshots can be propagated after label/CPL changes.
- Granot extension source matching/display no longer depends on a partial stale map.
- Tests and typechecks are clean enough to confidently merge/push to `main`.

