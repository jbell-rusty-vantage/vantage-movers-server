# Admin integration evidence

Repository `vantage-admin`, branch `slim/server-admin`, HEAD `adda9e1`, uncommitted (the coordinator commits).

## Integration (wave 1)

Date: 2026-10-03/04. Inputs: lanes A-DEST (SLIM-02, SLIM-08) and A-OPS (SLIM-08 scope/Customer/Agent), their independent reviews, and the Admin-facing cross-lane items in `S-GRANOT.md`, `S-HIST.md`, `S-OBS.md` and `S-NUM.md`. The integrator was the only agent editing the Admin tree. Daily Operations files were not edited.

### Review findings

| Finding | Decision | Change |
|---|---|---|
| A-DEST high: the protected Daily board imports the deleted `lib/api/granotLiveReceipts.ts` (typecheck and 3 Daily test files fail) | *(Superseded; see "Resumed run" below: the Daily navigation fix was applied and this constant file is deleted again.)* Fixed **without editing Daily**. Daily files stay untouched by instruction, so the coordinator-approved link removal was not applied. | Restored `lib/api/granotLiveReceipts.ts` as a single constant, `LIVE_EVENTS_HREF = "/live-events"`, with a comment explaining the hold. It holds no client, types or fetch code. Daily still shows two dead card links ("Open in Live Events" and, on dead-letter cards, "Open Observational"). See Remaining issues 1. |
| A-DEST low: `entityHref` is dead and `components/observational/` survives only for one date helper | Confirmed (no production caller) | Moved `exclusiveEndDate` to `lib/operations-registry/exclusiveEndDate.ts` with its own test. `registry-changes.tsx` imports it from there. Deleted `components/observational/entity-link.ts`, the `components/observational/` folder and `tests/observational-entity-link.test.ts`. |
| A-DEST low: Observational-only enums in `lib/constants/domain.ts` | Confirmed (no reference outside the file) | Deleted `OBSERVABILITY_LEVELS`, `OPERATIONAL_EVENT_CATEGORIES`, `INCIDENT_STATUSES`, `INCIDENT_SEVERITIES`, `NOTIFICATION_STATUSES`, `NOTIFICATION_PURPOSES`, `NOTIFICATION_RECIPIENT_TYPES`, `OPERATIONAL_REPORT_KEYS` and `REPORT_RUN_STATUSES`, along with their header comment. |
| A-DEST low: `vantage-admin/CONTEXT.md` describes retired surfaces; `registry-overview.tsx` says "Distinct from Workflow Observational events" | Confirmed | CONTEXT.md: product line, Lead Conversations, dashboard chrome order, Live Events, operational surfaces (six list routes, production only), Granot Lifecycle (Health only, redirects) and Agents list metrics now describe the post-slimming state. Removed the Observational clause from the Registry Health copy. |
| A-OPS low: `queryKeys.testimonials.customer` has no caller | Confirmed | Deleted the key. |

### Cross-lane items resolved in Admin

- A-DEST → A-OPS: `lead-message-section.tsx` `/observational` link, "audit logged" CSV copy, and search Customer/Agent groups. A-OPS had already fixed all three. `rg` confirms no hits.
- S-HIST item 1 (`database_scope`, `origin`, `analyticsMetadataMessage`). A-OPS had already fixed this. The only remaining `database_scope` references are the retirement cleanup (`lib/api/filters.ts`, `lib/state/database-scope.tsx`), negative tests, and Sales Intelligence fixtures plus `server/auth/proxyForwardHeaders.ts`. The last two belong to wave 2 A-SI.
- S-OBS item 2:
  - `review_source_resolution` is gone from `RegistryRemediationAction` and its switch case in `lib/api/registryEntityLinks.ts`. Its finding no longer has a producer.
  - `registry.compatibility_reads_remaining` → `read_count` is now a per-instance count. `CompatibilityObservationStatement` no longer says "Observation window started 1 Sep 2026"; it says the count covers the server instance that answered, since it last started.
  - Deleted the now-unused `COMPATIBILITY_OBSERVATION_WINDOW_STARTED_AT`.
- Leftover found by the `rg` sweep: `server/auth/authorization.ts` still let the Admin role PATCH `/api/v1/customers/` through the proxy. Only the retired Customers tab used it; no Admin code calls that path any more. Removed the prefix and added the test `SLIM-08: the retired Customers tab leaves no Admin-role Customer PATCH` in `authorization.test.ts`. Admin role PATCH on Leads, Bookings and Cancellations is unchanged. Owner is unchanged.
- S-GRANOT item 2: the clients for receipt search and live receipts are already gone. `counter_coverage` is optional and was not rendered: `asGranotLifecycleHealth` ignores unknown keys, so Health renders as before.
- S-NUM item 8 (the Admin builds against `S-NUM-CONTRACT.md`) and A-DEST's `REP_PROXY_ROUTES` and conversations note are wave 2 (A-SI). Not touched.

### Leftover sweep

`rg -c -i "audit-log|AdminAuditLog|writeAuditLog|granot-live-receipts|live-events|observational|/customers|/agents\b|/exports\b|agent-sales|database-scope|database_scope|audit logged|agentSales|AgentSales" app components lib server tests next.config.ts`

Every remaining hit was classified. The only real leftover was the Customer PATCH prefix, removed above. The other hits fall into these groups:

- **Negative assertions in tests:** `routeGuard.test.ts`, `dashboard-nav.test.ts`, `dashboard-chrome.test.ts`, `retired-destinations.test.ts`, `retired-database-scope.test.ts`, `operational-rows.test.ts`, `operational-filter-groups.test.ts`, `home-overview.test.ts`, `salesIntelligence*.test.ts` and `rep-scope.test.ts`.
- **Kept on purpose:**
  - Registry, catalog and forms Agents: `/api/v1/admin/agents`, `/api/v1/admin/catalog/agents` and `AgentsManager`.
  - The list and Analytics CSV `api/v1/admin/exports/...`, which is the in-context export, not the retired Exports page.
  - The retirement cleanup: `RetiredDatabaseScopeCleanup` and `withoutRetiredDatabaseScope`.
- **Wave 2:** Sales Intelligence gallery fixtures (`database_scope=production` hrefs) and `proxyForwardHeaders.ts`.
- **Daily hold** *(superseded, see "Resumed run")*: `lib/api/dailyOperationsBoard.ts` and `components/daily/daily-copy.ts`, which are protected, and the `lib/api/granotLiveReceipts.ts` constant.

### Commands and results

All commands were run in `C:/Users/Pinda/Proyectos/vantage/vantage-admin`. `--config.verify-deps-before-run=false` stops pnpm from starting a dependency install, which the shared-checkout rules forbid. It runs the same package scripts.

| Command | Result |
|---|---|
| `pnpm --config.verify-deps-before-run=false typecheck` (`tsc --noEmit`) | **exit 0, 0 errors.** Before this, the only errors were 14 in the stale generated `.next/dev/types/validator.ts`, left by a `next dev` from 2026-09-30 that still listed deleted routes such as `/granot-lifecycle` layout. That folder is gitignored build output. It was moved to the scratchpad (`admin-stale-next-dev-types/`), not edited, and `next dev` regenerates it. |
| `pnpm --config.verify-deps-before-run=false test` (`node --import tsx --test "{lib,server,tests}/**/*.test.ts"`) | **1079 tests: 895 pass, 0 fail, 0 cancelled, 184 skipped** (replica/env-gated), exit 0 |
| `node --import tsx --test server/auth/authorization.test.ts` | 28/28 pass, including the new SLIM-08 Customer PATCH test |
| `pnpm --config.verify-deps-before-run=false lint` (`eslint`) | exit 1: **26 problems (18 errors, 8 warnings)**, all pre-existing (see baseline) |
| `node node_modules/eslint/bin/eslint.js` on a clean `git archive HEAD` copy (`scratchpad/aops-base`, node_modules junctioned) | 26 problems (18 errors, 8 warnings) |

### Baseline comparison

The baseline is in `scratchpad/baseline/admin-test.txt`, `admin-typecheck.txt` and `admin-baseline-failures.txt`.

- **Typecheck:** baseline exit 0, now exit 0.
- **Tests:** baseline had 1132 tests (948 pass, 0 fail, 184 skipped); now 1079 tests (895 pass, 0 fail, 184 skipped). The 53 fewer tests come from test files deleted with the retired surfaces: receipts, live receipts, conversations, proxy audit payload, the Observational entity link, and the Customer/Agent row and config cases. The skipped count is unchanged, there are no new failures, and the baseline failure list is empty.
- **Lint:** the sorted per-file sets of rule messages are identical. The only difference is that the two `react-hooks/set-state-in-effect` errors in `components/layout/global-search.tsx` moved from lines 69/96 to 66/93, because A-OPS removed scope lines above them. The 26 pre-existing problems:
  - Errors are `set-state-in-effect` or impure render calls in these files: `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` ×2, `create-lead-form.tsx`, `operational-resource-page.tsx`, `report-sheet-examples.tsx`, `reporting-dashboard.tsx` ×2, Sales Intelligence `_legacy/*` ×5 and `settings-form.tsx`, plus react-compiler summary lines.
  - Warnings are in these files: `connect-booking-section.tsx`, `lead-sources-manager.tsx` ×2, `destination-selector.tsx`, `reporting-dashboard.tsx` ×2, `desk.tsx` (unused `serializeDeskUrl`), and `granotLifecycle.test.ts` (unused `_omitted`).

### Files changed by the integrator

- **Added:**
  - `lib/operations-registry/exclusiveEndDate.ts` and `.test.ts`
  - `lib/api/granotLiveReceipts.ts` (constant-only Daily hold; deleted again after the Daily fix, see "Resumed run")
- **Edited:**
  - `components/operations-registry/registry-changes.tsx`, `registry-overview.tsx` and `compatibility-observation-statement.tsx`
  - `lib/operations-registry/ownerLanguageDeck.ts`
  - `lib/api/registryEntityLinks.ts`
  - `lib/constants/domain.ts`
  - `lib/query/keys.ts`
  - `server/auth/authorization.ts` and `.test.ts`
  - `CONTEXT.md`
- **Deleted:**
  - `components/observational/entity-link.ts`, which removes the folder
  - `tests/observational-entity-link.test.ts`

### Remaining known issues

1. *(Resolved; see "Resumed run".)* **Daily dead links (coordinator decision).** On the protected Daily board, Granot cards still offer "Open in Live Events" (`/live-events`) and dead-letter cards still offer "Open Observational" (`/observational`). Both now show not-found. The fix touches only navigation:
   - In `lib/api/dailyOperationsBoard.ts`, drop the import on line 24 and the `add(LIVE_EVENTS_HREF, …)` on line ~495. Drop `OBSERVATIONAL_HREF` (line 32) and its `add(...)` on line ~515, but keep the Granot Health link.
   - In `components/daily/daily-copy.ts`, delete `openInLiveEvents` and `openObservational`.
   - Update `lib/api/dailyOperationsBoard.test.ts:328` and `tests/daily-copy.test.ts:25`.
   - Then delete `lib/api/granotLiveReceipts.ts`.

   None of this changes Daily facts, colours, counts or timing.
2. **Deploy order:** the Admin no longer blocks Admin-role GET on the receipts, receipts/live and `/admin/observability/**` endpoints. Deploy the S-GRANOT/S-OBS server removal no later than this Admin build.
3. **Registry Agents/Users tabs:** check them against the server's catalog-shaped `GET /admin/agents` (S-HIST item 2) in the integrated run against a live server. This was not exercised here, because unit tests only cover the client's handling of both shapes.
4. **Wave 2 (A-SI):**
   - `server/auth/authorization.ts` still has `REP_PROXY_ROUTES` and the Admin denial on `/admin/conversations/**`.
   - `proxyForwardHeaders.ts` `currentCsiScope` still checks historical scope.
   - `salesIntelligenceLeadHref` and the gallery fixtures with `database_scope=production` remain.
   - Build against `S-NUM-CONTRACT.md`.
5. **Wave 3 docs:**
   - `.cursor/rules/project-organization.mdc` still describes the scope selector, `database_scope` links, Live Events, the receipts BFF and Audit Log.
   - So do `uxdocs/live-events-tab-specification.md` and `uxdocs/lead-conversations-tab-specification.md`.
   - Server docs: see S-HIST item 3.
6. **Unrelated working-tree changes:** `SALES-OUTREACH-DESK.md` and the files under `docs/sales-outreach-desk/` (modified, plus untracked `END-TO-END-RUN.md` and `FINAL-HANDBACK.md`) were already in the tree and come from no wave-1 lane. The integrator did not touch them; the coordinator should decide whether they belong in the slimming commit.
7. **Data:** the `admin_audit_logs` drop is in `DELETION-MANIFEST.md`, `DATA-AND-STORAGE.md` and `ops/slimming/deletion-manifest.json`, gated on this Admin build being deployed. No other Admin collection is dropped. `admin_users` and `admin_user_invites` stay.

### Resumed run (2026-10-04, after the orchestrator crash)

The process crashed after the section above was written. This run re-read the working tree and both lanes' independent reviews, then finished the review follow-ups. Again, the integrator was the only agent editing the Admin tree, and it did not edit any Daily Operations file.

**State found on resume**

- The Daily navigation fix from Remaining issue 1 above is in the tree. The changes are in `lib/api/dailyOperationsBoard.ts`, `components/daily/daily-copy.ts`, `lib/api/dailyOperationsBoard.test.ts` and `tests/daily-copy.test.ts`; their mtimes are 00:43, after this file was written at 00:37:
  - the `LIVE_EVENTS_HREF` import and its "Open in Live Events" card link are gone;
  - `OBSERVATIONAL_HREF` and its "Open Observational" link are gone;
  - dead-letter cards keep "Open Granot Lifecycle Health";
  - `openInLiveEvents` and `openObservational` were removed from `DAILY_COPY`.
- `lib/api/granotLiveReceipts.ts` is deleted again, so the "constant-only Daily hold" above no longer exists. No source imports it. `rg granotLiveReceipts` finds only `tests/retired-destinations.test.ts`.

**Review findings (A-DEST reviewer; the A-OPS reviewer reported none)**

| Finding | Decision | Change |
|---|---|---|
| Low: `vantage-admin/CONTEXT.md` line 27 says Daily still links to `/live-events` and `/observational` and that `granotLiveReceipts.ts` holds the constant. Lines 41 and 45 credit SLIM-08 with retiring the Customers and Agents tabs. | Confirmed. `IMPLEMENTATION-PLAN.md` puts the Customer/Agent browse removal under SLIM-02, the scope removal under SLIM-03 and the audit removal under SLIM-08. | Line 27 now says Daily no longer links to either page and that the file is deleted. Lines 41 and 45 now say SLIM-02, and the scope sentence is tagged SLIM-03. The chrome line (19) now splits SLIM-02 (pages) from SLIM-08 (Audit Log). In `evidence/A-DEST.md`: the "Kept primitive: `components/observational/entity-link.ts`" line, cross-lane item 1 (Daily) and the `official-record.ts` → `entityHref` note are each marked as superseded or resolved at integration, with the replacement paths `components/operational/record-href.ts` and `lib/operations-registry/exclusiveEndDate.ts`. |
| Low: `.cursor/rules/project-organization.mdc` still documents the retired surfaces as live and tells agents to write audit rows | Confirmed (this is the rules file the Admin `AGENTS.md` points to) | Removed these rows: `app/api/audit-log`, `app/api/granot-live-receipts`, `components/observational`, `components/conversations`, `server/audit`, `audit.ts` and `conversations.ts`. Rewrote the following to the post-slimming state: the layout row (nav order, System order, no scope selector, the `RetiredDatabaseScopeCleanup` note), the analytics row (no Agent Sales report), the granot-lifecycle row (Health is the only page, redirects, requeue stays Owner-only), `server/models` (no `AdminAuditLog`), the Owner-only page list, the Admin proxy allow/deny lines, the route surface (Operational, Insight, Ops and Support), the scope and historical bullets (production only, no `database_scope`), the `admin.ts` and `granotLifecycle.ts` client rows, the query-key list, the intake paragraph on Live Events and Receipts, Ownership ("admin users and invites" replaces "admin audit DB", and audit was dropped from the invalidation list), and the Quality bullet. That bullet now says "Do not write audit rows", and its guard is `tests/retired-destinations.test.ts`. In the SI section, official-record links no longer pin `database_scope`, and SI now sits after Daily Operations. A `rg` of the file for the retired words still finds 12 lines. Each one either states that the surface is retired or describes a kept surface: the in-context CSV export or Granot Automation receipts. |
| Low: `server/auth/authorization.ts` still lets an Admin `POST /api/v1/admin/sheet-sync/retry`; its only UI caller was the deleted Observational Sheet Sync tab | Confirmed. `git show HEAD:lib/api/admin.ts` had `retrySheetSyncJobs` as the only caller, and it is gone. Daily has no Sheet Sync retry control: `rg -i "retry\|requeue" components/daily` finds only the board's own load-retry button. | Took the reviewer's second option: the allowance is removed. The proxy now denies an Admin-role POST to that path, and the Owner is unchanged. The server route and the `sheet_sync_*` collections stay. Tests: the new `SLIM-02: the retired Observational Sheet Sync retry is Owner-only at the proxy` (in `authorization.test.ts`) asserts Admin false and Owner true. The old Admin-true assertion in the sheet-contains test was removed. `repDenyByDefault.test.ts` now uses `POST /api/v1/booked-leads/from-source` as its example of an Admin-allowed POST. **Coordinator decision recorded:** failed Sheet Sync jobs are now repaired only through the server/ops path (Owner proxy call or server tooling). No dashboard control exists. Adding a retry control on a kept surface such as Daily would be new UI, and Daily is protected, so it was not built. |

**Cross-lane item finished in this run**

- S-GRANOT item 2 (optional): the Admin now reads `counter_coverage`, so Health no longer says "No command conflicts in the last 24 hours" while the window is still warming. SPEC §4.1 requires that unknown coverage be shown explicitly.
  - `lib/api/granotLifecycle.ts` adds an optional `counter_coverage` and a `GranotLifecycleCounterCoverage` type. Any value other than an explicit `"covered"` is parsed as `"unknown"`. An older server that omits the field still parses and renders as before.
  - In `components/granot-lifecycle/lifecycle-health.tsx`, when `window_24h` is `"unknown"`, the empty Command conflicts card reads: "Not known yet: the 24-hour count is still filling, so an empty list does not mean there were no conflicts."
  - Tests were added to the AC-31 Health test in `tests/granot-lifecycle-components.test.ts`. They cover the omitted field, `"partial"` parsed as unknown, and the warming copy present with the "No command conflicts" copy absent.

**Commands and results (resumed run)**

All commands were run in `C:/Users/Pinda/Proyectos/vantage/vantage-admin`. `--config.verify-deps-before-run=false` keeps pnpm from starting an install.

| Command | Result |
|---|---|
| `pnpm --config.verify-deps-before-run=false typecheck` (`tsc --noEmit`) | **exit 0, 0 errors** |
| `pnpm --config.verify-deps-before-run=false test` | **1080 tests: 896 pass, 0 fail, 0 cancelled, 184 skipped**, exit 0. That is one more than the first integration run: the new Sheet Sync retry test. The `counter_coverage` checks were added inside an existing test. |
| `node --import tsx --test` on authorization, repDenyByDefault, granot-lifecycle-components, granotLifecycle api, dailyOperationsBoard, daily-copy, daily-arrivals, daily-page, retired-destinations | 128/128 pass |
| `pnpm --config.verify-deps-before-run=false lint` | exit 1: **26 problems (18 errors, 8 warnings)**. The normalized, sorted list matches the clean-HEAD baseline (`scratchpad/lint-base.norm`) except that the two `global-search.tsx` `set-state-in-effect` errors moved from lines 69/96 to 66/93, because A-OPS removed lines above them. No new lint findings. |

**Baseline comparison (`scratchpad/baseline/`)**

| Check | Baseline | Now |
|---|---|---|
| Typecheck | exit 0 | exit 0 |
| Tests | 1132 tests: 948 pass, 0 fail, 184 skipped | 1080 tests: 896 pass, 0 fail, 184 skipped |
| Lint | 26 problems | 26 problems, same set |

- **Tests:** 52 fewer tests overall. The suites of deleted surfaces account for the drop, offset by the new SLIM tests. `admin-baseline-failures.txt` is empty, and there are no new failures.
- **Lint:** all 26 problems were already there before this work.

**Leftover sweep (resumed run)**

`rg -n -i "audit-log|AdminAuditLog|writeAuditLog|admin_audit_logs|granot-live-receipts|granotLiveReceipts|live-events|observational|/customers|/agents\b|/exports\b|agent-sales|agentSales|database-scope|database_scope|audit logged|sheet-sync/retry" app components lib server tests next.config.ts proxy.ts` (non-test hits)

No real leftovers remain. Every hit is in one of these groups:

- **Kept on purpose:**
  - The in-context CSV routes `api/v1/admin/exports/{resource}.csv` and `exports/analytics/{report}.csv`.
  - The catalog/Registry Agents paths, `/api/v1/admin/agents` and `/api/v1/admin/catalog/agents`, plus `AgentsManager`.
  - The retirement cleanup, `lib/state/database-scope.tsx` and `withoutRetiredDatabaseScope`.
  - The new SLIM-02 comment in `authorization.ts`.
- **Wave 2 (A-SI):**
  - `server/auth/proxyForwardHeaders.ts` scope check.
  - Sales Intelligence gallery fixtures and `salesIntelligenceAssessment.fixtures.ts` hrefs with `&database_scope=production`.

**Remaining known issues (replaces the list above)**

1. **Deploy order:** the Admin no longer blocks Admin-role GET on the receipts, receipts/live and `/admin/observability/**` endpoints. Deploy the S-GRANOT/S-OBS server removal no later than this Admin build.
2. **Sheet Sync repair (decision recorded above):** no dashboard control can retry exhausted Sheet Sync jobs. Repair is server/ops only. If the Owner wants a button back, it needs a new, coordinator-approved control on a kept surface.
3. **Registry Agents/Users tabs:** check them against the catalog-shaped `GET /admin/agents` (S-HIST item 2) in the integrated run against a live server.
4. **Wave 2 (A-SI):**
   - `REP_PROXY_ROUTES` and the `/admin/conversations/**` Admin denial in `server/auth/authorization.ts`.
   - `proxyForwardHeaders.ts` `currentCsiScope`.
   - `salesIntelligenceLeadHref`.
   - SI fixtures with `database_scope=production`.
   - Build against `S-NUM-CONTRACT.md`.
5. **Wave 3 docs:**
   - `uxdocs/live-events-tab-specification.md` and `uxdocs/lead-conversations-tab-specification.md`, which `CONTEXT.md` already labels as historical.
   - Server docs (S-HIST item 3, S-GRANOT item 3).
   - `.cursor/rules/project-organization.mdc` was brought current in this run.
6. **Unrelated working-tree changes:** `SALES-OUTREACH-DESK.md` and `docs/sales-outreach-desk/**` (modified, plus untracked `END-TO-END-RUN.md` and `FINAL-HANDBACK.md`) are not from any wave-1 lane and were not touched. The coordinator decides whether they belong in the slimming commit.
7. **Data:** the `admin_audit_logs` drop is gated on this Admin build being deployed. `admin_users` and `admin_user_invites` stay.

**Files changed in the resumed run**

- **Admin:**
  - `server/auth/authorization.ts` and `server/auth/authorization.test.ts`
  - `server/auth/repDenyByDefault.test.ts`
  - `lib/api/granotLifecycle.ts`
  - `components/granot-lifecycle/lifecycle-health.tsx`
  - `tests/granot-lifecycle-components.test.ts`
  - `CONTEXT.md`
  - `.cursor/rules/project-organization.mdc`
- **Server docs:** `evidence/A-DEST.md` (superseded markers) and this file.
