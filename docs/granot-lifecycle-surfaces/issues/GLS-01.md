# GLS-01 — Ingestion cleanup and Granot Lifecycle Health home

> **Contract maturity: implementation-ready.** Session 1 (Admin). Move
> Health, strip the Granot nest, reorder Ingestion. **No receipt search
> UI. No server API.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-lifecycle-surfaces-specification.md`](../granot-lifecycle-surfaces-specification.md)
  — §1, §2, §3.1, §9. Wins on IA, routes, redirects, and page auth.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Admin map:** `vantage-admin/.cursor/rules/project-organization.mdc`
- **Shipped Live Events move:** `vantage-admin/uxdocs/live-events-tab-specification.md`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

Give Health a System home and stop Granot workflow from duplicating
Intakes and Job Timeline. After this issue, Ingestion is ingress only
and Granot Lifecycle exists as a sidebar tab whose only shipped surface
is Health.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only. No main-server runtime change.
- **Branch:** current Admin desk branch, or `granot-lifecycle-surfaces`
  if that is how this desk is isolated. See the protocol.
- **Prerequisites:** none. This issue is startable in parallel with
  GLS-02.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-01; **reverify at implementation**.

- `components/ingestion/ingestion-subnav.tsx` items:
  Best Relocation `/ingestion` first, Granot workflow `/ingestion/granot`
  second (Owner-only).
- `app/(dashboard)/ingestion/page.tsx` renders
  `BestRelocationIngestionDashboard`.
- `app/(dashboard)/ingestion/granot/page.tsx` renders
  `GranotAutomationDashboard`. Layout is Owner-gated and wraps
  `GranotNavigation`.
- `components/granot-lifecycle/granot-navigation.tsx` tabs:
  Automation, Lifecycle, Intakes, Job timeline, Health.
- Lifecycle queue:
  `app/(dashboard)/ingestion/granot/lifecycle/page.tsx` →
  `LifecycleDashboard`.
- Health:
  `app/(dashboard)/ingestion/granot/lifecycle/health/page.tsx` →
  `LifecycleHealthPage`.
  `GRANOT_LIFECYCLE_HEALTH_HREF` =
  `/ingestion/granot/lifecycle/health`.
- Observational overview links to that Health href.
- Intakes `intake-copy.ts` builds
  `/ingestion/granot/lifecycle/jobs/${jobNo}`.
- Job page:
  `app/(dashboard)/ingestion/granot/lifecycle/jobs/[jobNo]/page.tsx`
  renders `GranotJobTimelinePage`.
- Sidebar System: Observational, Operations Registry, Ingestion, Audit
  Log, Settings. No Granot Lifecycle item.
- `canAccessDashboardPath` lets Admin through
  `/ingestion/granot/lifecycle/health` only. Other
  `/ingestion/granot` paths are Owner-only.
- `dashboard-shell.tsx` `ownerOnlyPagePrefixes` includes
  `/ingestion/granot` and does **not** include `/job-timeline` or
  `/conversations` (known incomplete vs `authorization.ts`). Do not
  “fix” the rest of that list. Add Granot Lifecycle carefully so Admin
  can still open Health.
- Tests that will break if nav/auth is wrong:
  `tests/granot-lifecycle-components.test.ts`,
  `tests/dashboard-nav.test.ts`,
  `server/auth/authorization.test.ts`,
  `tests/intakes-components.test.ts` (`isAllowedIntakeReturn`).

## 5. Locked decisions and invariants at risk

- `/ingestion` stays Best Relocation.
- Granot workflow is HTTP Automation only. Remove `GranotNavigation`.
- Job Timeline is not a Granot Lifecycle tab.
- Health is Owner/Admin. Receipts (later) is Owner-only. The sidebar
  item **Granot Lifecycle** is Owner-only; Admin reaches Health via
  Observational.
- Old Health, lifecycle queue, and lifecycle job URLs redirect. Case
  and discrepancy URLs do not redirect.
- Do not rename the Ingestion subtab to HTTP Automation.

## 6. Deliverables and exact contract

1. **Ingestion subnav.** Granot workflow first, Best Relocation second.
   Active-state rules stay: `/ingestion` exact, `/ingestion/granot`
   prefix.
2. **Strip Granot nest.** Delete or stop rendering `GranotNavigation`.
   `/ingestion/granot` layout may keep the Owner gate and render
   children only.
3. **New routes.**
   ```
   app/(dashboard)/granot-lifecycle/layout.tsx
   app/(dashboard)/granot-lifecycle/page.tsx
   app/(dashboard)/granot-lifecycle/health/page.tsx
   ```
   Until GLS-03, `/granot-lifecycle` renders Health (or redirects to
   `/granot-lifecycle/health`). Subnav shows **Health** only.
   Reuse `LifecycleHealthPage`. Move
   `GRANOT_LIFECYCLE_HEALTH_HREF` to `/granot-lifecycle/health`.
4. **Sidebar.** Owner-only **Granot Lifecycle** in System, after
   Operations Registry, before Ingestion.
5. **Redirects** (spec §2.4): lifecycle queue → `/intakes`; Health →
   new href; `jobs/:jobNo` → `buildJobTimelineHref({ job: jobNo })`.
6. **Deep links.** Observational overview; Intakes job href in
   `intake-copy.ts`. Lifecycle dashboard Health/discrepancy buttons
   are unreachable once the nest is gone — do not keep a second queue
   in nav.
7. **Auth.** Move the Admin Health exception to
   `/granot-lifecycle/health`. `/granot-lifecycle` (non-health) is
   Owner-only. Update `authorization.ts` and the shell so Admin is not
   blocked from Health and is blocked from `/granot-lifecycle` itself
   if that path is not Health.
8. **Copy.** Owner strings for the new tab chrome go in a small copy
   module. Health page body copy may stay as it is.
9. **Tests.** Nav order, Admin visibility, Health exception, Granot
   nav absence, redirect targets, Intakes job href, Observational
   href. Update `pageTitleForPath("/granot-lifecycle")` to
   **Granot Lifecycle**.

## 7. Explicitly out of scope

- Receipt search UI or API (GLS-02, GLS-03).
- Any `vantage-main-server` runtime change.
- Redirecting case or discrepancy URLs.
- Putting Job Timeline under the new tab.
- Observational or Operations Registry new tabs.
- Renaming Granot workflow.
- Changing Live Events, Intakes workbench, or Automation apply.

## 8. Flags and runtime posture

No new flag. Health GET is unchanged.

## 9. Migration and indexes

None.

## 10. Acceptance criteria

- [ ] Ingestion subnav order is Granot workflow, then Best Relocation.
- [ ] `/ingestion` still renders Best Relocation. `/ingestion/granot`
      renders HTTP Automation with no inner tabs.
- [ ] Owner sidebar System includes Granot Lifecycle after Operations
      Registry. Admin sidebar does not.
- [ ] `/granot-lifecycle` and `/granot-lifecycle/health` render the
      existing Health page for Owner. Admin can open Health only.
- [ ] `GRANOT_LIFECYCLE_HEALTH_HREF` is `/granot-lifecycle/health`.
      Observational overview uses it.
- [ ] `/ingestion/granot/lifecycle` → `/intakes`.
- [ ] `/ingestion/granot/lifecycle/health` → `/granot-lifecycle/health`.
- [ ] `/ingestion/granot/lifecycle/jobs/:jobNo` → `/job-timeline?job=`.
- [ ] Intakes job deep link uses `buildJobTimelineHref`.
- [ ] `canAccessDashboardPath("admin", "/granot-lifecycle/health")`
      is true.
      `canAccessDashboardPath("admin", "/granot-lifecycle")` is false.
      `canAccessDashboardPath("admin", "/ingestion/granot")` is false.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [ ] Browser: Owner Ingestion, Granot workflow, Granot Lifecycle
      Health, Intakes, Job Timeline, Observational Health link,
      old URL redirects. Admin: Health via Observational, no sidebar
      item, `/ingestion/granot` blocked.

## 11. Required tests and commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Browser proof at **http://localhost:3000**
([`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)). Sign in with
`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from `vantage-admin/.env`.
Do not paste those values.

## 12. Live/staging verification

Local Admin only. Do not read production.

## 13. Rollback

Delete `app/(dashboard)/granot-lifecycle/`, restore `GranotNavigation`
and the previous Health href. Redirects reverse. No data was written.

## 14. Required completion handoff

Report: file map; nav before/after; redirect table with observed
targets; auth matrix; browser steps; what you left for GLS-03 (Receipts
subnav and default tab). Correct any §4 drift in this issue.

**Unblocks:** GLS-03 (together with GLS-02).
