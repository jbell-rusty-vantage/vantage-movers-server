# OSE-03 — Row identity, status chips, Actions cluster

> **Contract maturity: implementation-ready.** Session 3. Keep
> `DataTable` + `ColumnConfig`. Cluster actions. **No filter groups.**

## 1. Authority and required reading

- **Pack specification:** [`../operational-surfaces-specification.md`](../operational-surfaces-specification.md)
  — §7, §9 (status chips, sticky actions), §11.1 row cases.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

A list row is scannable: who it is, what state it is in, and the next
action on the right. Clicking the row still opens the tabbed panel.
Clicking Book / Bad Lead / Cancel does not.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisites:** OSE-01 and OSE-02 `complete`.
- **21st.dev:** allowed. Craft targets: compact status chip cluster;
  sticky-right table action group. Search first.

## 4. Current-state evidence to verify

Observed 2026-09-01; reverify after OSE-01.

- `buildColumns` prepends `__delete`, `__cancel`, `__mark_bad`,
  `__book`, `__related` as leading columns. Bad Lead is `sticky: "left"`.
- `DataTable` has per-row horizontal scroll chevrons. No
  `isRowSelected`.
- Hidden lead columns: `first_name`, `last_name`, `email`.
- Boolean columns: Booked, Cancelled, SMS Sent. Bad Lead is its own
  column plus the mark control.

## 5. Locked decisions and invariants at risk

- Keep `DataTable`. Do not invent `OperationalRow` as a new page type.
- One sticky-right Actions cluster. Stop prepending the five action
  columns.
- Identity cell per spec §7.1. Status chips per §7.2. No Bad Call chip.
- Selected row: `aria-selected="true"` when `?record=` matches.
- Cluster clicks `stopPropagation`.
- Granot contact chip, Job Number deep link, Stored lead chip stay.
- Do not switch to Daily View card rows.
- Do not add a third Book / Cancel surface. Prefer cluster + Actions tab
  over also keeping the floating bottom bar if it becomes a duplicate.

## 6. Deliverables and exact contract

1. Identity cell (name over phone / customer over phone).
2. Status chip cluster replacing the True/False columns listed in §7.2.
3. Sticky-right Actions cluster per §7.3.
4. `DataTable` selected-row support.
5. Keep Job, Source, money, merchant, Stored lead, Granot contact as
   their own columns.
6. Owner chip labels in `operational-copy.ts` (Booked, Cancelled, Bad
   Lead, Lead Message sent).

## 7. Out of scope

- Filter groups (OSE-04).
- Full eight-route browser proof (OSE-05).
- Changing panel tabs.
- Main-server changes.

## 8. Tests

- Form Lead booked row hides Book in the cluster.
- Referral Booking hides Cancel.
- Call Lead cluster has no Bad Lead control.
- Selected id sets `aria-selected` on that row only.

## 9. Knowledge updates after this issue ships

None beyond the later docs-keeper pass. Do not claim the pack is live.

## 10. Acceptance criteria

- [x] Leading `__book` / `__mark_bad` / `__cancel` / `__delete` /
      `__related` columns are gone.
- [x] Form Lead row shows identity + chips + right cluster.
- [x] Call Lead row has no Bad Lead control.
- [x] Book click does not open the panel; row click does.
- [x] Matching `?record=` row is `aria-selected`.
- [x] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [x] Browser smoke on `/form-leads` and `/bookings`.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Plus the smoke walk. Paste output in the completion report.

## 12. Risks

- Leaving Book in both a leading column and the cluster.
- Making the table wider by stacking chips poorly.
- Breaking compact `MarkBadLeadControl` inside the cluster.

## 13. Rollback

Restore `buildColumns` prepended actions and boolean columns. Selected
row support may remain on `DataTable`.

## 14. Handoff list for the completion report

- Column list per primary resource after the change.
- 21st.dev component ids / takes, or why none.
- Decision on the floating bottom bar (kept or removed, with reason).
- What you did not do (OSE-04–05).

**Unblocks:** OSE-04.
