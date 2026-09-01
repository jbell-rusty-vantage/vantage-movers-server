# OSE-04 — Grouped filter sidebar

> **Contract maturity: implementation-ready.** Session 4. Same filter
> keys. Group Find / Status / Attribution / Record fields.

## 1. Authority and required reading

- **Pack specification:** [`../operational-surfaces-specification.md`](../operational-surfaces-specification.md)
  — §8, §9 (grouped filter sidebar), §11.1 group-membership test.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner can find and filter without a single undifferentiated stack.
Find and Status stay obvious. Attribution and Record fields stay out of
the way until used.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisites:** OSE-01 and OSE-03 `complete`.
- **21st.dev:** allowed. Craft target: collapsible filter groups with
  active chips. Search first. Do not replace the sidebar with
  Observational `FilterBar`.

## 4. Current-state evidence to verify

Observed 2026-09-01; reverify after OSE-01.

- `OperationalFilterPanel` lists search, date sort, date range, then
  every `config.filters` field.
- ActiveFilterChips + Reset exist. Collapsed rail uses
  `vantage-admin-operational-filters-collapsed`.
- Mobile drawer is a right sheet with Reset / Show results.
- `useUrlTableState.reset` clears all params except `database_scope`.
- Historical scope clears `receiver_agent`.

## 5. Locked decisions and invariants at risk

- No new API filter keys.
- Every existing `FilterConfig.key` belongs to exactly one group
  (spec §8.1). Test that.
- A group with an active URL value starts open.
- Reset clears filters and `record` / `panel` / `connect`; keeps
  `database_scope`.
- Do not merge with `components/filters/filter-bar.tsx`.
- Facets stay on `useFacetOptions`.
- Do not add Bad Lead, Lead Message, or Daily View window filters.

## 6. Deliverables and exact contract

1. Group headers: Find, Status, Attribution, Record fields.
2. Find always expanded: `q`, dates, date-sort.
3. Status always visible and compact: booked / cancelled / leadless /
   past_move_date as the resource has them.
4. Attribution and Record fields collapsed unless a member is active.
5. Keep chips, Reset, collapsed rail, mobile drawer.
6. Owner group titles in `operational-copy.ts`.

## 7. Out of scope

- Cross-route proof (OSE-05).
- New filter keys or server facet changes.
- Rewriting Observational / Audit filters.

## 8. Tests

- Group membership: every config key is in one group; leftovers fail.
- Active Attribution value forces that group open.
- Reset keeps `database_scope` and drops `panel`.

## 9. Knowledge updates after this issue ships

`vantage-admin/uxdocs/index.txt` may note grouped filters as shipped
together with the panel once OSE-05 closes. Prefer one docs-keeper pass
at OSE-05.

## 10. Acceptance criteria

- [ ] Form Leads sidebar shows the four groups; Find and Status are open.
- [ ] Setting Source Company opens Attribution and adds a chip.
- [ ] Reset clears chips and `?record=` / `?panel=`.
- [ ] No new filter query keys appear on the wire.
- [ ] Observational `FilterBar` is unused by operational pages.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [ ] Browser smoke on `/form-leads` and `/cancellations`.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Plus the smoke walk. Paste output in the completion report.

## 12. Risks

- Hiding Status behind a collapsed group so Booked/Cancelled is easy to
  miss.
- Dropping a filter key that is not in the §8.1 list (fail the
  membership test instead).

## 13. Rollback

Restore the flat `FilterFields` list. URL keys stay valid.

## 14. Handoff list for the completion report

- Group → keys table as implemented.
- 21st.dev component id / take, or why none.
- What you did not do (OSE-05).

**Unblocks:** OSE-05 (also needs OSE-02 and OSE-03).
