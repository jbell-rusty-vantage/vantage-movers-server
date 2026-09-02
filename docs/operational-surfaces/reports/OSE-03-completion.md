# OSE-03 completion

Repo: `vantage-admin`. Branch: `operational-surfaces`. Closed 2026-09-02.

## 1. Column list per primary resource

Hidden columns stay in `ColumnConfig` for Contact / Production record. They are not table columns.

| Resource | Visible table columns (left → right) |
| --- | --- |
| Form Leads / Duplicate Form Leads | Created, Name (identity: name over phone), Status chips, Granot contact, Source, Pickup City, Delivery City, Ref, Job, Move, Actions (sticky right; production Form Leads only get Book / Bad Lead; duplicates get related links only) |
| Call Leads / Duplicate Call Leads | Created, Name (identity: name over phone), Status chips, Job, Source, Pickup City, Delivery City, Local, Actions (sticky right; production Call Leads get Book + related; no Bad Lead; duplicates related only) |
| Bookings | Book Date, Job, Customer (identity: customer name over phone), Status chips (Cancelled when set), Stored lead, Source, Binder, Deposit, Merchant, Actions (sticky right) |
| Cancellations | Cancelled (date), Job, Customer (identity: customer name over phone), Source, Merchant, Refund, Reason, By, Actions (sticky right; related + Owner delete). No status chips. |
| Customers | Name (identity: full name over phone), Email, Bookings, Cancellations, Deposit, Last Activity. No Actions cluster. |
| Agents | Name (identity: name over role), Active, Bookings, Binder, Deposit, Cancellations, Cancel Rate. No Actions cluster. |

Removed from the table (not from the record): Phone (absorbed into identity), Form/Call boolean Booked / Cancelled / Bad Lead / SMS Sent columns, Booking Cancelled boolean, Agent Role (absorbed into identity). First / last / email stay hidden on lead tables.

Leading `__book` / `__mark_bad` / `__cancel` / `__delete` / `__related` columns are gone. Cluster internals live under one `__actions` column.

## 2. Cluster eligibility

| Resource | Production, not readOnly | Duplicates / historical |
| --- | --- | --- |
| Form Leads | Book if not booked; compact Bad Lead; related links | Related only |
| Call Leads | Book if not booked; related links; **no Bad Lead** | Related only |
| Bookings | Cancel unless Referral; related; Owner delete | Related only |
| Cancellations | Related; Owner delete | Related only |

Helpers: `rowIdentity`, `rowStatusChips`, `rowActionCluster` in `vantage-admin/components/operational/operational-row.ts`. Cluster clicks `stopPropagation`. Row click still opens the panel.

Chip labels (show only when set): Booked, Cancelled, Bad Lead reason label, Lead Message sent. Never “Bad Call”, never “text message”.

## 3. Floating bottom bar

**Removed.** After the sticky-right cluster + Actions tab, the bar was a third Book / Cancel / related surface. Close stays on the panel (`closeSelectedRecord` still clears `record`, `panel`, and `connect`). Header “New booking” / “New cancellation” create links are unchanged.

## 4. 21st.dev

**None used.**

`user-21st` `search` for “compact status chip cluster for table cells” returned generic Chip (ids 13842, 3259), Selector Chips (1963), and Records Table (23604). Records Table would replace `DataTable`. The chips are not a table-cell cluster we can compose into `ColumnConfig`.

`search` for “table row action group sticky right” returned Pinnable Columns Table (22167, TanStack, replaces `DataTable`), Table Row Actions (23696, ellipsis dropdown that would hide Book / Cancel), and unrelated sticky headers.

Implemented with existing `StatusBadge` + `Button` / compact `MarkBadLeadControl` inside `DataTable` `sticky: "right"`.

## 5. Commands

```
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

- `pnpm test`: **424 pass**, 0 fail, 0 skipped (was 410 after OSE-02; +14 in `tests/operational-rows.test.ts`).
- `pnpm typecheck`: clean after the row-test `TableQueryParams` shape was completed.
- `pnpm lint`: exit 1 on **pre-existing** errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` (not this pack). OSE-03 files: **0 errors**. One copied `react-hooks/exhaustive-deps` warning on `buildColumns` `useMemo` in `operational-resource-page.tsx` (OSE-01 leftover).

Existing Job timeline / Stored lead / Granot contact source scans still pass.

## 6. Browser smoke

Admin `pnpm dev` was started on `:3000` (nothing was listening). Direct curl to API `:3001` still returned HTTP 000; the Admin proxy still served list data.

Signed in from `vantage-admin/.env` `ADMIN_SEED_*` (not pasted).

- `/form-leads` — identity is name over phone; Status chips (Lead Message sent when set); Actions sticky right with Book + Bad Lead; Job timeline and Granot contact stay. Book navigates to `/bookings/new` and does **not** set `?record=`. Row click opens the tabbed panel and sets `?record=` + `?panel=summary`. Exactly one `<tr aria-selected="true">`.
- `/bookings` — identity is customer over phone; Status after Customer; Stored lead stays its own column; Actions has Cancel + Owner delete (no Book). Row click opens the Bookings panel.

A pre-existing Next.js hydration overlay (`layout.tsx` / `Date.now`) appeared; not introduced by this issue. OSE-05 still owns the full eight-route §11.3 walk.

## 7. What this issue did not do (OSE-04–05)

- No filter groups (OSE-04).
- No eight-route browser walk (OSE-05).
- No panel tab / JSON / `?panel=` changes (OSE-02 already shipped).
- No Daily View card rows, ConversationPanel, Bad Call, or Sync button.
- No new APIs or main-server runtime changes.
- Did not mark `uxdocs/index.txt` live.
- Did not commit or push.

## 8. Pointers updated

- `vantage-admin/CONTEXT.md` — rows now have identity + chips + Actions cluster. Does not claim grouped filters.
- `vantage-admin/.cursor/rules/project-organization.mdc` — same.

## 9. Risks for OSE-04

- Filter keys are unchanged; Status group still uses `booked` / `cancelled` even though those are chips on the row, not table columns.
- Phone / role remain filter fields while the Phone / Role *columns* are gone — do not drop those keys when grouping.
- `sms_message_sent` and `bad_lead` still have no list filters (spec: do not add them).
- Horizontal scroll chevrons stay to the right of the sticky Actions cluster (`right-16` offset). Grouped filters should not add a third Book / Cancel surface.
