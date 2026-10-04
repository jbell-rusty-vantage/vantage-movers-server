# A-OPS evidence: Admin historical scope removal and operational list cleanup (SLIM-03 Admin)

Repository: `vantage-admin`, branch `slim/server-admin`, uncommitted (the coordinator commits). Date: 2026-10-03.

## What changed and why

### Database scope is gone (SPECIFICATION §3)

The dashboard reads production only. There is no scope selector, scope provider, scope persistence or historical read-only mode any more.

- Deleted `components/layout/database-scope-selector.tsx` and `components/layout/scope-aware-header-controls.tsx`. `components/layout/dashboard-shell.tsx` now mounts `<GlobalSearch />` directly.
- `lib/state/database-scope.tsx` no longer has a provider or context. It now exports `RetiredDatabaseScopeCleanup`, which `app/(dashboard)/layout.tsx` mounts in place of `DatabaseScopeProvider`. On load it does two things:
  - It removes the `vantage.database_scope` key that earlier releases persisted in `localStorage`. The call is wrapped in try/catch.
  - When the URL still carries `database_scope`, it calls `router.replace` without that parameter.
- `lib/api/filters.ts` adds `withoutRetiredDatabaseScope(params)` in place of `parseDatabaseScope`:
  - With `database_scope=production`, only that parameter is dropped. The record selection stays.
  - With any other value (`historical`, `combined` or anything else), `record`, `panel` and `connect` are dropped as well. A historical record id is never opened as a production record (§3).
  - `useUrlTableState` (`lib/api/url-state.ts`) applies the same function before it derives filters. So even before the URL replace lands, a list or detail query never sends `database_scope` and never opens a historical record id.
  - `setScope` was removed. `reset` now clears the whole query instead of re-adding `database_scope`.
- Types: `DatabaseScope` and `OperationalDatabaseScope` were removed from `lib/api/types.ts`. `database_scope` was removed from:
  - `TableQueryParams` and `GlobalSearchResultItem`;
  - in `lib/api/admin.ts`: `AdminRecord`, `AnalyticsResponse` and `OverviewReportResponse`.
- The catalog `origin` field and `FilterCatalogOrigin` were removed, because S-HIST no longer sends them. `DATABASE_SCOPES`, `DATABASE_SCOPE_LABELS`, the scope option lists and `getDatabaseScopeLabel` were removed from `lib/constants/domain.ts`.
- Requests no longer send `database_scope`: list, detail, facets, overview, analytics, CSV and global search. An omitted scope is valid on the server.
  - `fetchAdminDetail`, `fetchAdminFacets` and `fetchOverviewReport` lost their scope arguments.
  - `queryKeys.details.resource` and `queryKeys.search.global` lost their scope segment.
  - `queryKeys.facets.scope` became the single `queryKeys.facets.all` key.
- Operational lists:
  - Removed the historical read-only banner, the historical detail warning, the "Database scope" summary row and the `isProduction` threading through `buildColumns`, `rowActionCluster`, `visibleDetailTabs` and `productionEditAllowedFor`.
  - Removed the historical `receiver_agent` filter suppression.
  - Mutations are now gated only by role, the duplicate (read-only) config and referral rules, as they already were for production.
- Global search:
  - `buildSearchHref(query)` no longer takes a scope, and `GlobalSearch` no longer has a `scope` prop.
  - `/search` shows only Lead, Booking and Cancellation groups, links `?q=<id>` without a scope, and drops the historical/production badge and the production-only gating of workflow links.
- Overview (`components/dashboard/home-overview.tsx`):
  - The scope label and the scope gates were removed. This-week and Lead Cost now always show, as they did for production.
  - A-DEST had already removed the "View all" link to `/agents`.

### Customer and Agent tabs retired (SPECIFICATION §2)

- `UiResource` and `AdminResource` are now the six official list resources and the four admin resources.
- Removed:
  - the `customers` and `agents` resource configurations;
  - `adminToUiResource` and `resourceLabels`;
  - the Customer/Agent row identity;
  - the Customer contact tab and its linked-testimonials section;
  - `fetchCustomerTestimonials`;
  - the relation-count and cancel-rate cell formatting (`relationCount`, `formatRate`, `booking_count`/`cancellation_count` handling, the `rate`/`scope` column formats).
- Kept:
  - The Customer linkage inside Bookings and Cancellations: the customer column (with the `customer_name` fallback), the identity cell (name and phone) and the Cancellation contact tab.
  - The Agent catalogs used by the forms, the Registry and Analytics. `lib/api/catalog.ts`, `lib/api/registryAgents.ts` and `lib/api/use-catalog-options.ts` were not changed.

### Links to retired surfaces removed from retained lists

- The Customer "Linked" fact (`linkedContextHref(…, "customer")`) no longer links to `/customers`.
- The Lead Message "View messaging events" link to `/observational?tab=events…` was removed, along with its copy key.
- The Lead Actions "Open in Sales Intelligence" link to `/sales-intelligence?view=all_outreach…` (an old SI outreach view) was removed.
- `components/operational/related-record-nav.ts` no longer imports from `components/observational`.
  - The new `components/operational/record-href.ts` (`recordHref`) maps only the four official record types.
  - `SelectionCheckbox` moved to `components/operational/selection-checkbox.tsx`, so A-DEST could delete `observational-delete-controls.tsx`.
- `components/sales-intelligence/lib/official-record.ts` is a small shared edit. It now uses `recordHref` and no longer appends `&database_scope=production`.
- `components/sales-intelligence/manual-attachment.tsx` is a small shared edit. It no longer sends `database_scope:'production'` and no longer filters results on `item.database_scope`. That filter would have emptied the candidate list once S-HIST stopped returning the field.

### CSV copy (SPECIFICATION §2)

The list CSV success message was "CSV export downloaded and audit logged.". It is now "CSV export downloaded." (`OPERATIONAL_COPY.exportDownloaded`). Filtered list CSV (`adminExportUrl`) and Analytics in-context CSV (`analyticsExportUrl`) are unchanged apart from no longer carrying a scope.

### Analytics (SPECIFICATION §2, §3)

- Removed from `components/analytics/analytics-dashboard.tsx`:
  - the "Scope:" badge;
  - the historical-unsupported tab gating and its copy, for receiver-agents and text-to-booked;
  - the historical "N/A" receiver coverage and the combined hint;
  - the historical and combined hierarchy table descriptions;
  - the `enabled: scope !== "historical"` gate on the receiver KPI query.
- `analyticsMetadataMessage` (`lib/analytics/presentation.ts`) and its uses in the dashboard and `text-to-booked-panel.tsx` were removed.
  - Only the receiver-agent and SMS reports ever sent a metadata message.
  - In production scope the function already suppressed both, so production behaviour is unchanged.
  - S-HIST removed the historical warning metadata on the server.
- Every report, tab, filter, Agent performance report, receiver attribution report and the in-context CSV button are kept.
- Copy: "Production receiver-agent coverage signal." is now "Receiver-agent coverage signal.", and "Production received leads" is now "Received leads".
- As §3 expects, production-only totals may be lower than the previous Combined views.

### Dead `lib/api/admin.ts` exports removed (their consumers were deleted by A-DEST)

- The observability types, fetchers and CSV URL helpers (`/api/v1/admin/observability/**`, `/admin/exports/observability/**`).
- The Observational Sheet Sync helpers (`fetchSheetSync{Health,Jobs,Runs,RunDetail}`, `retrySheetSyncJobs` and their types).
- The Agent Sales Report (`fetchAgentSalesReport`, `agentSalesReportExportUrl`, `AgentSalesReportResponse`).
- `checkSheetContains` and its types are kept for the operational "Check Google Sheet contains" action.

## Deleted files

- `components/layout/database-scope-selector.tsx`
- `components/layout/scope-aware-header-controls.tsx`

(`lib/state/database-scope.tsx` was rewritten in place as the cleanup component.)

## New files

- `components/operational/record-href.ts`
- `components/operational/selection-checkbox.tsx`
- `tests/operational-record-href.test.ts`
- `tests/retired-database-scope.test.ts`

## Shared or out-of-list files edited (small targeted edits, each read immediately before editing)

These files consumed a symbol this lane removed:

| File | Edit |
| --- | --- |
| `app/(dashboard)/layout.tsx` | Mount point |
| `components/layout/dashboard-shell.tsx` | Mount point |
| `components/layout/global-search.tsx` | Scope prop removed |
| `components/layout/command-palette.ts` | Scope argument removed |
| `lib/query/keys.ts` | Scope segments and facets key |
| `lib/api/url-state.ts` | Scope parsing |
| `components/dashboard/home-overview.tsx` | Scope label and gates |
| `components/manual/connect-booking-section.tsx` | Detail call and key arity |
| `components/sales-intelligence/lib/official-record.ts` | `recordHref`, no scope parameter |
| `components/sales-intelligence/manual-attachment.tsx` | No scope parameter or filter |
| `lib/analytics/presentation.ts` (+ test) | `analyticsMetadataMessage` removed |

Tests updated:

- `lib/query/keys.test.ts`
- `lib/query/granotLifecycle.test.ts`
- `lib/sheet-contains.test.ts`
- `lib/api/{admin,filters,salesIntelligence,salesIntelligenceOfficial}.test.ts`
- `tests/{dashboard-chrome,home-overview,operational-detail-tabs,operational-filter-groups,operational-rows,related-record-nav,filter-catalog-adapter}.test.ts`
- `tests/legacy/sales-intelligence-lead-progress.test.ts`

## Retained behavior preserved and how it was verified

- **Old URLs and storage are normalized without reinterpretation.** `lib/api/filters.test.ts` covers three cases:
  - no scope: the params are returned unchanged;
  - `production`: only the parameter is dropped and the record selection is kept;
  - `historical`, `combined` or any other value: `record`, `panel` and `connect` are dropped, while `q` and `page` are kept.
  - `tests/retired-database-scope.test.ts` asserts that the layout mounts the cleanup and the shell mounts `GlobalSearch`, that the old selector files are gone, and that the cleanup removes `vantage.database_scope` and never writes it.
- **No scope is sent.** `lib/api/admin.test.ts` stubs `fetch` and asserts the detail, facets and overview URLs (no `database_scope`). It also checks that the list CSV URL carries filters but no scope, and the Analytics CSV URL.
- **Detail tabs and row actions are unchanged for production.**
  - `tests/operational-detail-tabs.test.ts`: the matrix for all six resources, read-only and duplicate cases, Referral, owner-delete, connect, and the panel URL behavior.
  - `tests/operational-rows.test.ts`: identity, status chips, action cluster for production, read-only and duplicate rows, and column order.
  - New assertions: the CSV copy no longer says "audit logged", and the Booking customer column falls back to the stored name.
- **Related links.**
  - `tests/related-record-nav.test.ts` adds a check that a Customer link never resolves to `/customers`.
  - `tests/operational-record-href.test.ts` covers the four official routes and URL encoding.
- **Retained resources only.** `tests/operational-filter-groups.test.ts` asserts the configs cover exactly the six official lists and that Reset clears the query with no scope.
- **Overview.** `tests/home-overview.test.ts` checks that this-week and all-time render, that Lead Cost shows, and that no scope label remains.
- Daily Operations files were not edited.

## Checks run (real results)

Commands use `node_modules` binaries directly. `pnpm typecheck` and `pnpm test` trigger a dependency-status `pnpm install` in this checkout, which the shared-checkout rules forbid; this is the same failure as `scratchpad/baseline/admin-*.txt`.

| Command (vantage-admin) | Result |
| --- | --- |
| Baseline, on a clean `git archive HEAD` copy with `node_modules` junctioned: `tsc --noEmit` | exit 0 |
| Baseline, same copy: `node --import tsx --test "{lib,server,tests}/**/*.test.ts"` | 1132 tests: 948 pass, 0 fail, 184 skipped |
| `node node_modules/typescript/bin/tsc --noEmit` (final) | 1 error outside `.next/`: `lib/api/dailyOperationsBoard.ts(24,34)` cannot find `@/lib/api/granotLiveReceipts`. That file is protected Daily and the cause is A-DEST's deletion. There are no errors in A-OPS files. The `.next/dev/types/validator.ts` errors are stale generated route types for deleted pages. |
| Full suite, `node --import tsx --test "{lib,server,tests}/**/*.test.ts"` (after all A-OPS edits) | 1050 tests: 863 pass, 3 fail, 184 skipped. The 3 failures are `lib/api/dailyOperationsBoard.test.ts`, `tests/daily-arrivals.test.ts` and `tests/daily-page.test.ts`, all with `Cannot find module '@/lib/api/granotLiveReceipts'` (the same Daily cross-lane item). |
| Focused, on the touched areas (filters, admin, operational-*, home-overview, dashboard-chrome, related-record-nav, sheet-contains, keys, granotLifecycle query, analytics presentation, SI official links, lead-progress legacy) | 197/197 pass |
| Focused, after removing the catalog `origin` field: filter-catalog-adapter, admin, retired-database-scope, operational-record-href | 14/14 pass |
| `node node_modules/eslint/bin/eslint.js` on every touched path | 4 errors and 1 warning, all pre-existing. The same 5 findings appear in the baseline copy: `react-hooks/set-state-in-effect` in `global-search.tsx` (2) and `operational-resource-page.tsx` (selection reset effect), and `exhaustive-deps` in `connect-booking-section.tsx`. This lane introduces no new findings. |

## Open cross-lane items

1. **Daily Operations (coordinator decision, already raised by A-DEST).** `lib/api/dailyOperationsBoard.ts` still imports the deleted `lib/api/granotLiveReceipts`. It is the only typecheck error and the cause of the only 3 test failures.
2. **A-DEST.**
   - `components/observational/entity-link.ts` `entityHref` now has no production caller. `official-record.ts` moved to `components/operational/record-href.ts`, and only `tests/observational-entity-link.test.ts` still uses it.
   - Registry Changes still uses `exclusiveEndDate`. Consider moving that helper next to Registry and deleting `components/observational/`.
3. **A-SI (wave 2).**
   - `salesIntelligenceLeadHref` (`/sales-intelligence?view=all_outreach…`) no longer has a caller outside Sales Intelligence.
   - `server/auth/proxyForwardHeaders.ts` `currentCsiScope` still inspects `database_scope` and `scope` for historical values. That is a CSI guard and is left to the SI lane.
   - SI fixtures and gallery data still contain `&database_scope=production` hrefs. They are harmless, because the cleanup strips them on navigation.
4. **Server (S-OUT, S-AI, S-HIST).**
   - SI read models that survive the outreach/assessment deletion should emit hrefs without `&database_scope=production`. Today `outreach/reads.ts`, `outreach/timelineRead.ts` and `assessment/presentation.ts` emit it.
   - `services/bestRelocationSheetIngest/apply.ts` calls `/api/v1/admin/{booked,cancelled}-leads?database_scope=production`. That is still valid, but could drop the parameter.
5. **Server endpoints that no longer have an Admin caller** (classification only, not a deletion request):
   - `GET/POST /api/v1/admin/sheet-sync/{health,jobs,runs,runs/:id,retry}`. These were only used by the deleted Observational Sheet Sync tab. `POST /admin/sheet-sync/contains` is still used. Check Daily's own Sheet Sync controls before removing any of them.
   - The admin `customers` browse, detail and CSV.
   - The agents browse CSV.
   - `/admin/reports/agent-sales` and its CSV.
   - Kept Agent endpoints: the Registry still calls `GET /api/v1/admin/agents[?include_inactive=true]`, `GET /admin/agents/:id`, `POST /admin/agents`, `PATCH /admin/agents/:id`, `/activation` and `/dependencies`. The forms call `GET /admin/catalog/agents`. S-HIST already routes `GET /admin/agents` to the catalog handler, and the Registry handles `{ items }`. The Registry Agents and Users tabs still need a check in the integrated run (S-HIST item 2).
6. **Docs (wave 3).** `.cursor/rules/project-organization.mdc` (lines 29 and 152) still describes the scope selector and `database_scope` links.

## DATA-MANIFEST NEEDS

- **No Mongo collection, field or object becomes dead because of this lane alone.** Admin no longer reads the historical database through any parameter, but the historical database drop (`vantagemovershistorical`, every collection present) is S-HIST's manifest item. This lane confirms that no Admin code path can request `historical` or `combined` scope after this build, so the drop cannot be undone by an Admin read.
- **Must NOT remove:**
  - The production `customers` and `agents` collections in `vantagemovers`. Bookings and Cancellations populate the Customer, and the Registry, forms, Analytics and extension use the Agents. Only the standalone tabs were removed.
  - The production `testimonials` `customer` references.
- **Browser state (not Mongo):** the `localStorage` key `vantage.database_scope` is retired. The Admin build removes it from each viewer's browser on next load, so no server-side purge is needed.
