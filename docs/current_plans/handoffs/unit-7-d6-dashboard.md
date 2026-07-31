## Operations Registry work-package handoff

- Repository: `vantage-admin`
- Branch: `feature/operations-registry`
- Work package: Unit 7 — Dashboard D6 (hardening + acceptance)
- Depends on: D0–D5 integrated on the same branch

### Delivered

- **D6 — Query invalidation**
  - `invalidateRegistryQueries` expanded to also cover `details`,
    `publicEmployeeBooking`, and `workflows` (plus existing registry, catalog,
    sources, CPL, facets, lists, search, analytics, audit).
  - Tests assert the mutation→domain matrix via
    `REGISTRY_INVALIDATION_ROOTS` / `registryInvalidationQueryKeys()`.
  - All D0–D5 mutation success paths continue to call the central helper
    (including RingCentral persisted validation failures).

- **D6 — Authorization / failure states**
  - Role matrix unchanged and re-asserted in
    `server/auth/authorization.test.ts`: admin GET health/changes/overview;
    Owner-only mutations; audit-log page Owner-only; operations-registry
    readable by admin.
  - Health/Changes loading, error+retry, empty, and partial evidence states
    present. Structured `RegistryApiError` path retained for mutations.
  - Read-only banner clarifies health/history remain inspectable.

- **D6 — Accessibility / UX**
  - Registry shell tablist: `aria-controls` / `aria-labelledby`, roving
    `tabIndex`, Arrow/Home/End keyboard navigation, visible focus rings.
  - CPL mode tablist roles; health severity not color-only (text labels);
  - Changes diff table has caption + column headers; status announcements via
    `aria-live` on page totals.
  - Deep links land on the correct tab and highlight/select entity where the
    surface supports selection.

- **D6 — Cross-repository contract checks (static / fixture)**
  - Dashboard clients consume S1/S8 health finding codes and remediation
    actions without inventing enums client-side.
  - Signing secret remains server-only (`VANTAGE_ADMIN_PROXY_SIGNING_SECRET`);
    no client import of `server/` modules.
  - Proxy auth matrix tested for health/changes GETs and Owner mutations.
  - Live integration smoke against production was not performed (safe local /
    mocked tests only).

### Role / operation matrix (D0–D5)

| Surface | admin read | owner mutate |
|---------|------------|--------------|
| Overview / Health / Changes | yes | n/a (read) |
| Agents / Merchants | yes | yes |
| Sources / Granularities | yes | yes |
| Source resolution preview POST | yes | yes |
| CPL simple/advanced/corrections | yes | yes (correction preview Owner) |
| RingCentral routes | yes | yes |
| Admin Audit (`request_id`) | no (page Owner-only) | read |

### Mutation → invalidation matrix

Every successful registry mutation invalidates:
`operationsRegistry`, `catalog`, `sourceCompanies`, `cplRates`, `facets`,
`lists`, `details`, `search`, `analytics`, `auditLog`,
`publicEmployeeBooking`, `workflows`.

### Verification

- `vantage-admin`: `pnpm lint` / `typecheck` / `test` (**101** passed) / `build`
- `vantage-main-server`: `pnpm test` passed at recorded SHA (see acceptance)

### Next step

- Cross-repository acceptance record and merge/deploy authorization.
