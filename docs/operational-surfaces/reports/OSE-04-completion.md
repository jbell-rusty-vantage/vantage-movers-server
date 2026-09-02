# OSE-04 completion

Repo: `vantage-admin`. Branch: `operational-surfaces`. Closed 2026-09-02.

## 1. Group → keys as implemented

Find is always present. It is not a `FilterConfig` group: `q`, `from` / `to`, and date-sort (`sort` / `direction` / `date_field`) stay URL params.

`FilterConfig.key` membership is a single map in `operational-filter-groups.ts`. Unknown keys throw (`Unknown operational filter key has no group`) instead of vanishing.

| Group | Open rule | Keys |
| --- | --- | --- |
| Find | Always expanded | `q`, `from`, `to`, `sort`, `direction`, `date_field` |
| Status | Always open and compact when the resource has any of these keys; omitted otherwise | `booked`, `cancelled`, `leadless`, `past_move_date` |
| Attribution | Header visible; fields closed unless a member has an active URL value | `source_granularity_key`, `source`, `source_company`, `receiver_agent`, `agent`, `merchant` |
| Record fields | Same as Attribution | `name`, `phone`, `phone_number`, `email`, `ref_no`, `job_no`, `move_size`, `local`, `reason`, `cancelled_by`, `customer_name`, `customer_phone`, `active`, `role` |

Per resource (config keys only):

| Resource | Groups | Status | Attribution | Record fields |
| --- | --- | --- | --- | --- |
| Form / Dup Form | four | `booked`, `cancelled`, `past_move_date` | `source_granularity_key`, `receiver_agent` | `name`, `email`, `phone_number`, `ref_no`, `move_size` |
| Call / Dup Call | four | `booked`, `cancelled` | `source_granularity_key`, `receiver_agent` | `name`, `email`, `phone_number`, `job_no`, `local` |
| Bookings | four | `leadless`, `cancelled` | `source`, `agent`, `merchant` | `customer_name`, `customer_phone`, `job_no` |
| Cancellations | Find + Attribution + Record | none (no stub) | `source_company`, `source`, `agent`, `merchant` | `customer_name`, `customer_phone`, `job_no`, `reason` |
| Customers | Find + Record | none | none | `name`, `phone_number`, `email` |
| Agents | Find + Record | none | none | `name`, `active`, `role` |

`phone` and `cancelled_by` are mapped for the fail-closed membership test; they are not current `FilterConfig` keys.

Owner titles live in `OPERATIONAL_COPY.filterGroups`: Find, Status, Attribution, Record fields.

## 2. Open / collapsed rules

- Find and Status: always open when the group is rendered. No disclosure toggle.
- Attribution and Record fields: remount from `hasActive` (`idle` / `active`). Unused starts closed. An active member opens the group. Reset (no members active) closes it. The Owner can still expand an unused group by clicking the header.
- Hide Attribution / Record headers when that resource has zero keys in the group.
- ActiveFilterChips, Reset, collapsed rail (`vantage-admin-operational-filters-collapsed`), and the mobile right drawer are unchanged.
- `useUrlTableState.reset` still rebuilds the URL with only `database_scope` (drops `record` / `panel` / `connect` and every filter key).
- Historical still hides `receiver_agent` in `withFacetOptions` and clears it on the page.

No new filter keys. Facets stay on `useFacetOptions`. Operational pages do not import Observational `FilterBar`.

## 3. 21st.dev

**Searched, not adopted as a replacement.**

`user-21st` `search` for “collapsible filter groups sidebar active chips” returned Role Filter Chips (22213), Sidebar Nav Group (24865), Chip (3259 / 13843), Filter Grid (23525), Animated Sidebar (21517), shadcn Collapsible (847), Flexi Filter Table (7466), and other nav sidebars.

Fetched **Collapsible (847)** — a Radix `@radix-ui/react-collapsible` wrapper. `vantage-admin` does not depend on that package. Installing it would add a primitive for one disclosure header. Flexi Filter Table and the nav sidebars would replace the operational sidebar.

Implemented with existing `FilterField` / `SelectFilter` / `DebouncedSearchInput` / `DateRangeFilter` plus a small chevron disclosure on Attribution and Record fields.

## 4. Commands

```
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

- `pnpm test`: **432 pass**, 0 fail, 0 skipped (was 424 after OSE-03; +8 in `tests/operational-filter-groups.test.ts`).
- `pnpm typecheck`: clean.
- `pnpm lint`: exit 1 on **pre-existing** errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` (not this pack). OSE-04 files: **0 errors**. One copied `react-hooks/exhaustive-deps` warning on `buildColumns` `useMemo` in `operational-resource-page.tsx` (OSE-01 leftover).

## 5. Browser smoke

Reused Admin `pnpm dev` on `:3000` (OSE-03). Did not start or restart `vantage-main-server`. Already signed in from `vantage-admin/.env` `ADMIN_SEED_*` (not pasted). Desktop width 1440 so the sidebar is visible.

- `/form-leads` — four groups; Find and Status open; Attribution and Record fields collapsed. With `source_granularity_key=main_site_form&booked=true`, chips show Source Company: Main Site Forms and Booked: Yes; Attribution stays open; Record fields stay closed. With `record` + `panel=summary` also set, Reset all leaves `?database_scope=production` only — chips gone, panel gone, Attribution collapsed again.
- `/cancellations` — Find + Attribution + Record fields. No Status heading. Active `reason` opens Record fields. Reset all leaves `?database_scope=production`; no Status stub; panel gone.

A pre-existing Next.js hydration overlay (`layout.tsx` / `Date.now`) appeared; not introduced by this issue. OSE-05 still owns the full eight-route §11.3 walk.

## 6. What this issue did not do (OSE-05)

- No eight-route browser walk (OSE-05).
- No row or tab changes.
- No new filter keys, Bad Lead / Lead Message filters, or Daily View window params.
- No Observational `FilterBar` merge.
- Did not mark `uxdocs/index.txt` live (docs-keeper at OSE-05).
- Did not commit or push.
- Pointer-only CONTEXT + project-organization: grouped filters shipped. The pack is not fully live until OSE-05.

## 7. Risks for OSE-05

- The detail-panel backdrop intercepts clicks on the sidebar Reset at this viewport; chips Reset all (same `reset`) is the reachable control while the panel is open.
- `SelectFilter` is a native `<select>`; automated `select_option` did not always fire React `onChange`. URL-driven chips are the reliable proof.
- Chip labels show the raw key until `useFacetOptions` resolves (then “Main Site Forms”). Same as before.
- Historical `receiver_agent` hide/clear was not re-smoked; the existing page effect and `withFacetOptions` filter are unchanged.
- Hydration overlay can still sit on top of the list during the eight-route walk.
