# Source Company Granularity Analytics — Fix Handoff

Status: implementation complete, final review requested changes  
Date: 2026-08-07  
Repositories:

- `vantage-main-server`
- `vantage-admin`

Primary specification:

- `vantage-main-server/docs/current_plans/source-company-granularity-analytics.md`

## Mission for the next session

Fix the six final-review findings below, add regression coverage, rerun both
repositories' checks, and perform one final defect-first review before push.

Do not weaken the production/historical database separation described in the
primary specification.

## Non-negotiable database behavior

Production is the priority and supports registry-backed Source Company
granularity.

Historical:

- Uses the separate `vantagemovershistorical` database.
- Registers only Agent, Customer, FormLead, CallLead, BookedLead, and
  CancelledLead historical models.
- Does not contain Source Company or Source Granularity registry collections.
- Must group source analytics at company level only.
- Must return `granularities: []`.
- Must never query production registry collections while serving a concrete
  historical request.
- Must not fabricate child rows from form/call lead type.
- Keeps Overview lead cost and last-seven-day blocks disabled.
- Does not support receiver-agent analytics.

Combined:

- Merges production and historical company-level parent metrics.
- Retains production granularity children only.
- Therefore combined parent totals can exceed the sum of visible children.
- UI copy must continue to state that combined child rows are production-only.

## Current implementation

Server files added or changed:

- `src/services/analytics/sourceHierarchy.ts`
- `src/services/analytics/sourceHierarchy.test.ts`
- `src/services/analytics/sourcePerformance.service.ts`
- `src/services/analytics/sourcePerformance.service.test.ts`
- `src/services/analytics/overview.service.ts`
- `src/services/analytics/leadCost.service.ts`
- `src/services/analytics/leadCost.service.test.ts`
- `src/services/analytics/analyticsMerge.ts`
- `src/services/analytics/analyticsExport.service.ts`
- `src/services/analytics/analytics.service.test.ts`

Admin files added or changed:

- `lib/api/admin.ts`
- `components/data-table/source-company-hierarchy-table.tsx`
- `components/dashboard/home-overview.tsx`
- `components/analytics/analytics-dashboard.tsx`
- `tests/source-company-hierarchy.test.ts`

The production Overview now shares one in-request Source Company label index
across all-time lead cost, last-seven-day sales, and last-seven-day lead cost.
Do not regress to repeated registry reads.

## Required fixes

### 1. CSV hierarchy rows double-count additive metrics

Severity: P2

Location:

- `vantage-main-server/src/services/analytics/analyticsExport.service.ts`
  around `rowsForCsv`, source-company report branch.

Problem:

Production source exports currently emit the rolled-up company parent and every
granularity child. Summing bookings, deposits, binder amounts, or funnel counts
from the CSV counts production data twice. Combined exports double-count their
production portion.

Expected fix:

- When a company has children, export leaf rows only.
- When a company has no children, export the company row.
- Keep company identity and label columns on child rows.
- Do not emit nested `granularities` JSON.

Required tests:

- Production company with two children produces two CSV data rows, not three.
- Summed child additive metrics equal the company total.
- Historical company with no children produces one company-level row.
- Combined export does not duplicate the production contribution.

### 2. Employee-booking source snapshots become `unknown`

Severity: P2

Locations:

- `vantage-main-server/src/services/analytics/analyticsFilters.ts`
  `sourceCompanyExpression` and `sourceGranularityExpression`.
- Callers group on `derived_source_company` and
  `derived_source_granularity_key` in Overview and source performance.

Problem:

The derived source expressions currently inspect joined form/call leads but do
not use durable `employee_source_snapshot` source identity. Pending leadless
employee bookings can therefore land under `unknown`, and a granularity filter
can omit them.

Expected fix:

- Add `employee_source_snapshot.source_company` and
  `employee_source_snapshot.source_granularity_key` to the production booking
  fallback chain.
- Preserve the existing form/call source precedence unless the domain contract
  or reporting implementation proves snapshot precedence is canonical.
- Review the reporting implementation in
  `src/services/reporting/query/canonicalReporting.ts` for the established
  fallback order.
- Do not add these fields to historical models.

Required tests:

- A booked lead without a joined form/call lead resolves from its employee
  source snapshot.
- Granularity filtering can match the snapshot-backed booking.
- Existing joined form/call attribution behavior remains unchanged.

### 3. Normalized leaf collisions create duplicate children

Severity: P2

Location:

- `vantage-main-server/src/services/analytics/sourceHierarchy.ts`
  `nestSourceCompanyRows`.

Problem:

Company aliases and case variants are normalized, but every input leaf is
appended. Two raw leaves that normalize to the same
`(source_company, source_granularity_key)` can produce duplicate children and
duplicate CSV rows.

Expected fix:

- Fold leaves by normalized company plus normalized granularity key before
  creating child rows.
- Sum only the configured additive fields.
- Recompute derived rates after the merge.
- Preserve registry-first labels and `unknown` children.

Required tests:

- Company alias/case variants collapse into one parent.
- Granularity key case variants collapse into one child.
- Additive fields sum correctly.
- Rates are recomputed rather than summed.

### 4. Flat historical source tables use duplicate React keys

Severity: P2

Location:

- `vantage-admin/components/analytics/analytics-dashboard.tsx`
  `TableView`.

Problem:

The hierarchy table is used only when at least one row has children.
Historical source-company rows intentionally have no children, so they fall
back to the generic table. Its key expression can evaluate to `"--"` for every
source row, and it exposes company slug and label as separate columns.

Expected fix:

- Use `SourceCompanyHierarchyTable` for
  `source-company-performance` and `source-company-funnel` whenever source rows
  exist, even if all `granularities` arrays are empty.
- Flat historical rows should appear as non-expandable parent rows.
- Keep non-hierarchy reports on the generic table.

Required tests:

- Historical hierarchy reports choose the hierarchy renderer.
- Multiple historical companies have stable unique keys.
- Historical rows render company labels without duplicate identity columns.

### 5. Treegrid semantics promise unsupported keyboard behavior

Severity: P2 accessibility

Location:

- `vantage-admin/components/data-table/source-company-hierarchy-table.tsx`.

Problem:

The table currently declares `role="treegrid"` and row levels but does not
implement the managed focus and arrow-key behavior expected of a treegrid.

Expected fix:

Choose one complete approach:

1. Prefer native table semantics with accessible disclosure buttons,
   `aria-expanded`, and `aria-controls`; remove unsupported treegrid/row-level
   claims, or
2. Implement the full WAI-ARIA treegrid keyboard interaction pattern.

The simpler native-table disclosure pattern is sufficient for this feature.
Keep stable controlled-row IDs.

Required tests or verification:

- Toggle has an accurate accessible name.
- `aria-expanded` changes with state.
- `aria-controls` references existing child rows.
- Keyboard users can reach and activate the disclosure with normal Tab and
  Enter/Space behavior.

### 6. Charts show slugs instead of canonical company labels

Severity: P3

Location:

- `vantage-admin/components/analytics/analytics-dashboard.tsx`
  `ReportChart` pie labels and generic chart label selection.

Problem:

Source hierarchy charts correctly remain parent-only, but they prefer
`source_company` over the new `source_company_label`, exposing slugs such as
`tbm_prime_leads`.

Expected fix:

- Prefer `source_company_label`.
- Fall back to `source_label`, then `source_company`, then the existing generic
  label key.
- Continue stripping/ignoring `granularities` before charting.

Required tests:

- Source chart displays the canonical company label.
- Missing canonical label falls back to the source slug.
- Child rows never become chart series.

## Current verification baseline

Before the final review findings:

Server:

- `pnpm typecheck` passed.
- Full suite passed (902 tests in the implementation run; a later review run
  reported 903).
- `git diff --check` passed.

Admin:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- Full suite passed (173 tests).
- `git diff --check` passed.

Passing checks do not resolve the six findings; add focused regression tests.

## Commands for completion

Server:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Admin:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

## Worktree caution

No commit has been created.

There were pre-existing changes outside the implementation:

- Both repositories' `.cursor/rules/project-organization.mdc` files are
  modified.
- `docs/current_plans/source-company-granularity-analytics.md` is untracked in
  the server repository.

Do not discard or overwrite those files. Review staging deliberately before
commit/push.

## Done definition

- All six findings are fixed.
- Production company and child metrics remain correct.
- Historical concrete scope performs no registry reads and exposes no children.
- Combined parents retain only production children with accurate UI copy.
- CSV totals cannot be double-counted by summing exported rows.
- Employee snapshot-backed bookings resolve to the correct source granularity.
- Normalized collisions do not create duplicate children.
- Historical analytics tables render cleanly with stable keys.
- Hierarchy disclosure semantics are accessible and truthful.
- Source charts use canonical labels and remain company-only.
- Both repositories pass their full verification commands.
- One final defect-first review reports no actionable findings.
