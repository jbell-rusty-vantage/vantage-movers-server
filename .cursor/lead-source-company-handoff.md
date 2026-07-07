# Lead Source Company Handoff

## Context

This branch introduces a new DB-backed `LeadSourceCompany` model so source companies and their Form/Call label granularities can become first-class owner-managed entities instead of a closed static enum.

The target architecture is:

- `LeadSourceCompany` is authoritative for source company identity, owner labels, aliases, active/archive state, sheet metadata, and child Form/Call granularities.
- Each Form/Call granularity owns channel-specific behavior: owner label, exact CRM label, aliases, CPL, matching conditions, inbound RingCentral numbers, active state, and priority.
- `FormLead` and `CallLead` now store relational source fields in addition to legacy-compatible snapshots:
  - `lead_source_company`
  - `source_granularity_id`
  - `source_granularity_key`
  - `source_company_label_snapshot`
  - `source_granularity_label_snapshot`
  - `crm_source_label_snapshot`
- The old `source_company` string remains for compatibility, but new code should prefer resolving/loading through the relation and granularity.

## Branches

Both repos are on:

- `feature/lead-source-companies`

Repos touched:

- `vantage-main-server`
- `vantage-admin`

The Granot extension repo has not yet been updated in this unit.

## Backend Work Completed

Key new files:

- `api/models/LeadSourceCompany.ts`
- `api/services/leadSourceCompanies/leadSourceCompany.service.ts`
- `api/services/leadSourceCompanies/index.ts`
- `api/services/leadSourceCompanies/leadSourceCompany.service.test.ts`
- `scripts/migrations/backfill-lead-source-companies.ts`

Important modified files:

- `api/models/FormLead.ts`
- `api/models/CallLead.ts`
- `api/models/schemaHelpers.ts`
- `api/services/leads/formLead.service.ts`
- `api/services/leads/callLead.service.ts`
- `api/services/leads/leadSourceCompany.ts`
- `api/config/domain/cpl.ts`
- `api/config/domain/sources.ts`
- `api/config/domain/runtime.ts`
- `api/services/cpl/cplRate.service.ts`
- `api/services/admin/adminBrowse.service.ts`
- `api/services/admin/adminFacets.service.ts`
- `api/services/googleSheets/*`
- `api/services/ringcentral/*`
- `api/services/search/*Browse.service.ts`
- `api/routes/v1.routes.ts`
- `api/validation/v1/admin.validation.ts`
- `api/validation/v1/leads.validation.ts`

Backend API added:

- `GET /api/v1/admin/source-companies`
- `GET /api/v1/admin/source-companies/:id`
- `POST /api/v1/admin/source-companies`
- `PATCH /api/v1/admin/source-companies/:id`

Current seeding behavior:

- `ensureLeadSourceCompaniesSeeded()` creates known current companies from `SOURCE_COMPANY_CONFIGS` and current granular CPL definitions.
- Seeded companies include:
  - `tbm_leads`
  - `tbm_prime_leads`
  - `top10_leads`
  - `best_relocation_leads`
  - `get_movers_leads`
  - `main_site`
- `not_provided` is preserved as a compatibility input and resolves to `main_site` defaults.
- Known RingCentral inbound numbers are seeded onto matching Call granularities.

Migration/backfill:

- Command: `pnpm db:backfill-lead-source-companies`
- Script: `scripts/migrations/backfill-lead-source-companies.ts`
- This seeds the catalog, then backfills existing `FormLead` and `CallLead` records missing relation/snapshot fields.
- It has already been run against the configured DB in this workspace.
- First successful pass:
  - Form leads: `0` candidates, `0` updated, `0` failed
  - Call leads: `300` updated, `0` failed
- Second pass:
  - Form leads: `0` candidates
  - Call leads: `0` candidates
  - `0` failed

## Admin Work Completed

Key new files:

- `vantage-admin/components/settings/source-company-manager.tsx`
- `vantage-admin/lib/api/sourceCompanies.ts`

Important modified files:

- `vantage-admin/app/(dashboard)/settings/page.tsx`
- `vantage-admin/lib/api/facets.ts`
- `vantage-admin/lib/query/keys.ts`

Current admin behavior:

- Settings page shows a `Lead Source Companies` manager.
- Owner can create a source company with a default Form granularity and default Call granularity.
- Owner can edit:
  - Company name
  - Owner label
  - Company aliases
  - Granularity owner labels
  - Granularity CRM labels
  - Granularity CPL
  - Granularity aliases
  - Granularity inbound RingCentral numbers
  - Granularity active/inactive state
  - Company active/inactive state
- Production facets now call backend facets instead of hardcoded production source arrays.

## Verification Already Run

Backend focused resolver test:

```bash
node --import tsx --import ./scripts/test-setup.ts --test "api/services/leadSourceCompanies/leadSourceCompany.service.test.ts"
```

Result: passed.

Admin typecheck:

```bash
pnpm typecheck
```

Result: passed in `vantage-admin`.

Backend typecheck:

```bash
pnpm typecheck
```

Current result: fails only on pre-existing unrelated `scripts/dev_ops` TypeScript issues:

- `scripts/dev_ops/backfill-tbm-prime-updated-calls-via-api.ts`
- `scripts/dev_ops/strip-markdown-to-txt.ts`

No IDE lint diagnostics were reported on edited files.

## Important Caveats

This was the first implementation pass. It establishes the model, resolver, core write paths, admin CRUD, and backfill. It does not fully complete every integration surface in the large system.

Known caveats for the next agent:

- Static `SOURCE_COMPANIES` and helpers still exist as compatibility fallbacks. New code should continue migrating away from them.
- Some analytics, booking/cancellation source resolution, enrichment/reconciliation, and export paths may still primarily operate on `source_company` strings or legacy labels.
- Google Sheets target selection is still mostly synchronous and slug-based. It is safe for master-sheet sync and legacy per-source sheets, but DB-configured per-source spreadsheet routing still needs deeper async integration.
- Label rename propagation jobs are not fully implemented yet. The admin UI can edit labels/CPL, but a dedicated queued propagation job for snapshot rewrites and sheet resync should be built.
- Granularity aliases should be audited against every legacy accepted label. The current seed covers canonical CPL labels and company aliases, but the next pass should verify all labels from existing ingestion/reconciliation/extension workflows.
- Scoped API keys were not deeply refactored yet. Company/granularity-scoped key enforcement still needs an explicit pass.

## Next Agent Mission

The next agent should treat this as a second large unit of work and verify all surfaces conform to the new source-company relation.

Primary goals:

- Ensure form and call lead matching/syncing in the Granot extension still works with the new relation and source snapshots.
- Ensure all applicable `vantage-main-server` routes/services use or expose `LeadSourceCompany`/granularity data correctly.
- Ensure `vantage-admin` views work properly with dynamic source companies and granularities.
- Ensure the owner can create/edit source companies and trigger required update propagation.
- Ensure the owner can clearly see source company models on `vantage-admin`.

## Suggested Backend Audit Checklist

Review and update these areas:

- Lead create/update:
  - `api/services/leads/formLead.service.ts`
  - `api/services/leads/callLead.service.ts`
- Duplicate/form-fill matching:
  - `api/services/leads/duplicateLead.service.ts`
  - `api/services/ringcentral/ringcentral-duplicate-guard.ts`
- Booking/cancellation source resolution:
  - `api/services/bookings/bookingSourceResolver.ts`
  - `api/services/bookings/bookedLead.service.ts`
  - `api/services/bookings/bookingMirror.service.ts`
  - cancellation sheet/source helpers
- Granot enrichment/reconciliation:
  - `api/services/enrichment/*`
  - `api/services/reconciliation/*`
  - `api/services/granotCrmCsv/*`
- Admin browse/search/export/facets:
  - `api/services/admin/adminBrowse.service.ts`
  - `api/services/admin/adminSearch.service.ts`
  - `api/services/admin/adminExport.service.ts`
  - `api/services/admin/adminFacets.service.ts`
- Analytics:
  - `api/services/analytics/*`
  - Especially source-company performance, funnel, lead-cost, overview, receiver-agent reports.
- Sheets:
  - `api/services/googleSheets/*`
  - `api/services/sheetSync/drainer/jobPlanner.ts`
  - Move DB sheet metadata into target planning where practical.
- RingCentral:
  - `api/services/ringcentral/call-lead-sources.ts`
  - `api/services/ringcentral/call-log-vetting.ts`
  - `api/services/ringcentral/webhook-event-normalizer.ts`
  - `api/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- Auth/scoped keys:
  - `api/middleware/requireApiSecret.ts`
  - Add company and optional granularity scope support.

## Suggested Admin Audit Checklist

Review and update:

- Operational list/detail/edit:
  - `components/operational/operational-resource-page.tsx`
- Booking/cancellation workflows:
  - `components/forms/booking-form.tsx`
  - cancellation creation/edit surfaces
- Search:
  - `app/(dashboard)/search/page.tsx`
- Analytics:
  - `components/analytics/analytics-dashboard.tsx`
  - dashboard overview source displays
- Exports:
  - `app/(dashboard)/exports/page.tsx`
- Settings:
  - `components/settings/source-company-manager.tsx`
  - Add richer editing for source sheet config, source-site conditions, default granularity selection, and propagation triggers.

## Suggested Granot Extension Audit Checklist

The extension repo was not modified in this pass. The next agent should inspect:

- Lead matching/search calls that filter by `source_company`.
- Form-lead PATCH paths that send source labels or source company strings.
- Call-lead enrichment/reconciliation payloads and UI labels.
- CSV/import workflows that depend on static source labels.
- Any local constants mirroring backend source labels.
- Ensure old labels still work, and add support for new `company_slug` / `source_granularity_key` where appropriate.

## Recommended Next Implementation Steps

1. Add a backend source catalog read endpoint optimized for UI dropdowns if the current full CRUD response is too heavy.
2. Add source granularity filters to all backend admin/analytics/export paths.
3. Add relation-aware response decoration for admin detail/search/export records.
4. Implement queued source metadata propagation:
   - Rewrite lead snapshots.
   - Recompute CPL.
   - Enqueue sheet resyncs.
   - Track progress/status for the owner.
5. Update `vantage-admin` settings UI to trigger and display propagation jobs.
6. Update Granot extension source label constants and API payloads.
7. Add integration tests covering:
   - Form lead create with legacy label.
   - Form lead create with new company/granularity keys.
   - Call lead create and RingCentral inbound number resolution.
   - Admin source-company CRUD.
   - Admin browse/filter by company and granularity.
   - Sheet projection labels from snapshots.
   - Source metadata rename propagation.

