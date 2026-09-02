# OSE-02 completion

Repo: `vantage-admin`. Branch: `operational-surfaces`. Closed 2026-09-02.

## 1. Tab visibility table vs implementation

`visibleDetailTabs(uiResource, record, ctx)` in `vantage-admin/components/operational/visible-detail-tabs.ts`.

| Tab | Form Lead | Dup Form | Call Lead | Dup Call | Booking | Cancellation | Customer | Agent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Summary | yes | yes | yes | yes | yes | yes | yes | yes |
| Contact | yes | yes | yes | yes | yes | yes | yes | no |
| Lead Message | yes | yes | no | no | no | no | no | no |
| Actions | production && !readOnly | no | production && !readOnly | no | production && (cancel or related) | no — View booking on Contact | no | no |
| Production record | if editable | no | if editable | no | if editable or owner delete | if editable or owner delete | if editable | no |
| Source Company / Source | yes (Source Company) | yes | yes | yes | yes (Source) | yes (Source) | no | no |

Extra cases covered by tests:

- Historical Form Lead: Summary, Contact, Lead Message, Source Company.
- Duplicate Form Lead: same minus Actions and Production record.
- Referral Booking, no related lead, no delete: Summary, Contact, Source.
- Referral Booking with related lead: Actions stays (View lead only).
- Referral / non-editable + `canDelete`: Production record shown as the delete danger zone.

## 2. 21st.dev

**None used.**

`user-21st` `search` for “tabbed drawer sheet sticky tabs scroll body” returned a scrollable sheet (id 25010), generic Tabs (953, 11641, 425, …), sticky section headers (1888), and a replacement Drawer (11441). None was a sticky destination-tab strip that could sit on the existing `SidePanel` without replacing `SidePanel` or `OperationalResourcePage`. Implemented a small `DetailPanelTabStrip` in the new `SidePanel` `header` slot so the body still scrolls and the tabs do not.

## 3. Proof that JSON dumps are gone

Source-scan in `tests/operational-detail-tabs.test.ts`:

- `operational-detail-panel.tsx` has no `JSON.stringify` and no `Raw Identifiers`.
- `lead-message-section.tsx` has no `JSON.stringify`, no `Message data`, and no `SMS Message` heading.

Render proof: a Form Lead with `sms_message.body` shows the plain-text body and does not render `Message data` or a JSON object. Empty state is “No Lead Message is associated with this Form Lead.” plus the sent True/False fact.

## 4. URL behavior

- Default / unknown / hidden `?panel=` → `summary`.
- `?panel=message` on a Form Lead selects Lead Message (tab strip `aria-selected`).
- `?panel=message` on a Call Lead or Booking → Summary.
- `?connect=1` on Bookings with no visible requested tab → Contact (`BookingStoredLeadSection` still `startOpen={startConnect && !readOnly}`).
- Close and successful owner delete clear `record`, `panel`, and `connect`.
- Changing the selected record keeps `panel` in the URL; the panel re-resolves and writes `summary` if that tab is hidden.
- `apiFiltersFromUrlState` strips `record`, `connect`, and `panel`. `adminExportUrl` built from those filters does not include `panel`.

## 5. Commands

```
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

- `pnpm test`: **410 pass**, 0 fail, 0 skipped (was 395 after OSE-01; +15 in `tests/operational-detail-tabs.test.ts`).
- `pnpm typecheck`: clean.
- `pnpm lint`: exit 1 on **pre-existing** errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` (not this pack). OSE-02 files: **0 errors**. One copied `react-hooks/exhaustive-deps` warning on `buildColumns` `useMemo` in `operational-resource-page.tsx` (OSE-01 leftover).

## 6. Browser smoke

**Blocked.** `http://localhost:3000/login` and `http://localhost:3001` did not respond (curl HTTP 000). Cursor browser navigation landed on `chrome-error://chromewebdata/`. No Admin or API process was running in the workspace terminals. Unit/render tests above cover tab visibility, `?panel=` fallback, connect → Contact, and JSON dump removal. OSE-05 owns the full §11.3 walk.

## 7. What this issue did not do (OSE-03–05)

- No row identity cell, status chips, sticky Actions cluster, or `aria-selected` on `<tr>` (OSE-03).
- No filter groups (OSE-04).
- No eight-route browser walk (OSE-05).
- No Daily View tabs, ConversationPanel, Bad Call, or Sync button.
- No main-server runtime / DTO changes.
- No in-panel Book / Cancel forms.
- Did not mark `uxdocs/index.txt` live.
- Did not commit or push.

## 8. Pointers updated

- `vantage-admin/CONTEXT.md` — operational surfaces pointer now says the detail panel is tabbed and JSON dumps are gone. Does not claim row cluster or grouped filters.
- `vantage-admin/.cursor/rules/project-organization.mdc` — same, plus Contact tab owns Stored lead.
