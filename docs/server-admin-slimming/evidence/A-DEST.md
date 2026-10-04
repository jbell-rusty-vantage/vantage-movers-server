# A-DEST evidence: Admin destinations (SLIM-02) and Admin Audit Log removal (SLIM-08)

Repository: `vantage-admin`, branch `slim/server-admin`, uncommitted (the coordinator commits). Date: 2026-10-03.

## What changed and why

### Retired destinations (SPECIFICATION §2)

The sidebar entries **and** the route trees are gone for `/customers`, `/agents`, `/observational`, `/exports`, `/audit-log`, `/reports/agent-sales`, `/conversations` and `/live-events`. A request for any of them now renders Next's normal not-found page. No placeholder pages remain.

- `/granot-lifecycle` and `/granot-lifecycle/receipts` call `permanentRedirect(GRANOT_LIFECYCLE_HEALTH_HREF)`. They drop the query string, so old receipt filters are not carried over. Health is now the only Granot Lifecycle page. The Receipts/Health subnav and its layout were deleted, because a tab bar with one tab adds nothing.
- The sidebar's Granot Lifecycle entry now points straight at `/granot-lifecycle/health` and is visible to Admin too. Admin always had access to Health (`canAccessDashboardPath` allows it). Admin used to reach it through Observational, which is now gone, so without this entry Admin would have no way in. Owner-only pages are unchanged.
- The Live Events alias `/ingestion/granot/live` (both the page and the `next.config.ts` redirect) was removed. It now returns not-found, as other retired destinations do.
- The Admin permission maps were updated:
  - `server/auth/authorization.ts` drops `/audit-log`, `/conversations` and `/live-events` from the owner-only page prefixes. It also drops the proxy rules for `granot-lifecycle/receipts` and `receipts/live` and the whole `/api/v1/admin/observability/**` block. Those server endpoints are removed by S-GRANOT and S-OBS. After this change an Admin is denied any non-GET request on those paths. A GET would reach the server and get a 404 once the server cut is deployed.
  - `server/auth/routeGuard.ts` drops `/conversations`, `/customers`, `/agents`, `/observational`, `/audit-log`, `/exports` and `/reports` from `DASHBOARD_PATH_PREFIXES`.
  - `components/layout/dashboard-shell.tsx` drops the retired owner-only prefixes.
- Exclusive code deleted: the Live Events stream UI, the receipt-search page and its payload SidePanel, the conversations page, the Agent Sales report, the Observational components (events, incidents, notifications, reports, sheet-sync, overview, badges, shared facets), and `pretty-json`. Their client helpers went too: `lib/api/{audit,conversations,granotLiveReceipts}.ts` and the receipt-list client in `lib/api/granotLifecycle.ts`. The BFFs `app/api/granot-live-receipts` and `app/api/audit-log` were also deleted.
- Query keys removed from `lib/query/keys.ts`: `exports`, `auditLog`, `reports`, `conversations`, `observability` (including `sheetSync`) and `granotLifecycle.receipts`. Every invalidation of those keys was removed from the forms, Manual, reconciliation, settings, catalog and `registryInvalidation`.
- Contextual links to retired pages were removed:
  - Overview's Top Agents "View all" link to `/agents`.
  - The Testimonials Customer links (list and detail) to `/customers?record=`. The customer name is still shown, as plain text.
  - Booking Reconciliation's sheet-sync job links to `/observational`. The job facts are still shown, as text.
  - In Registry Changes, the "Open Admin Audit" link, the Admin Audit explanation and the "Correlate with Admin Audit" placeholder. The request id is still shown, for every role.
  - `entityHref` no longer maps `customer`, `agent` or `sheet_sync_*`.
- Kept primitive at lane end (superseded at integration): `components/observational/entity-link.ts`, trimmed to `entityHref` and `exclusiveEndDate`. At integration, `official-record.ts` already used A-OPS's `components/operational/record-href.ts`, `exclusiveEndDate` moved to `lib/operations-registry/exclusiveEndDate.ts`, and `entity-link.ts`, the `components/observational/` folder and `tests/observational-entity-link.test.ts` were deleted (see `INTEGRATION-ADMIN.md`). `observational-delete-controls.tsx` was deleted after A-OPS moved `SelectionCheckbox` into `components/operational/selection-checkbox.tsx`.
- Before deleting `components/conversations`, I checked that `components/sales-intelligence` imports nothing from it or from `lib/api/conversations` (grep: none).

### Admin Audit Log (SPECIFICATION §6)

- Deleted `server/models/AdminAuditLog.ts` and its export, the whole of `server/audit/` (`writeAuditLog`, `redactPayload`, `proxyAuditPayload` and their tests; nothing retained used them), `app/api/audit-log` and the dashboard page.
- `app/api/auth/{login,logout,refresh}` no longer write audit rows. The `getRequestMetadata` helper (`server/auth/request.ts`) and `resolveAdminIdFromRefreshToken` were deleted, because only those audit writes used them.
- `app/api/proxy/[...path]` no longer writes audit rows. The audit-only helpers went with them: `MUTATING_METHODS`, `isExportRequest`, `getDatabaseScope` and `auditProxyRequest`. Forwarding is unchanged: the role check, the CSI scope check, `proxyForwardHeaders` (signed actor headers and idempotency/request id), CSV/text/empty/JSON response mapping, and the error body including `request_id`.
- Users service: the `audit` port was removed from `UsersDeps` and the wiring. In `service.ts`, `withFailureAudit`, the audit calls, `pickChanged` and the audit-only `action` parameter of `updateAdminUser` were removed. All guards and their order are unchanged: last-Owner guard and compensation, the rep/Agent checks, email uniqueness, token_version bumps, invite revocation and single-use invites.

## Retained behavior preserved and how it was verified

- Login, refresh, logout, lockout and invalid-token behavior come from `server/auth/session.ts`, which was not edited apart from deleting `resolveAdminIdFromRefreshToken`.
  - `server/auth/*.test.ts` passes, including routeGuard, authorization, repAccess, repDenyByDefault, proxySigning, proxyForwardHeaders and trustedProxyHeaders.
  - `server/users/mongoStore.replica.test.ts` passes 5/5 against the local `csi01` replica (`mongodb://127.0.0.1:27189/?replicaSet=csi01`, test DB `testvantagemovers_t3admusers`, which the test drops). It covers rep login, session ending on set-password and deactivate, the unique rep-per-Agent index, the single-use invite race and the concurrent Owner step-down.
- Users service: `server/users/service.test.ts` and `lastInvite.test.ts` pass with the audit port removed. The race test still asserts that at most one racer wins and that each refusal is `last_owner`.
- Health is reachable by Owner and Admin: authorization tests, `dashboard-nav.test.ts` (Admin System section includes `/granot-lifecycle/health`), and a new redirect test in `granot-lifecycle-components.test.ts`. Lifecycle requeue stays Owner-only at the proxy (new assertion).
- New guards:
  - `tests/retired-destinations.test.ts` checks that the retired route and BFF folders are absent, and that no source outside tests contains `writeAuditLog`, `AdminAuditLog` or `admin_audit_logs`.
  - The `dashboard-nav` and `dashboard-chrome` tests check that no retired href appears in the sidebar or command palette for either role.
  - The `keys.test` test checks that the retired query roots are absent.
  - The `routeGuard.test` test checks that the retired prefixes are not dashboard paths.
- Daily Operations files were not edited.

## Checks run (real results)

| Command (vantage-admin) | Result |
| --- | --- |
| focused: nav, chrome, granot-lifecycle components, entity-link, retired-destinations, keys, granotLifecycle api, registryEntityLinks/Invalidation, `server/auth/*`, `server/users/*`, reconciliation, operations-registry, registry-shell, accept-invite, booking-form, manual-create-lead, intakes, job-timeline-deep-link | 259 tests: 244 pass, 0 fail, 15 skipped (replica gates) |
| `ADMIN_USERS_REPLICA_URI=…27189… node --import tsx --test server/users/mongoStore.replica.test.ts` | 5/5 pass |
| full `node --import tsx --test --test-concurrency=4 "{lib,server,tests}/**/*.test.ts"` (last run) | 1049 tests: 855 pass, 10 fail, 184 skipped. 3 of the failures are Daily (see the cross-lane item below). The other 7 are A-OPS work in progress: `operational-rows`, Reset/database_scope, and the AC-23 invalidation `details` key scope. None of the 10 is in a file A-DEST touched. |
| `pnpm typecheck` (after `pnpm exec next typegen` refreshed `.next/types`) | The only remaining A-DEST-caused error is `lib/api/dailyOperationsBoard.ts(24)`, which still imports the deleted `@/lib/api/granotLiveReceipts`. The other remaining errors are in `tests/operational-rows.test.ts` (A-OPS). The stale `.next/dev/types` from an old `next dev` still lists deleted routes; it regenerates on the next `next dev` or `build`. |
| `pnpm exec eslint` on every touched path | 2 errors and 1 warning, all pre-existing in lines I did not touch: `needs-you.tsx` `Date.now()` purity, `create-lead-form.tsx` setState in an effect, and an unused `_omitted` in `granotLifecycle.test.ts` |

During the first full run, many `tests/sales-intelligence/*` files failed with `spawn UNKNOWN` and `ENOMEM`. Other lanes were running heavy jobs at the same time, so the machine was short of memory. With concurrency at 4, they pass.

## Open cross-lane items

1. **Daily Operations (protected), coordinator decision. Resolved at integration:** the navigation-only fix below was applied, and `lib/api/granotLiveReceipts.ts` stays deleted (see `INTEGRATION-ADMIN.md`). Original note: `lib/api/dailyOperationsBoard.ts` imports `LIVE_EVENTS_HREF` from the deleted `lib/api/granotLiveReceipts.ts` (line 24) and adds a card link `add(LIVE_EVENTS_HREF, DAILY_COPY.openInLiveEvents)` (line ~495). It also defines `OBSERVATIONAL_HREF = "/observational"` and links to it for `exception.dead_letter` (line ~515). Both destinations are retired, so Daily currently fails typecheck, and three Daily test files fail to load.
   - The minimal fix, which I did not apply because the file is protected: remove the import and the Live Events `add(...)` line. Remove `OBSERVATIONAL_HREF` and its `add(...)` line, keeping the Granot Health link beside it. Delete `openInLiveEvents` and `openObservational` from `components/daily/daily-copy.ts`. Update `lib/api/dailyOperationsBoard.test.ts:328` and `tests/daily-copy.test.ts:25`.
   - Card links are navigation, not Daily facts, colours, counts or timing. Daily's colour constants (`lib/api/dailyOperationsColors.ts`) are untouched; only the deleted Live Events component imported them.
2. **A-OPS:**
   - `components/operational/lead-message-section.tsx:43` still links to `/observational?tab=events…`.
   - The operational CSV success copy that says "audit logged" (SPECIFICATION §2) is in A-OPS files.
   - `app/(dashboard)/search/page.tsx` still maps `customers` and `agents` result types to `/customers` and `/agents`; the server no longer returns those types once S-HIST lands. I left this file to A-OPS, which is editing it for scope.
3. **Wave 2 (A-SI):**
   - `server/auth/authorization.ts` still denies Admin `/api/v1/admin/conversations/**` and lists the rep conversation and analysis proxy routes. Remove them when S-AI deletes those server routes.
   - (Resolved at integration.) `components/sales-intelligence/lib/official-record.ts` used to import `entityHref` from `components/observational/entity-link.ts`; it now uses `components/operational/record-href.ts`, and `entity-link.ts` is deleted.
4. **Wave 3 docs:** `.cursor/rules/project-organization.mdc`, `CONTEXT.md` and `uxdocs/live-events-tab-specification.md` still describe Live Events, the receipts BFF and Audit Log.
5. **Deploy order:** deploy S-GRANOT and S-OBS (server) no later than this Admin build. Until then, the removed Admin proxy denies let an Admin role reach `GET …/granot-lifecycle/receipts` and `GET /admin/observability/**` on an old server.

## DATA-MANIFEST NEEDS

- **DROP** the collection `admin_audit_logs` in the database named by the Admin's `ADMIN_AUTH_DB_NAME` (the example is `vantageadmin`; resolve the real name from the deployed Admin env and do not hardcode it). Use the same cluster as the Admin's `MONGODB_URI`. Its indexes go with it: `timestamp_1`, `timestamp_-1`, `admin_user_id_1_timestamp_-1`, `action_1`, `action_1_timestamp_-1`, `ok_1`.
  - After this change, no Admin code path writes the collection (source-scan test), so the drop cannot be undone by a recreate once this Admin build is live.
  - Fields that were stored, for the backup manifest: `timestamp`, `admin_user_id`, `admin_email`, `action`, `entity_type`, `entity_id`, `database_scope`, `request_payload`, `response_status`, `ok`, `error_message`, `request_id`, `ip_address`, `user_agent`.
- **MUST NOT remove** these, in the same database:
  - `admin_users`, the AdminUser collection (sessions, token_version, rep `agent_id`).
  - `admin_user_invites`, the AdminUserInvite collection.
  - Any other collection in the Admin auth database.
- **MUST NOT remove** these server collections, which have nothing to do with this Admin audit:
  - `entity_changes`, `domain_command_executions` and `operations_registry_changes`.
  - The `sales_intelligence_*` audit and command collections.
  - `granot_webhook_receipts`. The receipt-search and Live Events pages only read it, and it is protected (SPECIFICATION §5).
- No Exports-only, Live Events-only or Customers/Agents-browse collection exists on the Admin side.
