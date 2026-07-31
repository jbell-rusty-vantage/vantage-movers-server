## Operations Registry work-package handoff

- Repository: `vantage-admin`
- Branch: `feature/operations-registry`
- Base SHA: `2bc359e31f94492bce83a01e2e44a26710f6503a` (`main` at branch creation)
- Head SHA: uncommitted working tree; no commit requested
- Work package: Unit 5 — Dashboard D0–D3 (registry shell/signing, Agent/Merchant, Source Company/Granularity, CPL)
- Integration branch expected: `feature/operations-registry`
- Server packages consumed: S1–S5 (see `unit-1-s1-foundation.md`, `unit-1-s2-catalogs.md`, `unit-1-s3-sources.md`, `unit-2-s4-s5-cpl.md`)
- Server HEAD observed during implementation: `ec07c8be1c418a5bd084ca055c5f107edfc2b665` on `vantage-main-server` `main`

### Delivered

- **D0 — Signed actor transport and registry shell**
  - Canonical HMAC signing in `server/auth/proxySigning.ts`, byte-aligned with
    `vantage-main-server` `trustedActorCanonical.ts` (newline payload order,
    method/path binding, lowercase hex HMAC-SHA256).
  - Proxy attaches `x-vantage-admin-*` identity, request id, timestamp, and
    signature; forwards the same `request_id` into local `AdminAuditLog`.
  - `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` is server-only (never `NEXT_PUBLIC_*`).
  - Owner-only proxy mutations for registry surfaces; authenticated `admin` may
    GET registry state. Source-resolution preview POST remains admin-readable.
    CPL correction preview POST is Owner-only (matches server
    `requireRegistryOwnerActor`).
  - New dashboard route `/operations-registry` (not under Owner-only Settings),
    registered in nav, shell, route guard, and `canAccessDashboardPath`.
  - Overview / Health / Changes UI + `queryKeys.operationsRegistry.*`.
  - Structured registry errors preserved through proxy and browser clients
    (`registry_code`, `remediation`, `request_id`, `issues`).

- **D1 — Agent and Merchant UI**
  - Registry-backed create / rename / activation / dependency preview.
  - Active-only default with explicit “Show inactive”.
  - Granot CRM username editable by Owner after create (unique; correction resets verification).
  - No delete control. Owner mutation controls; admin read-only banner.

- **D2 — Source Company and first-class Granularity UI**
  - Company metadata saves never submit embedded `granularities[]`.
  - Independent granularity create/edit/activation with immutable
    `company_slug` / `granularity_key` / channel-after-activation behavior
    enforced by server feedback.
  - Defaults, projection mode (`derived_import` default, `direct_write` opt-in),
    dependency preview, and `POST /source-resolution/preview`.
  - Sheet IDs labeled as stored configuration, not proof of active direct writes.

- **D3 — CPL UI**
  - Simple Mode from `GET /cpl/snapshot`: shared NY business date, dirty-row
    tracking, atomic POST of changed rows + expected revisions only; `$0.00`
    distinct from Missing; stale revision preserves drafts.
  - Advanced Mode: period past/current/future with inclusive owner ends;
    `add_future` / `split` / `correct_period` / `replace_schedule` commands.
  - Corrections: Owner preview → confirm with `preview_hash` + revision → job
    poll (`pending|processing|completed|failed|cancelled`) → cancel when
    allowed; ordinary schedule edits labeled as non-rewriting of prior leads.
  - Settings demotes legacy CPL to compatibility-only; primary edits live under
    Operations Registry → CPL.

### Files

- Added:
  - `server/auth/proxySigning.ts` (+ tests)
  - `lib/api/{operationsRegistry,registryAgents,registrySources,registryCpl,registryRequest,registryInvalidation}.ts`
  - `lib/api/registryCpl.simple.test.ts`
  - `app/(dashboard)/operations-registry/page.tsx`
  - `components/operations-registry/*` (shell, overview, changes, agents,
    merchants, catalog-registry-manager, source-companies-manager, cpl-manager,
    registry-api-error)
- Modified:
  - `app/api/proxy/[...path]/route.ts`
  - `server/auth/{trustedProxyHeaders,authorization,routeGuard}.ts` (+ tests)
  - `server/vantage-api/{errors,response}.ts`
  - `lib/env/server.ts`, `.env.example`, `tests/setup-env.ts`
  - `lib/query/keys.ts` (+ tests), `lib/api/types.ts`
  - `components/layout/{dashboard-nav,dashboard-shell}.tsx`
  - `components/settings/settings-tabs.tsx` (demote catalog/source/CPL; keep
    Moving Carriers + legacy CPL compatibility)
- Intentionally untouched:
  - Legacy manager implementations remain on disk but are no longer primary nav
    (`catalog-manager`, `source-company-manager`, `cpl-rate-manager`)
  - RingCentral UI (Unit 6 / D4)
  - Booking inactive-value corrective selector polish beyond existing
    `agentIdOptions` pattern (ordinary new-booking selectors stay active-only)

### Route / navigation decision

- Operations Registry is a first-class dashboard route at `/operations-registry`
  with URL tabs: `overview | agents | merchants | sources | cpl | changes`.
- Readable by `owner` and `admin`; mutations gated in UI (`readOnly`) and proxy.
- Settings remains Owner-only for carriers / residual legacy CPL.

### Auth matrix (proxy)

| Role | Registry GET | Source-resolution preview POST | CPL correction preview POST | Other registry mutations |
|------|--------------|--------------------------------|-----------------------------|--------------------------|
| owner | yes | yes | yes | yes |
| admin | yes | yes | no | no |

### Contract notes for the next agent

1. **HTTP catalog shape is legacy-stripped.** List/detail return
   `CatalogItem` (`id`, `name`, `granot_crm_username`, …). Nested
   `granot_identity` (verified / last_observed) is **not** exposed over HTTP
   today. UI shows configured username only; do not assume verification badges
   until the server contract expands.
2. **Agents/merchants paths** remain `/api/v1/admin/agents|merchants` (plus
   catalog list aliases). There are no `/operations-registry/agents` URLs.
3. **CPL correction job statuses:** `pending | processing | completed | failed | cancelled`.
4. Signing path must be the main-server path (leading `/`, no query), matching
   Express `originalUrl` normalization.
5. Browser clients must use `lib/api/registryRequest.ts` (or equivalent) so
   `registry_code` / `remediation` survive; do not use the plain catalog
   `requestJson` helper for registry mutations.

### Verification

- `npx tsc --noEmit`: passed
- `node --import tsx --test "{lib,server,tests}/**/*.test.ts"`: **85** passed, 0 failed
  - Includes proxySigning canonicalization, trusted header signing, Owner/admin
    registry auth matrix, operationsRegistry query keys, Simple CPL changed-row
    calculation
- `npx next build`: passed; `/operations-registry` present in route table
- Focused re-check after contract alignment (correction preview Owner-only,
  job status `processing`, Granot flattened username): auth + CPL tests passed

### Operational notes

- Environment (dashboard, server-only):
  - `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` — must match main-server
  - Existing `VANTAGE_API_BASE_URL` / `VANTAGE_API_SECRET` still required
- Deploy dashboard signing before enabling fail-closed signature enforcement on
  the server for production registry traffic.
- Local `.env` may contain the shared secret; it is gitignored. Never commit
  secrets. `.env.example` documents the variable name only.
- Invalidate via `invalidateRegistryQueries` after registry mutations
  (registry, catalog, source companies, CPL rates, facets, lists, search,
  analytics, audit).

### Risks and known gaps

- Uncommitted branch; next agent should commit (or rebase) before merge.
- Server Granot verification fields are not on the HTTP catalog contract yet;
  Unit 7 / a contract update may be needed for full D1 “identity status” UX.
- Booking create form still uses active-only catalog options; inactive retention
  for **edit** flows should be verified against operational edit surfaces if
  Owner corrective selection is required beyond create.
- Advanced `replace_schedule` uses a JSON textarea for period arrays; may want
  a structured editor later.
- RingCentral (D4) and Health/Changes hardening (D5–D6) are not in this package.
- End-to-end smoke against a live S1–S5 server was not automated here; UI error
  states will surface if the API host lacks registry routes or a matching
  signing secret.

### Rollback

- Redeploy prior `vantage-admin` without the Operations Registry route/signing.
- Signing headers are additive for non-registry endpoints; removing them does
  not require data migration.
- Do not delete server registry collections when rolling back the dashboard.

### Next step

- **Commit** this branch in `vantage-admin` when requested, then merge into the
  dashboard integration branch / open a PR.
- Next dashboard package: **Unit 6 — D4 RingCentral** (`10-unit-6-dashboard-d4.md`),
  after confirming S6 server handoff (`unit-3-s6-s7-ringcentral.md`) contracts.
- Reuse D0 shell tabs, signed proxy, `registryRequest` error shape, Source
  Granularity selectors, and Owner/read-only gating from this handoff.
- Then Unit 7 — D5–D6 Health/Changes hardening and cross-repo acceptance
  (`11-unit-7-dashboard-d5-d6.md`).
