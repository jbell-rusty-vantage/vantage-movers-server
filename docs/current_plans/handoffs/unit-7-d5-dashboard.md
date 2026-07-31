## Operations Registry work-package handoff

- Repository: `vantage-admin`
- Branch: `feature/operations-registry`
- Work package: Unit 7 — Dashboard D5 (Registry Health + Change history)
- Integration branch expected: `feature/operations-registry`
- Server packages consumed: S1 overview/health/changes; S5/S7/S8 finding
  codes and remediation metadata (merged on `vantage-main-server` `main`)

### Delivered

- **D5 — Registry Health UI**
  - Typed findings presentation on Overview via
    `registry-health-findings.tsx`: severity (text + badge), stable code,
    summary, evidence grid, entity type/ID, first/last observed, actionable
    vs informational.
  - Remediation mapped from typed `remediation.action` only
    (`lib/api/registryEntityLinks.ts`); no inference from summary text.
  - Owner sees enabled remediation deep links; read-only admin sees evidence
    and explicit “requires owner” copy. Env/cache/compatibility/migration
    actions show review guidance without fake mutations.
  - Registry-specific deep links for agent, merchant, source company,
    granularity, CPL schedule/correction job, RingCentral route/assignment,
    plus overview targets for cache/compatibility/migration.

- **D5 — Registry Change history**
  - URL-stable filters: entity type, entity ID, action, actor ID, request ID,
    date range, pagination (`useUrlTableState`, `tab=changes` preserved).
  - Date-only end date advanced one day so inclusive `$lte` covers the
    selected calendar day; labeled as instant timestamps (not NY CPL dates).
  - Before/after readable diff (`registrySnapshotDiff.ts`): added/removed/
    changed, nested fields, redacted values never expanded, truncated at 200
    rows.
  - `request_id` correlates to Admin Audit: Owner link to
    `/audit-log?request_id=…`; local audit API/UI gained `request_id` filter
    and column. Admin role sees request id text (Audit page remains Owner-only).
  - Explicit copy that Registry Changes ≠ Admin Audit ≠ Operational Events.

### Files

- Added:
  - `lib/api/registryEntityLinks.ts` (+ tests)
  - `lib/api/registrySnapshotDiff.ts` (+ tests)
  - `components/operations-registry/registry-health-findings.tsx`
- Modified:
  - `components/operations-registry/registry-overview.tsx`
  - `components/operations-registry/registry-changes.tsx`
  - `lib/api/operationsRegistry.ts`
  - `app/api/audit-log/route.ts`
  - `app/(dashboard)/audit-log/page.tsx`
  - Deep-link selection wiring in catalog/sources/CPL/RingCentral managers

### Verification (D5 scope)

- Covered by Unit 7 combined gate (see D6 / acceptance handoff):
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` on dashboard.

### Next step

- D6 hardening handoff (`unit-7-d6-dashboard.md`) and cross-repo acceptance.
