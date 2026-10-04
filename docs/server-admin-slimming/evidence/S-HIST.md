# S-HIST evidence: Server historical database removal (SLIM-03), retired Customer/Agent browse, Exports and Agent Sales Report

Repository: `vantage-main-server`, branch `slim/server-admin`, uncommitted (the coordinator commits). Date: 2026-10-03.

## What changed and why

### Historical database is no longer opened (SPECIFICATION §3)

- `src/models/historical/**` is deleted. That folder held the only `mongoose.connection.useDb("vantagemovershistorical")` call (`getHistoricalConnection`) and the six historical models (`agents`, `customers`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`).
- `src/services/admin/adminScope.service.ts` now returns the four production Lead/Booking/Cancellation models only. `getAdminModels()` takes no argument. `concreteScopes`, `rejectCombinedDetailScope` and `ConcreteAdminScope` are gone. `AdminResource` is now `form-leads | call-leads | booked-leads | cancelled-leads`.
- `src/services/admin/adminBrowse.service.ts`: `browseCombined`, the per-scope loop, the client-side merge/sort (`compareValues`, `sortableValue`), the historical `sms_message_sent=false` shortcut and the `historical_distinct` / company-slug fallback in the Source Granularity filter are removed. Browse, detail and export read production only. Response rows no longer carry `database_scope`.
- `src/services/admin/adminSearch.service.ts`: production only. Items no longer carry `database_scope`.
- `src/services/admin/adminFacets.service.ts`: one production cache entry instead of a per-scope map. `getAdminFacets()` takes no argument. The `combined` merge and the dead `catalogOrEmpty` helper are removed. Registry `facets` invalidation still clears the cache.
- `src/services/admin/filterCatalog.ts`: `loadHistoricalCatalog`, `mergeCatalogs` and every helper used only by them (distinct scans of historical collections, production-identity overlay, preference rules) are removed. The `origin` field (`registry | historical_distinct`) is dropped from the catalog DTO, because every row is now a Registry row. `EMPTY_FILTER_CATALOG` / `emptyFilterCatalog` were only used by the removed code.
- `src/services/analytics/**`:
  - `analyticsMerge.ts` is deleted. It only merged production and historical payloads for `combined`. `AnalyticsPayload` moved to `analytics.service.ts`.
  - `analytics.service.ts` builds one production report. The response no longer has `database_scope`.
  - `sourcePerformance`, `cancellationAnalytics` and `leadCost` always group by Source Company plus Source Granularity. The `supportsSourceGranularity` switch existed only because historical rows had no granularity.
  - `sourceHierarchy.ts`: the historical company-only branch (`companyOnlySourceRows`), the `seedZeros: false` mode and the unused `loadProductionSourceLabelIndex` are removed. `nestObservedSourceRows` reads the production catalog.
  - `analyticsFilters.ts`: the historical/combined company-slug clause in `sourceGranularityLeadClause` is removed. The clause matches key, label snapshot, `source_company` exact and the Registry `source_granularity_id`.
  - `receiverAgentPerformance` and `smsConversion` no longer carry the historical "unsupported" payloads or the historical-warning `metadata`. The Admin already hid those messages on the production scope (`analyticsMetadataMessage`), so the visible result does not change.
  - `overview.service.ts` always returns `lead_cost` and `last_7_days`, because they were only nulled for non-production scopes. `mergeOverviewAllTime` is removed. The response no longer has `database_scope`. The all-time section still runs before the 7-day section, as before.
  - The CSV filenames no longer embed the scope: `form-leads.csv` and `analytics-<report>.csv`.
- `src/services/historicalConsolidation/**` is deleted. It held the stage/plan/apply/verify/rollback import into `vantagemovers`, with its lock, journal and registry writers.
- The local operator scripts `scripts/historical/` and `scripts/historical_production_db_staged_merge_ingestion/` are deleted, along with the eight `historical:*` entries in `package.json`. See the open items: these files were gitignored.
- `src/models/granotAggregateRevisions.test.ts`: the `[AC-32]` test, which only asserted that the deleted historical schemas had no revision fields, and its four imports were removed.

### Transitional scope contract (SPECIFICATION §3)

`adminDatabaseScopeSchema` (in `src/validation/v1/admin.validation.ts`) is now `z.literal("production").optional()` with this message: `The historical database was retired; database_scope accepts only "production".` It is shared by the browse, detail, search, facets, export, Analytics, Analytics export and Overview schemas. Results:

- An omitted scope or `production` is accepted.
- `historical` or `combined` produces a `ZodError`. `sendError` turns that into HTTP 400 `{ ok: false, error: "Invalid request payload", issues: [...] }`. The issue path is `database_scope` and it carries the retirement message. Nothing maps these values to production.

The handlers I own in `v1.routes.ts` now parse the query **before** `connectMongo()`. A retired scope is therefore refused even when Mongo is unavailable, and the 400 is the result in every case.

`AdminDatabaseScope` (type) is no longer exported. The browse-only filters `active`, `role`, `customer_phone` and `customer_email` were removed from `adminBrowseQuerySchema`. They served only the Agents and Customers tables. The schema is `.strip()`, so old clients that still send them are unaffected.

### Customer/Agent browse, Exports and Agent Sales Report (SPECIFICATION §2)

Consumer inventory, done before cutting:

| Endpoint | Kept caller? | Decision |
| --- | --- | --- |
| `GET /api/v1/admin/customers`, `/customers/:id`, `/exports/customers.csv` | Only the removed Customers tab (`operational-*` config, `/search` page link, testimonials link). No caller in MCP, the extension or the clients. Booking detail uses Booking populate (`customer`), not this route. | **Removed** (the resource left `adminResources`) |
| `GET /api/v1/admin/exports/agents.csv` | Only the removed Agents tab | **Removed** |
| `GET /api/v1/admin/agents`, `/agents/:id` (browse plus metrics) | **Kept callers:** Operations Registry Agents tab (`catalog-registry-manager.tsx` → `fetchRegistryCatalog("agents", { includeInactive })` → `GET api/v1/admin/agents?include_inactive=true`) and Registry Users tab (`users-tab.tsx`), plus `fetchRegistryCatalogItem` | **Re-pointed** to `handleCatalogList("agents")` / `handleCatalogDetail("agents")`, which is how `/admin/merchants` already works. The Registry gets `CatalogItem` (`id`, `name`, `normalized_name`, `active`, `role`, `granot_crm_username`, `created_from`). Every field it reads is present. It also gets the real `include_inactive` filter instead of the 50-row browse page. |
| `POST /api/v1/admin/agents`, `PATCH /agents/:id`, `/agents/:id/activation`, `/agents/:id/dependencies`, `GET /admin/catalog/agents` | Extension `src/api/agents.ts` and the Registry | **Untouched (protected)** |
| `GET /api/v1/admin/reports/agent-sales`, `/exports/reports/agent-sales.csv` | Only the removed `/reports/agent-sales` page | **Removed**, together with `agentSalesReport.service.ts` and `agentSalesReportQuerySchema` |
| `/api/v1/customers` CRUD (`findAllCustomers`, etc.) | This is not the Customers tab's transport (the tab used `/admin/customers`), and no caller proves it serves only removed surfaces. It is also outside this lane's route sections. | **Kept** |

`src/services/admin/agentBrowseMetrics.service.ts` and its test are deleted, because only the Agents browse enrichment used them. Analytics `agent-performance` (`agentPerformance.service.ts`) and receiver-agent attribution are untouched. `src/services/agents/**` held no browse-only code. Customer upsert/linkage (`customerFromLead.service.ts`) and the populate helpers are untouched.

### Observability in owned files

The production files I own had no `recordOperationalEvent` calls. `adminSheetSync.service.test.ts` imported the retired in-memory event capture for one negative assertion: no `sheet_sync.queue.publish_failed` event. I removed that import and the assertion. Its other assertions (drain started, requeue filter and body) still pass.

## Deleted files

- `src/models/historical/{index,Agent,Customer,FormLead,CallLead,BookedLead,CancelledLead,schemaHelpers}.ts`
- `src/services/historicalConsolidation/{apply,classification,dateParsing,index,manifest,migrationContext,mongoValues,normalization,operationalLock,planner,rollback,schemaValidation,stableJson,targetGuard,types,verify}.ts` and the tests `classification`, `manifest`, `normalization`, `planner`, `rollback`, `schemaValidation`
- `src/services/analytics/analyticsMerge.ts`, `src/services/analytics/agentSalesReport.service.ts`
- `src/services/admin/agentBrowseMetrics.service.ts`, `src/services/admin/agentBrowseMetrics.service.test.ts`
- `scripts/historical/**` (`models/historical-analytics-report.json`, `reports/{database-audit,bad-leads-audit}.{md,json}`) and `scripts/historical_production_db_staged_merge_ingestion/**` (snapshot/plan/apply/verify/rollback runners, `artifact-io.ts`, `snapshot-adapters.ts`, the v1 JSON inventories/mappings/templates, `README.md`, `NEXT_SESSION_HANDOFF.md`). **These were gitignored local operator files (`/scripts/*`), so git cannot restore them.**

## Retained behavior and how it was verified

- **Production browse, filters and pagination.** These tests still pass: duplicate default and duplicate-only filters, contact snapshot paths, `past_move_date`, receiver Agent, Lead Source Company, Source Granularity exact match with `source_granularity_id`, the `source_company` bookmark, booked-lead source/legacy label/leadless, `no_sync` semantics, detail populate and SMS enrichment, CSV escaping (`admin.service.test.ts`).
- **Search.** The four production groups and the Granot snapshot contact paths still work. A new test shows that Customer and Agent models are never queried.
- **Facets.** The structured Registry catalog and the cache invalidation still work (`adminFacets.service.test.ts`). The catalog rows carry no `origin`.
- **Analytics.** These tests still pass: source performance and funnel grouping by company plus granularity (rewritten for production), lead cost, receiver Agent CPL, SMS conversion, source hierarchy seeding, CSV rows and filename, leadMatch with a Registry granularity id.
- **Agent catalog routes.** `v1.routes.test.ts` confirms that `GET /admin/agents` and `/:id` are each registered once (now catalog), together with the protected POST/PATCH/activation/catalog routes.
- **Scope contract.** These are new tests:
  - `src/validation/v1/adminDatabaseScope.test.ts` (8 tests). Browse, search, analytics and overview schemas accept an omitted scope and `production`. They reject `historical` and `combined` with the retirement message on `database_scope`.
  - `src/routes/v1-admin-database-scope.routes.test.ts` (3 tests). Real HTTP through the v1 router, with a synthetic API secret and `MONGO_URI` unset, so no database is reachable. Eight read endpoints (browse, detail, search, facets, CSV export, Analytics, Overview, Analytics CSV) return **400** with the retirement message for both retired scopes. They return non-400 for an omitted scope or `production`: validation passes, then `connectMongo` fails without a URI. Customer browse/detail/export, Agent export and both Agent Sales Report routes return **404**.
- **Protected areas.** Daily Operations files were not touched, and neither was the Granot `historical_shadow` execution mode. The guard constants `HISTORICAL_DATABASE` in `scripts/migrations/*` (tools that refuse to target the historical DB) were left as they are.
- **Static proof.** `rg -n "vantagemovershistorical" src api ops` finds no `useDb('vantagemovershistorical')` in runtime code. The only hits are `ops/slimming/{policy.ts,inventory.ts,deletion-manifest.json}`, which is the DATA lane's purge manifest naming the drop target. These symbols have zero hits in `src api ops scripts package.json vercel.json`: `registerHistoricalModels`, `models/historical`, `concreteScopes`, `rejectCombinedDetailScope`, `AdminDatabaseScope`, `analyticsMerge`, `agentSalesReport`, `agentBrowseMetrics`, `loadHistoricalCatalog`, `historical_distinct`, `unsupported*Report`, `companyOnlySourceRows`. One exception: a stale doc comment in `salesIntelligence/outreach/leadInstant.ts`, which is S-OUT territory.

## Checks run (real results)

| Command | Result |
| --- | --- |
| `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test src/services/admin/*.test.ts src/services/analytics/*.test.ts src/validation/v1/adminDatabaseScope.test.ts src/models/granotAggregateRevisions.test.ts src/routes/v1-admin-database-scope.routes.test.ts src/routes/v1.routes.test.ts` (with `MONGO_URI` unset) | **88 tests, 88 pass, 0 fail** |
| `pnpm typecheck` (full, with `NODE_OPTIONS=--max-old-space-size=8192`; the default heap OOMed once while other lanes were also compiling) | Exit 2. The only errors are 6 **syntax** errors in `src/services/numberActivity/directorySync.ts` (another lane, mid-edit). Those stop tsc before the semantic pass, so this run cannot certify anything. |
| `tsc -p <temp config: types + src/services/admin/** + src/services/analytics/** + admin/analytics validation + new tests + granotAggregateRevisions.test.ts>` | **0 errors in lane files.** The only errors are in `salesIntelligence/{analysis,attachment,outreach}` files pulled in transitively, which other lanes are mid-edit on. |
| `tsc -p <temp config: v1.routes.ts + v1.routes.test.ts + v1-admin-database-scope.routes.test.ts>` | **0 errors in `v1.routes*` or lane files.** The remaining errors are in `google-drive-oauth.routes.ts` and `salesIntelligence/analysis/*` (other lanes). |

Baseline (`evidence/BASELINE.md` / `server-baseline-failures.txt`) had no admin, analytics or historical test failures. All the lane's tests pass now.

## Open cross-lane items

1. **A-OPS / Admin.** Server rows, search items, the Analytics response and the Overview response no longer contain `database_scope`, and the filter catalog rows no longer contain `origin`. Admin should stop reading these:
   - `item.database_scope` in `app/(dashboard)/search/page.tsx`. Today `new URLSearchParams({ database_scope: item.database_scope })` would send the string `"undefined"`, and the server answers that with a 400.
   - `FilterCatalogOrigin` in `lib/api/admin.ts`.
   - `analyticsMetadataMessage`'s scope gate: the server no longer sends historical warning metadata.

   Admin should also stop sending `database_scope` entirely, or send only `production`. The global search page should drop the Customers/Agents groups (the server no longer returns them).
2. **A-OPS / Admin.** Registry `fetchRegistryCatalog("agents")` now gets the catalog shape (`{ items: CatalogItem[] }`, all Agents when `include_inactive=true`) instead of a 50-row browse page. No change is needed: `data.items` and `id ?? _id` are already handled. Please confirm the Registry Agents and Users tabs in the integrated run.
3. **Docs / integration.** `docs/knowledge/services/{admin-search,analytics,catalog,operations-registry}.md` and `docs/index.md` still describe historical/combined scope, Customer/Agent browse metrics or the Agent Sales Report. They need a doc pass. Not edited here: outside this lane's ownership.
4. **S-OUT.** The `src/services/salesIntelligence/outreach/leadInstant.ts` header comment points at the deleted `historicalConsolidation/planner.ts`.
5. **S-OBS.** `ops/test-setup.ts` still installs the observability test sink. The lane's tests no longer depend on it.

## DATA-MANIFEST NEEDS

**Drop (made dead by this lane):**

- Database **`vantagemovershistorical`**: the whole database, every collection actually present. Known: `agents`, `customers`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`. There is no remaining runtime reader or writer (proof above). This drop needs the separate verified backup the runbook requires.

**Candidates that must NOT be dropped without inventory plus an explicit decision (SPECIFICATION §3, "consolidation manifests/ledger in vantagemovers"):**

- `vantagemovers.historical_import_registry`, `vantagemovers.historical_import_apply_journal` and `vantagemovers.historical_import_locks` (lock `_id: "historical-consolidation"`). Their only writer and reader was the deleted `historicalConsolidation` code, so no runtime code touches them now. However, `historical_import_registry` maps `operation_id`/`manifest_hash` to the production `target_entity_id`. It is the provenance of any historical rows that were merged into production. Classify as *drop only if the inventory shows the Owner accepts losing that merge provenance*. Otherwise keep it as finite migration evidence.

**Must NOT remove (production data that only looks historical):**

- Main `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `customers`, `agents`, including rows inserted or updated by the consolidation. Examples: Agents/Merchants/Source Companies/Granularities with `created_from: "historical_consolidation"`, Leads with `receiver_agent_source_value: "historical_booking_sales_agent"`, and `operations_registry_changes` rows whose `request_id` starts with `historical:`.
- Granot `synchronization_decisions` / observations with `execution_mode: "historical_shadow"`.
- No Export-only, Agent-Sales-only, Customer-browse-only or Agent-browse-only collection exists. These surfaces had no storage of their own.

## Integration follow-up

- SLIM-03 driver-spy proof: `src/services/admin/noHistoricalDb.test.ts` spies `useDb` and `MongoClient#db` while every admin read runs, and asserts that `vantagemovershistorical` is never selected (added by the server integrator; see `INTEGRATION-SERVER.md`).
- `GET /api/v1/admin/agents` and `/:id` (now the Agent catalog) reject `database_scope=historical|combined` with the transitional 400 (`rejectRetiredDatabaseScope`), and both are in `SCOPED_READS`.
